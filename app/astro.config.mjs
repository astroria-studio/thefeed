// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import mdx from '@astrojs/mdx';
import robotsTxt from 'astro-robots-txt';
import { astroImageTools } from 'astro-imagetools';
import { readdirSync } from 'node:fs';
import config from '../thefeed.config.ts';

const edition = process.env.EDITION || 'global';
const siteUrl = config.site.url;

// Generate custom sitemap pages from content/posts (SSR routes not auto-discovered)
const postFiles = readdirSync(new URL('./src/content/posts', import.meta.url));
const postPages = postFiles
  .filter(f => f.endsWith('.mdx') || f.endsWith('.md'))
  .map(f => `${siteUrl}/${f.replace(/\.mdx?$/, '')}`);

export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    platformProxy: {
      enabled: false,
    },
    sessionKVBindingName: undefined,
  }),
  site: siteUrl,
  integrations: [
    mdx(),
    sitemap({ customPages: postPages }),
    robotsTxt(),
    astroImageTools,
  ],
  vite: {
    plugins: [tailwindcss()],
    define: {
      'import.meta.env.EDITION': JSON.stringify(edition),
    },
  },
});
