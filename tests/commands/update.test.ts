import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { Registry } from '../../src/adapters/registry.js';
import { printUpdate, runUpdate } from '../../src/commands/update.js';
import type { Adapter } from '../../src/adapters/types.js';

vi.mock('ora', () => ({
  default: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    stop: vi.fn()
  }))
}));

vi.mock('../../src/changelog/aggregate.js', () => ({
  aggregateChangelog: vi.fn().mockResolvedValue([]),
  ADAPTER_REPOS: {}
}));

let previousExitCode: number | undefined;

beforeEach(() => {
  previousExitCode = process.exitCode;
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = previousExitCode;
});

const mkAdapter = (
  id: string,
  updated: string[],
  failed: any[] = [],
  skipped: any[] = [],
  warnings: string[] = []
): Adapter => ({
  id, displayName: id,
  async detect() { return { installed: true }; },
  async check() { return []; },
  async update() { return { updated, failed, skipped, warnings, logs: `log-of-${id}` }; }
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

  it('passes enabled adapter ownership context through the update seam', async () => {
    const r = new Registry();
    let enabledAdapterIds: string[] | undefined;
    r.register({
      id: 'mcp-components',
      displayName: 'MCP Components',
      async detect() { return { installed: true }; },
      async check() { return []; },
      async update(context) {
        enabledAdapterIds = context?.enabledAdapterIds;
        return { updated: [], failed: [], logs: '' };
      }
    });
    r.register(mkAdapter('claude-plugins', []));

    await runUpdate(r);

    expect(enabledAdapterIds).toEqual(['mcp-components', 'claude-plugins']);
  });

  it('captures failures without throwing', async () => {
    const r = new Registry();
    r.register(mkAdapter('a', [], [{ item: 'x', error: 'boom' }]));
    const report = await runUpdate(r);
    expect(report.totalFailed).toBe(1);
  });

  it('preserves explicit MCP skips and warnings without counting them as failures', async () => {
    const r = new Registry();
    r.register(mkAdapter(
      'mcp-components',
      ['claude-mem@13.18.0'],
      [],
      [{ item: 'gbrain', reason: 'requires backup' }],
      ['restart Claude']
    ));

    const report = await runUpdate(r);

    expect(report.totalUpdated).toBe(1);
    expect(report.totalFailed).toBe(0);
    expect(report.totalSkipped).toBe(1);
    expect(report.perAdapter[0]?.result.warnings).toEqual(['restart Claude']);
  });

  it('sets a failing process exit code when any adapter update fails', async () => {
    const r = new Registry();
    r.register(mkAdapter('a', [], [{ item: 'x', error: 'boom' }]));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const report = await printUpdate(r);

    expect(report.totalFailed).toBe(1);
    expect(process.exitCode).toBe(1);
  });
});
