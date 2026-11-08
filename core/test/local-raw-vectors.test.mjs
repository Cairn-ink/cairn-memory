import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { openMemoryCore } from '../index.mjs';
import { createLocalRawSearch } from '../local-raw-search.mjs';
import { defaultRawOptions } from '../local-defaults.mjs';
import { createFakeEmbedder } from '../context-read-embedder.mjs';
import { contextBudget } from '../context-read-budget.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';
import { installRawSearchTestClock, rawSearchTestWait } from '../testing/raw-search-clock.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

test.beforeEach(installRawSearchTestClock);
const ns = { ownerId:'synthetic-owner', scope:'personal', projectId:null };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const input = (n, namespace = ns, content = 'cobalt telescope') => ({ namespace, client:'codex',
  sessionId:'session', eventId:'event-'+n, messages:[{id:'message-'+n,role:'user',content}] });
const policy = patch => ({family:'hosted',maxRequests:10000,maxUsd:1,maxConcurrent:1,estimateUsd:()=>0,...patch});
function embedding(patch = {}) {
  const base = createFakeEmbedder({dimensions:32,aliases:{observatory:'telescope',azure:'cobalt'}});
  let calls = 0;
  return {embedder:{...base,id:'synthetic-'+randomUUID(),async embed(...args){calls++;return base.embed(...args);}},
    policy:policy(patch),calls:()=>calls};
}
function fixture(t, provider, model = {contextWindow:8192,extract:async()=>({items:[]}),countTokens:()=>1}) {
  const workspace = createTestWorkspace(t), path = join(workspace.path,'memory.sqlite');
  const core = openMemoryCore({path,model,rawSearch:false});
  const manager = createLocalRawSearch(path,defaultRawOptions().port,provider);
  workspace.defer(async()=>{await manager.close();await core.close();});
  return {core,path,manager,search:request=>manager.methods.searchRaw({namespace:ns,...request}),
    async tick(){await rawSearchTestWait(1010);return ok(await manager.methods.maintainRawSearch({namespace:ns}));}};
}
async function ready(f, max = 16) {
  let found;
  for(let n=0;n<max;n++) {
    await f.tick();found=ok(await f.search({query:'azure observatory'}));
    if(found.semantic.state==='ready')return found;
  }
  assert.equal(found.semantic.state,'ready',JSON.stringify(found));
}

test('openMemoryCore forwards its configured context embedder to the default Raw lane',async t=>{
  const workspace=createTestWorkspace(t),path=join(workspace.path,'constructor.sqlite'),provider=embedding();
  const core=openMemoryCore({path,contextRead:{version:'context-read-v1',
    authority:{authorize(){return null;},isCurrent(){return null;}},embedder:provider.embedder,policy:provider.policy}});
  workspace.defer(()=>core.close());
  // Raw retention remains useful without an extraction provider.
  await core.capture(input(1));
  await ready({tick:async()=>{await rawSearchTestWait(1010);return ok(await core.maintainRawSearch({namespace:ns}));},
    search:request=>core.searchRaw({namespace:ns,...request})});
});

test('rawSearch:false retains its meaning with a configured context provider',async t=>{
  const workspace=createTestWorkspace(t),provider=embedding();
  const core=openMemoryCore({path:join(workspace.path,'off.sqlite'),rawSearch:false,
    contextRead:{version:'context-read-v1',authority:{authorize(){return null;},isCurrent(){return null;}},
      embedder:provider.embedder,policy:provider.policy}});
  workspace.defer(()=>core.close());
  await core.capture(input(1));
  assert.equal(core.searchRaw,undefined);assert.equal(core.maintainRawSearch,undefined);assert.equal(provider.calls(),0);
});

test('configured local lane builds vectors, returns semantic-only matches, and semantic:false avoids query calls',async t=>{
  const provider=embedding(),f=fixture(t,provider);
  ok(await f.core.capture(input(1)));
  const before=ok(await f.search({query:'azure observatory'}));
  assert.equal(before.semantic.state,'bm25-only');assert.equal(before.candidates.length,0);
  const found=await ready(f);
  assert.equal(found.candidates[0].messageId,'message-1');
  const calls=provider.calls(),lexical=ok(await f.search({query:'azure observatory',semantic:false}));
  assert.equal(lexical.semantic.state,'bm25-only');assert.equal(lexical.candidates.length,0);assert.equal(provider.calls(),calls);
  const port=f.manager.contextPort([ns]);
  const lexicalMatch=await port.search({query:'cobalt',semantic:false});
  const handle=await port.prepare(structuredClone(lexicalMatch.candidates[0]),{intent:'current'});
  assert.match(port.revalidate([handle])[0].ranges[0].text,/cobalt telescope/);
  assert.equal(provider.calls(),calls);
  const status=ok(await f.manager.methods.getRawSearchStatus({namespace:ns}));
  assert.equal(status.embeddingBudget.scope,'process');assert.equal(status.embeddingBudget.sharedWith,'memory');
});

test('no provider is quiet BM25 and local free policy is accepted',async t=>{
  const f=fixture(t);ok(await f.core.capture(input(1)));await f.tick();
  const found=ok(await f.search({query:'cobalt'}));
  assert.deepEqual(found.semantic,{state:'bm25-only',reason:'disabled'});assert.equal(found.candidates.length,1);
  const provider=embedding();provider.policy={family:'local',maxBatchDocuments:1,maxRequests:100,maxConcurrent:1};
  const local=fixture(t,provider);ok(await local.core.capture(input(1)));await ready(local);
});

for(const contentSafety of [undefined,'s2h-v1'])test(`best vector is withheld after forgetting; namespace and owner isolation (${contentSafety??'legacy'})`,async t=>{
  const workspace=createTestWorkspace(t),path=join(workspace.path,'safety.sqlite'),provider=embedding();
  const core=openMemoryCore({path,rawSearch:false,model:rationaleModel(),...(contentSafety?{contentSafety}:{})});
  const manager=createLocalRawSearch(path,defaultRawOptions().port,provider);
  workspace.defer(async()=>{await manager.close();await core.close();});
  const captured=ok(await core.capture(input(1)));
  ok(await core.capture(input(2,{...ns,scope:'project',projectId:'other-project'})));
  ok(await core.capture(input(3,{...ns,ownerId:'other-owner'})));
  const f={tick:async()=>{await rawSearchTestWait(1010);return ok(await manager.methods.maintainRawSearch({namespace:ns}));},
    search:request=>manager.methods.searchRaw({namespace:ns,...request})};
  const found=await ready(f);assert.equal(found.candidates.length,1);assert.deepEqual(found.candidates[0].namespace,ns);
  const memoryId=captured.admission.memories[0].id,memory=ok(core.get({namespace:ns,memoryId})).memory;
  ok(core.forget({namespace:ns,memoryId,expectedRevision:memory.revision}));
  assert.equal(ok(await f.search({query:'azure observatory'})).candidates.length,0);
});

for(const kind of ['requests','dollars'])test(`Raw and Memory share the process ${kind} budget across local service reopen`,async t=>{
  const provider=embedding(kind==='requests'?{maxRequests:1}:{maxUsd:0.01,estimateUsd:()=>0.01});
  const dispatch=contextBudget({budgetConfigured:true,...provider});
  // A Memory-side dispatch spends the same provider identity's allowance.
  await dispatch(provider.embedder,['synthetic memory'],{signal:new AbortController().signal,deadlineAt:performance.now()+5000,guard(){}});
  const f=fixture(t,provider);ok(await f.core.capture(input(1)));
  for(let n=0;n<4;n++)await f.tick();
  assert.equal(provider.calls(),1);
  const found=ok(await f.search({query:'cobalt'}));assert.equal(found.semantic.state,'bm25-only');assert.equal(found.candidates.length,1);
  await f.manager.close();
  const reopened=createLocalRawSearch(f.path,defaultRawOptions().port,provider);
  t.after(()=>reopened.close());
  await rawSearchTestWait(1010);ok(await reopened.methods.maintainRawSearch({namespace:ns}));
  assert.equal(provider.calls(),1);
  const again=contextBudget({budgetConfigured:true,...provider});
  await assert.rejects(again(provider.embedder,['query'],{signal:new AbortController().signal,deadlineAt:performance.now()+5000,guard(){}}),{code:'budget_denied'});
  const child=spawnSync(process.execPath,['--input-type=module','-e',`
    import { contextBudget } from './core/context-read-budget.mjs';
    const embedder={id:${JSON.stringify(provider.embedder.id)},revision:'1',embed:async()=>[[1]]};
    const dispatch=contextBudget({budgetConfigured:true,embedder,policy:{family:'hosted',maxRequests:1,maxUsd:1,maxConcurrent:1,estimateUsd:()=>0}});
    await dispatch(embedder,['synthetic'],{signal:new AbortController().signal,deadlineAt:performance.now()+5000,guard(){}});
  `],{encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);
});

test('query budget denial is visible in existing Raw status and preserves BM25',async t=>{
  const provider=embedding({maxRequests:2}),f=fixture(t,provider);
  ok(await f.core.capture(input(1)));await ready(f);
  const found=ok(await f.search({query:'cobalt'}));
  assert.deepEqual(found.semantic,{state:'bm25-only',reason:'budget_denied'});
  assert.equal(found.candidates.length,1);
  const status=ok(await f.manager.methods.getRawSearchStatus({namespace:ns}));
  assert.deepEqual(status.semantic,found.semantic);assert.equal(status.embeddingBudget.maxRequests,2);
});

test('500 synthetic turns catch up with the default bounded local lane',async t=>{
  const provider=embedding(),f=fixture(t,provider);
  for(let n=1;n<=500;n++)ok(await f.core.capture(input(n)));
  let quanta=0,found;
  const started=Date.now();
  for(;quanta<1600;quanta++) {
    await f.tick();
    if(quanta%25===0) {
      found=ok(await f.search({query:'azure observatory'}));
      if(found.semantic.state==='ready')break;
    }
  }
  assert.equal(found.semantic.state,'ready',JSON.stringify(found));
  assert.ok(found.candidates.length>0);
  t.diagnostic(JSON.stringify({turns:500,quanta:quanta+1,simulatedSeconds:(quanta+1)*1.01,wallMs:Date.now()-started,providerCalls:provider.calls()}));
});

// A real asynchronous provider must have a deadline independent of 25 ms of
// local work. This regression also proves capture does not join that wait.
test('slow embedding settlement makes progress while capture remains independent',async t=>{
  const provider=embedding(),base=provider.embedder.embed;
  let began,release;
  const started=new Promise(resolve=>{began=resolve;});
  provider.embedder.embed=async(...args)=>{began();await new Promise(resolve=>{release=resolve;setTimeout(resolve,500);});return base(...args);};
  const f=fixture(t,provider);ok(await f.core.capture(input(1)));await f.tick();
  const pending=f.tick();await Promise.race([started,delay(1000).then(()=>{throw Error('embedding_did_not_start');})]);
  const captured=await Promise.race([f.core.capture(input(2)),delay(200).then(()=>{throw Error('capture_waited_for_embedding');})]);ok(captured);
  await delay(60);release();await pending;
  // Restore immediate responses; the first slow result must not poison retries.
  provider.embedder.embed=base;
  await ready(f,30);
});
