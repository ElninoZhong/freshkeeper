import { describe, it, expect } from 'vitest';
import { Registry } from '../../src/adapters/registry.js';
import { runCheck } from '../../src/commands/check.js';
import type { Adapter } from '../../src/adapters/types.js';

const mkAdapter = (id: string, updates: any[]): Adapter => ({
  id,
  displayName: id,
  async detect() { return { installed: true, version: '1' }; },
  async check() { return updates; },
  async update() { return { updated: [], failed: [], logs: '' }; }
});

describe('check command', () => {
  it('aggregates updates across adapters', async () => {
    const r = new Registry();
    r.register(mkAdapter('a', [{ item: 'pkg-1', currentVersion: '1.0', latestVersion: '1.1' }]));
    r.register(mkAdapter('b', []));
    const results = await runCheck(r);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ adapter: 'a', item: 'pkg-1' });
  });

  it('skips not-installed adapters', async () => {
    const r = new Registry();
    r.register({
      id: 'gone', displayName: 'g',
      async detect() { return { installed: false }; },
      async check() { throw new Error('should not be called'); },
      async update() { return { updated: [], failed: [], logs: '' }; }
    });
    const results = await runCheck(r);
    expect(results).toEqual([]);
  });
});
