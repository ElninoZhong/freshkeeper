import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as exec from '../../src/util/exec.js';
import {
  renderCrontabLine,
  markerBegin,
  markerEnd,
  injectIntoCrontab,
  installCrontab,
  uninstallCrontab
} from '../../src/scheduler/crontab.js';

describe('crontab rendering', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('renders line with cron expression and freshkeeper update command', () => {
    const line = renderCrontabLine('0 10 * * 1', 'freshkeeper');
    expect(line).toMatch(/^0 10 \* \* 1\s+'freshkeeper' update/);
  });

  it('wraps content in managed block when injecting', () => {
    const existing = 'existing\n';
    const newTab = injectIntoCrontab(existing, '0 10 * * 1', 'freshkeeper');
    expect(newTab).toContain(markerBegin);
    expect(newTab).toContain(markerEnd);
    expect(newTab).toContain('existing');
  });

  it('replaces existing managed block on re-inject', () => {
    const existing = `${markerBegin}\n0 9 * * * old\n${markerEnd}\nother\n`;
    const newTab = injectIntoCrontab(existing, '0 10 * * 1', 'freshkeeper');
    expect(newTab).not.toContain('old');
    expect(newTab).toContain('other');
    expect((newTab.match(new RegExp(markerBegin, 'g')) || []).length).toBe(1);
  });

  it('rejects invalid or multiline cron expressions before reading crontab', async () => {
    const spy = vi.spyOn(exec, 'safeExec').mockRejectedValue(new Error('safeExec must not be called'));

    await expect(installCrontab('0 10 * * 1\n* * * * * evil')).rejects.toThrow(/invalid cron/i);
    await expect(installCrontab('* * * * * *')).rejects.toThrow(/invalid cron/i);
    expect(spy).not.toHaveBeenCalled();
  });

  it('writes crontab through stdin without invoking a shell', async () => {
    const spy = vi.spyOn(exec, 'safeExec').mockImplementation(async (cmd, args, opts) => {
      if (cmd === 'crontab' && args[0] === '-l') {
        return { ok: false, stdout: '', stderr: 'no crontab for user', exitCode: 1 };
      }
      if (cmd === 'which') return { ok: true, stdout: '/usr/local/bin/freshkeeper', stderr: '' };
      if (cmd === 'crontab' && args[0] === '-') {
        expect(opts?.input).toContain(markerBegin);
        return { ok: true, stdout: '', stderr: '' };
      }
      return { ok: false, stdout: '', stderr: '', error: `unexpected ${cmd}` };
    });

    await installCrontab('0 10 * * 1');

    expect(spy).not.toHaveBeenCalledWith('bash', expect.anything(), expect.anything());
    expect(spy).toHaveBeenCalledWith('crontab', ['-'], expect.objectContaining({ input: expect.any(String) }));
  });

  it('does not overwrite crontab when reading it fails unexpectedly', async () => {
    const spy = vi.spyOn(exec, 'safeExec').mockResolvedValue({
      ok: false,
      stdout: '',
      stderr: 'permission denied',
      exitCode: 1
    });

    await expect(installCrontab('0 10 * * 1')).rejects.toThrow(/read failed/i);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('surfaces uninstall write failures', async () => {
    vi.spyOn(exec, 'safeExec').mockImplementation(async (cmd, args) => {
      if (cmd === 'crontab' && args[0] === '-l') {
        return { ok: true, stdout: `${markerBegin}\n0 10 * * 1 freshkeeper update\n${markerEnd}\n`, stderr: '' };
      }
      return { ok: false, stdout: '', stderr: 'write denied', exitCode: 1 };
    });

    await expect(uninstallCrontab()).rejects.toThrow(/write failed/i);
  });
});
