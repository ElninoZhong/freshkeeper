import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile, readdir, readlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, posix } from 'node:path';

const IGNORED_SEGMENTS = new Set(['.git', 'node_modules', '__pycache__']);
const MAX_EVIDENCE_FILES = 6;

function ignored(relativePath) {
  const parts = relativePath.split('/');
  return parts.some((part) => IGNORED_SEGMENTS.has(part))
    || parts.at(-1) === '.DS_Store'
    || relativePath.endsWith('.pyc');
}

function normalizedRelativePath(relativePath) {
  const normalized = relativePath.replaceAll('\\', '/').replace(/^\.\//, '');
  const parts = normalized.split('/');
  if (parts.at(-1)?.toLowerCase() === 'skill.md') parts[parts.length - 1] = 'SKILL.md';
  return parts.join('/');
}

function gitBlobSha(content) {
  const header = Buffer.from(`blob ${content.length}\0`);
  return createHash('sha1').update(header).update(content).digest('hex');
}

function snapshotDigest(snapshot) {
  const rows = [...snapshot.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, sha]) => `${path}\0${sha}\n`);
  return createHash('sha256').update(rows.join('')).digest('hex');
}

async function localSnapshot(root) {
  const snapshot = new Map();
  async function visit(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = normalizedRelativePath(prefix ? `${prefix}/${entry.name}` : entry.name);
      if (ignored(relative)) continue;
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute, relative);
        continue;
      }
      const info = await lstat(absolute);
      const content = info.isSymbolicLink()
        ? Buffer.from(await readlink(absolute))
        : await readFile(absolute);
      snapshot.set(relative, gitBlobSha(content));
    }
  }
  await visit(root);
  return snapshot;
}

function normalizeSkillPath(skillPath) {
  if (!skillPath || skillPath === '.') return '';
  let normalized = skillPath.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
  if (normalized.toLowerCase().endsWith('/skill.md')) normalized = normalized.slice(0, -9);
  else if (normalized.toLowerCase() === 'skill.md') normalized = '';
  return normalized;
}

function remoteSnapshot(tree, skillPath) {
  const prefix = normalizeSkillPath(skillPath);
  const snapshot = new Map();
  for (const entry of tree.tree ?? []) {
    if (entry.type !== 'blob' || !entry.sha) continue;
    if (prefix && entry.path !== prefix && !entry.path.startsWith(`${prefix}/`)) continue;
    const relative = normalizedRelativePath(prefix ? entry.path.slice(prefix.length + 1) : entry.path);
    if (!relative || ignored(relative)) continue;
    snapshot.set(relative, entry.sha);
  }
  return snapshot;
}

function compareSnapshots(local, remote) {
  const localOnly = [];
  const remoteOnly = [];
  const changed = [];
  for (const [path, sha] of local) {
    if (!remote.has(path)) localOnly.push(path);
    else if (remote.get(path) !== sha) changed.push(path);
  }
  for (const path of remote.keys()) {
    if (!local.has(path)) remoteOnly.push(path);
  }
  return {
    exact: localOnly.length === 0 && remoteOnly.length === 0 && changed.length === 0,
    localSubset: localOnly.length === 0 && changed.length === 0,
    remoteSubset: remoteOnly.length === 0 && changed.length === 0,
    localOnly,
    remoteOnly,
    changed
  };
}

function githubRepository(value) {
  if (!value) return null;
  const text = String(value).trim();
  const ssh = text.match(/github\.com:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/i);
  const https = text.match(/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?(?:[\/#?]|$)/i);
  const direct = text.match(/^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/);
  return (ssh?.[1] || https?.[1] || direct?.[1] || null)?.replace(/\.git$/i, '') ?? null;
}

function addCandidate(candidates, candidate) {
  if (!candidate?.source || !/^[^/\s]+\/[^/\s]+$/.test(candidate.source)) return;
  const key = `${candidate.source}#${normalizeSkillPath(candidate.skillPath)}`;
  const existing = candidates.get(key);
  if (!existing || existing.score < candidate.score) {
    candidates.set(key, { ...candidate, skillPath: normalizeSkillPath(candidate.skillPath) });
  } else if (existing) {
    existing.evidence = [...new Set([...(existing.evidence ?? []), ...(candidate.evidence ?? [])])];
  }
}

export async function loadProvenanceCatalog(path) {
  if (!path) return new Map();
  const parsed = JSON.parse(await readFile(path, 'utf8'));
  if (parsed?.version !== 1 || !Array.isArray(parsed.repositories)) {
    throw new Error(`Unsupported provenance catalog: ${path}`);
  }
  const catalog = new Map();
  for (const repository of parsed.repositories) {
    const source = githubRepository(repository.source);
    if (!source || !repository.skills || typeof repository.skills !== 'object') continue;
    for (const [name, raw] of Object.entries(repository.skills)) {
      const value = typeof raw === 'string' ? { path: raw } : raw;
      catalog.set(name, {
        source,
        skillPath: normalizeSkillPath(value.path),
        policy: value.policy ?? null,
        score: 100,
        evidence: ['verified-catalog']
      });
    }
  }
  return catalog;
}

async function evidenceCandidates(skill, catalog) {
  const candidates = new Map();
  for (const key of [skill.name, skill.folder]) {
    if (catalog.has(key)) addCandidate(candidates, catalog.get(key));
  }

  const gitConfig = join(skill.path, '.git', 'config');
  try {
    const config = await readFile(gitConfig, 'utf8');
    const remote = config.match(/\[remote\s+"origin"\][\s\S]*?^\s*url\s*=\s*(.+)$/m)?.[1]?.trim();
    const source = githubRepository(remote);
    if (source) addCandidate(candidates, { source, score: 110, evidence: ['git-remote'] });
  } catch {
    // Most installed Skills are copied directories without embedded Git metadata.
  }

  const evidenceFiles = ['SKILL.md', 'NOTICE.md', 'GITHUB_REPO.md', 'README.md', 'README.en.md', 'README.zh-CN.md'];
  for (const file of evidenceFiles.slice(0, MAX_EVIDENCE_FILES)) {
    let content;
    try {
      content = await readFile(join(skill.path, file), 'utf8');
    } catch {
      continue;
    }
    const metadata = content.match(/^---\s*\n([\s\S]*?)\n---/)?.[1] ?? '';
    for (const match of metadata.matchAll(/^\s*(?:homepage|repository|github|source)\s*:\s*["']?([^\n"']+)/gmi)) {
      const source = githubRepository(match[1]);
      if (source) addCandidate(candidates, { source, score: 95, evidence: [`frontmatter:${file}`] });
    }
    const score = file === 'NOTICE.md' ? 85 : file === 'SKILL.md' ? 75 : 45;
    for (const match of content.matchAll(/(?:https?:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/gi)) {
      addCandidate(candidates, {
        source: match[1].replace(/\.git$/i, ''),
        score,
        evidence: [`${file}:github-url`]
      });
    }
  }
  return [...candidates.values()].sort((left, right) => right.score - left.score).slice(0, 8);
}

function inferSkillPath(tree, skill, candidate) {
  if (candidate.skillPath !== undefined && candidate.skillPath !== null) return normalizeSkillPath(candidate.skillPath);
  const skillFiles = (tree.tree ?? [])
    .filter((entry) => entry.type === 'blob' && entry.path.toLowerCase().endsWith('skill.md'))
    .map((entry) => ({
      file: entry.path,
      folder: posix.dirname(entry.path) === '.' ? '' : posix.dirname(entry.path)
    }));
  const names = new Set([skill.name, skill.folder].map((name) => name.toLowerCase()));
  const named = skillFiles.filter((entry) => names.has(posix.basename(entry.folder).toLowerCase()));
  if (named.length === 1) return named[0].folder;
  const conventional = skillFiles.find((entry) =>
    entry.folder === `skills/${skill.folder}` || entry.folder === `skills/${skill.name}`);
  if (conventional) return conventional.folder;
  const root = skillFiles.filter((entry) => entry.folder === '');
  if (root.length === 1 && candidate.score >= 75) return '';
  return null;
}

async function requestJson(url, token) {
  const headers = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'freshkeeper-provenance'
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
  return response.json();
}

async function fetchCurrentTree(source, token) {
  let lastError;
  for (const ref of ['HEAD', 'main', 'master']) {
    try {
      const data = await requestJson(
        `https://api.github.com/repos/${source}/git/trees/${ref}?recursive=1`,
        token
      );
      if (!data?.sha || !Array.isArray(data.tree) || data.truncated) {
        throw new Error('GitHub returned an incomplete tree');
      }
      return { ...data, ref };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`${source}: ${lastError?.message ?? 'cannot read upstream'}`);
}

function gitTreeSnapshot(repository, commit, skillPath) {
  const prefix = normalizeSkillPath(skillPath);
  const args = ['ls-tree', '-r', commit];
  if (prefix) args.push('--', prefix);
  const output = execFileSync('git', args, {
    cwd: repository,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 20 * 1024 * 1024
  });
  const snapshot = new Map();
  for (const line of output.trim().split('\n')) {
    if (!line) continue;
    const tab = line.indexOf('\t');
    const metadata = line.slice(0, tab).split(' ');
    const fullPath = line.slice(tab + 1);
    const relative = normalizedRelativePath(prefix ? fullPath.slice(prefix.length + 1) : fullPath);
    if (!relative || ignored(relative)) continue;
    snapshot.set(relative, metadata[2]);
  }
  return snapshot;
}

async function findHistoricalMatch({ source, skillPath, local, historyLimit, fixtureRecord, cloneState }) {
  if (Array.isArray(fixtureRecord?.history)) {
    for (const entry of fixtureRecord.history.slice(0, historyLimit)) {
      const relation = compareSnapshots(local, remoteSnapshot(entry, skillPath));
      if (relation.exact || relation.localSubset) return { commit: entry.commit ?? entry.sha, relation };
    }
    return null;
  }
  if (historyLimit <= 0) return null;

  if (!cloneState.root) cloneState.root = await mkdtemp(join(tmpdir(), 'freshkeeper-provenance-'));
  if (!cloneState.repositories.has(source)) {
    const destination = join(cloneState.root, source.replace('/', '__'));
    try {
      execFileSync('git', [
        'clone',
        '--quiet',
        '--filter=blob:none',
        '--bare',
        `https://github.com/${source}.git`,
        destination
      ], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 120_000
      });
      cloneState.repositories.set(source, destination);
    } catch (error) {
      cloneState.repositories.set(source, { error: error.stderr?.trim() || error.message });
    }
  }
  const repository = cloneState.repositories.get(source);
  if (typeof repository !== 'string') return null;

  const args = ['log', '--all', `--max-count=${historyLimit}`, '--format=%H'];
  const prefix = normalizeSkillPath(skillPath);
  if (prefix) args.push('--', prefix);
  const commits = execFileSync('git', args, {
    cwd: repository,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  }).trim().split('\n').filter(Boolean);
  for (const commit of commits) {
    const relation = compareSnapshots(local, gitTreeSnapshot(repository, commit, prefix));
    if (relation.exact || relation.localSubset) return { commit, relation };
  }
  return null;
}

function statusReason(status, relation, baseCommit) {
  switch (status) {
    case 'exact-current': return 'Installed directory exactly matches the current upstream tree';
    case 'current-subset': return `Installed files match upstream; ${relation.remoteOnly.length} upstream file(s) can be added safely`;
    case 'local-extension': return `Upstream is current and ${relation.localOnly.length} local extension file(s) will be preserved`;
    case 'clean-old': return `Installed files match historical upstream commit ${baseCommit?.slice(0, 12)}`;
    case 'legacy-local': return `Installed files match historical commit ${baseCommit?.slice(0, 12)}, but the path is absent upstream`;
    case 'local-ahead': return 'Catalog policy marks this Skill as locally maintained ahead of the published source';
    case 'manual-merge': return 'Local and upstream content both differ; a three-way merge is required';
    case 'missing-upstream': return 'The confirmed repository no longer contains a matching Skill path';
    default: return 'Source recovery did not produce a comparable upstream tree';
  }
}

function ranking(status) {
  return {
    'exact-current': 100,
    'current-subset': 95,
    'local-extension': 90,
    'clean-old': 85,
    'legacy-local': 80,
    'local-ahead': 75,
    'manual-merge': 60,
    'missing-upstream': 30,
    'check-blocked': 10
  }[status] ?? 0;
}

export async function auditProvenance({
  skills,
  catalogPath,
  fixture = null,
  token = '',
  historyLimit = 40
}) {
  const catalog = await loadProvenanceCatalog(catalogPath);
  const currentTrees = new Map();
  const cloneState = { root: null, repositories: new Map() };
  const results = new Map();

  try {
    for (const skill of skills) {
      const local = await localSnapshot(skill.realPath ?? skill.path);
      const candidates = await evidenceCandidates(skill, catalog);
      let best = null;
      const failures = [];
      const rejections = [];
      for (const candidate of candidates) {
        let tree;
        try {
          if (!currentTrees.has(candidate.source)) {
            const fixtureRecord = fixture?.[candidate.source];
            currentTrees.set(candidate.source, fixtureRecord
              ? Promise.resolve(fixtureRecord.current ?? fixtureRecord)
              : fetchCurrentTree(candidate.source, token));
          }
          tree = await currentTrees.get(candidate.source);
        } catch (error) {
          failures.push(`${candidate.source}: ${error.message}`);
          continue;
        }

        const skillPath = inferSkillPath(tree, skill, candidate);
        if (skillPath === null) continue;
        const remote = remoteSnapshot(tree, skillPath);
        const pathExists = remote.size > 0;
        const relation = compareSnapshots(local, remote);
        let status;
        let baseCommit = null;
        let historicalRelation = null;

        if (pathExists && relation.exact) status = 'exact-current';
        else if (candidate.policy === 'local-ahead' && pathExists) status = 'local-ahead';
        else if (pathExists && relation.localSubset) status = 'current-subset';
        else if (pathExists && relation.remoteSubset) status = 'local-extension';
        else {
          const historical = await findHistoricalMatch({
            source: candidate.source,
            skillPath,
            local,
            historyLimit,
            fixtureRecord: fixture?.[candidate.source],
            cloneState
          });
          baseCommit = historical?.commit ?? null;
          historicalRelation = historical?.relation ?? null;
          if (historical && pathExists) status = 'clean-old';
          else if (historical && !pathExists) status = 'legacy-local';
          else if (!pathExists) status = 'missing-upstream';
          else status = 'manual-merge';
        }
        if (candidate.policy === 'manual-merge' && !['exact-current', 'local-extension'].includes(status)) {
          status = 'manual-merge';
        }

        const confidence = candidate.score >= 85 || ranking(status) >= 80 ? 'confirmed' : 'probable';
        if (confidence !== 'confirmed') {
          rejections.push(`${candidate.source}: referenced in local files, but directory content did not confirm it as the Skill source`);
          continue;
        }

        const result = {
          name: skill.name,
          folder: skill.folder,
          source: candidate.source,
          skillPath,
          sourceType: 'github-recovered',
          confidence,
          evidence: candidate.evidence ?? [],
          policy: candidate.policy ?? null,
          status,
          reason: statusReason(status, relation, baseCommit),
          installedSnapshotHash: snapshotDigest(local),
          upstreamTreeHash: tree.sha,
          baseCommit,
          changedFiles: relation.changed,
          localOnlyFiles: relation.localOnly,
          upstreamOnlyFiles: relation.remoteOnly,
          historicalRelation
        };
        if (!best || ranking(result.status) > ranking(best.status)
          || (ranking(result.status) === ranking(best.status) && candidate.score > best.candidateScore)) {
          best = { ...result, candidateScore: candidate.score };
        }
        if (ranking(best.status) >= 95) break;
      }

      if (best) {
        delete best.candidateScore;
        results.set(skill.realPath ?? skill.path, best);
      } else {
        results.set(skill.realPath ?? skill.path, {
          name: skill.name,
          folder: skill.folder,
          source: null,
          skillPath: null,
          sourceType: null,
          confidence: 'unresolved',
          evidence: [],
          policy: null,
          status: failures.length ? 'check-blocked' : 'unresolved',
          reason: failures.length
            ? failures.join('; ')
            : rejections.length
              ? rejections.join('; ')
              : 'No reliable public source evidence was found',
          installedSnapshotHash: snapshotDigest(local),
          upstreamTreeHash: null,
          baseCommit: null,
          changedFiles: [],
          localOnlyFiles: [],
          upstreamOnlyFiles: [],
          historicalRelation: null
        });
      }
    }
  } finally {
    if (cloneState.root) await rm(cloneState.root, { recursive: true, force: true });
  }
  return results;
}

export {
  compareSnapshots,
  gitBlobSha,
  gitTreeSnapshot,
  localSnapshot,
  normalizeSkillPath,
  remoteSnapshot,
  snapshotDigest
};
