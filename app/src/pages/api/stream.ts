/**
 * Stream API — Paginated stream items endpoint.
 * GET /api/stream?page=1&type=all
 */
import type { APIRoute } from 'astro';
import { getStreamPaginated } from '../../lib/data';

export const GET: APIRoute = async ({ url }) => {
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const type = url.searchParams.get('type') || 'all';
    const perPage = parseInt(url.searchParams.get('per_page') || '10', 10);

    const { items, hasMore } = await getStreamPaginated(page, perPage, type === 'all' ? undefined : type);

    return new Response(JSON.stringify({ items, hasMore, page }), {
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=60',
        },
    });
};
