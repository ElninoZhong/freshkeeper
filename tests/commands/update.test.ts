import { describe, it, expect } from 'vitest';
import { Registry } from '../../src/adapters/registry.js';
import { runUpdate } from '../../src/commands/update.js';
import type { Adapter } from '../../src/adapters/types.js';

const mkAdapter = (id: string, updated: string[], failed: any[] = []): Adapter => ({
  id, displayName: id,
  async detect() { return { installed: true }; },
  async check() { return []; },
  async update() { return { updated, failed, logs: `log-of-${id}` }; }
});

describe('update command', () => {
  it('runs update across all installed adapters and aggregates', async () => {
    const r = new Registry();
    r.register(mkAdapter('a', ['a1']));
    r.register(mkAdapter('b', ['b1', 'b2']));
    const report = await runUpdate(r);
    expect(report.totalUpdated).toBe(3);
    expect(report.perAdapter).toHaveLength(2);
  });

  it('captures failures without throwing', async () => {
    const r = new Registry();
    r.register(mkAdapter('a', [], [{ item: 'x', error: 'boom' }]));
    const report = await runUpdate(r);
    expect(report.totalFailed).toBe(1);
  });
});
