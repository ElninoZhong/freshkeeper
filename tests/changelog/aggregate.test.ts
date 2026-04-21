import { describe, it, expect, vi } from 'vitest';
import { aggregateChangelog } from '../../src/changelog/aggregate.js';

describe('aggregateChangelog', () => {
  it('fetches release notes for each adapter with a known repo', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tag_name: 'v1', body: 'body', html_url: 'https://x' })
    } as any);
    const r = await aggregateChangelog([
      { id: 'claude-code', repo: 'anthropics/claude-code' },
      { id: 'unknown', repo: undefined }
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].adapter).toBe('claude-code');
  });

  it('skips adapters with no repo mapping', async () => {
    const r = await aggregateChangelog([{ id: 'no-repo', repo: undefined }]);
    expect(r).toEqual([]);
  });
});
