/**
 * Media Handler — Downloads external media and uploads to R2.
 * Supports: HTTP URLs, base64 data URIs, and direct file uploads.
 */
import type { MediaAttachment } from './index';

/**
 * Direct file upload parameters (for multipart form uploads)
 */
export interface DirectUpload {
    /** Field name in frontmatter to update with the R2 URL */
    field: string;
    /** File data as ArrayBuffer */
    data: ArrayBuffer;
    /** Desired filename in R2 */
    filename: string;
    /** MIME type */
    contentType: string;
}

/**
 * Upload file data directly to R2.
 * Used for multipart form uploads where file is already in memory.
 */
export async function uploadFileDirect(
    bucket: R2Bucket,
    upload: DirectUpload,
    slug: string,
    mediaBaseUrl: string,
): Promise<string> {
    const { data, filename, contentType } = upload;

    const mediaType = getMediaType(contentType);
    const key = `${mediaType}/${slug}/${filename}`;

    // Check if already exists
    const existing = await bucket.head(key);
    if (existing) {
        return `${mediaBaseUrl}/${key}`;
    }

    // Upload to R2
    await bucket.put(key, data, {
        httpMetadata: { contentType },
        customMetadata: {
            slug,
            sourceUrl: 'direct-upload',
            uploadedAt: new Date().toISOString(),
        },
    });

    return `${mediaBaseUrl}/${key}`;
}

/**
 * Download media from source URL and upload to R2.
 * Returns the public R2 URL.
 */
export async function uploadMedia(
    bucket: R2Bucket,
    attachment: MediaAttachment,
    slug: string,
    mediaBaseUrl: string,
): Promise<string> {
    const { sourceUrl, filename, contentType } = attachment;

    // Determine R2 key based on content type
    const mediaType = getMediaType(contentType || 'application/octet-stream');
    const key = `${mediaType}/${slug}/${filename}`;

    // Check if already exists in R2
    const existing = await bucket.head(key);
    if (existing) {
        return `${mediaBaseUrl}/${key}`;
    }

    // Download from source
    let data: ArrayBuffer;

    if (sourceUrl.startsWith('data:')) {
        // Handle base64 data URIs
        const base64 = sourceUrl.split(',')[1];
        data = Uint8Array.from(atob(base64), c => c.charCodeAt(0)).buffer;
    } else {
        // Download from HTTP URL
        const res = await fetch(sourceUrl, {
            headers: { 'User-Agent': 'vilab-ingest/1.0' },
        });
        if (!res.ok) {
            throw new Error(`Failed to download ${sourceUrl}: ${res.status} ${res.statusText}`);
        }
        data = await res.arrayBuffer();
    }

    // Upload to R2
    await bucket.put(key, data, {
        httpMetadata: {
            contentType: contentType || guessContentType(filename),
        },
        customMetadata: {
            slug,
            sourceUrl: sourceUrl.startsWith('data:') ? 'base64-upload' : sourceUrl,
            uploadedAt: new Date().toISOString(),
        },
    });

    return `${mediaBaseUrl}/${key}`;
}

function getMediaType(contentType: string): string {
    if (contentType.startsWith('image/')) return 'images';
    if (contentType.startsWith('audio/')) return 'audio';
    if (contentType.startsWith('video/')) return 'video';
    if (contentType === 'application/pdf') return 'pdf';
    return 'files';
}

function guessContentType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    const types: Record<string, string> = {
        webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
        gif: 'image/gif', svg: 'image/svg+xml',
        mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
        mp4: 'video/mp4', webm: 'video/webm',
    };
    return types[ext || ''] || 'application/octet-stream';
}
