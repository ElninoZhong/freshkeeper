export interface ReleaseNote {
  tag: string;
  body: string;
  url: string;
}

export async function fetchReleaseNotes(repo: string): Promise<ReleaseNote | null> {
  try {
    const url = `https://api.github.com/repos/${repo}/releases/latest`;
    const headers: Record<string, string> = { 'Accept': 'application/vnd.github+json' };
    if (process.env.GITHUB_TOKEN) headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;

    const r = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return null;
    const data = await r.json() as { tag_name: string; body: string; html_url: string };
    return { tag: data.tag_name, body: data.body, url: data.html_url };
  } catch {
    return null;
  }
}
