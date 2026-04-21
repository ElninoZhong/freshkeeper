import { describe, it, expect, vi } from 'vitest';
import { fetchReleaseNotes } from '../../src/changelog/github.js';

describe('fetchReleaseNotes', () => {
  it('fetches latest release body from GitHub API', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tag_name: 'v1.2.3', body: 'release notes here', html_url: 'https://x' })
    } as any);

    const r = await fetchReleaseNotes('owner/repo');
    expect(r).toEqual({ tag: 'v1.2.3', body: 'release notes here', url: 'https://x' });
  });

  it('returns null on 404', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 } as any);
    expect(await fetchReleaseNotes('owner/missing')).toBeNull();
  });
});
