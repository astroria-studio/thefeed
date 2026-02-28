/**
 * Ingest Worker — Cloudflare Worker for content ingestion pipeline.
 *
 * Endpoints:
 *   POST /ingest  — Direct ingestion (local CLI / automation / source adapters)
 *   GET  /health  — Health check
 *
 * Flow: Source → POST /ingest → media upload to R2 → MDX generation → push to draft branch
 */

export interface Env {
    MEDIA: R2Bucket;
    GITHUB_TOKEN: string;
    GITHUB_REPO: string;
    GITHUB_BRANCH: string;
    MEDIA_BASE_URL: string;
    INGEST_SECRET: string;
    TELEGRAM_TOKEN: string;
    SESSIONS: KVNamespace;
    // Queue for async AI tasks (15 min timeout)
    AI_QUEUE: Queue<AITaskMessage>;
    // AI Provider
    AI_PROVIDER?: 'gemini' | 'minimax';
    // Gemini
    GEMINI_API_KEY?: string;
    GEMINI_MODEL?: string;
    // MiniMax
    MINIMAX_API_KEY?: string;
    MINIMAX_MODEL?: string;
    // Windmill (fallback for headless browser)
    WINDMILL_TOKEN?: string;
}

// Queue message types
export interface AITaskMessage {
    type: 'stream_recap' | 'pdf_recap';
    sessionId: string;
    chatId: number;
}

export interface IngestPayload {
    /** Post slug (filename without extension) */
    slug: string;
    /** Post format */
    format: 'article' | 'short-video' | 'video-embed' | 'audio' | 'audio-playlist' | 'quote' | 'gallery';
    /** Frontmatter fields — passed directly */
    frontmatter: Record<string, unknown>;
    /** Optional markdown body content */
    body?: string;
    /** Media attachments to upload to R2 */
    media?: MediaAttachment[];
}

export interface MediaAttachment {
    /** Field name in frontmatter to update with the R2 URL (e.g., "heroImage", "audioUrl") */
    field: string;
    /** Source URL to download from (or base64 data URI) */
    sourceUrl: string;
    /** Desired filename in R2 (e.g., "hero.webp", "episode.mp3") */
    filename: string;
    /** MIME type */
    contentType?: string;
}

export interface PipelineResult {
    slug: string;
    mediaUploaded: string[];
    mdxPath: string;
    gitCommitSha?: string;
}

import { uploadMedia, uploadFileDirect, type DirectUpload } from './media';
import { generateMDX } from './mdx';
import { pushToGitHub } from './github';
import { handleTelegram } from './telegram';
import { getStreamSession, formatFullRecap, fetchContent, detectSource } from './stream';
import { getPDFSession } from './pdf';
import type { RecapResult } from './gemini';
import { processAITask } from './queue';

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);

        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        };

        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        try {
            // Telegram webhook path includes the secret token for security
            if (url.pathname.startsWith('/telegram/')) {
                const pathToken = url.pathname.split('/telegram/')[1];
                if (pathToken !== env.TELEGRAM_TOKEN.split(':')[0]) {
                    return json({ error: 'Invalid webhook path' }, corsHeaders, 403);
                }
                return handleTelegram(request, env, ctx);
            }

            // Preview endpoint for stream recaps
            if (url.pathname.startsWith('/preview/')) {
                const sessionId = url.pathname.split('/preview/')[1];
                return handlePreview(sessionId, env, corsHeaders);
            }

            switch (url.pathname) {
                case '/health':
                    return json({ status: 'ok', timestamp: new Date().toISOString() }, corsHeaders);

                case '/ingest':
                    return handleIngest(request, env, corsHeaders);

                case '/upload':
                    return handleUpload(request, env, corsHeaders);

                case '/test-fetch':
                    return handleTestFetch(url, env, corsHeaders);

                case '/test-ai':
                    return handleTestAI(env, corsHeaders);

                case '/backfill-content':
                    return handleBackfillContent(request, env, corsHeaders);

                default:
                    return json({ error: 'Not found' }, corsHeaders, 404);
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            return json({ error: message }, corsHeaders, 500);
        }
    },

    // Queue consumer for async AI tasks (15 min timeout)
    async queue(batch: MessageBatch<AITaskMessage>, env: Env): Promise<void> {
        console.log(`Queue consumer received ${batch.messages.length} messages`);
        for (const message of batch.messages) {
            console.log(`Processing queue message: ${JSON.stringify(message.body)}`);
            try {
                await processAITask(message.body, env);
                message.ack();
                console.log(`Queue message processed successfully`);
            } catch (err) {
                console.error('Queue task failed:', err);
                message.retry();
            }
        }
    },
};

/** Direct ingestion endpoint (JSON payload) */
async function handleIngest(request: Request, env: Env, headers: Record<string, string>): Promise<Response> {
    if (request.method !== 'POST') {
        return json({ error: 'Method not allowed' }, headers, 405);
    }

    const auth = request.headers.get('Authorization');
    if (!auth || auth !== `Bearer ${env.INGEST_SECRET}`) {
        return json({ error: 'Unauthorized' }, headers, 401);
    }

    const payload = await request.json<IngestPayload>();

    if (!payload.slug || !payload.format || !payload.frontmatter) {
        return json({ error: 'Missing required fields: slug, format, frontmatter' }, headers, 400);
    }

    const result = await runPipeline(payload, env);
    return json({ success: true, result }, headers);
}

/**
 * Upload endpoint — accepts multipart/form-data with files + metadata.
 *
 * Form fields:
 *   - metadata: JSON string with {slug, format, frontmatter, body?}
 *   - file_<field>: File to upload, where <field> is the frontmatter field name
 *                   e.g., file_audioUrl, file_videoUrl, file_coverImage
 *
 * Example curl:
 *   curl -X POST https://ingest.../upload \
 *     -H "Authorization: Bearer $SECRET" \
 *     -F 'metadata={"slug":"ep-01","format":"audio","frontmatter":{"title":"Episode 1"}}' \
 *     -F "file_audioUrl=@episode.mp3"
 */
async function handleUpload(request: Request, env: Env, headers: Record<string, string>): Promise<Response> {
    if (request.method !== 'POST') {
        return json({ error: 'Method not allowed' }, headers, 405);
    }

    const auth = request.headers.get('Authorization');
    if (!auth || auth !== `Bearer ${env.INGEST_SECRET}`) {
        return json({ error: 'Unauthorized' }, headers, 401);
    }

    const contentType = request.headers.get('Content-Type') || '';
    if (!contentType.includes('multipart/form-data')) {
        return json({ error: 'Content-Type must be multipart/form-data' }, headers, 400);
    }

    const formData = await request.formData();

    // Parse metadata JSON
    const metadataStr = formData.get('metadata');
    if (!metadataStr || typeof metadataStr !== 'string') {
        return json({ error: 'Missing metadata field' }, headers, 400);
    }

    let payload: IngestPayload;
    try {
        payload = JSON.parse(metadataStr);
    } catch {
        return json({ error: 'Invalid metadata JSON' }, headers, 400);
    }

    if (!payload.slug || !payload.format || !payload.frontmatter) {
        return json({ error: 'Missing required fields in metadata: slug, format, frontmatter' }, headers, 400);
    }

    // Process file uploads (fields starting with "file_")
    const directUploads: DirectUpload[] = [];
    for (const [key, value] of formData.entries()) {
        // In Workers, File extends Blob - check for arrayBuffer method
        if (key.startsWith('file_') && typeof value === 'object' && value !== null && 'arrayBuffer' in value) {
            const file = value as File;
            const field = key.slice(5); // Remove "file_" prefix
            const data = await file.arrayBuffer();
            directUploads.push({
                field,
                data,
                filename: file.name,
                contentType: file.type || 'application/octet-stream',
            });
        }
    }

    // Upload files directly to R2
    const mediaUploaded: string[] = [];
    for (const upload of directUploads) {
        const r2Url = await uploadFileDirect(env.MEDIA, upload, payload.slug, env.MEDIA_BASE_URL);
        payload.frontmatter[upload.field] = r2Url;
        mediaUploaded.push(r2Url);
    }

    // Also handle any URL-based media attachments
    if (payload.media && payload.media.length > 0) {
        for (const attachment of payload.media) {
            const r2Url = await uploadMedia(env.MEDIA, attachment, payload.slug, env.MEDIA_BASE_URL);
            payload.frontmatter[attachment.field] = r2Url;
            mediaUploaded.push(r2Url);
        }
    }

    // Generate MDX and push to GitHub
    const mdxContent = generateMDX(payload.frontmatter, payload.body);
    const mdxPath = `app/src/content/posts/${payload.slug}.mdx`;
    const commitSha = await pushToGitHub(env, mdxPath, mdxContent, `content: add/update ${payload.slug}`);

    return json({
        success: true,
        result: {
            slug: payload.slug,
            mediaUploaded,
            mdxPath,
            gitCommitSha: commitSha,
        },
    }, headers);
}

/** Core pipeline: media upload → MDX generation → GitHub push */
async function runPipeline(payload: IngestPayload, env: Env): Promise<PipelineResult> {
    const mediaUploaded: string[] = [];

    // Step 1: Upload media to R2
    if (payload.media && payload.media.length > 0) {
        for (const attachment of payload.media) {
            const r2Url = await uploadMedia(env.MEDIA, attachment, payload.slug, env.MEDIA_BASE_URL);
            payload.frontmatter[attachment.field] = r2Url;
            mediaUploaded.push(r2Url);
        }
    }

    // Step 2: Generate MDX content
    const mdxContent = generateMDX(payload.frontmatter, payload.body);
    const mdxPath = `app/src/content/posts/${payload.slug}.mdx`;

    // Step 3: Push to GitHub (draft branch)
    const commitSha = await pushToGitHub(env, mdxPath, mdxContent, `content: add/update ${payload.slug}`);

    return {
        slug: payload.slug,
        mediaUploaded,
        mdxPath,
        gitCommitSha: commitSha,
    };
}

function json(data: unknown, headers: Record<string, string>, status = 200): Response {
    return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: { ...headers, 'Content-Type': 'application/json' },
    });
}

/** Test AI endpoint for debugging */
async function handleTestAI(env: Env, headers: Record<string, string>): Promise<Response> {
    const { generateRecap, callGemini } = await import('./gemini');

    const testContent = "MacDown is an open source Markdown editor for macOS. It has live preview, syntax highlighting, and export to PDF/HTML.";

    try {
        const start = Date.now();
        const recap = await generateRecap(env, testContent, 'vi');
        const duration = Date.now() - start;

        // Also get raw response for debugging
        const rawResponse = await callGemini(env, "Create a 2 sentence summary in Vietnamese", testContent, 0.5);

        return json({
            success: true,
            duration: `${duration}ms`,
            recap,
            rawResponseSample: rawResponse.slice(0, 500),
        }, headers);
    } catch (err) {
        return json({
            success: false,
            error: err instanceof Error ? err.message : 'Unknown error',
            stack: err instanceof Error ? err.stack : undefined,
        }, headers, 500);
    }
}

/**
 * Backfill content for existing stream items.
 * POST /backfill-content { url, slug }
 * Fetches content via Crawl4AI and pushes to GitHub (draft branch).
 */
async function handleBackfillContent(
    request: Request,
    env: Env,
    headers: Record<string, string>,
): Promise<Response> {
    if (request.method !== 'POST') {
        return json({ error: 'Method not allowed' }, headers, 405);
    }

    const body = await request.json<{ url: string; slug: string }>();
    if (!body.url || !body.slug) {
        return json({ error: 'Missing url or slug' }, headers, 400);
    }

    try {
        const source = detectSource(body.url);
        const result = await fetchContent(body.url, source, env.WINDMILL_TOKEN);

        // Generate content MD
        const wordCount = result.content.split(/\s+/).length;
        const contentMD = `---
sourceUrl: "${body.url}"
fetchedAt: "${new Date().toISOString()}"
wordCount: ${wordCount}
---

${result.content}
`;

        // Push to GitHub
        const contentPath = `app/src/content/stream-content/${body.slug}.md`;
        const commitSha = await pushToGitHub(env, contentPath, contentMD, `content: backfill ${body.slug}`);

        return json({
            success: true,
            slug: body.slug,
            wordCount,
            commitSha,
        }, headers);
    } catch (err) {
        return json({
            success: false,
            error: err instanceof Error ? err.message : 'Unknown error',
        }, headers, 500);
    }
}

async function handleTestFetch(url: URL, env: Env, headers: Record<string, string>): Promise<Response> {
    const testUrl = url.searchParams.get('url');
    if (!testUrl) {
        return json({ error: 'Missing url parameter' }, headers, 400);
    }

    try {
        const source = detectSource(testUrl);
        const result = await fetchContent(testUrl, source, env.WINDMILL_TOKEN);
        return json({
            source,
            title: result.title,
            videoId: result.videoId,
            contentLength: result.content.length,
            contentPreview: result.content.slice(0, 1000) + (result.content.length > 1000 ? '...' : ''),
        }, headers);
    } catch (err) {
        return json({ error: err instanceof Error ? err.message : 'Unknown error' }, headers, 500);
    }
}

/** Preview endpoint for stream recaps */
async function handlePreview(
    sessionId: string,
    env: Env,
    headers: Record<string, string>,
): Promise<Response> {
    // Try stream session first
    const streamSession = await getStreamSession(env, sessionId);

    // Try PDF session if stream not found
    const pdfSession = streamSession ? null : await getPDFSession(env, sessionId);

    // Get recap data from either session type
    let recap: RecapResult | null = null;
    let sourceUrl = '';
    let sourceType = '';
    let status = '';
    let pdfDownloadUrl = '';
    let pdfFileName = '';
    let pdfPages = 0;

    if (streamSession?.recap) {
        recap = streamSession.recap;
        sourceUrl = streamSession.url;
        sourceType = streamSession.source;
        status = streamSession.status;
        if (streamSession.pdfUrl) {
            pdfDownloadUrl = streamSession.pdfUrl;
        }
    } else if (pdfSession?.recap) {
        recap = pdfSession.recap;
        sourceUrl = pdfSession.r2Url || '';
        sourceType = 'pdf';
        status = pdfSession.status;
        pdfDownloadUrl = pdfSession.r2Url || '';
        pdfFileName = pdfSession.fileName;
        pdfPages = pdfSession.analysis?.pageCount || 0;
    }

    if (!recap) {
        return new Response('Preview not found or expired', {
            status: 404,
            headers: { ...headers, 'Content-Type': 'text/plain' },
        });
    }

    const markdown = formatFullRecap(recap);

    // Pre-process markdown to ensure line breaks
    const processedMarkdown = markdown
        .replace(/\*\*(Pain point|Dùng khi|Được gì):/g, '\n**$1:')
        .replace(/\n{3,}/g, '\n\n');

    // PDF download button HTML
    const pdfButton = pdfDownloadUrl ? `
    <div class="pdf-download">
        <a href="${pdfDownloadUrl}" target="_blank" class="pdf-btn">
            📥 Tải PDF${pdfPages ? ` (${pdfPages} trang)` : ''}
        </a>
        ${pdfFileName ? `<span class="pdf-name">${pdfFileName}</span>` : ''}
    </div>` : '';

    const html = `<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${recap.title}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 2rem;
            line-height: 1.8;
            color: #333;
            background: #fafafa;
        }
        h1 { color: #111; border-bottom: 2px solid #333; padding-bottom: 0.5rem; }
        h2 { color: #444; margin-top: 2rem; }
        h3 { color: #666; margin-top: 1.5rem; }
        p { margin: 0.8rem 0; }
        pre { background: #f0f0f0; padding: 1rem; overflow-x: auto; border-radius: 4px; }
        code { background: #f0f0f0; padding: 0.2rem 0.4rem; border-radius: 2px; }
        blockquote { border-left: 4px solid #ddd; margin: 1rem 0; padding-left: 1rem; color: #666; }
        .meta { color: #888; font-size: 0.9rem; margin-bottom: 1rem; }
        .pdf-download { margin: 1rem 0 2rem; padding: 1rem; background: #e8f4f8; border-radius: 8px; }
        .pdf-btn { display: inline-block; padding: 0.6rem 1.2rem; background: #0066cc; color: white; text-decoration: none; border-radius: 6px; font-weight: 500; }
        .pdf-btn:hover { background: #0052a3; }
        .pdf-name { display: block; margin-top: 0.5rem; font-size: 0.85rem; color: #666; }
        strong { color: #111; }
    </style>
</head>
<body>
    <div class="meta">
        <strong>Source:</strong> <a href="${sourceUrl}">${sourceType}</a> |
        <strong>Status:</strong> ${status}
    </div>
    ${pdfButton}
    <div id="content"></div>
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <script>
        marked.setOptions({ breaks: true });
        document.getElementById('content').innerHTML = marked.parse(${JSON.stringify(processedMarkdown)});
    </script>
</body>
</html>`;

    return new Response(html, {
        status: 200,
        headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' },
    });
}
