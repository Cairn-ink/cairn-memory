import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore, openMemoryStore, openMemoryReader } from '../index.mjs';
import { transaction, readTransaction } from '../database.mjs';
import { attestContentSafety, installedContentLayout, checkInstalledContentSafety } from '../content-safety-schema.mjs';
import { suppressOwnerInside, writeContentSuppressionInside } from '../content-suppression-storage.mjs';
import { createTopicOverviewStorage } from '../topic-overview-storage.mjs';
import { createTopicSession } from '../topic-members-session.mjs';
import { openContextReadSidecar } from '../context-read-sidecar.mjs';
import { openRawCaptureCore } from '../raw-capture.mjs';
import { cardHost } from '../testing/raw-source-fixtures.mjs';
import { request, splitRaw, localPlainPort } from '../testing/raw-capture-fixtures.mjs';
import { host as contextHost } from '../testing/context-read-core-fixture.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';
import { createFakeEmbedder } from '../context-read-embedder.mjs';
import { safetyFixture, ns, ok, receipt } from '../testing/content-safety-s2h-fixture.mjs';

async function setup(t, base = 18) {
  const f = safetyFixture(t, base); await f.migrate();
  let callback;
  const core = openMemoryCore({ path:f.path, model:{ countTokens(text) { callback?.(text); return 1; } } }), db = f.connect();
  t.after(() => { core.close(); db.close(); });
  const memory = ok(core.admit({ namespace:ns,memory:{ content:'Synthetic protected body',kind:'fact' },receipts:[receipt('protected','Synthetic protected receipt')] })).memory;
  const placed = ok(core.applyPlacement({ namespace:ns,proposal:{ items:[{ memoryId:memory.id,parentIds:[],newL1:{ title:'Synthetic protected title',parentL2Ids:[],newL2Title:'Synthetic parent title' } }] },
    expectedMemoryRevisions:[{ memoryId:memory.id,revision:memory.revision }],expectedIndexRevision:ok(core.map({ namespace:ns })).indexRevision }));
  const current = placed.memories[0];
  return { ...f,core,db,memory:current,placed,arm(fn) { callback=fn; } };
}
const hide = value => assert.doesNotMatch(JSON.stringify(value), /Synthetic protected body|Synthetic protected receipt|Synthetic protected title|Synthetic parent title/);
const owner = f => transaction(f.db,() => suppressOwnerInside(f.db,{ ownerId:ns.ownerId,reason:'account_erasure',actionId:'synthetic-erasure' }));
function fact(f, mode) {
  return transaction(f.db,() => writeContentSuppressionInside(f.db,{ namespace:ns,kind:mode==='namespace'?'namespace':'memory',
    key:mode==='namespace'?'':f.memory.id,matchMode:mode,reason:'privacy_erase',actionId:'synthetic-'+mode,
    ...(mode==='version'?{sourceVersion:JSON.stringify(['memory-revision-v1',f.memory.revision])}:{}),
    ...(mode==='revision-through'?{sourceVersion:JSON.stringify(['memory-revision-through-v1',f.memory.revision])}:{}) }));
}
for (const mode of ['owner','namespace','incarnation','version','revision-through']) test(`review R1 map/topic enumeration denies pending ${mode} facts without tombstones`, async t => {
  const f=await setup(t); const epoch=f.db.prepare('SELECT epoch FROM namespace_epochs').get().epoch;
  if(mode==='owner')owner(f);else fact(f,mode);
  assert.equal(f.db.prepare('SELECT deleted FROM memories WHERE id=?').get(f.memory.id).deleted,0);
  assert.equal(f.db.prepare('SELECT epoch FROM namespace_epochs').get().epoch,epoch);
  hide(f.core.get({ namespace:ns,memoryId:f.memory.id }));
  for(const purpose of ['recall','classification']) hide(f.core.map({ namespace:ns,purpose }));
  const storage=createTopicOverviewStorage(f.db);
  if(['owner','namespace'].includes(mode)) {
    assert.throws(()=>readTransaction(f.db,()=>storage.snapshot(ns)),{code:'index_unavailable'});
    const reader=openMemoryReader({path:f.path,ownerId:ns.ownerId});t.after(()=>reader.close());
    assert.equal((await reader.readTopicMembers({namespace:ns,selection:{type:'unfiled'},accessRevision:'synthetic'})).ok,false);
    f.db.exec("UPDATE content_suppressions SET cleanup_status='complete',cleanup_attempt=cleanup_attempt+1");
    assert.equal(f.core.map({namespace:ns}).ok,false);return;
  }
  const snapshot=readTransaction(f.db,()=>storage.snapshot(ns));
  const state=storage.create(ns,{memberLimit:10},snapshot);
  readTransaction(f.db,()=>{while(!state.scan.next().done){};});
  const overview=state.finish();hide(overview);assert.equal(state.totals.unique.total,0);assert.ok(overview.every(n=>n.memberRefs.length===0));
  const reader=openMemoryReader({path:f.path,ownerId:ns.ownerId});t.after(()=>reader.close());
  let cursor,items=[];
  do {const page=ok(await reader.readTopicMembers({namespace:ns,selection:{type:'unfiled'},accessRevision:'synthetic',...(cursor?{cursor}:{})}));items.push(...page.items);cursor=page.nextCursor;}while(cursor);
  assert.equal(items.some(i=>i.id===f.memory.id),false);
  f.db.exec("UPDATE content_suppressions SET cleanup_status='complete',cleanup_attempt=cleanup_attempt+1");
  hide(f.core.map({namespace:ns}));
});
test('review R1 map final delivery refuses a fact committed by the final counter',async t=>{
  const f=await setup(t);let fired=false;
  f.arm(text=>{if(!fired&&text.startsWith('{"ok":true,"value":')){fired=true;owner(f);}});
  const result=f.core.map({namespace:ns});assert.equal(fired,true);assert.equal(result.ok,false);hide(result);
});
test('review R1 topic snapshot fences invalidate cached and partially traversed pages after a fact',async t=>{
  const f=await setup(t),session=createTopicSession(f.path);t.after(()=>session.dispose());session.prepare({charge(){},request:{}});
  session.transaction(()=>session.snapshot(ns));owner(f);assert.throws(()=>session.transaction(()=>session.snapshot(ns)),{code:'index_unavailable'});
  const reader=openMemoryReader({path:f.path,ownerId:ns.ownerId});t.after(()=>reader.close());
  hide(await reader.readTopicOverview({namespace:ns}));
});
test('review R2 legacy vector refresh never dispatches retained suppressed text',async t=>{
  for(const late of [false,true]){
    const f=await setup(t),side=openContextReadSidecar({path:f.path,db:f.db});t.after(()=>side.close());
    const input={readSet:[ns],types:['memory'],intent:'current',accessGeneration:1,budget:{maxItems:1024,maxMs:5000}};
    for(let i=0;i<20;i++)if(side.reconcile(input).status==='complete')break;
    let calls=0,armed=late,checks=0;const embedder={...createFakeEmbedder(),embed(texts){calls++;return texts.map(()=>[1,0]);}};
    if(!late)owner(f);
    await assert.rejects(()=>side.refreshVectors(input,embedder,{isCurrent(){if(armed&&++checks===3){armed=false;owner(f);}return true;}}));assert.equal(calls,0);
  }
});
test('review R3 legacy get/list/search omit a pending receipt privacy fact by id',async t=>{
  const f=await setup(t),store=openMemoryStore({path:f.path});t.after(()=>store.close());const scoped=store.scope({ownerId:ns.ownerId,projectId:ns.projectId});
  const id=f.db.prepare('SELECT id FROM receipts WHERE memory_id=?').get(f.memory.id).id;
  transaction(f.db,()=>writeContentSuppressionInside(f.db,{namespace:ns,kind:'receipt',key:id,reason:'privacy_erase',actionId:'receipt-pending'}));
  assert.equal(f.db.prepare('SELECT excerpt FROM receipts WHERE id=?').get(id).excerpt,'Synthetic protected receipt');
  for(const value of [scoped.get(f.memory.id),scoped.list(),scoped.search('protected')]){
    assert.doesNotMatch(JSON.stringify(value),/Synthetic protected receipt/);assert.match(JSON.stringify(value),/Synthetic protected body/);
  }
  f.db.exec("UPDATE content_suppressions SET cleanup_status='complete',cleanup_attempt=cleanup_attempt+1");
  assert.doesNotMatch(JSON.stringify(scoped.get(f.memory.id)),/Synthetic protected receipt/);
});
test('review R4 failed attestation poisons repeated reads and writes for the handle lifetime',async t=>{
  const f=await setup(t),guard=f.db.prepare("SELECT sql FROM sqlite_schema WHERE name='safety_memories_insert'").get().sql;
  f.db.exec('DROP TRIGGER safety_memories_insert');
  const before=f.db.prepare('SELECT count(*) n FROM mocs').get().n;
  const results=[f.core.map({namespace:ns}),f.core.map({namespace:ns}),
    f.core.applyPlacement({namespace:ns,proposal:{items:[{memoryId:f.memory.id,parentIds:[],newL1:{title:'Never committed',parentL2Ids:[]}}]},expectedMemoryRevisions:[{memoryId:f.memory.id,revision:f.memory.revision}],expectedIndexRevision:3})];
  assert.deepEqual(results.map(result=>result.error?.code),['unsupported_database','unsupported_database','unsupported_database']);
  assert.equal(f.db.prepare('SELECT count(*) n FROM mocs').get().n,before);
  f.db.exec(guard);assert.equal(f.core.map({namespace:ns}).error?.code,'unsupported_database');
  let failHeader=true;const first=new Proxy(f.db,{get(target,key){if(key==='prepare')return sql=>{if(failHeader&&sql==='PRAGMA user_version'){failHeader=false;throw Error('synthetic_header_failure');}return target.prepare(sql);};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
  assert.throws(()=>attestContentSafety(first),{code:'unsupported_database'});
  assert.throws(()=>installedContentLayout(first),{code:'unsupported_database'});
  assert.throws(()=>checkInstalledContentSafety(first),{code:'unsupported_database'});
});
test('review R5 deterministic DDL interleaving cannot cache old guards under a new cookie',async t=>{
  const f=await setup(t),other=f.connect();t.after(()=>other.close());let fired=false;
  const wrapped=new Proxy(f.db,{get(target,key){if(key==='prepare')return sql=>{const stmt=target.prepare(sql);if(sql.includes("name GLOB 'content_safety_*'"))return new Proxy(stmt,{get(s,k){if(k==='iterate')return function*(...args){yield* s.iterate(...args);other.exec('DROP TRIGGER safety_memories_insert');fired=true;};const value=Reflect.get(s,k,s);return typeof value==='function'?value.bind(s):value;}});return stmt;};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
  assert.throws(()=>attestContentSafety(wrapped,34),{code:'unsupported_database'});assert.equal(fired,true);assert.throws(()=>installedContentLayout(wrapped),{code:'unsupported_database'});
});

for(const optin of [false,true])test(`review R1 topic overview cached page rechecks suppression ${optin?'snapshot':'legacy'}`,async t=>{
  const f=await setup(t),reader=openMemoryReader({path:f.path,ownerId:ns.ownerId});t.after(()=>reader.close());
  const input={namespace:ns,nodeLimit:1,workLimit:50000,...(optin?{snapshotVersion:'topic-snapshot-v1'}:{})};
  let page=ok(await reader.readTopicOverview(input));while(!page.items.length&&page.nextCursor)page=ok(await reader.readTopicOverview({...input,cursor:page.nextCursor}));
  assert.ok(page.nextCursor);const cursor=page.nextCursor;const second=ok(await reader.readTopicOverview({...input,cursor}));assert.ok(second.items.length);
  owner(f);const replay=await reader.readTopicOverview({...input,cursor});assert.ok(['cursor_stale','index_unavailable'].includes(replay.error?.code));hide(replay);
});
test('review R1 topic members cached and paged rows recheck owner suppression',async t=>{
  const f=await setup(t);for(let i=0;i<3;i++)ok(f.core.admit({namespace:ns,memory:{content:'Unfiled synthetic '+i,kind:'fact'},receipts:[receipt('unfiled-'+i)]}));
  const reader=openMemoryReader({path:f.path,ownerId:ns.ownerId});t.after(()=>reader.close());
  const input={namespace:ns,selection:{type:'unfiled'},accessRevision:'synthetic',limit:1,workLimit:50000};
  let page=ok(await reader.readTopicMembers(input));while(!page.items.length&&page.nextCursor)page=ok(await reader.readTopicMembers({...input,cursor:page.nextCursor}));
  assert.ok(page.nextCursor);const cursor=page.nextCursor;assert.ok(ok(await reader.readTopicMembers({...input,cursor})).items.length);
  owner(f);const replay=await reader.readTopicMembers({...input,cursor});assert.ok(['cursor_stale','index_unavailable'].includes(replay.error?.code));
});

test('review R1 pending facts deny temporal metadata, session context and relation endpoint metadata',async t=>{
  const f=await setup(t);const other=ok(f.core.admit({namespace:ns,memory:{content:'Synthetic other body',kind:'fact'},receipts:[receipt('other')]})).memory;
  const pair=[f.memory,other].sort((a,b)=>a.id<b.id?-1:1);
  f.db.prepare("INSERT INTO memory_conflicts VALUES(?,?,?,?,?,?)").run(pair[0].id,pair[0].revision,pair[1].id,pair[1].revision,'contradicts','explicit-hint');
  fact(f,'incarnation');
  const got=ok(f.core.get({namespace:ns,memoryId:other.id}));assert.equal(got.conflicts.some(c=>c.memoryId===f.memory.id),false);
  const now=new Date(),since=new Date(now.getTime()-86400000).toISOString(),until=new Date(now.getTime()+86400000).toISOString();
  const range=f.core.listMemoriesByTime({namespace:ns,since,until,timeBasis:'revision'});assert.equal(range.error?.code,'revision_conflict');assert.doesNotMatch(JSON.stringify(range),new RegExp(f.memory.id));
  const context=ok(f.core.sessionStartContext({namespace:ns,groups:{background:true}}));hide(context);
});

for(const method of ['getConversation','resolveSourceReferences'])test(`review R2 ${method} rechecks each retained crypto-port payload after an earlier opening commits erasure`,async t=>{
  const f=safetyFixture(t,33);await f.migrate();const db=f.connect(),host=cardHost(),base=localPlainPort();let armed=false,calls=0;
  const port={...base,async openRaw(value){if(armed)calls++;const result=await base.openRaw(value);if(armed&&calls===1)transaction(db,()=>suppressOwnerInside(db,{ownerId:ns.ownerId,reason:'account_erasure',actionId:'during-open'}));return result;}};
  const core=openRawCaptureCore({path:f.path,privateCards:host.options,model:{...rationaleModel(),extract:()=>({items:[]})}},
    {mode:'raw-v1',port,sources:true,readPolicy:()=>({generation:'synthetic',reason:null})});t.after(()=>{core.close();db.close();});
  const text='Synthetic protected multi part retained source',parts=splitRaw(text,{size:12});let raw;
  for(let i=0;i<parts.length;i++)raw=ok(await core.captureRaw(request(parts[i],{namespace:ns,client:'codex',sessionId:'port-source',eventId:'port-'+i})));
  const conversationId=raw.raw.conversationId,revision=db.prepare('SELECT revision FROM raw_conversations WHERE id=?').get(conversationId).revision;
  armed=true;
  const result=method==='getConversation'?await core.getConversation({namespace:ns,conversationId}):await host.call(core,method,{namespace:ns,anchors:[{rawAnchor:{conversationId,messageId:parts[0].id,start:0,end:text.length,precision:'exact'},expectedConversationRevision:revision}]});
  assert.equal(result.ok,false);assert.equal(calls,1);assert.doesNotMatch(JSON.stringify(result),/Synthetic protected|multi part retained/);
});

test('review R2 budget callbacks cannot bypass the retained-source check in the legacy embedding adapter',async t=>{
  const f=await setup(t),side=openContextReadSidecar({path:f.path,db:f.db}),input={readSet:[ns],types:['memory'],intent:'current',accessGeneration:1,budget:{maxItems:1024,maxMs:5000}};
  for(let i=0;i<20;i++)if(side.reconcile(input).status==='complete')break;side.close();
  const trusted=contextHost(),fake=createFakeEmbedder();let calls=0,fired=false;
  const core=openMemoryCore({path:f.path,contextRead:{version:'context-read-v1',authority:trusted.authority,
    embedder:{...fake,embed(...args){calls++;return fake.embed(...args);}},policy:{family:'hosted',maxRequests:10,maxUsd:1,maxConcurrent:1,
      estimateUsd(){if(!fired){fired=true;owner(f);}return 0;}}}});t.after(()=>core.close());
  const {accessGeneration,...request}=input;const result=await trusted.call(core,'refreshContextIndex',request);
  assert.equal(fired,true);assert.equal(calls,0);hide(result);
});

test('review R1 semantic candidate enumeration omits facts before delivery while retaining its final check',async t=>{
  const f=await setup(t),trusted=contextHost(),fake=createFakeEmbedder();
  const core=openMemoryCore({path:f.path,contextRead:{version:'context-read-v1',authority:trusted.authority,embedder:fake,
    policy:{family:'hosted',maxRequests:100,maxUsd:1,maxConcurrent:1,estimateUsd:()=>0}}});t.after(()=>core.close());
  const input={readSet:[ns],types:['memory'],intent:'current',budget:{maxItems:1024,maxMs:5000}};
  for(let i=0;i<20;i++)if(ok(await trusted.call(core,'refreshContextIndex',input)).status==='complete')break;
  const query={readSet:[ns],types:['memory'],intent:'current',query:'Synthetic',semantic:true};
  assert.ok(ok(await trusted.call(core,'findCandidates',query)).items.some(item=>item.ref.memoryId===f.memory.id));
  owner(f);const after=await trusted.call(core,'findCandidates',query);assert.equal(after.ok,false);hide(after);
});

test('review R2 ordered reconciliation revalidates its actual retained candidate set before dispatch',async t=>{
  const f=safetyFixture(t);await f.migrate();const db=f.connect();let armed=false,fired=false,target,calls=0;
  const model={...rationaleModel(),extract:({input})=>({items:[{content:input.messages[0].content,kind:'fact',confidence:.8,sourceIndices:[0]}]}),
    reconcile(){calls++;return{transitions:[]};},countTokens(text){
      if(armed&&!fired&&text.startsWith('{"system":')&&text.includes('"candidates":')){
        fired=true;transaction(db,()=>writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:target,reason:'privacy_erase',actionId:'during-reconciliation'}));
      }return 1;}};
  const core=openMemoryCore({path:f.path,model});t.after(()=>{core.close();db.close();});
  const capture=(sequence,content)=>core.capture({namespace:ns,client:'synthetic',sessionId:'ordered',eventId:'event-'+sequence,causal:{streamId:'synthetic-stream',sequence},messages:[{id:'source-'+sequence,role:'user',content}]});
  target=ok(await capture(1,'Synthetic protected candidate one')).admission.memories[0].id;
  ok(await capture(2,'Synthetic candidate two'));assert.equal(calls,1);calls=0;armed=true;
  const result=await capture(3,'Synthetic candidate three');assert.equal(fired,true);assert.equal(calls,0);assert.equal(result.ok,false);hide(result);
});

test('review baseline d0d88512 fails each R1–R5 regression in an unmodified frozen runtime scratch tree',t=>{
  const f=safetyFixture(t),root=join(f.workspace.path,'baseline-runtime');mkdirSync(root);
  const unpack=spawnSync('tar',['-xf',fileURLToPath(new URL('./fixtures/content-safety-openers.tgz',import.meta.url)),'-C',root,'baseline'],{encoding:'utf8'});assert.equal(unpack.status,0,unpack.stderr);
  const old=name=>pathToFileURL(join(root,'baseline','core',name)).href;
  const program=`import test from 'node:test';import assert from 'node:assert/strict';
import {openMemoryCore,openMemoryStore} from ${JSON.stringify(old('index.mjs'))};
import {openContextReadSidecar} from ${JSON.stringify(old('context-read-sidecar.mjs'))};
import {attestContentSafety} from ${JSON.stringify(old('content-safety-schema.mjs'))};
import {createFakeEmbedder} from ${JSON.stringify(old('context-read-embedder.mjs'))};
import {safetyFixture,ns,ok,receipt} from ${JSON.stringify(new URL('../testing/content-safety-s2h-fixture.mjs',import.meta.url).href)};
import {transaction} from ${JSON.stringify(new URL('../database.mjs',import.meta.url).href)};
import {suppressOwnerInside,writeContentSuppressionInside} from ${JSON.stringify(new URL('../content-suppression-storage.mjs',import.meta.url).href)};
async function setup(t){const f=safetyFixture(t);await f.migrate();const db=f.connect(),core=openMemoryCore({path:f.path,model:{countTokens:()=>1}});t.after(()=>{core.close();db.close();});const memory=ok(core.admit({namespace:ns,memory:{content:'Synthetic baseline retained body',kind:'fact'},receipts:[receipt('old','Synthetic baseline receipt')]})).memory;return{...f,db,core,memory};}
const erase=f=>transaction(f.db,()=>suppressOwnerInside(f.db,{ownerId:ns.ownerId,reason:'account_erasure',actionId:'erase'}));
test('R1 map fact gate',async t=>{const f=await setup(t);erase(f);assert.equal(JSON.stringify(f.core.map({namespace:ns})).includes('Synthetic baseline retained body'),false,'R1_map_fact_gate');});
test('R2 retained embedder gate',async t=>{const f=await setup(t),side=openContextReadSidecar({path:f.path,db:f.db});t.after(()=>side.close());const input={readSet:[ns],types:['memory'],intent:'current',accessGeneration:1,budget:{maxItems:1024,maxMs:5000}};for(let i=0;i<20;i++)if(side.reconcile(input).status==='complete')break;erase(f);let calls=0;const fake=createFakeEmbedder();await side.refreshVectors(input,{...fake,embed(...args){calls++;return fake.embed(...args);}},{isCurrent:()=>true});assert.equal(calls,0,'R2_retained_embedder');});
test('R3 receipt fact gate',async t=>{const f=await setup(t),store=openMemoryStore({path:f.path});t.after(()=>store.close());const id=f.db.prepare('SELECT id FROM receipts WHERE memory_id=?').get(f.memory.id).id;transaction(f.db,()=>writeContentSuppressionInside(f.db,{namespace:ns,kind:'receipt',key:id,reason:'privacy_erase',actionId:'receipt'}));assert.equal(JSON.stringify(store.scope({ownerId:ns.ownerId,projectId:ns.projectId}).get(f.memory.id)).includes('Synthetic baseline receipt'),false,'R3_receipt_fact_gate');});
test('R4 refused handle',async t=>{const f=await setup(t);f.db.exec('DROP TRIGGER safety_memories_insert');f.core.map({namespace:ns});assert.equal(f.core.map({namespace:ns}).error?.code,'unsupported_database','R4_handle_refused');});
test('R5 cookie race',async t=>{const f=await setup(t),other=f.connect();t.after(()=>other.close());const db=new Proxy(f.db,{get(target,key){if(key==='prepare')return sql=>{const s=target.prepare(sql);if(sql.includes("name GLOB 'content_safety_*'"))return new Proxy(s,{get(stmt,k){if(k==='all')return(...args)=>{const rows=stmt.all(...args);other.exec('DROP TRIGGER safety_memories_insert');return rows;};const v=Reflect.get(stmt,k,stmt);return typeof v==='function'?v.bind(stmt):v;}});return s;};const v=Reflect.get(target,key,target);return typeof v==='function'?v.bind(target):v;}});assert.throws(()=>attestContentSafety(db,34),{code:'unsupported_database'},'R5_cookie_race');});`;
  const script=join(root,'regressions.test.mjs');writeFileSync(script,program);
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const child=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-concurrency=1',script],{cwd:root,env,encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
  assert.equal(child.error,undefined);assert.equal(child.signal,null);assert.equal(child.status,1,child.stderr+child.stdout);
  assert.match(child.stdout,/# tests 5\b/);assert.match(child.stdout,/# fail 5\b/);
  for(const marker of ['R1_map_fact_gate','R2_retained_embedder','R3_receipt_fact_gate','R4_handle_refused','R5_cookie_race'])assert.ok(child.stdout.includes(marker),marker+' did not fail its intended assertion\n'+child.stdout);
  t.diagnostic('d0d88512 frozen runtime: five intended regression assertions fail; child exit=1; no Git history required');
});
