import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const checkScript = resolve('skills/freshkeeper-check/scripts/check-installed-skills.mjs');
const updatePlanner = resolve('skills/freshkeeper-update/scripts/prepare-skill-update.mjs');
const provenanceUpdater = resolve('skills/freshkeeper-update/scripts/apply-provenance-updates.mjs');
const temporaryHomes: string[] = [];

function temporaryHome(): string {
  const path = mkdtempSync(join(tmpdir(), 'freshkeeper-skill-libraries-'));
  temporaryHomes.push(path);
  return path;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeSkill(root: string, folder: string, name = folder): string {
  const skillDir = join(root, folder);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), `---\nname: ${name}\ndescription: Synthetic test skill.\n---\n`, 'utf8');
  return skillDir;
}

function writeSkillVersion(root: string, folder: string, version: string): string {
  const skillDir = writeSkill(root, folder);
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    `---\nname: ${folder}\ndescription: Synthetic ${version} skill.\n---\n\n# ${version}\n`,
    'utf8'
  );
  return skillDir;
}

function blobSha(content: string): string {
  const value = Buffer.from(content);
  return createHash('sha1')
    .update(Buffer.from(`blob ${value.length}\0`))
    .update(value)
    .digest('hex');
}

function gitTreeFixture(repository: string, commit = 'HEAD'): any {
  const sha = execFileSync('git', ['rev-parse', `${commit}^{tree}`], {
    cwd: repository,
    encoding: 'utf8'
  }).trim();
  const output = execFileSync('git', ['ls-tree', '-r', commit], {
    cwd: repository,
    encoding: 'utf8'
  });
  return {
    sha,
    tree: output.trim().split('\n').filter(Boolean).map((line) => {
      const [metadata, path] = line.split('\t');
      return { type: 'blob', path, sha: metadata.split(' ')[2] };
    })
  };
}

function runJson(script: string, args: string[]): any {
  return JSON.parse(execFileSync(process.execPath, [script, ...args], { encoding: 'utf8' }));
}

afterEach(() => {
  for (const path of temporaryHomes.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('Freshkeeper installed-Skill library discovery', () => {
  it('prefers the shared library when it exists', () => {
    const home = temporaryHome();
    writeSkill(join(home, '.agents', 'skills'), 'shared-one');
    writeSkill(join(home, '.codex', 'skills'), 'codex-only');
    const fixture = join(home, 'fixture.json');
    writeJson(fixture, {});

    const result = runJson(checkScript, ['--home', home, '--fixture', fixture, '--json']);

    expect(result.libraryMode).toBe('shared');
    expect(result.skillRoots).toEqual([join(home, '.agents', 'skills')]);
    expect(result.items.map((item: any) => item.name)).toEqual(['shared-one']);
  });

  it('falls back to agent-local libraries and deduplicates symlink aliases', () => {
    const home = temporaryHome();
    const codexRoot = join(home, '.codex', 'skills');
    const claudeRoot = join(home, '.claude', 'skills');
    const openClawRoot = join(home, '.openclaw', 'skills');
    writeSkill(codexRoot, 'alpha');
    mkdirSync(claudeRoot, { recursive: true });
    symlinkSync(join(codexRoot, 'alpha'), join(claudeRoot, 'alpha'), 'dir');
    writeSkill(openClawRoot, 'beta');
    writeJson(join(home, '.agents', '.skill-lock.json'), {
      version: 3,
      skills: {
        alpha: {
          source: 'owner/repo',
          sourceType: 'github',
          skillPath: 'skills/alpha/SKILL.md',
          skillFolderHash: 'old-hash'
        }
      }
    });
    const fixture = join(home, 'fixture.json');
    writeJson(fixture, {
      'owner/repo': {
        sha: 'repo-hash',
        tree: [{ type: 'tree', path: 'skills/alpha', sha: 'new-hash' }]
      }
    });

    const result = runJson(checkScript, ['--home', home, '--fixture', fixture, '--json']);
    const alpha = result.items.find((item: any) => item.name === 'alpha');

    expect(result.libraryMode).toBe('agent-local');
    expect(result.totalInstalled).toBe(2);
    expect(alpha.status).toBe('update-available');
    expect(alpha.agents).toEqual(['claude-code', 'codex']);
    expect(result.items.find((item: any) => item.name === 'beta').agents).toEqual(['openclaw']);
  });

  it('plans in-place agent-local updates and creates a verified backup without a shared library', () => {
    const home = temporaryHome();
    const codexRoot = join(home, '.codex', 'skills');
    const claudeRoot = join(home, '.claude', 'skills');
    const alpha = writeSkill(codexRoot, 'alpha');
    mkdirSync(claudeRoot, { recursive: true });
    symlinkSync(alpha, join(claudeRoot, 'alpha'), 'dir');
    writeSkill(join(home, '.hermes', 'skills'), 'local-note');
    writeJson(join(home, '.agents', '.skill-lock.json'), {
      version: 3,
      skills: {
        alpha: {
          source: 'owner/repo',
          sourceType: 'github',
          skillPath: 'skills/alpha/SKILL.md',
          skillFolderHash: 'recorded-hash'
        },
        'local-note': {
          source: 'local',
          sourceType: 'local',
          skillPath: 'local-note/SKILL.md',
          skillFolderHash: 'local-hash'
        }
      }
    });

    const plan = runJson(updatePlanner, ['--home', home, '--json']);
    const alphaPlan = plan.items.find((item: any) => item.name === 'alpha');

    expect(plan.libraryMode).toBe('agent-local');
    expect(alphaPlan.status).toBe('updateable');
    expect(alphaPlan.installSource).toBe('owner/repo/skills/alpha');
    expect(alphaPlan.agents).toEqual(['claude-code', 'codex']);
    expect(alphaPlan.writeAgents).toEqual(['codex']);
    expect(plan.items.find((item: any) => item.name === 'local-note').status).toBe('local-only');
    expect(existsSync(join(home, '.agents', 'skills'))).toBe(false);

    const prepared = runJson(updatePlanner, ['--home', home, '--backup', '--json']);

    expect(existsSync(prepared.backup.manifestPath)).toBe(true);
    expect(JSON.parse(readFileSync(prepared.backup.manifestPath, 'utf8')).libraryMode).toBe('agent-local');
    expect(existsSync(join(home, '.agents', 'skills'))).toBe(false);
    const claudeBackup = prepared.backup.libraries.find((library: any) => library.path === claudeRoot);
    expect(lstatSync(join(claudeBackup.backupPath, 'alpha')).isSymbolicLink()).toBe(true);
  });

  it('recovers untracked sources and distinguishes current, safe, merge, and legacy states', () => {
    const home = temporaryHome();
    const root = join(home, '.agents', 'skills');
    const exact = writeSkillVersion(root, 'exact', 'v2');
    const subset = writeSkillVersion(root, 'subset', 'v2');
    const old = writeSkillVersion(root, 'old', 'v1');
    const custom = writeSkillVersion(root, 'custom', 'local');
    const legacy = writeSkillVersion(root, 'legacy', 'v1');
    const inspired = writeSkillVersion(root, 'inspired', 'local');
    writeFileSync(
      join(inspired, 'SKILL.md'),
      `${readFileSync(join(inspired, 'SKILL.md'), 'utf8')}\nOptional dependency: https://github.com/other/tool\n`,
      'utf8'
    );
    expect(exact && subset && old && custom && legacy && inspired).toBeTruthy();

    const catalog = join(home, 'catalog.json');
    writeJson(catalog, {
      version: 1,
      repositories: [{
        source: 'owner/repo',
        skills: {
          exact: 'skills/exact',
          subset: 'skills/subset',
          old: 'skills/old',
          custom: 'skills/custom',
          legacy: 'skills/legacy'
        }
      }]
    });
    const exactContent = readFileSync(join(root, 'exact', 'SKILL.md'), 'utf8');
    const subsetContent = readFileSync(join(root, 'subset', 'SKILL.md'), 'utf8');
    const oldContent = readFileSync(join(root, 'old', 'SKILL.md'), 'utf8');
    const currentOld = oldContent.replaceAll('v1', 'v2');
    const currentCustom = oldContent.replaceAll('old', 'custom').replaceAll('v1', 'v2');
    const fixture = join(home, 'fixture.json');
    writeJson(fixture, {
      'owner/repo': {
        sha: 'current-tree',
        tree: [
          { type: 'blob', path: 'skills/exact/SKILL.md', sha: blobSha(exactContent) },
          { type: 'blob', path: 'skills/subset/SKILL.md', sha: blobSha(subsetContent) },
          { type: 'blob', path: 'skills/subset/references/guide.md', sha: blobSha('guide\n') },
          { type: 'blob', path: 'skills/old/SKILL.md', sha: blobSha(currentOld) },
          { type: 'blob', path: 'skills/custom/SKILL.md', sha: blobSha(currentCustom) }
        ],
        history: [
          ...Array.from({ length: 45 }, (_, index) => ({
            commit: `unrelated-${index}`,
            sha: `unrelated-tree-${index}`,
            tree: []
          })),
          {
            commit: 'old-commit',
            sha: 'old-tree',
            tree: [
              { type: 'blob', path: 'skills/old/SKILL.md', sha: blobSha(oldContent) },
              { type: 'blob', path: 'skills/legacy/SKILL.md', sha: blobSha(readFileSync(join(root, 'legacy', 'SKILL.md'), 'utf8')) }
            ]
          }
        ]
      },
      'other/tool': {
        sha: 'dependency-tree',
        tree: [
          { type: 'blob', path: 'SKILL.md', sha: blobSha('not the installed skill\n') }
        ]
      }
    });

    const result = runJson(checkScript, [
      '--home', home,
      '--fixture', fixture,
      '--provenance-catalog', catalog,
      '--json'
    ]);
    const status = Object.fromEntries(result.items.map((item: any) => [item.name, item.status]));

    expect(status).toEqual({
      custom: 'manual-merge',
      exact: 'exact-current',
      inspired: 'untracked',
      legacy: 'legacy-local',
      old: 'clean-old',
      subset: 'current-subset'
    });
    expect(result.recoveredSources).toBe(5);
    expect(result.updatesAvailable).toBe(2);
    expect(result.manualMerge).toBe(1);
    expect(result.legacyLocal).toBe(1);
  });

  it('applies a clean historical update transactionally from a verified plan', () => {
    const home = temporaryHome();
    const root = join(home, '.agents', 'skills');
    const installed = writeSkillVersion(root, 'alpha', 'v1');
    writeFileSync(join(installed, 'old.txt'), 'old\n', 'utf8');

    const upstream = join(home, 'upstream');
    mkdirSync(join(upstream, 'skills', 'alpha'), { recursive: true });
    execFileSync('git', ['init', '-b', 'main'], { cwd: upstream });
    execFileSync('git', ['config', 'user.name', 'Freshkeeper Test'], { cwd: upstream });
    execFileSync('git', ['config', 'user.email', 'freshkeeper@example.test'], { cwd: upstream });
    writeFileSync(
      join(upstream, 'skills', 'alpha', 'SKILL.md'),
      readFileSync(join(installed, 'SKILL.md'), 'utf8'),
      'utf8'
    );
    writeFileSync(join(upstream, 'skills', 'alpha', 'old.txt'), 'old\n', 'utf8');
    execFileSync('git', ['add', '.'], { cwd: upstream });
    execFileSync('git', ['commit', '-m', 'old'], { cwd: upstream });
    const oldCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: upstream, encoding: 'utf8' }).trim();
    const oldTree = gitTreeFixture(upstream, oldCommit);

    writeFileSync(
      join(upstream, 'skills', 'alpha', 'SKILL.md'),
      readFileSync(join(installed, 'SKILL.md'), 'utf8').replaceAll('v1', 'v2'),
      'utf8'
    );
    rmSync(join(upstream, 'skills', 'alpha', 'old.txt'));
    writeFileSync(join(upstream, 'skills', 'alpha', 'new.txt'), 'new\n', 'utf8');
    execFileSync('git', ['add', '-A'], { cwd: upstream });
    execFileSync('git', ['commit', '-m', 'current'], { cwd: upstream });
    const currentTree = gitTreeFixture(upstream);

    const catalog = join(home, 'catalog.json');
    writeJson(catalog, {
      version: 1,
      repositories: [{ source: 'owner/repo', skills: { alpha: 'skills/alpha' } }]
    });
    const fixture = join(home, 'fixture.json');
    writeJson(fixture, {
      'owner/repo': {
        ...currentTree,
        history: [{ ...oldTree, commit: oldCommit }]
      }
    });
    const planPath = join(home, 'plan.json');
    const plan = runJson(updatePlanner, [
      '--home', home,
      '--fixture', fixture,
      '--provenance-catalog', catalog,
      '--backup',
      '--write-plan', planPath,
      '--json'
    ]);

    expect(plan.items[0].status).toBe('recoverable-update');
    const result = runJson(provenanceUpdater, [
      '--plan', planPath,
      '--upstream-root', `owner/repo=${upstream}`,
      '--apply',
      '--json'
    ]);

    expect(result.failed).toBe(0);
    expect(result.updated).toBe(1);
    expect(readFileSync(join(installed, 'SKILL.md'), 'utf8')).toContain('v2');
    expect(existsSync(join(installed, 'new.txt'))).toBe(true);
    expect(existsSync(join(installed, 'old.txt'))).toBe(false);
  });
});
