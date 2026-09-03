import { describe, it, expect, vi } from 'vitest';
import { Registry } from '../../src/adapters/registry.js';
import { printCheck, runCheck } from '../../src/commands/check.js';
import type { Adapter } from '../../src/adapters/types.js';

const mkAdapter = (id: string, updates: any[]): Adapter => ({
  id,
  displayName: id,
  async detect() { return { installed: true, version: '1' }; },
  async check() { return { updates, coverage: 'complete' }; },
  async update() { return { updated: [], failed: [], logs: '' }; }
});

describe('check command', () => {
  it('aggregates updates across adapters', async () => {
    const r = new Registry();
    r.register(mkAdapter('a', [{ item: 'pkg-1', currentVersion: '1.0', latestVersion: '1.1' }]));
    r.register(mkAdapter('b', []));
    const results = await runCheck(r);
    expect(results.updates).toHaveLength(1);
    expect(results.updates[0]).toMatchObject({ adapter: 'a', item: 'pkg-1' });
    expect(results.totalComplete).toBe(2);
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
    expect(results.updates).toEqual([]);
    expect(results.perAdapter).toEqual([]);
  });

  it('reports unavailable coverage instead of claiming all components are current', async () => {
    const r = new Registry();
    r.register({
      id: 'unknown',
      displayName: 'unknown',
      async detect() { return { installed: true }; },
      async check() {
        return { updates: [], coverage: 'unavailable', note: 'no read-only upstream query' };
      },
      async update() { return { updated: [], failed: [], logs: '' }; }
    });

    const results = await runCheck(r);

    expect(results.totalUnavailable).toBe(1);
    expect(results.totalComplete).toBe(0);
    expect(results.perAdapter[0]?.note).toMatch(/read-only/i);
  });

  it('never prints an all-current success when coverage is incomplete', async () => {
    const r = new Registry();
    r.register({
      id: 'unknown',
      displayName: 'unknown',
      async detect() { return { installed: true }; },
      async check() { return { updates: [], coverage: 'unavailable', note: 'no preflight' }; },
      async update() { return { updated: [], failed: [], logs: '' }; }
    });
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await printCheck(r);

    const text = output.mock.calls.flat().join(' ');
    expect(text).toContain('not an all-current result');
    expect(text).not.toContain('No pending updates detected');
  });
});
