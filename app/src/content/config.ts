import { defineCollection, z } from 'astro:content';
import { glob, file } from 'astro/loaders';

const posts = defineCollection({
    loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/posts' }),
    schema: z.object({
        title: z.string(),
        subtitle: z.string().optional(),
        format: z.enum(['article', 'short-video', 'video-embed', 'audio', 'audio-playlist', 'quote', 'gallery']),
        status: z.enum(['draft', 'published']).default('draft'),
        date: z.string(),
        tags: z.array(z.string()).default([]),
        author: z.string().optional(),
        thumbnail: z.string().optional(),
        // article
        heroImage: z.string().optional(),
        pattern: z.string().optional(),
        take: z.string().optional(),
        works: z.string().optional(),
        different: z.string().optional(),
        tools: z.array(z.string()).optional(),
        model: z.string().optional(),
        stage: z.enum(['idea', 'building', 'launched', 'profitable', 'active']).optional(),
        verification: z.enum(['unverified', 'partial', 'verified', 'tonys-pick']).optional(),
        needs_tech: z.string().optional(),
        fits_goal: z.array(z.string()).optional(),
        fits_domain: z.array(z.string()).optional(),
        content: z.string().optional(),
        // short-video
        videoUrl: z.string().optional(),
        posterUrl: z.string().optional(),
        duration: z.number().optional(),
        aspectRatio: z.enum(['9:16', '4:5']).optional(),
        // video-embed
        provider: z.enum(['youtube', 'bunny']).optional(),
        videoId: z.string().optional(),
        // audio
        audioUrl: z.string().optional(),
        coverImage: z.string().optional(),
        // audio-playlist
        tracks: z.array(z.object({
            title: z.string(),
            audioUrl: z.string(),
            duration: z.number(),
            artist: z.string().optional(),
        })).optional(),
        // quote
        quoteText: z.string().optional(),
        attribution: z.string().optional(),
        sourceUrl: z.string().optional(),
        // gallery
        images: z.array(z.object({
            url: z.string(),
            caption: z.string().optional(),
        })).optional(),
    }),
});

const tools = defineCollection({
    loader: glob({ pattern: '**/*.json', base: './src/content/tools' }),
    schema: z.object({
        title: z.string(),
        category: z.enum(['llm', 'coding', 'voice', 'image', 'automation', 'no-code', 'productivity']),
        pricing: z.enum(['free', 'freemium', 'usage-based', 'subscription']),
        url: z.string(),
    }),
});

const models = defineCollection({
    loader: glob({ pattern: '**/*.json', base: './src/content/models' }),
    schema: z.object({
        title: z.string(),
        type: z.enum(['b2c', 'b2b', 'hybrid', 'personal']),
        revenue_type: z.enum(['one-time', 'recurring', 'usage', 'project', 'free']),
    }),
});

const builders = defineCollection({
    loader: glob({ pattern: '**/*.json', base: './src/content/builders' }),
    schema: z.object({
        name: z.string(),
        location: z.string(),
        url: z.string().optional(),
        interviewed: z.boolean(),
    }),
});

const stream = defineCollection({
    loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/stream' }),
    schema: z.object({
        type: z.enum(['link', 'post']),
        title: z.string(),
        date: z.string(),
        status: z.enum(['draft', 'published']).default('draft'),
        url: z.string().optional(),
        source: z.string().optional(),
        tags: z.array(z.string()).default([]),
    }),
});

const jokes = defineCollection({
    loader: glob({ pattern: '**/*.md', base: './src/content/jokes' }),
    schema: z.object({
        text: z.string().optional(),
        image: z.string().optional(),
        date: z.string(),
    }),
});

const streamContent = defineCollection({
    loader: glob({ pattern: '**/*.md', base: './src/content/stream-content' }),
    schema: z.object({
        sourceUrl: z.string(),
        fetchedAt: z.string(),
        wordCount: z.number(),
    }),
});

export const collections = { posts, tools, models, builders, stream, jokes, streamContent };
