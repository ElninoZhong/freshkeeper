import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as exec from '../../src/util/exec.js';
import { openClawAdapter } from '../../src/adapters/openclaw.js';

describe('openclaw adapter', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('detects installed openclaw with version', async () => {
    vi.spyOn(exec, 'safeExec').mockResolvedValue({ ok: true, stdout: 'openclaw 0.8.2', stderr: '' });
    const r = await openClawAdapter.detect();
    expect(r.installed).toBe(true);
    expect(r.version).toBe('0.8.2');
  });

  it('reports not installed when openclaw binary missing', async () => {
    vi.spyOn(exec, 'safeExec').mockResolvedValue({ ok: false, stdout: '', stderr: '', error: 'ENOENT' });
    const r = await openClawAdapter.detect();
    expect(r.installed).toBe(false);
  });

  it('update runs openclaw CLI and skills updates', async () => {
    const spy = vi
      .spyOn(exec, 'safeExec')
      .mockResolvedValueOnce({ ok: true, stdout: 'openclaw 0.8.2', stderr: '' })
      .mockResolvedValueOnce({ ok: true, stdout: 'updated cli', stderr: '' })
      .mockResolvedValueOnce({ ok: true, stdout: 'openclaw 0.9.0', stderr: '' })
      .mockResolvedValueOnce({ ok: true, stdout: 'Updated 2 skills', stderr: '' });

    const r = await openClawAdapter.update();

    expect(spy).toHaveBeenNthCalledWith(2, 'openclaw', ['update', '--channel', 'stable']);
    expect(spy).toHaveBeenNthCalledWith(4, 'openclaw', ['skills', 'update']);
    expect(r.updated).toEqual(['openclaw-cli@0.9.0', '2 openclaw-skills']);
    expect(r.failed).toEqual([]);
  });

  it('update reports skills failure separately', async () => {
    vi
      .spyOn(exec, 'safeExec')
      .mockResolvedValueOnce({ ok: true, stdout: 'openclaw 0.8.2', stderr: '' })
      .mockResolvedValueOnce({ ok: true, stdout: 'updated cli', stderr: '' })
      .mockResolvedValueOnce({ ok: true, stdout: 'openclaw 0.9.0', stderr: '' })
      .mockResolvedValueOnce({ ok: false, stdout: '', stderr: 'network error' });

    const r = await openClawAdapter.update();

    expect(r.updated).toEqual(['openclaw-cli@0.9.0']);
    expect(r.failed).toEqual([{ item: 'openclaw-skills', error: 'network error' }]);
  });
});
