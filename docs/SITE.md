# TheFeed Site Architecture

## Tech Stack

### Frontend (app/)
- **Astro 5** - SSR mode
- **Tailwind CSS 4** - styling
- **Cloudflare Pages** - hosting via `@astrojs/cloudflare`
- **MDX** - content format

### Workers
- **thefeed-ingest** (`workers/ingest/`) - content ingestion pipeline
  - Endpoints: `POST /ingest`, `GET /health`, `/telegram/:token`, `GET /preview/:sessionId`
  - Flow: Source → media upload to R2 → MDX generation → push to draft branch
  - Bindings: R2 bucket, KV sessions, GitHub token, AI API

### Storage
- **R2 bucket** → CDN: `media.your-domain.com`

### Git Workflow
- `main` - production, auto-deploy on push
- `draft` - content staging, triggers `process-drafts.yml`

GitHub Actions:
- `deploy.yml` - deploys app and/or worker on main push (path-filtered)
- `process-drafts.yml` - processes draft MDX files → calls ingest worker

## Content Collections

### posts (`app/src/content/posts/*.mdx`)
```yaml
title: string (required)
subtitle: string
format: article | short-video | video-embed | audio | audio-playlist | quote | gallery
status: draft | published
date: string (YYYY-MM-DD)
tags: string[]
thumbnail: string

# article format
heroImage: string
pattern: string
take: string
tools: string[]
model: string
stage: idea | building | launched | profitable | active

# short-video format
videoUrl: string
posterUrl: string
duration: number
aspectRatio: 9:16 | 4:5

# video-embed format
provider: youtube | bunny
videoId: string

# audio format
audioUrl: string
coverImage: string

# audio-playlist format
tracks: [{title, audioUrl, duration, artist?}]

# quote format
quoteText: string
attribution: string
sourceUrl: string

# gallery format
images: [{url, caption?}]
```

### jokes (`app/src/content/jokes/*.md`)
```yaml
text: string
image: string
date: string (YYYY-MM-DD)
```

### stream (`app/src/content/stream/*.mdx`)
```yaml
type: link | post
title: string
date: string (ISO)
status: draft | published
url: string
source: github | youtube | website
tags: string[]
```

### tools (`app/src/content/tools/*.json`)
```json
{"title": "", "category": "llm|coding|voice|image|automation|no-code|productivity", "pricing": "free|freemium|usage-based|subscription", "url": ""}
```

### models (`app/src/content/models/*.json`)
```json
{"title": "", "type": "b2c|b2b|hybrid|personal", "revenue_type": "one-time|recurring|usage|project|free"}
```

### builders (`app/src/content/builders/*.json`)
```json
{"name": "", "location": "", "url": "", "interviewed": false}
```

## Posting Content

### Manual (posts)
1. Create `app/src/content/posts/{slug}.mdx`
2. Add frontmatter with required fields
3. Commit to main → auto-deploy

### Via Ingest Worker
```bash
curl -X POST https://your-worker.workers.dev/ingest \
  -H "Authorization: Bearer $INGEST_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "my-post",
    "format": "article",
    "frontmatter": {"title": "My Post", "status": "published", "date": "2025-01-15"},
    "body": "Content here...",
    "media": [{"field": "heroImage", "sourceUrl": "https://...", "filename": "hero.webp"}]
  }'
```

### Via Telegram Bot
1. Send photo/text → select type → confirm → publish
2. Send URL → AI recap generated → approve → publishes to draft

### Draft Branch Flow
1. Push MDX with `status: draft` to `draft` branch
2. `process-drafts.yml` runs
3. External images uploaded to R2
4. Content committed back

## Local Dev

```bash
cd app
npm run dev        # Local development
npm run build      # Production build
```
