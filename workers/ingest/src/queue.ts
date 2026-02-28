/**
 * Queue Handler — Async AI task processing with 15 minute timeout.
 *
 * Flow:
 * 1. Telegram handler queues AI task
 * 2. Queue consumer picks up task (15 min timeout)
 * 3. Generate recap via MiniMax
 * 4. Update session in KV
 * 5. Send result to Telegram
 */

import type { Env, AITaskMessage } from './index';
import {
    getStreamSession,
    setStreamSession,
    clearActiveStreamSession,
    generateStreamRecap,
    formatRecapPreview,
} from './stream';
import {
    getPDFSession,
    setPDFSession,
    clearActivePDFSession,
    extractPDFContent,
} from './pdf';
import { generateRecap } from './gemini';

// Telegram API helper
async function sendTelegramMessage(
    token: string,
    chatId: number,
    text: string,
    extra?: Record<string, unknown>,
): Promise<void> {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, ...extra }),
    });
}

/**
 * Process an AI task from the queue.
 * Has 15 minutes to complete (queue consumer timeout).
 */
export async function processAITask(task: AITaskMessage, env: Env): Promise<void> {
    console.log(`Processing AI task: ${task.type} for session ${task.sessionId}`);

    switch (task.type) {
        case 'stream_recap':
            await processStreamRecap(task, env);
            break;
        case 'pdf_recap':
            await processPDFRecap(task, env);
            break;
        default:
            console.error(`Unknown task type: ${(task as AITaskMessage).type}`);
    }
}

async function processStreamRecap(task: AITaskMessage, env: Env): Promise<void> {
    const session = await getStreamSession(env, task.sessionId);
    if (!session) {
        console.error(`Stream session not found: ${task.sessionId}`);
        return;
    }

    if (!session.rawContent) {
        console.error(`No raw content in session: ${task.sessionId}`);
        await sendTelegramMessage(env.TELEGRAM_TOKEN, task.chatId, '❌ No content to recap');
        return;
    }

    try {
        // Generate recap (this is the slow part - can take 30-60s)
        const recap = await generateStreamRecap(env, session);

        // Update session with recap
        session.status = 'preview';
        session.recap = recap;
        await setStreamSession(env, session);

        // Send preview to Telegram
        const { text: previewText, parse_mode } = formatRecapPreview(recap);
        const previewUrl = `https://vilab-ingest.bnqtoan.workers.dev/preview/${session.id}`;

        await sendTelegramMessage(env.TELEGRAM_TOKEN, task.chatId, previewText, {
            parse_mode,
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '✅ Approve', callback_data: `stream:approve:${session.id}` },
                        { text: '🔄 Regenerate', callback_data: `stream:regenerate:${session.id}` },
                    ],
                    [
                        { text: '📄 View Full', url: previewUrl },
                        { text: '❌ Cancel', callback_data: `stream:cancel:${session.id}` },
                    ],
                ],
            },
        });

        console.log(`Stream recap completed for session ${task.sessionId}`);

    } catch (err) {
        console.error(`Stream recap failed:`, err);

        // Update session status
        session.status = 'failed';
        await setStreamSession(env, session);
        await clearActiveStreamSession(env, task.chatId);

        const message = err instanceof Error ? err.message : 'Unknown error';
        await sendTelegramMessage(env.TELEGRAM_TOKEN, task.chatId, `❌ Recap failed: ${message}`);
    }
}

async function processPDFRecap(task: AITaskMessage, env: Env): Promise<void> {
    const session = await getPDFSession(env, task.sessionId);
    if (!session) {
        console.error(`PDF session not found: ${task.sessionId}`);
        return;
    }

    if (!session.r2Url || !session.analysis) {
        console.error(`PDF not analyzed: ${task.sessionId}`);
        await sendTelegramMessage(env.TELEGRAM_TOKEN, task.chatId, '❌ PDF not analyzed');
        return;
    }

    try {
        // Extract content if not already done (this can be slow for large PDFs)
        let content = session.extractedContent;
        if (!content) {
            console.log(`Extracting PDF content for session ${task.sessionId}`);
            content = await extractPDFContent(
                session.r2Url,
                session.analysis.strategy,
                session.analysis.pageCount,
            );
            session.extractedContent = content;
            await setPDFSession(env, session);
        }

        console.log(`Generating recap for ${content.length} chars`);

        // Generate recap (this is the slow part)
        // Use PDF filename (without extension) as fallback title
        const fallbackTitle = session.fileName.replace(/\.pdf$/i, '').replace(/[-_]/g, ' ');
        const recap = await generateRecap(env, content, session.lang, fallbackTitle);

        // Update session
        session.status = 'preview';
        session.recap = recap;
        await setPDFSession(env, session);

        // Send preview
        const { text: previewText, parse_mode } = formatRecapPreview(recap);
        const previewUrl = `https://vilab-ingest.bnqtoan.workers.dev/preview/${session.id}`;

        await sendTelegramMessage(env.TELEGRAM_TOKEN, task.chatId, previewText, {
            parse_mode,
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '✅ Approve', callback_data: `pdf:approve:${session.id}` },
                        { text: '🔄 Regenerate', callback_data: `pdf:regenerate:${session.id}` },
                    ],
                    [
                        { text: '📄 View Full', url: previewUrl },
                        { text: '❌ Cancel', callback_data: `pdf:cancel:${session.id}` },
                    ],
                ],
            },
        });

        console.log(`PDF recap completed for session ${task.sessionId}`);

    } catch (err) {
        console.error(`PDF recap failed:`, err);

        session.status = 'failed';
        await setPDFSession(env, session);
        await clearActivePDFSession(env, task.chatId);

        const message = err instanceof Error ? err.message : 'Unknown error';
        await sendTelegramMessage(env.TELEGRAM_TOKEN, task.chatId, `❌ PDF recap failed: ${message}`);
    }
}
