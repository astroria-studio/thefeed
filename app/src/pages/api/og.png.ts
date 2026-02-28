/**
 * Dynamic OG Image Generation API
 *
 * Usage: /api/og.png?title=...&subtitle=...&type=...
 * Returns 1200x630 PNG image for social sharing
 *
 * Caching: Images are cached by Cloudflare CDN for 1 year (immutable)
 */
import type { APIRoute } from 'astro';
import { ImageResponse, loadGoogleFont } from 'workers-og';
import config from '../../../../thefeed.config';

// Common Vietnamese characters + punctuation to always include in font
const VI_CHARS = 'àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐ"\"\'—–';

const siteName = config.site.name;
const siteUrl = config.site.url;
const domain = siteUrl.replace(/^https?:\/\//, '');

export const GET: APIRoute = async ({ request }) => {
    const url = new URL(request.url);
    const title = url.searchParams.get('title') || siteName;
    const subtitle = url.searchParams.get('subtitle') || '';
    const type = url.searchParams.get('type') || 'website';
    const tags = url.searchParams.get('tags')?.split(',').filter(Boolean) || [];

    // Type label
    const typeLabels: Record<string, string> = {
        article: 'ARTICLE',
        stream: 'STREAM',
        joke: 'DAD JOKE',
        tool: 'TOOL',
        website: '',
    };
    const typeLabel = typeLabels[type] || '';

    // Calculate font size based on title length
    const fontSize = title.length > 80 ? 40 : title.length > 60 ? 46 : title.length > 40 ? 52 : 58;

    // Build HTML template
    const tagsHtml = tags.length > 0
        ? tags.slice(0, 3).map(tag =>
            `<div style="display:flex;font-size:16px;padding:6px 16px;border-radius:100px;background:rgba(167,139,250,0.15);color:#a78bfa;">${escapeHtml(tag)}</div>`
          ).join('')
        : '';

    const html = `
        <div style="display:flex;flex-direction:column;justify-content:space-between;width:1200px;height:630px;padding:56px 72px;background:linear-gradient(160deg, #18181b 0%, #1e1b4b 50%, #27272a 100%);font-family:'Noto Sans',sans-serif;">
            <div style="display:flex;flex-direction:column;align-items:flex-start;">
                <div style="display:flex;font-size:26px;font-weight:600;color:#a78bfa;margin-bottom:28px;letter-spacing:0.02em;">${escapeHtml(siteName)}</div>
                ${typeLabel ? `<div style="display:flex;font-size:14px;font-weight:600;letter-spacing:0.1em;color:#a78bfa;margin-bottom:16px;">${escapeHtml(typeLabel)}</div>` : ''}
                <span style="font-size:${fontSize}px;font-weight:700;color:#fafafa;line-height:1.3;letter-spacing:-0.02em;word-break:break-word;">${escapeHtml(title)}</span>
                ${subtitle ? `<span style="font-size:22px;font-weight:400;color:#a1a1aa;margin-top:20px;line-height:1.5;">${escapeHtml(subtitle)}</span>` : ''}
            </div>
            <div style="display:flex;flex-direction:row;align-items:center;width:100%;padding-top:24px;border-top:1px solid #3f3f46;">
                <div style="display:flex;flex:1;font-size:20px;font-weight:500;color:#71717a;">${domain}</div>
                ${tags.length > 0 ? `<div style="display:flex;flex-direction:row;gap:8px;">${tagsHtml}</div>` : ''}
            </div>
        </div>
    `;

    try {
        // Load font with Vietnamese support - include all chars used
        const textToRender = VI_CHARS + siteName + title + subtitle + typeLabel + tags.join('') + domain;
        const font = await loadGoogleFont({
            family: 'Noto Sans',
            weight: 700,
            text: textToRender,
        });

        // @ts-ignore - fonts option exists but not in types
        const response = new ImageResponse(html, {
            width: 1200,
            height: 630,
            format: 'png',
            fonts: [
                {
                    name: 'Noto Sans',
                    data: font,
                    weight: 700,
                    style: 'normal',
                },
            ],
        });

        // Add caching headers
        response.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
        response.headers.set('CDN-Cache-Control', 'public, max-age=31536000, immutable');

        return response;
    } catch (error) {
        console.error('OG image generation error:', error);
        return new Response('Error generating image', { status: 500 });
    }
};

function escapeHtml(str: string): string {
    return str
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
