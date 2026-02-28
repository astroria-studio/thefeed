# TheFeed Quick Start

## 1. Configure

```bash
cp thefeed.config.example.ts thefeed.config.ts
```

Edit `thefeed.config.ts`:
```ts
site: {
  name: "Your Site",
  url: "https://your-domain.com",
  // ...
}
```

## 2. Install & Run

```bash
cd app
npm install
npm run dev
```

Visit `http://localhost:4321`

## 3. Create Content

### Option A: Manual
Create `app/src/content/posts/my-post.mdx`:
```yaml
---
title: "My First Post"
format: article
status: published
date: "2025-01-15"
tags: ["hello"]
---

Your content here...
```

### Option B: AI-Assisted
```
/brand              # Set up brand guidelines
/content-new "topic" # Create post with AI
```

## 4. Deploy

Push to main → Cloudflare auto-deploys.

## Key Paths

| Path | Content |
|------|---------|
| `app/src/content/posts/` | Articles, videos, quotes |
| `app/src/content/stream/` | Quick posts, links |
| `app/src/content/jokes/` | Daily jokes |
| `thefeed.config.ts` | Site settings |

## Commands

```bash
npm run dev    # Local development
npm run build  # Production build
```

## AI Skills

| Skill | What it does |
|-------|--------------|
| `/brand` | Create brand guidelines |
| `/content-new "topic"` | Full content pipeline |

## Docs

- [Full Install Guide](docs/INSTALL.md)
- [Customization](docs/CUSTOMIZE.md)
- [AI Agent Guide](.agent/AGENT.md)
