/**
 * PDF Processing Module
 *
 * Handles PDF uploads via Telegram:
 * 1. Upload to R2 (media.arealisticdreamer.com)
 * 2. Extract content via unpdf (works in CF Workers)
 * 3. Apply chunking strategy based on page count
 * 4. Generate recap
 *
 * Strategy:
 * - < 50 pages: Full extraction → Single recap (sync)
 * - 50-200 pages: TOC + Key sections → Summary (async)
 * - > 200 pages: TOC + First/Last + Sample → Ask user for chapters
 */

import type { Env } from './index';
import type { RecapLang } from './gemini';
import { extractText, getDocumentProxy } from 'unpdf';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface PDFAnalysis {
    pageCount: number;
    title?: string;
    author?: string;
    hasTOC: boolean;
    tocContent?: string;
    estimatedTokens: number;
    strategy: PDFStrategy;
}

export type PDFStrategy = 'full' | 'sections' | 'interactive';

export interface PDFSession {
    id: string;
    chatId: number;
    fileId: string;
    fileName: string;
    r2Url?: string;
    analysis?: PDFAnalysis;
    lang: RecapLang;
    status: 'uploading' | 'analyzing' | 'extracting' | 'recapping' | 'preview' | 'approved' | 'failed';
    selectedChapters?: number[];
    extractedContent?: string;
    recap?: import('./gemini').RecapResult;
    createdAt: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Session Management
// ─────────────────────────────────────────────────────────────────────────────

export async function getPDFSession(
    env: { SESSIONS: KVNamespace },
    sessionId: string,
): Promise<PDFSession | null> {
    const data = await env.SESSIONS.get(`pdf:${sessionId}`);
    return data ? JSON.parse(data) : null;
}

export async function setPDFSession(
    env: { SESSIONS: KVNamespace },
    session: PDFSession,
): Promise<void> {
    await env.SESSIONS.put(`pdf:${session.id}`, JSON.stringify(session), {
        expirationTtl: 7200, // 2 hours for large PDFs
    });
}

export async function deletePDFSession(
    env: { SESSIONS: KVNamespace },
    sessionId: string,
): Promise<void> {
    await env.SESSIONS.delete(`pdf:${sessionId}`);
}

export async function findActivePDFSession(
    env: { SESSIONS: KVNamespace },
    chatId: number,
): Promise<PDFSession | null> {
    const data = await env.SESSIONS.get(`pdf:active:${chatId}`);
    if (!data) return null;
    return getPDFSession(env, data);
}

export async function setActivePDFSession(
    env: { SESSIONS: KVNamespace },
    chatId: number,
    sessionId: string,
): Promise<void> {
    await env.SESSIONS.put(`pdf:active:${chatId}`, sessionId, {
        expirationTtl: 7200,
    });
}

export async function clearActivePDFSession(
    env: { SESSIONS: KVNamespace },
    chatId: number,
): Promise<void> {
    await env.SESSIONS.delete(`pdf:active:${chatId}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF Upload to R2 with hash-based deduplication
// ─────────────────────────────────────────────────────────────────────────────

async function computeHash(data: ArrayBuffer): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function slugifyFilename(fileName: string): string {
    // Remove .pdf extension, slugify, then add back
    const nameWithoutExt = fileName.replace(/\.pdf$/i, '');
    const slug = nameWithoutExt
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // remove diacritics
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 50);
    return slug || 'document';
}

export async function uploadPDFToR2(
    env: Env,
    fileUrl: string,
    fileName: string,
): Promise<string> {
    // Download from Telegram
    const res = await fetch(fileUrl, {
        headers: { 'User-Agent': 'vilab-ingest/1.0' },
    });
    if (!res.ok) {
        throw new Error(`Failed to download PDF: ${res.status}`);
    }
    const data = await res.arrayBuffer();

    // Compute hash for deduplication
    const hash = await computeHash(data);
    const shortHash = hash.slice(0, 8);

    // Friendly filename: slugified-name-hash.pdf
    const slug = slugifyFilename(fileName);
    const key = `pdfs/${slug}-${shortHash}.pdf`;

    // Check if file already exists (same content)
    const existing = await env.MEDIA.head(key);
    if (existing) {
        // File already exists, return existing URL
        return `${env.MEDIA_BASE_URL}/${key}`;
    }

    // Upload
    await env.MEDIA.put(key, data, {
        httpMetadata: { contentType: 'application/pdf' },
        customMetadata: {
            originalName: fileName,
            hash: hash,
            uploadedAt: new Date().toISOString(),
        },
    });

    return `${env.MEDIA_BASE_URL}/${key}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF Analysis via unpdf
// ─────────────────────────────────────────────────────────────────────────────

export async function analyzePDF(pdfUrl: string): Promise<PDFAnalysis> {
    // Download PDF
    const response = await fetch(pdfUrl);
    if (!response.ok) {
        throw new Error(`PDF not accessible: ${response.status} - URL: ${pdfUrl}`);
    }

    const pdfBuffer = await response.arrayBuffer();
    const pdf = await getDocumentProxy(new Uint8Array(pdfBuffer));
    const pageCount = pdf.numPages;

    // Skip text extraction in analysis - it's slow and causes CPU timeout
    // Full extraction happens in queue consumer with 15 min timeout
    // Just estimate based on page count

    // Estimate tokens (rough: 1 page ≈ 500-1000 tokens)
    const estimatedTokens = pageCount * 750;

    // Determine strategy based on page count
    let strategy: PDFStrategy;
    if (pageCount <= 50) {
        strategy = 'full';
    } else if (pageCount <= 200) {
        strategy = 'sections';
    } else {
        strategy = 'interactive';
    }

    return {
        pageCount,
        title: undefined,
        author: undefined,
        hasTOC: false, // Skip TOC detection - not critical
        tocContent: undefined,
        estimatedTokens,
        strategy,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF Content Extraction via unpdf
// ─────────────────────────────────────────────────────────────────────────────

export async function extractPDFContent(
    pdfUrl: string,
    strategy: PDFStrategy,
    pageCount: number,
): Promise<string> {
    // Download PDF
    const response = await fetch(pdfUrl);
    if (!response.ok) {
        throw new Error(`PDF not accessible: ${response.status}`);
    }

    const pdfBuffer = await response.arrayBuffer();
    const pdf = await getDocumentProxy(new Uint8Array(pdfBuffer));

    // Extract text based on strategy
    const { text: fullText } = await extractText(pdf, { mergePages: true });

    switch (strategy) {
        case 'full':
            // Truncate if too long (30k chars ≈ 7-10k tokens)
            if (fullText.length > 30000) {
                return fullText.slice(0, 30000) + '\n\n[... content truncated ...]';
            }
            return fullText;

        case 'sections':
            // Take strategic portions: first 15k + middle 10k + last 10k
            if (fullText.length > 40000) {
                const firstPart = fullText.slice(0, 15000);
                const lastPart = fullText.slice(-10000);
                const middleStart = Math.floor(fullText.length / 2) - 5000;
                const middlePart = fullText.slice(middleStart, middleStart + 10000);
                return `${firstPart}\n\n[... đầu sách ...]\n\n${middlePart}\n\n[... giữa sách ...]\n\n${lastPart}`;
            }
            return fullText;

        case 'interactive':
            // For very large docs, just take first 20k for overview
            if (fullText.length > 20000) {
                return fullText.slice(0, 20000) + `\n\n[... Tài liệu có ${pageCount} trang. Đây là bản tóm tắt từ phần đầu ...]`;
            }
            return fullText;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Format Analysis Result
// ─────────────────────────────────────────────────────────────────────────────

export function formatPDFAnalysis(analysis: PDFAnalysis): string {
    const strategyLabels: Record<PDFStrategy, string> = {
        full: '📄 Full (đọc toàn bộ)',
        sections: '📑 Sections (TOC + key parts)',
        interactive: '🎯 Interactive (chọn chapters)',
    };

    let msg = `📊 <b>PDF Analysis</b>\n\n`;

    if (analysis.title) {
        msg += `📖 <b>Title:</b> ${escapeHtml(analysis.title)}\n`;
    }
    if (analysis.author) {
        msg += `✍️ <b>Author:</b> ${escapeHtml(analysis.author)}\n`;
    }

    msg += `📄 <b>Pages:</b> ${analysis.pageCount}\n`;
    msg += `🔤 <b>Est. tokens:</b> ~${(analysis.estimatedTokens / 1000).toFixed(0)}k\n`;
    msg += `📋 <b>Has TOC:</b> ${analysis.hasTOC ? 'Yes' : 'No'}\n`;
    msg += `\n⚙️ <b>Strategy:</b> ${strategyLabels[analysis.strategy]}`;

    if (analysis.strategy === 'sections') {
        msg += `\n\n💡 Tài liệu khá dài, sẽ extract TOC + key sections để recap.`;
    } else if (analysis.strategy === 'interactive') {
        msg += `\n\n💡 Tài liệu rất dài (${analysis.pageCount} trang). Bạn có thể:`;
        msg += `\n• Reply "recap" để tạo overview từ đầu sách`;
        msg += `\n• Reply số chapter (VD: "1,3,5") để focus vào chapters cụ thể`;
    }

    return msg;
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
