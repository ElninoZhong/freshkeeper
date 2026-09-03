import { safeExec } from '../util/exec.js';
import type { Adapter } from './types.js';

export const claudeCodeAdapter: Adapter = {
  id: 'claude-code',
  displayName: 'Claude Code CLI',

  async detect() {
    const r = await safeExec('claude', ['--version']);
    if (!r.ok) return { installed: false };
    const match = r.stdout.match(/(\d+\.\d+\.\d+)/);
    return { installed: true, version: match?.[1], installMethod: 'native' };
  },

  async check() {
    return {
      updates: [],
      coverage: 'unavailable' as const,
      note: '`claude update` does not expose a non-mutating version preflight'
    };
  },

  async update() {
    const before = await claudeCodeAdapter.detect();
    const r = await safeExec('claude', ['update']);
    const after = r.ok ? await claudeCodeAdapter.detect() : { installed: false };
    const changed = Boolean(
      r.ok
      && before.version
      && after.version
      && before.version !== after.version
    );
    return {
      updated: changed ? [`claude-code@${after.version}`] : [],
      unchanged: r.ok && !changed ? [`claude-code@${after.version ?? before.version ?? 'current'}`] : [],
      failed: r.ok ? [] : [{ item: 'claude-code', error: r.stderr || r.error || 'unknown' }],
      logs: r.stdout + (r.stderr ? `\n${r.stderr}` : '')
    };
  },

  async captureLock() {
    const detected = await claudeCodeAdapter.detect();
    if (!detected.installed || !detected.version) {
      throw new Error('Cannot lock Claude Code because its exact version could not be detected');
    }
    return { adapter: 'claude-code', version: detected.version };
  },

  async restoreLock(lock) {
    if (lock.adapter !== 'claude-code') {
      return { updated: [], failed: [{ item: 'claude-code', error: 'invalid lock entry' }], logs: '' };
    }
    const before = await claudeCodeAdapter.detect();
    if (before.installed && before.version === lock.version) {
      return { updated: [], failed: [], logs: `Claude Code already matches ${lock.version}` };
    }

    const install = await safeExec('claude', ['install', lock.version, '--force']);
    if (!install.ok) {
      return {
        updated: [],
        failed: [{ item: 'claude-code', error: install.stderr || install.error || 'install failed' }],
        logs: install.stdout
      };
    }
    const after = await claudeCodeAdapter.detect();
    if (!after.installed || after.version !== lock.version) {
      return {
        updated: [],
        failed: [{ item: 'claude-code', error: `expected ${lock.version}, detected ${after.version ?? 'unknown'}` }],
        logs: install.stdout
      };
    }
    return { updated: [`claude-code@${lock.version}`], failed: [], logs: install.stdout };
  }
};
