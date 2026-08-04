#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { access, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, posix, resolve } from 'node:path';
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

const details = argv.includes('--details');
const json = argv.includes('--json');
const requestedRoots = options('--root');
const homeOverride = option('--home');
const userHome = homeOverride ?? homedir();
const fixturePath = option('--fixture');
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
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const folder = join(root, entry.name);
    let directory = entry.isDirectory();
    if (entry.isSymbolicLink()) {
      try {
        directory = (await stat(folder)).isDirectory();
      } catch {
        directory = false;
      }
    }
    if (!directory) continue;
    const skillFile = join(folder, 'SKILL.md');
    if (!(await exists(skillFile))) continue;
    const markdown = await readFile(skillFile, 'utf8');
    skills.push({
      folder: entry.name,
      name: parseName(markdown, entry.name),
      path: folder,
      realPath: await canonicalPath(folder),
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
        for (const installation of installations) {
          if (!existing.installations.some((item) => item.agent === installation.agent && item.path === installation.path)) {
            existing.installations.push(installation);
          }
        }
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

function defaultLockPath() {
  if (!homeOverride && process.env.XDG_STATE_HOME?.trim()) {
    return join(process.env.XDG_STATE_HOME.trim(), 'skills', '.skill-lock.json');
  }
  return join(userHome, '.agents', '.skill-lock.json');
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

async function requestTree(source, ref, token) {
  const url = `https://api.github.com/repos/${source}/git/trees/${encodeURIComponent(ref)}?recursive=1`;
  const headers = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'freshkeeper-check'
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status} for ${source}@${ref}`);
  const data = await response.json();
  if (!data?.sha || !Array.isArray(data.tree)) throw new Error(`GitHub returned an invalid tree for ${source}@${ref}`);
  return { sha: data.sha, tree: data.tree, ref };
}

async function fetchTree(source, ref, token) {
  const refs = ref ? [ref] : ['HEAD', 'main', 'master'];
  let lastError;
  for (const candidate of refs) {
    try {
      return await requestTree(source, candidate, token);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error(`Unable to fetch ${source}`);
}

function folderTreeHash(tree, skillPath) {
  let folder = skillPath.replaceAll('\\', '/');
  if (folder.toLowerCase().endsWith('/skill.md')) folder = folder.slice(0, -9);
  else if (folder.toLowerCase().endsWith('skill.md')) folder = folder.slice(0, -8);
  folder = folder.replace(/\/$/, '');
  if (!folder) return tree.sha;
  return tree.tree.find((entry) => entry.type === 'tree' && entry.path === posix.normalize(folder))?.sha;
}

function baseItem(skill, entry) {
  return {
    name: skill.name,
    folder: skill.folder,
    path: skill.path,
    realPath: skill.realPath,
    agents: skill.agents,
    installations: skill.installations,
    source: entry?.source ?? null,
    sourceType: entry?.sourceType ?? null,
    installedHash: entry?.skillFolderHash || null,
    remoteHash: null,
    status: 'untracked',
    reason: 'No source metadata in .skill-lock.json'
  };
}

const resolved = await resolveLibraries();
const inventory = await inventoryLibraries(resolved);
const lockPath = option('--lock') ?? defaultLockPath();
const lock = await readLock(lockPath);
const fixture = fixturePath ? JSON.parse(await readFile(fixturePath, 'utf8')) : null;
let token;
const githubToken = () => {
  if (fixture) return '';
  if (token === undefined) token = getGitHubToken();
  return token;
};
const treePromises = new Map();

for (const skill of inventory) {
  const entry = lock.skills[skill.name] ?? lock.skills[skill.folder];
  if (entry?.sourceType !== 'github' || !entry.source || !entry.skillFolderHash || !entry.skillPath) continue;
  if (!/^[^/\s]+\/[^/\s]+$/.test(entry.source)) continue;
  const key = `${entry.source}#${entry.ref ?? ''}`;
  if (!treePromises.has(key)) {
    treePromises.set(key, fixture
      ? Promise.resolve(fixture[entry.source] ?? fixture[key]).then((value) => {
          if (!value) throw new Error(`Fixture has no tree for ${entry.source}`);
          return value;
        })
      : fetchTree(entry.source, entry.ref, githubToken()));
  }
}

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
      token: githubToken(),
      historyLimit
    })
  : new Map();

const items = [];
for (const skill of inventory) {
  const entry = lock.skills[skill.name] ?? lock.skills[skill.folder];
  const item = baseItem(skill, entry);
  if (!entry) {
    const provenance = recovered.get(skill.realPath);
    if (provenance && provenance.status !== 'unresolved') {
      Object.assign(item, provenance, {
        source: provenance.source,
        sourceType: provenance.sourceType,
        provenance
      });
    }
    items.push(item);
    continue;
  }
  if (entry.sourceType === 'local') {
    item.status = 'local-only';
    item.reason = 'Local source has no remote version to compare';
    items.push(item);
    continue;
  }
  if (entry.sourceType !== 'github') {
    item.status = 'uncheckable';
    item.reason = entry.sourceType === 'well-known'
      ? 'Well-known source is installed but has no comparable folder hash'
      : `Unsupported source type: ${entry.sourceType ?? 'unknown'}`;
    items.push(item);
    continue;
  }
  if (!entry.source || !entry.skillFolderHash || !entry.skillPath) {
    const provenance = recovered.get(skill.realPath);
    if (provenance && !['unresolved', 'check-blocked'].includes(provenance.status)) {
      Object.assign(item, provenance, {
        source: provenance.source,
        sourceType: provenance.sourceType,
        provenance
      });
    } else {
      item.status = provenance?.status ?? 'uncheckable';
      item.reason = provenance?.reason ?? 'GitHub source metadata is incomplete';
    }
    items.push(item);
    continue;
  }
  if (!/^[^/\s]+\/[^/\s]+$/.test(entry.source)) {
    item.status = 'check-failed';
    item.reason = `Invalid GitHub source: ${entry.source}`;
    items.push(item);
    continue;
  }
  const key = `${entry.source}#${entry.ref ?? ''}`;
  try {
    const tree = await treePromises.get(key);
    const remoteHash = folderTreeHash(tree, entry.skillPath);
    if (!remoteHash) {
      item.status = 'missing-upstream';
      item.reason = `Upstream no longer contains ${entry.skillPath}`;
    } else {
      item.remoteHash = remoteHash;
      item.status = remoteHash === entry.skillFolderHash ? 'current' : 'update-available';
      item.reason = item.status === 'current' ? 'Recorded install matches upstream' : 'Upstream folder hash changed';
    }
  } catch (error) {
    item.status = 'check-failed';
    item.reason = error.message;
  }
  items.push(item);
}

const installedNames = new Set(inventory.flatMap((skill) => [skill.name, skill.folder]));
const staleLockEntries = Object.keys(lock.skills).filter((name) => !installedNames.has(name)).sort();
const count = (status) => items.filter((item) => item.status === status).length;
const currentStatuses = new Set(['current', 'exact-current', 'local-extension']);
const updateStatuses = new Set(['update-available', 'clean-old', 'current-subset']);
const checkableStatuses = new Set([
  ...currentStatuses,
  ...updateStatuses,
  'manual-merge',
  'local-ahead',
  'legacy-local',
  'missing-upstream',
  'check-failed',
  'check-blocked'
]);
const result = {
  generatedAt: new Date().toISOString(),
  libraryMode: resolved.mode,
  skillsRoot: resolved.libraries.length === 1 ? resolved.libraries[0].path : null,
  skillRoots: resolved.libraries.map((library) => library.path),
  libraries: resolved.libraries,
  lockPath,
  totalInstalled: items.length,
  uniqueSkillNames: new Set(items.map((item) => item.name)).size,
  tracked: items.filter((item) => item.sourceType).length,
  recoveredSources: items.filter((item) => item.sourceType === 'github-recovered').length,
  checkable: items.filter((item) => checkableStatuses.has(item.status)).length,
  current: items.filter((item) => currentStatuses.has(item.status)).length,
  updatesAvailable: items.filter((item) => updateStatuses.has(item.status)).length,
  manualMerge: count('manual-merge'),
  localAhead: count('local-ahead'),
  legacyLocal: count('legacy-local'),
  unresolved: items.filter((item) => ['untracked', 'unresolved', 'uncheckable', 'local-only'].includes(item.status)).length,
  uncheckable: items.filter((item) => ['untracked', 'unresolved', 'uncheckable', 'local-only'].includes(item.status)).length,
  errors: count('check-failed') + count('missing-upstream') + count('check-blocked'),
  staleLockEntries,
  items
};

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else if (resolved.mode === 'none') {
  console.log('Freshkeeper found no shared or supported agent-local Skill libraries.');
} else {
  const modeLabel = resolved.mode === 'shared' ? 'shared library' : resolved.mode === 'agent-local' ? 'agent-local fallback' : 'explicit roots';
  console.log(`Freshkeeper checked ${result.totalInstalled} installed skills across ${result.skillRoots.length} distinct Skill root(s) (${modeLabel})`);
  for (const library of resolved.libraries) {
    console.log(`- ${library.path} [${library.agents.join(', ')}]`);
  }
  console.log(`Checkable: ${result.checkable} | Recovered sources: ${result.recoveredSources} | Current: ${result.current} | Safe updates: ${result.updatesAvailable} | Manual merge: ${result.manualMerge} | Unresolved: ${result.unresolved} | Errors: ${result.errors}`);
  const updates = items.filter((item) => updateStatuses.has(item.status));
  if (updates.length) {
    console.log('Safe updates available:');
    for (const item of updates) console.log(`- ${item.name}: ${item.status} (${item.source}) [${item.agents.join(', ')}]`);
  } else {
    console.log('No updates were confirmed for the checkable skills.');
  }
  const manual = items.filter((item) => item.status === 'manual-merge');
  if (manual.length) {
    console.log('Manual merge required:');
    for (const item of manual) console.log(`- ${item.name} (${item.source})`);
  }
  if (staleLockEntries.length) console.log(`Stale lock entries: ${staleLockEntries.join(', ')}`);
  if (details) {
    console.log();
    console.log('Skill\tStatus\tAgents\tSource\tReason');
    for (const item of items) {
      console.log(`${item.name}\t${item.status}\t${item.agents.join(',')}\t${item.source ?? '-'}\t${item.reason}`);
    }
  } else {
    console.log('Use `with details` to show every installed skill and its check status.');
  }
}

if (result.errors > 0) process.exitCode = 1;
