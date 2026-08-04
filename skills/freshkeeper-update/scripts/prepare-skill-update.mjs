#!/usr/bin/env node

import { access, cp, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditProvenance } from './provenance.mjs';

const argv = process.argv.slice(2);

function options(name) {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== name) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
    values.push(value);
  }
  return values;
}

function option(name) {
  const values = options(name);
  if (values.length > 1) throw new Error(`${name} may only be provided once`);
  return values[0];
}

const json = argv.includes('--json');
const createBackup = argv.includes('--backup');
const requestedRoots = options('--root');
const homeOverride = option('--home');
const userHome = homeOverride ?? homedir();
const fixturePath = option('--fixture');
const writePlanPath = option('--write-plan');
const defaultCatalog = join(dirname(fileURLToPath(import.meta.url)), '..', 'references', 'provenance-catalog.json');
const catalogPath = option('--provenance-catalog') ?? defaultCatalog;
const historyLimitValue = option('--history-limit');
const historyLimit = argv.includes('--no-history')
  ? 0
  : historyLimitValue === undefined
    ? 200
    : Number.parseInt(historyLimitValue, 10);
if (!Number.isInteger(historyLimit) || historyLimit < 0 || historyLimit > 200) {
  throw new Error('--history-limit must be an integer from 0 to 200');
}

function configuredHome(envName, fallback) {
  if (homeOverride) return fallback;
  return process.env[envName]?.trim() || fallback;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function canonicalPath(path) {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

function parseName(markdown, fallback) {
  const frontmatter = markdown.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!frontmatter) return fallback;
  const name = frontmatter[1].match(/^name:\s*["']?([^\n"']+)["']?\s*$/m)?.[1]?.trim();
  return name || fallback;
}

async function candidateLibraries() {
  const claudeHome = configuredHome('CLAUDE_CONFIG_DIR', join(userHome, '.claude'));
  const codexHome = configuredHome('CODEX_HOME', join(userHome, '.codex'));
  const hermesHome = configuredHome('HERMES_HOME', join(userHome, '.hermes'));
  let openClawSkills = join(userHome, '.openclaw', 'skills');
  if (!homeOverride) {
    for (const folder of ['.openclaw', '.clawdbot', '.moltbot']) {
      const candidate = join(userHome, folder, 'skills');
      if (await isDirectory(candidate)) {
        openClawSkills = candidate;
        break;
      }
    }
  }
  return [
    { id: 'universal', displayName: 'Shared/Universal', path: join(userHome, '.agents', 'skills'), shared: true },
    { id: 'claude-code', displayName: 'Claude Code', path: join(claudeHome, 'skills') },
    { id: 'codex', displayName: 'Codex', path: join(codexHome, 'skills') },
    { id: 'openclaw', displayName: 'OpenClaw', path: openClawSkills },
    { id: 'hermes-agent', displayName: 'Hermes', path: join(hermesHome, 'skills') }
  ];
}

async function resolveLibraries() {
  const candidates = await candidateLibraries();
  const existingCandidates = [];
  for (const candidate of candidates) {
    if (await isDirectory(candidate.path)) {
      existingCandidates.push({ ...candidate, realPath: await canonicalPath(candidate.path) });
    }
  }

  let mode;
  let selected;
  if (requestedRoots.length > 0) {
    mode = 'explicit';
    selected = [];
    for (let index = 0; index < requestedRoots.length; index += 1) {
      const path = resolve(requestedRoots[index]);
      if (!(await isDirectory(path))) throw new Error(`Skill library does not exist: ${path}`);
      selected.push({
        id: `explicit-${index + 1}`,
        displayName: `Explicit root ${index + 1}`,
        path,
        realPath: await canonicalPath(path),
        shared: false
      });
    }
  } else {
    const shared = existingCandidates.find((candidate) => candidate.shared);
    if (shared) {
      mode = 'shared';
      selected = [shared];
    } else {
      mode = existingCandidates.length > 0 ? 'agent-local' : 'none';
      selected = existingCandidates.filter((candidate) => !candidate.shared);
    }
  }

  const grouped = new Map();
  for (const library of selected) {
    const existing = grouped.get(library.realPath);
    if (existing) {
      existing.agents.push(library.id);
      existing.aliases.push(library.path);
      continue;
    }
    grouped.set(library.realPath, {
      path: library.path,
      realPath: library.realPath,
      agents: [library.id],
      aliases: [library.path]
    });
  }
  for (const candidate of existingCandidates) {
    const library = grouped.get(candidate.realPath);
    if (!library) continue;
    if (!library.agents.includes(candidate.id)) library.agents.push(candidate.id);
    if (!library.aliases.includes(candidate.path)) library.aliases.push(candidate.path);
  }

  return { mode, libraries: [...grouped.values()], candidates: existingCandidates };
}

async function readInventory(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const skills = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const folderPath = join(root, entry.name);
    let directory = entry.isDirectory();
    if (entry.isSymbolicLink()) {
      try {
        directory = (await stat(folderPath)).isDirectory();
      } catch {
        directory = false;
      }
    }
    if (!directory) continue;
    const skillFile = join(folderPath, 'SKILL.md');
    if (!(await exists(skillFile))) continue;
    const markdown = await readFile(skillFile, 'utf8');
    skills.push({
      folder: entry.name,
      name: parseName(markdown, entry.name),
      path: folderPath,
      realPath: await canonicalPath(folderPath),
      isSymlink: entry.isSymbolicLink()
    });
  }
  return skills;
}

async function inventoryLibraries(resolved) {
  const ownership = new Map();
  for (const library of resolved.candidates) {
    for (const skill of await readInventory(library.path)) {
      const owners = ownership.get(skill.realPath) ?? [];
      if (!owners.some((owner) => owner.agent === library.id && owner.path === skill.path)) {
        owners.push({ agent: library.id, path: skill.path, rootRealPath: library.realPath, isSymlink: skill.isSymlink });
      }
      ownership.set(skill.realPath, owners);
    }
  }

  const inventory = new Map();
  for (const library of resolved.libraries) {
    for (const skill of await readInventory(library.path)) {
      const existing = inventory.get(skill.realPath);
      const installations = ownership.get(skill.realPath) ?? library.agents.map((agent) => ({ agent, path: skill.path }));
      if (existing) {
        existing.installations.push(...installations.filter((installation) =>
          !existing.installations.some((item) => item.agent === installation.agent && item.path === installation.path)));
        existing.agents = [...new Set(existing.installations.map((item) => item.agent))].sort();
        continue;
      }
      inventory.set(skill.realPath, {
        ...skill,
        root: library.path,
        agents: [...new Set(installations.map((item) => item.agent))].sort(),
        installations
      });
    }
  }
  return [...inventory.values()].sort((left, right) => left.name.localeCompare(right.name) || left.path.localeCompare(right.path));
}

function defaultLockPath() {
  if (!homeOverride && process.env.XDG_STATE_HOME?.trim()) {
    return join(process.env.XDG_STATE_HOME.trim(), 'skills', '.skill-lock.json');
  }
  return join(userHome, '.agents', '.skill-lock.json');
}

async function readLock(path) {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || !parsed.skills || typeof parsed.skills !== 'object') {
      throw new Error('lock file does not contain a skills object');
    }
    return parsed;
  } catch (error) {
    if (error?.code === 'ENOENT') return { version: 0, skills: {} };
    throw new Error(`Cannot read ${path}: ${error.message}`);
  }
}

function deriveSkillFolder(skillPath) {
  if (!skillPath) return '';
  return dirname(skillPath.replaceAll('\\', '/')).replace(/^\.\/?$/, '');
}

function appendRef(source, ref) {
  return ref ? `${source}#${ref}` : source;
}

function updateSource(entry) {
  if (entry.sourceType === 'well-known') {
    if (!entry.sourceUrl) return null;
    const marker = entry.sourceUrl.indexOf('/.well-known/');
    return marker === -1 ? entry.sourceUrl : entry.sourceUrl.slice(0, marker);
  }
  if (entry.sourceType === 'github') {
    if (!entry.source) return null;
    const folder = deriveSkillFolder(entry.skillPath);
    return appendRef(folder ? `${entry.source}/${folder}` : entry.source, entry.ref);
  }
  if (entry.sourceType === 'git' || entry.sourceType === 'gitlab') {
    const source = entry.sourceUrl || entry.source;
    return source ? appendRef(source, entry.ref) : null;
  }
  return null;
}

function recoveredInstallSource(provenance) {
  const folder = provenance.skillPath ? `/${provenance.skillPath}` : '';
  return `${provenance.source}${folder}`;
}

function classify(skill, entry, mode, provenance = null) {
  const writableInstallations = [];
  const seenRoots = new Set();
  for (const installation of skill.installations) {
    if (installation.isSymlink || seenRoots.has(installation.rootRealPath)) continue;
    seenRoots.add(installation.rootRealPath);
    writableInstallations.push(installation);
  }
  const writeAgents = writableInstallations
    .map((installation) => installation.agent)
    .filter((agent) => agent !== 'universal' && !agent.startsWith('explicit-'));
  const base = {
    name: skill.name,
    folder: skill.folder,
    path: skill.path,
    realPath: skill.realPath,
    agents: skill.agents,
    writeAgents,
    installations: skill.installations,
    source: entry?.source ?? null,
    sourceType: entry?.sourceType ?? null,
    installSource: null,
    fullDepth: false,
    status: 'untracked',
    reason: 'No source metadata in .skill-lock.json'
  };
  const incompleteGitHub = entry?.sourceType === 'github'
    && (!entry.source || !entry.skillFolderHash || !entry.skillPath);
  if ((!entry || incompleteGitHub) && provenance && provenance.status !== 'unresolved') {
    const recovered = {
      ...base,
      source: provenance.source,
      sourceType: provenance.sourceType,
      installSource: provenance.source ? recoveredInstallSource(provenance) : null,
      provenance,
      reason: provenance.reason
    };
    if (['clean-old', 'current-subset'].includes(provenance.status)) {
      return { ...recovered, status: 'recoverable-update' };
    }
    return { ...recovered, status: provenance.status };
  }
  if (!entry) return base;
  if (entry.sourceType === 'local') {
    return { ...base, status: 'local-only', reason: 'Local source is preserved and skipped' };
  }
  const source = updateSource(entry);
  if (!source) {
    return { ...base, status: 'uncheckable', reason: 'Source metadata is incomplete or unsupported' };
  }
  if (mode === 'agent-local' && writeAgents.length === 0) {
    return { ...base, installSource: source, status: 'uncheckable', reason: 'Only symlink aliases were found; no owned agent-local directory is safe to replace' };
  }
  return {
    ...base,
    installSource: source,
    fullDepth: entry.sourceType === 'git' || entry.sourceType === 'gitlab',
    status: entry.sourceType === 'well-known' ? 'refreshable' : 'updateable',
    reason: entry.sourceType === 'well-known' ? 'Refresh exact installed name without version proof' : 'Source metadata is sufficient'
  };
}

function getGitHubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  try {
    return execFileSync('gh', ['auth', 'token'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return '';
  }
}

function backupStamp() {
  return new Date().toISOString().replace(/[-:.]/g, '');
}

async function backUp(resolved, inventory, lockPath) {
  const backupRoot = join(userHome, '.agents', 'skill-backups', `${backupStamp()}-freshkeeper-update`);
  if (await exists(backupRoot)) throw new Error(`Backup already exists: ${backupRoot}`);
  await mkdir(join(backupRoot, 'libraries'), { recursive: true });
  const backedUpLibraries = [];
  for (let index = 0; index < resolved.libraries.length; index += 1) {
    const library = resolved.libraries[index];
    const destination = join(backupRoot, 'libraries', `root-${index + 1}`);
    await cp(library.realPath, destination, { recursive: true, dereference: false, preserveTimestamps: true });
    if (!(await isDirectory(destination))) throw new Error(`Backup verification failed for ${library.path}`);
    backedUpLibraries.push({ ...library, backupPath: destination });
  }
  let backedUpLock = null;
  if (await exists(lockPath)) {
    backedUpLock = join(backupRoot, basename(lockPath));
    await cp(lockPath, backedUpLock, { preserveTimestamps: true });
    if (!(await exists(backedUpLock))) throw new Error(`Backup verification failed for ${lockPath}`);
  }
  const manifestPath = join(backupRoot, 'manifest.json');
  await writeFile(manifestPath, `${JSON.stringify({
    createdAt: new Date().toISOString(),
    libraryMode: resolved.mode,
    libraries: backedUpLibraries,
    lockPath,
    backedUpLock,
    inventory: inventory.map((skill) => ({
      name: skill.name,
      folder: skill.folder,
      path: skill.path,
      realPath: skill.realPath,
      agents: skill.agents
    }))
  }, null, 2)}\n`, 'utf8');
  return { backupRoot, manifestPath, backedUpLock, libraries: backedUpLibraries };
}

const resolved = await resolveLibraries();
const inventory = await inventoryLibraries(resolved);
const lockPath = option('--lock') ?? defaultLockPath();
const lock = await readLock(lockPath);
const fixture = fixturePath ? JSON.parse(await readFile(fixturePath, 'utf8')) : null;
const provenanceTargets = inventory.filter((skill) => {
  const entry = lock.skills[skill.name] ?? lock.skills[skill.folder];
  return !entry || (entry.sourceType === 'github'
    && (!entry.source || !entry.skillFolderHash || !entry.skillPath));
});
const recovered = provenanceTargets.length > 0
  ? await auditProvenance({
      skills: provenanceTargets,
      catalogPath,
      fixture,
      token: fixture ? '' : getGitHubToken(),
      historyLimit
    })
  : new Map();
const items = inventory.map((skill) => classify(
  skill,
  lock.skills[skill.name] ?? lock.skills[skill.folder],
  resolved.mode,
  recovered.get(skill.realPath)
));
const backup = createBackup ? await backUp(resolved, inventory, lockPath) : null;
const result = {
  generatedAt: new Date().toISOString(),
  libraryMode: resolved.mode,
  skillsRoot: resolved.libraries.length === 1 ? resolved.libraries[0].path : null,
  skillRoots: resolved.libraries.map((library) => library.path),
  libraries: resolved.libraries,
  lockPath,
  backup,
  totalInstalled: items.length,
  updateable: items.filter((item) => item.status === 'updateable').length,
  refreshable: items.filter((item) => item.status === 'refreshable').length,
  recoverable: items.filter((item) => item.status === 'recoverable-update').length,
  current: items.filter((item) => ['exact-current', 'local-extension'].includes(item.status)).length,
  manualMerge: items.filter((item) => item.status === 'manual-merge').length,
  localAhead: items.filter((item) => item.status === 'local-ahead').length,
  legacyLocal: items.filter((item) => item.status === 'legacy-local').length,
  unresolved: items.filter((item) => ['untracked', 'unresolved', 'check-blocked'].includes(item.status)).length,
  skipped: items.filter((item) => !['updateable', 'refreshable', 'recoverable-update'].includes(item.status)).length,
  items
};

if (writePlanPath) {
  await mkdir(dirname(resolve(writePlanPath)), { recursive: true });
  await writeFile(resolve(writePlanPath), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  result.planPath = resolve(writePlanPath);
}

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else if (resolved.mode === 'none') {
  console.log('Freshkeeper found no shared or supported agent-local Skill libraries.');
} else {
  const modeLabel = resolved.mode === 'shared' ? 'shared library' : resolved.mode === 'agent-local' ? 'agent-local fallback' : 'explicit roots';
  console.log(`Freshkeeper prepared ${result.totalInstalled} installed skills across ${result.skillRoots.length} distinct Skill root(s) (${modeLabel})`);
  console.log(`Tracked: ${result.updateable} | Refreshable: ${result.refreshable} | Recovered safe updates: ${result.recoverable} | Manual merge: ${result.manualMerge} | Unresolved: ${result.unresolved} | Skipped: ${result.skipped}`);
  if (backup) console.log(`Verified backup: ${backup.backupRoot}`);
  if (result.planPath) console.log(`Saved plan: ${result.planPath}`);
}
