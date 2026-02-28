import { getPosts } from "../../lib/data";

export async function GET() {
    const posts = await getPosts();

    const searchIndex = posts
        .filter(post => post.status === 'published')
        .map(post => ({
            slug: post.slug,
            title: post.title,
            subtitle: post.subtitle || "",
            format: post.format,
            date: post.date,
            tags: post.tags || []
        }));

    return new Response(JSON.stringify(searchIndex), {
        status: 200,
        headers: {
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=3600",
        }
    });
}
