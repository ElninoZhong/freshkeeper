import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import { safeExec } from '../util/exec.js';
import type { Adapter } from './types.js';
import type { LockedSkillEntry } from '../lockfile.js';
import { tmpdir } from 'node:os';

const SKILLS_TIMEOUT_MS = 8_000;
const PINNED_SKILLS_VERSION = '1.5.16';
const PINNED_SKILLS_NPX_PACKAGE = `skills@${PINNED_SKILLS_VERSION}`;

interface SkillsCommand {
  cmd: string;
  argsPrefix: string[];
  label: string;
}

interface ProjectSkill {
  name: string;
  source: string;
}

interface SkillsSourceLockEntry {
  source?: string;
  sourceType?: string;
  ref?: string;
  skillPath?: string;
  computedHash?: string;
}

interface SkillsSourceLock {
  version: number;
  skills: Record<string, SkillsSourceLockEntry>;
}

type SkillsUpdatePlan =
  | { kind: 'project'; cwd: string; skills: ProjectSkill[] }
  | { kind: 'global' }
  | { kind: 'skip'; reason: string }
  | { kind: 'error'; error: string };

function isSafeSkillName(name: string): boolean {
  return Boolean(name) && name !== '.' && name !== '..' && !name.includes('/') && !name.includes('\\');
}

function readSkillsSourceLock(projectDir: string, allowMissing = false): SkillsSourceLock {
  const lockPath = join(projectDir, 'skills-lock.json');
  if (!existsSync(lockPath)) {
    if (allowMissing) return { version: 1, skills: {} };
    throw new Error(`No skills-lock.json found in ${projectDir}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(lockPath, 'utf-8'));
  } catch (error) {
    throw new Error(`Unable to parse ${lockPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    typeof (parsed as { version?: unknown }).version !== 'number' ||
    typeof (parsed as { skills?: unknown }).skills !== 'object' ||
    (parsed as { skills?: unknown }).skills === null ||
    Array.isArray((parsed as { skills?: unknown }).skills)
  ) {
    throw new Error(`${lockPath} does not contain a valid skills object`);
  }
  return parsed as SkillsSourceLock;
}

export function computeSkillFolderHash(skillDir: string): string {
  const files: Array<{ relativePath: string; content: Buffer }> = [];
  const collect = (currentDir: string): void => {
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) collect(fullPath);
      else if (entry.isFile()) {
        files.push({
          relativePath: relative(skillDir, fullPath).split('\\').join('/'),
          content: readFileSync(fullPath)
        });
      }
    }
  };
  collect(skillDir);
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file.relativePath);
    hash.update(file.content);
  }
  return hash.digest('hex');
}

function gitSourceUrl(source: string): string {
  if (/^[^/\s]+\/[^/\s]+$/.test(source)) return `https://github.com/${source}.git`;
  if (/^github:[^/\s]+\/[^/\s]+$/.test(source)) return `https://github.com/${source.slice('github:'.length)}.git`;
  return source;
}

async function resolveExactGitRef(source: string, requestedRef?: string): Promise<string> {
  if (requestedRef && /^[0-9a-f]{40}$/i.test(requestedRef)) return requestedRef.toLowerCase();
  const patterns = requestedRef
    ? [`refs/heads/${requestedRef}`, `refs/tags/${requestedRef}`, `refs/tags/${requestedRef}^{}`]
    : ['HEAD'];
  const result = await safeExec('git', ['ls-remote', gitSourceUrl(source), ...patterns], {
    timeoutMs: 30_000
  });
  if (!result.ok) throw new Error(`Unable to resolve ${source}: ${result.stderr || result.error || 'git ls-remote failed'}`);
  const refs = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sha, name] = line.split(/\s+/, 2);
      return { sha, name };
    })
    .filter((entry): entry is { sha: string; name: string } => Boolean(entry.sha && entry.name && /^[0-9a-f]{40}$/i.test(entry.sha)));
  const selected = refs.find((entry) => entry.name.endsWith('^{}')) ?? refs[0];
  if (!selected) throw new Error(`Unable to resolve an exact commit for ${source}${requestedRef ? `#${requestedRef}` : ''}`);
  return selected.sha.toLowerCase();
}

interface StagedSkills {
  stageDir: string;
  sourceLock: SkillsSourceLock;
}

function lockedSource(skill: LockedSkillEntry): string {
  return `${skill.source.split('#', 1)[0]}#${skill.ref}`;
}

async function stageLockedSkills(version: string, skills: Record<string, LockedSkillEntry>): Promise<StagedSkills> {
  const stageDir = mkdtempSync(join(tmpdir(), 'freshkeeper-skills-stage-'));
  try {
    for (const name of Object.keys(skills).sort()) {
      const skill = skills[name]!;
      const result = await safeExec(
        'npx',
        [
          '--yes',
          `skills@${version}`,
          'add',
          lockedSource(skill),
          '--skill',
          name,
          '--agent',
          'universal',
          '--copy',
          '-y'
        ],
        { cwd: stageDir, timeoutMs: 120_000 }
      );
      if (!result.ok) throw new Error(`${name}: ${result.stderr || result.error || 'staging failed'}`);
    }

    const sourceLock = readSkillsSourceLock(stageDir, Object.keys(skills).length === 0);
    for (const [name, target] of Object.entries(skills)) {
      const staged = sourceLock.skills[name];
      if (!staged || staged.computedHash !== target.computedHash) {
        throw new Error(`${name}: staged lock hash mismatch (expected ${target.computedHash}, got ${staged?.computedHash ?? 'missing'})`);
      }
      const stagedDir = join(stageDir, '.agents', 'skills', name);
      if (!existsSync(stagedDir)) throw new Error(`${name}: staged skill directory is missing`);
      const actualHash = computeSkillFolderHash(stagedDir);
      if (actualHash !== target.computedHash) {
        throw new Error(`${name}: staged content hash mismatch (expected ${target.computedHash}, got ${actualHash})`);
      }
    }
    return { stageDir, sourceLock };
  } catch (error) {
    rmSync(stageDir, { recursive: true, force: true });
    throw error;
  }
}

function rollbackSkills(
  projectDir: string,
  names: string[],
  backupDir: string,
  originalSourceLock: string | undefined
): void {
  const targetRoot = join(projectDir, '.agents', 'skills');
  for (const name of names) {
    const target = join(targetRoot, name);
    rmSync(target, { recursive: true, force: true });
    const backup = join(backupDir, name);
    if (existsSync(backup)) cpSync(backup, target, { recursive: true, dereference: false });
  }
  const sourceLockPath = join(projectDir, 'skills-lock.json');
  if (originalSourceLock === undefined) rmSync(sourceLockPath, { force: true });
  else writeFileSync(sourceLockPath, originalSourceLock, 'utf-8');
}

function applyStagedSkills(projectDir: string, staged: StagedSkills, skills: Record<string, LockedSkillEntry>): void {
  const names = Object.keys(skills).sort();
  if (names.length === 0) return;
  const targetRoot = join(projectDir, '.agents', 'skills');
  mkdirSync(targetRoot, { recursive: true });
  const backupDir = mkdtempSync(join(tmpdir(), 'freshkeeper-skills-backup-'));
  const sourceLockPath = join(projectDir, 'skills-lock.json');
  const originalSourceLock = existsSync(sourceLockPath) ? readFileSync(sourceLockPath, 'utf-8') : undefined;
  const tempLockPath = `${sourceLockPath}.freshkeeper-${process.pid}.tmp`;
  let mutationStarted = false;

  try {
    const currentSourceLock = readSkillsSourceLock(projectDir, true);
    for (const name of names) {
      const target = join(targetRoot, name);
      if (existsSync(target)) cpSync(target, join(backupDir, name), { recursive: true, dereference: false });
    }
    mutationStarted = true;
    for (const name of names) {
      const target = join(targetRoot, name);
      rmSync(target, { recursive: true, force: true });
      cpSync(join(staged.stageDir, '.agents', 'skills', name), target, {
        recursive: true,
        dereference: false
      });
      currentSourceLock.skills[name] = staged.sourceLock.skills[name]!;
    }

    const sortedSkills = Object.fromEntries(
      Object.entries(currentSourceLock.skills).sort(([left], [right]) => left.localeCompare(right))
    );
    writeFileSync(
      tempLockPath,
      `${JSON.stringify({ ...currentSourceLock, skills: sortedSkills }, null, 2)}\n`,
      'utf-8'
    );
    renameSync(tempLockPath, sourceLockPath);

    for (const [name, expected] of Object.entries(skills)) {
      const actual = computeSkillFolderHash(join(targetRoot, name));
      if (actual !== expected.computedHash) throw new Error(`${name}: applied content hash mismatch`);
    }
  } catch (error) {
    if (mutationStarted) rollbackSkills(projectDir, names, backupDir, originalSourceLock);
    throw error;
  } finally {
    rmSync(tempLockPath, { force: true });
    rmSync(backupDir, { recursive: true, force: true });
  }
}

function findLockDirectory(start: string): string | undefined {
  let current = resolve(start);
  while (true) {
    if (existsSync(join(current, 'skills-lock.json'))) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function buildProjectSkillsUpdatePlan(cwd: string): SkillsUpdatePlan {
  const lockPath = join(cwd, 'skills-lock.json');
  try {
    const parsed = JSON.parse(readFileSync(lockPath, 'utf-8')) as {
      skills?: Record<string, { source?: string; sourceType?: string; skillPath?: string }>;
    };
    if (!parsed.skills || typeof parsed.skills !== 'object' || Array.isArray(parsed.skills)) {
      return { kind: 'error', error: `${lockPath} does not contain a valid skills object` };
    }

    const skills: ProjectSkill[] = [];
    for (const [name, entry] of Object.entries(parsed.skills)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return { kind: 'error', error: `${lockPath} contains an invalid entry for ${name}` };
      }
      if (typeof entry.sourceType !== 'string' || entry.sourceType.length === 0) {
        return { kind: 'error', error: `${lockPath} entry ${name} has no valid sourceType` };
      }
      if (entry.sourceType !== 'github') continue;
      if (typeof entry.source !== 'string' || entry.source.length === 0) {
        return { kind: 'error', error: `${lockPath} GitHub entry ${name} has no valid source` };
      }
      skills.push({ name, source: entry.source });
    }

    if (skills.length === 0) {
      return { kind: 'skip', reason: `Skipped skills update: ${lockPath} has no GitHub-backed skills.` };
    }
    return { kind: 'project', cwd, skills };
  } catch (error) {
    return {
      kind: 'error',
      error: `Unable to parse ${lockPath}: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

function resolveSkillsUpdatePlan(): SkillsUpdatePlan {
  const explicitCwd = process.env.FRESHKEEPER_SKILLS_CWD;
  if (explicitCwd) {
    const cwd = resolve(explicitCwd);
    if (!existsSync(join(cwd, 'skills-lock.json'))) {
      return { kind: 'skip', reason: `Skipped skills update: no skills-lock.json in ${cwd}.` };
    }
    return buildProjectSkillsUpdatePlan(cwd);
  }

  const discovered = findLockDirectory(process.cwd());
  if (discovered) return buildProjectSkillsUpdatePlan(discovered);
  if (process.env.FRESHKEEPER_ALLOW_GLOBAL_SKILLS_UPDATE === '1') return { kind: 'global' };
  return {
    kind: 'skip',
    reason: 'Skipped global skills update. Set FRESHKEEPER_ALLOW_GLOBAL_SKILLS_UPDATE=1 to opt in explicitly.'
  };
}

function skillsCommands(includeNpx = true): SkillsCommand[] {
  const commands: SkillsCommand[] = [];

  if (process.env.FRESHKEEPER_SKILLS_BIN) {
    commands.push({
      cmd: process.env.FRESHKEEPER_SKILLS_BIN,
      argsPrefix: [],
      label: 'FRESHKEEPER_SKILLS_BIN'
    });
  }

  commands.push({ cmd: 'skills', argsPrefix: [], label: 'skills' });
  if (includeNpx) {
    commands.push({
      cmd: 'npx',
      argsPrefix: ['--yes', PINNED_SKILLS_NPX_PACKAGE],
      label: `npx ${PINNED_SKILLS_NPX_PACKAGE}`
    });
  }
  return commands;
}

async function resolveSkillsCommand(includeNpx = true): Promise<{ command?: SkillsCommand; version?: string; errors: string[] }> {
  const errors: string[] = [];

  for (const command of skillsCommands(includeNpx)) {
    const result = await safeExec(command.cmd, [...command.argsPrefix, '--version'], { timeoutMs: SKILLS_TIMEOUT_MS });
    if (result.ok) {
      return {
        command,
        version: result.stdout.trim().split('\n').pop(),
        errors
      };
    }

    const message = result.error || result.stderr || `exit ${result.exitCode ?? 'unknown'}`;
    errors.push(`${command.label}: ${message}`);
  }

  return { errors };
}

export const skillsCliAdapter: Adapter = {
  id: 'skills-cli',
  displayName: 'Skills CLI (skills.sh)',

  async detect() {
    const localCommand = await resolveSkillsCommand(false);
    if (localCommand.command) return { installed: true, version: localCommand.version };

    const npx = await safeExec('npx', ['--version'], { timeoutMs: SKILLS_TIMEOUT_MS });
    if (!npx.ok) return { installed: false };
    return {
      installed: true,
      version: PINNED_SKILLS_VERSION,
      installMethod: 'pinned-npx'
    };
  },

  async check() {
    return {
      updates: [],
      coverage: 'unavailable' as const,
      note: 'the Skills CLI refresh path is mutating; use the freshkeeper-check Skill for source-aware library preflight'
    };
  },

  async update() {
    const plan = resolveSkillsUpdatePlan();
    if (plan.kind === 'skip') return { updated: [], failed: [], logs: plan.reason };
    if (plan.kind === 'error') {
      return {
        updated: [],
        failed: [{ item: 'skills-lock.json', error: plan.error }],
        logs: ''
      };
    }

    const resolvedCommand = await resolveSkillsCommand();
    if (!resolvedCommand.command) {
      return {
        updated: [],
        failed: [{
          item: 'skills',
          error: `skills CLI unavailable. Tried: ${resolvedCommand.errors.join('; ')}`
        }],
        logs: ''
      };
    }

    if (plan.kind === 'project') {
      const failed: { item: string; error: string }[] = [];
      const updated: string[] = [];
      const unchanged: string[] = [];
      const beforeHashes = new Map<string, string | undefined>();
      for (const skill of plan.skills) {
        const skillDir = join(plan.cwd, '.agents', 'skills', skill.name);
        beforeHashes.set(skill.name, existsSync(skillDir) ? computeSkillFolderHash(skillDir) : undefined);
      }
      let logs = `Refreshing ${plan.skills.length} project skill(s) from skills-lock.json...\n`;

      for (const skill of plan.skills) {
        const refresh = await safeExec(
          resolvedCommand.command.cmd,
          [...resolvedCommand.command.argsPrefix, 'add', skill.source, '--skill', skill.name, '--agent', 'universal', '-y'],
          { cwd: plan.cwd, timeoutMs: 120_000 }
        );

        logs += `\n[skill:${skill.name}]\n${refresh.stdout}${refresh.stderr ? `\n${refresh.stderr}` : ''}\n`;
        if (refresh.ok) {
          const skillDir = join(plan.cwd, '.agents', 'skills', skill.name);
          if (!existsSync(skillDir)) {
            failed.push({ item: skill.name, error: 'skill missing after refresh' });
            continue;
          }
          const afterHash = computeSkillFolderHash(skillDir);
          if (beforeHashes.get(skill.name) !== afterHash) updated.push(skill.name);
          else unchanged.push(skill.name);
        } else {
          failed.push({
            item: skill.name,
            error: refresh.stderr || refresh.error || 'skill refresh failed'
          });
        }
      }

      return {
        updated,
        unchanged,
        failed,
        logs
      };
    }

    const result = await safeExec(
      resolvedCommand.command.cmd,
      [...resolvedCommand.command.argsPrefix, 'update', '-y'],
      { timeoutMs: 300_000 }
    );
    const count = result.stdout.match(/Updated\s+(\d+)\s+skill/)?.[1];
    const updated = count ? [`${count} skills`] : [];
    const failed = result.ok ? [] : [{ item: 'skills', error: result.stderr || result.error || 'update failed' }];

    return {
      updated,
      failed,
      logs: result.stdout
    };
  },

  async captureLock(context) {
    const localCommand = await resolveSkillsCommand(false);
    let version = localCommand.version;
    if (!localCommand.command) {
      const npx = await safeExec('npx', ['--version'], { timeoutMs: SKILLS_TIMEOUT_MS });
      if (!npx.ok) throw new Error('Cannot lock Skills CLI because neither skills nor npx is available');
      version = PINNED_SKILLS_VERSION;
    }
    if (!version || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
      throw new Error(`Cannot lock Skills CLI because its exact version is unknown: ${version ?? 'missing'}`);
    }

    const sourceLockPath = join(context.projectDir, 'skills-lock.json');
    if (!existsSync(sourceLockPath)) {
      return { adapter: 'skills-cli', version, skills: {} };
    }
    const sourceLock = readSkillsSourceLock(context.projectDir);
    const skills: Record<string, LockedSkillEntry> = {};

    for (const name of Object.keys(sourceLock.skills).sort()) {
      const entry = sourceLock.skills[name]!;
      if (entry.sourceType !== 'github') continue;
      if (!isSafeSkillName(name)) throw new Error(`Unsafe skill name in skills-lock.json: ${name}`);
      if (!entry.source || !entry.computedHash || !/^[0-9a-f]{64}$/i.test(entry.computedHash)) {
        throw new Error(`GitHub skill ${name} has an incomplete source or computedHash`);
      }

      const installedDir = join(context.projectDir, '.agents', 'skills', name);
      if (!existsSync(installedDir)) throw new Error(`Installed project skill is missing: ${name}`);
      const installedHash = computeSkillFolderHash(installedDir);
      if (installedHash !== entry.computedHash.toLowerCase()) {
        throw new Error(`${name}: installed content differs from skills-lock.json; refresh or reconcile it before locking`);
      }

      skills[name] = {
        source: entry.source,
        ref: await resolveExactGitRef(entry.source, entry.ref),
        computedHash: entry.computedHash.toLowerCase(),
        ...(entry.skillPath ? { skillPath: entry.skillPath } : {})
      };
    }

    let staged: StagedSkills | undefined;
    try {
      staged = await stageLockedSkills(version, skills);
    } finally {
      if (staged) rmSync(staged.stageDir, { recursive: true, force: true });
    }
    return { adapter: 'skills-cli', version, skills };
  },

  async restoreLock(lock, context) {
    if (lock.adapter !== 'skills-cli') {
      return { updated: [], failed: [{ item: 'skills-cli', error: 'invalid lock entry' }], logs: '' };
    }

    let staged: StagedSkills | undefined;
    try {
      staged = await stageLockedSkills(lock.version, lock.skills);
      applyStagedSkills(context.projectDir, staged, lock.skills);
      const count = Object.keys(lock.skills).length;
      return {
        updated: count > 0 ? [`${count} skills@lock`] : [],
        failed: [],
        logs: count > 0 ? `Restored ${count} project skill(s) from exact commits.` : 'No project skills were locked.'
      };
    } catch (error) {
      return {
        updated: [],
        failed: [{ item: 'skills-lock.json', error: error instanceof Error ? error.message : String(error) }],
        logs: ''
      };
    } finally {
      if (staged) rmSync(staged.stageDir, { recursive: true, force: true });
    }
  }
};
