import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Registry } from '../../src/adapters/registry.js';
import { runRestore } from '../../src/commands/restore.js';
import { writeProjectLock } from '../../src/lockfile.js';
import type { Adapter } from '../../src/adapters/types.js';

describe('restore command', () => {
  it('restores locked adapters through the enabled registry', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'freshkeeper-command-restore-'));
    writeProjectLock({
      version: 1,
      adapters: {
        'claude-code': { adapter: 'claude-code', version: '2.1.116' }
      }
    }, projectDir);

    const registry = new Registry();
    const adapter: Adapter = {
      id: 'claude-code',
      displayName: 'Claude Code',
      async detect() { return { installed: true, version: '2.1.115' }; },
      async check() { return { updates: [], coverage: 'complete' }; },
      async update() { throw new Error('normal update must not run'); },
      async captureLock() { return { adapter: 'claude-code', version: '2.1.115' }; },
      async restoreLock(lock) {
        expect(lock).toEqual({ adapter: 'claude-code', version: '2.1.116' });
        return { updated: ['claude-code@2.1.116'], failed: [], logs: 'restored' };
      }
    };
    registry.register(adapter);

    const report = await runRestore(registry, projectDir);

    expect(report.totalUpdated).toBe(1);
    expect(report.totalFailed).toBe(0);
    expect(report.perAdapter[0]?.id).toBe('claude-code');
  });

  it('does not touch adapters omitted by enabledAdapters', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'freshkeeper-command-disabled-'));
    writeProjectLock({
      version: 1,
      adapters: {
        'claude-code': { adapter: 'claude-code', version: '2.1.116' }
      }
    }, projectDir);

    const report = await runRestore(new Registry(), projectDir);

    expect(report.perAdapter).toEqual([]);
    expect(report.skipped).toEqual(['claude-code']);
  });
});
