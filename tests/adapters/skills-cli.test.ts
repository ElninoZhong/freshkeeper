import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as exec from '../../src/util/exec.js';
import { skillsCliAdapter } from '../../src/adapters/skills-cli.js';

describe('skills-cli adapter', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('detects via `npx skills --version`', async () => {
    vi.spyOn(exec, 'safeExec').mockResolvedValue({ ok: true, stdout: '1.5.1', stderr: '' });
    const r = await skillsCliAdapter.detect();
    expect(r.installed).toBe(true);
    expect(r.version).toBe('1.5.1');
  });

  it('update runs `npx skills update -y`', async () => {
    const spy = vi.spyOn(exec, 'safeExec').mockResolvedValue({ ok: true, stdout: '✓ Updated 18 skill(s)', stderr: '' });
    const r = await skillsCliAdapter.update();
    expect(spy).toHaveBeenCalledWith('npx', ['skills', 'update', '-y'], expect.any(Object));
    expect(r.updated.length).toBeGreaterThan(0);
  });

  it('parses skill count from output', async () => {
    vi.spyOn(exec, 'safeExec').mockResolvedValue({ ok: true, stdout: '✓ Updated 18 skill(s)', stderr: '' });
    const r = await skillsCliAdapter.update();
    expect(r.logs).toContain('18');
  });
});
