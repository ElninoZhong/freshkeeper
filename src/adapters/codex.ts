import { safeExec } from '../util/exec.js';
import type { Adapter } from './types.js';

export const codexAdapter: Adapter = {
  id: 'codex',
  displayName: 'OpenAI Codex CLI',

  async detect() {
    const r = await safeExec('codex', ['--version']);
    if (!r.ok) return { installed: false };
    const version = r.stdout.match(/(\d+\.\d+\.\d+)/)?.[1];
    return { installed: true, version };
  },

  async check() {
    return [];
  },

  async update() {
    const r = await safeExec('claude', ['plugin', 'update', 'codex@openai-codex']);
    return {
      updated: r.ok ? ['codex'] : [],
      failed: r.ok ? [] : [{ item: 'codex', error: r.stderr || 'update failed' }],
      logs: r.stdout
    };
  }
};
