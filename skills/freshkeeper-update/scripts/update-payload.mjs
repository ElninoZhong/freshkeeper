import { readFile, mkdir, writeFile, chmod, lstat } from 'node:fs/promises';
import { join, resolve, dirname, sep, posix } from 'node:path';
import { gitBlobSha, localSnapshot, compareSnapshots, normalizeSkillPath } from './provenance.mjs';
import { filesDigest } from './version-tracking.mjs';

export function description(text) {
  const frame = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frame) throw new Error('Missing SKILL.md frontmatter');
  const lines = frame[1].match(/[^\n]*(?:\n|$)/g).filter(Boolean);
  let offset = frame[0].indexOf(frame[1]);
  for (let i = 0; i < lines.length; i++) {
    if (/^description\s*:/.test(lines[i])) {
      let j = i + 1;
      while (j < lines.length && (!lines[j].trim() || /^[ \t]/.test(lines[j]))) j++;
      const block = lines.slice(i, j).join(''), end = offset + block.length;
      return { block, start: offset, end, without: text.slice(0, offset) + text.slice(end) };
    }
    offset += lines[i].length;
  }
  throw new Error('Missing description field');
}
export function preserveDescription(upstream, local) {
  const a = description(upstream), b = description(local);
  const ending = a.block.endsWith('\r\n') ? '\r\n' : a.block.endsWith('\n') ? '\n' : '';
  return upstream.slice(0, a.start) + b.block.replace(/[\r\n]+$/, '') + ending + upstream.slice(a.end);
}
export function safeRelative(path) {
  if (!path || path.startsWith('/') || path.includes('\\') || path.includes('\0')
    || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Unsafe upstream path');
  return path;
}
const ignored = path => path.split('/').some(x => ['.git', 'node_modules', '__pycache__'].includes(x))
  || path.endsWith('.pyc') || posix.basename(path) === '.DS_Store';
export function treeFiles(tree, prefix = '') {
  if (!tree?.sha || !Array.isArray(tree.tree) || tree.truncated) throw new Error('Incomplete upstream tree');
  const entries = new Map();
  for (const entry of tree.tree) {
    if (prefix && !entry.path.startsWith(prefix + '/')) continue;
    if (entry.type === 'commit') throw new Error('Submodules require separate review');
    if (entry.type !== 'blob') continue;
    let relative = safeRelative(prefix ? entry.path.slice(prefix.length + 1) : entry.path);
    if (ignored(relative)) continue;
    if (posix.basename(relative).toLowerCase() === 'skill.md') relative = relative.replace(/skill\.md$/i, 'SKILL.md');
    if (entries.has(relative)) throw new Error('Normalized path collision');
    entries.set(relative, { ...entry, relative });
  }
  return entries;
}
function same(a, b) { return a.size === b.size && [...a].every(([path, sha]) => b.get(path) === sha); }
export async function stageItem(item, entry, client, stage, deadline) {
  const local = await localSnapshot(item.realPath);
  const originalModes = {}, originalTypes = {}, customModes = {};
  for (const path of local.keys()) {
    const info = await lstat(join(item.realPath, path));
    originalModes[path] = info.mode & 0o777; originalTypes[path] = info.isSymbolicLink() ? 'symlink' : 'file';
  }
  const rememberModes = baseFiles => {
    for (const path of local.keys()) {
      const e = baseFiles.get(path);
      if (!e) continue;
      if ((e.mode === '120000') !== (originalTypes[path] === 'symlink')) throw new Error('Local file type changed');
      if (originalTypes[path] === 'file' && originalModes[path] !== (e.mode === '100755' ? 0o755 : 0o644)) customModes[path] = originalModes[path];
    }
  };
  const provenance = item.provenance ?? item;
  let content = new Map(), sourceFiles = new Map(), base = null, mode, preserve = false, folderHash = null;
  if (item.sourceType === 'well-known') {
    if (item.status !== 'update-available' || !entry?.wellKnownDigest || item.localDigest !== entry.wellKnownDigest)
      throw new Error('Well-known installed directory digest is not a proven update base');
    const sourceUrl = new URL(entry.sourceUrl);
    const match = sourceUrl.pathname.match(/^(.*\/\.well-known\/(?:skills|agent-skills)\/)([^/]+)\/SKILL\.md$/i);
    if (sourceUrl.protocol !== 'https:' || sourceUrl.username || sourceUrl.password || sourceUrl.search || sourceUrl.hash
      || !match || decodeURIComponent(match[2]) !== item.name) throw new Error('Invalid official source identity');
    const localFiles = new Map();
    for (const path of local.keys()) {
      if ((await lstat(join(item.realPath, path))).isSymbolicLink()) throw new Error('Local symbolic source needs separate review');
      localFiles.set(path, await readFile(join(item.realPath, path)));
    }
    if (filesDigest(localFiles) !== entry.wellKnownDigest) throw new Error('Actual local files do not match the installed digest');
    const index = await client.json(sourceUrl.origin + match[1] + 'index.json');
    const record = index.skills?.find(x => x.name === item.name);
    if (!Array.isArray(record?.files) || record.files.length > 2000 || !record.files.includes('SKILL.md') || new Set(record.files).size !== record.files.length) throw new Error('Invalid official file list');
    const directory = new URL('./', entry.sourceUrl);
    for (const path of record.files) content.set(safeRelative(path), await client.buffer(new URL(path, directory).href));
    if (filesDigest(content) !== item.upstreamDigest) throw new Error('Official payload changed after check');
    Object.assign(customModes, originalModes);
    mode = 'well-known';
    sourceFiles = new Map([...content].map(([path, data]) => [path, { sha: gitBlobSha(data), mode: '100644' }]));
  } else {
    const source = item.source;
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source ?? '')) throw new Error('No evidenced GitHub source');
    const commit = provenance.upstreamVersion?.replace(/^git:/, '');
    if (!/^[0-9a-f]{40}$/i.test(commit ?? '')) throw new Error('No pinned upstream commit');
    const api = `https://api.github.com/repos/${source}`;
    const head = await client.json(`${api}/commits/${encodeURIComponent(entry?.ref ?? 'HEAD')}`);
    if (head.sha !== commit || head.commit?.tree?.sha !== provenance.upstreamTreeHash) throw new Error('Upstream changed since the check; recheck only this Skill');
    const currentTree = await client.json(`${api}/git/trees/${provenance.upstreamTreeHash}?recursive=1`);
    if (currentTree.sha !== provenance.upstreamTreeHash) throw new Error('Unexpected upstream Git tree identity');
    const prefix = normalizeSkillPath(provenance.skillPath ?? entry?.skillPath);
    sourceFiles = treeFiles(currentTree, prefix);
    folderHash = prefix ? currentTree.tree.find(e => e.type === 'tree' && e.path === prefix)?.sha : currentTree.sha;
    if (!sourceFiles.has('SKILL.md') || !folderHash) throw new Error('Upstream Skill directory is missing');
    const current = new Map([...sourceFiles].map(([path, e]) => [path, e.sha]));
    if (item.status === 'current-subset') {
      if (!compareSnapshots(local, current).localSubset) throw new Error('Installed files are not an upstream subset');
      rememberModes(sourceFiles);
      mode = 'current-subset';
    } else if (item.status === 'clean-old') {
      if (!/^[0-9a-f]{40}$/i.test(provenance.baseCommit ?? '')) throw new Error('Invalid historical commit identity');
      const ancestry = await client.json(`${api}/compare/${provenance.baseCommit}...${commit}`);
      if (!['ahead', 'identical'].includes(ancestry.status) || ancestry.merge_base_commit?.sha !== provenance.baseCommit) throw new Error('Historical base is not established on the selected publisher history');
      const oldCommit = await client.json(`${api}/commits/${provenance.baseCommit}`);
      const oldTree = await client.json(`${api}/git/trees/${oldCommit.commit.tree.sha}?recursive=1`);
      const historicalFiles = treeFiles(oldTree, prefix);
      rememberModes(historicalFiles);
      base = new Map([...historicalFiles].map(([path, e]) => [path, e.sha]));
      if (!compareSnapshots(local, base).localSubset) throw new Error('Historical base does not match installed files');
      mode = 'clean-old';
    } else {
      if (item.status !== 'needs-review' || entry?.sourceType !== 'github' || entry.source !== source
        || !/^[0-9a-f]{40}$/i.test(entry.skillFolderHash ?? '')) throw new Error('No proven recorded Git installation base');
      const oldTree = await client.json(`${api}/git/trees/${entry.skillFolderHash}?recursive=1`);
      if (oldTree.sha !== entry.skillFolderHash) throw new Error('Recorded Git base identity mismatch');
      const oldFiles = treeFiles(oldTree);
      base = new Map([...oldFiles].map(([path, e]) => [path, e.sha]));
      if (local.size !== base.size || [...local.keys()].some(path => !base.has(path))) throw new Error('Local extra or missing files require a separate merge');
      if ([...local].some(([path, sha]) => path !== 'SKILL.md' && base.get(path) !== sha)) throw new Error('Local files changed beyond the description');
      const oldSkill = oldFiles.get('SKILL.md');
      if (!oldSkill) throw new Error('Recorded base has no SKILL.md');
      const blob = await client.json(`${api}/git/blobs/${oldSkill.sha}`);
      const oldText = Buffer.from(blob.content, 'base64');
      if (gitBlobSha(oldText) !== oldSkill.sha) throw new Error('Recorded SKILL blob mismatch');
      rememberModes(oldFiles);
      const localText = await readFile(join(item.realPath, 'SKILL.md'), 'utf8');
      if (description(oldText.toString()).without !== description(localText).without) throw new Error('Local SKILL body or other metadata changed');
      preserve = description(oldText.toString()).block.replace(/[\r\n]+$/, '') !== description(localText).block.replace(/[\r\n]+$/, '');
      mode = 'recorded-description';
    }
    if ([...sourceFiles.keys()].some(path => path.endsWith('/SKILL.md') && !local.has(path))) throw new Error('New nested Skills require explicit installation scope');
    for (const [path, e] of sourceFiles) {
      if (Date.now() >= deadline) throw new Error('Update time budget exceeded');
      const url = `https://raw.githubusercontent.com/${source}/${commit}/${e.path.split('/').map(encodeURIComponent).join('/')}`;
      const bytes = await client.buffer(url);
      if (gitBlobSha(bytes) !== e.sha) throw new Error(`Upstream blob mismatch: ${path}`);
      content.set(path, bytes);
    }
    if (preserve) content.set('SKILL.md', Buffer.from(preserveDescription(content.get('SKILL.md').toString(), await readFile(join(item.realPath, 'SKILL.md'), 'utf8'))));
  }
  const skill = content.get('SKILL.md')?.toString();
  const header = skill?.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const name = header?.[1].match(/^name:\s*["']?([^\n"']+)["']?\s*$/m)?.[1]?.trim();
  if (name !== item.name) throw new Error('Upstream changed the Skill name');
  description(skill);
  await mkdir(stage, { recursive: true, mode: 0o700 });
  const expectedModes = {};
  for (const [path, bytes] of content) {
    const destination = resolve(stage, safeRelative(path));
    if (!destination.startsWith(resolve(stage) + sep)) throw new Error('Stage path escaped its root');
    if (sourceFiles.get(path)?.mode === '120000') throw new Error('Symbolic upstream payloads require separate review');
    await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, bytes);
    expectedModes[path] = customModes[path] ?? (sourceFiles.get(path)?.mode === '100755' ? 0o755 : 0o644);
    await chmod(destination, expectedModes[path]);
  }
  const expected = new Map([...content].map(([path, bytes]) => [path, gitBlobSha(bytes)]));
  if (!same(await localSnapshot(stage), expected)) throw new Error('Staged payload verification failed');
  const changes = [...new Set([...local.keys(), ...expected.keys()])].filter(path => local.get(path) !== expected.get(path)
    || originalModes[path] !== expectedModes[path]);
  return { ...item, status: 'ready', mode, stage, originalFiles: Object.fromEntries(local), expectedFiles: Object.fromEntries(expected),
    changedFiles: changes, originalModes, originalTypes, expectedModes, preserveDescription: preserve, newFolderHash: folderHash, sourceFiles: Object.fromEntries(sourceFiles), pinned: { source: item.source,
      commit: provenance.upstreamVersion?.replace(/^git:/, ''), tree: provenance.upstreamTreeHash, skillPath: provenance.skillPath } };
}
