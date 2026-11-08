import assert from 'node:assert/strict';
import test from 'node:test';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {contextBudget} from '../context-read-budget.mjs';
import {setTimeout as delay} from 'node:timers/promises';
import {openMemoryCore} from '../index.mjs';
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

test('default openMemoryCore close settles without waiting forever on Raw provider',async t=>{
  installRawSearchTestClock(t);
  const workspace=createTestWorkspace(t),path=join(workspace.path,'default.sqlite');
  let started,release,aborted=false;
  const began=new Promise(resolve=>{started=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  const base=createFakeEmbedder({dimensions:8});
  const embedder={...base,id:'synthetic-default-hung-provider',async embed(texts,controls){
    controls.signal.addEventListener('abort',()=>{aborted=true;},{once:true});started();await gate;return base.embed(texts);
  }};
  const core=openMemoryCore({raw:true,path,contextRead:{version:'context-read-v1',authority:{authorize(){return null;},isCurrent(){return null;}},embedder,
    policy:{family:'hosted',maxRequests:10,maxConcurrent:1,maxUsd:1,estimateUsd:()=>0}}});
  const ns={ownerId:'synthetic-owner',scope:'personal',projectId:null};
  let active;
  try {
    await core.capture({namespace:ns,client:'codex',sessionId:'session',eventId:'event',messages:[{id:'message',role:'user',content:'synthetic cobalt telescope'}]});
    let didBegin=false;
    for(let i=0;i<12&&!didBegin;i++){
      await rawSearchTestWait(1010);active=core.maintainRawSearch({namespace:ns});
      didBegin=await Promise.race([began.then(()=>true),active.then(result=>{assert.equal(result.ok,true,JSON.stringify(result));return false;})]);
    }
    assert.equal(didBegin,true);
    const closing=core.close();
    const closeBounded=await Promise.race([closing.then(()=>true),delay(2500).then(()=>false)]);
    t.diagnostic(JSON.stringify({abortObserved:aborted,closeSettledWithin2500ms:closeBounded}));
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
    assert.equal(closeBounded,true,'default core.close still waits for the cancelled provider promise');
  }finally{release();await core.close();}
});
