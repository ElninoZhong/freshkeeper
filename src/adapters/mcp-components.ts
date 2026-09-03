import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import { safeExec, type ExecResult } from '../util/exec.js';
import { freshkeeperHome } from '../util/paths.js';
import type { Adapter, UpdateContext, UpdateInfo, UpdateResult } from './types.js';
import type { MemoryProvider } from '../config.js';

const NPM_REGISTRY = 'https://registry.npmjs.org/';
const MCP_REMOTE_SKIP_REASON = 'requires staged installation, initialize/tools-list verification, config switch, and rollback';
const GBRAIN_SKIP_REASON = 'requires data backup, database migration, doctor, and MCP probe before activation';

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
  source: 'codex-plugin' | 'claude-plugin' | 'versioned-npm-bridge' | 'bun-global';
  latestVersion?: string;
  command?: string;
  installPath?: string;
  enabled?: boolean;
}

type Exec = (
  command: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; input?: string }
) => Promise<ExecResult>;

type ClaudeMemOwner = 'codex' | 'claude' | 'none' | 'auto';

export interface McpComponentsDependencies {
  exec?: Exec;
  homeDir?: () => string;
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
  ], {
    env: { ...process.env, npm_config_cache: join(freshkeeperHome(), 'npm-cache') }
  });
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

async function codexClaudeMemState(exec: Exec): Promise<{ version: string; enabled: boolean } | null> {
  const result = await exec('codex', ['plugin', 'list']);
  if (!result.ok) return null;
  const line = result.stdout.split('\n').find((value) => value.includes('claude-mem@claude-mem-local'));
  const version = line?.match(/\b(\d+\.\d+\.\d+(?:[-+][^\s]+)?)\b/)?.[1];
  if (!line || !version) return null;
  return { version, enabled: /installed,\s*enabled/i.test(line) };
}

async function codexClaudeMemVersion(exec: Exec): Promise<string | null> {
  return (await codexClaudeMemState(exec))?.version ?? null;
}

async function discoverVersionedComponents(
  exec: Exec,
  includeLatest: boolean,
  homeDir: () => string,
  preferredOwner: ClaudeMemOwner = 'auto'
): Promise<VersionedComponent[]> {
  const servers = await codexMcpInventory(exec);
  const components: VersionedComponent[] = [];

  const claudeMemServer = servers.find((server) =>
    server.enabled !== false && (server.name === 'claude-mem' || server.name === 'mcp-search'));

  const discoverCodexOwned = async (): Promise<VersionedComponent | null> => {
    if (!claudeMemServer) return null;
    const codexState = await codexClaudeMemState(exec);
    if (codexState) {
      return {
        id: 'claude-mem',
        currentVersion: codexState.version,
        latestVersion: includeLatest ? await npmLatest(exec, 'claude-mem') ?? undefined : undefined,
        source: 'codex-plugin',
        enabled: codexState.enabled,
        command: claudeMemServer.transport?.command,
        installPath: join(
          homeDir(),
          '.codex',
          'plugins',
          'cache',
          'claude-mem-local',
          'claude-mem',
          codexState.version
        )
      };
    }
    return null;
  };

  const discoverClaudeOwned = async (): Promise<VersionedComponent | null> => {
    const plugin = (await claudePlugins(exec)).find((item) => item.id === 'claude-mem@thedotmack');
    if (!plugin?.version) return null;
    const configuredCommand = claudeMemServer?.transport?.command;
    return {
      id: 'claude-mem',
      currentVersion: plugin.version,
      latestVersion: includeLatest ? await npmLatest(exec, 'claude-mem') ?? undefined : undefined,
      source: 'claude-plugin',
      command: configuredCommand && basename(configuredCommand) === 'bun'
        ? configuredCommand
        : join(homeDir(), '.bun', 'bin', 'bun'),
      installPath: plugin.installPath
    };
  };

  let claudeMem: VersionedComponent | null = null;
  if (preferredOwner === 'codex') claudeMem = await discoverCodexOwned();
  if (preferredOwner === 'claude') claudeMem = await discoverClaudeOwned();
  if (preferredOwner === 'auto') {
    claudeMem = await discoverCodexOwned() ?? await discoverClaudeOwned();
  }
  if (claudeMem) components.push(claudeMem);

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

function selectedClaudeMemOwner(context?: UpdateContext): ClaudeMemOwner {
  if (context?.primaryAgent === 'codex') return 'codex';
  if (context?.primaryAgent === 'claude') return 'claude';
  if (context?.primaryAgent === 'openclaw' || context?.primaryAgent === 'hermes') return 'none';

  const enabled = context?.enabledAdapterIds ?? [];
  const codexEnabled = enabled.includes('codex');
  const claudeEnabled = enabled.includes('claude-code') || enabled.includes('claude-plugins');
  if (codexEnabled && !claudeEnabled) return 'codex';
  if (claudeEnabled && !codexEnabled) return 'claude';
  return 'auto';
}

function availableUpdates(components: VersionedComponent[]): UpdateInfo[] {
  return components
    .filter((component) => component.latestVersion && component.latestVersion !== component.currentVersion)
    .map((component) => ({
      item: component.id,
      currentVersion: component.currentVersion,
      latestVersion: component.latestVersion!,
      source: component.source,
      disposition: component.id === 'claude-mem' ? 'update' as const : 'skip' as const,
      reason: component.id === 'mcp-remote'
        ? MCP_REMOTE_SKIP_REASON
        : component.id === 'gbrain'
          ? GBRAIN_SKIP_REASON
          : undefined
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

async function updateCodexClaudeMem(
  exec: Exec,
  component: VersionedComponent,
  homeDir: () => string,
  memoryProvider?: MemoryProvider | null
): Promise<UpdateResult> {
  const target = component.latestVersion;
  if (!target) return { updated: [], failed: [], logs: '' };

  const home = homeDir();
  const installerEnv = {
    ...process.env,
    CLAUDE_CONFIG_DIR: join(home, '.codex', 'claude-mem-runtime'),
    npm_config_cache: join(home, '.freshkeeper', 'npm-cache'),
    UV_CACHE_DIR: join(home, '.claude-mem', 'uv-cache'),
    UV_TOOL_DIR: join(home, '.claude-mem', 'uv-tools'),
    UV_TOOL_BIN_DIR: join(home, '.claude-mem', 'uv-bin')
  };

  if (memoryProvider === 'codex') {
    const capability = await exec('npx', [
      '--yes',
      `claude-mem@${target}`,
      '--help'
    ], { env: installerEnv, timeoutMs: 120_000 });
    if (!capability.ok || !/--provider[^\n]*\bcodex\b/i.test(capability.stdout)) {
      return {
        updated: [],
        failed: [],
        skipped: [{
          item: 'claude-mem',
          reason: `target ${target} does not advertise the Codex provider; refusing to overwrite the local OAuth-capable build`
        }],
        logs: [capability.stdout, capability.stderr].filter(Boolean).join('\n')
      };
    }
  }

  const mutation = await exec('npx', [
    '--yes',
    `claude-mem@${target}`,
    'install',
    '--ide',
    'codex-cli',
    '--runtime',
    'worker',
    ...(memoryProvider ? ['--provider', memoryProvider] : [])
  ], { env: installerEnv, timeoutMs: 600_000 });
  if (!mutation.ok) {
    return {
      updated: [],
      failed: [{ item: 'claude-mem', error: mutation.stderr || mutation.error || 'Codex plugin install failed' }],
      logs: mutation.stdout
    };
  }

  const installed = await codexClaudeMemVersion(exec);
  if (installed !== target) {
    return {
      updated: [],
      failed: [{ item: 'claude-mem', error: `expected ${target}, detected ${installed ?? 'missing'}` }],
      logs: mutation.stdout
    };
  }

  const worker = join(
    home,
    '.codex',
    'plugins',
    'cache',
    'claude-mem-local',
    'claude-mem',
    target,
    'scripts',
    'worker-service.cjs'
  );
  const bun = component.command && basename(component.command) === 'bun'
    ? component.command
    : join(home, '.bun', 'bin', 'bun');
  const runtimeEnv = {
    ...process.env,
    CLAUDE_CONFIG_DIR: join(home, '.codex', 'claude-mem-runtime'),
    UV_CACHE_DIR: join(home, '.claude-mem', 'uv-cache'),
    UV_TOOL_DIR: join(home, '.claude-mem', 'uv-tools'),
    UV_TOOL_BIN_DIR: join(home, '.claude-mem', 'uv-bin'),
    CLAUDE_PLUGIN_ROOT: join(
      home,
      '.codex',
      'plugins',
      'cache',
      'claude-mem-local',
      'claude-mem',
      target
    )
  };
  const warnings: string[] = [];
  const logs = [mutation.stdout.trim()];
  const stop = await exec(bun, [worker, 'stop'], { env: runtimeEnv, timeoutMs: 30_000 });
  logs.push(stop.stdout.trim());
  if (!stop.ok) {
    warnings.push(`claude-mem worker stop failed: ${stop.stderr || stop.error}`);
  }
  const start = await exec(bun, [worker, 'start'], { env: runtimeEnv, timeoutMs: 30_000 });
  logs.push(start.stdout.trim());
  if (!start.ok) {
    warnings.push(`claude-mem worker start failed: ${start.stderr || start.error}`);
  }

  const status = await exec(bun, [worker, 'status'], { env: runtimeEnv, timeoutMs: 30_000 });
  logs.push(status.stdout.trim());
  const healthy = status.ok
    && /Worker is running/i.test(status.stdout)
    && status.stdout.includes(`Version: ${target}`)
    && status.stdout.includes('/.codex/')
    && !status.stdout.includes('/.claude/plugins/');
  if (!healthy) {
    warnings.push('claude-mem updated, but the Codex-owned worker path or version did not pass health verification');
  }

  return {
    updated: [`claude-mem@${target}`],
    failed: [],
    warnings,
    logs: logs.filter(Boolean).join('\n')
  };
}

export function createMcpComponentsAdapter(dependencies: McpComponentsDependencies = {}): Adapter {
  const exec = dependencies.exec ?? safeExec;
  const homeDir = dependencies.homeDir ?? homedir;
  return {
    id: 'mcp-components',
    displayName: 'MCP Components',

    async detect(context) {
      const components = await discoverVersionedComponents(
        exec,
        false,
        homeDir,
        selectedClaudeMemOwner(context)
      );
      return {
        installed: components.length > 0,
        note: `${components.length} versioned local MCP component(s); remote and host-managed servers are report-only`
      };
    },

    async check(context) {
      const components = await discoverVersionedComponents(
        exec,
        true,
        homeDir,
        selectedClaudeMemOwner(context)
      );
      const missingLatest = components.filter((component) => !component.latestVersion);
      return {
        updates: availableUpdates(components),
        coverage: missingLatest.length > 0 ? 'partial' as const : 'complete' as const,
        note: missingLatest.length > 0
          ? `latest version could not be resolved for ${missingLatest.map((component) => component.id).join(', ')}`
          : undefined
      };
    },

    async update(context) {
      const components = await discoverVersionedComponents(
        exec,
        true,
        homeDir,
        selectedClaudeMemOwner(context)
      );
      const updates = availableUpdates(components);
      const updated: string[] = [];
      const failed: Array<{ item: string; error: string }> = [];
      const skipped: Array<{ item: string; reason: string }> = [];
      const warnings: string[] = [];
      const logs: string[] = [];
      const unchanged = components
        .filter((component) => !updates.some((update) => update.item === component.id))
        .map((component) => `${component.id}@${component.currentVersion}`);

      for (const update of updates) {
        const component = components.find((item) => item.id === update.item)!;
        if (component.id === 'claude-mem') {
          if (
            component.source === 'codex-plugin'
            && component.enabled === false
            && context?.memoryProvider !== 'codex'
          ) {
            skipped.push({
              item: component.id,
              reason: 'Codex plugin is disabled; the official installer would re-enable hooks before a non-Claude provider is configured'
            });
            continue;
          }
          const result = component.source === 'codex-plugin'
            ? await updateCodexClaudeMem(exec, component, homeDir, context?.memoryProvider)
            : await updateClaudeMem(exec, component);
          updated.push(...result.updated);
          failed.push(...result.failed);
          skipped.push(...(result.skipped ?? []));
          warnings.push(...(result.warnings ?? []));
          if (result.logs) logs.push(result.logs);
          continue;
        }
        if (component.id === 'mcp-remote') {
          skipped.push({
            item: component.id,
            reason: MCP_REMOTE_SKIP_REASON
          });
          continue;
        }
        skipped.push({
          item: component.id,
          reason: GBRAIN_SKIP_REASON
        });
      }

      return { updated, unchanged, failed, skipped, warnings, logs: logs.join('\n') };
    }
  };
}

export const mcpComponentsAdapter = createMcpComponentsAdapter();
