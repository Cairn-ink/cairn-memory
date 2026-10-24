import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {openSync,closeSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createTestWorkspace} from './workspace.mjs';
import {openMemoryCore} from '../../core/contract.mjs';
import {DatabaseSync} from 'node:sqlite';
import {assertMethodGate,methodWriterInterval,overlapPageReport} from './measure-method-packages.mjs';
const report=()=>({reader:{pid:1,status:'complete',storageBusy:0,passes:1,pagesDuringWriter:200,pagesDuringActiveWrites:200},
  writer:{pid:2,status:'complete',storageBusy:0,committed:100,p95Ms:250},exits:{reader:{code:0,signal:null},writer:{code:0,signal:null}}});
test('C04 gate accepts exactly 100 transitions, 200 overlap pages and writer p95 of 250 ms',()=>assertMethodGate(report()));
for(const side of ['reader','writer'])for(const defect of ['busy','exit','incomplete'])test(`C04 ${side} ${defect} fails even when a retry eventually succeeded`,()=>{
  const value=report();if(defect==='busy')value[side].storageBusy=1;
  if(defect==='exit')value.exits[side].code=1;if(defect==='incomplete')value[side].status='incomplete';
  assert.throws(()=>assertMethodGate(value));
});
for(const [name,change] of [['too few transitions',value=>value.writer.committed=99],['writer p95',value=>value.writer.p95Ms=250.001],
  ['incomplete version',value=>value.reader.passes=0],['no overlap',value=>value.reader.pagesDuringWriter=0],['insufficient overlap',value=>value.reader.pagesDuringWriter=199],
  ['insufficient active overlap',value=>value.reader.pagesDuringActiveWrites=199],['same process',value=>value.writer.pid=1]])
  test('C04 gate refuses '+name,()=>{const value=report();change(value);assert.throws(()=>assertMethodGate(value));});

for(const role of ['reader','writer'])test(`C04 expired ${role} process reports its deadline and exits nonzero`,t=>{
  const workspace=createTestWorkspace(t),path=join(workspace.path,'store.sqlite');closeSync(openSync(path,'wx',0o600));
  const config={path,gate:true,receipt:{},files:['file'],deadlineAt:Date.now()-1,maxBusyRetries:2,
    ...Object.fromEntries(['ready','start','readerActive','entered','writerDone','result'].map(name=>[name,join(workspace.path,name)]))};
  for(const name of ['start','readerActive'])writeFileSync(config[name],'ready');
  const configuration=join(workspace.path,'config.json');writeFileSync(configuration,JSON.stringify(config));
  const stderr=join(workspace.path,'stderr'),out=openSync(join(workspace.path,'stdout'),'wx'),err=openSync(stderr,'wx');let child;
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  try{child=spawnSync(process.execPath,[fileURLToPath(new URL('./measure-method-packages.mjs',import.meta.url)),'--'+role,configuration],
    {env,timeout:15000,stdio:['ignore',out,err]});}finally{closeSync(out);closeSync(err);}
  assert.equal(child.error,undefined);assert.equal(child.signal,null);assert.equal(child.status,1,readFileSync(stderr,'utf8'));
  const result=JSON.parse(readFileSync(config.result,'utf8'));
  assert.equal(result.status,'incomplete');assert.equal(result.reason,'run-deadline');assert.equal(result.deadlineAt,config.deadlineAt);
  assert.equal(result.attempts,0);assert.equal(role==='writer'?result.committed:result.passes,0);
});

test('C04 pacing is derived from a finite reader baseline',()=>{
  assert.equal(methodWriterInterval(6000),60);assert.equal(methodWriterInterval(50),1);
  for(const value of [0,-1,Infinity,NaN])assert.throws(()=>methodWriterInterval(value));
});
test('C04 overlap observations include pages crossing either writer boundary',()=>{
  const pages=[{startedAt:0,finishedAt:5,elapsedMs:5},{startedAt:5,finishedAt:15,elapsedMs:10},
    {startedAt:10,finishedAt:20,elapsedMs:10},{startedAt:18,finishedAt:30,elapsedMs:12},{startedAt:21,finishedAt:30,elapsedMs:9}];
  assert.deepEqual(overlapPageReport(pages,{startedAt:10,finishedAt:20}),{pages:3,p50Ms:10,p95Ms:12,maxMs:12});
  assert.deepEqual(overlapPageReport([],{startedAt:10,finishedAt:20}),{pages:0,p50Ms:0,p95Ms:0,maxMs:0});
});
test('C04 reader queueing latency is observational, without a threshold',()=>{
  const value=report();value.reader.duringOverlap={pages:200,p50Ms:1000,p95Ms:5000,maxMs:10000};assertMethodGate(value);
});

for(const entry of ['measure-method-packages.mjs','measure-assets.mjs'])for(const stopping of ['reader-complete','writer-duration'])
test(`§16 ${entry} real unpaced writer stops on ${stopping} without requiring paced gates`,t=>{
  const w=createTestWorkspace(t),path=join(w.path,'store.sqlite'),asset=entry==='measure-assets.mjs';
  const token={},grants=new WeakMap(),authority={authorize(request,supplied){
    assert.equal(supplied,token);const grant={},{input,...binding}=request;grants.set(grant,{...binding,accessGeneration:1});return grant;
  },isCurrent(grant){return grants.get(grant)??null;}};
  const core=openMemoryCore({path,methodPackages:{version:'method-packages-local-v1',storage:'local-plain-v1',authority},
    ...(asset?{assets:{version:'assets-local-v1',storage:'sqlite-blob-v1',authority}}:{})});
  w.defer(()=>core.close());
  const namespace={ownerId:asset?'synthetic-asset-measurement':'synthetic-measurement',scope:'project',projectId:asset?'binding-writer':'writer'};
  const imported=core.importMethodVersion({namespace,actionId:'fixture',title:'Small independent writer',files:[{path:'SKILL.md',text:'writer',mediaType:'text/plain'}]},token);
  assert.equal(imported.ok,true,JSON.stringify(imported));core.close();
  const config={path,gate:true,scenario:'unpaced',failOnBusy:true,intervalMs:0,
    stressWriterMs:stopping==='reader-complete'?10000:10,deadlineAt:Date.now()+15000,maxBusyRetries:32,
    receipt:imported.value,binding:imported.value,...Object.fromEntries(['ready','start','readerActive','readerPassDone','writerEntered',
      'writerDone','writerCalls','readerPages','stop','result'].map(name=>[name,join(w.path,name)]))};
  config.entered=config.writerEntered;
  for(const marker of ['start','readerActive',...(stopping==='reader-complete'?['readerPassDone']:[])])writeFileSync(config[marker],'ready');
  const configuration=join(w.path,'config.json');writeFileSync(configuration,JSON.stringify(config));
  const stderr=join(w.path,'stderr'),out=openSync(join(w.path,'stdout'),'wx'),err=openSync(stderr,'wx');let child;
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  try{child=spawnSync(process.execPath,[fileURLToPath(new URL('./'+entry,import.meta.url)),'--writer',configuration],
    {env,timeout:20000,stdio:['ignore',out,err]});}finally{closeSync(out);closeSync(err);}
  assert.equal(child.error,undefined);assert.equal(child.signal,null);assert.equal(child.status,0,readFileSync(stderr,'utf8'));
  const result=JSON.parse(readFileSync(config.result,'utf8'));
  assert.equal(result.status,'complete');assert.equal(result.stopReason,stopping);assert.equal(result.storageBusy,0);
  assert.equal(result.stressWriterMs,config.stressWriterMs);assert.equal(existsSync(config.writerDone),true);
  if(stopping==='reader-complete')assert.equal(result.committed,0,'no 100-transition minimum in stress');
  const db=new DatabaseSync(path,{readOnly:true});
  try{
    assert.equal(db.prepare('SELECT count(*) n FROM method_binding_events').get().n,result.committed);
    assert.equal(db.prepare('SELECT revision FROM method_bindings').get()?.revision??0,result.committed);
  }finally{db.close();}
});
