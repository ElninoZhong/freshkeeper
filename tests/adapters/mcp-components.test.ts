import { describe, expect, it } from 'vitest';
import type { ExecResult } from '../../src/util/exec.js';
import { createMcpComponentsAdapter } from '../../src/adapters/mcp-components.js';

const codexInventory = JSON.stringify([
  {
    name: 'claude-mem',
    enabled: true,
    transport: {
      type: 'stdio',
      command: '/Users/test/.bun/bin/bun',
      args: ['/Users/test/.codex/claude-mem-runtime/plugins/marketplaces/thedotmack/plugin/scripts/mcp-server.cjs']
    }
  },
  {
    name: 'cloudflare',
    enabled: true,
    transport: {
      type: 'stdio',
      command: '/usr/local/bin/node',
      args: [
        '/Users/test/.agents/tools/mcp-remote-cloudflare-0.1.38/dist/proxy.js',
        'https://mcp.cloudflare.com/mcp'
      ]
    }
  },
  {
    name: 'gbrain',
    enabled: true,
    transport: {
      type: 'stdio',
      command: '/Users/test/.bun/bin/gbrain',
      args: ['serve']
    }
  },
  {
    name: 'github',
    enabled: true,
    transport: {
      type: 'streamable_http',
      url: 'https://api.githubcopilot.com/mcp/'
    }
  },
  {
    name: 'node_repl',
    enabled: true,
    transport: {
      type: 'stdio',
      command: '/Applications/ChatGPT.app/Contents/Resources/node_repl',
      args: []
    }
  }
]);

function ok(stdout = ''): ExecResult {
  return { ok: true, stdout, stderr: '' };
}

function runtime(codexPluginEnabled = true, codexProviderSupported = true) {
  let claudeMemVersion = '13.10.2';
  const calls: Array<[string, string[], { env?: NodeJS.ProcessEnv; timeoutMs?: number } | undefined]> = [];
  const exec = async (
    cmd: string,
    args: string[],
    options?: { env?: NodeJS.ProcessEnv; timeoutMs?: number }
  ): Promise<ExecResult> => {
    calls.push([cmd, args, options]);
    if (cmd === 'codex' && args.join(' ') === 'mcp list --json') return ok(codexInventory);
    if (cmd === 'codex' && args.join(' ') === 'plugin list') {
      const status = codexPluginEnabled ? 'installed, enabled' : 'installed, disabled';
      return ok(`claude-mem@claude-mem-local  ${status}  ${claudeMemVersion}  /Users/test/.codex/claude-mem-runtime/plugins/marketplaces/thedotmack/plugin`);
    }
    if (cmd === 'claude' && args.join(' ') === 'plugin list --json') {
      return ok(JSON.stringify([{
        id: 'claude-mem@thedotmack',
        version: claudeMemVersion,
        scope: 'user',
        enabled: true,
        installPath: `/Users/test/.claude/plugins/cache/thedotmack/claude-mem/${claudeMemVersion}`
      }]));
    }
    if (cmd === 'npm' && args[1] === 'claude-mem') return ok('"13.18.0"');
    if (cmd === 'npm' && args[1] === 'gbrain') return ok('"1.3.1"');
    if (cmd === 'npm' && args[1] === 'mcp-remote') return ok('"0.8.2"');
    if (cmd.endsWith('/gbrain') && args[0] === '--version') return ok('gbrain 0.36.0.0');
    if (cmd === 'npx' && args[1] === 'claude-mem@13.18.0' && args.at(-1) === '--help') {
      return ok(codexProviderSupported
        ? 'npx claude-mem install --provider claude|codex|gemini|openrouter'
        : 'npx claude-mem install --provider claude|gemini|openrouter');
    }
    if (cmd === 'npx' && args[1] === `claude-mem@13.18.0` && args.includes('install')) {
      claudeMemVersion = '13.18.0';
      return ok('Updated claude-mem to 13.18.0');
    }
    if (cmd === 'claude' && args.join(' ') === 'plugin update claude-mem@thedotmack --scope user') {
      claudeMemVersion = '13.18.0';
      return ok('Updated Claude plugin to 13.18.0');
    }
    if (cmd === 'claude' && args.join(' ') === 'mcp list') {
      return ok('plugin:claude-mem:mcp-search - ✓ Connected');
    }
    if (cmd.endsWith('/bun') && args.at(-1) === 'stop') return ok('Worker stopped');
    if (cmd.endsWith('/bun') && args.at(-1) === 'start') return ok('Worker started');
    if (cmd.endsWith('/bun') && args.at(-1) === 'status') {
      return ok(`Worker is running\n  Version: ${claudeMemVersion}\n  Worker path: /Users/test/.codex/plugins/cache/claude-mem-local/claude-mem/${claudeMemVersion}/scripts/worker-service.cjs`);
    }
    return { ok: false, stdout: '', stderr: `unexpected command: ${cmd} ${args.join(' ')}` };
  };
  return { exec, calls };
}

describe('mcp-components adapter', () => {
  it('reports versioned local MCP updates and ignores owner-managed or remote servers', async () => {
    const fake = runtime();
    const adapter = createMcpComponentsAdapter({ exec: fake.exec, homeDir: () => '/Users/test' });

    const detected = await adapter.detect();
    const updates = await adapter.check();

    expect(detected).toMatchObject({ installed: true });
    expect(detected.note).toContain('3 versioned local');
    expect(updates).toEqual({
      coverage: 'complete',
      note: undefined,
      updates: [
      {
        item: 'claude-mem',
        currentVersion: '13.10.2',
        latestVersion: '13.18.0',
        source: 'codex-plugin',
        disposition: 'update',
        reason: undefined
      },
      {
        item: 'mcp-remote',
        currentVersion: '0.1.38',
        latestVersion: '0.8.2',
        source: 'versioned-npm-bridge',
        disposition: 'skip',
        reason: expect.stringMatching(/staged.*rollback/i)
      },
      {
        item: 'gbrain',
        currentVersion: '0.36.0.0',
        latestVersion: '1.3.1',
        source: 'bun-global',
        disposition: 'skip',
        reason: expect.stringMatching(/backup.*migration/i)
      }
      ]
    });
  });

  it('updates claude-mem with a pinned stop/start and health verification while skipping risky MCP migrations', async () => {
    const fake = runtime();
    const adapter = createMcpComponentsAdapter({ exec: fake.exec, homeDir: () => '/Users/test' });

    const result = await adapter.update({
      enabledAdapterIds: ['mcp-components', 'skills-cli', 'codex'],
      primaryAgent: 'codex',
      memoryProvider: 'codex'
    });

    expect(result.updated).toEqual(['claude-mem@13.18.0']);
    expect(result.failed).toEqual([]);
    expect(result.skipped).toEqual([
      { item: 'mcp-remote', reason: expect.stringMatching(/staged.*rollback/i) },
      { item: 'gbrain', reason: expect.stringMatching(/backup.*migration/i) }
    ]);
    expect(fake.calls.some(([cmd, args]) => cmd === 'npx' && args.join(' ') === '--yes claude-mem@13.18.0 install --ide codex-cli --runtime worker --provider codex')).toBe(true);
    expect(fake.calls.some(([cmd]) => cmd === 'claude')).toBe(false);
    expect(fake.calls.some(([cmd, args]) => cmd.endsWith('/bun') && args.at(-1) === 'stop')).toBe(true);
    expect(fake.calls.some(([cmd, args]) => cmd.endsWith('/bun') && args.at(-1) === 'start')).toBe(true);
    const startCall = fake.calls.find(([cmd, args]) => cmd.endsWith('/bun') && args.at(-1) === 'start');
    expect(startCall?.[1]).toEqual([
      '/Users/test/.codex/plugins/cache/claude-mem-local/claude-mem/13.18.0/scripts/worker-service.cjs',
      'start'
    ]);
    expect(startCall?.[2]).toMatchObject({
      timeoutMs: 30_000,
      env: {
        CLAUDE_CONFIG_DIR: '/Users/test/.codex/claude-mem-runtime',
        CLAUDE_PLUGIN_ROOT: '/Users/test/.codex/plugins/cache/claude-mem-local/claude-mem/13.18.0',
        UV_CACHE_DIR: '/Users/test/.claude-mem/uv-cache',
        UV_TOOL_DIR: '/Users/test/.claude-mem/uv-tools',
        UV_TOOL_BIN_DIR: '/Users/test/.claude-mem/uv-bin'
      }
    });
    expect(fake.calls.some(([cmd, args]) => cmd === 'bun' && args.join(' ') === 'add -g gbrain@latest')).toBe(false);
  });

  it('does not let the official installer re-enable disabled Codex hooks', async () => {
    const fake = runtime(false);
    const adapter = createMcpComponentsAdapter({ exec: fake.exec, homeDir: () => '/Users/test' });

    const result = await adapter.update();

    expect(result.updated).toEqual([]);
    expect(result.skipped).toContainEqual({
      item: 'claude-mem',
      reason: expect.stringMatching(/disabled.*re-enable.*non-Claude provider/i)
    });
    expect(fake.calls.some(([cmd]) => cmd === 'npx')).toBe(false);
  });

  it('uses the user-selected Claude owner even when Codex is also installed', async () => {
    const fake = runtime();
    const adapter = createMcpComponentsAdapter({ exec: fake.exec, homeDir: () => '/Users/test' });

    const result = await adapter.update({
      enabledAdapterIds: ['mcp-components', 'claude-code', 'claude-plugins', 'skills-cli'],
      primaryAgent: 'claude'
    });

    expect(result.updated).toEqual(['claude-mem@13.18.0']);
    expect(fake.calls.some(([cmd, args]) =>
      cmd === 'claude' && args.join(' ') === 'plugin update claude-mem@thedotmack --scope user')).toBe(true);
    expect(fake.calls.some(([cmd]) => cmd === 'npx')).toBe(false);
  });

  it('reports checks against the same user-selected owner used for updates', async () => {
    const fake = runtime();
    const adapter = createMcpComponentsAdapter({ exec: fake.exec, homeDir: () => '/Users/test' });

    const updates = await adapter.check({
      enabledAdapterIds: ['mcp-components', 'claude-code', 'claude-plugins', 'skills-cli'],
      primaryAgent: 'claude'
    });

    expect(updates.updates[0]).toMatchObject({ item: 'claude-mem', source: 'claude-plugin' });
  });

  it('refuses to overwrite the local Codex provider with an upstream package that lacks it', async () => {
    const fake = runtime(true, false);
    const adapter = createMcpComponentsAdapter({ exec: fake.exec, homeDir: () => '/Users/test' });

    const result = await adapter.update({
      enabledAdapterIds: ['mcp-components', 'skills-cli', 'codex'],
      primaryAgent: 'codex',
      memoryProvider: 'codex'
    });

    expect(result.updated).toEqual([]);
    expect(result.skipped).toContainEqual({
      item: 'claude-mem',
      reason: expect.stringMatching(/target.*does not advertise.*codex provider/i)
    });
    expect(fake.calls.some(([cmd, args]) => cmd === 'npx' && args.includes('install'))).toBe(false);
  });
});
