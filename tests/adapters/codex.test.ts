import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as exec from '../../src/util/exec.js';
import { codexAdapter } from '../../src/adapters/codex.js';

describe('codex adapter', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('detects installed codex with version', async () => {
    vi.spyOn(exec, 'safeExec').mockResolvedValue({ ok: true, stdout: 'codex-cli 0.122.0', stderr: '' });
    const r = await codexAdapter.detect();
    expect(r.installed).toBe(true);
    expect(r.version).toBe('0.122.0');
  });

  it('reports not installed when codex binary missing', async () => {
    vi.spyOn(exec, 'safeExec').mockResolvedValue({ ok: false, stdout: '', stderr: '', error: 'ENOENT' });
    const r = await codexAdapter.detect();
    expect(r.installed).toBe(false);
  });

  it('checks the npm package and updates the actual Codex CLI without Claude', async () => {
    let installedVersion = '0.122.0';
    const spy = vi.spyOn(exec, 'safeExec').mockImplementation(async (cmd, args) => {
      if (cmd === 'codex' && args[0] === '--version') {
        return { ok: true, stdout: `codex-cli ${installedVersion}`, stderr: '' };
      }
      if (cmd === 'npm' && args[0] === 'view') {
        return { ok: true, stdout: '"0.146.1"', stderr: '' };
      }
      if (cmd === 'npm' && args[0] === 'install') {
        installedVersion = '0.146.1';
        return { ok: true, stdout: 'updated codex', stderr: '' };
      }
      return { ok: false, stdout: '', stderr: `unexpected command: ${cmd} ${args.join(' ')}` };
    });

    const updates = await codexAdapter.check();
    const r = await codexAdapter.update();

    expect(updates).toEqual({ coverage: 'complete', updates: [{
      item: 'codex',
      currentVersion: '0.122.0',
      latestVersion: '0.146.1',
      source: 'npm:@openai/codex'
    }] });
    expect(spy).toHaveBeenCalledWith('npm', [
      'install',
      '--global',
      '@openai/codex@0.146.1',
      '--registry',
      'https://registry.npmjs.org/'
    ], expect.objectContaining({
      timeoutMs: 120_000,
      env: expect.objectContaining({ npm_config_cache: expect.stringContaining('npm-cache') })
    }));
    expect(spy).not.toHaveBeenCalledWith('claude', expect.anything());
    expect(r.updated).toEqual(['codex@0.146.1']);
  });

  it('does not reinstall or report an update when the checked version is already current', async () => {
    const spy = vi.spyOn(exec, 'safeExec').mockImplementation(async (cmd, args) => {
      if (cmd === 'codex' && args[0] === '--version') {
        return { ok: true, stdout: 'codex-cli 0.146.1', stderr: '' };
      }
      if (cmd === 'npm' && args[0] === 'view') {
        return { ok: true, stdout: '"0.146.1"', stderr: '' };
      }
      return { ok: false, stdout: '', stderr: 'unexpected mutation' };
    });

    const result = await codexAdapter.update();

    expect(spy).not.toHaveBeenCalledWith('npm', expect.arrayContaining(['install']), expect.anything());
    expect(result.updated).toEqual([]);
    expect(result.unchanged).toEqual(['codex@0.146.1']);
  });
});
