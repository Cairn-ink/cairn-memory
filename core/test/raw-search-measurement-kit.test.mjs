import {installRawSearchTestClock} from '../testing/raw-search-clock.mjs';
import test from 'node:test';
test.beforeEach(installRawSearchTestClock);
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

test('session fence fixture knob uses engine barriers and preserves eligible sources and lexical candidates',async t=>{
  const {savedSource,ns}=await import('../testing/raw-source-fixtures.mjs');
  const {searchFixture}=await import('../testing/raw-search-fixtures.mjs');
  const {openReadDatabase}=await import('../read-database.mjs');
  const {createRawSearchAuthority}=await import('../raw-search-authority.mjs');
  const {seedSessionFences,sessionFenceCount}=await import('../../tools/testing/raw-search-session-fences.mjs');
  const f=sourceFixture(t);await savedSource(f,'Synthetic copper telescope.');const s=await searchFixture(f);
  await s.maintain();const before=await s.search({query:'copper'});
  const reader=openReadDatabase(f.path,{contextRead:true});t.after(()=>reader.db.close());
  const authority=createRawSearchAuthority(reader,s.options),eligible=authority.inventory().rows;
  const count=sessionFenceCount(['--session-fences','7']);assert.equal(sessionFenceCount(['--session-fences=7']),7);
  seedSessionFences(f.path,ns,count);
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_session_fences').get().n,7);
  assert.equal(f.db.prepare("SELECT count(*) n FROM raw_conversations WHERE client='claude-code'").get().n,0);
  assert.deepEqual(authority.inventory().rows,eligible);
  const after=await s.search({query:'copper'}),canonical=result=>result.candidates.map(({proof,publication,...row})=>row);
  assert.deepEqual(canonical(after),canonical(before));assert.ok(after.candidates.length);
  const prepare=DatabaseSync.prototype.prepare;let fenceInputs=0;
  DatabaseSync.prototype.prepare=function(sql){
    const statement=prepare.call(this,sql);
    if(sql.startsWith('SELECT count(*) AS count,')&&sql.includes('raw_session_fences f')){
      const execute=statement.get;statement.get=function(...args){const result=execute.apply(this,args);fenceInputs+=result.count;return result;};
    }return statement;
  };
  try{authority.fence();assert.equal(fenceInputs,count);}finally{DatabaseSync.prototype.prepare=prepare;}
});
test('outcome summaries include errors and empty partials in all-sample latency only',async()=>{
  const {outcomeSummary,selectionSummary}=await import('../../tools/testing/raw-search-window-summary.mjs');
  const report=outcomeSummary([{outcome:'complete',ms:1},{outcome:'partial-with-candidates',ms:2},{outcome:'empty-partial',ms:900},{outcome:'error',ms:1000}]);
  assert.deepEqual(report.outcomes,{complete:1,'partial-with-candidates':1,'empty-partial':1,error:1});
  assert.equal(report.unavailableRate,.5);assert.equal(report.all.p95,1000);assert.equal(report.available.p95,2);
  const units=selectionSummary([{rows:32,holdMs:25},{rows:4,holdMs:3}]);
  assert.equal(units.count,2);assert.equal(units.rows.max,32);assert.equal(units.holdMs.p95,25);assert.equal(units.holdMs.max,25);
});

test('capture phase timeout grows with the requested sample count',async()=>{
  const {captureTimeoutMs}=await import('../../tools/testing/measure-raw-search.mjs');
  assert.equal(captureTimeoutMs(1),90000);assert.ok(captureTimeoutMs(120)>90000);
  assert.ok(captureTimeoutMs(240)>captureTimeoutMs(120));
});
test('phase ledger records each selection snapshot row count and hold on the functional clock',()=>{
  const url=path=>new URL(path,import.meta.url).href;
  const script=`const {installPhaseMeasurement}=await import(${JSON.stringify(url('../../tools/testing/raw-search-phase-loader.mjs'))});const hook=installPhaseMeasurement();
    const {default:test}=await import('node:test');const {default:assert}=await import('node:assert/strict');
    const {performance}=await import('node:perf_hooks');
    const {sourceFixture,savedSource}=await import(${JSON.stringify(url('../testing/raw-source-fixtures.mjs'))});
    const {searchFixture}=await import(${JSON.stringify(url('../testing/raw-search-fixtures.mjs'))});
    const {openReadDatabase}=await import(${JSON.stringify(url('../read-database.mjs'))});
    const {createRawSearchAuthority}=await import(${JSON.stringify(url('../raw-search-authority.mjs'))});
    const {takeSelectionUnits}=await import(${JSON.stringify(url('../../tools/testing/raw-search-phase-ledger.mjs'))});
    test('unit records',async t=>{Object.defineProperty(performance,'now',{configurable:true,value:()=>100});const f=sourceFixture(t);await savedSource(f,'Synthetic copper.');const s=await searchFixture(f);
      const reader=openReadDatabase(f.path,{contextRead:true});t.after(()=>reader.db.close());
      const a=createRawSearchAuthority(reader,s.options),source=a.inventory().rows[0].source;
      const own=Object.getOwnPropertyDescriptor(performance,'now');Object.defineProperty(performance,'now',{configurable:true,value:()=>100});
      try{a.select([{source}],'current',1100).commit();takeSelectionUnits();a.select(Array.from({length:65},()=>({source})),'current',1100);
        const units=takeSelectionUnits();assert.deepEqual(units.map(u=>u.rows),[32,32,1]);assert.deepEqual(units.map(u=>u.checked),[0,0,0]);assert.ok(units.every(u=>u.holdMs===0));
      }finally{if(own)Object.defineProperty(performance,'now',own);else delete performance.now;hook.deregister();}
    });`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',timeout:30000});
  assert.equal(child.status,0,child.stdout+child.stderr);assert.equal(child.signal,null);
});

test('capture profile completes baseline and contended phases on a small fixture',{timeout:120000},async t=>{
  const {captureContention}=await import('../../tools/testing/measure-raw-search.mjs');
  const {safetySourceFixture}=await import('../testing/raw-search-fixtures.mjs');
  const f=safetySourceFixture(t);let calls=0;
  const report=await captureContention(f.path,{async maintain(){calls++;},async status(){return {}; }},null,{captureSamples:120});
  assert.equal(report.baseline.samples,120);assert.equal(report.contended.samples,120);assert.ok(calls>0);
});

test('measurement hooks retain internal error codes and operation deadline overshoot',()=>{
  const url=path=>new URL(path,import.meta.url).href;
  const script=`const {installPhaseMeasurement}=await import(${JSON.stringify(url('../../tools/testing/raw-search-phase-loader.mjs'))});const hook=installPhaseMeasurement();
    const {default:test}=await import('node:test');const {default:assert}=await import('node:assert/strict');
    const {performance}=await import('node:perf_hooks');const {DatabaseSync}=await import('node:sqlite');
    const {sourceFixture,savedSource}=await import(${JSON.stringify(url('../testing/raw-source-fixtures.mjs'))});
    const {searchFixture}=await import(${JSON.stringify(url('../testing/raw-search-fixtures.mjs'))});
    const {takeInternalErrors,takeOperationOvershoots}=await import(${JSON.stringify(url('../../tools/testing/raw-search-phase-ledger.mjs'))});
    test('measurement causes',async t=>{let now=100;Object.defineProperty(performance,'now',{configurable:true,value:()=>now});
      const f=sourceFixture(t);await savedSource(f,'Synthetic copper.');const s=await searchFixture(f);await s.maintain();
      const prepare=DatabaseSync.prototype.prepare;let mode='error',crossed=false;
      DatabaseSync.prototype.prepare=function(sql){const stmt=prepare.call(this,sql);
        if(!crossed&&sql.startsWith('SELECT s.*,h.sequence')){crossed=true;
          if(mode==='error')throw Object.assign(Error('synthetic_internal_failure'),{code:'synthetic_internal_failure'});
          now+=1007;
        }return stmt;};
      try{
        await assert.rejects(s.search({query:'copper'}),{code:'raw_search_unavailable'});
        assert.deepEqual(takeInternalErrors(),['synthetic_internal_failure']);takeOperationOvershoots();
        mode='deadline';crossed=false;const result=await s.search({query:'copper'});
        assert.equal(result.coverage.status,'partial');assert.equal(result.candidates.length,0);
        assert.deepEqual(takeOperationOvershoots(),[7]);
      }finally{DatabaseSync.prototype.prepare=prepare;hook.deregister();}
    });`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',timeout:30000});
  assert.equal(child.status,0,child.stdout+child.stderr);assert.equal(child.signal,null);
});

test('opening deadline cause is recorded before the public factory refusal',()=>{
  const url=path=>new URL(path,import.meta.url).href;
  const script=`const {installPhaseMeasurement}=await import(${JSON.stringify(url('../../tools/testing/raw-search-phase-loader.mjs'))});const hook=installPhaseMeasurement();
    const {default:test}=await import('node:test');const {default:assert}=await import('node:assert/strict');
    const {performance}=await import('node:perf_hooks');const {DatabaseSync}=await import('node:sqlite');
    const {sourceFixture}=await import(${JSON.stringify(url('../testing/raw-source-fixtures.mjs'))});
    const {searchFixture}=await import(${JSON.stringify(url('../testing/raw-search-fixtures.mjs'))});
    const {openRawSearch}=await import(${JSON.stringify(url('../raw-search-index.mjs'))});
    const {takeInternalErrors}=await import(${JSON.stringify(url('../../tools/testing/raw-search-phase-ledger.mjs'))});
    test('opening cause',async t=>{let now=100;Object.defineProperty(performance,'now',{configurable:true,value:()=>now});
      const f=sourceFixture(t),s=await searchFixture(f);await s.service.close();
      const prepare=DatabaseSync.prototype.prepare;let crossed=false;
      DatabaseSync.prototype.prepare=function(sql){const stmt=prepare.call(this,sql);
        if(!crossed&&sql==='PRAGMA application_id'){crossed=true;now+=1001;}return stmt;};
      try{await assert.rejects(openRawSearch(s.options),{code:'raw_search_unavailable'});assert.equal(crossed,true);assert.deepEqual(takeInternalErrors(),['search_deadline']);}
      finally{DatabaseSync.prototype.prepare=prepare;hook.deregister();}
      await s.reopen();
    });`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',timeout:30000});
  assert.equal(child.status,0,child.stdout+child.stderr);assert.equal(child.signal,null);
});
