import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {spawnSync} from 'node:child_process';
import {sourceFixture} from '../testing/raw-source-fixtures.mjs';
import {transaction} from '../database.mjs';
import {observeCaptureWriter} from '../../tools/testing/raw-search-writer-observer.mjs';
import {measureRawFullRead,measureRawColdSearch} from '../../tools/testing/measure-raw-search.mjs';
import {rawSearchPostings} from '../raw-search-retrieval.mjs';

test('optional phase transforms load every serving module without opening a store',async()=>{
  const loader=new URL('../../tools/testing/raw-search-phase-loader.mjs',import.meta.url).href;
  const ledger=new URL('../../tools/testing/raw-search-phase-ledger.mjs',import.meta.url).href;
  const modules=['authority','index','storage','retrieval'].map(name=>new URL('../raw-search-'+name+'.mjs',import.meta.url).href);
  const script=`const {installPhaseMeasurement}=await import(${JSON.stringify(loader)});const hook=installPhaseMeasurement();
    try{for(const file of ${JSON.stringify(modules)})await import(file);
      const {takePhases}=await import(${JSON.stringify(ledger)});if(Object.keys(takePhases()).length)throw Error('unexpected_store_work');}
    finally{hook.deregister();}`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',timeout:15000});
  assert.equal(child.status,0,child.stderr);assert.equal(child.signal,null);
});
test('writer attribution preserves commits and restores native busy configuration',t=>{
  const f=sourceFixture(t),before=f.db.prepare('PRAGMA busy_timeout').get().timeout;
  const exec=DatabaseSync.prototype.exec,observer=observeCaptureWriter();
  try{
    transaction(f.db,()=>f.db.exec('CREATE TABLE synthetic_writer_attribution(value INTEGER)'));
    const rows=observer.take();assert.equal(rows.length,1);assert.deepEqual(observer.take(),[]);
    const row=rows[0];assert.equal(row.journal,'delete');assert.equal(row.checkpointMs,0);
    assert.ok(BigInt(row.start)<=BigInt(row.beginEnd));assert.ok(BigInt(row.beginEnd)<=BigInt(row.commitStart));
    assert.ok(BigInt(row.commitStart)<=BigInt(row.end));
    assert.ok(row.lockWaitMs>=row.commitLockWaitMs);assert.ok(row.commitAndFsyncMs>=0);
  }finally{observer.close();}
  assert.equal(DatabaseSync.prototype.exec,exec);assert.equal(f.db.prepare('PRAGMA busy_timeout').get().timeout,before);
});
test('retained full-read measurement preserves payload, hierarchy, fence and canonical opens',async()=>{
  const calls=[],source={ref:{namespace:{ownerId:'synthetic',scope:'personal',projectId:null},conversationId:'session',messageId:'message',span:{start:0,end:16}},
    ordinal:1,role:'user',totalUnits:16};
  const storage={async search(){calls.push('snapshot');return {rows:[{key:'segment',source,postings:rawSearchPostings('copper telescope'),chunks:[]}],timings:{}};}};
  const authority={fence(){calls.push('fence');},check(value){assert.equal(value,source);calls.push('check');},async open(value){assert.equal(value,source);calls.push('open');}};
  const result=await measureRawFullRead(storage,authority);
  assert.deepEqual(calls,['snapshot','fence','check','open']);assert.equal(result.selected.length,1);assert.equal(result.opening.length,1);
});
test('cold measurement keeps factory opening separate from the original search clock',async()=>{
  let now=0;const service={},value={};
  const result=await measureRawColdSearch(async()=>{now+=50;return service;},async selected=>{
    assert.equal(selected,service);now+=30;return value;
  },()=>now);
  assert.deepEqual(result,{value,ms:30,factoryMs:50,totalMs:80});
});
