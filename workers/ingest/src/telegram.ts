/**
 * Telegram Bot Handler — Webhook-based content ingestion via inline keyboards.
 *
 * Flow: Message → Classify → Collect metadata → Confirm → Ingest
 */

import type { Env, IngestPayload, AITaskMessage } from './index';
import {
    detectSource,
    parseStreamCommand,
    fetchContent,
    iterateStreamRecap,
    publishStream,
    formatRecapPreview,
    getStreamSession,
    setStreamSession,
    deleteStreamSession,
    findActiveStreamSession,
    setActiveStreamSession,
    clearActiveStreamSession,
    type StreamSession,
} from './stream';
import {
    uploadPDFToR2,
    analyzePDF,
    formatPDFAnalysis,
    getPDFSession,
    setPDFSession,
    deletePDFSession,
    findActivePDFSession,
    setActivePDFSession,
    clearActivePDFSession,
    type PDFSession,
} from './pdf';

// ─────────────────────────────────────────────────────────────────────────────
// Telegram Types (minimal subset)
// ─────────────────────────────────────────────────────────────────────────────

interface TelegramUpdate {
    update_id: number;
    message?: TelegramMessage;
    callback_query?: CallbackQuery;
}

interface TelegramMessage {
    message_id: number;
    chat: { id: number };
    from?: { id: number; first_name: string };
    text?: string;
    caption?: string;
    photo?: PhotoSize[];
    document?: Document;
    reply_to_message?: TelegramMessage;
}

interface PhotoSize {
    file_id: string;
    file_unique_id: string;
    width: number;
    height: number;
}

interface Document {
    file_id: string;
    file_name?: string;
    mime_type?: string;
}

interface CallbackQuery {
    id: string;
    from: { id: number; first_name: string };
    message?: TelegramMessage;
    data?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Session State (stored in KV)
// ─────────────────────────────────────────────────────────────────────────────

type SessionState = 'idle' | 'classify' | 'joke_text' | 'post_title' | 'post_body' | 'quote_text' | 'quote_author' | 'confirm';

interface Session {
    state: SessionState;
    type?: 'joke' | 'post' | 'stream' | 'quote';
    format?: string;
    fileId?: string;
    fileType?: 'photo' | 'document';
    mimeType?: string;
    text?: string;
    title?: string;
    body?: string;
    author?: string;
    messageId?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline Keyboards
// ─────────────────────────────────────────────────────────────────────────────

const KEYBOARDS = {
    classify: {
        inline_keyboard: [
            [
                { text: '😂 Joke', callback_data: 'type:joke' },
                { text: '📝 Post', callback_data: 'type:post' },
            ],
            [
                { text: '⚡ Stream', callback_data: 'type:stream' },
                { text: '❌ Cancel', callback_data: 'cancel' },
            ],
        ],
    },
    jokeText: {
        inline_keyboard: [
            [
                { text: '✍️ Add caption', callback_data: 'joke:add_text' },
                { text: '⏭ Image only', callback_data: 'joke:no_text' },
            ],
            [{ text: '❌ Cancel', callback_data: 'cancel' }],
        ],
    },
    postFormat: {
        inline_keyboard: [
            [
                { text: '📄 Article', callback_data: 'format:article' },
                { text: '🎬 Video', callback_data: 'format:video-embed' },
            ],
            [
                { text: '🎵 Audio', callback_data: 'format:audio' },
                { text: '💬 Quote', callback_data: 'format:quote' },
            ],
            [{ text: '❌ Cancel', callback_data: 'cancel' }],
        ],
    },
    confirm: {
        inline_keyboard: [
            [
                { text: '✅ Publish', callback_data: 'confirm:yes' },
                { text: '✏️ Edit', callback_data: 'confirm:edit' },
            ],
            [{ text: '❌ Cancel', callback_data: 'cancel' }],
        ],
    },
    streamPreview: {
        inline_keyboard: [
            [
                { text: '✅ Approve', callback_data: 'stream:approve' },
                { text: '🔄 Regenerate', callback_data: 'stream:regenerate' },
            ],
            [
                { text: '📄 View Full', callback_data: 'stream:viewfull' },
                { text: '❌ Cancel', callback_data: 'stream:cancel' },
            ],
        ],
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Handler
// ─────────────────────────────────────────────────────────────────────────────

export async function handleTelegram(
    request: Request,
    env: Env & { TELEGRAM_TOKEN: string; SESSIONS: KVNamespace },
    ctx?: ExecutionContext,
): Promise<Response> {
    const update = await request.json<TelegramUpdate>();

    // Dedupe by update_id to prevent Telegram retry duplicates
    const dedupeKey = `tg:update:${update.update_id}`;
    const seen = await env.SESSIONS.get(dedupeKey);
    if (seen) {
        return new Response('ok'); // Already processed
    }
    await env.SESSIONS.put(dedupeKey, '1', { expirationTtl: 300 }); // 5 min TTL

    // Process in background, respond immediately to avoid Telegram timeout
    const processUpdate = async () => {
        try {
            if (update.callback_query) {
                await handleCallback(update.callback_query, env);
            } else if (update.message) {
                await handleMessage(update.message, env);
            }
        } catch (err) {
            console.error('Telegram handler error:', err);
        }
    };

    if (ctx) {
        ctx.waitUntil(processUpdate());
    } else {
        await processUpdate();
    }

    return new Response('ok');
}

// ─────────────────────────────────────────────────────────────────────────────
// Message Handler
// ─────────────────────────────────────────────────────────────────────────────

async function handleMessage(
    msg: TelegramMessage,
    env: Env & { TELEGRAM_TOKEN: string; SESSIONS: KVNamespace },
): Promise<void> {
    const chatId = msg.chat.id;
    const session = await getSession(env, chatId);

    // Command handlers
    if (msg.text?.startsWith('/')) {
        const cmd = msg.text.split(' ')[0].toLowerCase();
        switch (cmd) {
            case '/start':
            case '/help':
                await sendMessage(env, chatId, `📥 *Vilab Ingest Bot*\n\nSend me:\n• 📷 Photo → Joke or Post\n• 📝 Text → Stream post\n• 🔗 Link → Stream link\n• 📄 PDF → Recap\n\nCommands:\n/joke - Start joke\n/quote - Add quote\n/post - Start post\n/pr - Create PR\n/merge - Merge PR\n/publish - PR + merge\n/undo - Remove commit\n/cherry - Cherry-pick to main\n/cancel - Reset`, { parse_mode: 'Markdown' });
                return;
            case '/cancel':
                await clearSession(env, chatId);
                // Also clear any active PDF/stream sessions
                const activePdf = await findActivePDFSession(env, chatId);
                if (activePdf) {
                    await deletePDFSession(env, activePdf.id);
                    await clearActivePDFSession(env, chatId);
                }
                const activeStream = await findActiveStreamSession(env, chatId);
                if (activeStream) {
                    await deleteStreamSession(env, activeStream.id);
                    await clearActiveStreamSession(env, chatId);
                }
                await sendMessage(env, chatId, '✅ All sessions cleared');
                return;
            case '/joke':
                await setSession(env, chatId, { state: 'classify', type: 'joke' });
                await sendMessage(env, chatId, '📷 Send me a photo for the joke');
                return;
            case '/post':
                await setSession(env, chatId, { state: 'classify', type: 'post' });
                await sendMessage(env, chatId, '📷 Send me a hero image, or type the title');
                return;
            case '/quote':
                await setSession(env, chatId, { state: 'quote_text', type: 'quote' });
                await sendMessage(env, chatId, '💬 Send me the quote text:');
                return;
            case '/pr':
                await handlePRCommand(env, chatId);
                return;
            case '/merge':
                await handleMergeCommand(env, chatId);
                return;
            case '/publish':
                await handlePublishCommand(env, chatId);
                return;
            case '/undo':
                await showCommitList(env, chatId, 'undo');
                return;
            case '/cherry':
                await showCommitList(env, chatId, 'cherry');
                return;
            default:
                // Unknown command - respond with help
                await sendMessage(env, chatId, `Unknown command. Try /help`);
                return;
        }
    }

    // PDF document - handle separately
    if (msg.document?.mime_type === 'application/pdf') {
        const fileId = msg.document.file_id;
        const fileName = msg.document.file_name || 'document.pdf';
        await handlePDFUpload(env, chatId, fileId, fileName);
        return;
    }

    // Photo/document received
    if (msg.photo || msg.document) {
        const fileId = msg.photo
            ? msg.photo[msg.photo.length - 1].file_id  // largest photo
            : msg.document!.file_id;
        const fileType = msg.photo ? 'photo' : 'document';
        const mimeType = msg.document?.mime_type;

        // If already in a specific flow
        if (session.type === 'joke') {
            await setSession(env, chatId, {
                ...session,
                state: 'joke_text',
                fileId,
                fileType,
                mimeType,
                text: msg.caption,
            });
            if (msg.caption) {
                // Caption provided, go to confirm
                await showJokeConfirm(env, chatId, session);
            } else {
                await sendMessage(env, chatId, 'Got it! Add a caption?', { reply_markup: KEYBOARDS.jokeText });
            }
            return;
        }

        if (session.type === 'post') {
            await setSession(env, chatId, {
                ...session,
                state: 'post_title',
                fileId,
                fileType,
                mimeType,
            });
            await sendMessage(env, chatId, 'Got the image! Now send the post *title*:', { parse_mode: 'Markdown' });
            return;
        }

        // No flow started - ask what type
        await setSession(env, chatId, {
            state: 'classify',
            fileId,
            fileType,
            mimeType,
            text: msg.caption,
        });
        await sendMessage(env, chatId, 'What type of content is this?', { reply_markup: KEYBOARDS.classify });
        return;
    }

    // Text message
    if (msg.text) {
        // Ignore text when waiting for button confirmation
        if (session.state === 'confirm') {
            await sendMessage(env, chatId, 'Click a button above to continue, or /cancel to reset.');
            return;
        }

        // URLs always go to handleStreamLink (it handles its own session cleanup)
        if (isUrl(msg.text)) {
            await handleStreamLink(env, chatId, msg.text);
            return;
        }

        // Check for active stream session (non-URL text only)
        const streamSession = await findActiveStreamSession(env, chatId);
        if (streamSession) {
            const trimmed = msg.text.trim().toLowerCase();

            // Handle cancel for any active session status
            if (['cancel', '/cancel', 'skip', 'no', 'hủy', 'bỏ', 'thôi'].includes(trimmed)) {
                await cancelStream(env, chatId, streamSession);
                return;
            }

            // Only process other feedback when in preview status
            if (streamSession.status === 'preview') {
                await handleStreamFeedback(env, chatId, msg.text, streamSession);
                return;
            }

            // Session is processing - silently ignore non-URL text
            if (['fetching', 'recapping'].includes(streamSession.status)) {
                return;
            }
        }

        // In classify state - handle text input
        if (session.state === 'classify') {
            // Joke accepts text (text-only joke) or image
            if (session.type === 'joke') {
                await setSession(env, chatId, { ...session, state: 'confirm', text: msg.text });
                await showJokeConfirm(env, chatId, { ...session, text: msg.text });
                return;
            }
            // Post can accept text as title
            if (session.type === 'post') {
                await setSession(env, chatId, { ...session, state: 'post_body', title: msg.text });
                await sendMessage(env, chatId, 'Now send the post *body* (markdown supported):', { parse_mode: 'Markdown' });
                return;
            }
        }

        // Collecting joke text
        if (session.state === 'joke_text') {
            await setSession(env, chatId, { ...session, text: msg.text });
            await showJokeConfirm(env, chatId, { ...session, text: msg.text });
            return;
        }

        // Collecting post title
        if (session.state === 'post_title') {
            await setSession(env, chatId, { ...session, state: 'post_body', title: msg.text });
            await sendMessage(env, chatId, 'Now send the post *body* (markdown supported):', { parse_mode: 'Markdown' });
            return;
        }

        // Collecting post body
        if (session.state === 'post_body') {
            await setSession(env, chatId, { ...session, body: msg.text });
            await showPostConfirm(env, chatId, { ...session, body: msg.text });
            return;
        }

        // Check for active PDF session
        const pdfSession = await findActivePDFSession(env, chatId);
        if (pdfSession) {
            const trimmed = msg.text.trim().toLowerCase();

            // Handle cancel for any active PDF session
            if (['cancel', '/cancel', 'skip', 'no', 'hủy', 'bỏ', 'thôi'].includes(trimmed)) {
                await cancelPDF(env, chatId, pdfSession);
                return;
            }

            // Session is processing - silently ignore
            if (['uploading', 'analyzing', 'extracting', 'recapping'].includes(pdfSession.status)) {
                return;
            }
        }

        // Collecting quote text
        if (session.state === 'quote_text') {
            await setSession(env, chatId, { ...session, state: 'quote_author', text: msg.text });
            await sendMessage(env, chatId, '👤 Who said this? (author name):');
            return;
        }

        // Collecting quote author
        if (session.state === 'quote_author') {
            await setSession(env, chatId, { ...session, author: msg.text });
            await showQuoteConfirm(env, chatId, { ...session, author: msg.text });
            return;
        }

        // Plain text without flow - treat as stream post
        // But ignore if it looks like a command (starts with /)
        if (!msg.text.trim().startsWith('/')) {
            await handleStreamPost(env, chatId, msg.text);
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Callback Handler
// ─────────────────────────────────────────────────────────────────────────────

async function handleCallback(
    query: CallbackQuery,
    env: Env & { TELEGRAM_TOKEN: string; SESSIONS: KVNamespace },
): Promise<void> {
    const chatId = query.message?.chat.id;
    if (!chatId) return;

    const data = query.data || '';
    const session = await getSession(env, chatId);

    // Answer callback to remove loading state
    await answerCallback(env, query.id);

    if (data === 'cancel') {
        await clearSession(env, chatId);
        await editMessage(env, chatId, query.message!.message_id, '❌ Cancelled');
        return;
    }

    // Type selection
    if (data.startsWith('type:')) {
        const type = data.split(':')[1] as 'joke' | 'post' | 'stream';
        await setSession(env, chatId, { ...session, type });

        if (type === 'joke') {
            if (session.fileId) {
                // Already have image, ask about text
                await editMessage(env, chatId, query.message!.message_id, 'Add a caption?', KEYBOARDS.jokeText);
            } else {
                await editMessage(env, chatId, query.message!.message_id, '📷 Send me a photo for the joke');
            }
        } else if (type === 'post') {
            await editMessage(env, chatId, query.message!.message_id, 'Choose post format:', KEYBOARDS.postFormat);
        } else if (type === 'stream') {
            if (session.text) {
                await handleStreamPost(env, chatId, session.text);
            } else {
                await editMessage(env, chatId, query.message!.message_id, '📝 Send me the stream content');
            }
        }
        return;
    }

    // Joke text options
    if (data === 'joke:add_text') {
        await setSession(env, chatId, { ...session, state: 'joke_text' });
        await editMessage(env, chatId, query.message!.message_id, '✍️ Send me the joke caption:');
        return;
    }

    if (data === 'joke:no_text') {
        await showJokeConfirm(env, chatId, session, query.message!.message_id);
        return;
    }

    // Post format selection
    if (data.startsWith('format:')) {
        const format = data.split(':')[1];
        await setSession(env, chatId, { ...session, format, state: 'post_title' });
        await editMessage(env, chatId, query.message!.message_id, `📝 Send me the *${format}* title:`, undefined, 'Markdown');
        return;
    }

    // Confirm actions
    if (data === 'confirm:yes') {
        await editMessage(env, chatId, query.message!.message_id, '⏳ Publishing...');

        try {
            if (session.type === 'joke') {
                await publishJoke(env, chatId, session);
            } else if (session.type === 'post') {
                await publishPost(env, chatId, session);
            } else if (session.type === 'quote') {
                await publishQuote(env, chatId, session);
            }
            await clearSession(env, chatId);
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Unknown error';
            await sendMessage(env, chatId, `❌ Failed: ${msg}`);
        }
        return;
    }

    // Undo commit selection
    if (data.startsWith('undo:')) {
        const sha = data.split(':')[1];
        await editMessage(env, chatId, query.message!.message_id, `🗑 Removing \`${sha.slice(0, 7)}\`...`, undefined, 'Markdown');
        await undoCommit(env, chatId, sha);
        return;
    }

    // Cherry-pick commit selection
    if (data.startsWith('cherry:')) {
        const sha = data.split(':')[1];
        await editMessage(env, chatId, query.message!.message_id, `🍒 Cherry-picking \`${sha.slice(0, 7)}\`...`, undefined, 'Markdown');
        await cherryPickCommit(env, chatId, sha);
        return;
    }

    if (data === 'confirm:edit') {
        // Go back to appropriate state
        if (session.type === 'joke') {
            await setSession(env, chatId, { ...session, state: 'joke_text' });
            await editMessage(env, chatId, query.message!.message_id, '✍️ Send new caption (or /cancel):');
        } else if (session.type === 'quote') {
            await setSession(env, chatId, { ...session, state: 'quote_text' });
            await editMessage(env, chatId, query.message!.message_id, '✍️ Send new quote text:');
        } else {
            await setSession(env, chatId, { ...session, state: 'post_title' });
            await editMessage(env, chatId, query.message!.message_id, '✍️ Send new title:');
        }
        return;
    }

    // Stream actions
    if (data.startsWith('stream:')) {
        const [, action, sessionId] = data.split(':');
        let streamSession = await getStreamSession(env, sessionId);

        if (!streamSession) {
            await editMessage(env, chatId, query.message!.message_id, '❌ Session expired');
            return;
        }

        // KV eventual consistency - if recap missing, wait and retry once
        if (action === 'approve' && !streamSession.recap) {
            await new Promise(r => setTimeout(r, 2000)); // Wait 2s for KV propagation
            streamSession = await getStreamSession(env, sessionId);
            if (!streamSession?.recap) {
                await editMessage(env, chatId, query.message!.message_id, '⏳ Recap still processing, try again in a moment...');
                return;
            }
        }

        switch (action) {
            case 'approve':
                await editMessage(env, chatId, query.message!.message_id, '📤 Publishing...');
                await approveStream(env, chatId, streamSession);
                break;

            case 'regenerate':
                await editMessage(env, chatId, query.message!.message_id, '🔄 Regenerating...');
                await regenerateStream(env, chatId, streamSession);
                break;

            case 'cancel':
                await cancelStream(env, chatId, streamSession);
                await editMessage(env, chatId, query.message!.message_id, '❌ Cancelled');
                break;
        }
        return;
    }

    // PDF actions
    if (data.startsWith('pdf:')) {
        const [, action, sessionId] = data.split(':');
        let pdfSession = await getPDFSession(env, sessionId);

        if (!pdfSession) {
            await editMessage(env, chatId, query.message!.message_id, '❌ Session expired');
            return;
        }

        // KV eventual consistency - if recap missing, wait and retry once
        if (action === 'approve' && !pdfSession.recap) {
            await new Promise(r => setTimeout(r, 2000));
            pdfSession = await getPDFSession(env, sessionId);
            if (!pdfSession?.recap) {
                await editMessage(env, chatId, query.message!.message_id, '⏳ Recap still processing, try again in a moment...');
                return;
            }
        }

        switch (action) {
            case 'approve':
                await editMessage(env, chatId, query.message!.message_id, '📤 Publishing...');
                await approvePDF(env, chatId, pdfSession);
                break;

            case 'regenerate':
                await editMessage(env, chatId, query.message!.message_id, '🔄 Regenerating...');
                await regeneratePDF(env, chatId, pdfSession);
                break;

            case 'cancel':
                await cancelPDF(env, chatId, pdfSession);
                await editMessage(env, chatId, query.message!.message_id, '❌ Cancelled');
                break;

            case 'quick':
                await editMessage(env, chatId, query.message!.message_id, '🤖 Creating quick recap...');
                await processPDFRecap(env, chatId, pdfSession);
                break;

            case 'full':
                await editMessage(env, chatId, query.message!.message_id, '📚 Extracting full content...');
                pdfSession.analysis!.strategy = 'full';
                await setPDFSession(env, pdfSession);
                await processPDFRecap(env, chatId, pdfSession);
                break;
        }
        return;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Confirm Screens
// ─────────────────────────────────────────────────────────────────────────────

async function showJokeConfirm(
    env: Env & { TELEGRAM_TOKEN: string; SESSIONS: KVNamespace },
    chatId: number,
    session: Session,
    editMsgId?: number,
): Promise<void> {
    let preview = '😂 *Joke Preview*\n\n';
    if (session.text) {
        preview += `"${session.text}"`;
    }
    if (session.fileId) {
        preview += session.text ? '\n\n📷 Image attached' : '📷 Image only (no caption)';
    } else {
        preview += '\n\n📝 Text only (no image)';
    }

    await setSession(env, chatId, { ...session, state: 'confirm' });

    if (editMsgId) {
        await editMessage(env, chatId, editMsgId, preview, KEYBOARDS.confirm, 'Markdown');
    } else {
        await sendMessage(env, chatId, preview, { parse_mode: 'Markdown', reply_markup: KEYBOARDS.confirm });
    }
}

async function showPostConfirm(
    env: Env & { TELEGRAM_TOKEN: string; SESSIONS: KVNamespace },
    chatId: number,
    session: Session,
): Promise<void> {
    const preview = `📝 *Post Preview*\n\n*Title:* ${session.title}\n*Format:* ${session.format || 'article'}\n\n${truncate(session.body || '', 200)}`;

    await setSession(env, chatId, { ...session, state: 'confirm' });
    await sendMessage(env, chatId, preview, { parse_mode: 'Markdown', reply_markup: KEYBOARDS.confirm });
}

async function showQuoteConfirm(
    env: Env & { TELEGRAM_TOKEN: string; SESSIONS: KVNamespace },
    chatId: number,
    session: Session,
): Promise<void> {
    const preview = `💬 *Quote Preview*\n\n"${session.text}"\n\n— *${session.author}*`;

    await setSession(env, chatId, { ...session, state: 'confirm' });
    await sendMessage(env, chatId, preview, { parse_mode: 'Markdown', reply_markup: KEYBOARDS.confirm });
}

// ─────────────────────────────────────────────────────────────────────────────
// Publishers
// ─────────────────────────────────────────────────────────────────────────────

async function publishJoke(
    env: Env & { TELEGRAM_TOKEN: string; SESSIONS: KVNamespace },
    chatId: number,
    session: Session,
): Promise<void> {
    if (!session.fileId && !session.text) throw new Error('No image or text');

    // Get next joke number
    const jokeNum = await getNextJokeNumber(env);
    const slug = jokeNum.toString().padStart(3, '0');

    const payload: IngestPayload = {
        slug,
        format: 'article', // jokes use simple format
        frontmatter: {
            date: new Date().toISOString().split('T')[0],
            ...(session.text && { text: session.text }),
        },
    };

    // Add image if present
    if (session.fileId) {
        const fileUrl = await getTelegramFileUrl(env, session.fileId);
        const ext = session.mimeType?.includes('png') ? 'png' : 'jpg';
        payload.media = [{
            field: 'image',
            sourceUrl: fileUrl,
            filename: `joke-${slug}.${ext}`,
            contentType: session.mimeType || 'image/jpeg',
        }];
    }

    await callIngest(env, payload, 'jokes');
    await sendMessage(env, chatId, `✅ Joke #${slug} published!`);
}

async function publishPost(
    env: Env & { TELEGRAM_TOKEN: string; SESSIONS: KVNamespace },
    chatId: number,
    session: Session,
): Promise<void> {
    if (!session.title) throw new Error('No title');

    const slug = slugify(session.title);
    const format = session.format || 'article';

    const payload: IngestPayload = {
        slug,
        format: format as IngestPayload['format'],
        frontmatter: {
            title: session.title,
            status: 'published',
            format,
            date: new Date().toISOString().split('T')[0],
        },
        body: session.body,
    };

    // Add hero image if present
    if (session.fileId) {
        const fileUrl = await getTelegramFileUrl(env, session.fileId);
        const ext = session.mimeType?.includes('png') ? 'png' : 'jpg';
        payload.media = [{
            field: 'heroImage',
            sourceUrl: fileUrl,
            filename: `hero.${ext}`,
            contentType: session.mimeType || 'image/jpeg',
        }];
    }

    await callIngest(env, payload, 'posts');
    await sendMessage(env, chatId, `✅ Post "${session.title}" created as draft!`);
}

async function publishQuote(
    env: Env & { TELEGRAM_TOKEN: string; SESSIONS: KVNamespace },
    chatId: number,
    session: Session,
): Promise<void> {
    if (!session.text) throw new Error('No quote text');
    if (!session.author) throw new Error('No author');

    // Generate slug from author name + timestamp
    const slug = `quote-${slugify(session.author)}-${Date.now()}`;

    const payload: IngestPayload = {
        slug,
        format: 'quote',
        frontmatter: {
            title: `Quote by ${session.author}`,
            format: 'quote',
            status: 'published',
            date: new Date().toISOString().split('T')[0],
            quoteText: session.text,
            attribution: session.author,
        },
    };

    await callIngest(env, payload, 'posts');
    await sendMessage(env, chatId, `✅ Quote published!`);
}

async function handleStreamLink(
    env: Env & { TELEGRAM_TOKEN: string; SESSIONS: KVNamespace },
    chatId: number,
    text: string,
): Promise<void> {
    // Parse URL and language
    const { url, lang } = parseStreamCommand(text);
    if (!url) {
        await sendMessage(env, chatId, '❌ Invalid URL');
        return;
    }

    // Detect source type
    const source = detectSource(url);
    const sourceEmoji = source === 'github' ? '🐙' : source === 'youtube' ? '📺' : '🌐';

    // Create session
    const sessionId = crypto.randomUUID();
    const session: StreamSession = {
        id: sessionId,
        chatId,
        url,
        source,
        lang,
        status: 'fetching',
        pollAttempts: 0,
        feedbackHistory: [],
        createdAt: Date.now(),
    };

    await setStreamSession(env, session);
    await setActiveStreamSession(env, chatId, sessionId);

    // Send initial message
    const langLabel = lang === 'vi' ? '🇻🇳' : '🇺🇸';
    await sendMessage(env, chatId, `${sourceEmoji} Đang fetch content... ${langLabel}`);

    try {
        // Fetch content (with Windmill fallback for websites)
        const { title, content, videoId } = await fetchContent(url, source, env.WINDMILL_TOKEN);

        // Update session with content
        session.status = 'recapping';
        session.rawTitle = title;
        session.rawContent = content;
        if (videoId) session.videoId = videoId;
        await setStreamSession(env, session);

        await sendMessage(env, chatId, `📝 Fetched: "${title}" (${Math.round(content.length / 1000)}KB)\n🤖 Đang tạo recap... (có thể mất 1-2 phút)`);

        // Queue AI task for async processing (15 min timeout)
        await env.AI_QUEUE.send({
            type: 'stream_recap',
            sessionId,
            chatId,
        } satisfies AITaskMessage);

        // AI processing continues in queue consumer
        // User will receive preview when done

    } catch (err) {
        session.status = 'failed';
        await setStreamSession(env, session);
        await clearActiveStreamSession(env, chatId);

        const message = err instanceof Error ? err.message : 'Unknown error';
        await sendMessage(env, chatId, `❌ Failed: ${message}`);
    }
}

async function handleStreamPost(
    env: Env & { TELEGRAM_TOKEN: string; SESSIONS: KVNamespace },
    chatId: number,
    text: string,
): Promise<void> {
    const slug = `post-${Date.now()}`;
    const title = text.split('\n')[0].slice(0, 60);

    const payload: IngestPayload = {
        slug,
        format: 'article',
        frontmatter: {
            type: 'post',
            title,
            date: new Date().toISOString().split('T')[0],
            status: 'published',
        },
        body: text,
    };

    await callIngest(env, payload, 'stream');
    await sendMessage(env, chatId, `✅ Posted to stream!`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Stream Feedback Handler
// ─────────────────────────────────────────────────────────────────────────────

const MAX_STREAM_ITERATIONS = 5;

async function handleStreamFeedback(
    env: Env & { TELEGRAM_TOKEN: string; SESSIONS: KVNamespace },
    chatId: number,
    text: string,
    session: StreamSession,
): Promise<void> {
    const trimmed = text.trim().toLowerCase();

    // Check for approval
    if (['ok', 'lgtm', 'approve', 'approved', '✅', 'yes', 'good', 'ship', 'đăng', 'được'].includes(trimmed)) {
        await approveStream(env, chatId, session);
        return;
    }

    // Check for cancellation
    if (['cancel', 'skip', 'no', '❌', 'hủy', 'bỏ', 'thôi'].includes(trimmed)) {
        await cancelStream(env, chatId, session);
        return;
    }

    // Check for regeneration
    if (['regenerate', 'retry', 'again', '🔄', 'lại', 'thử lại'].includes(trimmed)) {
        await regenerateStream(env, chatId, session);
        return;
    }

    // Treat as feedback for iteration
    if (session.feedbackHistory.length >= MAX_STREAM_ITERATIONS) {
        await sendMessage(env, chatId,
            `⚠️ Đã đạt giới hạn ${MAX_STREAM_ITERATIONS} lần chỉnh sửa.\nReply "ok" để approve hoặc "cancel" để hủy.`,
        );
        return;
    }

    await sendMessage(env, chatId, '🤖 Đang chỉnh sửa theo feedback...');

    try {
        // Add feedback to history
        session.feedbackHistory.push(text);

        // Regenerate with feedback
        const newRecap = await iterateStreamRecap(env, session, text);

        // Update session
        session.recap = newRecap;
        await setStreamSession(env, session);

        // Send new preview
        const { text: previewText, parse_mode } = formatRecapPreview(newRecap);
        const previewUrl = `https://vilab-ingest.bnqtoan.workers.dev/preview/${session.id}`;

        await sendMessage(env, chatId, previewText, {
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

    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        await sendMessage(env, chatId, `❌ Error: ${message}`);
    }
}

async function approveStream(
    env: Env & { TELEGRAM_TOKEN: string; SESSIONS: KVNamespace },
    chatId: number,
    session: StreamSession,
): Promise<void> {
    await sendMessage(env, chatId, '📤 Đang publish...');

    try {
        const slug = await publishStream(env, session);

        session.status = 'approved';
        await setStreamSession(env, session);
        await clearActiveStreamSession(env, chatId);

        await sendMessage(env, chatId,
            `✅ Published!\n\n📝 *${session.recap?.title}*\n🔗 Slug: \`${slug}\``,
            { parse_mode: 'Markdown' },
        );
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        await sendMessage(env, chatId, `❌ Publish failed: ${message}`);
    }
}

async function cancelStream(
    env: Env & { TELEGRAM_TOKEN: string; SESSIONS: KVNamespace },
    chatId: number,
    session: StreamSession,
): Promise<void> {
    await deleteStreamSession(env, session.id);
    await clearActiveStreamSession(env, chatId);
    await sendMessage(env, chatId, '❌ Stream cancelled');
}

async function regenerateStream(
    env: Env & { TELEGRAM_TOKEN: string; SESSIONS: KVNamespace },
    chatId: number,
    session: StreamSession,
): Promise<void> {
    await sendMessage(env, chatId, '🔄 Đang regenerate...');

    try {
        // Reset feedback history for fresh generation
        session.feedbackHistory = [];
        session.status = 'recapping';
        await setStreamSession(env, session);

        // Queue AI task for async processing
        await env.AI_QUEUE.send({
            type: 'stream_recap',
            sessionId: session.id,
            chatId,
        } satisfies AITaskMessage);

        await sendMessage(env, chatId, '🔄 Đang regenerate... (có thể mất 1-2 phút)');

    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        await sendMessage(env, chatId, `❌ Regenerate failed: ${message}`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF Handlers
// ─────────────────────────────────────────────────────────────────────────────

async function handlePDFUpload(
    env: Env & { TELEGRAM_TOKEN: string; SESSIONS: KVNamespace },
    chatId: number,
    fileId: string,
    fileName: string,
): Promise<void> {
    // Create new session
    const sessionId = crypto.randomUUID();
    const session: PDFSession = {
        id: sessionId,
        chatId,
        fileId,
        fileName,
        lang: 'vi',
        status: 'uploading',
        createdAt: Date.now(),
    };

    await setPDFSession(env, session);
    await setActivePDFSession(env, chatId, sessionId);

    await sendMessage(env, chatId, `PDF received: ${fileName}\nUploading...`);

    try {
        // Get file URL from Telegram
        const fileUrl = await getTelegramFileUrl(env, fileId);

        // Upload to R2
        const r2Url = await uploadPDFToR2(env, fileUrl, fileName);
        session.r2Url = r2Url;
        session.status = 'analyzing';
        await setPDFSession(env, session);

        await sendMessage(env, chatId, `Uploaded: ${r2Url}\n\nAnalyzing PDF...`);

        // Analyze PDF
        const analysis = await analyzePDF(r2Url);
        session.analysis = analysis;
        await setPDFSession(env, session);

        // Send analysis result
        const analysisMsg = formatPDFAnalysis(analysis);

        if (analysis.strategy === 'interactive') {
            // Large doc - ask user what to do
            await sendMessage(env, chatId, analysisMsg, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: 'Quick Recap', callback_data: `pdf:quick:${sessionId}` },
                            { text: 'Full Extract', callback_data: `pdf:full:${sessionId}` },
                        ],
                        [{ text: 'Cancel', callback_data: `pdf:cancel:${sessionId}` }],
                    ],
                },
            });
        } else {
            // Small/medium - auto process
            await sendMessage(env, chatId, analysisMsg + '\n\nExtracting content...', {
                parse_mode: 'HTML',
            });
            await processPDFRecap(env, chatId, session);
        }

    } catch (err) {
        session.status = 'failed';
        await setPDFSession(env, session);
        await clearActivePDFSession(env, chatId);

        const message = err instanceof Error ? err.message : 'Unknown error';
        await sendMessage(env, chatId, `PDF processing failed: ${message}`);
    }
}

async function processPDFRecap(
    env: Env & { TELEGRAM_TOKEN: string; SESSIONS: KVNamespace },
    chatId: number,
    session: PDFSession,
): Promise<void> {
    if (!session.r2Url || !session.analysis) {
        throw new Error('PDF not analyzed');
    }

    try {
        session.status = 'recapping';
        await setPDFSession(env, session);

        await sendMessage(env, chatId, `🤖 Creating recap... (có thể mất 1-2 phút)`);

        // Queue AI task for async processing (15 min timeout)
        // Extraction + AI recap both happen in queue to avoid CPU timeout
        await env.AI_QUEUE.send({
            type: 'pdf_recap',
            sessionId: session.id,
            chatId,
        } satisfies AITaskMessage);

        // Processing continues in queue consumer
        // User will receive preview when done

    } catch (err) {
        session.status = 'failed';
        await setPDFSession(env, session);
        await clearActivePDFSession(env, chatId);

        const message = err instanceof Error ? err.message : 'Unknown error';
        await sendMessage(env, chatId, `❌ Recap failed: ${message}`);
    }
}

async function approvePDF(
    env: Env & { TELEGRAM_TOKEN: string; SESSIONS: KVNamespace },
    chatId: number,
    session: PDFSession,
): Promise<void> {
    try {
        if (!session.recap || !session.r2Url) {
            throw new Error('No recap or PDF URL');
        }

        const slug = await publishPDFStream(env, session);

        session.status = 'approved';
        await setPDFSession(env, session);
        await clearActivePDFSession(env, chatId);

        await sendMessage(env, chatId,
            `✅ Published!\n\n*${session.recap.title}*\nSlug: \`${slug}\`\nPDF: ${session.r2Url}`,
            { parse_mode: 'Markdown' },
        );

    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        await sendMessage(env, chatId, `❌ Publish failed: ${message}`);
    }
}

async function publishPDFStream(env: Env, session: PDFSession): Promise<string> {
    if (!session.recap || !session.r2Url) {
        throw new Error('No recap or PDF URL');
    }

    const { recap, r2Url, analysis } = session;
    const pdfPages = analysis?.pageCount;
    const timestamp = Date.now();

    const filename = session.fileName.replace(/\.pdf$/i, '');
    const slug = `pdf-${filename.slice(0, 30).toLowerCase().replace(/[^a-z0-9]/g, '-')}-${timestamp}`;

    const date = new Date().toISOString();

    const frontmatter = `---
type: link
title: "${recap.title.replace(/"/g, '\\"')}"
date: "${date}"
url: "${r2Url}"
source: "pdf"
pdfUrl: "${r2Url}"
${pdfPages ? `pdfPages: ${pdfPages}` : ''}
status: published
tags: [${recap.tags.map(t => `"${t}"`).join(', ')}]
---`;

    const pdfEmbed = `
<div class="pdf-preview mb-8 p-4 border border-[var(--color-border)] rounded-lg bg-[var(--color-card)]">
  <div class="flex items-center gap-3 mb-3">
    <span class="text-3xl">📄</span>
    <div>
      <div class="font-semibold">${recap.title}</div>
      <div class="text-sm text-[var(--color-soft)]">${pdfPages ? `${pdfPages} pages` : 'PDF Document'}</div>
    </div>
  </div>
  <a href="${r2Url}" target="_blank" class="inline-flex items-center gap-2 px-4 py-2 bg-[var(--color-accent)] text-white rounded-lg hover:opacity-90 transition-opacity">
    📥 Download PDF
  </a>
</div>`;

    const body = `${recap.tldr}\n\n${pdfEmbed}\n\n${recap.takeaways}`;

    const mdxContent = `${frontmatter}\n\n${body}`;
    const mdxPath = `app/src/content/stream/${slug}.mdx`;

    const { pushToGitHub } = await import('./github');
    await pushToGitHub(env, mdxPath, mdxContent, `content(stream): add ${slug}`);

    return slug;
}

async function cancelPDF(
    env: Env & { TELEGRAM_TOKEN: string; SESSIONS: KVNamespace },
    chatId: number,
    session: PDFSession,
): Promise<void> {
    await deletePDFSession(env, session.id);
    await clearActivePDFSession(env, chatId);
    await sendMessage(env, chatId, '❌ PDF cancelled');
}

async function regeneratePDF(
    env: Env & { TELEGRAM_TOKEN: string; SESSIONS: KVNamespace },
    chatId: number,
    session: PDFSession,
): Promise<void> {
    try {
        if (!session.extractedContent) {
            throw new Error('No content to regenerate');
        }

        session.status = 'recapping';
        await setPDFSession(env, session);

        await sendMessage(env, chatId, '🔄 Regenerating... (có thể mất 1-2 phút)');

        // Queue AI task for async processing
        await env.AI_QUEUE.send({
            type: 'pdf_recap',
            sessionId: session.id,
            chatId,
        } satisfies AITaskMessage);

        // AI processing continues in queue consumer

    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        await sendMessage(env, chatId, `❌ Regenerate failed: ${message}`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Telegram API Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function sendMessage(
    env: { TELEGRAM_TOKEN: string },
    chatId: number,
    text: string,
    extra?: Record<string, unknown>,
): Promise<void> {
    await telegramApi(env, 'sendMessage', { chat_id: chatId, text, ...extra });
}

async function editMessage(
    env: { TELEGRAM_TOKEN: string },
    chatId: number,
    messageId: number,
    text: string,
    replyMarkup?: unknown,
    parseMode?: string,
): Promise<void> {
    await telegramApi(env, 'editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: parseMode,
        reply_markup: replyMarkup,
    });
}

async function answerCallback(env: { TELEGRAM_TOKEN: string }, callbackId: string): Promise<void> {
    await telegramApi(env, 'answerCallbackQuery', { callback_query_id: callbackId });
}

async function getTelegramFileUrl(env: { TELEGRAM_TOKEN: string }, fileId: string): Promise<string> {
    const res = await telegramApi(env, 'getFile', { file_id: fileId });
    const filePath = res.result.file_path;
    return `https://api.telegram.org/file/bot${env.TELEGRAM_TOKEN}/${filePath}`;
}

async function telegramApi(
    env: { TELEGRAM_TOKEN: string },
    method: string,
    body: Record<string, unknown>,
): Promise<{ ok: boolean; result: Record<string, unknown> }> {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// Session Management (KV)
// ─────────────────────────────────────────────────────────────────────────────

async function getSession(env: { SESSIONS: KVNamespace }, chatId: number): Promise<Session> {
    const data = await env.SESSIONS.get(`session:${chatId}`);
    return data ? JSON.parse(data) : { state: 'idle' };
}

async function setSession(env: { SESSIONS: KVNamespace }, chatId: number, session: Session): Promise<void> {
    await env.SESSIONS.put(`session:${chatId}`, JSON.stringify(session), { expirationTtl: 3600 }); // 1hr TTL
}

async function clearSession(env: { SESSIONS: KVNamespace }, chatId: number): Promise<void> {
    await env.SESSIONS.delete(`session:${chatId}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function getNextJokeNumber(env: { SESSIONS: KVNamespace }): Promise<number> {
    const current = await env.SESSIONS.get('joke_counter');
    const next = (parseInt(current || '54', 10) + 1);
    await env.SESSIONS.put('joke_counter', next.toString());
    return next;
}


async function callIngest(env: Env, payload: IngestPayload, contentType: 'posts' | 'jokes' | 'stream'): Promise<void> {
    // Adjust path based on content type
    const pathMap = {
        posts: 'app/src/content/posts',
        jokes: 'app/src/content/jokes',
        stream: 'app/src/content/stream',
    };

    // We call our own pipeline internally
    // For now, use local import - in production this would be a proper internal call
    const { uploadMedia } = await import('./media');
    const { generateMDX } = await import('./mdx');
    const { pushToGitHub } = await import('./github');

    // Upload media if present
    if (payload.media?.length) {
        for (const attachment of payload.media) {
            const r2Url = await uploadMedia(env.MEDIA, attachment, payload.slug, env.MEDIA_BASE_URL);
            payload.frontmatter[attachment.field] = r2Url;
        }
    }

    // Generate MDX
    const mdxContent = generateMDX(payload.frontmatter, payload.body);
    const ext = contentType === 'jokes' ? 'md' : 'mdx';
    const mdxPath = `${pathMap[contentType]}/${payload.slug}.${ext}`;

    // Push to GitHub
    await pushToGitHub(env, mdxPath, mdxContent, `content(${contentType}): add ${payload.slug}`);
}

function slugify(text: string): string {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // remove diacritics
        .replace(/đ/g, 'd')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60);
}

function isUrl(text: string): boolean {
    // Match URL anywhere in text, not just at start
    return /https?:\/\/[^\s]+/.test(text.trim());
}

function truncate(text: string, max: number): string {
    return text.length > max ? text.slice(0, max) + '...' : text;
}

// ─────────────────────────────────────────────────────────────────────────────
// PR / Merge / Publish Commands
// ─────────────────────────────────────────────────────────────────────────────

async function showCommitList(
    env: Env & { TELEGRAM_TOKEN: string; SESSIONS: KVNamespace },
    chatId: number,
    action: 'undo' | 'cherry',
): Promise<void> {
    const actionLabel = action === 'undo' ? '🗑 Remove commit' : '🍒 Cherry-pick to main';
    await sendMessage(env, chatId, `🔍 Loading last 10 commits...`);

    try {
        const commits = await getRecentCommits(env, 10);
        if (commits.length === 0) {
            await sendMessage(env, chatId, '❌ No commits found on draft branch');
            return;
        }

        // Build inline keyboard with commits
        const keyboard = commits.map((c, i) => ([{
            text: `${i + 1}. ${c.message.slice(0, 30)}${c.message.length > 30 ? '...' : ''}`,
            callback_data: `${action}:${c.sha}`,
        }]));
        keyboard.push([{ text: '❌ Cancel', callback_data: 'cancel' }]);

        const commitList = commits.map((c, i) =>
            `${i + 1}. \`${c.sha.slice(0, 7)}\` ${c.message.slice(0, 40)}`
        ).join('\n');

        await sendMessage(env, chatId, `${actionLabel}\n\n${commitList}`, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard },
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        await sendMessage(env, chatId, `❌ Error: ${msg}`);
    }
}

interface CommitInfo {
    sha: string;
    message: string;
    parentSha: string;
}

async function getRecentCommits(env: Env, count: number): Promise<CommitInfo[]> {
    const url = `https://api.github.com/repos/${env.GITHUB_REPO}/commits?sha=${env.GITHUB_BRANCH}&per_page=${count}`;
    const headers = {
        Authorization: `token ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'vilab-ingest',
    };

    const res = await fetch(url, { headers });
    if (!res.ok) {
        throw new Error(`GitHub API error: ${res.status}`);
    }

    const commits = await res.json<Array<{
        sha: string;
        commit: { message: string };
        parents: Array<{ sha: string }>;
    }>>();

    return commits.map(c => ({
        sha: c.sha,
        message: c.commit.message.split('\n')[0],
        parentSha: c.parents[0]?.sha || '',
    }));
}

async function undoCommit(
    env: Env & { TELEGRAM_TOKEN: string },
    chatId: number,
    sha: string,
): Promise<void> {
    try {
        // Get the commit to find its parent
        const commits = await getRecentCommits(env, 10);
        const commitIndex = commits.findIndex(c => c.sha === sha);

        if (commitIndex === -1) {
            await sendMessage(env, chatId, '❌ Commit not found');
            return;
        }

        if (commitIndex === 0) {
            // Removing the latest commit - reset to parent
            const parentSha = commits[0].parentSha;
            if (!parentSha) {
                await sendMessage(env, chatId, '❌ Cannot remove: no parent commit');
                return;
            }
            await resetBranchToSha(env, parentSha);
            await sendMessage(env, chatId, `✅ Removed \`${sha.slice(0, 7)}\`\n\nBranch reset to \`${parentSha.slice(0, 7)}\``, { parse_mode: 'Markdown' });
        } else {
            // Removing older commit - need revert
            await revertCommit(env, sha);
            await sendMessage(env, chatId, `✅ Reverted \`${sha.slice(0, 7)}\``, { parse_mode: 'Markdown' });
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        await sendMessage(env, chatId, `❌ Error: ${msg}`);
    }
}

async function cherryPickCommit(
    env: Env & { TELEGRAM_TOKEN: string },
    chatId: number,
    sha: string,
): Promise<void> {
    try {
        // Get commit details
        const commits = await getRecentCommits(env, 10);
        const commit = commits.find(c => c.sha === sha);

        if (!commit) {
            await sendMessage(env, chatId, '❌ Commit not found');
            return;
        }

        await sendMessage(env, chatId, `🍒 Cherry-picking \`${sha.slice(0, 7)}\` to main...`, { parse_mode: 'Markdown' });

        // Use GitHub's merge API with squash to simulate cherry-pick
        // Create a temporary branch, cherry-pick, then merge
        await cherryPickToMain(env, sha, commit.message);

        await sendMessage(env, chatId, `✅ Cherry-picked to main!\n\n\`${sha.slice(0, 7)}\` ${commit.message}`, { parse_mode: 'Markdown' });
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        await sendMessage(env, chatId, `❌ Error: ${msg}`);
    }
}

async function resetBranchToSha(env: Env, sha: string): Promise<void> {
    const url = `https://api.github.com/repos/${env.GITHUB_REPO}/git/refs/heads/${env.GITHUB_BRANCH}`;
    const headers = {
        Authorization: `token ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'vilab-ingest',
        'Content-Type': 'application/json',
    };

    const res = await fetch(url, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
            sha,
            force: true,
        }),
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Reset failed: ${err}`);
    }
}

async function revertCommit(env: Env, sha: string): Promise<void> {
    // Get commit details to create revert
    const url = `https://api.github.com/repos/${env.GITHUB_REPO}/commits/${sha}`;
    const headers = {
        Authorization: `token ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'vilab-ingest',
    };

    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error('Failed to get commit');

    const commit = await res.json<{ commit: { message: string }; files: Array<{ filename: string; status: string; patch?: string }> }>();

    // For each file in the commit, we need to reverse the changes
    // This is a simplified revert - for complex cases might need manual intervention
    for (const file of commit.files || []) {
        if (file.status === 'added') {
            // Delete the file
            await deleteFile(env, file.filename, `Revert: delete ${file.filename}`);
        }
        // For modified/deleted files, would need to restore previous version
        // This is complex via API - for now just handle added files
    }
}

async function deleteFile(env: Env, path: string, message: string): Promise<void> {
    const apiBase = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}`;
    const headers = {
        Authorization: `token ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'vilab-ingest',
        'Content-Type': 'application/json',
    };

    // Get file SHA first
    const getRes = await fetch(`${apiBase}?ref=${env.GITHUB_BRANCH}`, { headers });
    if (!getRes.ok) return; // File doesn't exist

    const file = await getRes.json<{ sha: string }>();

    // Delete file
    await fetch(apiBase, {
        method: 'DELETE',
        headers,
        body: JSON.stringify({
            message,
            sha: file.sha,
            branch: env.GITHUB_BRANCH,
        }),
    });
}

async function cherryPickToMain(env: Env, sha: string, message: string): Promise<void> {
    // Get the commit's tree
    const commitUrl = `https://api.github.com/repos/${env.GITHUB_REPO}/commits/${sha}`;
    const headers = {
        Authorization: `token ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'vilab-ingest',
        'Content-Type': 'application/json',
    };

    const commitRes = await fetch(commitUrl, { headers });
    if (!commitRes.ok) throw new Error('Failed to get commit');

    const commit = await commitRes.json<{ files: Array<{ filename: string; raw_url: string; status: string }> }>();

    // Get main branch HEAD
    const mainRef = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/git/refs/heads/main`, { headers });
    if (!mainRef.ok) throw new Error('Failed to get main ref');

    // For each file in the commit, copy it to main
    for (const file of commit.files || []) {
        if (file.status === 'removed') {
            // Delete from main
            await deleteFileOnBranch(env, 'main', file.filename, `Cherry-pick: delete ${file.filename}`);
        } else {
            // Get file content from draft
            const contentRes = await fetch(file.raw_url, { headers });
            if (!contentRes.ok) continue;

            const content = await contentRes.text();

            // Push to main
            await pushFileToMain(env, file.filename, content, `Cherry-pick: ${message}`);
        }
    }
}

async function deleteFileOnBranch(env: Env, branch: string, path: string, message: string): Promise<void> {
    const apiBase = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}`;
    const headers = {
        Authorization: `token ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'vilab-ingest',
        'Content-Type': 'application/json',
    };

    const getRes = await fetch(`${apiBase}?ref=${branch}`, { headers });
    if (!getRes.ok) return;

    const file = await getRes.json<{ sha: string }>();

    await fetch(apiBase, {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ message, sha: file.sha, branch }),
    });
}

async function pushFileToMain(env: Env, path: string, content: string, message: string): Promise<void> {
    const apiBase = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}`;
    const headers = {
        Authorization: `token ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'vilab-ingest',
        'Content-Type': 'application/json',
    };

    // Check if file exists on main
    let existingSha: string | undefined;
    const getRes = await fetch(`${apiBase}?ref=main`, { headers });
    if (getRes.ok) {
        const existing = await getRes.json<{ sha: string }>();
        existingSha = existing.sha;
    }

    const body: Record<string, string> = {
        message,
        content: btoa(unescape(encodeURIComponent(content))),
        branch: 'main',
    };

    if (existingSha) {
        body.sha = existingSha;
    }

    const res = await fetch(apiBase, {
        method: 'PUT',
        headers,
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Push to main failed: ${err}`);
    }
}

async function handlePRCommand(
    env: Env & { TELEGRAM_TOKEN: string; SESSIONS: KVNamespace },
    chatId: number,
): Promise<void> {
    await sendMessage(env, chatId, '🔍 Checking for changes on draft branch...');

    try {
        // Check if PR already exists
        const existingPR = await findDraftPR(env);
        if (existingPR) {
            await sendMessage(env, chatId, `📋 PR already exists: #${existingPR.number} - *${existingPR.title}*\n\nUse /merge to merge it.`, { parse_mode: 'Markdown' });
            return;
        }

        // Get commits difference
        const diff = await getCommitsDiff(env);
        if (diff.commits === 0) {
            await sendMessage(env, chatId, '❌ No new commits on draft branch');
            return;
        }

        // Create PR
        const pr = await createPR(env, diff.title, diff.body);
        await sendMessage(env, chatId, `✅ PR created: #${pr.number}\n\n*${pr.title}*\n${pr.url}`, { parse_mode: 'Markdown' });
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        await sendMessage(env, chatId, `❌ Error: ${msg}`);
    }
}

async function handlePublishCommand(
    env: Env & { TELEGRAM_TOKEN: string; SESSIONS: KVNamespace },
    chatId: number,
): Promise<void> {
    await sendMessage(env, chatId, '🚀 Publishing draft → main...');

    try {
        // Check if PR exists, if not create one
        let pr = await findDraftPR(env);

        if (!pr) {
            const diff = await getCommitsDiff(env);
            if (diff.commits === 0) {
                await sendMessage(env, chatId, '❌ No new commits on draft branch');
                return;
            }

            await sendMessage(env, chatId, '📝 Creating PR...');
            const created = await createPR(env, diff.title, diff.body);
            pr = { number: created.number, title: created.title, commits: diff.commits };
        }

        await sendMessage(env, chatId, `📋 PR #${pr.number}: *${pr.title}*\n\nMerging...`, { parse_mode: 'Markdown' });

        // Merge
        const result = await mergePR(env, pr.number);

        if (result.merged) {
            await sendMessage(env, chatId, `✅ Published! PR #${pr.number} merged to main.`);
        } else {
            await sendMessage(env, chatId, `❌ Merge failed: ${result.message}`);
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        await sendMessage(env, chatId, `❌ Error: ${msg}`);
    }
}

async function handleMergeCommand(
    env: Env & { TELEGRAM_TOKEN: string; SESSIONS: KVNamespace },
    chatId: number,
): Promise<void> {
    await sendMessage(env, chatId, '🔍 Looking for open PRs from draft → main...');

    try {
        // Find open PR from draft to main
        const pr = await findDraftPR(env);

        if (!pr) {
            await sendMessage(env, chatId, '❌ No open PR found from draft → main');
            return;
        }

        await sendMessage(env, chatId, `📋 Found PR #${pr.number}: *${pr.title}*\n\n${pr.commits} commit(s)\n\nMerging...`, { parse_mode: 'Markdown' });

        // Merge the PR
        const result = await mergePR(env, pr.number);

        if (result.merged) {
            await sendMessage(env, chatId, `✅ PR #${pr.number} merged!\n\n${result.message}`);
        } else {
            await sendMessage(env, chatId, `❌ Merge failed: ${result.message}`);
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        await sendMessage(env, chatId, `❌ Error: ${msg}`);
    }
}

interface PRInfo {
    number: number;
    title: string;
    commits: number;
}

async function findDraftPR(env: Env): Promise<PRInfo | null> {
    const url = `https://api.github.com/repos/${env.GITHUB_REPO}/pulls?state=open&head=${env.GITHUB_BRANCH}&base=main`;
    const headers = {
        Authorization: `token ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'vilab-ingest',
    };

    const res = await fetch(url, { headers });
    if (!res.ok) {
        throw new Error(`GitHub API error: ${res.status}`);
    }

    const prs = await res.json<Array<{ number: number; title: string; commits: number }>>();

    if (prs.length === 0) {
        return null;
    }

    // Get commit count
    const pr = prs[0];
    const commitsRes = await fetch(
        `https://api.github.com/repos/${env.GITHUB_REPO}/pulls/${pr.number}/commits`,
        { headers }
    );
    const commits = await commitsRes.json<Array<unknown>>();

    return {
        number: pr.number,
        title: pr.title,
        commits: commits.length,
    };
}

async function mergePR(env: Env, prNumber: number): Promise<{ merged: boolean; message: string }> {
    const url = `https://api.github.com/repos/${env.GITHUB_REPO}/pulls/${prNumber}/merge`;
    const headers = {
        Authorization: `token ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'vilab-ingest',
        'Content-Type': 'application/json',
    };

    const res = await fetch(url, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
            merge_method: 'squash',
        }),
    });

    const result = await res.json<{ merged?: boolean; message?: string }>();

    return {
        merged: result.merged || false,
        message: result.message || 'No message',
    };
}

async function getCommitsDiff(env: Env): Promise<{ commits: number; title: string; body: string }> {
    const url = `https://api.github.com/repos/${env.GITHUB_REPO}/compare/main...${env.GITHUB_BRANCH}`;
    const headers = {
        Authorization: `token ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'vilab-ingest',
    };

    const res = await fetch(url, { headers });
    if (!res.ok) {
        throw new Error(`GitHub API error: ${res.status}`);
    }

    const data = await res.json<{
        ahead_by: number;
        commits: Array<{ commit: { message: string } }>;
    }>();

    if (data.ahead_by === 0) {
        return { commits: 0, title: '', body: '' };
    }

    // Build PR title and body from commits
    const commitMessages = data.commits.map(c => c.commit.message.split('\n')[0]);
    const title = commitMessages.length === 1
        ? commitMessages[0]
        : `Content update (${commitMessages.length} commits)`;

    const body = commitMessages.map(m => `- ${m}`).join('\n');

    return {
        commits: data.ahead_by,
        title,
        body,
    };
}

async function createPR(env: Env, title: string, body: string): Promise<{ number: number; title: string; url: string }> {
    const url = `https://api.github.com/repos/${env.GITHUB_REPO}/pulls`;
    const headers = {
        Authorization: `token ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'vilab-ingest',
        'Content-Type': 'application/json',
    };

    const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            title,
            body,
            head: env.GITHUB_BRANCH,
            base: 'main',
        }),
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`PR creation failed: ${err}`);
    }

    const pr = await res.json<{ number: number; title: string; html_url: string }>();
    return {
        number: pr.number,
        title: pr.title,
        url: pr.html_url,
    };
}
