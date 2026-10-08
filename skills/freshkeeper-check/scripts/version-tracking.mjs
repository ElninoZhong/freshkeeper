import { createHash } from 'node:crypto';
import { copyFile, readFile, writeFile, rename, stat, realpath, rm, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { localSnapshot, snapshotDigest, gitBlobSha, compareSnapshots } from './provenance.mjs';

export function declaredVersion(markdown) {
  const frontmatter = markdown.match(/^---\s*\n([\s\S]*?)\n---/)?.[1];
  return frontmatter?.match(/^version:\s*["']?([^\n"']+)["']?\s*$/m)?.[1]?.trim() ?? null;
}

export function filesDigest(files) {
  const hash = createHash('sha256');
  for (const path of [...files.keys()].sort()) {
    hash.update(path); hash.update('\0'); hash.update(files.get(path)); hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

function safeFile(path) {
  return typeof path === 'string' && path.length > 0 && !path.startsWith('/')
    && !path.includes('\\') && !path.includes('\0') && !path.includes('%')
    && path.split('/').every(part => part && part !== '.' && part !== '..')
    && !/[?#]/.test(path);
}

async function request(url, json = false) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  const content = Buffer.from(await response.arrayBuffer());
  if (content.length > 20 * 1024 * 1024) throw new Error(`Oversized response: ${url}`);
  return json ? JSON.parse(content.toString('utf8')) : content;
}

async function pool(values, action, concurrency = 8) {
  let cursor = 0;
  const result = new Array(values.length);
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      result[index] = await action(values[index]);
    }
  }));
  return result;
}

export function wellKnownChecker(fixture = null) {
  const indexes = new Map();
  return async function check(skill, entry) {
    const local = await localSnapshot(skill.realPath);
    const installedSnapshotHash = snapshotDigest(local);
    const base = { installedSnapshotHash, installedVersion: `sha256:${installedSnapshotHash}` };
    try {
      const source = new URL(entry.sourceUrl);
      if (source.protocol !== 'https:' || source.username || source.password || source.search || source.hash)
        throw new Error('Well-known source must be a plain HTTPS URL');
      const match = source.pathname.match(/^(.*\/\.well-known\/(?:skills|agent-skills)\/)([^/]+)\/SKILL\.md$/i);
      if (!match || decodeURIComponent(match[2]) !== skill.name) throw new Error('Source URL does not identify this Skill');
      const indexUrl = `${source.origin}${match[1]}index.json`;
      const directoryUrl = `${source.origin}${match[1]}${encodeURIComponent(skill.name)}/`;
      let files, officialVersion = null;
      if (fixture) {
        const record = fixture.$wellKnown?.[entry.sourceUrl];
        if (!record?.files) throw new Error(`Fixture has no well-known Skill: ${skill.name}`);
        files = new Map(Object.entries(record.files).map(([path, text]) => [path, Buffer.from(text)]));
        officialVersion = record.version ?? null;
      } else {
        if (!indexes.has(indexUrl)) indexes.set(indexUrl, request(indexUrl, true));
        const index = await indexes.get(indexUrl);
        const entries = index.skills?.filter(value => value.name === skill.name) ?? [];
        if (entries.length !== 1) throw new Error('Official index has no unique matching Skill');
        const record = entries[0];
        // Legacy file-list indexes expose no semantic version. Never use the protocol version as a Skill version.
        if (!Array.isArray(record.files)) throw new Error('Index format has no comparable file list');
        if (record.files.length > 2000 || !record.files.includes('SKILL.md')
          || new Set(record.files).size !== record.files.length || !record.files.every(safeFile))
          throw new Error('Official index contains an unsafe or incomplete file list');
        officialVersion = typeof record.version === 'string' ? record.version : null;
        const contents = await pool(record.files, async path => [path, await request(new URL(path, directoryUrl).href)]);
        files = new Map(contents);
      }
      if (![...files.keys()].every(safeFile) || !files.has('SKILL.md')) throw new Error('Unsafe or incomplete upstream files');
      const remote = new Map([...files].map(([path, data]) => [path, gitBlobSha(data)]));
      const relation = compareSnapshots(local, remote);
      const upstreamDigest = filesDigest(files);
      const localFiles = new Map(await Promise.all([...local.keys()].map(async path => [path, await readFile(join(skill.realPath, path))])));
      const localDigest = filesDigest(localFiles);
      officialVersion ??= declaredVersion(files.get('SKILL.md').toString('utf8'));
      let status;
      if (relation.exact) status = 'exact-current';
      else if (relation.localSubset) status = 'current-subset';
      else if (relation.remoteSubset) status = 'local-extension';
      else if (entry.wellKnownDigest === localDigest) status = 'update-available';
      else status = 'manual-merge';
      return { ...base, status, source: entry.source, sourceType: 'well-known',
        reason: relation.exact ? 'Whole installed directory matches the official file list'
          : status === 'update-available' ? 'Local files match the recorded installed digest; official contents changed'
          : status === 'current-subset' ? 'Installed files match; official resources are missing locally'
          : status === 'local-extension' ? 'Official contents match; preserve additional local files'
          : 'Installed and official content differ; preserve local changes and merge manually',
        sourceUrl: entry.sourceUrl, upstreamVersion: officialVersion ?? upstreamDigest,
        upstreamVersionKind: officialVersion ? 'declared' : 'content-digest',
        installedDeclaredVersion: declaredVersion((await readFile(join(skill.realPath, 'SKILL.md'), 'utf8'))),
        upstreamDigest, localDigest, remoteHash: upstreamDigest,
        changedFiles: relation.changed, localOnlyFiles: relation.localOnly, upstreamOnlyFiles: relation.remoteOnly,
        versionEvidence: { indexUrl, fileCount: files.size, algorithm: 'sha256(sorted path + NUL + bytes + NUL)' }
      };
    } catch (error) {
      return { ...base, status: 'check-failed', reason: `Well-known comparison failed: ${error.message}` };
    }
  };
}

export async function describeInstalled(item, previous) {
  const hash = snapshotDigest(await localSnapshot(item.realPath));
  const version = declaredVersion(await readFile(join(item.realPath, 'SKILL.md'), 'utf8'));
  return { ...item, installedSnapshotHash: hash, installedVersion: `sha256:${hash}`,
    installedDeclaredVersion: version, metadataTracked: Boolean(previous),
    baselineSnapshotHash: previous?.baselineSnapshotHash ?? null,
    localDrift: previous ? previous.baselineSnapshotHash !== hash : null };
}

export async function fillMetadata({ items, lock, lockPath, original, apply = false }) {
  const now = new Date().toISOString();
  const next = structuredClone(lock);
  if (original === null && next.version === 0) next.version = 3;
  next.freshkeeperTracking ??= {};
  const actions = [];
  for (const item of items) {
    const old = next.freshkeeperTracking[item.realPath];
    const confirmed = Boolean(item.sourceType) && !['check-blocked', 'check-failed', 'unresolved', 'untracked'].includes(item.status);
    const record = { ...old, name: item.name, realPath: item.realPath,
      sourceStatus: confirmed ? 'confirmed' : old?.sourceStatus ?? 'unknown',
      source: item.source ?? old?.source ?? null, sourceType: item.sourceType ?? old?.sourceType ?? null,
      sourceUrl: item.sourceUrl ?? old?.sourceUrl ?? null, sourcePath: item.sourcePath ?? old?.sourcePath ?? null, skillPath: item.skillPath ?? old?.skillPath ?? null,
      evidence: item.evidence ?? old?.evidence ?? [],
      baselineSnapshotHash: old?.baselineSnapshotHash ?? item.installedSnapshotHash,
      observedSnapshotHash: item.installedSnapshotHash,
      installedDeclaredVersion: item.installedDeclaredVersion ?? null,
      upstreamVersion: item.upstreamVersion ?? null,
      upstreamVersionKind: item.upstreamVersionKind ?? null,
      versionEvidence: item.versionEvidence ?? null,
      upstreamDigest: item.upstreamDigest ?? null,
      baselineRecordedAt: old?.baselineRecordedAt ?? now, checkedAt: now };
    next.freshkeeperTracking[item.realPath] = record;
    // Recovered Git sources become ordinary CLI-compatible entries only when the name has a single physical installation.
    if (item.sourceType === 'github-recovered' && item.confidence === 'confirmed'
      && !next.skills[item.name] && items.filter(value => value.name === item.name).length === 1) {
      next.skills[item.name] = { source: item.source, sourceType: 'github',
        sourceUrl: `https://github.com/${item.source}`, skillPath: `${item.skillPath ? item.skillPath + '/' : ''}SKILL.md`,
        skillFolderHash: '', provenanceRecordedAt: now };
    }
    actions.push({ name: item.name, realPath: item.realPath, sourceStatus: record.sourceStatus,
      installedVersion: item.installedVersion, upstreamVersion: record.upstreamVersion });
  }
  if (!apply) return { mode: 'preview', lockPath, actions };
  // Revalidate both the lock and every selected physical directory before crossing the write seam.
  if (await readFile(lockPath, 'utf8').catch(error => error.code === 'ENOENT' ? null : Promise.reject(error)) !== original)
    throw new Error('Lock changed during the check; metadata was not written');
  for (const item of items) {
    if (snapshotDigest(await localSnapshot(item.realPath)) !== item.installedSnapshotHash)
      throw new Error(`Skill changed during the check: ${item.name}`);
  }
  const target = await realpath(lockPath).catch(error => error.code === 'ENOENT' ? lockPath : Promise.reject(error));
  await mkdir(dirname(target), { recursive: true });
  const backupPath = `${target}.freshkeeper-backup-${Date.now()}`;
  if (original !== null) {
    await copyFile(target, backupPath);
    if (await readFile(backupPath, 'utf8') !== original) throw new Error('Metadata backup did not verify');
  }
  const temporary = `${target}.freshkeeper-${process.pid}.tmp`;
  try {
    const mode = await stat(target).then(value => value.mode & 0o777).catch(() => 0o600);
    await writeFile(temporary, JSON.stringify(next, null, 2) + '\n', { flag: 'wx', mode });
    if (await readFile(target, 'utf8').catch(error => error.code === 'ENOENT' ? null : Promise.reject(error)) !== original)
      throw new Error('Lock changed before commit; metadata was not written');
    await rename(temporary, target);
  } finally { await rm(temporary, { force: true }); }
  return { mode: 'applied', lockPath, backupPath: original === null ? null : backupPath, actions };
}

// Explicit evidence maps are for personal/local and application-bundled Skills only.
// Public Git provenance still goes through the official-tree audit.
export async function applySourceEvidence(items, sourceMap, tracking = {}) {
  for (const item of items) {
    if (item.sourceType) continue;
    const candidate = sourceMap?.[item.name] ?? tracking[item.realPath];
    if (!candidate || !['local', 'bundled'].includes(candidate.sourceType)) continue;
    if (!Array.isArray(candidate.evidence) || !candidate.evidence.length) throw new Error(`Missing source evidence: ${item.name}`);
    for (const path of candidate.evidence) {
      const content = await readFile(path, 'utf8');
      if (!content.includes(item.name)) throw new Error(`Evidence does not identify ${item.name}: ${path}`);
    }
    item.source = candidate.source;
    item.sourceType = candidate.sourceType;
    item.sourcePath = candidate.sourcePath ?? null;
    item.evidence = candidate.evidence;
    item.confidence = 'confirmed';
    if (candidate.sourceType === 'local') {
      item.status = 'local-tracked';
      item.reason = 'Local authorship is evidenced; track a content revision without inventing a public release version';
    } else {
      const remote = await localSnapshot(candidate.sourcePath);
      if (!remote.has('SKILL.md')) throw new Error(`Bundled source has no SKILL.md: ${item.name}`);
      const local = await localSnapshot(item.realPath);
      const relation = compareSnapshots(local, remote);
      item.status = relation.exact ? 'bundled-current' : 'manual-merge';
      item.reason = relation.exact ? 'Installed directory matches the application-bundled Skill'
        : 'Application-bundled Skill differs; preserve local modifications';
      item.upstreamVersion = `sha256:${snapshotDigest(remote)}`;
      item.upstreamVersionKind = 'content-digest';
      item.versionEvidence = { sourcePath: candidate.sourcePath, fileCount: remote.size };
    }
  }
}
