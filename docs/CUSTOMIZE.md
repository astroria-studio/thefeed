# TheFeed Customization Guide

## Configuration

All site settings in `thefeed.config.ts`:

```ts
const config = {
  site: {
    name: "Site Name",           // Header, titles
    tagline: "Short tagline",    // Subtitle, meta
    description: "Longer desc",  // SEO description
    url: "https://...",          // Canonical URL
    mediaUrl: "https://...",     // R2 bucket URL
    locale: "en",                // en or vi
    author: "Your Name",         // Footer attribution
  },
  github: {
    repo: "user/repo",           // For content commits
    branch: "main",              // Deploy branch
  },
  features: {
    jokes: true,                 // Show /jokes page
    stream: true,                // Show /stream page
    search: true,                // Enable search modal
  },
  social: {
    twitter: "@handle",
    telegram: "channel",
    youtube: "channel",
    github: "username",
  },
};
```

## Branding

### Colors
Edit CSS variables in `app/src/styles/app.css`:

```css
:root {
  --color-accent: #2563eb;       /* Primary accent */
  --color-ink: #1a1a1a;          /* Text color */
  --color-soft: #6b7280;         /* Secondary text */
  --color-faint: #9ca3af;        /* Muted text */
  --color-border: #e5e7eb;       /* Borders */
  --color-card: #ffffff;         /* Card backgrounds */
}
```

### Fonts
Fonts loaded in `BaseLayout.astro`. Default: Inter + Lora.

### Favicon
Replace `app/public/favicon.png`

## Content Types

### Posts (`content/posts/*.mdx`)

7 formats supported:

#### Article
```yaml
---
title: "Post Title"
subtitle: "Optional subtitle"
format: article
status: published
date: "2025-01-15"
tags: ["tag1", "tag2"]
heroImage: "https://..."
tools: ["claude", "cursor"]
---
MDX content here...
```

#### Video Embed
```yaml
---
title: "Video Title"
format: video-embed
status: published
date: "2025-01-15"
provider: youtube
videoId: "dQw4w9WgXcQ"
duration: 180
---
```

#### Audio
```yaml
---
title: "Podcast Episode"
format: audio
status: published
date: "2025-01-15"
audioUrl: "https://.../episode.mp3"
coverImage: "https://.../cover.jpg"
duration: 1800
---
```

#### Quote
```yaml
---
title: "Quote Title"
format: quote
status: published
date: "2025-01-15"
quoteText: "The actual quote text"
attribution: "Author Name"
---
```

#### Gallery
```yaml
---
title: "Photo Gallery"
format: gallery
status: published
date: "2025-01-15"
images:
  - url: "https://.../img1.jpg"
    caption: "First image"
  - url: "https://.../img2.jpg"
---
```

### Stream (`content/stream/*.mdx`)

```yaml
---
type: link        # or 'post'
title: "Interesting article"
date: "2025-01-15"
status: published
url: "https://..."  # for type: link
source: "twitter"   # optional
tags: ["ai"]
---
Optional commentary...
```

### Jokes (`content/jokes/*.md`)

```yaml
---
text: "Why did the developer quit? No arrays."
date: "2025-01-15"
---
```

Or image joke:
```yaml
---
image: "https://.../meme.jpg"
date: "2025-01-15"
---
```

### Tools (`content/tools/*.json`)

```json
{
  "title": "Tool Name",
  "category": "llm",
  "pricing": "freemium",
  "url": "https://..."
}
```

Categories: `llm`, `coding`, `voice`, `image`, `automation`, `no-code`, `productivity`

### Models (`content/models/*.json`)

```json
{
  "title": "B2B SaaS",
  "type": "b2b",
  "revenue_type": "recurring"
}
```

Types: `b2c`, `b2b`, `hybrid`, `personal`
Revenue: `one-time`, `recurring`, `usage`, `project`, `free`

### Builders (`content/builders/*.json`)

```json
{
  "name": "Author Name",
  "location": "City, Country",
  "url": "https://...",
  "interviewed": true
}
```

## Disabling Features

In `thefeed.config.ts`:
```ts
features: {
  jokes: false,    // Removes /jokes route
  stream: false,   // Removes /stream route
  search: false,   // Removes search modal
}
```

## Adding Pages

Create new `.astro` files in `app/src/pages/`:

```astro
---
import BaseLayout from "../layouts/BaseLayout.astro";
---
<BaseLayout title="New Page">
  <h1>Your content</h1>
</BaseLayout>
```
