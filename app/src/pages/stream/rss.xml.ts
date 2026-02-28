import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getStream } from '../../lib/data';

export async function GET(context: APIContext) {
    const items = await getStream();

    return rss({
        title: 'A Realistic Dreamer — Stream',
        description: 'Cập nhật nhanh — tin tức, suy nghĩ, và link hay mỗi ngày về AI automation và vibe coding.',
        site: context.site!.toString(),
        items: items.map((item) => ({
            title: item.title,
            pubDate: new Date(item.date),
            description: item.body || '',
            link: `/stream/${item.slug}`,
            categories: item.tags,
            ...(item.type === 'link' && item.url
                ? { customData: `<source url="${item.url}">${item.source || ''}</source>` }
                : {}),
        })),
        customData: '<language>vi</language>',
    });
}
