# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Frontend (Astro)
cd app && npm run dev           # Local dev (EDITION=global)
cd app && npm run dev:vn        # Vietnamese edition
cd app && npm run build         # Production build
cd app && npm run deploy        # Build + deploy to Cloudflare

# Ingest Worker
cd workers/ingest && npm install
cd workers/ingest && npx wrangler dev    # Local dev
cd workers/ingest && npx wrangler deploy # Deploy
```

## Architecture

```
thefeed/
├── app/                        # Astro SSR frontend (Cloudflare Pages)
│   ├── src/content/            # Content collections (posts, stream, tools, etc.)
│   ├── src/lib/data.ts         # Data access layer for all collections
│   ├── src/lib/types.ts        # TypeScript types for posts
│   ├── src/pages/api/          # API routes (search, feed, match)
│   └── astro.config.mjs        # Reads from ../thefeed.config.ts
├── workers/ingest/             # Telegram bot + AI ingest worker
│   └── src/
│       ├── telegram.ts         # Bot command handling
│       ├── gemini.ts           # AI content generation
│       ├── github.ts           # Commit to repo
│       └── queue.ts            # Async task processing
├── .agent/                     # AI skills & workflows
│   └── AGENT.md                # Skill documentation
└── thefeed.config.ts           # Central site configuration
```

## Content System

**Collections** (defined in `app/src/content/config.ts`):
- `posts/` — MDX, 7 formats: article, video-embed, short-video, audio, audio-playlist, quote, gallery
- `stream/` — MDX, types: link, post
- `jokes/` — MD, daily jokes
- `tools/`, `models/`, `builders/` — JSON reference data

**Post format-specific fields**:
- article: heroImage, tools[], model, stage, verification
- video-embed: provider (youtube|bunny), videoId
- short-video: videoUrl, posterUrl, aspectRatio
- audio: audioUrl, coverImage, duration
- audio-playlist: tracks[]
- quote: quoteText, attribution
- gallery: images[]

**Publishing**: Set `status: published` in frontmatter, commit to main.

## Multi-Edition Support

The app supports multiple editions via `EDITION` env var:
- `global` (default) — Main site
- `vn` — Vietnamese edition

Edition affects build output and wrangler config.

## AI Skills

Run `/brand` for brand setup, `/content-new "topic"` for content pipeline. See `.agent/AGENT.md` for full list.

## Worker Secrets

Set via `wrangler secret put`:
- `GITHUB_TOKEN` — Repo write access
- `TELEGRAM_TOKEN` — Bot token
- `GEMINI_API_KEY` — For AI content generation
