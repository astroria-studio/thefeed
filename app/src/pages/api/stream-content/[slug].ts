/**
 * Stream Content API — Lazy-load full content for stream items.
 * GET /api/stream-content/{slug}
 */
import type { APIRoute } from 'astro';
import { getEntry } from 'astro:content';
import { marked } from 'marked';

export const GET: APIRoute = async ({ params }) => {
    const { slug } = params;

    if (!slug) {
        return new Response(JSON.stringify({ error: 'Slug required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const entry = await getEntry('streamContent', slug);

    if (!entry) {
        return new Response(JSON.stringify({ error: 'Content not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const html = await marked.parse(entry.body || '');

    return new Response(JSON.stringify({
        sourceUrl: entry.data.sourceUrl,
        wordCount: entry.data.wordCount,
        fetchedAt: entry.data.fetchedAt,
        content: html,
    }), {
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=3600',
        },
    });
};
