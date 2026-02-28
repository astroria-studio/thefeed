/**
 * /[slug].md — Serve post content as Markdown for AI agents.
 * Returns clean markdown with frontmatter for LLM consumption.
 */
import type { APIRoute } from "astro";
import { getCollection, render } from "astro:content";
import { getPost } from "../lib/data";
import type { ArticlePost, AudioPost, AudioPlaylistPost, GalleryPost } from "../lib/types";

export const GET: APIRoute = async ({ params }) => {
    const rawSlug = params.slug || "";
    const slug = rawSlug.replace(/\/+$/, "");

    const post = await getPost(slug);

    if (!post) {
        return new Response("# 404 Not Found\n\nThis page does not exist.", {
            status: 404,
            headers: { "Content-Type": "text/markdown; charset=utf-8" },
        });
    }

    // Build markdown content
    let md = "";

    // Frontmatter-style header
    md += `# ${post.title}\n\n`;

    if (post.subtitle) {
        md += `> ${post.subtitle}\n\n`;
    }

    md += `**Format:** ${post.format}  \n`;
    md += `**Date:** ${new Date(post.date).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}  \n`;

    if (post.tags.length > 0) {
        md += `**Tags:** ${post.tags.map(t => `#${t}`).join(", ")}  \n`;
    }

    md += `**URL:** https://arealisticdreamer.com/${post.slug}\n\n`;
    md += `---\n\n`;

    // Format-specific content
    if (post.format === "article") {
        const a = post as ArticlePost;

        if (a.pattern) {
            md += `## Pattern\n\n${a.pattern}\n\n`;
        }

        if (a.content) {
            // Strip HTML tags for cleaner markdown
            const cleanContent = a.content
                .replace(/<[^>]+>/g, "")
                .replace(/&nbsp;/g, " ")
                .replace(/&amp;/g, "&")
                .replace(/&lt;/g, "<")
                .replace(/&gt;/g, ">")
                .replace(/&quot;/g, '"');
            md += `## Content\n\n${cleanContent}\n\n`;
        } else if (a.take) {
            md += `## Tony's Take\n\n${a.take}\n\n`;

            if (a.works) {
                md += `### What Works\n\n${a.works}\n\n`;
            }

            if (a.different) {
                md += `### What's Different\n\n${a.different}\n\n`;
            }
        } else {
            // Try to get MDX body content
            const entries = await getCollection("posts");
            const entry = entries.find((e) => e.id.replace(/\.mdx?$/, "") === slug);
            if (entry?.body) {
                md += `## Content\n\n${entry.body}\n\n`;
            }
        }

        if (a.tools && a.tools.length > 0) {
            md += `## Tools Used\n\n${a.tools.map(t => `- ${t}`).join("\n")}\n\n`;
        }

        if (a.heroImage) {
            md += `## Hero Image\n\n![${a.title}](${a.heroImage})\n\n`;
        }
    } else if (post.format === "quote") {
        md += `## Quote\n\n`;
        md += `> "${post.quoteText}"\n\n`;
        if (post.attribution) {
            md += `— ${post.attribution}\n\n`;
        }
    } else if (post.format === "audio") {
        const a = post as AudioPost;
        md += `## Audio\n\n`;
        md += `**Duration:** ${Math.floor(a.duration / 60)}:${(a.duration % 60).toString().padStart(2, "0")}\n\n`;
        md += `[Listen to audio](${a.audioUrl})\n\n`;
    } else if (post.format === "audio-playlist") {
        const pl = post as AudioPlaylistPost;
        md += `## Playlist\n\n`;
        pl.tracks.forEach((track, i) => {
            const dur = `${Math.floor(track.duration / 60)}:${(track.duration % 60).toString().padStart(2, "0")}`;
            md += `${i + 1}. **${track.title}** (${dur})${track.artist ? ` - ${track.artist}` : ""}\n`;
        });
        md += `\n`;
    } else if (post.format === "gallery") {
        const g = post as GalleryPost;
        md += `## Gallery\n\n`;
        md += `${g.images.length} images\n\n`;
        g.images.forEach((img, i) => {
            md += `![Image ${i + 1}${img.caption ? `: ${img.caption}` : ""}](${img.url})\n\n`;
        });
    } else if (post.format === "video-embed") {
        md += `## Video\n\n`;
        md += `This post contains an embedded video. View it at: https://arealisticdreamer.com/${post.slug}\n\n`;
    } else if (post.format === "short-video") {
        md += `## Short Video\n\n`;
        md += `This post contains a short video. View it at: https://arealisticdreamer.com/${post.slug}\n\n`;
    }

    // Footer
    md += `---\n\n`;
    md += `*This markdown was generated for AI consumption from [A Realistic Dreamer](https://arealisticdreamer.com).*\n`;

    // Token estimate header
    const tokenEstimate = Math.ceil(md.length / 4);

    return new Response(md, {
        status: 200,
        headers: {
            "Content-Type": "text/markdown; charset=utf-8",
            "x-markdown-tokens": tokenEstimate.toString(),
            "Cache-Control": "public, max-age=3600",
        },
    });
};
