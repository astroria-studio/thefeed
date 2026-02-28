/**
 * Stream Ingestion — Fetch content from URLs, generate AI recap, push to draft.
 *
 * Supports: GitHub repos, YouTube videos, websites
 * Flow: URL → Detect type → Queue fetch job → Poll → AI recap → Preview → Approve → Push
 */

import type { Env } from './index';
import { generateRecap, regenerateRecapWithFeedback, type RecapResult, type RecapLang } from './gemini';
import { pushToGitHub } from './github';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type StreamSource = 'github' | 'gist' | 'youtube' | 'website' | 'pdf';
export type StreamStatus = 'fetching' | 'recapping' | 'preview' | 'approved' | 'failed';

export interface StreamSession {
    id: string;
    chatId: number;
    messageId?: number;
    url: string;
    source: StreamSource;
    lang: RecapLang;
    status: StreamStatus;

    // Windmill job tracking
    jobId?: string;
    pollAttempts: number;

    // Fetched content
    rawContent?: string;
    rawTitle?: string;
    videoId?: string; // YouTube video ID for embed
    pdfUrl?: string;  // PDF URL for embed
    pdfPages?: number; // PDF page count

    // Generated recap
    recap?: RecapResult;
    feedbackHistory: string[];

    createdAt: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Source Detection
// ─────────────────────────────────────────────────────────────────────────────

export function detectSource(url: string): StreamSource {
    const u = url.toLowerCase();
    if (u.endsWith('.pdf') || u.includes('.pdf?')) {
        return 'pdf';
    }
    // GitHub Gist - treat as website (will use Crawl4AI)
    if (u.includes('gist.github.com')) {
        return 'gist';
    }
    // GitHub repo (not issues/pulls)
    if (u.includes('github.com') && !u.includes('/issues') && !u.includes('/pull')) {
        return 'github';
    }
    if (u.includes('youtube.com/watch') || u.includes('youtu.be/')) {
        return 'youtube';
    }
    return 'website';
}

export function parseStreamCommand(text: string): { url: string; lang: RecapLang } {
    const trimmed = text.trim();
    let lang: RecapLang = 'vi'; // Default Vietnamese

    // Check for language flag
    if (trimmed.endsWith('--en')) {
        lang = 'en';
    }

    // Extract URL
    const urlMatch = trimmed.match(/https?:\/\/[^\s]+/);
    const url = urlMatch ? urlMatch[0].replace(/--en$/, '').trim() : '';

    return { url, lang };
}

// ─────────────────────────────────────────────────────────────────────────────
// Session Management
// ─────────────────────────────────────────────────────────────────────────────

export async function getStreamSession(
    env: { SESSIONS: KVNamespace },
    sessionId: string,
): Promise<StreamSession | null> {
    const data = await env.SESSIONS.get(`stream:${sessionId}`);
    return data ? JSON.parse(data) : null;
}

export async function setStreamSession(
    env: { SESSIONS: KVNamespace },
    session: StreamSession,
): Promise<void> {
    await env.SESSIONS.put(`stream:${session.id}`, JSON.stringify(session), {
        expirationTtl: 3600, // 1 hour
    });
}

export async function deleteStreamSession(
    env: { SESSIONS: KVNamespace },
    sessionId: string,
): Promise<void> {
    await env.SESSIONS.delete(`stream:${sessionId}`);
}

export async function findActiveStreamSession(
    env: { SESSIONS: KVNamespace },
    chatId: number,
): Promise<StreamSession | null> {
    // Check for active stream session for this user
    const data = await env.SESSIONS.get(`stream:active:${chatId}`);
    if (!data) return null;

    const sessionId = data;
    return getStreamSession(env, sessionId);
}

export async function setActiveStreamSession(
    env: { SESSIONS: KVNamespace },
    chatId: number,
    sessionId: string,
): Promise<void> {
    await env.SESSIONS.put(`stream:active:${chatId}`, sessionId, {
        expirationTtl: 3600,
    });
}

export async function clearActiveStreamSession(
    env: { SESSIONS: KVNamespace },
    chatId: number,
): Promise<void> {
    await env.SESSIONS.delete(`stream:active:${chatId}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Queue Management
// ─────────────────────────────────────────────────────────────────────────────

export interface QueueItem {
    id: string;
    url: string;
    source: StreamSource;
    lang: RecapLang;
    addedAt: number;
    // For PDF file uploads (not URL)
    fileId?: string;
    fileName?: string;
}

export async function getQueue(
    env: { SESSIONS: KVNamespace },
    chatId: number,
): Promise<QueueItem[]> {
    const data = await env.SESSIONS.get(`stream:queue:${chatId}`);
    return data ? JSON.parse(data) : [];
}

export async function addToQueue(
    env: { SESSIONS: KVNamespace },
    chatId: number,
    item: QueueItem,
): Promise<number> {
    const queue = await getQueue(env, chatId);
    queue.push(item);
    await env.SESSIONS.put(`stream:queue:${chatId}`, JSON.stringify(queue), {
        expirationTtl: 86400, // 24 hours
    });
    return queue.length;
}

export async function removeFromQueue(
    env: { SESSIONS: KVNamespace },
    chatId: number,
    itemId: string,
): Promise<boolean> {
    const queue = await getQueue(env, chatId);
    const index = queue.findIndex(q => q.id === itemId);
    if (index === -1) return false;
    queue.splice(index, 1);
    await env.SESSIONS.put(`stream:queue:${chatId}`, JSON.stringify(queue), {
        expirationTtl: 86400,
    });
    return true;
}

export async function clearQueue(
    env: { SESSIONS: KVNamespace },
    chatId: number,
): Promise<void> {
    await env.SESSIONS.delete(`stream:queue:${chatId}`);
}

export async function popFromQueue(
    env: { SESSIONS: KVNamespace },
    chatId: number,
): Promise<QueueItem | null> {
    const queue = await getQueue(env, chatId);
    if (queue.length === 0) return null;
    const item = queue.shift()!;
    await env.SESSIONS.put(`stream:queue:${chatId}`, JSON.stringify(queue), {
        expirationTtl: 86400,
    });
    return item;
}

// ─────────────────────────────────────────────────────────────────────────────
// Content Fetching (Direct - no Windmill for now, can add later)
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchContent(
    url: string,
    source: StreamSource,
    windmillToken?: string,
): Promise<{ title: string; content: string; videoId?: string; pdfUrl?: string; pdfPages?: number }> {
    switch (source) {
        case 'github':
            return fetchGitHubReadme(url);
        case 'gist':
            return fetchGitHubGist(url);
        case 'youtube':
            return fetchYouTubeTranscript(url, windmillToken);
        case 'pdf':
            return fetchPDF(url);
        case 'website':
            return fetchWebsite(url, windmillToken);
    }
}

async function fetchGitHubReadme(url: string): Promise<{ title: string; content: string }> {
    // Clean URL - remove query params and hash
    const cleanUrl = url.split('?')[0].split('#')[0];

    // Extract owner/repo from URL
    const match = cleanUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (!match) throw new Error('Invalid GitHub URL');

    const [, owner, repo] = match;
    const repoName = repo.replace(/\.git$/, '').replace(/\/$/, '');

    // Try multiple README locations and branches
    const branches = ['main', 'master'];
    const readmeNames = ['README.md', 'readme.md', 'Readme.md', 'README.rst', 'README'];

    for (const branch of branches) {
        for (const readme of readmeNames) {
            const readmeUrl = `https://raw.githubusercontent.com/${owner}/${repoName}/${branch}/${readme}`;
            const res = await fetch(readmeUrl);
            if (res.ok) {
                const content = await res.text();
                return { title: repoName, content };
            }
        }
    }

    // Fallback: try GitHub API to get repo description
    try {
        const apiUrl = `https://api.github.com/repos/${owner}/${repoName}`;
        const apiRes = await fetch(apiUrl, {
            headers: { 'User-Agent': 'VilabBot/1.0' },
        });
        if (apiRes.ok) {
            const data = await apiRes.json() as { description?: string; name: string };
            if (data.description) {
                return {
                    title: repoName,
                    content: `# ${data.name}\n\n${data.description}\n\n[No README found - using repo description]`,
                };
            }
        }
    } catch {
        // Continue to error
    }

    throw new Error('README not found');
}

async function fetchGitHubGist(url: string): Promise<{ title: string; content: string }> {
    // Extract gist ID from URL
    // Format: https://gist.github.com/username/gist_id
    const match = url.match(/gist\.github\.com\/([^\/]+)\/([a-f0-9]+)/i);
    if (!match) throw new Error('Invalid Gist URL');

    const [, username, gistId] = match;

    // Fetch gist via GitHub API
    const apiUrl = `https://api.github.com/gists/${gistId}`;
    const res = await fetch(apiUrl, {
        headers: {
            'User-Agent': 'VilabBot/1.0',
            'Accept': 'application/vnd.github.v3+json',
        },
    });

    if (!res.ok) {
        throw new Error(`Gist not found: ${res.status}`);
    }

    const gist = await res.json() as {
        description?: string;
        files: Record<string, { filename: string; content: string; language?: string }>;
    };

    // Get title from description or first filename
    const files = Object.values(gist.files);
    const firstFile = files[0];
    const title = gist.description || firstFile?.filename || `Gist by ${username}`;

    // Combine all file contents
    let content = '';
    for (const file of files) {
        if (files.length > 1) {
            content += `## ${file.filename}\n\n`;
        }
        content += `\`\`\`${file.language?.toLowerCase() || ''}\n${file.content}\n\`\`\`\n\n`;
    }

    // Truncate to ~15KB to keep AI processing fast (MiniMax times out on large content)
    if (content.length > 15000) {
        // Take first 10KB and last 3KB to capture intro and conclusion
        const firstPart = content.slice(0, 10000);
        const lastPart = content.slice(-3000);
        content = `${firstPart}\n\n[... nội dung được rút gọn, gist có ${Math.round(content.length / 1000)}KB ...]\n\n${lastPart}`;
    }

    return { title, content };
}

// Windmill YouTube transcript API
const WINDMILL_YOUTUBE_URL = 'https://windmill.arealisticdreamer.com/api/w/tonyfriendhq/jobs/run_wait_result/p/u/admin/youtube-transcript-extract-api';

async function fetchYouTubeTranscript(url: string, windmillToken?: string): Promise<{ title: string; content: string; videoId: string }> {
    // Extract video ID (only alphanumeric, underscore, hyphen - no query params)
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/);
    if (!match) throw new Error('Invalid YouTube URL');

    const videoId = match[1];

    // Get video title via oEmbed
    let title = `YouTube Video ${videoId}`;
    try {
        const oembedRes = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
        if (oembedRes.ok) {
            const oembed = await oembedRes.json() as { title: string };
            title = oembed.title || title;
        }
    } catch {
        // Keep default title
    }

    let content = '';

    // Use Windmill YouTube transcript API
    if (windmillToken) {
        try {
            const res = await fetch(WINDMILL_YOUTUBE_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${windmillToken}`,
                },
                body: JSON.stringify({ url, lang: 'en' }),
            });

            if (res.ok) {
                const data = await res.json() as {
                    success?: boolean;
                    transcript?: string;
                    title?: string;
                    error?: string;
                };

                if (data.transcript) {
                    content = data.transcript;
                    if (data.title) {
                        title = data.title;
                    }
                }
            }
        } catch {
            // Continue to fallback
        }
    }

    // Fallback: try video description
    if (!content) {
        try {
            const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                },
            });

            if (pageRes.ok) {
                const html = await pageRes.text();
                const playerMatch = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/s);
                if (playerMatch) {
                    try {
                        const playerData = JSON.parse(playerMatch[1]);
                        if (playerData.videoDetails?.title) {
                            title = playerData.videoDetails.title;
                        }
                        if (playerData.videoDetails?.shortDescription) {
                            const desc = playerData.videoDetails.shortDescription;
                            if (desc.length > 100) {
                                content = `Video description:\n\n${desc}`;
                            }
                        }
                    } catch {
                        // Continue
                    }
                }
            }
        } catch {
            // Continue
        }
    }

    if (!content) {
        content = `[Transcript not available for video: ${title}. Video ID: ${videoId}]`;
    }

    return { title, content, videoId };
}

// Crawl4AI configuration
const CRAWL4AI_URL = 'https://crawler.arealisticdreamer.com';
const CRAWL4AI_API_KEY = 'crawl4ai_12531431a50f98d10e009a1ff8cfe15b';

async function fetchPDF(url: string): Promise<{ title: string; content: string; pdfUrl: string; pdfPages?: number }> {
    // Use Crawl4AI for PDF extraction
    const response = await fetch(`${CRAWL4AI_URL}/crawl`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-API-Key': CRAWL4AI_API_KEY,
        },
        body: JSON.stringify({
            urls: [url],
            pdf_options: {
                extract_images: false,
                batch_size: 10,
            },
        }),
    });

    if (!response.ok) {
        throw new Error(`Crawl4AI error: ${response.status}`);
    }

    const data = await response.json() as {
        success: boolean;
        results?: Array<{
            success: boolean;
            markdown?: { raw_markdown: string };
            metadata?: {
                title?: string;
                page_count?: number;
            };
        }>;
    };

    if (!data.success || !data.results?.[0]?.success) {
        throw new Error('PDF extraction failed');
    }

    const result = data.results[0];
    let content = result.markdown?.raw_markdown || '';
    const pageCount = result.metadata?.page_count;

    // Extract title from PDF metadata or filename
    let title = result.metadata?.title || '';
    if (!title) {
        const filename = url.split('/').pop()?.replace(/\.pdf$/i, '') || 'PDF Document';
        title = filename.replace(/[-_]/g, ' ');
    }

    // Apply chunking strategy based on size
    if (pageCount && pageCount > 50) {
        // For large PDFs, take strategic portions
        if (content.length > 40000) {
            const firstPart = content.slice(0, 15000);
            const lastPart = content.slice(-10000);
            const middleStart = Math.floor(content.length / 2) - 5000;
            const middlePart = content.slice(middleStart, middleStart + 10000);

            content = `${firstPart}\n\n[... đầu tài liệu ...]\n\n${middlePart}\n\n[... giữa tài liệu ...]\n\n${lastPart}\n\n[Tài liệu có ${pageCount} trang]`;
        }
    } else if (content.length > 30000) {
        content = content.slice(0, 30000) + '\n\n[... content truncated ...]';
    }

    return {
        title,
        content,
        pdfUrl: url,
        pdfPages: pageCount,
    };
}

// Windmill API for headless browser + Readability
const WINDMILL_URL = 'https://windmill.arealisticdreamer.com/api/w/tonyfriendhq/jobs/run_wait_result/p/u/admin/website-to-markdown';

// JS-heavy sites that need headless browser first
const HEADLESS_DOMAINS = [
    // Social media
    'x.com', 'twitter.com', 'instagram.com', 'facebook.com',
    'linkedin.com', 'threads.net', 'tiktok.com',
    // Paywalled
    'medium.com', 'substack.com', 'nytimes.com', 'wsj.com', 'bloomberg.com',
    // SPAs
    'reddit.com', 'discord.com', 'notion.so', 'figma.com',
    // Dev platforms
    'dev.to', 'hashnode.dev',
];

function needsHeadless(url: string): boolean {
    const lowerUrl = url.toLowerCase();
    return HEADLESS_DOMAINS.some(domain => lowerUrl.includes(domain));
}

async function fetchWithWindmill(url: string, windmillToken: string): Promise<{ title: string; content: string; wordCount: number }> {
    const res = await fetch(WINDMILL_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${windmillToken}`,
        },
        body: JSON.stringify({ url }),
    });

    if (!res.ok) {
        throw new Error(`Windmill error: ${res.status}`);
    }

    const data = await res.json() as {
        success: boolean;
        title?: string;
        markdown?: string;
        word_count?: number;
        error?: string;
    };

    if (!data.success) {
        throw new Error(data.error || 'Windmill failed');
    }

    let content = data.markdown || '';
    if (content.length > 50000) {
        content = content.slice(0, 50000) + '...';
    }

    const title = data.title || new URL(url).hostname;
    const wordCount = data.word_count || content.split(/\s+/).length;

    return { title, content, wordCount };
}

async function fetchWithCrawl4AI(url: string): Promise<{ title: string; content: string; wordCount: number }> {
    const res = await fetch(`${CRAWL4AI_URL}/crawl`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-API-Key': CRAWL4AI_API_KEY,
        },
        body: JSON.stringify({ urls: [url] }),
    });

    if (!res.ok) {
        throw new Error(`Crawl4AI error: ${res.status}`);
    }

    const data = await res.json() as {
        success: boolean;
        results?: Array<{
            success: boolean;
            markdown?: { raw_markdown: string };
            metadata?: { title?: string };
        }>;
    };

    if (!data.success || !data.results?.[0]?.success) {
        throw new Error('Crawl4AI extraction failed');
    }

    const result = data.results[0];
    let content = result.markdown?.raw_markdown || '';
    if (content.length > 50000) {
        content = content.slice(0, 50000) + '...';
    }

    const title = result.metadata?.title || new URL(url).hostname;
    const wordCount = content.split(/\s+/).length;

    return { title, content, wordCount };
}

async function fetchWebsite(url: string, windmillToken?: string): Promise<{ title: string; content: string }> {
    // JS-heavy sites -> Windmill first
    if (needsHeadless(url) && windmillToken) {
        try {
            const result = await fetchWithWindmill(url, windmillToken);
            if (result.wordCount > 0) {
                return { title: result.title, content: result.content };
            }
        } catch {
            // Fall through to Crawl4AI
        }
    }

    // Try Crawl4AI
    let crawl4aiResult: { title: string; content: string; wordCount: number } | null = null;
    try {
        crawl4aiResult = await fetchWithCrawl4AI(url);

        // If good content, return it
        if (crawl4aiResult.wordCount > 500) {
            return { title: crawl4aiResult.title, content: crawl4aiResult.content };
        }
    } catch {
        // Continue to fallback
    }

    // Fallback: Try Windmill if not already tried
    if (windmillToken && !needsHeadless(url)) {
        try {
            const result = await fetchWithWindmill(url, windmillToken);
            if (result.wordCount > (crawl4aiResult?.wordCount || 0)) {
                return { title: result.title, content: result.content };
            }
        } catch {
            // Use Crawl4AI result if available
        }
    }

    // Return Crawl4AI result if we have any
    if (crawl4aiResult && crawl4aiResult.content) {
        return { title: crawl4aiResult.title, content: crawl4aiResult.content };
    }

    // Last resort: basic fetch
    const res = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
    });

    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);

    const html = await res.text();
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : new URL(url).hostname;

    let content = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
        .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
        .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (content.length > 50000) {
        content = content.slice(0, 50000) + '...';
    }

    return { title, content };
}

// ─────────────────────────────────────────────────────────────────────────────
// Recap Generation
// ─────────────────────────────────────────────────────────────────────────────

export async function generateStreamRecap(
    env: Env,
    session: StreamSession,
): Promise<RecapResult> {
    if (!session.rawContent) {
        throw new Error('No content to recap');
    }

    return generateRecap(env, session.rawContent, session.lang, session.rawTitle);
}

export async function iterateStreamRecap(
    env: Env,
    session: StreamSession,
    feedback: string,
): Promise<RecapResult> {
    if (!session.rawContent || !session.recap) {
        throw new Error('No content or recap to iterate');
    }

    return regenerateRecapWithFeedback(
        env,
        session.rawContent,
        session.recap,
        feedback,
        session.lang,
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// MDX Generation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Escape curly braces in MDX content to prevent JSX parsing errors.
 * Wraps {text} patterns in backticks: `{text}`
 */
function escapeMdxBraces(text: string): string {
    // Match curly braces that aren't already in backticks or code blocks
    // Replace {something} with `{something}` unless already escaped
    return text.replace(/(?<!`)(\{[^}]+\})(?!`)/g, '`$1`');
}

/**
 * Fix relative image paths in GitHub README content.
 * Converts relative paths to raw.githubusercontent.com URLs.
 */
function fixRelativeImagePaths(content: string, sourceUrl: string): string {
    // Only process GitHub URLs
    const githubMatch = sourceUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (!githubMatch) return content;

    const [, owner, repo] = githubMatch;
    const repoName = repo.replace(/\.git$/, '').replace(/\/$/, '');
    const baseUrl = `https://raw.githubusercontent.com/${owner}/${repoName}/main`;

    // Replace relative image paths: ![alt](path) or ![alt](./path) or ![alt](public/...)
    return content.replace(
        /!\[([^\]]*)\]\((?!https?:\/\/)(?:\.\/)?([^)]+)\)/g,
        (match, alt, path) => `![${alt}](${baseUrl}/${path})`
    );
}

export function generateStreamContentMD(session: StreamSession): string {
    const wordCount = session.rawContent?.split(/\s+/).length || 0;
    // Fix relative image paths for GitHub content
    const content = fixRelativeImagePaths(session.rawContent || '', session.url);
    return `---
sourceUrl: "${session.url}"
fetchedAt: "${new Date().toISOString()}"
wordCount: ${wordCount}
---

${content}
`;
}

export function generateStreamMDX(session: StreamSession): string {
    if (!session.recap) throw new Error('No recap to generate MDX');

    const { recap, url, source, videoId, pdfUrl, pdfPages } = session;
    const date = new Date().toISOString();

    // Add videoId/pdfUrl to frontmatter
    const videoIdField = videoId ? `\nvideoId: "${videoId}"` : '';
    const pdfUrlField = pdfUrl ? `\npdfUrl: "${pdfUrl}"` : '';
    const pdfPagesField = pdfPages ? `\npdfPages: ${pdfPages}` : '';

    const frontmatter = `---
type: link
title: "${recap.title.replace(/"/g, '\\"')}"
date: "${date}"
url: "${url}"
source: "${source}"${videoIdField}${pdfUrlField}${pdfPagesField}
status: published
tags: [${recap.tags.map(t => `"${t}"`).join(', ')}]
---`;

    // YouTube embed if video
    const youtubeEmbed = videoId ? `
<div class="aspect-video mb-8">
  <iframe
    src="https://www.youtube.com/embed/${videoId}"
    title="${recap.title.replace(/"/g, '&quot;')}"
    frameborder="0"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
    allowfullscreen
    class="w-full h-full rounded-lg"
  ></iframe>
</div>
` : '';

    // PDF embed/link
    const pdfEmbed = pdfUrl ? `
<div class="pdf-preview mb-8 p-4 border border-[var(--color-border)] rounded-lg bg-[var(--color-card)]">
  <div class="flex items-center gap-3 mb-3">
    <span class="text-3xl">📄</span>
    <div>
      <div class="font-semibold">${recap.title}</div>
      <div class="text-sm text-[var(--color-soft)]">${pdfPages ? `${pdfPages} trang` : 'PDF Document'}</div>
    </div>
  </div>
  <a href="${pdfUrl}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-accent)] text-white text-sm font-medium hover:opacity-90 transition-opacity">
    📥 Tải PDF
  </a>
</div>
` : '';

    const body = `${youtubeEmbed}${pdfEmbed}
## TL;DR

${escapeMdxBraces(recap.tldr)}

## Bài này dành cho ai?

${escapeMdxBraces(recap.audiences)}

## Các điểm chính

${escapeMdxBraces(recap.takeaways)}

## Quick Start

${escapeMdxBraces(recap.quickStart)}
`.trim();

    return `${frontmatter}\n\n${body}\n`;
}

export function generateSlug(url: string, source: StreamSource): string {
    const timestamp = Date.now();

    switch (source) {
        case 'github': {
            const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)/);
            if (match) {
                return `${match[2].toLowerCase().replace(/[^a-z0-9]/g, '-')}-${timestamp}`;
            }
            break;
        }
        case 'gist': {
            const match = url.match(/gist\.github\.com\/([^\/]+)\/([a-f0-9]+)/i);
            if (match) {
                return `gist-${match[1].toLowerCase()}-${match[2].slice(0, 8)}-${timestamp}`;
            }
            break;
        }
        case 'youtube': {
            const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/);
            if (match) {
                return `yt-${match[1]}-${timestamp}`;
            }
            break;
        }
        case 'pdf': {
            // Extract filename from URL
            const filename = url.split('/').pop()?.replace(/\.pdf$/i, '') || 'pdf';
            return `pdf-${filename.slice(0, 30).toLowerCase().replace(/[^a-z0-9]/g, '-')}-${timestamp}`;
        }
    }

    // Website fallback
    try {
        const hostname = new URL(url).hostname.replace(/^www\./, '');
        return `${hostname.replace(/\./g, '-')}-${timestamp}`;
    } catch {
        return `stream-${timestamp}`;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Publishing
// ─────────────────────────────────────────────────────────────────────────────

export async function publishStream(env: Env, session: StreamSession): Promise<string> {
    const mdxContent = generateStreamMDX(session);
    const slug = generateSlug(session.url, session.source);
    const mdxPath = `app/src/content/stream/${slug}.mdx`;

    // Push MDX file (recap)
    await pushToGitHub(env, mdxPath, mdxContent, `stream: add ${slug}`);

    // Push full content file if rawContent exists
    if (session.rawContent) {
        const contentMD = generateStreamContentMD(session);
        const contentPath = `app/src/content/stream-content/${slug}.md`;
        await pushToGitHub(env, contentPath, contentMD, `content: add stream-content ${slug}`);
    }

    return slug;
}

// ─────────────────────────────────────────────────────────────────────────────
// Preview Formatting
// ─────────────────────────────────────────────────────────────────────────────

export function formatRecapPreview(recap: RecapResult, maxLength = 1500): { text: string; parse_mode: 'Markdown' } {
    const audiences = recap.audiences.length > 600
        ? recap.audiences.slice(0, 600) + '...'
        : recap.audiences;

    let preview = `*${recap.title}*\n\n`;
    preview += `*TL;DR*\n${recap.tldr}\n\n`;
    preview += `*Bai nay danh cho ai?*\n${audiences}\n\n`;
    preview += `Tags: ${recap.tags.join(', ')}`;

    if (preview.length > maxLength) {
        preview = preview.slice(0, maxLength) + '...';
    }

    return { text: preview, parse_mode: 'Markdown' };
}

export function formatFullRecap(recap: RecapResult): string {
    const tocSection = recap.toc ? `

## Mục lục nội dung

${recap.toc}
` : '';

    return `# ${recap.title}

## TL;DR

${recap.tldr}
${tocSection}
## Bài này dành cho ai?

${recap.audiences}

## Các điểm chính

${recap.takeaways}

## Quick Start

${recap.quickStart}

---

**Tags:** ${recap.tags.join(', ')}
`;
}
