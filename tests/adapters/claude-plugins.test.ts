import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as exec from '../../src/util/exec.js';
import { claudePluginsAdapter, parsePluginList } from '../../src/adapters/claude-plugins.js';

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
});
