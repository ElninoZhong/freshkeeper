import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { auditProvenance } from '../../skills/freshkeeper-update/scripts/provenance.mjs';

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
  vi.unstubAllGlobals();
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

  it('records the Git tree SHA rather than the commit SHA for recovered upstreams', async () => {
    const home = temporaryHome();
    const root = join(home, '.agents', 'skills');
    const skillDir = writeSkill(root, 'alpha');
    const skillContent = readFileSync(join(skillDir, 'SKILL.md'));
    const catalog = join(home, 'catalog.json');
    writeJson(catalog, {
      version: 1,
      repositories: [{ source: 'owner/repo', skills: { alpha: 'skills/alpha' } }]
    });

    const tree = [{
      type: 'blob',
      path: 'skills/alpha/SKILL.md',
      sha: blobSha(skillContent.toString('utf8'))
    }];
    vi.stubGlobal('fetch', async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/commits/HEAD')) {
        return Response.json({ sha: 'commit-sha', commit: { tree: { sha: 'tree-sha' } } });
      }
      if (url.includes('/git/trees/tree-sha?recursive=1')) {
        return Response.json({ sha: 'tree-sha', tree });
      }
      if (url.includes('/git/trees/HEAD?recursive=1')) {
        return Response.json({ sha: 'commit-sha', tree });
      }
      return new Response('not found', { status: 404 });
    });

    const result = await auditProvenance({
      skills: [{ name: 'alpha', folder: 'alpha', path: skillDir, realPath: skillDir }],
      catalogPath: catalog,
      historyLimit: 0
    });

    expect(result.get(skillDir)?.upstreamTreeHash).toBe('tree-sha');
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

describe('Skill version comparison and explicit metadata fill', () => {
  function wellKnownHome() {
    const home = temporaryHome();
    const skill = writeSkill(join(home, '.agents', 'skills'), 'official');
    const content = readFileSync(join(skill, 'SKILL.md'), 'utf8');
    const sourceUrl = 'https://vendor.example/.well-known/skills/official/SKILL.md';
    const lockPath = join(home, '.agents', '.skill-lock.json');
    writeJson(lockPath, { version: 3, skills: { official: { source: 'vendor.example', sourceType: 'well-known', sourceUrl, wellKnownDigest: 'preserve-installed-digest' } }, dismissed: ['preserve-me'] });
    const fixture = join(home, 'fixture.json');
    writeJson(fixture, { $wellKnown: { [sourceUrl]: { files: { 'SKILL.md': content } } } });
    return { home, skill: realpathSync(skill), content, sourceUrl, lockPath, fixture };
  }

  it('compares official contents without inventing a semantic version or writing a lock', () => {
    const c = wellKnownHome();
    const before = readFileSync(c.lockPath, 'utf8');
    const result = runJson(checkScript, ['--home', c.home, '--fixture', c.fixture, '--json']);
    expect(result.items[0].status).toBe('exact-current');
    expect(result.items[0].upstreamVersionKind).toBe('content-digest');
    expect(result.items[0].upstreamVersion).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(readFileSync(c.lockPath, 'utf8')).toBe(before);
    expect(result.metadata).toBeNull();
  });

  it('previews then atomically fills tracking, preserving install digests and unrelated metadata', () => {
    const c = wellKnownHome();
    const before = readFileSync(c.lockPath, 'utf8');
    const args = ['--home', c.home, '--fixture', c.fixture, '--fill-metadata', '--json'];
    expect(runJson(checkScript, args).metadata.mode).toBe('preview');
    expect(readFileSync(c.lockPath, 'utf8')).toBe(before);
    const applied = runJson(checkScript, [...args, '--apply-metadata']);
    expect(applied.metadata.mode).toBe('applied');
    expect(readFileSync(applied.metadata.backupPath, 'utf8')).toBe(before);
    const lock = JSON.parse(readFileSync(c.lockPath, 'utf8'));
    expect(lock.skills.official.wellKnownDigest).toBe('preserve-installed-digest');
    expect(lock.dismissed).toEqual(['preserve-me']);
    expect(lock.freshkeeperTracking[c.skill].sourceStatus).toBe('confirmed');
    writeFileSync(join(c.skill, 'extra.md'), 'local extension');
    const check = runJson(checkScript, ['--home', c.home, '--fixture', c.fixture, '--json']);
    expect(check.items[0].status).toBe('local-extension');
    expect(check.items[0].localDrift).toBe(true);
    const again = runJson(checkScript, [...args, '--apply-metadata']);
    const after = JSON.parse(readFileSync(c.lockPath, 'utf8'));
    expect(after.freshkeeperTracking[c.skill].baselineSnapshotHash).toBe(lock.freshkeeperTracking[c.skill].baselineSnapshotHash);
    expect(again.metadata.actions).toHaveLength(1);
  });

  it('reports upstream changes only when the entire local directory matches its installation digest', () => {
    const c = wellKnownHome();
    const hash = createHash('sha256').update('SKILL.md').update('\0').update(c.content).update('\0').digest('hex');
    const lock = JSON.parse(readFileSync(c.lockPath, 'utf8'));
    lock.skills.official.wellKnownDigest = `sha256:${hash}`;
    writeJson(c.lockPath, lock);
    writeJson(c.fixture, { $wellKnown: { [c.sourceUrl]: { files: { 'SKILL.md': c.content + '\nupstream change' } } } });
    const args = ['--home', c.home, '--fixture', c.fixture, '--json'];
    expect(runJson(checkScript, args).items[0].status).toBe('update-available');
    writeFileSync(join(c.skill, 'SKILL.md'), c.content + '\nlocal patch');
    expect(runJson(checkScript, args).items[0].status).toBe('manual-merge');
  });

  it('tracks unresolved Skills honestly and keeps same-name physical copies separate', () => {
    const home = temporaryHome();
    const one = writeSkill(join(home, '.codex', 'skills'), 'same');
    const two = writeSkill(join(home, '.openclaw', 'skills'), 'same');
    const fixture = join(home, 'fixture.json');
    writeJson(fixture, {});
    const result = runJson(checkScript, ['--home', home, '--fixture', fixture, '--fill-metadata', '--apply-metadata', '--json']);
    const lock = JSON.parse(readFileSync(result.lockPath, 'utf8'));
    expect(Object.keys(lock.freshkeeperTracking).sort()).toEqual([realpathSync(one), realpathSync(two)].sort());
    expect(lock.freshkeeperTracking[realpathSync(one)].sourceStatus).toBe('unknown');
    expect(lock.skills).toEqual({});
  });

  it('accepts evidenced local authorship without treating it as a public upstream version', () => {
    const home = temporaryHome();
    const skill = writeSkill(join(home, '.agents', 'skills'), 'personal');
    const evidence = join(home, 'creation.txt');
    writeFileSync(evidence, 'Created personal from local course notes.');
    const sourceMap = join(home, 'source-map.json');
    writeJson(sourceMap, { version: 1, sources: { personal: { sourceType: 'local', source: 'local-authoring', evidence: [evidence] } } });
    const fixture = join(home, 'fixture.json');
    writeJson(fixture, {});
    const result = runJson(checkScript, ['--home', home, '--fixture', fixture, '--source-map', sourceMap, '--fill-metadata', '--apply-metadata', '--json']);
    expect(result.items[0].status).toBe('local-tracked');
    const check = runJson(checkScript, ['--home', home, '--fixture', fixture, '--json']);
    expect(check.items[0].status).toBe('local-tracked');
    expect(check.items[0].upstreamVersion).toBeUndefined();
    expect(check.items[0].metadataTracked).toBe(true);
    expect(check.items[0].realPath).toBe(realpathSync(skill));
  });

  it('fails closed on malformed locks and refuses apply without explicit fill mode', () => {
    const c = wellKnownHome();
    expect(() => runJson(checkScript, ['--home', c.home, '--fixture', c.fixture, '--apply-metadata', '--json'])).toThrow();
    writeFileSync(c.lockPath, '{bad');
    expect(() => runJson(checkScript, ['--home', c.home, '--fixture', c.fixture, '--fill-metadata', '--apply-metadata', '--json'])).toThrow();
    expect(readFileSync(c.lockPath, 'utf8')).toBe('{bad');
  });
});


describe('local-version preflight ordering', () => {
  it('reads every local snapshot before the first upstream request', () => {
    const home = temporaryHome();
    const root = join(home, '.agents', 'skills');
    const one = writeSkill(root, 'one');
    const two = writeSkill(root, 'two');
    writeFileSync(join(one, 'local.txt'), 'one');
    writeFileSync(join(two, 'local.txt'), 'two');
    writeJson(join(home, '.agents', '.skill-lock.json'), { version: 3, skills: {
      one: { source: 'owner/repo', sourceType: 'github', skillPath: 'skills/one/SKILL.md', skillFolderHash: 'installed' },
      two: { source: 'owner/repo', sourceType: 'github', skillPath: 'skills/two/SKILL.md', skillFolderHash: 'installed' }
    } });
    const marker = join(home, 'order.json');
    const preload = join(home, 'preload.mjs');
    writeFileSync(preload, `
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      const seen = new Set();
      const read = fs.promises.readFile;
      fs.promises.readFile = async function(path, ...args) {
        if (process.env.TEST_FAIL_LOCAL && String(path).endsWith('/two/local.txt')) throw new Error('Synthetic local read denied');
        const result = await read.call(this, path, ...args);
        seen.add(String(path));
        return result;
      };
      syncBuiltinESMExports();
      globalThis.fetch = async () => {
        fs.writeFileSync(process.env.TEST_ORDER_MARKER ?? ${JSON.stringify(marker)}, JSON.stringify([...seen]));
        throw new Error('Synthetic upstream unavailable');
      };
    `);
    const child = spawnSync(process.execPath, ['--import', preload, checkScript, '--home', home, '--json'], {
      encoding: 'utf8', env: { ...process.env, GH_TOKEN: 'synthetic', GITHUB_TOKEN: 'synthetic' }
    });
    expect(child.status).toBe(1);
    const seen: string[] = JSON.parse(readFileSync(marker, 'utf8'));
    expect(seen).toContain(join(realpathSync(one), 'local.txt'));
    expect(seen).toContain(join(realpathSync(two), 'local.txt'));
    const result = JSON.parse(child.stdout);
    expect(result.errors).toBe(2);
    expect(result.items.every((item: any) => item.installedVersion.startsWith('sha256:'))).toBe(true);
    const failureMarker = join(home, 'unexpected-upstream.json');
    const failed = spawnSync(process.execPath, ['--import', preload, checkScript, '--home', home, '--json'], {
      encoding: 'utf8', env: { ...process.env, GH_TOKEN: 'synthetic', GITHUB_TOKEN: 'synthetic',
        TEST_FAIL_LOCAL: '1', TEST_ORDER_MARKER: failureMarker }
    });
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain('Synthetic local read denied');
    expect(existsSync(failureMarker)).toBe(false);
  });
});
