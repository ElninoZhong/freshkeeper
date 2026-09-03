import { describe, expect, it } from 'vitest';
import { createCodexPluginsAdapter } from '../../src/adapters/codex-plugins.js';
import type { ExecResult } from '../../src/util/exec.js';

const ok = (stdout = ''): ExecResult => ({ ok: true, stdout, stderr: '' });

function plugin(overrides: Record<string, unknown> = {}) {
  return {
    pluginId: 'sample@team',
    name: 'sample',
    marketplaceName: 'team',
    version: '1.0.0',
    installed: true,
    enabled: true,
    source: { source: 'local', path: '/tmp/team/sample' },
    marketplaceSource: { sourceType: 'local', source: '/tmp/team' },
    ...overrides
  };
}

describe('codex plugins adapter', () => {
  it('reports local source updates and broken caches without mutating them', async () => {
    const plugins = [
      plugin(),
      plugin({ pluginId: 'broken@team', name: 'broken', version: '2.0.0' })
    ];
    const adapter = createCodexPluginsAdapter({
      exec: async (cmd, args) => {
        if (cmd === 'codex' && args?.join(' ') === 'plugin list --json') {
          return ok(JSON.stringify({ installed: plugins }));
        }
        return { ok: false, stdout: '', stderr: 'unexpected command' };
      },
      payloadHealthy: (item) => item.name !== 'broken',
      localSourceVersion: (item) => item.name === 'sample' ? '1.1.0' : '2.0.0',
      remotePluginCount: () => 0
    });

    expect(await adapter.check()).toEqual({
      coverage: 'complete',
      note: undefined,
      updates: [
      {
        item: 'sample@team',
        currentVersion: '1.0.0',
        latestVersion: '1.1.0',
        source: 'codex-local-marketplace'
      },
      {
        item: 'broken@team',
        currentVersion: '2.0.0',
        latestVersion: 'repair-cache',
        source: 'codex-plugin-cache'
      }
      ]
    });
  });

  it('refreshes Git marketplaces, reinstalls plugins idempotently, and verifies the cache', async () => {
    const before = plugin({
      version: 'abc123',
      source: { source: 'git' },
      marketplaceSource: { sourceType: 'git', source: 'https://github.com/example/team.git' }
    });
    const after = { ...before, version: 'def456' };
    const calls: string[] = [];
    let listCount = 0;
    const adapter = createCodexPluginsAdapter({
      exec: async (cmd, args = []) => {
        calls.push(`${cmd} ${args.join(' ')}`);
        if (cmd === 'codex' && args.join(' ') === 'plugin list --json') {
          listCount += 1;
          return ok(JSON.stringify({ installed: [listCount === 1 ? before : after] }));
        }
        if (cmd === 'codex' && args.join(' ') === 'plugin marketplace upgrade team --json') return ok('{}');
        if (cmd === 'codex' && args.join(' ') === 'plugin add sample@team --json') return ok('{}');
        return { ok: false, stdout: '', stderr: 'unexpected command' };
      },
      payloadHealthy: () => true,
      localSourceVersion: () => undefined,
      remotePluginCount: () => 0
    });

    const result = await adapter.update();

    expect(calls).toContain('codex plugin marketplace upgrade team --json');
    expect(calls).toContain('codex plugin add sample@team --json');
    expect(result.updated).toEqual(['sample@team@def456']);
    expect(result.failed).toEqual([]);
  });

  it('keeps app-owned plugins report-only and delegates claude-mem to the MCP adapter', async () => {
    const plugins = [
      plugin({
        pluginId: 'browser@openai-bundled',
        name: 'browser',
        marketplaceName: 'openai-bundled',
        marketplaceSource: { sourceType: 'local', source: '/tmp/bundled' }
      }),
      plugin({
        pluginId: 'claude-mem@claude-mem-local',
        name: 'claude-mem',
        marketplaceName: 'claude-mem-local'
      })
    ];
    let listCount = 0;
    const adapter = createCodexPluginsAdapter({
      exec: async () => {
        listCount += 1;
        return ok(JSON.stringify({ installed: plugins }));
      },
      payloadHealthy: () => true,
      remotePluginCount: () => 3
    });

    const detected = await adapter.detect();
    const result = await adapter.update();

    expect(detected.note).toContain('4 host-managed');
    expect(result.updated).toEqual([]);
    expect(result.skipped).toEqual([
      {
        item: 'codex-host-managed-plugins',
        reason: '4 plugin(s) are updated by the Codex/ChatGPT host and were not overwritten'
      },
      {
        item: 'codex-mcp-plugins',
        reason: '1 plugin(s) are updated and health-checked by the MCP component adapter'
      }
    ]);
    expect(listCount).toBe(3);
  });
});
