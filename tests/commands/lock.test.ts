import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Registry } from '../../src/adapters/registry.js';
import { runLock } from '../../src/commands/lock.js';
import type { Adapter } from '../../src/adapters/types.js';

describe('lock command', () => {
  it('captures only installed, enabled, lock-capable adapters', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'freshkeeper-command-lock-'));
    const registry = new Registry();
    const adapter: Adapter = {
      id: 'claude-code',
      displayName: 'Claude Code',
      async detect() { return { installed: true, version: '2.1.116' }; },
      async check() { return []; },
      async update() { return { updated: [], failed: [], logs: '' }; },
      async captureLock() { return { adapter: 'claude-code', version: '2.1.116' }; },
      async restoreLock() { return { updated: [], failed: [], logs: '' }; }
    };
    registry.register(adapter);

    const result = await runLock(registry, projectDir);
    const written = JSON.parse(readFileSync(result.lockPath, 'utf-8'));

    expect(result.adapterIds).toEqual(['claude-code']);
    expect(written.adapters['claude-code'].version).toBe('2.1.116');
  });
});
