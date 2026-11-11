import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, cp, rename, rm, lstat, readlink, symlink, readdir, realpath } from 'node:fs/promises';
import { join, dirname, resolve, basename, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { localSnapshot, snapshotDigest, gitBlobSha, loadProvenanceCatalog, normalizeSkillPath } from './provenance.mjs';
import { declaredVersion } from './version-tracking.mjs';
import { safeExec } from './update-process.mjs';
import { updateClient } from './update-cache.mjs';
import { stageItem, safeRelative, description } from './update-payload.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const hash = data => createHash('sha256').update(data ?? '').digest('hex');
const exists = async path => lstat(path).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
async function bytes(path) { try { return await readFile(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
async function atomicJson(path, data) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = path + '.' + randomUUID() + '.tmp';
  try {
    const mode = await lstat(path).then(x => x.mode & 0o777, () => 0o600);
    await writeFile(temp, JSON.stringify(data, null, 2) + '\n', { mode });
    JSON.parse(await readFile(temp, 'utf8')); await rename(temp, path);
  } finally { await rm(temp, { force: true }); }
}
async function physicalPath(path) {
  let parent = resolve(path); const suffix = [];
  while (!await exists(parent)) { suffix.unshift(basename(parent)); parent = dirname(parent); }
  return resolve(await realpath(parent), ...suffix);
}
function owned(item, libraries) { return libraries.some(lib => item.realPath.startsWith(lib.realPath + sep)); }
async function inventory(libraries) {
  const rows = [];
  for (const lib of libraries) {
    if (await realpath(lib.path) !== lib.realPath) throw new Error('Library path changed');
    for (const alias of lib.aliases) if (await realpath(alias) !== lib.realPath) throw new Error('Library alias changed');
    for (const entry of await readdir(lib.realPath, { withFileTypes: true })) {
      const path = join(lib.realPath, entry.name);
      if (!(entry.isDirectory() || entry.isSymbolicLink()) || !await exists(join(path, 'SKILL.md'))) continue;
      const text = await readFile(join(path, 'SKILL.md'), 'utf8');
      const name = text.match(/^---\s*\n([\s\S]*?)\n---/)?.[1].match(/^name:\s*["']?([^\n"']+)["']?\s*$/m)?.[1]?.trim() ?? entry.name;
      rows.push([name, path, await realpath(path)]);
    }
  }
  return rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
function remaining(ctx) {
  if (Date.now() >= ctx.deadline) throw new Error('Update time budget exceeded; retry pending items only');
  return ctx.deadline - Date.now();
}
async function pool(values, count, action) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(count, values.length) }, async () => {
    while (cursor < values.length) await action(values[cursor++]);
  }));
}
function scopeSeal(plan) {
  return hash(JSON.stringify({ id: plan.id, userHome: plan.userHome, job: plan.job, lockPath: plan.lockPath, lockRealPath: plan.lockRealPath,
    libraries: plan.libraries, items: plan.items.map(i => ({ name: i.name, realPath: i.realPath, source: i.source,
      stage: i.stage, pinned: i.pinned, originalFiles: i.originalFiles, expectedFiles: i.expectedFiles,
      newFolderHash: i.newFolderHash, upstreamDigest: i.upstreamDigest, originalModes: i.originalModes, originalTypes: i.originalTypes, expectedModes: i.expectedModes,
      mode: i.mode, preserveDescription: i.preserveDescription, installedSnapshotHash: i.installedSnapshotHash })) }));
}
async function save(plan) {
  await atomicJson(join(plan.job, 'state.json'), plan);
  // The user-facing plan is an immutable locator; resume reads the durable checkpoint.
  if (!await exists(plan.planPath)) await atomicJson(plan.planPath, plan);
}
export async function loadSavedPlan(path, userHome = homedir()) {
  const input = JSON.parse(await readFile(path, 'utf8'));
  const owner = await realpath(userHome);
  const root = await realpath(join(owner, '.agents', 'skill-update-runs'));
  const job = resolve(input.job ?? '');
  if (!job.startsWith(root + sep) || await realpath(job) !== job) throw new Error('Plan is not an owned update checkpoint');
  const plan = JSON.parse(await readFile(join(job, 'state.json'), 'utf8'));
  if (resolve(plan.userHome) !== owner || input.id !== plan.id || scopeSeal(input) !== plan.scopeSeal
    || scopeSeal(plan) !== plan.scopeSeal) throw new Error('Plan scope differs from its saved checkpoint');
  return plan;
}
function sourceBinding(item, lock, catalog) {
  if (item.sourceType === 'well-known') {
    const direct = lock.skills[item.name] ?? lock.skills[item.folder];
    const specific = lock.freshkeeperTracking?.[item.realPath];
    return direct?.sourceType === 'well-known' && (!specific?.sourceUrl || specific.sourceUrl === direct.sourceUrl);
  }
  const entry = lock.skills[item.name] ?? lock.skills[item.folder];
  const tracked = lock.freshkeeperTracking?.[item.realPath];
  const known = tracked?.sourceStatus === 'confirmed' && ['github', 'github-recovered'].includes(tracked.sourceType) ? tracked
    : entry?.sourceType === 'github' && entry.source ? entry
      : catalog.get(item.name) ?? catalog.get(item.folder);
  if (!known || known.source?.toLowerCase() !== item.source?.toLowerCase()) return false;
  return normalizeSkillPath(known.skillPath ?? known.path) === normalizeSkillPath(item.provenance?.skillPath ?? item.skillPath);
}
function nextStep(item) {
  if (item.status === 'failed' && item.failurePhase === 'apply') return 'resume-failed';
  if (item.status === 'failed' || item.status === 'pending') return 'recheck-skill';
  if (['needs-review', 'manual-merge', 'stage-blocked'].includes(item.status)) return 'review-difference';
  if (['missing-upstream', 'legacy-local'].includes(item.status)) return 'review-upstream-removal';
  if (['unresolved', 'untracked', 'check-blocked', 'check-failed'].includes(item.status)) return 'repair-source-or-retry-item';
  return 'none';
}

function updateEntry(item, lock) {
  const direct = lock.skills[item.name] ?? lock.skills[item.folder];
  const tracked = lock.freshkeeperTracking?.[item.realPath];
  const base = tracked?.skillFolderHash ?? tracked?.installedUpstreamBase?.folderTree;
  if (tracked?.sourceStatus === 'confirmed' && ['github', 'github-recovered'].includes(tracked.sourceType)) {
    if (/^[0-9a-f]{40}$/i.test(base ?? '')) return { ...tracked, sourceType: 'github', skillFolderHash: base };
    if (direct?.source?.toLowerCase() !== tracked.source?.toLowerCase()) return null;
  }
  return direct;
}
export async function prepareUpdate(options = {}) {
  const started = Date.now(), userHome = await realpath(options.home ?? homedir());
  const timeoutMs = options.timeoutMs ?? 180000;
  let job = join(userHome, '.agents', 'skill-update-runs', new Date().toISOString().replace(/[-:.]/g, '') + '-' + randomUUID().slice(0, 6));
  await mkdir(job, { recursive: true, mode: 0o700 });
  job = await realpath(job);
  const planPath = options.writePlan ? resolve(options.writePlan) : join(job, 'plan.json');
  if (await exists(planPath)) throw new Error('Plan already exists; resume it with --plan or choose a new path');
  const ctx = { deadline: started + timeoutMs };
  const cacheDir = join(job, 'http-cache'); await mkdir(cacheDir, { mode: 0o700 });
  options.progress?.('check');
  let check;
  if (options.fromCheck) {
    check = JSON.parse(await readFile(options.fromCheck, 'utf8'));
    if (!check.sourceLockSnapshotHash) throw new Error('Check lacks a metadata signature; create a fresh quick check');
    if (options.home && resolve(check.lockPath) !== join(resolve(options.home), '.agents', '.skill-lock.json')) throw new Error('Check scope does not match the requested home');
  } else {
    const args = ['--import', join(scriptDir, 'update-cache.mjs'), join(scriptDir, 'check-installed-skills.mjs'), '--json', '--timeout-ms', String(Math.min(options.history ? remaining(ctx) : 60000, remaining(ctx)))];
    for (const name of options.skills ?? []) args.push('--skill', name);
    if (options.home) args.push('--home', options.home);
    if (options.fixture) args.push('--fixture', options.fixture);
    if (options.catalog) args.push('--provenance-catalog', options.catalog);
    if (options.history) args.push('--history');
    const result = await (options.checkRunner ?? safeExec)(process.execPath, args, { timeoutMs: remaining(ctx), env: { ...process.env, FRESHKEEPER_UPDATE_CAPTURE_DIR: cacheDir } });
    try { check = JSON.parse(result.stdout); } catch { throw new Error(result.stderr || 'Check did not return a valid report'); }
    await writeFile(join(job, 'check.stderr.log'), result.stderr, { mode: 0o600 });
  }
  if (!check.totalInstalled || check.libraryMode === 'none') throw new Error('No selected Skill library');
  const physicalPlan = await physicalPath(planPath);
  if (check.libraries.some(lib => physicalPlan === lib.realPath || physicalPlan.startsWith(lib.realPath + sep))
    || ['.skill-lock.json', 'skills-lock.json', 'freshkeeper.lock.json', 'package-lock.json'].includes(planPath.split(/[\\/]/).pop())) throw new Error('Plan output must stay outside Skill libraries and project locks');
  const lockBytes = await bytes(check.lockPath);
  if (check.sourceLockSnapshotHash && hash(lockBytes) !== check.sourceLockSnapshotHash) throw new Error('Source metadata changed after check');
  const lock = lockBytes ? JSON.parse(lockBytes) : { version: 3, skills: {} };
  const selected = options.skills?.length ? check.items.filter(i => options.skills.includes(i.name)) : check.items;
  if (options.skills?.some(name => !selected.some(item => item.name === name))) throw new Error('Selected Skill is missing from the check');
  await writeFile(join(job, 'check.json'), JSON.stringify(check), { mode: 0o600 });
  await writeFile(join(job, 'registry-before.json'), lockBytes ?? '', { mode: 0o600 });
  for (const item of selected) if (options.fromCheck && item.installedSnapshotHash
    && snapshotDigest(await localSnapshot(item.realPath)) !== item.installedSnapshotHash) throw new Error(`Local files changed: ${item.name}; recheck only this item`);
  const fixture = options.fixture ? JSON.parse(await readFile(options.fixture, 'utf8')) : null;
  const catalog = await loadProvenanceCatalog(options.catalog ?? join(scriptDir, '../references/provenance-catalog.json'));
  const client = updateClient({ cacheDir, fixture, deadline: ctx.deadline });
  const plan = { schema: 'freshkeeper.skill-update.v2', id: randomUUID(), createdAt: new Date().toISOString(), planPath, job, userHome, checkedAt: check.generatedAt,
    timeoutMs, cacheDir, fixture: options.fixture ?? null, lockPath: check.lockPath, lockOriginalHash: hash(lockBytes), lockExisted: lockBytes !== null, lockExpectedHash: hash(lockBytes),
    lockRealPath: await realpath(check.lockPath).catch(() => resolve(check.lockPath)),
    libraryMode: check.libraryMode, libraries: check.libraries, inventory: await inventory(check.libraries), backup: null,
    items: selected.map(item => ({ ...item, checkStatus: item.status })), timings: { checkMs: Date.now() - started }, results: [] };
  options.progress?.('stage'); const stageStarted = Date.now();
  await pool(plan.items, 6, async item => {
    const entry = updateEntry(item, lock);
    const candidate = ['clean-old', 'current-subset'].includes(item.status)
      || item.status === 'update-available' && item.sourceType === 'well-known'
      || item.status === 'needs-review' && entry?.sourceType === 'github' && /^[0-9a-f]{40}$/i.test(entry.skillFolderHash ?? '');
    if (!candidate || !owned(item, plan.libraries)) return;
    if (!sourceBinding(item, lock, catalog)) { item.status = 'stage-blocked'; item.reason = 'Source does not match local provenance metadata or the verified catalog'; return; }
    try {
      remaining(ctx);
      if (snapshotDigest(await localSnapshot(item.realPath)) !== item.installedSnapshotHash) throw new Error('Local files changed after check');
      const staged = await stageItem(item, entry, client, join(job, 'staged', hash(item.realPath).slice(0, 16)), ctx.deadline);
      Object.assign(item, staged);
    } catch (error) { item.status = /budget|timeout|fetch failed|HTTP (429|5\d\d)/i.test(error.message) ? 'pending' : 'stage-blocked'; item.reason = error.message; }
  });
  plan.timings.stageMs = Date.now() - stageStarted;
  for (const item of plan.items) item.nextStep = nextStep(item);
  plan.scopeSeal = scopeSeal(plan);
  await save(plan); return plan;
}

async function ensureBackup(plan, targets, ctx) {
  const start = Date.now();
  if (!plan.backup) {
    const root = join(plan.userHome, '.agents', 'skill-backups', new Date().toISOString().replace(/[-:.]/g, '') + '-update-v2');
    await mkdir(root, { recursive: true, mode: 0o700 });
    await cp(join(plan.job, 'registry-before.json'), join(root, '.skill-lock.json'));
    if (hash(await readFile(join(root, '.skill-lock.json'))) !== plan.lockOriginalHash) throw new Error('Recovery registry verification failed');
    plan.backup = { root, targets: {} }; await save(plan);
  }
  for (const item of targets) {
    remaining(ctx);
    const before = item.installedSnapshotHash;
    let entry = plan.backup.targets[item.realPath];
    if (!entry) {
      const path = join(plan.backup.root, 'skills', hash(item.realPath).slice(0, 16));
      await cp(item.realPath, path, { recursive: true, dereference: false, verbatimSymlinks: true, preserveTimestamps: true, filter: () => { remaining(ctx); return true; } });
      entry = { name: item.name, realPath: item.realPath, path, snapshotHash: before };
      plan.backup.targets[item.realPath] = entry;
    }
    if (snapshotDigest(await localSnapshot(entry.path)) !== before) throw new Error(`Recovery copy verification failed: ${item.name}`);
  }
  await atomicJson(join(plan.backup.root, 'manifest.json'), { schema: plan.schema, lockPath: plan.lockPath, inventory: plan.inventory, libraries: plan.libraries, targets: plan.backup.targets });
  await save(plan); plan.timings.backupMs = (plan.timings.backupMs ?? 0) + Date.now() - start;
}
async function noSymlinkParent(root, path) {
  let parent = dirname(path);
  while (parent !== root) {
    if (!parent.startsWith(root + sep)) throw new Error('Update path escaped its Skill');
    if (await exists(parent) && (await lstat(parent)).isSymbolicLink()) throw new Error('Symlink parent requires separate review');
    parent = dirname(parent);
  }
}
async function copyEntry(source, destination) {
  await mkdir(dirname(destination), { recursive: true });
  const temp = destination + '.' + randomUUID() + '.tmp';
  try {
    if ((await lstat(source)).isSymbolicLink()) await symlink(await readlink(source), temp);
    else await cp(source, temp, { preserveTimestamps: true });
    await rename(temp, destination);
  } finally { await rm(temp, { force: true }); }
}
export async function applyFiles({ target, stage, backup, original, expected, originalModes = {}, originalTypes = {}, expectedModes = {}, deadline, copy = copyEntry }) {
  const journal = [];
  const restore = async () => {
    for (const action of [...journal].reverse()) {
      if (action.original) await copyEntry(join(backup, action.path), join(target, action.path));
      else await rm(join(target, action.path), { force: true });
    }
  };
  try {
    for (const path of new Set([...Object.keys(original), ...Object.keys(expected)])) {
      safeRelative(path);
      if (original[path] === expected[path] && (expectedModes[path] === undefined || originalModes[path] === expectedModes[path])) continue;
      if (Date.now() >= deadline) throw new Error('Update time budget exceeded during write');
      const destination = resolve(target, path); await noSymlinkParent(resolve(target), destination);
      const current = await exists(destination) ? await lstat(destination) : null;
      const observed = !current ? undefined : gitBlobSha(current.isSymbolicLink()
        ? Buffer.from(await readlink(destination)) : await readFile(destination));
      if (observed !== original[path] || current && originalTypes[path]
        && (current.isSymbolicLink() ? 'symlink' : 'file') !== originalTypes[path]
        || current && originalModes[path] !== undefined && (current.mode & 0o777) !== originalModes[path]) throw new Error(`Local file changed before write: ${path}`);
      journal.push({ path, original: Object.hasOwn(original, path) });
      if (Object.hasOwn(expected, path)) await copy(join(stage, path), destination);
      else await rm(destination, { force: true });
    }
    const after = await localSnapshot(target);
    if (JSON.stringify([...after].sort()) !== JSON.stringify(Object.entries(expected).sort())) throw new Error('Post-update payload verification failed');
    for (const [path, mode] of Object.entries(expectedModes)) if (((await lstat(join(target, path))).mode & 0o777) !== mode) throw new Error('Post-update mode verification failed');
    return { restore, afterHash: snapshotDigest(after), changedFiles: journal.map(x => x.path) };
  } catch (error) { await restore(); throw error; }
}
async function commitMetadata(plan, item, currentBytes, afterHash) {
  if (hash(await bytes(plan.lockPath)) !== plan.lockExpectedHash) throw new Error('Source registry changed; leave other records untouched');
  const lock = currentBytes ? JSON.parse(currentBytes) : { version: 3, skills: {} };
  const target = await realpath(plan.lockPath).catch(() => resolve(plan.lockPath));
  if (target !== plan.lockRealPath) throw new Error('Source registry target changed');
  const entry = lock.skills[item.name] ?? lock.skills[item.folder];
  const timestamp = new Date().toISOString();
  const copies = new Set(plan.inventory.filter(row => row[0] === item.name).map(row => row[2]));
  if (entry?.sourceType === 'github' && copies.size === 1) { entry.skillFolderHash = item.newFolderHash; entry.updatedAt = timestamp; }
  if (entry?.sourceType === 'well-known' && copies.size === 1) { entry.wellKnownDigest = item.upstreamDigest; entry.updatedAt = timestamp; }
  const old = lock.freshkeeperTracking?.[item.realPath];
  // Updating an evidenced package is not permission to register guessed/recovered origins.
  if (entry || old?.sourceStatus === 'confirmed') {
    lock.freshkeeperTracking ??= {};
    lock.freshkeeperTracking[item.realPath] = { ...old, name: item.name, realPath: item.realPath,
      source: old?.sourceStatus === 'confirmed' ? old.source : entry?.source ?? item.source,
      sourceType: old?.sourceStatus === 'confirmed' ? old.sourceType : entry?.sourceType ?? item.sourceType,
      sourceStatus: 'confirmed', sourceUrl: item.sourceUrl ?? entry?.sourceUrl ?? old?.sourceUrl ?? null,
      ...(item.upstreamDigest ? { wellKnownDigest: item.upstreamDigest } : {}), skillPath: item.pinned.skillPath ?? old?.skillPath ?? null,
      baselineSnapshotHash: old?.baselineSnapshotHash ?? item.installedSnapshotHash,
      baselineRecordedAt: old?.baselineRecordedAt ?? timestamp, observedSnapshotHash: afterHash,
      installedDeclaredVersion: declaredVersion(await readFile(join(item.realPath, 'SKILL.md'), 'utf8')),
      upstreamVersion: item.upstreamVersion ?? old?.upstreamVersion ?? null, upstreamVersionKind: item.upstreamVersionKind ?? old?.upstreamVersionKind ?? null,
      versionEvidence: { ...(item.versionEvidence ?? {}), observedAt: plan.checkedAt, receipt: join(plan.backup.root, 'result.json') },
      ...(item.newFolderHash ? { skillFolderHash: item.newFolderHash } : {}),
      installedUpstreamBase: { ...item.pinned, folderTree: item.newFolderHash, localSnapshot: afterHash,
        preservedFields: item.preserveDescription ? ['description'] : [], updatedAt: timestamp },
      lastSuccessfulUpdate: { receipt: join(plan.backup.root, 'result.json'), changedFiles: item.changedFiles, updatedAt: timestamp }, checkedAt: timestamp };
  }
  if (entry || old?.sourceStatus === 'confirmed') {
    plan.inProgress.afterRegistryHash = hash(JSON.stringify(lock, null, 2) + '\n');
    await save(plan);
    await atomicJson(target, lock);
    plan.lockExpectedHash = plan.inProgress.afterRegistryHash;
  }
}

async function recoverInterrupted(plan) {
  const marker = plan.inProgress;
  if (!marker) return;
  const item = plan.items.find(value => value.realPath === marker.realPath);
  if (!item || !plan.backup?.targets[item.realPath]) throw new Error('Interrupted update lacks its verified recovery copy');
  if (!owned(item, plan.libraries) || await realpath(item.realPath) !== item.realPath) throw new Error('Interrupted physical Skill path changed');
  const current = await localSnapshot(item.realPath), registry = hash(await bytes(plan.lockPath));
  if (marker.afterRegistryHash && registry === marker.afterRegistryHash
    && JSON.stringify([...current].sort()) === JSON.stringify(Object.entries(item.expectedFiles).sort())) {
    item.status = item.changedFiles.length ? 'updated' : 'already-current';
    item.afterSnapshotHash = snapshotDigest(current); plan.lockExpectedHash = registry;
    plan.recovery = { committed: 1, restored: 0 };
  } else if (registry === marker.beforeRegistryHash) {
    const backup = plan.backup.targets[item.realPath];
    if (snapshotDigest(await localSnapshot(backup.path)) !== item.installedSnapshotHash) throw new Error('Interrupted recovery copy changed');
    const conflicts = [];
    for (const path of item.changedFiles) {
      const value = current.get(path);
      if (value !== item.originalFiles[path] && value !== item.expectedFiles[path]) { conflicts.push(path); continue; }
      if (Object.hasOwn(item.originalFiles, path)) await copyEntry(join(backup.path, path), join(item.realPath, path));
      else await rm(join(item.realPath, path), { force: true });
    }
    if (snapshotDigest(await localSnapshot(item.realPath)) === item.installedSnapshotHash) item.status = 'ready';
    else { item.status = 'failed'; item.failurePhase = 'preflight'; item.reason = 'Local edits coexist with an interrupted update; recheck this item'; }
    plan.recovery = { committed: 0, restored: 1, conflicts };
  } else throw new Error('Registry changed across an interrupted update; inspect its recovery copy');
  delete plan.inProgress; await save(plan);
}
export async function applyUpdate(plan, { retryFailed = false, timeoutMs = plan.timeoutMs, progress, copy } = {}) {
  if (plan.schema !== 'freshkeeper.skill-update.v2') throw new Error('Unsupported update plan');
  const start = Date.now(), ctx = { deadline: start + timeoutMs };
  if (plan.scopeSeal !== scopeSeal(plan)) throw new Error('Prepared plan scope was modified');
  if (await realpath(plan.lockPath).catch(() => resolve(plan.lockPath)) !== plan.lockRealPath) throw new Error('Source registry target changed');
  await recoverInterrupted(plan);
  if (hash(await bytes(plan.lockPath)) !== plan.lockExpectedHash) throw new Error('Source metadata changed; create a targeted plan for pending items');
  if (await realpath(plan.lockPath).catch(() => resolve(plan.lockPath)) !== plan.lockRealPath) throw new Error('Source registry target changed');
  if (JSON.stringify(await inventory(plan.libraries)) !== JSON.stringify(plan.inventory)) throw new Error('Skill inventory or aliases changed');
  if (plan.scopeSeal !== scopeSeal(plan)) throw new Error('Prepared plan scope was modified');
  const targets = plan.items.filter(item => item.status === 'ready' || retryFailed && item.status === 'failed' && item.failurePhase === 'apply');
  if (!targets.length) {
    for (const item of plan.items) if (['updated', 'already-current'].includes(item.status)
      && snapshotDigest(await localSnapshot(item.realPath)) !== item.afterSnapshotHash) throw new Error(`Completed item changed: ${item.name}; recheck this item only`);
    plan.lastAttempt = { updated: 0, reused: Boolean(plan.completedAt) };
    plan.completedAt ??= new Date().toISOString(); await save(plan);
    await atomicJson(join(plan.job, 'result.json'), summary(plan)); return plan;
  }
  plan.lastAttempt = { updated: 0, reused: false };
  // Validate all staged data before crossing the first write seam.
  const valid = [];
  for (const item of targets) {
    try {
    remaining(ctx);
    if (!owned(item, plan.libraries)) throw new Error('Plan target is outside its owned library');
    if (snapshotDigest(await localSnapshot(item.realPath)) !== item.installedSnapshotHash) throw new Error(`Local Skill changed: ${item.name}; recheck only this item`);
    const staged = await localSnapshot(item.stage);
    if (JSON.stringify([...staged].sort()) !== JSON.stringify(Object.entries(item.expectedFiles).sort())) throw new Error(`Staged files changed: ${item.name}`);
    if (item.preserveDescription && description(await readFile(join(item.realPath, 'SKILL.md'), 'utf8')).block.replace(/[\r\n]+$/, '')
      !== description(await readFile(join(item.stage, 'SKILL.md'), 'utf8')).block.replace(/[\r\n]+$/, '')) throw new Error('Local description was not preserved');
      if (await realpath(item.realPath) !== item.realPath) throw new Error('Physical Skill path changed');
      valid.push(item);
    } catch (error) { item.status = 'failed'; item.failurePhase = 'preflight'; item.reason = error.message; }
  }
  if (!valid.length) { await save(plan); return plan; }
  progress?.('backup/apply'); const applyStart = Date.now();
  for (const item of valid) {
    if (Date.now() >= ctx.deadline) { item.status = 'failed'; item.failurePhase = 'apply'; item.reason = 'Update time budget exceeded; retry this item only'; continue; }
    let transaction;
    try {
      const registry = await bytes(plan.lockPath);
      if (hash(registry) !== plan.lockExpectedHash) throw new Error('Source registry changed');
      if (snapshotDigest(await localSnapshot(item.realPath)) !== item.installedSnapshotHash) throw new Error('Local Skill changed before write');
      await ensureBackup(plan, [item], ctx);
      plan.inProgress = { realPath: item.realPath, beforeRegistryHash: plan.lockExpectedHash };
      await save(plan);
      transaction = await applyFiles({ target: item.realPath, stage: item.stage, backup: plan.backup.targets[item.realPath].path,
        original: item.originalFiles, expected: item.expectedFiles, originalModes: item.originalModes, originalTypes: item.originalTypes, expectedModes: item.expectedModes, deadline: ctx.deadline, copy });
      await commitMetadata(plan, item, registry, transaction.afterHash);
      item.afterSnapshotHash = transaction.afterHash; item.status = transaction.changedFiles.length ? 'updated' : 'already-current';
      if (item.status === 'updated') plan.lastAttempt.updated += 1;
      item.changedFiles = transaction.changedFiles; delete item.reason;
    } catch (error) {
      if (transaction) await transaction.restore();
      item.status = 'failed'; item.failurePhase = /Local file changed/.test(error.message) ? 'preflight' : 'apply'; item.reason = error.message;
    }
    delete plan.inProgress;
    item.nextStep = nextStep(item); await save(plan);
  }
  plan.timings.applyMs = Date.now() - applyStart;
  progress?.('verify');
  if (JSON.stringify(await inventory(plan.libraries)) !== JSON.stringify(plan.inventory)) throw new Error('Post-update inventory or alias mismatch');
  for (const item of targets) if (['updated', 'already-current'].includes(item.status)) {
    if (snapshotDigest(await localSnapshot(item.realPath)) !== item.afterSnapshotHash) throw new Error(`Post-update local contents changed: ${item.name}`);
  }
  plan.completedAt = new Date().toISOString(); await save(plan);
  await atomicJson(join(plan.job, 'result.json'), summary(plan));
  if (plan.backup) await atomicJson(join(plan.backup.root, 'result.json'), summary(plan)); return plan;
}
export function summary(plan) {
  return { mode: plan.completedAt ? 'apply' : 'preview', checkedAt: plan.checkedAt ?? plan.createdAt, versionPolicy: 'pinned-to-plan', planPath: plan.planPath, job: plan.job, totalSelected: plan.items.length,
    updated: plan.lastAttempt?.updated ?? 0, totalUpdated: plan.items.filter(i => i.status === 'updated').length, reused: plan.lastAttempt?.reused ?? false, alreadyCurrent: plan.items.filter(i => i.status === 'already-current').length,
    ready: plan.items.filter(i => i.status === 'ready').length, failed: plan.items.filter(i => ['failed', 'pending'].includes(i.status)).length,
    preservedDescriptions: plan.items.filter(i => i.status === 'updated' && i.preserveDescription).map(i => i.name),
    needsReview: plan.items.filter(i => ['needs-review', 'manual-merge', 'stage-blocked'].includes(i.status)).length,
    sourceIssues: plan.items.filter(i => ['unresolved', 'untracked', 'uncheckable', 'local-only', 'check-blocked', 'check-failed'].includes(i.status)).length,
    retired: plan.items.filter(i => ['missing-upstream', 'legacy-local'].includes(i.status)).length,
    recovery: plan.recovery ?? null, backup: plan.backup?.root ?? null, timings: plan.timings,
    items: plan.items.map(i => ({ name: i.name, realPath: i.realPath, status: i.status, checkStatus: i.checkStatus, reason: i.reason,
      nextStep: nextStep(i), retryArgs: i.status === 'failed' && i.failurePhase === 'apply' ? ['--plan', plan.planPath, '--apply', '--retry-failed']
        : ['failed', 'pending', 'check-failed', 'check-blocked'].includes(i.status) ? ['--skill', i.name, '--apply'] : null, changedFiles: i.changedFiles ?? [] })) };
}
