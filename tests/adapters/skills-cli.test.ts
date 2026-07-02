import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as exec from '../../src/util/exec.js';
import { skillsCliAdapter } from '../../src/adapters/skills-cli.js';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('skills-cli adapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.FRESHKEEPER_SKILLS_BIN;
    process.env.FRESHKEEPER_SKILLS_CWD = mkdtempSync(join(tmpdir(), 'freshkeeper-skills-empty-'));
    process.env.FRESHKEEPER_SKILLS_DISABLE_CACHE = '1';
  });

  it('detects via local `skills --version` before using npx', async () => {
    vi.spyOn(exec, 'safeExec').mockResolvedValue({ ok: true, stdout: '1.5.1', stderr: '' });
    const r = await skillsCliAdapter.detect();
    expect(r.installed).toBe(true);
    expect(r.version).toBe('1.5.1');
    expect(exec.safeExec).toHaveBeenCalledWith('skills', ['--version'], expect.any(Object));
  });

  it('update runs the resolved skills command', async () => {
    const spy = vi.spyOn(exec, 'safeExec').mockResolvedValue({ ok: true, stdout: '✓ Updated 18 skill(s)', stderr: '' });
    const r = await skillsCliAdapter.update();
    expect(spy).toHaveBeenLastCalledWith('skills', ['update', '-y'], expect.any(Object));
    expect(r.updated.length).toBeGreaterThan(0);
  });

  it('parses skill count from output', async () => {
    vi.spyOn(exec, 'safeExec').mockResolvedValue({ ok: true, stdout: '✓ Updated 18 skill(s)', stderr: '' });
    const r = await skillsCliAdapter.update();
    expect(r.logs).toContain('18');
  });

  it('falls back to npx when the local skills binary is missing', async () => {
    const spy = vi.spyOn(exec, 'safeExec').mockImplementation(async (cmd, args) => {
      if (cmd === 'skills') return { ok: false, stdout: '', stderr: '', error: 'ENOENT' };
      if (cmd === 'npx' && args.join(' ') === 'skills --version') return { ok: true, stdout: '1.5.2', stderr: '' };
      if (cmd === 'npx' && args.join(' ') === 'skills update -y') return { ok: true, stdout: '✓ Updated 2 skill(s)', stderr: '' };
      return { ok: false, stdout: '', stderr: '', error: 'unexpected command' };
    });

    const r = await skillsCliAdapter.update();
    expect(spy).toHaveBeenCalledWith('npx', ['skills', '--version'], expect.any(Object));
    expect(spy).toHaveBeenLastCalledWith('npx', ['skills', 'update', '-y'], expect.any(Object));
    expect(r.updated).toEqual(['2 skills']);
  });

  it('uses FRESHKEEPER_SKILLS_BIN when provided', async () => {
    process.env.FRESHKEEPER_SKILLS_BIN = '/tmp/skills-cli';
    const spy = vi.spyOn(exec, 'safeExec').mockResolvedValue({ ok: true, stdout: '1.5.3', stderr: '' });

    const r = await skillsCliAdapter.detect();

    expect(r).toMatchObject({ installed: true, version: '1.5.3' });
    expect(spy).toHaveBeenCalledWith('/tmp/skills-cli', ['--version'], expect.any(Object));
  });

  it('reports a useful update error when no skills CLI works', async () => {
    vi.spyOn(exec, 'safeExec').mockResolvedValue({ ok: false, stdout: '', stderr: '', error: 'timeout' });

    const r = await skillsCliAdapter.update();

    expect(r.updated).toHaveLength(0);
    expect(r.failed[0].error).toContain('skills CLI unavailable');
    expect(r.failed[0].error).toContain('npx skills');
  });

  it('refreshes github project skills from skills-lock.json', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'freshkeeper-skills-'));
    process.env.FRESHKEEPER_SKILLS_CWD = cwd;
    writeFileSync(join(cwd, 'skills-lock.json'), JSON.stringify({
      version: 1,
      skills: {
        'demo-skill': {
          source: 'owner/demo-skill',
          sourceType: 'github',
          computedHash: 'old'
        },
        'modern-skill': {
          source: 'owner/modern-skill',
          sourceType: 'github',
          skillPath: 'SKILL.md',
          computedHash: 'current'
        }
      }
    }));

    const spy = vi.spyOn(exec, 'safeExec').mockImplementation(async (cmd, args) => {
      if (cmd === 'skills' && args.join(' ') === '--version') return { ok: true, stdout: '1.5.4', stderr: '' };
      if (cmd === 'skills' && args.join(' ') === 'add owner/demo-skill --skill demo-skill --agent universal -y') {
        return { ok: true, stdout: 'Installed demo-skill', stderr: '' };
      }
      if (cmd === 'skills' && args.join(' ') === 'add owner/modern-skill --skill modern-skill --agent universal -y') {
        return { ok: true, stdout: 'Installed modern-skill', stderr: '' };
      }
      return { ok: false, stdout: '', stderr: '', error: `unexpected ${cmd} ${args.join(' ')}` };
    });

    const r = await skillsCliAdapter.update();

    expect(spy).toHaveBeenCalledWith(
      'skills',
      ['add', 'owner/demo-skill', '--skill', 'demo-skill', '--agent', 'universal', '-y'],
      expect.any(Object)
    );
    expect(spy).toHaveBeenCalledWith(
      'skills',
      ['add', 'owner/modern-skill', '--skill', 'modern-skill', '--agent', 'universal', '-y'],
      expect.any(Object)
    );
    expect(r.updated).toContain('2 skills');
    expect(r.failed).toHaveLength(0);
    expect(r.logs).toContain('Refreshing 2 project skill');
  });
});
