import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as exec from '../../src/util/exec.js';
import { claudeCodeAdapter } from '../../src/adapters/claude-code.js';

describe('claude-code adapter', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('detects installed claude with version', async () => {
    vi.spyOn(exec, 'safeExec').mockResolvedValue({ ok: true, stdout: '2.1.116 (Claude Code)', stderr: '' });
    const r = await claudeCodeAdapter.detect();
    expect(r.installed).toBe(true);
    expect(r.version).toBe('2.1.116');
  });

  it('reports not installed if `claude` binary missing', async () => {
    vi.spyOn(exec, 'safeExec').mockResolvedValue({ ok: false, stdout: '', stderr: '', error: 'ENOENT' });
    const r = await claudeCodeAdapter.detect();
    expect(r.installed).toBe(false);
  });

  it('update runs `claude update`', async () => {
    const spy = vi.spyOn(exec, 'safeExec').mockResolvedValue({ ok: true, stdout: 'Claude Code is up to date (2.1.116)', stderr: '' });
    const r = await claudeCodeAdapter.update();
    expect(spy).toHaveBeenCalledWith('claude', ['update']);
    expect(r.failed).toHaveLength(0);
    expect(r.logs).toContain('up to date');
  });
});
