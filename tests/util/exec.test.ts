import { beforeEach, describe, it, expect, vi } from 'vitest';
import { execa } from 'execa';
import { safeExec } from '../../src/util/exec.js';

vi.mock('execa', () => ({ execa: vi.fn() }));

const mockedExeca = vi.mocked(execa);

describe('safeExec', () => {
  beforeEach(() => {
    mockedExeca.mockReset();
  });

  it('returns stdout on success', async () => {
    mockedExeca.mockResolvedValue({
      exitCode: 0,
      failed: false,
      stdout: 'hi\n',
      stderr: ''
    } as never);

    const r = await safeExec('example', ['--version']);

    expect(r.ok).toBe(true);
    expect(r.stdout.trim()).toBe('hi');
  });

  it('returns ok=false on non-zero exit', async () => {
    mockedExeca.mockResolvedValue({
      exitCode: 2,
      failed: true,
      shortMessage: 'Command failed',
      stdout: '',
      stderr: 'bad'
    } as never);

    const r = await safeExec('example', []);

    expect(r.ok).toBe(false);
    expect(r.exitCode).toBe(2);
  });

  it('returns ok=false when binary missing', async () => {
    mockedExeca.mockRejectedValue(new Error('ENOENT'));

    const r = await safeExec('missing', []);

    expect(r.ok).toBe(false);
    expect(r.error).toBe('ENOENT');
  });

  it('passes input directly to the child process', async () => {
    mockedExeca.mockResolvedValue({
      exitCode: 0,
      failed: false,
      stdout: '',
      stderr: ''
    } as never);

    const r = await safeExec(
      'crontab',
      ['-'],
      { input: 'safe stdin' }
    );

    expect(r.ok).toBe(true);
    expect(mockedExeca).toHaveBeenCalledWith('crontab', ['-'], expect.objectContaining({ input: 'safe stdin' }));
  });
});
