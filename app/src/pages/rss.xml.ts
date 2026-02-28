import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getPosts } from '../lib/data';

export async function GET(context: APIContext) {
    const posts = await getPosts();

    return rss({
        title: 'A Realistic Dreamer',
        description: 'Chia sẻ process thật về AI automation và vibe coding — từ nghiên cứu đến ứng dụng mỗi ngày.',
        site: context.site!.toString(),
        items: posts.map((post) => ({
            title: post.title,
            pubDate: new Date(post.date),
            description: post.subtitle || '',
            link: `/${post.slug}`,
        })),
        customData: '<language>vi</language>',
    });
}
