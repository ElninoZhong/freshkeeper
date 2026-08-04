import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as exec from '../../src/util/exec.js';
import {
  claudePluginsAdapter,
  parsePluginList,
  parsePluginListJson
} from '../../src/adapters/claude-plugins.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(__dirname, '../fixtures/claude-plugin-list.txt'), 'utf-8');

describe('claude-plugins adapter', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('parses plugin list output into objects', () => {
    const parsed = parsePluginList(fixture);
    expect(parsed).toEqual([
      { name: 'claude-mem', source: 'thedotmack', version: '12.1.5', scope: 'user' },
      { name: 'codex', source: 'openai-codex', version: '1.0.4', scope: 'user' }
    ]);
  });

  it('detect reports installed when plugins found', async () => {
    vi.spyOn(exec, 'safeExec').mockResolvedValue({ ok: true, stdout: fixture, stderr: '' });
    const r = await claudePluginsAdapter.detect();
    expect(r.installed).toBe(true);
    expect(r.note).toContain('2 plugin');
  });

  it('update runs claude plugin update per plugin and aggregates results', async () => {
    const spy = vi.spyOn(exec, 'safeExec')
      .mockResolvedValueOnce({ ok: true, stdout: fixture, stderr: '' })
      .mockResolvedValueOnce({ ok: true, stdout: 'updated claude-mem', stderr: '' })
      .mockResolvedValueOnce({ ok: true, stdout: 'already latest codex', stderr: '' });
    const r = await claudePluginsAdapter.update();
    expect(spy).toHaveBeenCalledTimes(3);
    expect(r.updated).toEqual(['claude-mem@thedotmack', 'codex@openai-codex']);
  });

  it('parses JSON plugin inventory for a reproducible lock', () => {
    expect(parsePluginListJson(JSON.stringify([
      { id: 'claude-mem@thedotmack', version: '13.10.2', scope: 'user', enabled: true }
    ]))).toEqual([
      { name: 'claude-mem', source: 'thedotmack', version: '13.10.2', scope: 'user', enabled: true }
    ]);
  });

  it('fails loudly instead of claiming it can downgrade a plugin', async () => {
    vi.spyOn(exec, 'safeExec').mockResolvedValue({
      ok: true,
      stdout: JSON.stringify([
        { id: 'claude-mem@thedotmack', version: '13.10.2', scope: 'user', enabled: true }
      ]),
      stderr: ''
    });

    const result = await claudePluginsAdapter.restoreLock?.({
      adapter: 'claude-plugins',
      plugins: [{ id: 'claude-mem@thedotmack', version: '12.1.5', scope: 'user', enabled: true }]
    }, { projectDir: process.cwd() });

    expect(result?.updated).toEqual([]);
    expect(result?.failed[0]?.error).toMatch(/cannot downgrade/i);
  });

  it('upgrades, restores enabled state, and verifies the final plugin inventory', async () => {
    const pluginList = (version: string, enabled: boolean) => JSON.stringify([
      { id: 'claude-mem@thedotmack', version, scope: 'user', enabled }
    ]);
    const spy = vi.spyOn(exec, 'safeExec')
      .mockResolvedValueOnce({ ok: true, stdout: pluginList('13.10.1', false), stderr: '' })
      .mockResolvedValueOnce({ ok: true, stdout: 'updated', stderr: '' })
      .mockResolvedValueOnce({ ok: true, stdout: pluginList('13.10.2', false), stderr: '' })
      .mockResolvedValueOnce({ ok: true, stdout: 'enabled', stderr: '' })
      .mockResolvedValueOnce({ ok: true, stdout: pluginList('13.10.2', true), stderr: '' });

    const result = await claudePluginsAdapter.restoreLock?.({
      adapter: 'claude-plugins',
      plugins: [{ id: 'claude-mem@thedotmack', version: '13.10.2', scope: 'user', enabled: true }]
    }, { projectDir: '/tmp/freshkeeper-plugin-project' });

    expect(spy).toHaveBeenNthCalledWith(
      2,
      'claude',
      ['plugin', 'update', 'claude-mem@thedotmack', '--scope', 'user'],
      { cwd: '/tmp/freshkeeper-plugin-project' }
    );
    expect(spy).toHaveBeenNthCalledWith(
      4,
      'claude',
      ['plugin', 'enable', 'claude-mem@thedotmack', '--scope', 'user'],
      { cwd: '/tmp/freshkeeper-plugin-project' }
    );
    expect(result?.updated).toEqual(['claude-mem@thedotmack@13.10.2']);
    expect(result?.failed).toEqual([]);
  });
});
