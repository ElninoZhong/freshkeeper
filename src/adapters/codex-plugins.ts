import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { safeExec, type ExecResult } from '../util/exec.js';
import type { Adapter, UpdateInfo, UpdateResult } from './types.js';

interface CodexPluginSource {
  source?: 'local' | 'git' | 'gitSubdir' | 'npm' | 'remote';
  path?: string;
}

interface CodexMarketplaceSource {
  sourceType?: 'local' | 'git' | 'npm' | 'remote';
  source?: string;
}

interface CodexPlugin {
  pluginId: string;
  name: string;
  marketplaceName: string;
  version?: string;
  installed: boolean;
  enabled: boolean;
  source?: CodexPluginSource;
  marketplaceSource?: CodexMarketplaceSource;
}

type Exec = (
  cmd: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; input?: string }
) => Promise<ExecResult>;

type PluginOwner = 'freshkeeper' | 'host' | 'mcp';

export interface CodexPluginsDependencies {
  exec?: Exec;
  homeDir?: () => string;
  payloadHealthy?: (plugin: CodexPlugin) => boolean;
  localSourceVersion?: (plugin: CodexPlugin) => string | undefined;
  remotePluginCount?: () => number;
}

const HOST_MANAGED_MARKETPLACES = new Set([
  'openai-bundled',
  'openai-bundled-alpha',
  'openai-curated',
  'openai-curated-remote',
  'openai-primary-runtime'
]);

function parseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

async function installedPlugins(exec: Exec, strict = false): Promise<CodexPlugin[]> {
  const result = await exec('codex', ['plugin', 'list', '--json']);
  if (!result.ok) {
    if (strict) throw new Error(result.stderr || result.error || 'Codex plugin inventory failed');
    return [];
  }
  const parsed = parseJson<{ installed?: CodexPlugin[] }>(result.stdout);
  if (!parsed && strict) throw new Error('Codex plugin inventory returned invalid JSON');
  return (parsed?.installed ?? []).filter((plugin) => plugin.installed);
}

function ownerOf(plugin: CodexPlugin): PluginOwner {
  if (plugin.marketplaceName === 'claude-mem-local') return 'mcp';
  if (
    HOST_MANAGED_MARKETPLACES.has(plugin.marketplaceName)
    || plugin.source?.source === 'remote'
    || plugin.marketplaceSource?.sourceType === 'remote'
    || !plugin.marketplaceSource
  ) return 'host';
  return 'freshkeeper';
}

function safeSegment(value: string | undefined): string | null {
  return value && /^[a-zA-Z0-9._+-]+$/.test(value) ? value : null;
}

function defaultPayloadHealthy(homeDir: () => string, plugin: CodexPlugin): boolean {
  const marketplace = safeSegment(plugin.marketplaceName);
  const name = safeSegment(plugin.name);
  const version = safeSegment(plugin.version);
  if (!marketplace || !name || !version) return false;
  const root = join(homeDir(), '.codex', 'plugins', 'cache', marketplace, name, version);
  return existsSync(join(root, '.codex-plugin', 'plugin.json'));
}

function defaultLocalSourceVersion(plugin: CodexPlugin): string | undefined {
  if (plugin.source?.source !== 'local' || !plugin.source.path) return undefined;
  try {
    const manifest = parseJson<{ version?: string }>(
      readFileSync(join(plugin.source.path, '.codex-plugin', 'plugin.json'), 'utf8')
    );
    return manifest?.version;
  } catch {
    return undefined;
  }
}

function defaultRemotePluginCount(homeDir: () => string): number {
  const root = join(homeDir(), '.codex', 'plugins', 'cache', 'openai-curated-remote');
  try {
    return readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).length;
  } catch {
    return 0;
  }
}

function pendingPluginUpdates(
  plugins: CodexPlugin[],
  payloadHealthy: (plugin: CodexPlugin) => boolean,
  localSourceVersion: (plugin: CodexPlugin) => string | undefined
): UpdateInfo[] {
  const updates: UpdateInfo[] = [];
  for (const plugin of plugins.filter((item) => ownerOf(item) === 'freshkeeper')) {
    const currentVersion = plugin.version ?? 'unknown';
    if (!payloadHealthy(plugin)) {
      updates.push({
        item: plugin.pluginId,
        currentVersion,
        latestVersion: 'repair-cache',
        source: 'codex-plugin-cache'
      });
      continue;
    }
    const sourceVersion = localSourceVersion(plugin);
    if (sourceVersion && sourceVersion !== plugin.version) {
      updates.push({
        item: plugin.pluginId,
        currentVersion,
        latestVersion: sourceVersion,
        source: 'codex-local-marketplace'
      });
    }
  }
  return updates;
}

function uniqueGitMarketplaces(plugins: CodexPlugin[]): string[] {
  return [...new Set(
    plugins
      .filter((plugin) => ownerOf(plugin) === 'freshkeeper')
      .filter((plugin) => plugin.marketplaceSource?.sourceType === 'git')
      .map((plugin) => plugin.marketplaceName)
  )];
}

export function createCodexPluginsAdapter(dependencies: CodexPluginsDependencies = {}): Adapter {
  const exec = dependencies.exec ?? safeExec;
  const homeDir = dependencies.homeDir ?? homedir;
  const payloadHealthy = dependencies.payloadHealthy
    ?? ((plugin) => defaultPayloadHealthy(homeDir, plugin));
  const localSourceVersion = dependencies.localSourceVersion ?? defaultLocalSourceVersion;
  const remotePluginCount = dependencies.remotePluginCount
    ?? (() => defaultRemotePluginCount(homeDir));

  return {
    id: 'codex-plugins',
    displayName: 'Codex Plugins',

    async detect() {
      const plugins = await installedPlugins(exec);
      if (plugins.length === 0 && remotePluginCount() === 0) return { installed: false };
      const managed = plugins.filter((plugin) => ownerOf(plugin) === 'freshkeeper').length;
      const hostManaged = plugins.filter((plugin) => ownerOf(plugin) === 'host').length + remotePluginCount();
      const delegated = plugins.filter((plugin) => ownerOf(plugin) === 'mcp').length;
      return {
        installed: true,
        note: `${plugins.length + remotePluginCount()} installed; ${managed} Freshkeeper-managed, ${hostManaged} host-managed, ${delegated} delegated to MCP`
      };
    },

    async check() {
      const plugins = await installedPlugins(exec, true);
      const managed = plugins.filter((plugin) => ownerOf(plugin) === 'freshkeeper');
      const remoteRefreshRequired = managed.filter((plugin) =>
        plugin.marketplaceSource?.sourceType === 'git'
        || plugin.marketplaceSource?.sourceType === 'npm'
      );
      return {
        updates: pendingPluginUpdates(plugins, payloadHealthy, localSourceVersion),
        coverage: remoteRefreshRequired.length > 0 ? 'partial' as const : 'complete' as const,
        note: remoteRefreshRequired.length > 0
          ? `${remoteRefreshRequired.length} Git/npm marketplace plugin(s) require a marketplace refresh before exact versions are known`
          : undefined
      };
    },

    async update(): Promise<UpdateResult> {
      const before = await installedPlugins(exec, true);
      const managed = before.filter((plugin) => ownerOf(plugin) === 'freshkeeper');
      const failed: UpdateResult['failed'] = [];
      const skipped: NonNullable<UpdateResult['skipped']> = [];
      const logs: string[] = [];
      const blockedMarketplaces = new Set<string>();

      for (const marketplace of uniqueGitMarketplaces(before)) {
        const refresh = await exec(
          'codex',
          ['plugin', 'marketplace', 'upgrade', marketplace, '--json'],
          { timeoutMs: 120_000 }
        );
        logs.push(refresh.stdout, refresh.stderr);
        if (!refresh.ok) {
          blockedMarketplaces.add(marketplace);
          failed.push({
            item: `marketplace:${marketplace}`,
            error: refresh.stderr || refresh.error || 'marketplace refresh failed'
          });
        }
      }

      const pendingBefore = new Set(
        pendingPluginUpdates(before, payloadHealthy, localSourceVersion).map((item) => item.item)
      );
      const attempted = managed.filter((plugin) => {
        if (blockedMarketplaces.has(plugin.marketplaceName)) return false;
        if (plugin.marketplaceSource?.sourceType === 'local') return pendingBefore.has(plugin.pluginId);
        return true;
      });

      for (const plugin of attempted) {
        const result = await exec(
          'codex',
          ['plugin', 'add', plugin.pluginId, '--json'],
          { timeoutMs: 120_000 }
        );
        logs.push(result.stdout, result.stderr);
        if (!result.ok) {
          failed.push({
            item: plugin.pluginId,
            error: result.stderr || result.error || 'plugin refresh failed'
          });
        }
      }

      const after = await installedPlugins(exec, true);
      const updated: string[] = [];
      const unchanged: string[] = [];
      for (const plugin of attempted) {
        if (failed.some((item) => item.item === plugin.pluginId)) continue;
        const current = after.find((item) => item.pluginId === plugin.pluginId);
        if (!current || !payloadHealthy(current)) {
          failed.push({ item: plugin.pluginId, error: 'plugin cache did not pass post-update verification' });
          continue;
        }
        if (current.version !== plugin.version || pendingBefore.has(plugin.pluginId)) {
          updated.push(`${plugin.pluginId}@${current.version ?? 'current'}`);
        } else {
          unchanged.push(`${plugin.pluginId}@${current.version ?? 'current'}`);
        }
      }

      const hostManaged = before.filter((plugin) => ownerOf(plugin) === 'host').length + remotePluginCount();
      if (hostManaged > 0) {
        skipped.push({
          item: 'codex-host-managed-plugins',
          reason: `${hostManaged} plugin(s) are updated by the Codex/ChatGPT host and were not overwritten`
        });
      }
      const delegated = before.filter((plugin) => ownerOf(plugin) === 'mcp').length;
      if (delegated > 0) {
        skipped.push({
          item: 'codex-mcp-plugins',
          reason: `${delegated} plugin(s) are updated and health-checked by the MCP component adapter`
        });
      }

      return {
        updated,
        unchanged,
        failed,
        skipped,
        logs: logs.filter(Boolean).join('\n')
      };
    }
  };
}

export const codexPluginsAdapter = createCodexPluginsAdapter();
