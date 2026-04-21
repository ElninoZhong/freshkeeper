import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as exec from '../../src/util/exec.js';
import { hermesAdapter } from '../../src/adapters/hermes.js';

describe('hermes adapter', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('detects installed hermes via `hermes version` subcommand', async () => {
    const spy = vi.spyOn(exec, 'safeExec').mockResolvedValue({ ok: true, stdout: 'hermes 0.4.1', stderr: '' });
    const r = await hermesAdapter.detect();
    expect(spy).toHaveBeenCalledWith('hermes', ['version']);
    expect(r.installed).toBe(true);
    expect(r.version).toBe('0.4.1');
  });

  it('reports not installed when binary missing', async () => {
    vi.spyOn(exec, 'safeExec').mockResolvedValue({ ok: false, stdout: '', stderr: '', error: 'ENOENT' });
    const r = await hermesAdapter.detect();
    expect(r.installed).toBe(false);
  });

  it('update runs both CLI update and skills update', async () => {
    const spy = vi.spyOn(exec, 'safeExec')
      .mockResolvedValueOnce({ ok: true, stdout: 'hermes updated', stderr: '' })
      .mockResolvedValueOnce({ ok: true, stdout: '5 skills updated', stderr: '' });
    const r = await hermesAdapter.update();
    expect(spy).toHaveBeenNthCalledWith(1, 'hermes', ['update']);
    expect(spy).toHaveBeenNthCalledWith(2, 'hermes', ['skills', 'update']);
    expect(r.updated).toEqual(['hermes-cli', 'hermes-skills']);
  });

  it('update reports CLI failure but still attempts skills update', async () => {
    vi.spyOn(exec, 'safeExec')
      .mockResolvedValueOnce({ ok: false, stdout: '', stderr: 'git pull failed', error: undefined })
      .mockResolvedValueOnce({ ok: true, stdout: 'skills ok', stderr: '' });
    const r = await hermesAdapter.update();
    expect(r.updated).toEqual(['hermes-skills']);
    expect(r.failed).toEqual([{ item: 'hermes-cli', error: 'git pull failed' }]);
  });
});
