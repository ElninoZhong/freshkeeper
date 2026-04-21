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
    return [];
  },

  async update() {
    const r = await safeExec('claude', ['update']);
    return {
      updated: r.ok ? ['claude-code'] : [],
      failed: r.ok ? [] : [{ item: 'claude-code', error: r.stderr || r.error || 'unknown' }],
      logs: r.stdout + (r.stderr ? `\n${r.stderr}` : '')
    };
  }
};
