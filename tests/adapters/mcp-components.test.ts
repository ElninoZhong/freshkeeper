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
      args: ['/Users/test/.claude/plugins/marketplaces/thedotmack/plugin/scripts/mcp-server.cjs']
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

function runtime() {
  let claudeMemVersion = '13.10.2';
  const calls: Array<[string, string[]]> = [];
  const exec = async (cmd: string, args: string[]): Promise<ExecResult> => {
    calls.push([cmd, args]);
    if (cmd === 'codex' && args.join(' ') === 'mcp list --json') return ok(codexInventory);
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
    if (cmd === 'claude' && args[0] === 'plugin' && args[1] === 'update') {
      claudeMemVersion = '13.18.0';
      return ok('Updated claude-mem to 13.18.0');
    }
    if (cmd.endsWith('/bun') && args.at(-1) === 'restart') return ok('Worker restarted');
    if (cmd === 'claude' && args.join(' ') === 'mcp list') {
      return ok('plugin:claude-mem:mcp-search - ✓ Connected');
    }
    return { ok: false, stdout: '', stderr: `unexpected command: ${cmd} ${args.join(' ')}` };
  };
  return { exec, calls };
}

describe('mcp-components adapter', () => {
  it('reports versioned local MCP updates and ignores owner-managed or remote servers', async () => {
    const fake = runtime();
    const adapter = createMcpComponentsAdapter({ exec: fake.exec });

    const detected = await adapter.detect();
    const updates = await adapter.check();

    expect(detected).toMatchObject({ installed: true });
    expect(detected.note).toContain('3 versioned local');
    expect(updates).toEqual([
      {
        item: 'claude-mem',
        currentVersion: '13.10.2',
        latestVersion: '13.18.0',
        source: 'claude-plugin'
      },
      {
        item: 'mcp-remote',
        currentVersion: '0.1.38',
        latestVersion: '0.8.2',
        source: 'versioned-npm-bridge'
      },
      {
        item: 'gbrain',
        currentVersion: '0.36.0.0',
        latestVersion: '1.3.1',
        source: 'bun-global'
      }
    ]);
  });

  it('updates claude-mem with restart and health verification while skipping risky MCP migrations', async () => {
    const fake = runtime();
    const adapter = createMcpComponentsAdapter({ exec: fake.exec });

    const result = await adapter.update();

    expect(result.updated).toEqual(['claude-mem@13.18.0']);
    expect(result.failed).toEqual([]);
    expect(result.skipped).toEqual([
      { item: 'mcp-remote', reason: expect.stringMatching(/staged.*rollback/i) },
      { item: 'gbrain', reason: expect.stringMatching(/backup.*migration/i) }
    ]);
    expect(fake.calls).toContainEqual([
      'claude',
      ['plugin', 'update', 'claude-mem@thedotmack', '--scope', 'user']
    ]);
    expect(fake.calls.some(([cmd, args]) => cmd.endsWith('/bun') && args.at(-1) === 'restart')).toBe(true);
    expect(fake.calls).toContainEqual([
      '/Users/test/.bun/bin/bun',
      [
        '/Users/test/.claude/plugins/cache/thedotmack/claude-mem/13.18.0/scripts/worker-service.cjs',
        'restart'
      ]
    ]);
    expect(fake.calls).not.toContainEqual(['bun', ['add', '-g', 'gbrain@latest']]);
  });
});
