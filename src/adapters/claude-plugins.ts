import { safeExec } from '../util/exec.js';
import type { Adapter } from './types.js';

export interface PluginInfo {
  name: string;
  source: string;
  version: string;
  scope: string;
}

export function parsePluginList(stdout: string): PluginInfo[] {
  const plugins: PluginInfo[] = [];
  const blocks = stdout.split(/❯\s+/).slice(1);
  for (const block of blocks) {
    const header = block.split('\n')[0].trim();
    const [name, source] = header.split('@');
    const version = block.match(/Version:\s*([^\s]+)/)?.[1] ?? 'unknown';
    const scope = block.match(/Scope:\s*([^\s]+)/)?.[1] ?? 'user';
    if (name && source) plugins.push({ name, source, version, scope });
  }
  return plugins;
}

export const claudePluginsAdapter: Adapter = {
  id: 'claude-plugins',
  displayName: 'Claude Code Plugins',

  async detect() {
    const r = await safeExec('claude', ['plugin', 'list']);
    if (!r.ok) return { installed: false };
    const plugins = parsePluginList(r.stdout);
    return { installed: plugins.length > 0, note: `${plugins.length} plugin(s)` };
  },

  async check() {
    return [];
  },

  async update() {
    const list = await safeExec('claude', ['plugin', 'list']);
    if (!list.ok) return { updated: [], failed: [{ item: 'plugin-list', error: list.stderr || 'list failed' }], logs: list.stderr };

    const plugins = parsePluginList(list.stdout);
    const updated: string[] = [];
    const failed: Array<{ item: string; error: string }> = [];
    const logs: string[] = [];

    for (const p of plugins) {
      const id = `${p.name}@${p.source}`;
      const r = await safeExec('claude', ['plugin', 'update', id]);
      logs.push(`[${id}] ${r.stdout.trim()}`);
      if (r.ok) updated.push(id);
      else failed.push({ item: id, error: r.stderr || 'update failed' });
    }
    return { updated, failed, logs: logs.join('\n') };
  }
};
