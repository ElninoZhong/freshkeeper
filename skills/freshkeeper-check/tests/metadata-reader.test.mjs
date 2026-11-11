import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gitBlobSha } from '../scripts/provenance.mjs';
import { declaredVersion } from '../scripts/version-tracking.mjs';
import { fileURLToPath } from 'node:url';
const checker=fileURLToPath(new URL('../scripts/check-installed-skills.mjs',import.meta.url));
function fixture(name, entry, tracking) {
 const home=mkdtempSync(join(tmpdir(),'freshkeeper-reader-test-'));
 const dir=join(home,'.agents','skills',name); mkdirSync(dir,{recursive:true});
 const text=`---\nname: ${name}\ndescription: Reader regression fixture.\n---\n# Fixture\n`;
 writeFileSync(join(dir,'SKILL.md'),text);
 const evidence=join(home,'evidence.md'); writeFileSync(evidence,`${name}: verified local creation fixture.`);
 const lock={version:3,skills:{[name]:entry},freshkeeperTracking:tracking?{[realpathSync(dir)]:{name,...(typeof tracking==='object'?tracking:{sourceType:'local',source:'local-authoring',sourceStatus:'confirmed',evidence:[evidence]})}}:{}};
 writeFileSync(join(home,'.agents','.skill-lock.json'),JSON.stringify(lock));
 const remote={'verified/repository':{sha:'a'.repeat(40),commitSha:'b'.repeat(40),tree:[{path:`skills/${name}/SKILL.md`,type:'blob',sha:gitBlobSha(Buffer.from(text))}]}};
 const remotePath=join(home,'remote.json');writeFileSync(remotePath,JSON.stringify(remote));
 const catalog=join(home,'catalog.json');writeFileSync(catalog,JSON.stringify({version:1,repositories:[]}));
 const result=spawnSync(process.execPath,[checker,'--home',home,'--fixture',remotePath,'--provenance-catalog',catalog,'--no-history','--json'],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 return JSON.parse(result.stdout).items[0];
}
test('recorded GitHub source works without inventing installed Git revision',()=>{
 const name='recorded-source-fixture';
 const item=fixture(name,{source:'verified/repository',sourceType:'github',skillPath:`skills/${name}/SKILL.md`,skillFolderHash:''},false);
 assert.equal(item.status,'exact-current');assert.equal(item.source,'verified/repository');
});
test('legacy local source can reuse verified local authorship tracking',()=>{
 const item=fixture('local-source-fixture',{source:'local',sourceType:'local'},true);
 assert.equal(item.status,'local-tracked');
});
test('declared version reads metadata.version separately from content identity',()=>{
 assert.equal(declaredVersion('---\nname: fixture\nmetadata:\n  version: "6.9.0"\n  publisher: example\n---\n'), '6.9.0');
 assert.equal(declaredVersion('---\nname: fixture\nversion: "1.0"\n---\n'), '1.0');
 assert.equal(declaredVersion('---\nname: fixture\nother:\n  version: "not-skill-version"\n---\n'), null);
});

test('per-path confirmed public source is reusable without a CLI install baseline',()=>{
 const name='tracked-public-source-fixture';
 const item=fixture(name,undefined,{source:'verified/repository',sourceType:'github-recovered',sourceStatus:'confirmed',skillPath:`skills/${name}/SKILL.md`});
 assert.equal(item.status,'exact-current');
});
test('unknown installed Git baseline stays out of automatic CLI update entries',async()=>{
 const {fillMetadata}=await import('../scripts/version-tracking.mjs');
 const {localSnapshot,snapshotDigest}=await import('../scripts/provenance.mjs');
 const home=mkdtempSync(join(tmpdir(),'freshkeeper-metadata-test-'));
 const name='metadata-only-source-fixture';const dir=join(home,name);mkdirSync(dir);
 writeFileSync(join(dir,'SKILL.md'),`---\nname: ${name}\n---\nLocal adaptation.\n`);
 const lock={version:3,skills:{},freshkeeperTracking:{}};const original=JSON.stringify(lock);
 const lockPath=join(home,'lock.json');writeFileSync(lockPath,original);
 const hash=snapshotDigest(await localSnapshot(dir));
 const item={name,realPath:dir,source:'verified/repository',sourceType:'github-recovered',confidence:'confirmed',skillPath:`skills/${name}`,status:'manual-merge',installedSnapshotHash:hash,installedVersion:`sha256:${hash}`};
 await fillMetadata({items:[item],lock,lockPath,original,apply:true});
 const {readFileSync}=await import('node:fs');const saved=JSON.parse(readFileSync(lockPath,'utf8'));
 assert.equal(saved.skills[name],undefined);
 assert.equal(saved.freshkeeperTracking[dir].source,'verified/repository');
 assert.equal(saved.freshkeeperTracking[dir].sourceStatus,'confirmed');
});
