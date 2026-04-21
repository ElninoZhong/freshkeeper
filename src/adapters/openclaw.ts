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
    return [];
  },

  async update() {
    const updated: string[] = [];
    const failed: UpdateResult['failed'] = [];
    const logs: string[] = [];

    const cliResult = await safeExec('openclaw', ['update', '--channel', 'stable']);
    logs.push(cliResult.stdout);
    if (cliResult.ok) {
      updated.push('openclaw-cli');
    } else {
      failed.push({ item: 'openclaw-cli', error: cliResult.stderr || 'update failed' });
    }

    const skillsResult = await safeExec('openclaw', ['skills', 'update']);
    logs.push(skillsResult.stdout);
    if (skillsResult.ok) {
      updated.push('openclaw-skills');
    } else {
      failed.push({ item: 'openclaw-skills', error: skillsResult.stderr || 'update failed' });
    }

    return {
      updated,
      failed,
      logs: logs.filter(Boolean).join('\n')
    };
  }
};
