import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {openSync,closeSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createTestWorkspace} from './workspace.mjs';
import {assertMethodGate} from './measure-method-packages.mjs';
const report=()=>({reader:{pid:1,status:'complete',storageBusy:0,passes:1,pagesDuringWriter:1},
  writer:{pid:2,status:'complete',storageBusy:0,committed:100,p95Ms:250},exits:{reader:{code:0,signal:null},writer:{code:0,signal:null}}});
test('C04 gate accepts exactly 100 transitions and writer p95 of 250 ms',()=>assertMethodGate(report()));
for(const side of ['reader','writer'])for(const defect of ['busy','exit','incomplete'])test(`C04 ${side} ${defect} fails even when a retry eventually succeeded`,()=>{
  const value=report();if(defect==='busy')value[side].storageBusy=1;
  if(defect==='exit')value.exits[side].code=1;if(defect==='incomplete')value[side].status='incomplete';
  assert.throws(()=>assertMethodGate(value));
});
for(const [name,change] of [['too few transitions',value=>value.writer.committed=99],['writer p95',value=>value.writer.p95Ms=250.001],
  ['incomplete version',value=>value.reader.passes=0],['no overlap',value=>value.reader.pagesDuringWriter=0],['same process',value=>value.writer.pid=1]])
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
