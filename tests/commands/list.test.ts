import { describe, it, expect } from 'vitest';
import { Registry } from '../../src/adapters/registry.js';
import { runList } from '../../src/commands/list.js';
import type { Adapter } from '../../src/adapters/types.js';

const makeAdapter = (id: string, installed: boolean, version?: string): Adapter => ({
  id,
  displayName: id,
  async detect() { return { installed, version }; },
  async check() { return []; },
  async update() { return { updated: [], failed: [], logs: '' }; }
});

describe('list command', () => {
  it('returns rows with detection results for each adapter', async () => {
    const r = new Registry();
    r.register(makeAdapter('a', true, '1.0'));
    r.register(makeAdapter('b', false));
    const rows = await runList(r);
    expect(rows).toEqual([
      { id: 'a', installed: true, version: '1.0' },
      { id: 'b', installed: false, version: undefined }
    ]);
  });
});
