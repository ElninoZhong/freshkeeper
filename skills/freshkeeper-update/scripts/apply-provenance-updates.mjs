#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import {
  access,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  symlink
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import {
  compareSnapshots,
  gitTreeSnapshot,
  localSnapshot,
  normalizeSkillPath,
  snapshotDigest
} from './provenance.mjs';

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

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function fileIndex(root) {
  const files = new Map();
  async function visit(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (['.git', 'node_modules', '__pycache__'].includes(entry.name) || entry.name === '.DS_Store') continue;
      const actualRelative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const canonical = actualRelative.split('/').map((part, index, parts) =>
        index === parts.length - 1 && part.toLowerCase() === 'skill.md' ? 'SKILL.md' : part).join('/');
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute, actualRelative);
      else if (!canonical.endsWith('.pyc')) files.set(canonical, absolute);
    }
  }
  await visit(root);
  return files;
}

function parseUpstreamRoots() {
  const roots = new Map();
  for (const value of options('--upstream-root')) {
    const separator = value.indexOf('=');
    if (separator <= 0) throw new Error('--upstream-root must use owner/repo=/absolute/path');
    roots.set(value.slice(0, separator), resolve(value.slice(separator + 1)));
  }
  return roots;
}

function backupPathFor(item, manifest) {
  const library = manifest.libraries.find((candidate) =>
    item.realPath === candidate.realPath || item.realPath.startsWith(`${candidate.realPath}/`));
  if (!library) throw new Error(`Backup manifest has no library for ${item.realPath}`);
  return join(library.backupPath, relative(library.realPath, item.realPath));
}

async function copyEntry(source, destination) {
  await mkdir(dirname(destination), { recursive: true });
  const info = await lstat(source);
  if (info.isSymbolicLink()) {
    await rm(destination, { recursive: true, force: true });
    await symlink(await readlink(source), destination);
    return;
  }
  await cp(source, destination, { force: true, preserveTimestamps: true });
}

async function cloneRepository(source, root, overrides, cache) {
  if (cache.has(source)) return cache.get(source);
  if (overrides.has(source)) {
    const path = overrides.get(source);
    if (!(await exists(join(path, '.git')))) throw new Error(`Upstream override is not a Git worktree: ${path}`);
    cache.set(source, path);
    return path;
  }
  const destination = join(root, source.replace('/', '__'));
  execFileSync('git', [
    'clone',
    '--quiet',
    '--filter=blob:none',
    `https://github.com/${source}.git`,
    destination
  ], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000
  });
  cache.set(source, destination);
  return destination;
}

function currentTreeHash(repository) {
  return execFileSync('git', ['rev-parse', 'HEAD^{tree}'], {
    cwd: repository,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  }).trim();
}

function actionPlan(local, current, base, mode) {
  const actions = [];
  if (mode === 'current-subset') {
    const relation = compareSnapshots(local, current);
    if (!relation.localSubset) throw new Error('Installed files are no longer a subset of the audited upstream tree');
    for (const path of relation.remoteOnly) actions.push({ type: 'copy', path });
    return actions;
  }

  const baseRelation = compareSnapshots(local, base);
  if (!baseRelation.localSubset) {
    throw new Error('Installed files changed after audit or contain changes not present in the historical base');
  }
  for (const [path, baseSha] of base) {
    if (!current.has(path) && local.get(path) === baseSha) actions.push({ type: 'delete', path });
  }
  for (const [path, currentSha] of current) {
    const localSha = local.get(path);
    const baseSha = base.get(path);
    if (!localSha) {
      actions.push({ type: 'copy', path });
      continue;
    }
    if (localSha === currentSha) continue;
    if (baseSha && localSha === baseSha) {
      actions.push({ type: 'copy', path });
      continue;
    }
    throw new Error(`Local file conflicts with upstream: ${path}`);
  }
  return actions;
}

async function applyOne({ item, manifest, repository, apply }) {
  const provenance = item.provenance;
  const target = item.realPath;
  const backup = backupPathFor(item, manifest);
  if (!(await exists(join(backup, 'SKILL.md')))) throw new Error(`Verified backup is missing ${item.name}`);

  const local = await localSnapshot(target);
  if (snapshotDigest(local) !== provenance.installedSnapshotHash) {
    throw new Error('Installed Skill changed after the update plan was created');
  }
  const observedTree = currentTreeHash(repository);
  if (provenance.upstreamTreeHash && observedTree !== provenance.upstreamTreeHash) {
    throw new Error('Upstream changed after the update plan was created; rerun the planner');
  }

  const skillPath = normalizeSkillPath(provenance.skillPath);
  const upstreamDirectory = skillPath ? join(repository, skillPath) : repository;
  if (!(await exists(upstreamDirectory))) throw new Error(`Upstream path is missing: ${provenance.skillPath || '.'}`);
  const current = await localSnapshot(upstreamDirectory);
  const mode = provenance.status;
  const base = mode === 'clean-old'
    ? gitTreeSnapshot(repository, provenance.baseCommit, skillPath)
    : current;
  if (mode === 'clean-old' && !provenance.baseCommit) throw new Error('Clean-old update has no historical base commit');
  const actions = actionPlan(local, current, base, mode);
  if (!apply) return { name: item.name, status: 'planned', actions };

  const sources = await fileIndex(upstreamDirectory);
  try {
    for (const action of actions) {
      const destination = join(target, action.path);
      if (action.type === 'delete') await rm(destination, { recursive: true, force: true });
      else {
        const source = sources.get(action.path);
        if (!source) throw new Error(`Cannot locate upstream file: ${action.path}`);
        await copyEntry(source, destination);
      }
    }
    const installed = await localSnapshot(target);
    const verified = compareSnapshots(installed, current);
    if (!verified.remoteSubset) throw new Error('Post-update verification did not match the upstream managed tree');
    return { name: item.name, status: 'updated', actions };
  } catch (error) {
    await rm(target, { recursive: true, force: true });
    await cp(backup, target, { recursive: true, dereference: false, preserveTimestamps: true });
    throw new Error(`${error.message}; restored from ${backup}`);
  }
}

const planPath = option('--plan');
if (!planPath) throw new Error('--plan is required');
const apply = argv.includes('--apply');
const json = argv.includes('--json');
const selectedNames = new Set(options('--name'));
const overrides = parseUpstreamRoots();
const plan = JSON.parse(await readFile(resolve(planPath), 'utf8'));
if (!plan.backup?.manifestPath || !(await exists(plan.backup.manifestPath))) {
  throw new Error('The plan has no verified backup manifest');
}
const manifest = JSON.parse(await readFile(plan.backup.manifestPath, 'utf8'));
const targets = plan.items.filter((item) =>
  item.status === 'recoverable-update' && (selectedNames.size === 0 || selectedNames.has(item.name)));
const temporaryRoot = await mkdtemp(join(tmpdir(), 'freshkeeper-apply-'));
const repositories = new Map();
const results = [];

try {
  for (const item of targets) {
    try {
      const repository = await cloneRepository(item.source, temporaryRoot, overrides, repositories);
      results.push(await applyOne({ item, manifest, repository, apply }));
    } catch (error) {
      results.push({ name: item.name, status: 'failed', error: error.message });
    }
  }
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

const output = {
  mode: apply ? 'apply' : 'dry-run',
  selected: targets.length,
  updated: results.filter((item) => item.status === 'updated').length,
  planned: results.filter((item) => item.status === 'planned').length,
  failed: results.filter((item) => item.status === 'failed').length,
  results
};

if (json) console.log(JSON.stringify(output, null, 2));
else {
  console.log(`Freshkeeper provenance updates: ${output.mode}`);
  console.log(`Selected: ${output.selected} | Updated: ${output.updated} | Planned: ${output.planned} | Failed: ${output.failed}`);
  for (const result of results) {
    console.log(`- ${result.name}: ${result.status}${result.error ? ` (${result.error})` : ''}`);
  }
}
if (output.failed > 0) process.exitCode = 1;
