/**
 * Feed API — Paginated posts endpoint for infinite scroll.
 * GET /api/feed?page=1&format=all&sort=newest
 */
import type { APIRoute } from 'astro';
import { getPostsPaginated } from '../../lib/data';

export const GET: APIRoute = async ({ url }) => {
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const format = url.searchParams.get('format') || 'all';
    const sort = url.searchParams.get('sort') || 'newest';
    const perPage = parseInt(url.searchParams.get('per_page') || '10', 10);

    const { posts, hasMore } = await getPostsPaginated(
        page,
        perPage,
        format === 'all' ? undefined : format,
        sort as 'newest' | 'oldest'
    );

    return new Response(JSON.stringify({ posts, hasMore, page }), {
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=60',
        },
    });
};
