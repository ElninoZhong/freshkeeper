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

  it('update delegates to `claude plugin update codex@openai-codex`', async () => {
    const spy = vi.spyOn(exec, 'safeExec').mockResolvedValue({ ok: true, stdout: 'codex already latest', stderr: '' });
    const r = await codexAdapter.update();
    expect(spy).toHaveBeenCalledWith('claude', ['plugin', 'update', 'codex@openai-codex']);
    expect(r.updated).toContain('codex');
  });
});
