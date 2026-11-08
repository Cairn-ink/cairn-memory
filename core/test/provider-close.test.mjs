import assert from 'node:assert/strict';
import test from 'node:test';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {contextBudget} from '../context-read-budget.mjs';
import {setTimeout as delay} from 'node:timers/promises';
import {openMemoryCore} from '../index.mjs';
import {createLocalRawSearch} from '../local-raw-search.mjs';
import {defaultRawOptions} from '../local-defaults.mjs';
import {createFakeEmbedder} from '../context-read-embedder.mjs';
import {installRawSearchTestClock,rawSearchTestWait} from '../testing/raw-search-clock.mjs';
import {createTestWorkspace} from '../../tools/testing/workspace.mjs';

// Filesystem bytes are read by a child that never imports SQLite.
function sidecarSnapshot(path) {
  const child=spawnSync(process.execPath,['--input-type=module','-e',`
    import {readdirSync,readFileSync} from 'node:fs';
    import {join} from 'node:path';
    import {createHash} from 'node:crypto';
    const rows=[];
    function walk(path){for(const entry of readdirSync(path,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
      const file=join(path,entry.name);if(entry.isDirectory())walk(file);
      else rows.push([file,createHash('sha256').update(readFileSync(file)).digest('hex')]);}}
    walk(process.argv[1]);process.stdout.write(JSON.stringify(rows));
  `,path+'.raw-search'],{encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);return child.stdout;
}

for (const scheduled of [false,true]) for (const lateFailure of [false,true]) test('local lane close detaches '+(scheduled?'scheduled':'explicit')+' provider (late '+(lateFailure?'rejection':'result')+')',async t=>{
  installRawSearchTestClock(t);
  const workspace=createTestWorkspace(t),path=join(workspace.path,'memory.sqlite');
  const core=openMemoryCore({raw:true,path,rawSearch:false});
  const ns={ownerId:'synthetic-owner',scope:'personal',projectId:null};
  await core.capture({namespace:ns,client:'codex',sessionId:'session',eventId:'event',messages:[{id:'message',role:'user',content:'synthetic cobalt telescope'}]});
  let started,release,aborted=false,completed=0;
  const began=new Promise(resolve=>{started=resolve;}), gate=new Promise(resolve=>{release=resolve;});
  const base=createFakeEmbedder({dimensions:8});
  const embedder={...base,id:'synthetic-never-settles-'+scheduled+'-'+lateFailure,async embed(texts,controls){
    controls.signal.addEventListener('abort',()=>{aborted=true;},{once:true});
    started();await gate;if(lateFailure&&++completed===1)throw Error('synthetic_provider_failure');return base.embed(texts);
  }};
  const manager=createLocalRawSearch(path,defaultRawOptions().port,{embedder,policy:{family:'hosted',maxRequests:10,maxConcurrent:1,maxUsd:1,estimateUsd:()=>0}});
  let active;
  try {
    let didBegin=false;
    for(let i=0;i<12&&!didBegin;i++) {
      await rawSearchTestWait(1010);
      if(scheduled&&i>0) {
        didBegin=await Promise.race([began.then(()=>true),delay(1100).then(()=>false)]);
        continue;
      }
      active=manager.methods.maintainRawSearch({namespace:ns});
      didBegin=await Promise.race([began.then(()=>true),active.then(result=>{assert.equal(result.ok,true,JSON.stringify(result));return false;})]);
    }
    assert.equal(didBegin,true,'provider was never invoked');
    const closing=manager.close();
    const closeBounded=await Promise.race([closing.then(()=>true),delay(2500).then(()=>false)]);
    t.diagnostic(JSON.stringify({abortObserved:aborted,closeSettledWithin2500ms:closeBounded}));
    // Release our synthetic hung promise so no test or worker remains running.
    if(closeBounded) {
      const before=sidecarSnapshot(path);
      // Detachment must keep the unsettled provider's concurrency reservation.
      const dispatch=contextBudget({budgetConfigured:true,embedder,policy:{family:'hosted',maxRequests:10,maxConcurrent:1,maxUsd:1,estimateUsd:()=>0}});
      await assert.rejects(dispatch(embedder,['synthetic query'],{signal:new AbortController().signal,deadlineAt:performance.now()+5000,guard(){}}),{code:'budget_denied'});
      release();await active;await closing;await delay(30);
      assert.equal(sidecarSnapshot(path),before,'late provider result wrote after close');
      await dispatch(embedder,['synthetic query'],{signal:new AbortController().signal,deadlineAt:performance.now()+5000,guard(){}});
    } else {release();await active;await closing;}
    assert.equal(aborted,true,'provider must be aborted before shutdown joins');
    assert.equal(closeBounded,true,'close is still awaiting the underlying promise after cancellation');
  } finally {release();await manager.close();await core.close();}
});
