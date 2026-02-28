# TheFeed AI Agent Guide

AI-assisted content production for TheFeed.

## Quick Reference

| Command | Purpose |
|---------|---------|
| `/brand` | Create brand guidelines |
| `/content-new "topic"` | Full content pipeline |
| `/onboard` | Initial site setup |

## Commands

Located in `.claude/commands/`:

| Command | What it does |
|---------|--------------|
| `/onboard` | Site setup: config check → brand foundation → content setup |
| `/content-new "topic"` | Research → brief → write → audit → images → publish |

## Skills

Located in `.claude/skills/`:

| Skill | Trigger | Purpose |
|-------|---------|---------|
| brand-foundation-builder | `/brand` | Create brand docs (voice, visual, audience, pillars) |
| keyword-research | Used by content-new | 6 Circles Method keyword research |
| seo-content-brief | Used by content-new | SERP analysis, outline, word count |
| content-research-writer | Used by content-new | Writing partner with citations |
| seo-content-auditor | Used by content-new | SEO/E-E-A-T audit, brand compliance |
| nano-banana-prompt-generator | `/image`, used by content-new | JSON prompts for Nano Banana Pro |

## Brand Docs (Central Location)

**Path:** `app/src/content/brand/`

| File | Purpose | Used By |
|------|---------|---------|
| brand-voice.md | Tone, writing style | content-research-writer, seo-content-auditor |
| visual-style.md | Colors, mood, image style | nano-banana-prompt-generator |
| audience-profiles.md | Target segments | keyword-research |
| content-pillars.md | Core themes | content-new |

## Content Pipeline

```
/brand           → Create brand foundation (run once)
/content-new "topic"  → Full pipeline:
    1. Load brand docs
    2. keyword-research → keywords
    3. seo-content-brief → outline
    4. content-research-writer → draft
    5. seo-content-auditor → review
    6. nano-banana-prompt-generator → images
    7. Publish
```

## Post Frontmatter

```yaml
---
title: "Post Title"
subtitle: "Optional subtitle"
format: article
status: draft
date: "2025-01-15"
tags: ["tag1", "tag2"]
heroImage: "https://..."
tools: ["claude", "cursor"]
---
```

## Formats

| Format | Key Fields |
|--------|------------|
| article | heroImage, MDX body |
| video-embed | provider, videoId |
| audio | audioUrl, duration |
| quote | quoteText, attribution |
| gallery | images array |
