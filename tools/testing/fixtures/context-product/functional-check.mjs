// Explicit-path functional acceptance. No elapsed-time, loop or contention gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace } from '../../workspace.mjs';
import { summarize } from '../../summarize-context-read-product.mjs';
import { storage } from '../../measure-context-read-product.mjs';
import { startWriter } from './controller.mjs';
import { terminate, coldAttempt, fileChild } from './actors.mjs';
import { configure, selectReadSet, probeDependencies } from './engine.mjs';
import { build } from './series.mjs';
import { tinySchema } from './tiny-schema.mjs';
const entry=fileURLToPath(new URL('../../measure-context-read-product.mjs',import.meta.url));
for(const namespaces of [1,2])test(`tiny DELETE ${namespaces} namespace functional CLI, journal/report, nonpass exit and cleanup`,async t=>{
  const w=createTestWorkspace(t),report=join(w.path,'report.jsonl');
  const child=spawn(process.execPath,[entry,'--functional-only','--namespaces',String(namespaces),'--report',report],{env:{},stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',b=>{stdout+=b;});child.stderr.on('data',b=>{stderr+=b;});
  const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
  assert.equal(exit.code,1,stderr);assert.equal(exit.signal,null);assert.equal(stdout.trim().split('\n').at(-1),'inconclusive',stderr);
  const lines=(await readFile(report,'utf8')).trim().split('\n').map(l=>JSON.parse(l));
  assert.equal(lines.at(-1).functionalPassed,true);assert.equal(lines.at(-1).cleanup,true);
  assert.equal((await summarize(report,()=>{})).tally.inconclusive,1);
  const journal=(await readFile(report+'.records.jsonl','utf8')).trim().split('\n').map(l=>JSON.parse(l));
  const attempt=journal.find(r=>r.series==='functional').record;assert.equal(attempt.validated,true);assert.equal(attempt.expected,true);assert.equal(attempt.telemetry,'complete');
  assert.deepEqual(Object.keys(journal.find(r=>r.type==='record')).sort(),['cell','record','sequence','series','type']);
  const header=JSON.parse(await readFile(report+'.header.json','utf8'));assert.equal(header.timingGates,false);
  await assert.rejects(access(report+'.partial'),{code:'ENOENT'});
});
test('tiny ordinary independent writer is armed before import, drains native journal and final seal',async t=>{
  const w=createTestWorkspace(t),path=join(w.path,'writer.sqlite'),namespace={ownerId:'synthetic-product',scope:'personal',projectId:null};
  await storage('seed',{path,count:1,inventory:[namespace]});
  const writer=await startWriter({path,namespace,writerProfile:{captureMs:null,reviewMs:null,provenance:'functional'},oneOperation:true});
  try {
    writer.start(Date.now(),Date.now());const result=await writer.stop();
    assert.equal(result.exit.code,0);assert.equal(result.exit.signal,null);assert.equal(result.exit.disconnected,true);
    assert.equal(result.diagnostics.coverage,'complete');assert.equal(result.diagnostics.acknowledged,true);assert.equal(result.diagnostics.inFlight,0);
    assert.equal(result.calls.length,1);assert.equal(result.calls[0].code,null);
    assert.ok(result.diagnostics.records.some(r=>r.stage==='open'));assert.ok(result.diagnostics.records.some(r=>r.stage==='close'));assert.ok(result.diagnostics.commits>0);
  }finally{await terminate(writer.child);}
});
test('runtime probes register unavailable owner-wide and WAL; fresh-process cold machinery works on narrow DELETE',async t=>{
  const w=createTestWorkspace(t),path=join(w.path,'probe.sqlite'),ns={ownerId:'synthetic-product',scope:'personal',projectId:null};
  await storage('seed',{path,count:2,inventory:[ns]});
  const config={path,...selectReadSet([ns],'probe'),canonical:'DELETE',sidecar:'DELETE',functionalOnly:true,types:['memory'],load:'idle',
    deadlines:{openMs:5000,requestMs:5000},buildCeiling:100,pump:{quantum:{maxItems:1024,maxMs:5000}},method:'findCandidates',input:{readSet:[ns],types:['memory'],intent:'current',query:'needle',limit:12,deadlineMs:5000},responseSchema:tinySchema};
  const wide={...config,...selectReadSet([ns,...['a','b','c'].map(projectId=>({...ns,scope:'project',projectId}))],'wide')};
  const a=await probeDependencies(wide);assert.deepEqual(a.blocked,['P2c']);
  const b=await probeDependencies({...config,canonical:'WAL',sidecar:'WAL'});assert.deepEqual(b.blocked,['P2d-WAL']);
  assert.equal((await probeDependencies(config)).ready,true);
  await build(config);
  const cold=await coldAttempt(config);assert.equal(cold.record.ok,true);assert.equal(cold.record.validated,true);assert.equal(cold.record.processExit.code,0);assert.ok(cold.record.launcherLoop);
});

for(const type of ['memory','card'])test(`tiny DELETE ${type} capture/review target ledger refreshed from storage`,async t=>{
  const w=createTestWorkspace(t),path=join(w.path,'target.sqlite'),namespace={ownerId:'synthetic-product',scope:'personal',projectId:null};
  await storage('seed',{path,count:1,inventory:[namespace],cards:type==='card'});
  const writer=await startWriter({path,namespace,targetType:type,probes:['uniquelexicalprobe0001'],operationLimit:2,writerProfile:{captureMs:null,reviewMs:null,provenance:'functional'}});
  try {
    writer.start(Date.now(),Date.now()+30000);await writer.child.wait('call');await writer.child.wait('call');
    const result=await writer.stop();assert.equal(result.exit.code,0);assert.equal(result.diagnostics.coverage,'complete');
    assert.deepEqual(result.calls.map(c=>c.operation),['capture','review']);assert.ok(result.calls.every(c=>c.code===null));
    const targets=writer.child.take('target');assert.equal(targets.length,1);assert.equal(targets[0].target.type,type);assert.equal(targets[0].target.probe,'uniquelexicalprobe0001');
    assert.ok(targets[0].target.revision>1);assert.ok(Number.isFinite(targets[0].target.committedAt));
  }finally{await terminate(writer.child);}
});

test('SQLite-free copy/hash child preserves a host-held exclusive SQLite lock',async t=>{
  const w=createTestWorkspace(t),path=join(w.path,'locked.sqlite'),copy=join(w.path,'copy.sqlite'),namespace={ownerId:'synthetic-product',scope:'personal',projectId:null};
  await storage('seed',{path,count:1,inventory:[namespace]});
  const {DatabaseSync}=await import('node:sqlite'),db=new DatabaseSync(path);db.exec('BEGIN EXCLUSIVE');
  try {
    assert.equal((await storage('busy-probe',{path})).value.busy,5);
    const hash=fileChild('hash',path).value[0],copied=fileChild('copy',path,copy).value;
    assert.equal(copied.hash,hash.hash);assert.equal(copied.bytes,hash.bytes);
    assert.equal((await storage('busy-probe',{path})).value.busy,5);
    db.exec('COMMIT');assert.equal((await storage('busy-probe',{path})).value.busy,0);
  }finally{db.close();}
});

test('P2-23 retained writer reports native shutdown close separately after its public write interval',async t=>{
  const w=createTestWorkspace(t),path=join(w.path,'retained.sqlite'),namespace={ownerId:'synthetic-product',scope:'personal',projectId:null};
  await storage('seed',{path,count:1,inventory:[namespace]});
  const writer=await startWriter({path,namespace,oneOperation:true,writerProfile:{captureMs:null,reviewMs:null,provenance:'functional'}},'retained');
  try {
    writer.start(Date.now(),Date.now());const result=await writer.stop();
    assert.equal(result.exit.code,0);assert.equal(result.diagnostics.coverage,'complete');
    const call=result.calls[0],shutdown=result.diagnostics.records.filter(r=>r.operation==='shutdown');
    assert.equal(Object.hasOwn(call,'closeStartedAt'),false);assert.ok(result.finalClose.startedAt>=call.writeFinishedAt);
    assert.ok(shutdown.some(r=>r.phase==='shutdown'&&r.kind==='native_begin'&&r.stage==='close'));
    assert.ok(shutdown.some(r=>r.phase==='shutdown'&&r.kind==='native_end'&&r.stage==='close'&&r.ok));
    assert.ok(shutdown.every(r=>r.at>=Math.floor(call.writeFinishedAt)&&r.commit!==true));
  }finally{await terminate(writer.child);}
});

test('history Memory freshness exports a storage-refreshed target at capture before confirmation',async t=>{
  const w=createTestWorkspace(t),path=join(w.path,'history.sqlite'),namespace={ownerId:'synthetic-product',scope:'personal',projectId:null};
  await storage('seed',{path,count:1,inventory:[namespace]});
  const writer=await startWriter({path,namespace,cell:{intent:'history'},targetType:'memory',oneOperation:true,
    probes:['uniquelexicalprobe0001'],writerProfile:{captureMs:null,reviewMs:null,provenance:'functional'}});
  try {
    writer.start(Date.now(),Date.now());const result=await writer.stop();
    assert.deepEqual(result.calls.map(c=>c.operation),['capture']);
    const targets=writer.child.take('target');assert.equal(targets.length,1);
    const target=targets[0].target,stored=(await storage('inspect',{path})).value.memory.find(m=>m.id===target.id);
    assert.equal(target.revision,stored.revision);assert.equal(target.type,'memory');
    const commits=result.diagnostics.records.filter(r=>r.phase==='write'&&r.commit);
    assert.equal(target.committedAt,commits.at(-1).at);
  }finally{await terminate(writer.child);}
});
