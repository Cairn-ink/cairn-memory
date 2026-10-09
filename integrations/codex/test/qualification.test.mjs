import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, copyFile, chmod, symlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { binaryIdentity, cachedQualification, qualifyBinary, detectRunningHost, fingerprint,
  KNOWN_FORMATS, qualificationStatus, observeHost, observedHosts, scheduleQualification, finishQualification, hasQualifiedCreator } from '../qualification.mjs';
import { currentHost } from '../installed.mjs';
import { verifyHeader, parseLine, FORMAT } from '../parser.mjs';

const fixtureURL=new URL('./fixtures/',import.meta.url);
const evidence=JSON.parse(await readFile(new URL('binary-0.160.1/format.json',fixtureURL)));
async function fixture(t) {
  const ws=createTestWorkspace(t,{prefix:'cx5-format-'});
  const configPath=join(ws.path,'installation.json');
  const binaryPath=join(ws.path,'codex');
  await copyFile(process.execPath,binaryPath);await chmod(binaryPath,0o700);
  const host={identity:await binaryIdentity(binaryPath),binaryPath,kind:'app-server'};
  return {ws,configPath,host};
}
const result=(version,format=evidence)=>({version,evidence:format,binarySha256:'a'.repeat(64)});
for(const version of ['0.161.0','0.162.0'])test(`native ${version} frozen schemas and synthetic fixture qualification`,async()=>{
  const manifest=JSON.parse(await readFile(new URL(`format-evidence-${version}.json`,fixtureURL)));
  assert.equal(manifest.versionExitCode,0);assert.equal(manifest.schemaExitCode,0);assert.equal(manifest.network,false);
  for(const file of manifest.files)assert.equal(createHash('sha256').update(await readFile(new URL(file.path,fixtureURL))).digest('hex'),file.sha256,file.path);
  if(manifest.nativePhaseProbe) {
    assert.equal(createHash('sha256').update(await readFile(new URL('../../../scripts/probe-codex-phases.mjs',import.meta.url))).digest('hex'),manifest.nativePhaseProbe.scriptSha256);
    assert.deepEqual(manifest.nativePhaseProbe.nativeExitCodes,[0,0]);
    assert.equal(manifest.nativePhaseProbe.modelCalls,0);
  }
  const format=JSON.parse(await readFile(new URL(`binary-${version}/format.json`,fixtureURL)));
  assert.equal(KNOWN_FORMATS.includes(fingerprint(format)),manifest.qualified);
  assert.deepEqual(format.hooks,evidence.hooks);
  const lines=(await readFile(new URL(`primary-${version}.jsonl`,fixtureURL),'utf8')).trim().split('\n');
  const sessionId=JSON.parse(lines[0]).payload.id;
  if(manifest.qualified) {
    assert.equal(verifyHeader(Buffer.from(lines[0]),sessionId),FORMAT);
    const rows=lines.map((line,i)=>parseLine(Buffer.from(line),{sessionId,wireSessionId:'a'.repeat(64),epoch:0,start:i,end:i+1}));
    assert.deepEqual(rows.filter(row=>row.message).map(row=>row.message.content),['Prefer diagrams.','Understood.']);
  } else {
    assert.throws(()=>verifyHeader(Buffer.from(lines[0]),sessionId),/unsupported_format/);
    assert.throws(()=>parseLine(Buffer.from(lines[5]),{sessionId,wireSessionId:'a'.repeat(64),epoch:0,start:5,end:6}),/unsupported_format/);
    assert.ok(format.appServer.MessagePhase.oneOf.some(row=>row.enum?.includes('partial_answer')));
  }
});

test('unknown identical format is accepted and cached by binary identity, never by version alone',async t=>{
  const f=await fixture(t);let calls=0;
  const collect=async()=>{calls++;return result('0.999.0');};
  const verdict=await qualifyBinary(f.configPath,f.host,{collect});
  assert.equal(verdict.status,'qualified');assert.equal(calls,1);
  assert.equal((await qualifyBinary(f.configPath,f.host,{cache:false,collect:async()=>result('0.999.0-dev.1')})).status,'qualified');
  assert.deepEqual(await cachedQualification(f.configPath,f.host),verdict);
  assert.equal((await qualifyBinary(f.configPath,f.host,{collect})).status,'qualified');assert.equal(calls,1);
  const header={type:'session_meta',payload:{cli_version:'0.999.0',history_mode:'paginated',id:'s',source:'cli'}};
  assert.throws(()=>verifyHeader(Buffer.from(JSON.stringify(header)),'s'),/creator_unqualified/);
  assert.equal(verifyHeader(Buffer.from(JSON.stringify(header)),'s',{qualifiedCreatorVersion:verdict.version}),FORMAT);
  header.payload.cli_version='0.999.1';
  assert.throws(()=>verifyHeader(Buffer.from(JSON.stringify(header)),'s',{qualifiedCreatorVersion:verdict.version}),/creator_unqualified/);
  // Same version but a replacement file must lose the cached approval.
  await writeFile(f.host.binaryPath,'replacement');
  const updated={...f.host,identity:await binaryIdentity(f.host.binaryPath)};
  assert.notEqual(updated.identity,f.host.identity);
  assert.equal((await cachedQualification(f.configPath,updated)).status,'pending');
});

test('changed schema, including a transitive delivery/context reference, is refused with a plain status line',async t=>{
  const f=await fixture(t),changed=structuredClone(evidence);
  changed.hooks['user-prompt-submit.command.output'].definitions.UserPromptSubmitHookSpecificOutputWire.properties.additionalContext.type='array';
  const verdict=await qualifyBinary(f.configPath,f.host,{collect:async()=>result('0.999.0',changed)});
  assert.equal(verdict.status,'changed');
  assert.equal(qualificationStatus(verdict.version,verdict.status),
    'Codex 0.999.0 的格式已變更，擷取與回憶暫停，等待 plugin 更新');
  const inherited=structuredClone(evidence);inherited.appServer.MessagePhase.oneOf.push({type:'string',enum:['new-phase']});
  assert.ok(!KNOWN_FORMATS.includes(fingerprint(inherited)));
  assert.deepEqual(await cachedQualification(f.configPath,f.host),verdict);
});

test('pending qualification returns promptly, schedules once, and never waits for schema generation',async t=>{
  const f=await fixture(t);let launched=0;
  const start=performance.now();
  const launch=async()=>{launched++;}; // background work does not resolve a schema here
  const first=await currentHost(f.configPath,{detect:async()=>f.host,launch});
  const second=await currentHost(f.configPath,{detect:async()=>f.host,launch});
  assert.equal(first.status,'pending');assert.equal(second.status,'pending');assert.equal(launched,1);
  assert.ok(performance.now()-start<2000);
  assert.deepEqual(await observedHosts(f.configPath),[f.host]);
  await finishQualification(f.configPath,f.host);
  await scheduleQualification(f.configPath,f.host,launch);assert.equal(launched,2);
});

test('unsafe verdict, failed probe and changing binary fail closed; failed probe can be retried',async t=>{
  const f=await fixture(t);
  assert.equal((await qualifyBinary(f.configPath,f.host,{collect:async()=>{throw new Error('failed');}})).status,'unavailable');
  assert.equal((await qualifyBinary(f.configPath,f.host,{collect:async()=>result('0.998.0')})).status,'qualified');
  const cache=join(f.ws.path,'qualification',f.host.identity+'.json');
  await chmod(cache,0o644);assert.equal((await cachedQualification(f.configPath,f.host)).status,'pending');
  await chmod(cache,0o600);
  assert.equal((await qualifyBinary(f.configPath,f.host,{cache:false,collect:async()=>{
    await writeFile(f.host.binaryPath,'changed while generating');return result('0.999.0');
  }})).status,'pending');
});

test('actual hook ancestor distinguishes app-server from CLI through shell/env, without install-time fallback',async()=>{
  const tree={
    91:{exe:'/usr/bin/sh',args:['sh','-c','hook'],parent:90},
    90:{exe:'/releases/0.161.0/bin/codex',args:['codex','app-server','--listen','stdio://'],parent:80},
    80:{exe:'/cli/bin/codex',args:['codex','exec'],parent:1},
  };
  const read=async path=>{
    const [,pid,leaf]=/\/(\d+)\/(\w+)$/u.exec(path);const row=tree[pid];
    return Buffer.from(leaf==='cmdline'?row.args.join('\0')+'\0':`${pid} (host with spaces) S ${row.parent} 0`);
  };
  const link=async path=>tree[/\/(\d+)\/exe$/u.exec(path)[1]].exe;
  const identity=async path=>createHash('sha256').update(path).digest('hex');
  assert.deepEqual(await detectRunningHost({pid:91,read,link,identity}),{
    binaryPath:'/releases/0.161.0/bin/codex',processPath:'/proc/90/exe',kind:'app-server',pid:90,identity:await identity('/proc/90/exe')});
  assert.equal((await detectRunningHost({pid:80,read,link,identity})).kind,'cli');
  assert.equal(await detectRunningHost({pid:91,read:async()=>{throw new Error('inaccessible');},link,identity}),undefined);
});

test('live /proc ancestry selects the native app-server binary rather than a separate installed CLI',async t=>{
  const f=await fixture(t);
  const {spawn}=await import('node:child_process');
  const script=join(f.ws.path,'host.mjs'),report=join(f.ws.path,'report.json');
  const moduleURL=new URL('../qualification.mjs',import.meta.url).href;
  await writeFile(script,`import {spawn} from 'node:child_process';
    const code=${JSON.stringify(`import {detectRunningHost} from '${moduleURL}';import {writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(report)},JSON.stringify(await detectRunningHost()));`)};
    const child=spawn(${JSON.stringify(process.execPath)},['--input-type=module','-e',code],{stdio:'inherit'});
    child.on('close',code=>process.exitCode=code);`);
  for(const kind of ['cli','app-server']) {
    const child=spawn(f.host.binaryPath,[script,...(kind==='app-server'?['app-server']:[])],{stdio:['ignore','ignore','pipe']});
    let errors='';child.stderr.on('data',chunk=>errors+=chunk);
    assert.equal(await new Promise((resolve,reject)=>{child.once('close',resolve);child.once('error',reject);}),0,errors);
    const host=JSON.parse(await readFile(report));
    assert.equal(host.kind,kind);assert.equal(host.identity,f.host.identity);assert.equal(host.binaryPath,f.host.binaryPath);
  }
});

test('missing schema/serde evidence is a refused format rather than an approval or endless pending',async t=>{
  const f=await fixture(t);
  const verdict=await qualifyBinary(f.configPath,f.host,{collect:async()=>{
    const error=new Error('embedded_schema_missing');error.version='0.999.0';throw error;
  }});
  assert.equal(verdict.status,'changed');assert.match(qualificationStatus(verdict.version,verdict.status),/的格式已變更.*等待 plugin 更新/);
});

test('running process binding survives an on-disk replacement and rejects a reused or gone process identity',async t=>{
  const f=await fixture(t);
  const {boundBinary}=await import('../qualification.mjs');
  const {spawn}=await import('node:child_process');
  // The running host is an owner-only copy, never the runner's own node: CI tool
  // caches may install that group/world-writable, which binaryIdentity refuses.
  const running=join(f.ws.path,'running');await mkdir(running,{mode:0o700});
  const binary=join(running,'codex');await copyFile(process.execPath,binary);await chmod(binary,0o700);
  const child=spawn(binary,['-e','process.stdin.resume()'],{stdio:['pipe','ignore','ignore'],env:{PATH:process.env.PATH}});
  const exited=new Promise(resolve=>child.once('close',resolve));
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
  try {
    const processPath=`/proc/${child.pid}/exe`;
    const host={identity:await binaryIdentity(processPath),binaryPath:f.host.binaryPath,processPath,kind:'cli'};
    await writeFile(f.host.binaryPath,'replacement with a different identity');
    assert.equal(await boundBinary(host),host.processPath);
    assert.equal(await boundBinary({...host,identity:f.host.identity}),undefined);
    assert.equal(await boundBinary({...host,processPath:'/proc/99999999/exe'}),undefined);
  } finally {child.stdin.end();await exited;}
});


test('unsafe cache ancestor cannot write or read a verdict through a symlink',async t=>{
  const f=await fixture(t),home=join(f.ws.path,'home'),outside=join(f.ws.path,'outside');
  await mkdir(home,{mode:0o700});await mkdir(outside,{mode:0o700});
  await symlink(outside,join(home,'cairn'));
  const path=join(home,'cairn','installation.json');
  assert.equal((await qualifyBinary(path,f.host,{collect:async()=>result('0.999.0')})).status,'pending');
  assert.equal((await cachedQualification(path,f.host)).status,'pending');
  const {readdir}=await import('node:fs/promises');assert.deepEqual(await readdir(outside),[]);
});

test('creator proof accepts any qualified cached binary but rejects stale policy, changed format and unsafe state',async t=>{
  const f=await fixture(t),version='0.163.0';
  assert.equal(await hasQualifiedCreator(f.configPath,version),false);
  const verdict=await qualifyBinary(f.configPath,f.host,{collect:async()=>result(version)});
  assert.equal(await hasQualifiedCreator(f.configPath,version),true);
  // A creator's binary can disappear after update; its observed format evidence
  // still qualifies history written by that version.
  await (await import('node:fs/promises')).unlink(f.host.binaryPath);
  assert.equal(await hasQualifiedCreator(f.configPath,version),true);
  const path=join(f.ws.path,'qualification',f.host.identity+'.json');
  for(const patch of [{policy:'stale'},{status:'changed'},{fingerprint:'f'.repeat(64)},{identity:'b'.repeat(64)}]) {
    await writeFile(path,JSON.stringify({...verdict,...patch}));
    assert.equal(await hasQualifiedCreator(f.configPath,version),false);
  }
  await writeFile(path,JSON.stringify(verdict));await chmod(path,0o644);
  assert.equal(await hasQualifiedCreator(f.configPath,version),false);await chmod(path,0o600);
  assert.equal(await hasQualifiedCreator(f.configPath,version,{signal:AbortSignal.abort()}),false);
});

test('version-only refusal leaves the cursor retryable; later creator evidence captures the unchanged history',async t=>{
  const {fixture:captureFixture,header,item}=await import('./helpers.mjs');
  const {runWorker}=await import('../worker.mjs');
  const q=await fixture(t),f=await captureFixture(t,{text:header({cli_version:'0.163.0'})+item('Version retry.')});
  const options={guard:f.guard,transport:f.transport,qualifiedCreatorVersion:'0.164.0',
    qualifyCreator:version=>hasQualifiedCreator(q.configPath,version)};
  assert.equal((await runWorker(f.binding,options)).status,'creator_unqualified');
  assert.equal(await f.cursor(),null);assert.equal(f.calls.length,0);
  await qualifyBinary(q.configPath,q.host,{collect:async()=>result('0.163.0')});
  await runWorker(f.binding,options);await runWorker(f.binding,options);
  assert.deepEqual(f.calls.flatMap(row=>row.messages.map(m=>m.content)),['Version retry.']);
});

test('old unsupported_format without a recorded cause stays latched; creator proof cannot clear it',async t=>{
  const {fixture:captureFixture,header,item}=await import('./helpers.mjs');
  const {runWorker}=await import('../worker.mjs');
  const {cursorPath,publishCursor}=await import('../cursor.mjs');
  const q=await fixture(t),f=await captureFixture(t,{text:header({cli_version:'0.163.0'})+item('Before update.')});
  await qualifyBinary(q.configPath,q.host,{collect:async()=>result('0.163.0')});
  const options={guard:f.guard,transport:f.transport,qualifiedCreatorVersion:'0.163.0',
    qualifyCreator:version=>hasQualifiedCreator(q.configPath,version)};
  await runWorker(f.binding,options);
  const prior=await f.cursor(),legacy={...prior,status:'unsupported_format'};
  await publishCursor(cursorPath(f.root,f.binding.targetId,f.binding.sessionId),legacy,prior);
  await (await import('node:fs/promises')).appendFile(f.path,item('After update.',1));
  await runWorker(f.binding,{...options,qualifiedCreatorVersion:'0.164.0'});
  assert.deepEqual(f.calls.flatMap(row=>row.messages.map(m=>m.content)),['Before update.']);
  assert.equal((await f.cursor()).status,'unsupported_format');
});

test('trusted creator qualification never admits an unknown record phase',async t=>{
  const {fixture:captureFixture,header,item}=await import('./helpers.mjs');
  const {runWorker}=await import('../worker.mjs');
  const q=await fixture(t),f=await captureFixture(t,{text:header({cli_version:'0.163.0'})+
    item('Unknown phase.',1,'assistant',{phase:'future_answer'})});
  await qualifyBinary(q.configPath,q.host,{collect:async()=>result('0.163.0')});
  const options={guard:f.guard,transport:f.transport,qualifiedCreatorVersion:'0.164.0',
    qualifyCreator:version=>hasQualifiedCreator(q.configPath,version)};
  assert.equal((await runWorker(f.binding,options)).status,'unsupported_format');
  assert.equal((await runWorker(f.binding,options)).status,'unsupported_format');
  assert.equal(f.calls.length,0);
});

for(const [name,bad] of [
  ['unknown phase',itemForLatch => itemForLatch('Bad phase.',1,'assistant',{phase:'future_answer'})],
  ['malformed item',itemForLatch => itemForLatch('Bad item.',1,'assistant',{content:'not an array'})],
]) test(`genuine ${name} latch survives pause, resume, SessionStart and repeated Stop without source reads`,async t=>{
  const {fixture:captureFixture,header,item}=await import('./helpers.mjs');
  const {runWorker,prepareCapture,establishPauseBoundary}=await import('../worker.mjs');
  const {setPaused}=await import('../../client/control-state.mjs');
  const {withSourceReadObserver}=await import('../source.mjs');
  const {appendFile,unlink}=await import('node:fs/promises');
  const f=await captureFixture(t,{text:header()+bad(item)});
  let proofs=0;
  const options={guard:f.guard,transport:f.transport,qualifiedCreatorVersion:'0.157.1',
    qualifyCreator:async()=>{proofs++;return true;}};
  assert.equal((await runWorker(f.binding,options)).status,'unsupported_format');
  const latched=await f.stateBytes();
  await setPaused(f.root,true);
  assert.equal((await prepareCapture(f.binding,options)).status,'unsupported_format');
  await setPaused(f.root,false);
  await appendFile(f.path,item('Later valid content.',2));
  assert.equal((await establishPauseBoundary(f.binding)).status,'unsupported_format');
  let sourceReads=0;
  await withSourceReadObserver(()=>sourceReads++,async()=>{
    for(let i=0;i<3;i++)assert.equal((await runWorker(f.binding,options)).status,'unsupported_format');
  });
  assert.equal(sourceReads,0);
  // If Stop attempted to reopen or rescan, this missing source would overwrite
  // the cursor with source_unavailable. It must return the durable latch first.
  await unlink(f.path);
  for(let i=0;i<3;i++)assert.equal((await prepareCapture(f.binding,options)).status,'unsupported_format');
  assert.equal(await f.stateBytes(),latched);
  assert.equal(proofs,0);assert.equal(f.calls.length,0);
});

test('pending and failed probes advise retry; changed format waits for a plugin update',()=>{
  assert.match(qualificationStatus('0.157.1','pending'),/格式還沒驗證.*status --client codex 重試/);
  assert.match(qualificationStatus('0.163.0','unavailable'),/格式驗證失敗.*status --client codex 重試/);
  const changed=qualificationStatus('0.157.1','changed');
  assert.match(changed,/格式已變更.*等待 plugin 更新/);
  assert.doesNotMatch(changed,/重試|newer/);
});

test('a previously cached unavailable probe is retried instead of becoming a permanent refusal',async t=>{
  const f=await fixture(t);
  const verdict=await qualifyBinary(f.configPath,f.host,{collect:async()=>result('0.163.0')});
  const path=join(f.ws.path,'qualification',f.host.identity+'.json');
  await writeFile(path,JSON.stringify({...verdict,status:'unavailable',reason:'probe_failed'}));
  assert.equal((await cachedQualification(f.configPath,f.host)).status,'unavailable');
  let probes=0;
  assert.equal((await qualifyBinary(f.configPath,f.host,{collect:async()=>{probes++;return result('0.163.0');}})).status,'qualified');
  assert.equal(probes,1);
});
