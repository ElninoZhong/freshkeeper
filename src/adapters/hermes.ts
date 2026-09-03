import { safeExec } from '../util/exec.js';
import type { Adapter } from './types.js';

export const hermesAdapter: Adapter = {
  id: 'hermes',
  displayName: 'Hermes Agent',

  async detect() {
    const r = await safeExec('hermes', ['version']);
    if (!r.ok) return { installed: false };
    const version = r.stdout.match(/(\d+\.\d+\.\d+)/)?.[1];
    return { installed: true, version };
  },

  async check() {
    return {
      updates: [],
      coverage: 'unavailable' as const,
      note: 'Hermes exposes mutating update commands without a reliable read-only plan'
    };
  },

  async update() {
    const updated: string[] = [];
    const unchanged: string[] = [];
    const failed: Array<{ item: string; error: string }> = [];
    const logs: string[] = [];

    const before = await hermesAdapter.detect();
    const cli = await safeExec('hermes', ['update']);
    logs.push(`[cli] ${cli.stdout.trim()}`);
    if (cli.ok) {
      const after = await hermesAdapter.detect();
      if (before.version && after.version && before.version !== after.version) updated.push(`hermes-cli@${after.version}`);
      else unchanged.push(`hermes-cli@${after.version ?? before.version ?? 'current'}`);
    }
    else failed.push({ item: 'hermes-cli', error: cli.stderr || cli.error || 'update failed' });

    const skills = await safeExec('hermes', ['skills', 'update']);
    logs.push(`[skills] ${skills.stdout.trim()}`);
    if (skills.ok) {
      const count = skills.stdout.match(/Updated\s+(\d+)\s+skill/i)?.[1];
      if (count && Number(count) > 0) updated.push(`${count} hermes-skills`);
      else unchanged.push('hermes-skills');
    }
    else failed.push({ item: 'hermes-skills', error: skills.stderr || skills.error || 'skills update failed' });

    return { updated, unchanged, failed, logs: logs.join('\n') };
  }
};
