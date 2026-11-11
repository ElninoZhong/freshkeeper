#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { access, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditProvenance } from './provenance.mjs';
import { actionPlan } from './actions.mjs';
import { applySourceEvidence, describeInstalled, fillMetadata, wellKnownChecker } from './version-tracking.mjs';

const argv = process.argv.slice(2);
const startedAt = Date.now();

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
const fill = argv.includes('--fill-metadata');
const applyMetadata = argv.includes('--apply-metadata');
if (applyMetadata && !fill) throw new Error('--apply-metadata requires --fill-metadata');
const selectedNames = options('--skill');
const sourceMapPath = option('--source-map');
if (sourceMapPath && !fill) throw new Error('--source-map requires --fill-metadata');
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
    ? argv.includes('--history') ? 200 : 0
    : Number.parseInt(historyLimitValue, 10);
if (!Number.isInteger(historyLimit) || historyLimit < 0 || historyLimit > 200) {
  throw new Error('--history-limit must be an integer from 0 to 200');
}
const concurrency = Number(option('--concurrency') ?? 6);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 12) throw new Error('--concurrency must be 1-12');
const timeoutMs = Number(option('--timeout-ms') ?? (historyLimit > 0 ? 180000 : 60000));
if (!Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 3600000) throw new Error('--timeout-ms must be 50-3600000');
const deadline = startedAt + timeoutMs;
let lastProgress = 0;
function progress(message, force = false) {
  if (argv.includes('--quiet')) return;
  if (force || Date.now() - lastProgress >= 2000) {
    process.stderr.write(`[freshkeeper] ${message}\n`); lastProgress = Date.now();
  }
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
    let markdown = '', readError = null;
    try { markdown = await readFile(skillFile, 'utf8'); } catch (error) {
      if (error.code === 'ENOENT') continue;
      readError = error.message;
    }
    skills.push({
      folder: entry.name,
      readError,
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
      stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000
    }).trim();
  } catch {
    return '';
  }
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
const allInventory = await inventoryLibraries(resolved);
const inventory = selectedNames.length ? allInventory.filter(skill => selectedNames.includes(skill.name)) : allInventory;
for (const name of selectedNames) if (!inventory.some(skill => skill.name === name)) throw new Error(`Installed Skill not found: ${name}`);
const lockPath = option('--lock') ?? defaultLockPath();
const lock = await readLock(lockPath);
const originalLock = await readFile(lockPath, 'utf8').catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
const sourceMap = sourceMapPath ? JSON.parse(await readFile(sourceMapPath, 'utf8')) : null;
if (sourceMap && (sourceMap.version !== 1 || !sourceMap.sources || typeof sourceMap.sources !== 'object')) throw new Error('Invalid source evidence map');
if (lock.freshkeeperTracking && (typeof lock.freshkeeperTracking !== 'object' || Array.isArray(lock.freshkeeperTracking))) throw new Error('Invalid tracking metadata');
if (originalLock !== null && JSON.stringify(lock) !== JSON.stringify(JSON.parse(originalLock))) throw new Error('Lock changed while reading');
// Preflight evidence before network access; retain independent results on failure.
progress(`本地预检：${inventory.length} 项`, true);
const localItems = new Map();
for (const skill of inventory) {
  const entry = lock.skills[skill.name] ?? lock.skills[skill.folder];
  let item = baseItem(skill, entry);
  try {
    if (skill.readError) throw new Error(skill.readError);
    item = await describeInstalled(item, lock.freshkeeperTracking?.[skill.realPath]);
  } catch (error) {
    Object.assign(item, { status: 'check-failed', localReadError: true, reason: `Local Skill cannot be read: ${error.message}` });
  }
  localItems.set(skill.realPath, item);
}
await applySourceEvidence([...localItems.values()].filter(item => !item.localReadError), sourceMap?.sources, lock.freshkeeperTracking);
const fixture = fixturePath ? JSON.parse(await readFile(fixturePath, 'utf8')) : null;
let token;
const githubToken = () => {
  if (fixture) return '';
  if (token === undefined) token = getGitHubToken();
  return token;
};
const provenanceTargets = inventory.filter((skill) => {
  const item = localItems.get(skill.realPath);
  const entry = lock.skills[skill.name] ?? lock.skills[skill.folder];
  return !item.localReadError && !item.sourceEvidenceChecked && (!entry || entry.sourceType === 'github');
}).map((skill) => {
  const entry = lock.skills[skill.name] ?? lock.skills[skill.folder];
  const tracked = lock.freshkeeperTracking?.[skill.realPath];
  const recorded = entry?.sourceType === 'github' && entry.source ? entry
    : tracked?.sourceStatus === 'confirmed' && ['github', 'github-recovered'].includes(tracked.sourceType) ? tracked : null;
  return recorded ? { ...skill, recordedSource: recorded.source, recordedSkillPath: recorded.skillPath,
    recordedFolderHash: recorded.skillFolderHash, recordedRef: recorded.ref } : skill;
});
const checkWellKnown = wellKnownChecker(fixture, { deadline });
const wellKnownResults = new Map();
const wellKnownSkills = inventory.filter(skill => {
  const item = localItems.get(skill.realPath);
  const entry = lock.skills[skill.name] ?? lock.skills[skill.folder];
  return !item.localReadError && !item.sourceEvidenceChecked && entry?.sourceType === 'well-known';
});
const wellKnownPromise = (async () => {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(2, wellKnownSkills.length) }, async () => {
    while (cursor < wellKnownSkills.length) {
      const skill = wellKnownSkills[cursor++];
      const entry = lock.skills[skill.name] ?? lock.skills[skill.folder];
      try { wellKnownResults.set(skill.realPath, await checkWellKnown(skill, entry)); }
      catch (error) { wellKnownResults.set(skill.realPath, { status: 'check-failed', reason: error.message }); }
    }
  }));
})();
progress(`当前上游比对：${provenanceTargets.length} 项 GitHub、${wellKnownSkills.length} 项官方索引；历史深度 ${historyLimit}`, true);
const recovered = provenanceTargets.length ? await auditProvenance({
  skills: provenanceTargets, catalogPath, fixture, token: githubToken(), historyLimit, concurrency, deadline,
  onProgress: ({ completed, total, name }) => progress(`上游比对 ${completed}/${total}：${name}`)
}) : new Map();
await wellKnownPromise;
const items = [];
for (const skill of inventory) {
  const entry = lock.skills[skill.name] ?? lock.skills[skill.folder];
  const item = { ...localItems.get(skill.realPath) };
  if (item.localReadError || item.sourceEvidenceChecked) { items.push(item); continue; }
  if (entry?.sourceType === 'well-known') {
    Object.assign(item, wellKnownResults.get(skill.realPath));
  } else if (!entry || entry.sourceType === 'github') {
    const provenance = recovered.get(skill.realPath);
    if (provenance) Object.assign(item, provenance, { provenance });
  } else if (entry.sourceType === 'local') {
    item.status = 'local-only'; item.reason = 'Local source has no verified authorship evidence or remote version';
  } else {
    item.status = 'uncheckable'; item.reason = `Unsupported source type: ${entry.sourceType ?? 'unknown'}`;
  }
  items.push(item);
}
progress('复核本地内容并生成行动清单', true);
for (const item of items) {
  const before = localItems.get(item.realPath);
  if (!before.installedSnapshotHash) continue;
  try {
    const after = await describeInstalled(item, lock.freshkeeperTracking?.[item.realPath]);
    if (after.installedSnapshotHash !== before.installedSnapshotHash) throw new Error('Local Skill changed during comparison; retry this item only');
  } catch (error) {
    item.status = 'check-blocked'; item.revalidationFailed = true; item.reason = error.message;
  }
  item.installedSnapshotHash = before.installedSnapshotHash;
  item.installedVersion = before.installedVersion;
  item.installedDeclaredVersion = before.installedDeclaredVersion;
}
const eligibleMetadata = items.filter(item => !item.localReadError && !item.evidenceError && !item.revalidationFailed
  && !['check-failed', 'check-blocked'].includes(item.status));
const metadata = fill ? await fillMetadata({ items: eligibleMetadata, lock, lockPath, original: originalLock, apply: applyMetadata }) : null;
const actions = actionPlan(items);
const installedNames = new Set(allInventory.flatMap((skill) => [skill.name, skill.folder]));
const staleLockEntries = Object.keys(lock.skills).filter((name) => !installedNames.has(name)).sort();
const count = (status) => items.filter((item) => item.status === status).length;
const currentStatuses = new Set(['current', 'exact-current', 'local-extension', 'bundled-current', 'local-modified']);
const updateStatuses = new Set(['update-available', 'clean-old', 'current-subset']);
const checkableStatuses = new Set([
  ...currentStatuses,
  ...updateStatuses,
  'manual-merge',
  'needs-review',
  'local-ahead',
  'legacy-local',
  'missing-upstream',
  'check-failed',
  'check-blocked'
]);
const result = {
  generatedAt: new Date().toISOString(),
  mode: historyLimit > 0 ? 'deep' : 'quick', historyLimit, timeoutMs,
  elapsedSeconds: Math.round((Date.now() - startedAt) / 100) / 10,
  budgetExceeded: Date.now() > deadline, actions,
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
  needsReview: actions.needsReview.length, localModified: count('local-modified'),
  localAhead: count('local-ahead'),
  localTracked: count('local-tracked'),
  legacyLocal: count('legacy-local'),
  unresolved: items.filter((item) => ['untracked', 'unresolved', 'uncheckable', 'local-only'].includes(item.status)).length,
  uncheckable: items.filter((item) => ['untracked', 'unresolved', 'uncheckable', 'local-only'].includes(item.status)).length,
  errors: count('check-failed') + count('check-blocked'),
  upstreamMissing: count('missing-upstream'),
  retired: actions.retired.length,
  staleLockEntries,
  metadataTracked: items.filter(item => item.metadataTracked).length,
  localDrift: items.filter(item => item.localDrift).length,
  metadata,
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
  console.log(`模式: ${result.mode} | 用时: ${result.elapsedSeconds}s | 当前一致/本地适配: ${result.current} | 已验证更新候选: ${result.updatesAvailable} | 需核对差异: ${result.needsReview} | 来源缺口: ${result.unresolved} | 上游移除: ${result.retired} | 执行失败: ${result.errors}`);
  const labels = { updateCandidates: '可按授权更新', needsReview: '先核对差异（可仅对此项深查）', sourceRepairs: '需要修复来源登记或证据', retired: '上游已移除/迁移，保留本地待核实', retry: '仅重试这些失败项' };
  for (const [group, label] of Object.entries(labels)) {
    const entries = actions[group];
    if (!entries.length) continue;
    console.log(`${label}: ${entries.length}`);
    for (const action of entries.slice(0, details ? undefined : 12)) console.log(`- ${action.name}: ${action.label} (${action.reason})`);
    if (!details && entries.length > 12) console.log(`  另有 ${entries.length - 12} 项，使用 --details 或 --json 查看完整清单。`);
  }
  if (result.mode === 'quick') console.log('快速比对未追溯历史；存在差异不等于需要人工合并。仅对需要的项目加 --history --skill <name>。');
  if (result.budgetExceeded) console.log('本轮达到时间预算；已完成结果保留，超时项单列，不代表已经最新。');
  if (staleLockEntries.length) console.log(`Stale lock entries: ${staleLockEntries.join(', ')}`);
  if (metadata) console.log(`Metadata ${metadata.mode}: ${metadata.actions.length}; backup: ${metadata.backupPath ?? 'none'}`);
  if (details) {
    console.log();
    console.log('Skill\tStatus\tAgents\tSource\tInstalled version\tUpstream version\tReason');
    for (const item of items) {
      console.log(`${item.name}\t${item.status}\t${item.agents.join(',')}\t${item.source ?? '-'}\t${item.installedDeclaredVersion ?? item.installedVersion}\t${item.upstreamVersion ?? '-'}\t${item.reason}`);
    }
  } else {
    console.log('Use `with details` to show every installed skill and its check status.');
  }
}

progress(`完成：${result.totalInstalled} 项，${result.elapsedSeconds}s`, true);
if (result.errors > 0) process.exitCode = 1;
