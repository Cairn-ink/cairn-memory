import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, copyFile, chmod, symlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { binaryIdentity, cachedQualification, qualifyBinary, detectRunningHost, fingerprint,
  KNOWN_FORMATS, qualificationStatus, observeHost, observedHosts, scheduleQualification, finishQualification } from '../qualification.mjs';
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
  assert.throws(()=>verifyHeader(Buffer.from(JSON.stringify(header)),'s'),/unsupported_format/);
  assert.equal(verifyHeader(Buffer.from(JSON.stringify(header)),'s',{qualifiedCreatorVersion:verdict.version}),FORMAT);
  header.payload.cli_version='0.999.1';
  assert.throws(()=>verifyHeader(Buffer.from(JSON.stringify(header)),'s',{qualifiedCreatorVersion:verdict.version}),/unsupported_format/);
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
    'Codex 0.999.0 is newer than this plugin supports; capture and recall are paused until an update.');
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
  assert.equal((await qualifyBinary(f.configPath,f.host,{collect:async()=>{throw new Error('failed');}})).status,'pending');
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
  assert.equal(verdict.status,'changed');assert.match(qualificationStatus(verdict.version,verdict.status),/capture and recall are paused until an update/);
});

test('running process binding survives an on-disk replacement and rejects a reused or gone process identity',async t=>{
  const f=await fixture(t);
  const {boundBinary}=await import('../qualification.mjs');
  const identity=await binaryIdentity('/proc/self/exe');
  const host={identity,binaryPath:f.host.binaryPath,processPath:`/proc/${process.pid}/exe`,kind:'cli'};
  await writeFile(f.host.binaryPath,'replacement with a different identity');
  assert.equal(await boundBinary(host),host.processPath);
  assert.equal(await boundBinary({...host,identity:f.host.identity}),undefined);
  assert.equal(await boundBinary({...host,processPath:'/proc/99999999/exe'}),undefined);
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
