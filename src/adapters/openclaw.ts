import { safeExec } from '../util/exec.js';
import type { Adapter, UpdateResult } from './types.js';

export const openClawAdapter: Adapter = {
  id: 'openclaw',
  displayName: 'OpenClaw',

  async detect() {
    const r = await safeExec('openclaw', ['--version']);
    if (!r.ok) return { installed: false };
    const version = r.stdout.match(/v?(\d+\.\d+\.\d+)/)?.[1];
    return { installed: true, version };
  },

  async check() {
    return {
      updates: [],
      coverage: 'unavailable' as const,
      note: 'OpenClaw exposes mutating update commands without a reliable read-only plan'
    };
  },

  async update() {
    const updated: string[] = [];
    const unchanged: string[] = [];
    const failed: UpdateResult['failed'] = [];
    const logs: string[] = [];

    const before = await openClawAdapter.detect();
    const cliResult = await safeExec('openclaw', ['update', '--channel', 'stable']);
    logs.push(cliResult.stdout);
    if (cliResult.ok) {
      const after = await openClawAdapter.detect();
      if (before.version && after.version && before.version !== after.version) updated.push(`openclaw-cli@${after.version}`);
      else unchanged.push(`openclaw-cli@${after.version ?? before.version ?? 'current'}`);
    } else {
      failed.push({ item: 'openclaw-cli', error: cliResult.stderr || 'update failed' });
    }

    const skillsResult = await safeExec('openclaw', ['skills', 'update']);
    logs.push(skillsResult.stdout);
    if (skillsResult.ok) {
      const count = skillsResult.stdout.match(/Updated\s+(\d+)\s+skill/i)?.[1];
      if (count && Number(count) > 0) updated.push(`${count} openclaw-skills`);
      else unchanged.push('openclaw-skills');
    } else {
      failed.push({ item: 'openclaw-skills', error: skillsResult.stderr || 'update failed' });
    }

    return {
      updated,
      unchanged,
      failed,
      logs: logs.filter(Boolean).join('\n')
    };
  }
};
