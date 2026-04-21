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
    return [];
  },

  async update() {
    const updated: string[] = [];
    const failed: Array<{ item: string; error: string }> = [];
    const logs: string[] = [];

    const cli = await safeExec('hermes', ['update']);
    logs.push(`[cli] ${cli.stdout.trim()}`);
    if (cli.ok) updated.push('hermes-cli');
    else failed.push({ item: 'hermes-cli', error: cli.stderr || cli.error || 'update failed' });

    const skills = await safeExec('hermes', ['skills', 'update']);
    logs.push(`[skills] ${skills.stdout.trim()}`);
    if (skills.ok) updated.push('hermes-skills');
    else failed.push({ item: 'hermes-skills', error: skills.stderr || skills.error || 'skills update failed' });

    return { updated, failed, logs: logs.join('\n') };
  }
};
