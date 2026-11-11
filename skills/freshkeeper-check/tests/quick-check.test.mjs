import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gitBlobSha } from '../scripts/provenance.mjs';
const checker=fileURLToPath(new URL('../scripts/check-installed-skills.mjs',import.meta.url));
const text=name=>`---\nname: ${name}\ndescription: Fixture.\n---\n`;
function run({skills,entries={},tracking={},remote={},extra=[],preload='',live=false}) {
 const home=realpathSync(mkdtempSync(join(tmpdir(),'freshkeeper-quick-test-')));
 const library=join(home,'.agents','skills');mkdirSync(library,{recursive:true});
 for(const [name,files] of Object.entries(skills)) {
  const dir=join(library,name);mkdirSync(dir);
  for(const [name,value] of Object.entries(files))writeFileSync(join(dir,name),value);
 }
 const records={};
 for(const [name,value] of Object.entries(tracking)) {
  const evidence=join(home,`${name}.md`);
  if(!value.missing)writeFileSync(evidence,`${name}: local creation record.`);
  records[join(library,name)]={name,source:'local-authoring',sourceType:'local',sourceStatus:'confirmed',evidence:[evidence]};
 }
 const lock=join(home,'.agents','.skill-lock.json');
 writeFileSync(lock,JSON.stringify({version:3,skills:entries,freshkeeperTracking:records}));
 const before=readFileSync(lock);const fixture=join(home,'remote.json');writeFileSync(fixture,JSON.stringify(remote));
 const catalog=join(home,'catalog.json');writeFileSync(catalog,JSON.stringify({version:1,repositories:[]}));
 const args=[];
 if(preload){const file=join(home,'preload.mjs');writeFileSync(file,preload);args.push('--import',file);}
 args.push(checker,'--home',home,'--provenance-catalog',catalog,'--json','--quiet');
 if(!live)args.push('--fixture',fixture);
 const started=Date.now();const result=spawnSync(process.execPath,[...args,...extra],{encoding:'utf8',timeout:5000});
 assert.ok(result.stdout.trim(),result.stderr);
 const data=JSON.parse(result.stdout);
 assert.deepEqual(readFileSync(lock),before,'ordinary checks modified metadata');
 return {data,result,elapsed:Date.now()-started,home};
}
function githubCase({current='new',local='old',hash='' }={}) {
 const name='revision-fixture',prefix=`skills/${name}`;
 const old=text(name)+local,newer=text(name)+current;
 return {name,old,newer,input:{skills:{[name]:{'SKILL.md':old}},entries:{[name]:{source:'verified/repository',sourceType:'github',skillPath:`${prefix}/SKILL.md`,skillFolderHash:hash}},remote:{'verified/repository':{current:{sha:'a'.repeat(40),commitSha:'b'.repeat(40),tree:[{path:prefix,type:'tree',sha:'f'.repeat(40)},{path:`${prefix}/SKILL.md`,type:'blob',sha:gitBlobSha(Buffer.from(newer))}]},history:[{commit:'c'.repeat(40),tree:[{path:`${prefix}/SKILL.md`,type:'blob',sha:gitBlobSha(Buffer.from(old))}]}]}}}};
}
test('default quick mode does not label an unverified old copy as a proven update',()=>{
 const c=githubCase();const {data}=run(c.input);
 assert.equal(data.mode,'quick');assert.equal(data.historyLimit,0);
 assert.equal(data.items[0].status,'needs-review');assert.equal(data.actions.needsReview.length,1);
 assert.equal(data.updatesAvailable,0);
});
test('explicit history can prove an older clean version',()=>{
 const c=githubCase();const {data}=run({...c.input,extra:['--history']});
 assert.equal(data.mode,'deep');assert.equal(data.items[0].status,'clean-old');
 assert.equal(data.actions.updateCandidates.length,1);
});
test('missing source evidence stays per-item and does not discard a healthy result',()=>{
 const {data,result}=run({skills:{broken:{'SKILL.md':text('broken')},healthy:{'SKILL.md':text('healthy')}},tracking:{broken:{missing:true},healthy:{}}});
 assert.equal(result.status,1);assert.equal(data.items.length,2);
 assert.equal(data.items.find(i=>i.name==='healthy').status,'local-tracked');
 assert.equal(data.items.find(i=>i.name==='broken').status,'check-blocked');
 assert.equal(data.actions.sourceRepairs[0].name,'broken');
});
test('a current registered base with actual local changes preserves the adaptation',()=>{
 const c=githubCase({hash:'f'.repeat(40)});const {data}=run(c.input);
 assert.equal(data.items[0].status,'local-modified');assert.equal(data.updatesAvailable,0);
 assert.equal(data.actions.noAction[0].status,'local-modified');
});
test('verified source does not probe unrelated GitHub links',()=>{
 const c=githubCase();c.input.skills[c.name]['README.md']='Reference: https://github.com/example/unrelated';
 const {result}=run({...c.input,preload:`globalThis.fetch=async()=>{console.error('UNEXPECTED_NETWORK');throw new Error('fixture network access');};`});
 assert.ok(!result.stderr.includes('UNEXPECTED_NETWORK'),result.stderr);
});
test('GitHub sponsor links are not interpreted as source repositories',()=>{
 const {data,result}=run({skills:{unknown:{'SKILL.md':text('unknown'),'README.md':'Sponsor https://github.com/sponsors/example'}},preload:`globalThis.fetch=async()=>{console.error('UNEXPECTED_NETWORK');throw new Error('fixture network access');};`});
 assert.equal(data.items[0].status,'unresolved');assert.equal(data.actions.sourceRepairs.length,1);
 assert.ok(!result.stderr.includes('UNEXPECTED_NETWORK'));
});
test('network budget expiry yields a targeted retry, never a current result',()=>{
 const c=githubCase();
 const {data,elapsed}=run({...c.input,live:true,extra:['--timeout-ms','150'],preload:`globalThis.fetch=(_url,{signal})=>new Promise((_resolve,reject)=>{const hold=setInterval(()=>{},20);const abort=()=>{clearInterval(hold);reject(signal.reason);};if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});});`});
 assert.equal(data.current,0);assert.equal(data.items[0].status,'check-blocked');
 assert.equal(data.actions.retry.length,1);assert.ok(elapsed<2500,`timeout took ${elapsed}ms`);
});

test('two skills from one source reuse the same upstream commit/tree requests',()=>{
 const names=['shared-one','shared-two'];const tree={sha:'a'.repeat(40),tree:names.map(name=>({path:`skills/${name}/SKILL.md`,type:'blob',sha:gitBlobSha(Buffer.from(text(name)+'same'))}))};
 const skills=Object.fromEntries(names.map(name=>[name,{'SKILL.md':text(name)+'same'}]));
 const entries=Object.fromEntries(names.map(name=>[name,{source:'verified/repository',sourceType:'github',skillPath:`skills/${name}/SKILL.md`,skillFolderHash:''}]));
 const preload=`let calls=0;globalThis.fetch=async(url)=>{calls++;return new Response(JSON.stringify(String(url).includes('/commits/')?{sha:'b'.repeat(40),commit:{tree:{sha:'a'.repeat(40)}}}:${JSON.stringify(tree)}),{status:200});};process.on('exit',()=>console.error('SOURCE_CALLS:'+calls));`;
 const {data,result}=run({skills,entries,preload,live:true});
 assert.equal(data.items.filter(i=>i.status==='exact-current').length,2);
 assert.match(result.stderr,/SOURCE_CALLS:2(?:\n|$)/);
});

test('an upstream removal is an actionable state rather than a program failure',()=>{
 const c=githubCase();c.input.remote['verified/repository'].current.tree=[];
 const {data,result}=run(c.input);
 assert.equal(data.items[0].status,'missing-upstream');assert.equal(data.retired,1);
 assert.equal(data.errors,0);assert.equal(data.actions.retired.length,1);assert.equal(result.status,0);
});

test('history fixtures never fall through to a real Git clone',()=>{
 const c=githubCase();delete c.input.remote['verified/repository'].history;
 const preload=`import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';const exec=cp.execFileSync;cp.execFileSync=(cmd,...args)=>{if(cmd==='git'){console.error('UNEXPECTED_GIT');throw new Error('Real Git forbidden in fixture test');}return exec(cmd,...args);};syncBuiltinESMExports();`;
 const {data,result}=run({...c.input,extra:['--history'],preload});
 assert.equal(data.items[0].status,'manual-merge');assert.ok(!result.stderr.includes('UNEXPECTED_GIT'));
});
