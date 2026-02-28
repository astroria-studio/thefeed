/**
 * MDX Generator — Builds MDX content from structured data.
 */

/**
 * Generate an MDX file string from frontmatter object + optional body.
 * Body content is automatically sanitized to be MDX-safe.
 */
export function generateMDX(frontmatter: Record<string, unknown>, body?: string): string {
    const yaml = serializeYAML(frontmatter);
    const parts = ['---', yaml, '---'];

    if (body && body.trim()) {
        parts.push('');
        parts.push(sanitizeMDXBody(body.trim()));
    }

    parts.push(''); // trailing newline
    return parts.join('\n');
}

/**
 * Sanitize body content for MDX compatibility.
 * MDX treats bare < { } as JSX syntax — escape them to HTML entities
 * while preserving valid markdown (images, links, code blocks, inline code).
 */
function sanitizeMDXBody(body: string): string {
    const lines = body.split('\n');
    const result: string[] = [];
    let inCodeBlock = false;

    for (const line of lines) {
        // Track fenced code blocks
        if (line.trim().startsWith('```')) {
            inCodeBlock = !inCodeBlock;
            result.push(line);
            continue;
        }

        // Don't touch anything inside code blocks
        if (inCodeBlock) {
            result.push(line);
            continue;
        }

        // Escape bare < not followed by a valid HTML tag start (letter, /, !)
        let escaped = line.replace(/<(?![a-zA-Z/!])/g, '&lt;');

        // Escape { } outside inline code spans
        const codeParts = escaped.split(/(`[^`]+`)/);
        escaped = codeParts
            .map((part) => {
                if (part.startsWith('`') && part.endsWith('`')) {
                    return part; // preserve inline code
                }
                return part.replace(/\{/g, '&#123;').replace(/\}/g, '&#125;');
            })
            .join('');

        result.push(escaped);
    }

    return result.join('\n');
}

/**
 * Serialize a flat/nested object to YAML frontmatter.
 * Handles: strings, numbers, booleans, arrays, nested objects.
 */
function serializeYAML(obj: Record<string, unknown>, indent = 0): string {
    const lines: string[] = [];
    const prefix = '  '.repeat(indent);

    for (const [key, value] of Object.entries(obj)) {
        if (value === undefined || value === null) continue;

        if (Array.isArray(value)) {
            if (value.length === 0) {
                lines.push(`${prefix}${key}: []`);
            } else if (typeof value[0] === 'object' && value[0] !== null) {
                // Array of objects (e.g., tracks, images)
                lines.push(`${prefix}${key}:`);
                for (const item of value) {
                    const itemLines = serializeYAML(item as Record<string, unknown>, indent + 1).split('\n');
                    if (itemLines.length > 0) {
                        lines.push(`${prefix}  - ${itemLines[0].trim()}`);
                        for (let i = 1; i < itemLines.length; i++) {
                            if (itemLines[i].trim()) {
                                lines.push(`${prefix}    ${itemLines[i].trim()}`);
                            }
                        }
                    }
                }
            } else {
                // Simple array — inline format
                const items = value.map(v => typeof v === 'string' ? v : String(v));
                lines.push(`${prefix}${key}: [${items.join(', ')}]`);
            }
        } else if (typeof value === 'object' && value !== null) {
            lines.push(`${prefix}${key}:`);
            lines.push(serializeYAML(value as Record<string, unknown>, indent + 1));
        } else if (typeof value === 'string') {
            // Quote strings that contain special YAML chars
            if (value.includes(':') || value.includes('#') || value.includes('"') || value.includes("'") || value.includes('\n') || value.startsWith('[') || value.startsWith('{')) {
                lines.push(`${prefix}${key}: "${value.replace(/"/g, '\\"')}"`);
            } else {
                lines.push(`${prefix}${key}: "${value}"`);
            }
        } else {
            // Numbers, booleans
            lines.push(`${prefix}${key}: ${value}`);
        }
    }

    return lines.join('\n');
}
