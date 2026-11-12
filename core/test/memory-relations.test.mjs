import { installMemoryThreadLayout } from '../testing/install-memory-thread-layout.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { host } from '../testing/context-read-core-fixture.mjs';
import { createFakeEmbedder } from '../context-read-embedder.mjs';
import { assembleThreeLayerContext } from '../context-read-three-layer.mjs';
import { ruleRelation, relateCapturedMemories } from '../memory-relations.mjs';

const ns={ownerId:'synthetic-relations',scope:'personal',projectId:null};
const ok=result=>{assert.equal(result.ok,true,JSON.stringify(result));return result.value;};
function fixture(t,{keyed=true,filing=false,options={},contextOptions={},coreOptions={}}={}){
 const dir=mkdtempSync(join(tmpdir(),'memory-relations-')),path=join(dir,'memory.sqlite');
 const trusted=host();trusted.state.allowed=[ns];
 const calls=[];
 const model={contextWindow:8192,countTokens:()=>1,
  extract:({input})=>({items:input.messages.map((message,index)=>({content:message.content,kind:'fact',confidence:0.9,sourceIndices:[index]}))}),
  classify:({input})=>({items:input.memories.map(memory=>({memoryId:memory.id,parentIds:[],...(filing?{newL1:{title:'Breakfast',parentL2Ids:[]}}:{})}))}),
  ...(keyed?{relateMemories:({input})=>{calls.push(input);return {facts:input.facts.map(fact=>({factIndex:fact.factIndex,eventTime:null,
   edges:[...input.candidates[fact.factIndex]].sort((a,b)=>b.eventTime.localeCompare(a.eventTime)).slice(0,1).map(candidate=>({candidateId:candidate.id,relation:'supersedes',confidence:0.95}))}))};}}:{}),...options};
 const core=openMemoryCore({path,model,...coreOptions,contextRead:{version:'context-read-v1',authority:trusted.authority,counter:{id:'synthetic',countTokens:()=>1},...contextOptions}});
 const db=new DatabaseSync(path);let event=0;
 t.after(async()=>{await core.close();db.close();rmSync(dir,{recursive:true,force:true});});
 const capture=async(content,namespace=ns,occurredAt)=>ok(await core.capture({namespace,client:'synthetic',sessionId:'s',eventId:'batch-'+(++event),messages:[{id:'message-'+event,role:'user',content,...(occurredAt?{occurredAt}:{})}]}));
 const read=async(intent='current',query='breakfast')=>{
  for(let i=0;i<10;i++){const value=ok(await trusted.call(core,'refreshContextIndex',{readSet:[ns],types:['memory'],intent,budget:{maxItems:1024,maxMs:5000}}));if(value.status==='complete')break;}
  return ok(await trusted.call(core,'contextRead',{readSet:[ns],types:['memory'],intent,query,semantic:false,budget:{maxItems:24,maxTokens:6000}}));
 };
 return {core,db,path,model,calls,capture,read,trusted};
}
for(const filing of [false,true])test(`capture derives current from retained chains and retracts after forgetting; filing=${filing}`,async t=>{
 const f=fixture(t,{filing}),ids=[];
 for(let i=0;i<9;i++){
  const admitted=await f.capture(`My breakfast is value ${i}.`);ids.push(admitted.admission.memories[0].id);
  const pack=await f.read();assert.equal(pack.metered.items.length,Math.min(i+1,4));
  assert.equal((pack.metered.items.find(item=>item.metadata?.thread?.status==='current')??pack.metered.items[0]).body,`My breakfast is value ${i}.`);
 }
 assert.equal(f.calls.length,8);
 assert.ok(f.db.prepare('SELECT count(*) n FROM memory_relations').get().n>0);
 const newest=ok(f.core.get({namespace:ns,memoryId:ids.at(-1)})).memory;
 ok(f.core.forget({namespace:ns,memoryId:newest.id,expectedRevision:newest.revision}));
 const restored=await f.read();assert.equal(restored.metered.items.find(item=>item.metadata.thread.status==='current').body,'My breakfast is value 7.');
 assert.equal(f.db.prepare('SELECT count(*) n FROM memory_relations WHERE from_memory_id=? OR to_memory_id=?').get(newest.id,newest.id).n,0);
 const history=await f.read('history');assert.equal(history.metered.items.length,4);
});
test('contradictions deliver both ends with labels and dates',async t=>{
 const f=fixture(t,{options:{relateMemories:({input})=>({facts:input.facts.map(fact=>({factIndex:fact.factIndex,eventTime:null,
  edges:input.candidates[fact.factIndex].map(candidate=>({candidateId:candidate.id,relation:'contradicts',confidence:0.8}))}))})}});
 await f.capture('I like egg pancakes for breakfast.');await f.capture('I stopped eating egg pancakes for breakfast.');
 const pack=await f.read('current','stopped');assert.equal(pack.metered.items.length,2);
 assert.ok(pack.metered.items.every(item=>item.metadata.relations.some(edge=>edge.relation==='contradicts'&&edge.otherEventTime)));
});
test('failed relation call admits with neutral fallback and emits a content-free diagnostic',async t=>{
 const diagnostics=[];const f=fixture(t,{options:{relateMemories:()=>{throw Error('untrusted provider content');},onDiagnostic:value=>diagnostics.push(value)}});
 await f.capture('My breakfast is oats.');await f.capture('My breakfast is eggs.');
 assert.equal(f.db.prepare('SELECT relation FROM memory_relations').get().relation,'same_thread');
 assert.ok(diagnostics.some(value=>value.stage==='relateMemories'&&value.reason==='provider_failure'));
 assert.ok(!JSON.stringify(diagnostics).includes('untrusted provider content'));
});
test('post-validation drops foreign IDs, caps edges and ignores model dates',async()=>{
 const candidates=Array.from({length:8},(_,i)=>({id:'candidate-'+i,revision:1,content:'breakfast',eventTime:'2026-03-01T00:00:00.000Z'}));
 const model={contextWindow:8192,countTokens:()=>1,relateMemories:()=>({facts:[{factIndex:0,eventTime:'2026-02-01T00:00:00.000Z',edges:[
  {candidateId:'foreign',relation:'supersedes',confidence:1},...candidates.slice(0,7).map(candidate=>({candidateId:candidate.id,relation:'supersedes',confidence:0.95}))]}]})};
 const edges=await relateCapturedMemories({model,items:[{content:'new breakfast value'}],operations:{relationCandidates:()=>[candidates]}});
 assert.equal(edges.filter(edge=>!edge.timingOnly).length,5);assert.ok(edges.filter(edge=>!edge.timingOnly).every(edge=>edge.relation==='supersedes'));
});
test('keyless rule emits only neutral links, including Traditional Chinese',()=>{
 for(const [oldText,newText] of [['I like egg pancakes for breakfast','I no longer eat egg pancakes for breakfast'],['我喜歡蛋餅','我不再喜歡蛋餅']]){
  const edges=ruleRelation({content:newText},[{id:'old',content:oldText}]);
  assert.ok(edges.length);assert.equal(edges[0].relation,'same_thread');assert.ok(edges[0].confidence>=0.8);
 }
 assert.deepEqual(ruleRelation({content:'I like pancakes'},[{id:'old',content:'My brother likes pancakes'}]),[]);
});
test('capture candidates and database edges cannot cross owner or namespace',async t=>{
 const f=fixture(t);await f.capture('My breakfast is oats.',{...ns,ownerId:'other-owner'});
 await f.capture('My breakfast is eggs.',{...ns,scope:'project',projectId:'other-project'});
 await f.capture('My breakfast is pancakes.');assert.equal(f.calls.length,0);
 await f.capture('My breakfast is toast.');
 const all=f.db.prepare('SELECT id,revision,owner_id,scope FROM memories ORDER BY id').all();
 const rows=[all.find(row=>row.owner_id==='other-owner'),all.find(row=>row.owner_id===ns.ownerId&&row.scope==='personal')];
 assert.throws(()=>f.db.prepare(`INSERT INTO memory_relations(id,from_memory_id,from_revision,to_memory_id,to_revision,relation,confidence,decided_by,receipt_id,event_time,created_at) VALUES('bad',?,?,?,?,'contradicts',1,'user',NULL,NULL,'now')`).run(rows[0].id,rows[0].revision,rows[1].id,rows[1].revision),/invalid_relation_boundary/);
});
test('correction invalidates every old revision edge atomically',async t=>{
 const f=fixture(t);await f.capture('My breakfast is oats.');const last=await f.capture('My breakfast is pancakes.');
 const memory=ok(f.core.get({namespace:ns,memoryId:last.admission.memories[0].id})).memory;
 ok(f.core.correct({namespace:ns,memoryId:memory.id,expectedRevision:memory.revision,content:'My breakfast is rice.',kind:'fact',receipt:{client:'synthetic',sessionId:'s',eventId:'correction',role:'user',excerpt:'My breakfast is rice.'}}));
 assert.equal(f.db.prepare('SELECT count(*) n FROM memory_relations').get().n,0);
});
test('optional relation insertion failure rolls back only relations and admits the Memory',async t=>{
 const f=fixture(t);await f.capture('My breakfast is oats.');await f.capture('My breakfast is eggs.');
 f.db.exec(`CREATE TRIGGER relation_failure BEFORE INSERT ON memory_relations BEGIN SELECT RAISE(ABORT,'synthetic'); END`);
 const result=await f.core.capture({namespace:ns,client:'synthetic',sessionId:'s',eventId:'failed',messages:[{id:'failed-message',role:'user',content:'My breakfast is pancakes.'}]});
 assert.equal(result.ok,true,JSON.stringify(result));assert.equal(f.db.prepare('SELECT count(*) n FROM memories').get().n,3);
 assert.equal(f.db.prepare('SELECT count(*) n FROM receipts').get().n,3);
 assert.equal(f.db.prepare('SELECT count(*) n FROM memory_relations').get().n,1);
});
test('suppressed endpoints never enter the delivery pack through a relation',async t=>{
 const f=fixture(t,{options:{relateMemories:({input})=>({facts:input.facts.map(fact=>({factIndex:fact.factIndex,eventTime:null,edges:input.candidates[fact.factIndex].map(c=>({candidateId:c.id,relation:'contradicts',confidence:0.9}))}))})}});
 await f.capture('My breakfast is oats.');const result=await f.capture('My breakfast is pancakes.');
 const id=result.admission.memories[0].id;
 // Legacy suppression uses the same public forgetting boundary; the safety
 // layouts' durable suppression matrix is covered by the dedicated read gates.
 const memory=ok(f.core.get({namespace:ns,memoryId:id})).memory;
 ok(f.core.forget({namespace:ns,memoryId:id,expectedRevision:memory.revision}));
 const pack=await f.read();assert.ok(pack.metered.items.every(item=>item.ref.id!==id&&!JSON.stringify(item.metadata).includes(id)));
});
test('event-time-only decisions admit and file without installing a layout or inventing an edge',async t=>{
 const f=fixture(t,{filing:true,options:{relateMemories:({input})=>({facts:input.facts.map(fact=>({factIndex:fact.factIndex,eventTime:'2020-01-01T00:00:00.000Z',edges:[]}))})}});
 const result=await f.capture('My breakfast changed on 2020-01-01.',ns,'2020-01-01T00:00:00.000Z');
 assert.equal(f.db.prepare('PRAGMA user_version').get().user_version,18);
 assert.deepEqual(f.db.prepare("SELECT name FROM sqlite_schema WHERE name IN ('memory_relations','memory_relation_times')").all(),[]);
 assert.equal(ok(f.core.get({namespace:ns,memoryId:result.admission.memories[0].id})).memory.content,'My breakfast changed on 2020-01-01.');
 assert.ok((await f.read()).metered.items.every(item=>!item.metadata?.thread));
});
for(const causal of [false,true])test(`initial filing retains this capture's new relations and times; causal=${causal}`,async t=>{
 const f=fixture(t);
 const capture=(sequence,content)=>f.core.capture({namespace:ns,client:'synthetic',sessionId:'s',eventId:'owned-'+sequence,
  ...(causal?{causal:{streamId:'owned-stream',sequence}}:{}),messages:[{id:'owned-message-'+sequence,role:'user',content}]});
 ok(await capture(1,'My breakfast is oats.'));
 f.model.classify=({input})=>({items:input.memories.map(memory=>({memoryId:memory.id,parentIds:[],newL1:{title:'New breakfast',parentL2Ids:[]}}))});
 const second=ok(await capture(2,'My breakfast is pancakes.'));
 assert.equal(second.classification.status,'applied');
 const id=second.admission.memories[0].id,memory=ok(f.core.get({namespace:ns,memoryId:id})).memory;
 assert.ok(memory.revision>second.admission.memories[0].revision);
 const edge=f.db.prepare('SELECT * FROM memory_relations WHERE from_memory_id=?').get(id);
 assert.equal(edge.from_revision,memory.revision);
 assert.equal(f.db.prepare('SELECT revision FROM memory_relation_times WHERE memory_id=?').get(id).revision,memory.revision);
 assert.equal((await f.read()).metered.items.find(item=>item.metadata.thread.status==='current').body,'My breakfast is pancakes.');
});
test("initial filing of a repeated receipt invalidates earlier captures' relations and times",async t=>{
 const f=fixture(t);await f.capture('My breakfast is oats.');
 const second=await f.capture('My breakfast is pancakes.');
 const id=second.admission.memories[0].id;
 assert.equal(f.db.prepare('SELECT count(*) n FROM memory_relations').get().n,1);
 f.model.relateMemories=()=>({facts:[]});
 f.model.classify=({input})=>({items:input.memories.map(memory=>({memoryId:memory.id,parentIds:[],newL1:{title:'Filed breakfast',parentL2Ids:[]}}))});
 ok(await f.core.capture({namespace:ns,client:'synthetic',sessionId:'s',eventId:'repeat-source',
  messages:[{id:'message-2',role:'user',content:'My breakfast is pancakes.'}]}));
 const memory=ok(f.core.get({namespace:ns,memoryId:id})).memory;
 assert.ok(memory.revision>second.admission.memories[0].revision);
 assert.equal(f.db.prepare('SELECT count(*) n FROM receipts WHERE memory_id=?').get(id).n,1);
 assert.equal(f.db.prepare('SELECT count(*) n FROM memory_relations').get().n,0);
 assert.equal(f.db.prepare('SELECT count(*) n FROM memory_relation_times WHERE memory_id=?').get(id).n,0);
});
test('causal capture uses the same relation decision and preserves receipt provenance',async t=>{
 const f=fixture(t);let oldCalls=0;f.model.reconcile=()=>{oldCalls++;throw Error('legacy path');};
 for(let i=1;i<=2;i++)ok(await f.core.capture({namespace:ns,client:'synthetic',sessionId:'s',eventId:'causal-'+i,
  causal:{streamId:'stream',sequence:i},messages:[{id:'causal-message-'+i,role:'user',content:'My breakfast is causal value '+i+'.'}]}));
 assert.equal(oldCalls,0);assert.equal(f.calls.length,1);
 assert.equal(f.db.prepare('SELECT count(*) n FROM receipt_causality').get().n,2);
 assert.equal(f.db.prepare("SELECT count(*) n FROM memory_relations WHERE relation='supersedes'").get().n,1);
 assert.equal((await f.read()).metered.items.length,2);
});
test('history carries the newest four members from a unique lexical seed',async t=>{
 const f=fixture(t);installMemoryThreadLayout(f.path);let previous;
 for(let i=0;i<11;i++){
  const memory=ok(f.core.admit({namespace:ns,memory:{content:i===0?'UniqueAnchor original breakfast':'Historical value '+i,kind:'fact'},receipts:[{client:'synthetic',sessionId:'s',eventId:'history-'+i,role:'user',excerpt:'history '+i}]})).memory;
  if(previous)f.db.prepare(`INSERT INTO memory_relations
   (id,from_memory_id,from_revision,to_memory_id,to_revision,relation,confidence,decided_by,event_time,created_at)
   VALUES(?,?,?,?,?,'refines',1,'user',?,?)`).run('chain-'+i,memory.id,memory.revision,previous.id,previous.revision,`2026-01-${String(i+1).padStart(2,'0')}T00:00:00.000Z`,'now');
  previous=memory;
 }
 const pack=await f.read('history','UniqueAnchor');
 assert.equal(pack.metered.items.length,4);
 assert.ok(pack.metered.items.some(item=>item.metadata.thread.status==='current'));
});
test('legacy recall resolves an old selected ref to the newest current memory',async t=>{
 const f=fixture(t);const first=await f.capture('My breakfast is original value.');
 const last=await f.capture('My breakfast is replacement value.');
 const oldId=first.admission.memories[0].id,newId=last.admission.memories[0].id;
 const old=ok(f.core.get({namespace:ns,memoryId:oldId})).memory;
 f.model.select=()=>({refs:[{namespaceIndex:0,memoryId:old.id,revision:old.revision}]});
 f.model.rank=({input})=>({refs:input.candidates.slice(0,1).map(candidate=>({namespaceIndex:candidate.namespaceIndex,memoryId:candidate.memory.id,revision:candidate.memory.revision}))});
 const result=ok(await f.core.recall({readSet:[ns],query:'original',limit:2}));
 assert.equal(result.memories[0].memory.id,newId);
 assert.ok(result.memories.some(item=>item.memory.id===oldId));
 assert.equal(result.memories[0].relations[0].relation,'supersedes');
});

test('Raw coalescing preserves both dated contradictory memory values',()=>{
 const ref=id=>({type:'memory',namespace:ns,memoryId:id,revision:1});
 const prepared=['Breakfast preference is oats.','Breakfast preference is not oats.'].map((text,index)=>({
  type:'memory',ref:ref('value-'+index),ns:0,rank:index+1,text,turnIds:['shared-turn'],sessionIds:[],
  date:index?'2020-01-08T00:00Z':'2020-01-01T00:00Z',sources:[],sourceAccess:'available',sourcesComplete:true,fence:'0'.repeat(64),
  metadata:{state:'active',reviewState:'none',filing:{status:'unfiled'},kind:'fact',origin:'explicit',confidence:1,
   relations:[{memoryId:'value-'+(1-index),revision:1,relation:'contradicts',direction:index?'outgoing':'incoming',label:'contradicts'}]}}));
 const value={namespace:ns,conversationId:'conversation',messageId:'message',role:'user',occurredAt:'2020-01-09T00:00:00.000Z',
  ranges:[{text:'Breakfast source.',source:{span:{start:0,end:17}}}]};
 const result=assembleThreeLayerContext({prepared,query:'Breakfast',readSet:[ns],counter:{id:'synthetic',countTokens:()=>1},
  policy:{id:'rank-first-whole-v1'},budget:{maxItems:24,maxTokens:6000},deadlineAt:performance.now()+10000,
  representation:'representation-v2-dated',snapshotOf:()=>null},
  {items:[{handle:{},value,key:'shared-turn',rank:1}],coverage:'included',rawSearch:{revalidate:()=>[value]}});
 assert.equal(result.metered.items.length,2);assert.deepEqual(result.metered.items.map(item=>item.body),prepared.map(item=>item.text));
 assert.ok(result.metered.items.every(item=>item.metadata.relations.length));
});

test('capture unions cached vector candidates when lexical overlap is absent',async t=>{
 const base=createFakeEmbedder({aliases:{crepes:'pancakes'}}),calls=[];
 const embedder={...base,embed:async(texts,options)=>{calls.push([...texts]);options.beforeDispatch?.();return base.embed(texts,options);}};
 const f=fixture(t,{contextOptions:{embedder,policy:{family:'local',maxRequests:1000,maxUsd:1,maxConcurrent:1,estimateUsd:()=>0}}});
 const memory=ok(f.core.admit({namespace:ns,memory:{content:'I like pancakes.',kind:'preference'},receipts:[{client:'synthetic',sessionId:'s',eventId:'old',role:'user',excerpt:'I like pancakes.'}]})).memory;
 for(let i=0;i<100;i++)if(ok(await f.trusted.call(f.core,'refreshContextIndex',{readSet:[ns],types:['memory'],intent:'current',budget:{maxItems:1024,maxMs:5000}})).status==='complete')break;
 await f.capture('I stopped crepes.');
 assert.ok(calls.some(texts=>texts.includes('I stopped crepes.')),'capture used its configured embedding budget');
 assert.deepEqual(f.calls.at(-1).candidates[0].map(candidate=>candidate.id),[memory.id]);
 assert.equal(f.db.prepare('SELECT count(*) n FROM memory_relations').get().n,1);
});
test('a candidate forgotten by the token counter is never sent to the relation model',async t=>{
 const f=fixture(t);const first=await f.capture('My breakfast is old value.');
 const target=ok(f.core.get({namespace:ns,memoryId:first.admission.memories[0].id})).memory;let fired=false;
 f.model.countTokens=text=>{
  if(!fired&&text.includes(target.id)){fired=true;ok(f.core.forget({namespace:ns,memoryId:target.id,expectedRevision:target.revision}));}
  return 1;
 };
 const second=await f.capture('My breakfast is new value.');
 assert.equal(fired,true);assert.equal(second.admission.memories.length,1);assert.equal(f.calls.length,0);
 assert.equal(f.db.prepare('PRAGMA user_version').get().user_version,18);
 assert.equal(f.db.prepare("SELECT count(*) n FROM sqlite_schema WHERE name='memory_relations'").get().n,0);
});
test('current resolution continues beyond the history depth limit',async t=>{
 const f=fixture(t);installMemoryThreadLayout(f.path);let previous;
 for(let i=0;i<11;i++){
  const memory=ok(f.core.admit({namespace:ns,memory:{content:i===0?'UniqueCurrentAnchor original':'Replacement value '+i,kind:'fact'},receipts:[{client:'synthetic',sessionId:'s',eventId:'current-'+i,role:'user',excerpt:'current '+i}]})).memory;
  if(previous)f.db.prepare(`INSERT INTO memory_relations
   (id,from_memory_id,from_revision,to_memory_id,to_revision,relation,confidence,decided_by,created_at)
   VALUES(?,?,?,?,?,'supersedes',1,'user','now')`).run('current-chain-'+i,memory.id,memory.revision,previous.id,previous.revision);
  previous=memory;
 }
 const pack=await f.read('current','UniqueCurrentAnchor');
 assert.equal(pack.metered.items.length,4);
 assert.equal(pack.metered.items.find(item=>item.metadata.thread.status==='current').body,'Replacement value 10');
});

test('a relation timeout reserves admission time and admits without edges',async t=>{
 const diagnostics=[];
 const f=fixture(t,{coreOptions:{captureDeadlineMs:2000},options:{onDiagnostic:value=>diagnostics.push(value),
  relateMemories:({signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}))}});
 ok(f.core.admit({namespace:ns,memory:{content:'The breakfast ledger is archived.',kind:'fact'},
  receipts:[{client:'synthetic',sessionId:'s',eventId:'ledger',role:'user',excerpt:'The breakfast ledger is archived.'}]}));
 const result=await f.capture('My breakfast is oats.');
 assert.equal(result.admission.memories.length,1);assert.equal(f.db.prepare('PRAGMA user_version').get().user_version,18);
 assert.equal(f.db.prepare("SELECT count(*) n FROM sqlite_schema WHERE name='memory_relations'").get().n,0);
 assert.ok(diagnostics.some(value=>value.stage==='relateMemories'&&value.reason==='model_timeout'));
});

for (const setting of [{ paused: 1 }, { enabled: 0 }]) test(`relation model and vectors respect saving controls ${JSON.stringify(setting)}`, async t => {
 const { control } = await import('../testing/context-semantic-pause-fixture.mjs');
 let armed = false, embeddings = 0;
 const fake = createFakeEmbedder();
 const f = fixture(t, { contextOptions: { embedder: { ...fake, embed(texts, controls) {
  embeddings++; controls.beforeDispatch(); return fake.embed(texts, controls);
 } }, policy: { family: 'local', maxRequests: 1000, maxUsd: 1, estimateUsd: () => 0 } } });
 await f.capture('My breakfast is oats.');
 ok(await f.trusted.call(f.core, 'refreshContextIndex', { readSet: [ns], types: ['memory'], intent: 'current', budget: { maxItems: 1024, maxMs: 5000 } }));
 const extract = f.model.extract;
 f.model.extract = request => { const output = extract(request); if (armed) control(f.db, ns, setting); return output; };
 const before = embeddings; armed = true;
 await f.capture('My breakfast is eggs.');
 assert.equal(f.calls.length, 0, 'no relation model request after saving stops');
 assert.equal(embeddings, before, 'no relation vector request after saving stops');
});

test('a pause during relation token preflight prevents model dispatch', async t => {
 const { control } = await import('../testing/context-semantic-pause-fixture.mjs');
 const f = fixture(t);
 await f.capture('My breakfast is oats.');
 let paused = false;
 f.model.countTokens = text => {
  if (!paused && text.includes('"candidates"') && text.includes('"facts"')) {
   paused = true; control(f.db, ns, { paused: 1 });
  }
  return 1;
 };
 await f.capture('My breakfast is eggs.');
 assert.equal(paused, true); assert.equal(f.calls.length, 0);
});
