import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, symlink, readlink, realpath, lstat, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { prepareUpdate, applyUpdate, summary, loadSavedPlan } from '../scripts/update-workflow.mjs';
import { gitBlobSha, localSnapshot, snapshotDigest } from '../scripts/provenance.mjs';
import { description } from '../scripts/update-payload.mjs';
const cli = fileURLToPath(new URL('../scripts/update-skills.mjs', import.meta.url));
const checker = fileURLToPath(new URL('../scripts/check-installed-skills.mjs', import.meta.url));
const head = 'a'.repeat(40), rootTree = 'b'.repeat(40);
const skill = (name, desc, body) => `---\nname: ${name}\ndescription: "${desc}"\n---\n\n${body}\n`;
async function fixture({ names = ['alpha'], bodyPatch = false, current = false, extra = false } = {}) {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'freshkeeper-update-test-')));
  const library = join(home, '.agents', 'skills'); await mkdir(library, { recursive: true });
  const lock = { version: 3, skills: {}, freshkeeperTracking: {}, dismissed: ['keep'] };
  const requests = {}, entries = [], oldFiles = {};
  for (let i = 0; i < names.length; i++) {
    const name = names[i], folder = (i + 1).toString(16).repeat(40), prefix = `skills/${name}`;
    const base = skill(name, 'original', 'old body'), upstream = skill(name, 'new upstream', 'new body');
    const local = current ? upstream : skill(name, 'my local summary', bodyPatch ? 'custom body' : 'old body');
    const dir = join(library, name); await mkdir(dir); await writeFile(join(dir, 'SKILL.md'), local);
    if (extra) await writeFile(join(dir, 'mine.txt'), 'local extra');
    oldFiles[name] = local;
    lock.skills[name] = { source: 'verified/repository', sourceType: 'github', skillPath: `${prefix}/SKILL.md`, skillFolderHash: folder };
    const oldSha = gitBlobSha(Buffer.from(base)), newSha = gitBlobSha(Buffer.from(upstream));
    const newFolder = (i + 9).toString(16).repeat(40);
    entries.push({ path: prefix, type: 'tree', sha: newFolder }, { path: `${prefix}/SKILL.md`, type: 'blob', sha: newSha, mode: '100644' });
    requests[`https://api.github.com/repos/verified/repository/git/trees/${folder}?recursive=1`] = { json: { sha: folder, tree: [{ path: 'SKILL.md', type: 'blob', sha: oldSha, mode: '100644' }] } };
    requests[`https://api.github.com/repos/verified/repository/git/blobs/${oldSha}`] = { json: { encoding: 'base64', content: Buffer.from(base).toString('base64') } };
    requests[`https://raw.githubusercontent.com/verified/repository/${head}/${prefix}/SKILL.md`] = { base64: Buffer.from(upstream).toString('base64') };
  }
  const tree = { sha: rootTree, commitSha: head, tree: entries };
  requests['https://api.github.com/repos/verified/repository/commits/HEAD'] = { json: { sha: head, commit: { tree: { sha: rootTree } } } };
  requests[`https://api.github.com/repos/verified/repository/git/trees/${rootTree}?recursive=1`] = { json: tree };
  const path = join(home, 'fixture.json'); await writeFile(path, JSON.stringify({ 'verified/repository': tree, $updateRequests: requests }));
  const lockPath = join(home, '.agents', '.skill-lock.json'); await writeFile(lockPath, JSON.stringify(lock));
  const catalog = join(home, 'catalog.json'); await writeFile(catalog, JSON.stringify({ version: 1, repositories: [] }));
  return { home, library, lockPath, fixture: path, catalog, oldFiles, options: { home, fixture: path, catalog, timeoutMs: 10000 } };
}
async function content(c, name = 'alpha') { return readFile(join(c.library, name, 'SKILL.md'), 'utf8'); }

test('preview stages once without changing Skills or source metadata', async () => {
  const c = await fixture(); const before = await readFile(c.lockPath);
  const plan = await prepareUpdate(c.options);
  assert.equal(plan.items[0].status, 'ready'); assert.equal(plan.backup, null);
  assert.equal(await content(c), c.oldFiles.alpha); assert.deepEqual(await readFile(c.lockPath), before);
  assert.equal(plan.items[0].preserveDescription, true);
});
test('one-command update preserves description, advances only a proven base and keeps first tracking baseline', async () => {
  const c = await fixture(); const before = JSON.parse(await readFile(c.lockPath));
  before.freshkeeperTracking[join(c.library, 'alpha')] = { baselineSnapshotHash: 'first-baseline', baselineRecordedAt: 'first-date' };
  await writeFile(c.lockPath, JSON.stringify(before));
  const plan = await prepareUpdate(c.options); await applyUpdate(plan);
  assert.equal(summary(plan).updated, 1); assert.ok((await content(c)).includes('new body'));
  assert.equal(description(await content(c)).block.trim(), 'description: "my local summary"');
  const after = JSON.parse(await readFile(c.lockPath));
  assert.deepEqual(after.dismissed, ['keep']); assert.equal(after.freshkeeperTracking[join(c.library, 'alpha')].baselineSnapshotHash, 'first-baseline');
  assert.equal(await readFile(join(plan.backup.targets[join(c.library, 'alpha')].path, 'SKILL.md'), 'utf8'), c.oldFiles.alpha);
});
test('custom body and unrelated local files are protected rather than refreshed', async () => {
  for (const flags of [{ bodyPatch: true }, { extra: true }]) {
    const c = await fixture(flags); const plan = await prepareUpdate(c.options);
    assert.equal(plan.items[0].status, 'stage-blocked'); await applyUpdate(plan);
    assert.equal(summary(plan).updated, 0); assert.equal(plan.backup, null); assert.equal(await content(c), c.oldFiles.alpha);
  }
});
test('replaying a completed checkpoint performs no second update or backup', async () => {
  const c = await fixture(); const plan = await prepareUpdate(c.options); await applyUpdate(plan);
  const backup = plan.backup.root, meta = await readFile(c.lockPath), data = await content(c);
  const loaded = await loadSavedPlan(plan.planPath, c.home); await applyUpdate(loaded);
  assert.equal(summary(loaded).updated, 0); assert.equal(summary(loaded).totalUpdated, 1); assert.equal(summary(loaded).reused, true);
  assert.equal(loaded.backup.root, backup); assert.deepEqual(await readFile(c.lockPath), meta); assert.equal(await content(c), data);
});
test('partial write failure restores only its Skill; retry reuses the same plan and recovery set', async () => {
  const c = await fixture({ names: ['alpha', 'beta'] }); const plan = await prepareUpdate(c.options);
  let fail = true;
  const copy = async (source, destination) => {
    if (fail && destination.includes('/beta/')) throw new Error('synthetic write failure');
    await writeFile(destination, await readFile(source));
  };
  await applyUpdate(plan, { copy });
  assert.equal(summary(plan).updated, 1); assert.equal(summary(plan).failed, 1);
  assert.equal(await content(c, 'beta'), c.oldFiles.beta);
  const backup = plan.backup.root; fail = false;
  const loaded = await loadSavedPlan(plan.planPath, c.home); await applyUpdate(loaded, { retryFailed: true, copy });
  assert.equal(summary(loaded).updated, 1); assert.equal(summary(loaded).totalUpdated, 2); assert.equal(summary(loaded).failed, 0);
  assert.equal(loaded.backup.root, backup);
});
test('recovery copies preserve the literal value of relative symlinks', async () => {
  const c = await fixture();
  // An ignored runtime directory still belongs in a complete recovery copy.
  await mkdir(join(c.library, 'alpha', 'node_modules')); await writeFile(join(c.library, 'alpha', 'node_modules', 'target'), 'runtime');
  await symlink('target', join(c.library, 'alpha', 'node_modules', 'alias'));
  const plan = await prepareUpdate(c.options); await applyUpdate(plan);
  const saved = plan.backup.targets[join(c.library, 'alpha')].path;
  assert.equal(await readlink(join(saved, 'node_modules', 'alias')), 'target');
  assert.equal(await readlink(join(c.library, 'alpha', 'node_modules', 'alias')), 'target');
});
test('tampered payload blocks its item while healthy items retain their results', async () => {
  const c = await fixture({ names: ['alpha', 'beta'] }); const plan = await prepareUpdate(c.options);
  await writeFile(join(plan.items[0].stage, 'SKILL.md'), 'tampered'); await applyUpdate(plan);
  assert.equal(summary(plan).updated, 1); assert.equal(summary(plan).failed, 1);
  assert.equal(await content(c, 'alpha'), c.oldFiles.alpha);
});
test('metadata changes and changed library aliases stop writes', async () => {
  const c = await fixture(); const plan = await prepareUpdate(c.options);
  await writeFile(c.lockPath, JSON.stringify({ version: 3, skills: {}, preserved: 'new state' }));
  await assert.rejects(applyUpdate(plan), /metadata changed/);
  assert.equal(await content(c), c.oldFiles.alpha); assert.equal(plan.backup, null);
});
test('external plan edits cannot change the owned checkpoint scope', async () => {
  const c = await fixture(); const plan = await prepareUpdate(c.options);
  const tampered = JSON.parse(await readFile(plan.planPath)); tampered.items[0].realPath = '/other/target';
  const path = join(c.home, 'tampered.json'); await writeFile(path, JSON.stringify(tampered));
  await assert.rejects(loadSavedPlan(path, c.home), /scope differs/);
});
test('a signed recent check is reused without invoking the checker again', async () => {
  const c = await fixture(); const path = join(c.home, 'check.json');
  const result = spawnSync(process.execPath, [checker, '--home', c.home, '--fixture', c.fixture, '--provenance-catalog', c.catalog, '--json'], { encoding: 'utf8' });
  assert.ok(result.stdout); await writeFile(path, result.stdout);
  const plan = await prepareUpdate({ ...c.options, fromCheck: path, checkRunner: async () => { throw new Error('Checker should not run again'); } }); assert.equal(plan.items[0].status, 'ready');
  await writeFile(join(c.library, 'alpha', 'SKILL.md'), c.oldFiles.alpha + '\nchanged');
  await assert.rejects(prepareUpdate({ ...c.options, fromCheck: path }), /Local files changed/);
});
test('preview output cannot be placed in a Skill or masquerade as a project lock', async () => {
  const c = await fixture();
  await assert.rejects(prepareUpdate({ ...c.options, writePlan: join(c.library, 'alpha', 'plan.json') }), /outside Skill/);
  await assert.rejects(prepareUpdate({ ...c.options, writePlan: join(c.home, 'freshkeeper.lock.json') }), /outside Skill/);
});
test('nothing current is refreshed, and no backup is created for a no-op run', async () => {
  const c = await fixture({ current: true }); const plan = await prepareUpdate(c.options); await applyUpdate(plan);
  assert.equal(summary(plan).updated, 0); assert.equal(plan.backup, null); assert.equal(summary(plan).ready, 0);
});
test('CLI follows the same bundled pipeline with no global CLI installation', async () => {
  const c = await fixture();
  const result = spawnSync(process.execPath, [cli, '--home', c.home, '--fixture', c.fixture, '--provenance-catalog', c.catalog, '--apply', '--json', '--quiet'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).updated, 1);
});

test('request cache deduplicates concurrent lookups and is reusable across invocations', async () => {
  const { updateClient } = await import('../scripts/update-cache.mjs');
  const cacheDir = await mkdtemp(join(tmpdir(), 'freshkeeper-http-test-'));
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('verified bytes', { status: 200, headers: { 'set-cookie': 'not-recorded' } }); };
  try {
    const client = updateClient({ cacheDir, deadline: Date.now() + 10000 });
    const data = await Promise.all([client.buffer('https://vendor.example/file'), client.buffer('https://vendor.example/file')]);
    assert.equal(calls, 1); assert.equal(data[0].toString(), 'verified bytes');
    globalThis.fetch = async () => { throw new Error('Cache must be reused'); };
    const second = updateClient({ cacheDir, deadline: Date.now() + 10000 });
    assert.equal((await second.buffer('https://vendor.example/file')).toString(), 'verified bytes');
    assert.ok(!(await readFile(join(cacheDir, (await readdir(cacheDir))[0]), 'utf8')).includes('not-recorded'));
  } finally { globalThis.fetch = original; }
});
test('time budget stops before the next write and leaves the verified recovery copy available', async () => {
  const c = await fixture({ names: ['alpha', 'beta'] }); const plan = await prepareUpdate(c.options);
  const clock = Date.now; let virtual = clock(); Date.now = () => virtual;
  const copy = async (source, destination) => { await writeFile(destination, await readFile(source)); virtual += 1000; };
  try { await applyUpdate(plan, { timeoutMs: 500, copy }); } finally { Date.now = clock; }
  assert.ok(summary(plan).failed >= 1); assert.ok(plan.backup);
  for (const item of plan.items) if (item.status === 'failed') assert.equal(await content(c, item.name), c.oldFiles[item.name]);
  const loaded = await loadSavedPlan(plan.planPath, c.home); await applyUpdate(loaded, { retryFailed: true });
  assert.equal(summary(loaded).totalUpdated, 2); assert.equal(summary(loaded).failed, 0);
});
test('a plan cannot be redirected through a library alias into a new subdirectory', async () => {
  const c = await fixture(); await mkdir(join(c.home, '.claude'));
  await symlink(c.library, join(c.home, '.claude', 'skills'));
  await assert.rejects(prepareUpdate({ ...c.options, writePlan: join(c.home, '.claude', 'skills', 'alpha', 'new', 'plan.json') }), /outside Skill/);
  assert.equal(await lstat(join(c.library, 'alpha', 'new')).catch(() => null), null);
});
test('copied agent-local installations are updated independently, with no shared-library migration', async () => {
  const c = await fixture({ names: ['shared'] });
  const one = join(c.home, '.codex', 'skills', 'shared'), two = join(c.home, '.openclaw', 'skills', 'shared');
  await mkdir(dirname(one), { recursive: true }); await mkdir(dirname(two), { recursive: true });
  await rename(join(c.library, 'shared'), one); await mkdir(two);
  await writeFile(join(two, 'SKILL.md'), c.oldFiles.shared.replace('my local summary', 'second local summary'));
  await rm(c.library, { recursive: true });
  const before = JSON.parse(await readFile(c.lockPath));
  const plan = await prepareUpdate(c.options); assert.equal(plan.items.length, 2);
  await applyUpdate(plan); assert.equal(summary(plan).updated, 2);
  const after = JSON.parse(await readFile(c.lockPath));
  assert.equal(after.skills.shared.skillFolderHash, before.skills.shared.skillFolderHash);
  assert.equal(after.freshkeeperTracking[one].skillFolderHash, '9'.repeat(40));
  assert.equal(after.freshkeeperTracking[two].skillFolderHash, '9'.repeat(40));
  assert.ok((await readFile(join(two, 'SKILL.md'), 'utf8')).includes('second local summary'));
  assert.equal(await lstat(c.library).catch(() => null), null);
  const next = await prepareUpdate(c.options); assert.ok(next.items.every(item => item.status === 'local-modified'));
});
test('a malformed source lock is never repaired or widened by an update', async () => {
  const c = await fixture(); await writeFile(c.lockPath, '{broken');
  await assert.rejects(prepareUpdate(c.options), /Cannot read/);
  assert.equal(await readFile(c.lockPath, 'utf8'), '{broken'); assert.equal(await content(c), c.oldFiles.alpha);
});
test('a forged recent-check origin cannot replace the locally evidenced publisher', async () => {
  const c = await fixture();
  const report = spawnSync(process.execPath, [checker, '--home', c.home, '--fixture', c.fixture, '--provenance-catalog', c.catalog, '--json'], { encoding: 'utf8' });
  const changed = JSON.parse(report.stdout); changed.items[0].source = 'other/publisher'; changed.items[0].provenance.source = 'other/publisher';
  const path = join(c.home, 'foreign-check.json'); await writeFile(path, JSON.stringify(changed));
  const plan = await prepareUpdate({ ...c.options, fromCheck: path });
  assert.equal(plan.items[0].status, 'stage-blocked'); await applyUpdate(plan);
  assert.equal(plan.backup, null); assert.equal(await content(c), c.oldFiles.alpha);
});

test('well-known updates validate actual installed bytes and keep publisher digests distinct', async () => {
  const c = await fixture({ current: true });
  const { filesDigest } = await import('../scripts/version-tracking.mjs');
  const original = c.oldFiles.alpha, newer = original.replace('new body', 'newer vendor body');
  const sourceUrl = 'https://vendor.example/.well-known/skills/alpha/SKILL.md';
  const indexUrl = 'https://vendor.example/.well-known/skills/index.json';
  const installed = filesDigest(new Map([['SKILL.md', Buffer.from(original)]]));
  await writeFile(c.lockPath, JSON.stringify({ version: 3, skills: { alpha: { source: 'vendor.example', sourceType: 'well-known', sourceUrl, wellKnownDigest: installed } } }));
  await writeFile(c.fixture, JSON.stringify({ $wellKnown: { [sourceUrl]: { files: { 'SKILL.md': newer } } }, $updateRequests: {
    [indexUrl]: { json: { skills: [{ name: 'alpha', files: ['SKILL.md'] }] } }, [sourceUrl]: { base64: Buffer.from(newer).toString('base64') }
  } }));
  const plan = await prepareUpdate(c.options); assert.equal(plan.items[0].status, 'ready'); await applyUpdate(plan);
  assert.equal(await content(c), newer); assert.equal(summary(plan).updated, 1);
  assert.equal(JSON.parse(await readFile(c.lockPath)).skills.alpha.wellKnownDigest, filesDigest(new Map([['SKILL.md', Buffer.from(newer)]])));
});
test('file deletion is limited to an unchanged managed file and is recoverable after failure', async () => {
  const { applyFiles } = await import('../scripts/update-workflow.mjs');
  const root = await mkdtemp(join(tmpdir(), 'freshkeeper-delete-test-'));
  const target = join(root, 'target'), stage = join(root, 'stage'), backup = join(root, 'backup');
  for (const path of [target, stage, backup]) await mkdir(path);
  await writeFile(join(target, 'old.txt'), 'old'); await writeFile(join(backup, 'old.txt'), 'old');
  await writeFile(join(stage, 'new.txt'), 'new');
  await assert.rejects(applyFiles({ target, stage, backup, original: { 'old.txt': gitBlobSha(Buffer.from('old')) },
    expected: { 'new.txt': gitBlobSha(Buffer.from('new')) }, deadline: Infinity,
    copy: async () => { throw new Error('synthetic copy error'); } }), /synthetic copy/);
  assert.equal(await readFile(join(target, 'old.txt'), 'utf8'), 'old');
  assert.equal(await lstat(join(target, 'new.txt')).catch(() => null), null);
});
test('a missing check signature is rejected instead of guessing a reusable baseline', async () => {
  const c = await fixture(); const report = join(c.home, 'unsigned.json');
  await writeFile(report, JSON.stringify({ items: [] }));
  await assert.rejects(prepareUpdate({ ...c.options, fromCheck: report }), /lacks a metadata signature/);
});
test('changing the pinned commit/tree relationship never crosses the write seam', async () => {
  const c = await fixture(); const data = JSON.parse(await readFile(c.fixture));
  data.$updateRequests['https://api.github.com/repos/verified/repository/commits/HEAD'].json.sha = 'f'.repeat(40);
  await writeFile(c.fixture, JSON.stringify(data));
  const plan = await prepareUpdate(c.options); assert.equal(plan.items[0].status, 'stage-blocked');
  await applyUpdate(plan); assert.equal(plan.backup, null); assert.equal(await content(c), c.oldFiles.alpha);
});
test('the update Skill ships byte-identical shared check helpers', async () => {
  for (const name of ['check-installed-skills.mjs', 'provenance.mjs', 'version-tracking.mjs', 'actions.mjs']) {
    const actual = await readFile(new URL('../scripts/' + name, import.meta.url));
    const source = await readFile(new URL('../../freshkeeper-check/scripts/' + name, import.meta.url));
    assert.deepEqual(actual, source, name);
  }
});

test('historically proven recovered updates remain supported without registering new origins', async () => {
  const c = await fixture(); const data = JSON.parse(await readFile(c.fixture));
  const base = skill('alpha', 'original', 'old body'), oldCommit = 'c'.repeat(40), oldRoot = 'd'.repeat(40);
  await writeFile(join(c.library, 'alpha', 'SKILL.md'), base);
  await writeFile(c.lockPath, JSON.stringify({ version: 3, skills: {} }));
  await writeFile(c.catalog, JSON.stringify({ version: 1, repositories: [{ source: 'verified/repository', skills: { alpha: { path: 'skills/alpha' } } }] }));
  data['verified/repository'].history = [{ commit: oldCommit, sha: oldRoot, tree: [{ type: 'blob', path: 'skills/alpha/SKILL.md', sha: gitBlobSha(Buffer.from(base)) }] }];
  data.$updateRequests[`https://api.github.com/repos/verified/repository/compare/${oldCommit}...${head}`] = { json: { status: 'ahead', merge_base_commit: { sha: oldCommit } } };
  data.$updateRequests[`https://api.github.com/repos/verified/repository/commits/${oldCommit}`] = { json: { sha: oldCommit, commit: { tree: { sha: oldRoot } } } };
  data.$updateRequests[`https://api.github.com/repos/verified/repository/git/trees/${oldRoot}?recursive=1`] = { json: { sha: oldRoot, tree: data['verified/repository'].history[0].tree } };
  await writeFile(c.fixture, JSON.stringify(data));
  const metadata = await readFile(c.lockPath);
  const plan = await prepareUpdate({ ...c.options, history: true }); assert.equal(plan.items[0].checkStatus, 'clean-old');
  await applyUpdate(plan); assert.equal(summary(plan).updated, 1); assert.deepEqual(await readFile(c.lockPath), metadata);
});
test('a proven current subset only adds missing upstream resources', async () => {
  const c = await fixture({ current: true }); const data = JSON.parse(await readFile(c.fixture));
  const guide = Buffer.from('upstream guide');
  data['verified/repository'].tree.push({ type: 'blob', path: 'skills/alpha/references/guide.md', sha: gitBlobSha(guide), mode: '100644' });
  data.$updateRequests[`https://api.github.com/repos/verified/repository/git/trees/${rootTree}?recursive=1`].json = data['verified/repository'];
  data.$updateRequests[`https://raw.githubusercontent.com/verified/repository/${head}/skills/alpha/references/guide.md`] = { base64: guide.toString('base64') };
  await writeFile(c.fixture, JSON.stringify(data));
  const original = await content(c); const plan = await prepareUpdate(c.options);
  assert.equal(plan.items[0].mode, 'current-subset'); await applyUpdate(plan);
  assert.equal(await content(c), original); assert.equal(await readFile(join(c.library, 'alpha', 'references', 'guide.md'), 'utf8'), 'upstream guide');
});

test('one transient staging failure preserves its Skill without blocking another candidate', async () => {
  const c = await fixture({ names: ['alpha', 'beta'] }); const data = JSON.parse(await readFile(c.fixture));
  data.$updateRequests[`https://raw.githubusercontent.com/verified/repository/${head}/skills/alpha/SKILL.md`] = { status: 503 };
  await writeFile(c.fixture, JSON.stringify(data));
  const plan = await prepareUpdate(c.options); assert.equal(plan.items.find(i => i.name === 'alpha').status, 'pending');
  await applyUpdate(plan); assert.equal(summary(plan).updated, 1); assert.equal(await content(c), c.oldFiles.alpha);
  assert.equal(summary(plan).items.find(i => i.name === 'alpha').retryArgs[1], 'alpha');
});
test('changed agent aliases abort before backup or content writes', async () => {
  const c = await fixture(); await mkdir(join(c.home, '.claude'));
  const alias = join(c.home, '.claude', 'skills'); await symlink(c.library, alias);
  const plan = await prepareUpdate(c.options); const other = join(c.home, 'other'); await mkdir(other);
  await rm(alias); await symlink(other, alias);
  await assert.rejects(applyUpdate(plan), /alias changed/);
  assert.equal(plan.backup, null); assert.equal(await content(c), c.oldFiles.alpha);
});
test('a concurrently edited later file is not overwritten by a failed transaction', async () => {
  const { applyFiles } = await import('../scripts/update-workflow.mjs');
  const root = await mkdtemp(join(tmpdir(), 'freshkeeper-concurrency-test-'));
  const target = join(root, 'target'), stage = join(root, 'stage'), backup = join(root, 'backup');
  for (const path of [target, stage, backup]) await mkdir(path);
  for (const name of ['one', 'two']) {
    await writeFile(join(target, name), 'old'); await writeFile(join(backup, name), 'old'); await writeFile(join(stage, name), 'new');
  }
  const copy = async (source, destination) => {
    await writeFile(destination, await readFile(source));
    if (destination.endsWith('/one')) await writeFile(join(target, 'two'), 'other editor');
  };
  const old = Object.fromEntries(['one', 'two'].map(name => [name, gitBlobSha(Buffer.from('old'))]));
  const newer = Object.fromEntries(['one', 'two'].map(name => [name, gitBlobSha(Buffer.from('new'))]));
  await assert.rejects(applyFiles({ target, stage, backup, original: old, expected: newer, deadline: Infinity, copy }), /Local file changed/);
  assert.equal(await readFile(join(target, 'one'), 'utf8'), 'old');
  assert.equal(await readFile(join(target, 'two'), 'utf8'), 'other editor');
});

test('custom permissions are retained while content updates', async () => {
  const { chmod } = await import('node:fs/promises');
  const c = await fixture(); await chmod(join(c.library, 'alpha', 'SKILL.md'), 0o600);
  const plan = await prepareUpdate(c.options); await applyUpdate(plan);
  assert.equal((await lstat(join(c.library, 'alpha', 'SKILL.md'))).mode & 0o777, 0o600);
});
test('an interrupted payload write is recovered from its owned checkpoint', async () => {
  const c = await fixture(); const plan = await prepareUpdate(c.options);
  const preload = join(c.home, 'interrupt.mjs');
  await writeFile(preload, `import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const rename=fs.promises.rename;fs.promises.rename=async(a,b)=>{await rename(a,b);if(b===${JSON.stringify(join(c.library, 'alpha', 'SKILL.md'))})process.exit(77);};syncBuiltinESMExports();`);
  const stopped = spawnSync(process.execPath, ['--import', preload, cli, '--plan', plan.planPath, '--home', c.home, '--apply', '--json'], { encoding: 'utf8' });
  assert.equal(stopped.status, 77);
  const loaded = await loadSavedPlan(plan.planPath, c.home); await applyUpdate(loaded);
  assert.equal(summary(loaded).updated, 1); assert.equal(loaded.recovery.restored, 1); assert.ok((await content(c)).includes('new body'));
});
test('a crash after metadata commit is recognized without updating again', async () => {
  const c = await fixture(); const plan = await prepareUpdate(c.options);
  const preload = join(c.home, 'interrupt-meta.mjs');
  await writeFile(preload, `import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const rename=fs.promises.rename;fs.promises.rename=async(a,b)=>{await rename(a,b);if(b===${JSON.stringify(c.lockPath)})process.exit(78);};syncBuiltinESMExports();`);
  const stopped = spawnSync(process.execPath, ['--import', preload, cli, '--plan', plan.planPath, '--home', c.home, '--apply', '--json'], { encoding: 'utf8' });
  assert.equal(stopped.status, 78);
  const metadata = await readFile(c.lockPath);
  const loaded = await loadSavedPlan(plan.planPath, c.home); await applyUpdate(loaded);
  assert.equal(summary(loaded).updated, 0); assert.equal(summary(loaded).totalUpdated, 1); assert.equal(loaded.recovery.committed, 1);
  assert.deepEqual(await readFile(c.lockPath), metadata);
});
test('metadata commit failure rolls back content and can retry just that failed item', async () => {
  const c = await fixture({ names: ['alpha', 'beta'] }); const plan = await prepareUpdate(c.options);
  const preload = join(c.home, 'fail-meta.mjs');
  await writeFile(preload, `import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const rename=fs.promises.rename;let failed=false;fs.promises.rename=async(a,b)=>{if(!failed&&b===${JSON.stringify(c.lockPath)}){failed=true;throw new Error('synthetic metadata write failed');}return rename(a,b);};syncBuiltinESMExports();`);
  const partial = spawnSync(process.execPath, ['--import', preload, cli, '--plan', plan.planPath, '--home', c.home, '--apply', '--json'], { encoding: 'utf8' });
  assert.equal(partial.status, 1, partial.stderr); assert.equal(JSON.parse(partial.stdout).updated, 1);
  assert.equal(await content(c), c.oldFiles.alpha);
  const loaded = await loadSavedPlan(plan.planPath, c.home); await applyUpdate(loaded, { retryFailed: true });
  assert.equal(summary(loaded).updated, 1); assert.equal(summary(loaded).totalUpdated, 2);
});
test('a retry without a plan and unknown flags fail before creating a full-library job', async () => {
  const c = await fixture(); const old = await readFile(c.lockPath);
  for (const extra of [['--retry-failed', '--apply'], ['--force-overwrite', '--apply']]) {
    const result = spawnSync(process.execPath, [cli, '--home', c.home, ...extra], { encoding: 'utf8' });
    assert.equal(result.status, 1); assert.equal(await lstat(join(c.home, '.agents', 'skill-update-runs')).catch(() => null), null);
  }
  assert.deepEqual(await readFile(c.lockPath), old);
});
