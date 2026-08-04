#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { access, readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, posix } from 'node:path';

const argv = process.argv.slice(2);

function option(name) {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

const details = argv.includes('--details');
const json = argv.includes('--json');
const skillsRoot = option('--root') ?? join(homedir(), '.agents', 'skills');
const lockPath = option('--lock') ?? join(dirname(skillsRoot), '.skill-lock.json');
const fixturePath = option('--fixture');

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function parseName(markdown, fallback) {
  const frontmatter = markdown.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!frontmatter) return fallback;
  const name = frontmatter[1].match(/^name:\s*["']?([^\n"']+)["']?\s*$/m)?.[1]?.trim();
  return name || fallback;
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
    skills.push({ folder: entry.name, name: parseName(markdown, entry.name), path: folder });
  }
  return skills;
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
    source: entry?.source ?? null,
    sourceType: entry?.sourceType ?? null,
    installedHash: entry?.skillFolderHash || null,
    remoteHash: null,
    status: 'untracked',
    reason: 'No source metadata in .skill-lock.json'
  };
}

const inventory = await readInventory(skillsRoot);
const lock = await readLock(lockPath);
const fixture = fixturePath ? JSON.parse(await readFile(fixturePath, 'utf8')) : null;
const token = fixture ? '' : getGitHubToken();
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
      : fetchTree(entry.source, entry.ref, token));
  }
}

const items = [];
for (const skill of inventory) {
  const entry = lock.skills[skill.name] ?? lock.skills[skill.folder];
  const item = baseItem(skill, entry);
  if (!entry) {
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
    item.status = 'uncheckable';
    item.reason = 'GitHub source metadata is incomplete';
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
const checkableStatuses = new Set(['current', 'update-available', 'missing-upstream', 'check-failed']);
const result = {
  generatedAt: new Date().toISOString(),
  skillsRoot,
  lockPath,
  totalInstalled: items.length,
  tracked: items.filter((item) => item.sourceType).length,
  checkable: items.filter((item) => checkableStatuses.has(item.status)).length,
  current: count('current'),
  updatesAvailable: count('update-available'),
  uncheckable: items.filter((item) => ['untracked', 'uncheckable', 'local-only'].includes(item.status)).length,
  errors: count('check-failed') + count('missing-upstream'),
  staleLockEntries,
  items
};

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`Freshkeeper checked ${result.totalInstalled} installed skills in ${skillsRoot}`);
  console.log(`Checkable: ${result.checkable} | Current: ${result.current} | Updates: ${result.updatesAvailable} | Uncheckable: ${result.uncheckable} | Errors: ${result.errors}`);
  const updates = items.filter((item) => item.status === 'update-available');
  if (updates.length) {
    console.log('Updates available:');
    for (const item of updates) console.log(`- ${item.name} (${item.source})`);
  } else {
    console.log('No updates were confirmed for the checkable skills.');
  }
  if (staleLockEntries.length) console.log(`Stale lock entries: ${staleLockEntries.join(', ')}`);
  if (details) {
    console.log();
    console.log('Skill\tStatus\tSource\tReason');
    for (const item of items) {
      console.log(`${item.name}\t${item.status}\t${item.source ?? '-'}\t${item.reason}`);
    }
  } else {
    console.log('Use `with details` to show every installed skill and its check status.');
  }
}

if (result.errors > 0) process.exitCode = 1;
