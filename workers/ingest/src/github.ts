/**
 * GitHub Adapter — Push files to a GitHub repo via the Contents API.
 */
import type { Env } from './index';

/**
 * Create or update a file on the target branch via GitHub Contents API.
 * Returns the commit SHA on success.
 */
export async function pushToGitHub(
    env: Env,
    path: string,
    content: string,
    message: string,
): Promise<string> {
    const apiBase = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}`;
    const headers = {
        Authorization: `token ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'vilab-ingest',
        'Content-Type': 'application/json',
    };

    // Check if file already exists (need SHA for update)
    let existingSha: string | undefined;
    const getRes = await fetch(`${apiBase}?ref=${env.GITHUB_BRANCH}`, { headers });
    if (getRes.ok) {
        const existing = await getRes.json<{ sha: string }>();
        existingSha = existing.sha;
    }

    // Create/update file
    const body: Record<string, string> = {
        message,
        content: btoa(unescape(encodeURIComponent(content))), // UTF-8 safe base64
        branch: env.GITHUB_BRANCH,
    };

    if (existingSha) {
        body.sha = existingSha;
    }

    const putRes = await fetch(apiBase, {
        method: 'PUT',
        headers,
        body: JSON.stringify(body),
    });

    if (!putRes.ok) {
        const err = await putRes.text();
        throw new Error(`GitHub push failed (${putRes.status}): ${err}`);
    }

    const result = await putRes.json<{ commit: { sha: string } }>();
    return result.commit.sha;
}

/**
 * Create a pull request from draft → main.
 */
export async function createPR(env: Env, title: string, body: string): Promise<string> {
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
        throw new Error(`PR creation failed (${res.status}): ${err}`);
    }

    const pr = await res.json<{ html_url: string }>();
    return pr.html_url;
}
