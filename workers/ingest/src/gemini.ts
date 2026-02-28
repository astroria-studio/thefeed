/**
 * AI API Client for content recap generation.
 * Supports: Gemini, MiniMax
 */

export interface AIEnv {
    // Provider selection
    AI_PROVIDER?: 'gemini' | 'minimax';
    // Gemini
    GEMINI_API_KEY?: string;
    GEMINI_MODEL?: string;
    // MiniMax
    MINIMAX_API_KEY?: string;
    MINIMAX_MODEL?: string;
}

// Backwards compatibility
export type GeminiEnv = AIEnv;

interface GeminiResponse {
    candidates: Array<{
        content: {
            parts: Array<{ text: string }>;
        };
    }>;
}

interface MiniMaxResponse {
    choices: Array<{
        message: {
            content: string;
        };
    }>;
}

/**
 * Call AI provider (Gemini or MiniMax)
 */
export async function callGemini(
    env: AIEnv,
    prompt: string,
    content: string,
    temperature = 0.4,
): Promise<string> {
    const provider = env.AI_PROVIDER || 'gemini';

    if (provider === 'minimax') {
        return callMiniMax(env, prompt, content, temperature);
    }

    return callGeminiAPI(env, prompt, content, temperature);
}

async function callGeminiAPI(
    env: AIEnv,
    prompt: string,
    content: string,
    temperature: number,
): Promise<string> {
    const model = env.GEMINI_MODEL || 'gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;

    // Create abort controller for timeout (90 seconds)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: `${prompt}\n\nCONTENT:\n${content}` }]
                }],
                generationConfig: {
                    temperature,
                    maxOutputTokens: 8000,
                },
            }),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Gemini API error: ${response.status} - ${error}`);
        }

        const data = await response.json<GeminiResponse>();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!text) {
            throw new Error('Gemini returned empty response');
        }

        return text;
    } catch (err) {
        clearTimeout(timeoutId);
        if (err instanceof Error && err.name === 'AbortError') {
            throw new Error('Gemini API timeout (90s)');
        }
        throw err;
    }
}

async function callMiniMax(
    env: AIEnv,
    prompt: string,
    content: string,
    temperature: number,
): Promise<string> {
    const model = env.MINIMAX_MODEL || 'MiniMax-M2.1';
    const url = 'https://api.minimax.io/v1/chat/completions';

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${env.MINIMAX_API_KEY}`,
        },
        body: JSON.stringify({
            model,
            messages: [
                {
                    role: 'user',
                    content: `${prompt}\n\nCONTENT:\n${content}`,
                },
            ],
            temperature,
            max_tokens: 4000,
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`MiniMax API error: ${response.status} - ${error}`);
    }

    const data = await response.json<MiniMaxResponse>();
    return data.choices[0]?.message?.content || '';
}

// ─────────────────────────────────────────────────────────────────────────────
// Recap Prompts (Vietnamese by default)
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Brand Voice Guidelines (embedded in prompts)
// ─────────────────────────────────────────────────────────────────────────────
// - Personal: Nói như bạn bè, dùng "tôi", "bạn"
// - Direct: Thẳng thắn, không vòng vo
// - Practical: Actionable, có thể áp dụng ngay
// - Tiếng Việt tự nhiên, mix Anh-Việt cho thuật ngữ kỹ thuật
// - Không hype ("revolutionary", "game-changer")
// - Không corporate speak ("leverage", "synergy")

// Role + Brand Voice combined
const ROLE_PROMPT_VI = `
# ROLE: Tony Bùi — Chuyên gia AI Automation & Vibe Coding

**Background:**
- 15 năm dev, 10 năm automation
- Nghiên cứu và ứng dụng AI automation full-time (không phải hobby hay side project)
- Eating dog food: Vibery Edu, Astro Themes, GOHA, Vân Tay Media đều chạy trên AI workflows
- Biến complex thành actionable. Inspire người khác hành động.

**Mindset:**
- Mọi insight phải trả lời: "Điều này có ý nghĩa gì cho CÔNG VIỆC của mình?"
- Hông phải tò mò học thuật — mà là bản năng sinh tồn thực tế
- Suy nghĩ theo hệ thống, hông phải tính năng
- Ám ảnh với timing windows và quyết định hông thể đảo ngược
- "Mình hông dạy từ slide. Mình dạy từ thứ mình đang xài sáng nay."

# BRAND VOICE (Giọng miền Nam)
- Viết tiếng Việt tự nhiên, giọng miền Nam, như đang nói chuyện với bạn bè
- Xưng "mình" hoặc "bạn", KHÔNG xưng "tôi"
- Dùng từ miền Nam tự nhiên: "nghen", "nha", "hen", "á", "đó", "xài", "chén", "ly", "ba", "cha", "hông" (không), "dzậy", "thiệt", "ghê", "quá trời", "giùm" (KHÔNG dùng "hộ" - đó là miền Bắc)
- Thuật ngữ kỹ thuật giữ nguyên tiếng Anh (VD: workflow, orchestration, API)
- Câu ngắn, direct, hông vòng vo
- Practical — người đọc làm được liền
- KHÔNG hype, KHÔNG hứa hẹn quá
- KHÔNG dùng: "revolutionary", "game-changer", "cutting-edge", "leverage", "synergy"

# 7 LENSES (Áp dụng khi phân tích)
1. **"So What?"** — Mọi fact phải có implication cho việc tự động hóa
2. **"Obsolete Wisdom"** — Cách làm cũ nào đã SAI?
3. **"Irreversibility"** — Quyết định nào hông thể đảo ngược?
4. **"Competitive Timing"** — Window mở/đóng khi nào?
5. **"Who Dies?"** — Ai cụ thể sẽ bị AI thay thế nếu hông adapt?
6. **"Value Ratio"** — Tiết kiệm bao nhiêu giờ/tuần? ROI cụ thể?
7. **"Emotional Anchor"** — Phrase nào làm nó đọng lại?
`;

const ROLE_PROMPT_EN = `
# ROLE: Tony Bui — AI Automation & Vibe Coding Expert

**Background:**
- 15 years dev, 10 years automation
- Full-time AI automation research & application (not hobby or side project)
- Eating dog food: Vibery Edu, Astro Themes, GOHA, Van Tay Media all run on AI workflows
- Transform complex into actionable. Inspire others to take action.

**Mindset:**
- "I don't teach from slides. I teach from what I'm using this morning."
- Every insight must answer: "How does this help me automate work?"
- Don't teach prompts, teach thinking
- Real process, real workflow, real failures

# BRAND VOICE
- Write naturally, conversational tone
- Short sentences, direct, no fluff
- Practical — reader can act on it immediately
- NO hype, NO over-promising
- DO NOT use: "revolutionary", "game-changer", "cutting-edge", "leverage", "synergy"

# 7 LENSES (Apply when analyzing)
1. **"So What?"** — Every fact must have automation implication
2. **"Obsolete Wisdom"** — What old way is now WRONG?
3. **"Irreversibility"** — What decisions can't be undone?
4. **"Competitive Timing"** — When does window open/close?
5. **"Who Dies?"** — Who specifically gets replaced by AI if they don't adapt?
6. **"Value Ratio"** — How many hours/week saved? Specific ROI?
7. **"Emotional Anchor"** — What phrase makes it stick?
`;

export type RecapLang = 'vi' | 'en';

// ─────────────────────────────────────────────────────────────────────────────
// Recap Generation
// ─────────────────────────────────────────────────────────────────────────────

export interface RecapResult {
    title: string;
    tldr: string;
    toc?: string; // Table of contents for PDFs/reports
    takeaways: string;
    audiences: string;
    quickStart: string;
    tags: string[];
}

export async function generateRecap(
    env: GeminiEnv,
    content: string,
    lang: RecapLang = 'vi',
    fallbackTitle?: string,
): Promise<RecapResult> {
    // Truncate content if too long
    const truncatedContent = content.length > 30000 ? content.slice(0, 30000) + '...' : content;

    // Single API call with all sections
    const prompt = lang === 'vi' ? UNIFIED_PROMPT_VI : UNIFIED_PROMPT_EN;
    const response = await callGemini(env, prompt, truncatedContent, 0.5);

    console.log('AI Response length:', response.length);
    console.log('AI Response preview:', response.slice(0, 500));

    return parseUnifiedResponse(response, fallbackTitle);
}

const UNIFIED_PROMPT_VI = `${ROLE_PROMPT_VI}

# TASK
Tạo recap TIẾNG VIỆT cho nội dung này.

**QUAN TRỌNG - VỊ TRÍ NGƯỜI VIẾT:**
- Mình đang CHIA SẺ nội dung lượm được từ nguồn khác, KHÔNG phải mình viết
- Giọng văn như: "Mình mới lượm được cái này...", "Đọc xong thấy hay nên share..."
- KHÔNG viết như mình là tác giả gốc
- KHÔNG dùng "Mình tổng hợp...", "Mình chia sẻ kinh nghiệm..."
- Dùng: "Bài này nói về...", "Tác giả chia sẻ...", "Theo nội dung này..."

**NGÔN NGỮ:**
- Viết tiếng Việt tự nhiên như đang nói chuyện
- Thuật ngữ tech giữ tiếng Anh: workflow, API, deploy, agent...
- Khi dùng từ tiếng Anh, giải thích ngắn gọn bằng tiếng Việt nếu cần
- KHÔNG dịch máy móc, KHÔNG câu dài lê thê
- KHÔNG dùng ký tự Trung/Nhật/Hàn

**VÍ DỤ CÁCH VIẾT TỰ NHIÊN:**
SAI: "AI biết khi nào cần hỏi người thay vì cố tự giải quyết"
ĐÚNG: "AI giờ biết lúc nào nên dừng lại hỏi mình, thay vì cứ cố làm sai"

SAI: "shift dev sang review và strategic work"
ĐÚNG: "dev giờ tập trung review code AI viết, thay vì tự gõ từ đầu"

SAI: "Mình tổng hợp 20 workflow mình chạy hàng ngày"
ĐÚNG: "Tác giả share 20 workflow họ đang chạy hàng ngày"

## Title
[Tạo tiêu đề tiếng Việt max 60 ký tự, nói thẳng giá trị chính của nội dung. KHÔNG copy nguyên tiêu đề gốc nếu quá dài]

## TL;DR
[2-3 câu ngắn. Nội dung này giúp gì cho người đọc?]

**Nói đơn giản:** [1 câu cho người không biết tech hiểu được]

## Mục lục nội dung
[Nếu là PDF/report/sách, liệt kê các phần chính:]
1. [Phần 1 - mô tả ngắn]
2. [Phần 2 - mô tả ngắn]
3. [Phần 3 - mô tả ngắn]
...

## Bài này dành cho ai?

### 1. Người muốn AI làm việc thay mình
**Vấn đề:** [đang gặp khó gì?]
**Khi nào cần:** [tình huống cụ thể]
**Được gì:** [kết quả + số liệu]

### 2. Người muốn build sản phẩm
**Vấn đề:** [đang gặp khó gì?]
**Khi nào cần:** [tình huống cụ thể]
**Được gì:** [kết quả cụ thể]

### 3. [Nhóm khác phù hợp nội dung]
**Vấn đề:** [đang gặp khó gì?]
**Khi nào cần:** [tình huống cụ thể]
**Được gì:** [kết quả cụ thể]

## Các điểm chính

**Mỗi điểm viết ngắn gọn, xuống dòng rõ ràng:**

1. **[Điểm chính - 1 câu]**
[Giải thích 1-2 câu, có số liệu hoặc ví dụ cụ thể]
→ Làm gì: [hành động cụ thể]

2. **[Điểm chính]**
[Giải thích ngắn]
→ Làm gì: [hành động]

3. **[Điểm chính]**
[Giải thích ngắn]
→ Làm gì: [hành động]

**Ví dụ cách viết đúng:**

1. **CLAUDE.md là config, hông phải documentation**
Claude có sẵn ~50 instruction. Thêm quá 150 cái thì chất lượng giảm đều.
→ Làm gì: Trước khi thêm instruction mới, hỏi "Cái này dùng cho 80% sessions hông?"

2. **Dev giờ review nhiều hơn code**
AI agents code nhanh gấp 10 lần senior dev. Việc của dev giờ là design system và kiểm tra output.
→ Làm gì: Học cách chia nhỏ task cho AI, thay vì tự code từ đầu.

## Quick Start
1. [Việc làm ngay tuần này - cụ thể, copy-paste được]
2. [Bước tiếp theo]

## Tags
[tag1, tag2, tag3, tag4, tag5]

---

# RULES
- Câu ngắn, dễ hiểu, như đang nói chuyện
- KHÔNG dịch word-by-word từ tiếng Anh
- KHÔNG câu dài hơn 25 từ
- KHÔNG dùng ký tự lạ (Trung/Nhật/Hàn)
- KHÔNG dùng emoji
- Mỗi điểm chính PHẢI xuống dòng riêng`;

const UNIFIED_PROMPT_EN = `${ROLE_PROMPT_EN}

# TASK
Create a recap in ENGLISH. Keep exact format headers.

**IMPORTANT - POSITION:**
- You are SHARING content you found, NOT the original author
- Write like: "Found this gem...", "This article shares..."
- DO NOT write as if you created the content
- Use: "The author explains...", "According to this..."

**IMPORTANT:**
- Short sentences, max 20 words each
- Each takeaway MUST have clear line breaks
- NO walls of text

## Title
[Create title max 60 chars, direct value. DO NOT copy original title if too long]

## TL;DR
[2-3 short sentences. What changes for the reader?]

**Simply put:** [1 sentence for non-tech people]

## Who Should Care

### 1. AI Office Orchestrator
**Pain point:** [1 sentence]
**Use when:** [1 sentence]
**Get:** [1 sentence with numbers]

### 2. Vibe Coder / Builder
**Pain point:** [1 sentence]
**Use when:** [1 sentence]
**Get:** [1 sentence]

### 3. [Group fitting content]
**Pain point:** [1 sentence]
**Use when:** [1 sentence]
**Get:** [1 sentence]

## Key Takeaways

**FORMAT REQUIRED - Each point 2-3 SHORT sentences, separate lines:**

1. **[Short insight]**
[1-2 sentences with specific numbers/tools]
→ Action: [What to do]

2. **[Short insight]**
[1-2 sentences]
→ Action: [What to do]

3. **[Short insight]**
[1-2 sentences]
→ Action: [What to do]

**Example:**

1. **CLAUDE.md is system config, not docs**
Claude has ~50 built-in instructions. Adding 150+ degrades quality.
→ Action: Ask "Does this apply to 80%+ sessions?" before adding.

2. **Writing code is no longer a core skill**
AI agents code 10x faster than senior devs. Value shifted to system design.
→ Action: Learn to decompose tasks for AI instead of coding manually.

## Quick Start
1. [Do THIS WEEK]
2. [Next step]

## Tags
[tag1, tag2, tag3, tag4, tag5]

---

# RULES
- SHORT sentences, max 20 words
- Each takeaway MUST have line breaks
- NO long paragraphs
- NO generic ("AI is transforming...", "In today's world...")
- NO hedging ("might", "could") — be direct
- NO emojis`;

function parseUnifiedResponse(response: string, fallbackTitle?: string): RecapResult {
    const sections: Record<string, string> = {};
    const lines = response.split('\n');
    let currentSection = '';
    let currentContent: string[] = [];

    for (const line of lines) {
        const headerMatch = line.match(/^##\s+(.+)/);
        if (headerMatch) {
            if (currentSection && currentContent.length > 0) {
                sections[currentSection.toLowerCase()] = currentContent.join('\n').trim();
            }
            currentSection = headerMatch[1];
            currentContent = [];
        } else if (currentSection) {
            currentContent.push(line);
        }
    }
    if (currentSection && currentContent.length > 0) {
        sections[currentSection.toLowerCase()] = currentContent.join('\n').trim();
    }

    // Parse tags
    const tagsRaw = sections['tags'] || '';
    const tags = tagsRaw
        .split(',')
        .map(t => t.trim().toLowerCase().replace(/[^a-z0-9-]/g, ''))
        .filter(t => t.length > 0);

    // Strip markdown formatting from title (bold, italic, quotes)
    const rawTitle = sections['title'] || fallbackTitle || 'Untitled';
    const cleanTitle = rawTitle
        .replace(/^\*\*|\*\*$/g, '')  // Remove **bold**
        .replace(/^\*|\*$/g, '')       // Remove *italic*
        .replace(/^["']|["']$/g, '')   // Remove quotes
        .replace(/^#+\s*/, '')         // Remove # headers
        .trim();

    return {
        title: cleanTitle,
        tldr: sections['tl;dr'] || sections['tldr'] || '',
        toc: sections['mục lục nội dung'] || sections['table of contents'] || undefined,
        audiences: sections['bài này dành cho ai?'] || sections['who should care'] || '',
        takeaways: sections['các điểm chính'] || sections['key takeaways'] || '',
        quickStart: sections['quick start'] || '',
        tags: tags.length > 0 ? tags : ['general'],
    };
}

export async function regenerateRecapWithFeedback(
    env: GeminiEnv,
    content: string,
    currentRecap: RecapResult,
    feedback: string,
    lang: RecapLang = 'vi',
): Promise<RecapResult> {
    const langLabel = lang === 'vi' ? 'Vietnamese' : 'English';

    const prompt = `You previously generated this recap:
---
## TL;DR
${currentRecap.tldr}

## Key Takeaways
${currentRecap.takeaways}

## Who Should Care
${currentRecap.audiences}

## Quick Start
${currentRecap.quickStart}

Tags: ${currentRecap.tags.join(', ')}
---

User feedback: "${feedback}"

Regenerate the COMPLETE recap addressing this feedback.
Keep the same structure but improve based on feedback.
Language: ${langLabel}

Output format (use exact headers):
## Title
[title here]

## TL;DR
[2-3 sentences]

## Key Takeaways
[numbered list, 3-5 items]

## Who Should Care
[3 audiences with use case and benefit]

## Quick Start
[2-3 actions]

## Tags
[comma-separated]`;

    const response = await callGemini(env, prompt, content, 0.5);

    // Parse the response
    return parseRecapResponse(response, currentRecap);
}

function parseRecapResponse(response: string, fallback: RecapResult): RecapResult {
    const sections: Record<string, string> = {};
    const lines = response.split('\n');
    let currentSection = '';
    let currentContent: string[] = [];

    for (const line of lines) {
        const headerMatch = line.match(/^##\s+(.+)/);
        if (headerMatch) {
            if (currentSection && currentContent.length > 0) {
                sections[currentSection.toLowerCase()] = currentContent.join('\n').trim();
            }
            currentSection = headerMatch[1];
            currentContent = [];
        } else if (currentSection) {
            currentContent.push(line);
        }
    }
    // Don't forget last section
    if (currentSection && currentContent.length > 0) {
        sections[currentSection.toLowerCase()] = currentContent.join('\n').trim();
    }

    // Parse tags
    const tagsRaw = sections['tags'] || fallback.tags.join(', ');
    const tags = tagsRaw
        .split(',')
        .map(t => t.trim().toLowerCase().replace(/[^a-z0-9-]/g, ''))
        .filter(t => t.length > 0);

    return {
        title: sections['title'] || fallback.title,
        tldr: sections['tl;dr'] || sections['tldr'] || fallback.tldr,
        takeaways: sections['key takeaways'] || fallback.takeaways,
        audiences: sections['who should care'] || fallback.audiences,
        quickStart: sections['quick start'] || fallback.quickStart,
        tags: tags.length > 0 ? tags : fallback.tags,
    };
}
