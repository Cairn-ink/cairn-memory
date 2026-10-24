import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, readFileSync, writeFileSync, unlinkSync, renameSync, mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { hostFixture } from './fixtures/local-host-workspace.mjs';
import { createLocalRawHost, withLocalHostDependencies } from '../raw/local-host.mjs';
import { withWriteObserver } from '../private-state.mjs';
import { localHostExit, runLocalHostCli } from '../raw/local-host-cli.mjs';

function observe(t) {
  const counts={source:0,worker:0};
  globalThis[Symbol.for('cairn.host.observe')]=kind=>{counts[kind]++};
  t.after(()=>delete globalThis[Symbol.for('cairn.host.observe')]);return counts;
}
const assertNoSource=counts=>assert.deepEqual(counts,{source:0,worker:0});
const privateOutput=(f,result)=>{
  const text=JSON.stringify(result);
  for(const sentinel of [f.workspace.path,f.selection.sessionId,'synthetic_source_secret','synthetic_key_secret'])assert.equal(text.includes(sentinel),false);
  assert.deepEqual(Object.keys(result),['version','status','reason','worker']);
};

for(const client of ['claude-code','codex'])test(`B4c ${client} status/prepare are content-free, nonmutating/idempotent and credential-free`,async t=>{
  const f=await hostFixture(t,{client}),counts=observe(t),before=f.snapshot();
  assert.equal((await f.call('status')).reason,'preparation_required');assert.deepEqual(f.snapshot(),before);
  const prepared=await f.call('prepare');assert.equal(prepared.status,'ready',JSON.stringify(prepared));assert.equal(prepared.reason,'prepared');
  const after=f.snapshot();assert.equal((await f.call('prepare')).status,'ready');assert.deepEqual(f.snapshot(),after);
  assert.equal((await f.call('status')).status,'ready');assert.deepEqual(f.snapshot(),after);assertNoSource(counts);
  const marker=JSON.parse(readFileSync(f.profilePath+'.prepared.json'));assert.equal(marker.phase,'ready');
  assert.match(marker.keyCommitment,/^[a-f0-9]{64}$/);privateOutput(f,prepared);
  for(const path of [f.identityKeyPath,f.profilePath+'.prepared.json',join(f.stateRoot,'root.json')]){
    assert.equal(f.snapshot()[path.slice(f.workspace.path.length+1)].mode,0o600);
    if(path!==f.identityKeyPath)assert.equal(readFileSync(path,'utf8').includes(f.workspace.path),false);
  }
});

for(const change of ['disabled','target','namespace','generation','store','config-digest','profile-mode','key-mode','key-missing','root-missing','marker-missing','client'])
test(`B4c ${change} refuses before actual source open/worker dispatch`,async t=>{
  const f=await hostFixture(t,{client:'codex'});assert.equal((await f.call('prepare')).status,'ready');const counts=observe(t);
  if(change==='disabled')f.disable();
  if(change==='target')f.config.authority.targetId='foreign-target';
  if(change==='namespace')f.config.authority.namespace.ownerId='foreign-owner';
  if(change==='generation')f.config.authority.expectedConsentGeneration='foreign-generation';
  if(change==='store')f.config.authority.storeId='foreign-store';
  if(['target','namespace','generation','store'].includes(change)){
    f.save();f.profile.configDigest=(await import('node:crypto')).createHash('sha256').update(readFileSync(f.configPath)).digest('hex');f.saveProfile();
  }
  if(change==='config-digest')writeFileSync(f.configPath,readFileSync(f.configPath,'utf8')+' ');
  if(change==='profile-mode')chmodSync(f.profilePath,0o644);
  if(change==='key-mode')chmodSync(f.identityKeyPath,0o644);
  if(change==='key-missing')unlinkSync(f.identityKeyPath);
  if(change==='root-missing')renameSync(f.stateRoot,f.stateRoot+'.lost');
  if(change==='marker-missing')unlinkSync(f.profilePath+'.prepared.json');
  if(change==='client'){f.profile.installation={client:'claude-code',pluginRoot:f.pluginRoot};f.saveProfile();}
  const before=f.snapshot(),result=await f.call('initialize');assert.equal(result.status,'blocked');assertNoSource(counts);
  assert.deepEqual(f.snapshot(),before);privateOutput(f,result);
});

for(const missing of ['key','root','marker','worker-root','sessions'])test(`B4c established missing ${missing} never regenerates during prepare`,async t=>{
  const f=await hostFixture(t);assert.equal((await f.call('prepare')).status,'ready');
  const paths={key:f.identityKeyPath,root:f.stateRoot,marker:f.profilePath+'.prepared.json','worker-root':join(f.stateRoot,'root.json'),sessions:join(f.stateRoot,'sessions')};
  renameSync(paths[missing],paths[missing]+'.lost');const before=f.snapshot();
  assert.equal((await f.call('prepare')).reason,'preparation_invalid');assert.deepEqual(f.snapshot(),before);
});

for(const stage of ['intent','worker-root','ready'])test(`B4c interrupted ${stage} publication never continues or repairs`,async t=>{
  const f=await hostFixture(t);let writes=0;
  const result=await withWriteObserver(({path})=>{
    if(path===f.profilePath+'.prepared.json')writes++;
    if(stage==='intent'&&writes===1 || stage==='worker-root'&&path===join(f.stateRoot,'root.json') || stage==='ready'&&writes===2)throw Error('synthetic publication ambiguity');
  },()=>f.call('prepare'));
  assert.equal(result.reason,'preparation_invalid');const before=f.snapshot();
  assert.equal((await f.call('prepare')).status,stage==='ready'?'ready':'blocked');assert.deepEqual(f.snapshot(),before);
});

test('B4c concurrent preparation preserves one complete key/root identity',async t=>{
  const f=await hostFixture(t),results=await Promise.all([f.call('prepare'),f.call('prepare')]);
  assert.equal(results.every(result=>result.status==='ready'||result.status==='busy'),true);
  assert.equal((await f.call('status')).status,'ready');const before=f.snapshot();assert.equal((await f.call('prepare')).status,'ready');assert.deepEqual(f.snapshot(),before);
});

for(const change of ['missing-host','exec-host','unqualified','changed-binary','wrong-session','automation','creator','changed-plugin','symlink-profile','alias-key'])
test(`B4c qualification ${change} uses synthetic installation and refuses`,async t=>{
  const client=change==='changed-plugin'?'claude-code':'codex',f=await hostFixture(t,{client});assert.equal((await f.call('prepare')).status,'ready');const counts=observe(t);
  if(change==='missing-host')f.setHost(false);
  if(change==='exec-host')f.setExec(true);
  if(change==='unqualified')writeFileSync(f.verdictPath,JSON.stringify({...f.verdict,status:'changed'}));
  if(change==='changed-binary')writeFileSync(f.binary,'changed native binary');
  if(change==='wrong-session')f.selection.sessionId='wrong-session';
  if(change==='automation')f.saveSource({...f.header,payload:{...f.header.payload,source:'exec'}});
  if(change==='creator')f.saveSource({...f.header,payload:{...f.header.payload,cli_version:'9.999.9'}});
  if(change==='changed-plugin'){const replacement=join(f.workspace.path,'another-plugin');mkdirSync(replacement,{mode:0o700});f.profile.installation.pluginRoot=replacement;f.saveProfile();}
  if(change==='symlink-profile'){renameSync(f.profilePath,f.profilePath+'.actual');symlinkSync(f.profilePath+'.actual',f.profilePath);}
  if(change==='alias-key'){unlinkSync(f.identityKeyPath);symlinkSync(f.configPath,f.identityKeyPath);}
  const result=await f.call('initialize');assert.equal(result.status,'blocked',JSON.stringify(result));assert.equal(counts.worker,0);
  if(!['wrong-session','automation','creator'].includes(change))assert.equal(counts.source,0);else assert.equal(counts.source,1);
});

for(const client of ['claude-code','codex'])test(`B4c ${client} real worker initialized at EOF and no provider credential`,async t=>{
  const f=await hostFixture(t,{client}),counts=observe(t);assert.equal((await f.call('prepare')).status,'ready');
  const result=await f.call('initialize');assert.equal(result.status,'ready',JSON.stringify(result));assert.equal(result.reason,'initialized');
  assert.equal(counts.worker,1);assert.equal(counts.source,client==='codex'?2:1);assert.equal(result.worker.dispatchedParts,0);privateOutput(f,result);
  const before=f.snapshot();assert.equal((await f.call('run')).status,'ready');assert.deepEqual(f.snapshot(),before);
});

for(const checkpoint of ['before_header','before_dispatch'])test(`B4c revocation at ${checkpoint} denies subsequent source open`,async t=>{
  const f=await hostFixture(t,{client:'codex'});await f.call('prepare');const counts=observe(t);
  const result=await f.call('initialize',undefined,{checkpoint:stage=>{if(stage===checkpoint)f.disable()}});
  assert.equal(result.reason,'capture_disabled');assert.equal(counts.source,checkpoint==='before_header'?0:1);assert.equal(counts.worker,0);
});

test('B4c closed data/native signals and fixed CLI grammar cannot supply authority or dependencies',async t=>{
  const f=await hostFixture(t),counts=observe(t);let invoked=0;
  assert.throws(()=>createLocalRawHost({profilePath:f.profilePath,detectHost:()=>{}}));
  const selected={...f.selection};Object.defineProperty(selected,'sessionId',{get(){invoked++;throw Error()}});
  assert.equal((await f.call('initialize',selected)).reason,'invalid_input');
  const signal=new Proxy(new AbortController().signal,{get(){invoked++;throw Error()}});
  assert.equal((await f.call('status',{signal})).reason,'invalid_input');assert.equal(invoked,0);
  assert.equal((await f.call('status',{signal:AbortSignal.abort()})).reason,'cancelled');
  const outcome=await runLocalHostCli(['--profile',f.profilePath,'run','--session','id','--source',f.sourcePath,'--start','beginning']);
  assert.equal(outcome.exitCode,2);assert.equal(outcome.result.reason,'invalid_input');assertNoSource(counts);
  for(const [status,reason,code] of [['ready',null,0],['progress',null,0],['waiting',null,3],['busy','state_busy',3],['blocked','capture_disabled',2],['blocked','unexpected_failure',1]])
    assert.equal(localHostExit({status,reason}),code);
});

test('B4c canonical preparation cannot nest below usage through an ancestor alias',async t=>{
  const f=await hostFixture(t),nested=join(f.config.usage.root,'nested'),alias=join(f.workspace.path,'usage-alias');
  mkdirSync(nested,{mode:0o700});symlinkSync(f.config.usage.root,alias);
  f.profile.stateRoot=join(alias,'nested','state');f.saveProfile();const counts=observe(t),before=f.snapshot();
  const result=await f.call('prepare');assert.equal(result.reason,'profile_invalid');assert.deepEqual(f.snapshot(),before);assertNoSource(counts);
});

test('B4c canonical source cannot alias into prepared private state',async t=>{
  const f=await hostFixture(t);assert.equal((await f.call('prepare')).status,'ready');
  const nested=join(f.stateRoot,'nested'),alias=join(f.workspace.path,'state-alias');mkdirSync(nested,{mode:0o700});
  writeFileSync(join(nested,'secret.jsonl'),'synthetic_source_secret\n',{mode:0o600});symlinkSync(f.stateRoot,alias);
  const counts=observe(t),result=await f.call('initialize',{sessionId:f.selection.sessionId,sourcePath:join(alias,'nested','secret.jsonl')});
  assert.equal(result.reason,'invalid_input');assertNoSource(counts);
});

test('B4c a cancellation after confirmed worker readiness preserves its exact result',async t=>{
  const f=await hostFixture(t);await f.call('prepare');const controller=new AbortController();let confirmed=0;
  const result=await withLocalHostDependencies({checkpoint:stage=>{if(stage==='after_dispatch'){confirmed++;controller.abort()}}},
    ()=>f.host.initialize(f.selection,{signal:controller.signal}));
  assert.equal(confirmed,1);assert.equal(controller.signal.aborted,true);assert.equal(result.status,'ready');assert.equal(result.reason,'initialized');
  assert.equal(result.worker.status,'ready');assert.equal(result.worker.reason,'initialized');assert.equal(result.worker.dispatchedParts,0);
});
