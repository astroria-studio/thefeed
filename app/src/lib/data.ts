import { getCollection } from 'astro:content';
import { marked } from 'marked';
import type { Post, ArticlePost, ShortVideoPost, VideoEmbedPost, AudioPost, AudioPlaylistPost, QuotePost, GalleryPost, Tool, Model, Builder, StreamItem } from './types';

// ==============================
// Posts — from Content Collections
// ==============================

export async function getPosts(format?: string): Promise<Post[]> {
  const entries = await getCollection('posts', (entry) => entry.data.status === 'published');
  let posts: Post[] = entries.map(entry => {
    const d = entry.data;
    const base = {
      slug: entry.id.replace(/\.mdx?$/, ''),
      title: d.title,
      subtitle: d.subtitle,
      format: d.format,
      status: d.status,
      date: d.date,
      tags: d.tags || [],
      author: d.author,
      thumbnail: d.thumbnail,
    };
    switch (d.format) {
      case 'article':
        return {
          ...base,
          format: 'article' as const,
          heroImage: d.heroImage,
          pattern: d.pattern,
          take: d.take || '',
          works: d.works || '',
          different: d.different || '',
          content: d.content,
          tools: d.tools || [],
          model: d.model || '',
          stage: d.stage || 'idea',
          verification: d.verification || 'unverified',
          needs_tech: d.needs_tech,
          fits_goal: d.fits_goal,
          fits_domain: d.fits_domain,
        } as ArticlePost;
      case 'short-video':
        return {
          ...base,
          format: 'short-video' as const,
          videoUrl: d.videoUrl || '',
          posterUrl: d.posterUrl,
          duration: d.duration || 0,
          aspectRatio: d.aspectRatio,
        } as ShortVideoPost;
      case 'video-embed':
        return {
          ...base,
          format: 'video-embed' as const,
          provider: d.provider || 'youtube',
          videoId: d.videoId || '',
          duration: d.duration,
        } as VideoEmbedPost;
      case 'audio':
        return {
          ...base,
          format: 'audio' as const,
          audioUrl: d.audioUrl || '',
          duration: d.duration || 0,
          coverImage: d.coverImage,
        } as AudioPost;
      case 'audio-playlist':
        return {
          ...base,
          format: 'audio-playlist' as const,
          tracks: d.tracks || [],
          coverImage: d.coverImage,
        } as AudioPlaylistPost;
      case 'quote':
        return {
          ...base,
          format: 'quote' as const,
          quoteText: d.quoteText || '',
          attribution: d.attribution,
          sourceUrl: d.sourceUrl,
        } as QuotePost;
      case 'gallery':
        return {
          ...base,
          format: 'gallery' as const,
          images: d.images || [],
        } as GalleryPost;
      default:
        return base as Post;
    }
  });
  if (format && format !== 'all') {
    posts = posts.filter(p => p.format === format);
  }
  return posts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export async function getPostsPaginated(
  page: number = 1,
  perPage: number = 10,
  format?: string,
  sort: 'newest' | 'oldest' = 'newest'
): Promise<{ posts: Post[]; hasMore: boolean }> {
  let all = await getPosts(format);

  // Sort by date
  if (sort === 'oldest') {
    all = [...all].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }
  // 'newest' is already the default order from getPosts

  const start = (page - 1) * perPage;
  const posts = all.slice(start, start + perPage);
  return { posts, hasMore: start + perPage < all.length };
}

export async function getPost(slug: string): Promise<Post | undefined> {
  const all = await getPosts();
  return all.find(p => p.slug === slug);
}

export async function getPostsByTag(tag: string): Promise<Post[]> {
  const all = await getPosts();
  return all.filter(p => p.tags.includes(tag));
}

// ==============================
// Articles (legacy: "cases")
// ==============================

export async function getCases(): Promise<ArticlePost[]> {
  return (await getPosts('article')) as ArticlePost[];
}

export async function getCase(slug: string): Promise<ArticlePost | undefined> {
  const post = await getPost(slug);
  return post?.format === 'article' ? post as ArticlePost : undefined;
}

// ==============================
// Tools — from Content Collections (data)
// ==============================

export async function getTools(): Promise<Tool[]> {
  const entries = await getCollection('tools');
  return entries.map(e => ({ slug: e.id.replace(/\.json$/, ''), ...e.data }));
}

export async function getTool(slug: string): Promise<Tool | undefined> {
  const tools = await getTools();
  return tools.find(t => t.slug === slug);
}

// ==============================
// Models — from Content Collections (data)
// ==============================

export async function getModels(): Promise<Model[]> {
  const entries = await getCollection('models');
  return entries.map(e => ({ slug: e.id.replace(/\.json$/, ''), ...e.data }));
}

export async function getModel(slug: string): Promise<Model | undefined> {
  const models = await getModels();
  return models.find(m => m.slug === slug);
}

// ==============================
// Builders — from Content Collections (data)
// ==============================

export async function getBuilders(): Promise<Builder[]> {
  const entries = await getCollection('builders');
  return entries.map(e => ({ slug: e.id.replace(/\.json$/, ''), ...e.data }));
}

export async function getBuilder(slug: string): Promise<Builder | undefined> {
  const builders = await getBuilders();
  return builders.find(b => b.slug === slug);
}

// ==============================
// Relations & Filters
// ==============================

export async function getCasesByTool(toolSlug: string): Promise<ArticlePost[]> {
  const cases = await getCases();
  return cases.filter(c => c.tools.includes(toolSlug));
}

export async function getCasesByModel(modelSlug: string): Promise<ArticlePost[]> {
  const cases = await getCases();
  return cases.filter(c => c.model === modelSlug);
}

export async function getFilterOptions() {
  const cases = await getCases();
  const tools = new Set<string>();
  const models = new Set<string>();
  const stages = new Set<string>();

  cases.forEach(c => {
    c.tools.forEach(t => tools.add(t));
    models.add(c.model);
    stages.add(c.stage);
  });

  return {
    tools: Array.from(tools),
    models: Array.from(models),
    stages: Array.from(stages),
  };
}

// ==============================
// Stream — Social update items
// ==============================

export async function getStream(type?: string): Promise<StreamItem[]> {
  const entries = await getCollection('stream', (entry) => entry.data.status === 'published');
  let items: StreamItem[] = await Promise.all(entries.map(async (entry) => {
    const d = entry.data;
    let body: string | undefined;
    if (entry.body && entry.body.trim()) {
      // Use marked to parse markdown body into full HTML
      body = await marked.parse(entry.body.trim());
    }
    return {
      slug: entry.id.replace(/\.mdx?$/, ''),
      type: d.type,
      title: d.title,
      date: d.date,
      status: d.status,
      url: d.url,
      source: d.source,
      tags: d.tags || [],
      body,
    } as StreamItem;
  }));
  if (type && type !== 'all') {
    items = items.filter(i => i.type === type);
  }
  return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export async function getStreamPaginated(page: number = 1, perPage: number = 10, type?: string): Promise<{ items: StreamItem[]; hasMore: boolean }> {
  const all = await getStream(type);
  const start = (page - 1) * perPage;
  const items = all.slice(start, start + perPage);
  return { items, hasMore: start + perPage < all.length };
}

export async function getStreamItem(slug: string): Promise<StreamItem | undefined> {
  const all = await getStream();
  return all.find(i => i.slug === slug);
}

