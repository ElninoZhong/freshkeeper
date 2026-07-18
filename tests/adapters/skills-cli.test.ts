import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import * as exec from '../../src/util/exec.js';
import { skillsCliAdapter } from '../../src/adapters/skills-cli.js';
import { Registry } from '../../src/adapters/registry.js';
import { runUpdate } from '../../src/commands/update.js';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const envKeys = [
  'FRESHKEEPER_SKILLS_BIN',
  'FRESHKEEPER_ALLOW_GLOBAL_SKILLS_UPDATE',
  'FRESHKEEPER_SKILLS_CWD'
] as const;
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));

describe('skills-cli adapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.FRESHKEEPER_SKILLS_BIN;
    delete process.env.FRESHKEEPER_ALLOW_GLOBAL_SKILLS_UPDATE;
    process.env.FRESHKEEPER_SKILLS_CWD = mkdtempSync(join(tmpdir(), 'freshkeeper-skills-empty-'));
  });

  afterEach(() => {
    for (const key of envKeys) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('detects via local `skills --version` before using npx', async () => {
    vi.spyOn(exec, 'safeExec').mockResolvedValue({ ok: true, stdout: '1.5.1', stderr: '' });
    const r = await skillsCliAdapter.detect();
    expect(r.installed).toBe(true);
    expect(r.version).toBe('1.5.1');
    expect(exec.safeExec).toHaveBeenCalledWith('skills', ['--version'], expect.any(Object));
  });

  it('checks npx availability without executing the pinned package during detection', async () => {
    const spy = vi.spyOn(exec, 'safeExec').mockImplementation(async (cmd, args) => {
      if (cmd === 'skills') return { ok: false, stdout: '', stderr: '', error: 'ENOENT' };
      if (cmd === 'npx' && args.join(' ') === '--version') return { ok: true, stdout: '10.9.3', stderr: '' };
      return { ok: false, stdout: '', stderr: '', error: `unexpected ${cmd} ${args.join(' ')}` };
    });

    const result = await skillsCliAdapter.detect();

    expect(result).toMatchObject({ installed: true, installMethod: 'pinned-npx' });
    expect(spy).not.toHaveBeenCalledWith('npx', expect.arrayContaining(['skills@1.5.16']), expect.anything());
  });

  it('fails closed when no skills-lock.json exists', async () => {
    const spy = vi.spyOn(exec, 'safeExec').mockRejectedValue(new Error('safeExec must not be called'));
    const r = await skillsCliAdapter.update();

    expect(spy).not.toHaveBeenCalled();
    expect(r.updated).toEqual([]);
    expect(r.failed).toEqual([]);
    expect(r.logs).toContain('Skipped');
  });

  it('does not execute the pinned updater package during an orchestrated run with no lock', async () => {
    const spy = vi.spyOn(exec, 'safeExec').mockImplementation(async (cmd, args) => {
      if (cmd === 'skills') return { ok: false, stdout: '', stderr: '', error: 'ENOENT' };
      if (cmd === 'npx' && args.join(' ') === '--version') return { ok: true, stdout: '10.9.3', stderr: '' };
      return { ok: false, stdout: '', stderr: '', error: `unexpected ${cmd} ${args.join(' ')}` };
    });
    const registry = new Registry();
    registry.register(skillsCliAdapter);

    const report = await runUpdate(registry);

    expect(report.totalUpdated).toBe(0);
    expect(report.totalFailed).toBe(0);
    expect(spy).not.toHaveBeenCalledWith('npx', expect.arrayContaining(['skills@1.5.16']), expect.anything());
  });

  it('runs a global update only with explicit opt-in', async () => {
    delete process.env.FRESHKEEPER_SKILLS_CWD;
    process.env.FRESHKEEPER_ALLOW_GLOBAL_SKILLS_UPDATE = '1';
    vi.spyOn(exec, 'safeExec').mockResolvedValue({ ok: true, stdout: '✓ Updated 18 skill(s)', stderr: '' });
    const r = await skillsCliAdapter.update();

    expect(r.logs).toContain('18');
    expect(r.updated).toEqual(['18 skills']);
  });

  it('falls back to a pinned npx package when the local skills binary is missing', async () => {
    delete process.env.FRESHKEEPER_SKILLS_CWD;
    process.env.FRESHKEEPER_ALLOW_GLOBAL_SKILLS_UPDATE = '1';
    const spy = vi.spyOn(exec, 'safeExec').mockImplementation(async (cmd, args) => {
      if (cmd === 'skills') return { ok: false, stdout: '', stderr: '', error: 'ENOENT' };
      if (cmd === 'npx' && args.join(' ') === '--yes skills@1.5.16 --version') return { ok: true, stdout: '1.5.16', stderr: '' };
      if (cmd === 'npx' && args.join(' ') === '--yes skills@1.5.16 update -y') return { ok: true, stdout: '✓ Updated 2 skill(s)', stderr: '' };
      return { ok: false, stdout: '', stderr: '', error: 'unexpected command' };
    });

    const r = await skillsCliAdapter.update();
    expect(spy).toHaveBeenCalledWith('npx', ['--yes', 'skills@1.5.16', '--version'], expect.any(Object));
    expect(spy).toHaveBeenLastCalledWith('npx', ['--yes', 'skills@1.5.16', 'update', '-y'], expect.any(Object));
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
    delete process.env.FRESHKEEPER_SKILLS_CWD;
    process.env.FRESHKEEPER_ALLOW_GLOBAL_SKILLS_UPDATE = '1';
    vi.spyOn(exec, 'safeExec').mockResolvedValue({ ok: false, stdout: '', stderr: '', error: 'timeout' });

    const r = await skillsCliAdapter.update();

    expect(r.updated).toHaveLength(0);
    expect(r.failed[0].error).toContain('skills CLI unavailable');
    expect(r.failed[0].error).toContain('npx skills');
  });

  it('fails closed when skills-lock.json is malformed', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'freshkeeper-skills-malformed-'));
    process.env.FRESHKEEPER_SKILLS_CWD = cwd;
    writeFileSync(join(cwd, 'skills-lock.json'), '{not-json');
    const spy = vi.spyOn(exec, 'safeExec').mockRejectedValue(new Error('safeExec must not be called'));

    const r = await skillsCliAdapter.update();

    expect(spy).not.toHaveBeenCalled();
    expect(r.updated).toEqual([]);
    expect(r.failed[0]).toMatchObject({ item: 'skills-lock.json' });
  });

  it('fails closed when any GitHub lock entry is incomplete', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'freshkeeper-skills-incomplete-'));
    process.env.FRESHKEEPER_SKILLS_CWD = cwd;
    writeFileSync(join(cwd, 'skills-lock.json'), JSON.stringify({
      version: 1,
      skills: {
        'valid-skill': {
          source: 'owner/valid-skill',
          sourceType: 'github'
        },
        'missing-source': {
          sourceType: 'github'
        }
      }
    }));
    const spy = vi.spyOn(exec, 'safeExec').mockRejectedValue(new Error('safeExec must not be called'));

    const r = await skillsCliAdapter.update();

    expect(spy).not.toHaveBeenCalled();
    expect(r.updated).toEqual([]);
    expect(r.failed[0]).toMatchObject({ item: 'skills-lock.json' });
    expect(r.failed[0].error).toContain('missing-source');
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
