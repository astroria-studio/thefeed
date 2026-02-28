# TheFeed Installation Guide

## Prerequisites

- Node.js 20+
- GitHub account
- Cloudflare account (free tier works)
- (Optional) Telegram bot token for content ingestion

## Quick Start

### 1. Clone & Configure

```bash
git clone https://github.com/your-username/thefeed.git
cd thefeed
cp thefeed.config.example.ts thefeed.config.ts
```

Edit `thefeed.config.ts`:
```ts
const config = {
  site: {
    name: "Your Site Name",
    tagline: "Your tagline",
    url: "https://your-domain.com",
    mediaUrl: "https://media.your-domain.com",
    // ...
  },
  // ...
};
```

### 2. Install Dependencies

```bash
cd app
npm install
```

### 3. Cloudflare Setup

#### Pages (Frontend)
1. Go to Cloudflare Dashboard → Pages
2. Create project → Connect to Git
3. Select your repo, set:
   - Build command: `npm run build`
   - Build output: `dist`
   - Root directory: `app`
4. Add custom domain

#### R2 (Media Storage)
1. Go to R2 → Create bucket
2. Name: `media` (or your choice)
3. Set up custom domain: `media.your-domain.com`
4. Configure CORS if needed

#### KV (Optional - for ingest worker)
1. Go to Workers & Pages → KV
2. Create namespace: `INGEST_KV`

### 4. Environment Variables

In Cloudflare Pages settings, add:
- `GITHUB_TOKEN` - Personal access token with repo write
- `TELEGRAM_BOT_TOKEN` - (Optional) For Telegram publishing

### 5. Deploy

Push to main branch - Cloudflare auto-deploys.

```bash
git add .
git commit -m "Initial setup"
git push
```

## Ingest Worker (Optional)

For Telegram content publishing:

```bash
cd workers/ingest
cp wrangler.example.toml wrangler.toml
# Edit wrangler.toml with your account details
npm install
npx wrangler deploy
```

Set secrets:
```bash
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put TELEGRAM_BOT_TOKEN
```

## Local Development

```bash
cd app
npm run dev
```

Visit `http://localhost:4321`

## Content Structure

```
app/src/content/
├── posts/          # Articles, videos, audio, quotes, galleries
├── stream/         # Quick posts and links
├── jokes/          # Daily jokes
├── tools/          # Tool references
├── models/         # Business model references
└── builders/       # Author profiles
```

See `docs/CUSTOMIZE.md` for content schemas and customization.
