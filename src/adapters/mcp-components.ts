import { basename, join } from 'node:path';
import { safeExec, type ExecResult } from '../util/exec.js';
import type { Adapter, UpdateInfo, UpdateResult } from './types.js';

const NPM_REGISTRY = 'https://registry.npmjs.org/';

interface McpTransport {
  type?: string;
  command?: string;
  args?: string[];
  url?: string;
}

interface CodexMcpServer {
  name?: string;
  enabled?: boolean;
  transport?: McpTransport;
}

interface ClaudePlugin {
  id?: string;
  version?: string;
  scope?: string;
  enabled?: boolean;
  installPath?: string;
}

interface VersionedComponent {
  id: 'claude-mem' | 'mcp-remote' | 'gbrain';
  currentVersion: string;
  source: 'claude-plugin' | 'versioned-npm-bridge' | 'bun-global';
  latestVersion?: string;
  command?: string;
  installPath?: string;
}

type Exec = (
  command: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; input?: string }
) => Promise<ExecResult>;

export interface McpComponentsDependencies {
  exec?: Exec;
}

function parseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function parseNpmVersion(value: string): string | null {
  const parsed = parseJson<unknown>(value.trim());
  if (typeof parsed === 'string') return parsed;
  const plain = value.trim();
  return /^\d+(?:\.\d+)+$/.test(plain) ? plain : null;
}

function parseGbrainVersion(value: string): string | null {
  return value.match(/(?:^|\s)(\d+(?:\.\d+){2,3})(?:\s|$)/)?.[1] ?? null;
}

function parseMcpRemoteVersion(args: string[]): string | null {
  const text = args.join('\n');
  return text.match(/mcp-remote(?:-[A-Za-z0-9_-]+)?-(\d+\.\d+\.\d+)(?:\/|$)/)?.[1] ?? null;
}

async function npmLatest(exec: Exec, packageName: string): Promise<string | null> {
  const result = await exec('npm', [
    'view',
    packageName,
    'version',
    '--json',
    '--registry',
    NPM_REGISTRY
  ]);
  return result.ok ? parseNpmVersion(result.stdout) : null;
}

async function codexMcpInventory(exec: Exec): Promise<CodexMcpServer[]> {
  const result = await exec('codex', ['mcp', 'list', '--json']);
  if (!result.ok) return [];
  const parsed = parseJson<unknown>(result.stdout);
  return Array.isArray(parsed) ? parsed as CodexMcpServer[] : [];
}

async function claudePlugins(exec: Exec): Promise<ClaudePlugin[]> {
  const result = await exec('claude', ['plugin', 'list', '--json']);
  if (!result.ok) return [];
  const parsed = parseJson<unknown>(result.stdout);
  return Array.isArray(parsed) ? parsed as ClaudePlugin[] : [];
}

async function discoverVersionedComponents(exec: Exec, includeLatest: boolean): Promise<VersionedComponent[]> {
  const servers = await codexMcpInventory(exec);
  const components: VersionedComponent[] = [];

  const claudeMemServer = servers.find((server) => server.enabled !== false && server.name === 'claude-mem');
  if (claudeMemServer) {
    const plugin = (await claudePlugins(exec)).find((item) => item.id === 'claude-mem@thedotmack');
    if (plugin?.version) {
      components.push({
        id: 'claude-mem',
        currentVersion: plugin.version,
        latestVersion: includeLatest ? await npmLatest(exec, 'claude-mem') ?? undefined : undefined,
        source: 'claude-plugin',
        command: claudeMemServer.transport?.command,
        installPath: plugin.installPath
      });
    }
  }

  const bridge = servers.find((server) =>
    server.enabled !== false && server.transport?.type === 'stdio'
      && parseMcpRemoteVersion(server.transport.args ?? []) !== null);
  if (bridge) {
    const currentVersion = parseMcpRemoteVersion(bridge.transport?.args ?? []);
    if (currentVersion) {
      components.push({
        id: 'mcp-remote',
        currentVersion,
        latestVersion: includeLatest ? await npmLatest(exec, 'mcp-remote') ?? undefined : undefined,
        source: 'versioned-npm-bridge'
      });
    }
  }

  const gbrainServer = servers.find((server) =>
    server.enabled !== false
      && (server.name === 'gbrain' || basename(server.transport?.command ?? '') === 'gbrain'));
  if (gbrainServer?.transport?.command) {
    const version = await exec(gbrainServer.transport.command, ['--version']);
    const currentVersion = version.ok ? parseGbrainVersion(version.stdout) : null;
    if (currentVersion) {
      components.push({
        id: 'gbrain',
        currentVersion,
        latestVersion: includeLatest ? await npmLatest(exec, 'gbrain') ?? undefined : undefined,
        source: 'bun-global',
        command: gbrainServer.transport.command
      });
    }
  }

  return components;
}

function availableUpdates(components: VersionedComponent[]): UpdateInfo[] {
  return components
    .filter((component) => component.latestVersion && component.latestVersion !== component.currentVersion)
    .map((component) => ({
      item: component.id,
      currentVersion: component.currentVersion,
      latestVersion: component.latestVersion!,
      source: component.source
    }));
}

async function updateClaudeMem(exec: Exec, component: VersionedComponent): Promise<UpdateResult> {
  const target = component.latestVersion;
  if (!target) return { updated: [], failed: [], logs: '' };

  const mutation = await exec('claude', [
    'plugin',
    'update',
    'claude-mem@thedotmack',
    '--scope',
    'user'
  ]);
  if (!mutation.ok) {
    return {
      updated: [],
      failed: [{ item: 'claude-mem', error: mutation.stderr || mutation.error || 'plugin update failed' }],
      logs: mutation.stdout
    };
  }

  const plugin = (await claudePlugins(exec)).find((item) => item.id === 'claude-mem@thedotmack');
  if (plugin?.version !== target) {
    return {
      updated: [],
      failed: [{ item: 'claude-mem', error: `expected ${target}, detected ${plugin?.version ?? 'missing'}` }],
      logs: mutation.stdout
    };
  }

  const logs = [mutation.stdout.trim()];
  const warnings: string[] = [];
  if (component.command && plugin.installPath) {
    const worker = join(plugin.installPath, 'scripts', 'worker-service.cjs');
    const restart = await exec(component.command, [worker, 'restart'], { timeoutMs: 30_000 });
    logs.push(restart.stdout.trim());
    if (!restart.ok) warnings.push(`claude-mem worker restart failed: ${restart.stderr || restart.error}`);
  } else {
    warnings.push('claude-mem updated, but worker restart path could not be resolved');
  }

  const health = await exec('claude', ['mcp', 'list'], { timeoutMs: 30_000 });
  const connected = /claude-mem[^\n]*(?:✓\s*Connected|Connected)/i.test(`${health.stdout}\n${health.stderr}`);
  if (!connected) warnings.push('claude-mem plugin updated, but MCP health is not connected; restart Claude and re-authenticate if required');

  return {
    updated: [`claude-mem@${target}`],
    failed: [],
    warnings,
    logs: logs.filter(Boolean).join('\n')
  };
}

export function createMcpComponentsAdapter(dependencies: McpComponentsDependencies = {}): Adapter {
  const exec = dependencies.exec ?? safeExec;
  return {
    id: 'mcp-components',
    displayName: 'MCP Components',

    async detect() {
      const components = await discoverVersionedComponents(exec, false);
      return {
        installed: components.length > 0,
        note: `${components.length} versioned local MCP component(s); remote and host-managed servers are report-only`
      };
    },

    async check() {
      return availableUpdates(await discoverVersionedComponents(exec, true));
    },

    async update() {
      const components = await discoverVersionedComponents(exec, true);
      const updates = availableUpdates(components);
      const updated: string[] = [];
      const failed: Array<{ item: string; error: string }> = [];
      const skipped: Array<{ item: string; reason: string }> = [];
      const warnings: string[] = [];
      const logs: string[] = [];

      for (const update of updates) {
        const component = components.find((item) => item.id === update.item)!;
        if (component.id === 'claude-mem') {
          const result = await updateClaudeMem(exec, component);
          updated.push(...result.updated);
          failed.push(...result.failed);
          warnings.push(...(result.warnings ?? []));
          if (result.logs) logs.push(result.logs);
          continue;
        }
        if (component.id === 'mcp-remote') {
          skipped.push({
            item: component.id,
            reason: 'requires staged installation, initialize/tools-list verification, config switch, and rollback'
          });
          continue;
        }
        skipped.push({
          item: component.id,
          reason: 'requires data backup, database migration, doctor, and MCP probe before activation'
        });
      }

      return { updated, failed, skipped, warnings, logs: logs.join('\n') };
    }
  };
}

export const mcpComponentsAdapter = createMcpComponentsAdapter();
