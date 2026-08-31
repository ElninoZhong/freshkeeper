import { safeExec } from '../util/exec.js';
import type { Adapter } from './types.js';

export interface PluginInfo {
  name: string;
  source: string;
  version: string;
  scope: string;
  enabled?: boolean;
}

export function parsePluginListJson(stdout: string): PluginInfo[] {
  const parsed = JSON.parse(stdout) as Array<{
    id?: unknown;
    version?: unknown;
    scope?: unknown;
    enabled?: unknown;
  }>;
  if (!Array.isArray(parsed)) throw new Error('Claude plugin list JSON is not an array');
  return parsed.map((plugin) => {
    if (
      typeof plugin.id !== 'string' ||
      typeof plugin.version !== 'string' ||
      typeof plugin.scope !== 'string'
    ) {
      throw new Error('Claude plugin list contains an invalid entry');
    }
    const separator = plugin.id.lastIndexOf('@');
    if (separator <= 0 || separator === plugin.id.length - 1) throw new Error(`Invalid plugin id: ${plugin.id}`);
    return {
      name: plugin.id.slice(0, separator),
      source: plugin.id.slice(separator + 1),
      version: plugin.version,
      scope: plugin.scope,
      enabled: plugin.enabled !== false
    };
  });
}

async function listPluginsJson(cwd?: string): Promise<{ plugins?: PluginInfo[]; error?: string }> {
  const result = await safeExec('claude', ['plugin', 'list', '--json'], cwd ? { cwd } : undefined);
  if (!result.ok) return { error: result.stderr || result.error || 'plugin list failed' };
  try {
    return { plugins: parsePluginListJson(result.stdout) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function numericVersion(value: string): [number, number, number] | undefined {
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)$/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

function compareNumericVersions(a: string, b: string): number | undefined {
  const left = numericVersion(a);
  const right = numericVersion(b);
  if (!left || !right) return undefined;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index]! !== right[index]!) return left[index]! < right[index]! ? -1 : 1;
  }
  return 0;
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

  async update(context) {
    const list = await safeExec('claude', ['plugin', 'list']);
    if (!list.ok) return { updated: [], failed: [{ item: 'plugin-list', error: list.stderr || 'list failed' }], logs: list.stderr };

    const plugins = parsePluginList(list.stdout);
    const updated: string[] = [];
    const failed: Array<{ item: string; error: string }> = [];
    const skipped: Array<{ item: string; reason: string }> = [];
    const logs: string[] = [];

    for (const p of plugins) {
      const id = `${p.name}@${p.source}`;
      if (id === 'claude-mem@thedotmack' && context?.enabledAdapterIds.includes('mcp-components')) {
        skipped.push({ item: id, reason: 'managed by mcp-components' });
        continue;
      }
      const r = await safeExec('claude', ['plugin', 'update', id]);
      logs.push(`[${id}] ${r.stdout.trim()}`);
      if (r.ok) updated.push(id);
      else failed.push({ item: id, error: r.stderr || 'update failed' });
    }
    return { updated, failed, skipped, logs: logs.join('\n') };
  },

  async captureLock(context) {
    const listed = await listPluginsJson(context.projectDir);
    if (!listed.plugins) throw new Error(`Cannot lock Claude plugins: ${listed.error}`);
    return {
      adapter: 'claude-plugins',
      plugins: listed.plugins
        .map((plugin) => ({
          id: `${plugin.name}@${plugin.source}`,
          version: plugin.version,
          scope: plugin.scope as 'user' | 'project' | 'local' | 'managed',
          enabled: plugin.enabled !== false
        }))
        .sort((a, b) => a.id.localeCompare(b.id))
    };
  },

  async restoreLock(lock, context) {
    if (lock.adapter !== 'claude-plugins') {
      return { updated: [], failed: [{ item: 'claude-plugins', error: 'invalid lock entry' }], logs: '' };
    }
    const before = await listPluginsJson(context.projectDir);
    if (!before.plugins) {
      return { updated: [], failed: [{ item: 'plugin-list', error: before.error ?? 'list failed' }], logs: '' };
    }

    const installed = new Map(before.plugins.map((plugin) => [`${plugin.name}@${plugin.source}`, plugin]));
    const updated: string[] = [];
    const failed: Array<{ item: string; error: string }> = [];
    const logs: string[] = [];

    for (const target of lock.plugins) {
      const current = installed.get(target.id);
      if (current && current.version !== target.version) {
        const comparison = compareNumericVersions(current.version, target.version);
        if (comparison !== undefined && comparison > 0) {
          failed.push({
            item: target.id,
            error: `cannot downgrade or reconcile ${current.version} to ${target.version} with the Claude plugin CLI`
          });
          continue;
        }
      }

      if (!current || current.version !== target.version) {
        if (target.scope === 'managed') {
          failed.push({ item: target.id, error: 'managed plugins cannot be restored by the user CLI' });
          continue;
        }
        const args = current
          ? ['plugin', 'update', target.id, '--scope', target.scope]
          : ['plugin', 'install', target.id, '--scope', target.scope];
        const mutation = await safeExec('claude', args, { cwd: context.projectDir });
        logs.push(`[${target.id}] ${mutation.stdout}${mutation.stderr ? `\n${mutation.stderr}` : ''}`);
        if (!mutation.ok) {
          failed.push({ item: target.id, error: mutation.stderr || mutation.error || 'restore failed' });
        }
      }
    }

    const after = await listPluginsJson(context.projectDir);
    if (!after.plugins) {
      failed.push({ item: 'plugin-list', error: after.error ?? 'verification failed' });
      return { updated, failed, logs: logs.join('\n') };
    }
    const verified = new Map(after.plugins.map((plugin) => [`${plugin.name}@${plugin.source}`, plugin]));
    for (const target of lock.plugins) {
      if (failed.some((failure) => failure.item === target.id)) continue;
      const current = verified.get(target.id);
      if (!current || current.version !== target.version) {
        failed.push({
          item: target.id,
          error: `locked version ${target.version} is unavailable; detected ${current?.version ?? 'not installed'}`
        });
        continue;
      }
      if ((current.enabled !== false) !== target.enabled) {
        if (target.scope === 'managed') {
          failed.push({ item: target.id, error: 'managed plugin enabled state cannot be changed' });
          continue;
        }
        const stateChange = await safeExec(
          'claude',
          ['plugin', target.enabled ? 'enable' : 'disable', target.id, '--scope', target.scope],
          { cwd: context.projectDir }
        );
        logs.push(`[${target.id}:enabled] ${stateChange.stdout}`);
        if (!stateChange.ok) {
          failed.push({ item: target.id, error: stateChange.stderr || stateChange.error || 'state restore failed' });
          continue;
        }
      }
    }

    const finalInventory = await listPluginsJson(context.projectDir);
    if (!finalInventory.plugins) {
      failed.push({ item: 'plugin-list', error: finalInventory.error ?? 'final verification failed' });
      return { updated, failed, logs: logs.join('\n') };
    }
    const finalPlugins = new Map(
      finalInventory.plugins.map((plugin) => [`${plugin.name}@${plugin.source}`, plugin])
    );
    for (const target of lock.plugins) {
      if (failed.some((failure) => failure.item === target.id)) continue;
      const current = finalPlugins.get(target.id);
      if (!current || current.version !== target.version || (current.enabled !== false) !== target.enabled) {
        failed.push({ item: target.id, error: 'final plugin state does not match the lock' });
        continue;
      }
      const original = installed.get(target.id);
      if (!original || original.version !== target.version || (original.enabled !== false) !== target.enabled) {
        updated.push(`${target.id}@${target.version}`);
      }
    }
    return { updated, failed, logs: logs.join('\n') };
  }
};
