import { installMemoryThreadLayout } from '../testing/install-memory-thread-layout.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryThreadFixture,measureThreadChain,threadNamespace as ns,unwrap,chainDate } from '../testing/memory-thread-fixture.mjs';
import { ruleRelation,sameThreadScore,SAME_THREAD_THRESHOLD,relateCapturedMemories } from '../memory-relations.mjs';
import { syntheticThreadPairs,threadClassificationCounts } from '../../tools/testing/memory-thread-synthetic.mjs';

for(const tier of [1,2])for(const changes of [1,2,4,8])test(`tier ${tier}: ${changes} changes carry current, dates and retraction inside one item`,async t=>{
 const f=memoryThreadFixture(t,{tier}),row=await measureThreadChain(f,changes);
 assert.equal(row.latest,true);assert.equal(row.markedCurrent,true);assert.equal(row.retracted,true);assert.equal(row.dated,true);
 assert.equal(row.members,Math.min(changes+1,4));
 if(tier===2)assert.equal(f.calls.length,changes);
});
test('neutral matching abstains on different subjects and negation scopes',()=>{
 const pairs=syntheticThreadPairs();
 for(const row of pairs.filter(pair=>!pair.positive))assert.deepEqual(ruleRelation({content:row.right},[{id:'candidate',content:row.left}]),[],JSON.stringify(row));
 for(const edge of pairs.flatMap(row=>ruleRelation({content:row.right},[{id:'candidate',content:row.left}])))assert.equal(edge.relation,'same_thread');
 const counts=threadClassificationCounts(pairs,sameThreadScore,SAME_THREAD_THRESHOLD);assert.ok(counts.length);
});
test('failed and malformed model calls fall back to neutral links with the source date',async t=>{
 for(const malformed of [false,true]){
 const diagnostics=[],f=memoryThreadFixture(t,{tier:2,model:{relateMemories:()=>{
  if(malformed)return {facts:[{factIndex:'invalid',edges:[]}]};
  throw Error('private fact');
 },onDiagnostic:value=>diagnostics.push(value)}});
 await f.capture('I like egg pancakes.',{occurredAt:chainDate(0)});await f.capture('I no longer eat egg pancakes because of the oil.',{occurredAt:chainDate(1)});
 const edges=f.db.prepare('SELECT * FROM memory_relations').all();assert.equal(edges.length,1);assert.equal(edges[0].relation,'same_thread');assert.equal(edges[0].decided_by,'rule');
 const pack=await f.read({query:'egg pancakes',maxItems:1});assert.equal(pack.metered.items.length,2);assert.equal(pack.metered.items.find(item=>item.metadata.thread.status==='current').body,'I no longer eat egg pancakes because of the oil.');
 assert.ok(!JSON.stringify(diagnostics).includes('private fact'));
 }
});
test('unrelated decisions suppress neutral fallback and the model cannot change chronology',async t=>{
 const f=memoryThreadFixture(t,{tier:2,model:{relateMemories:({input})=>({facts:input.facts.map(fact=>({factIndex:fact.factIndex,eventTime:'2099-01-01T00:00:00.000Z',edges:[]}))})}});
 await f.capture('My breakfast is oats.',{occurredAt:chainDate(0)});await f.capture('My breakfast is eggs.',{occurredAt:chainDate(1)});
 assert.equal(f.db.prepare('PRAGMA user_version').get().user_version,18);
 assert.deepEqual(f.db.prepare("SELECT name FROM sqlite_schema WHERE name IN ('memory_relations','memory_relation_times')").all(),[]);
 assert.ok((await f.read()).metered.items.every(item=>!item.metadata?.thread));
});
test('a late capture of an older message stays earlier, regardless of the model edge direction',async t=>{
 const f=memoryThreadFixture(t,{tier:2});
 await f.capture('My breakfast is eggs.',{occurredAt:chainDate(2)});await f.capture('My breakfast is oats.',{occurredAt:chainDate(0)});
 const pack=await f.read({maxItems:1});assert.equal(pack.metered.items.find(item=>item.metadata.thread.status==='current').body,'My breakfast is eggs.');
 const history=await f.read({intent:'history'});assert.deepEqual(history.metered.items.map(item=>item.body),['My breakfast is oats.','My breakfast is eggs.']);
 assert.equal(history.metered.items[1].metadata.thread.status,'current');
});
test('date ties use capture order and typed reasons travel with earlier members',async t=>{
 const f=memoryThreadFixture(t,{tier:2});await f.capture('My breakfast is oats.',{occurredAt:chainDate(0)});await f.capture('My breakfast is eggs.',{occurredAt:chainDate(0)});
 const pack=await f.read({maxItems:1});const current=pack.metered.items.find(item=>item.metadata.thread.status==='current'),earlier=pack.metered.items.find(item=>item.metadata.thread.status==='earlier');
 assert.equal(current.body,'My breakfast is eggs.');assert.equal(earlier.metadata.thread.relation,'supersedes');assert.equal(earlier.metadata.thread.reason,'The breakfast value changed.');
});
test('rule proposals are capped without ever claiming typed semantics',async()=>{
 const candidates=Array.from({length:8},(_,index)=>({id:'candidate-'+index,revision:1,content:'My breakfast is oats.',eventTime:chainDate(0)}));
 const output=await relateCapturedMemories({model:{},items:[{content:'My breakfast is eggs.',receiptTimes:[chainDate(1)]}],operations:{relationCandidates:()=>[candidates]}});
 assert.equal(output.filter(edge=>!edge.timingOnly).length,5);assert.ok(output.every(edge=>edge.timingOnly||edge.relation==='same_thread'&&edge.decidedBy==='rule'));
});

test('tight budgets retain current before earlier values, with and without Raw evidence',async()=>{
 const {assembleThreeLayerContext}=await import('../context-read-three-layer.mjs');
 const make=(id,text,status,date)=>({type:'memory',ns:0,rank:status==='earlier'?1:2,
  ref:{type:'memory',namespace:ns,memoryId:id,revision:1},text,date,sources:[],sourceAccess:'available',sourcesComplete:true,
  fence:'0'.repeat(64),threadKey:'thread',threadRank:1,threadOrder:status==='earlier'?1:2,turnIds:['shared-turn'],sessionIds:[],
  metadata:{state:'active',reviewState:'none',filing:{status:'unfiled'},kind:'fact',origin:'explicit',confidence:1,
   thread:{currentMemoryId:'new',currentRevision:1,status,eventTime:date,relation:status==='earlier'?'same_thread':null,direction:null,reason:null}}});
 const old=make('old','TOO_BIG_OLD','earlier',chainDate(0)),current=make('new','Current breakfast','current',chainDate(1));
 const value={namespace:ns,conversationId:'conversation',messageId:'message',role:'user',occurredAt:chainDate(1),ranges:[{text:'Breakfast source.',source:{span:{start:0,end:17}}}]};
 for(const raw of [undefined,{items:[{handle:{},value,key:'shared-turn',rank:1}],coverage:'included',rawSearch:{revalidate:()=>[value]}}]){
  const result=assembleThreeLayerContext({prepared:[old,current],query:'Breakfast',readSet:[ns],
   counter:{id:'synthetic',countTokens:text=>text.includes('TOO_BIG_OLD')?7000:1},policy:{id:'coverage-first-v1'},
   budget:{maxItems:1,maxTokens:6000},deadlineAt:performance.now()+10000,representation:'representation-v2-dated',snapshotOf:()=>null},raw);
  assert.deepEqual(result.metered.items.filter(item=>item.ref.type==='memory').map(item=>item.body),['Current breakfast']);
  assert.equal(result.metered.items[0].metadata.thread.status,'current');
 }
 const oversized=assembleThreeLayerContext({prepared:[old,{...current,text:'TOO_BIG_CURRENT'}],
  counter:{id:'synthetic',countTokens:text=>text.includes('TOO_BIG_CURRENT')?7000:1},policy:{id:'coverage-first-v1'},
  budget:{maxItems:1,maxTokens:6000},deadlineAt:performance.now()+10000,representation:'representation-v2-dated',snapshotOf:()=>null});
 assert.deepEqual(oversized.metered.items,[],'an earlier value cannot replace an oversized current value');
});

test('a historical thread member remains available through the context snapshot',async t=>{
 const f=memoryThreadFixture(t);
 const a=unwrap(f.core.admit({namespace:ns,memory:{content:'My breakfast is oats.',kind:'fact'},receipts:[{client:'synthetic',sessionId:'session',eventId:'old',role:'user',excerpt:'Oats'}]})).memory;
 const replacement=unwrap(f.core.supersede({namespace:ns,memoryId:a.id,expectedRevision:a.revision,replacement:{content:'My breakfast is eggs.',kind:'fact'},
  receipts:[{client:'synthetic',sessionId:'session',eventId:'new',role:'user',excerpt:'Eggs'}]}));
 installMemoryThreadLayout(f.path);
 const old=f.db.prepare('SELECT id,revision FROM memories WHERE id=?').get(a.id),current=replacement.memory;
 f.db.prepare(`INSERT INTO memory_relations(id,from_memory_id,from_revision,to_memory_id,to_revision,relation,confidence,decided_by,created_at)
  VALUES('historical-thread',?,?,?,?,'supersedes',1,'user','now')`).run(current.id,current.revision,old.id,old.revision);
 const pack=await f.read({maxItems:1});assert.equal(pack.metered.items.length,2);
 assert.equal(pack.metered.items.find(item=>item.metadata.thread.status==='earlier').body,'My breakfast is oats.');
 const fetched=unwrap(await f.trusted.call(f.core,'fetchCandidateEvidence',{readSet:[ns],snapshot:pack.snapshot}));
 assert.equal(fetched.items.length,2);assert.ok(fetched.items.some(item=>item.content==='My breakfast is oats.'));
});

for(const tier of [1,2])test(`tier ${tier}: repeated content with a fresh source keeps its thread and uses the new date`,async t=>{
 const f=memoryThreadFixture(t,{tier});
 await f.capture('My breakfast is oats.',{occurredAt:chainDate(0)});const first=await f.capture('My breakfast is eggs.',{occurredAt:chainDate(1)});
 const repeated=await f.capture('My breakfast is eggs.',{occurredAt:chainDate(2)});
 assert.equal(first.admission.memories[0].id,repeated.admission.memories[0].id);
 const pack=await f.read({maxItems:1});assert.equal(pack.metered.items.length,2);
 const current=pack.metered.items.find(item=>item.metadata.thread.status==='current');assert.equal(current.body,'My breakfast is eggs.');assert.equal(current.metadata.thread.eventTime,chainDate(2));
 assert.ok(f.db.prepare('SELECT relation FROM memory_relations').all().every(edge=>edge.relation===(tier===1?'same_thread':'supersedes')));
 if(tier===2)assert.ok(f.calls.at(-1).candidates[0].every(candidate=>candidate.content!=='My breakfast is eggs.'));
});

for(const tier of [1,2])test(`tier ${tier}: the product Worker delivers and fetches the dated thread`,async t=>{
 const {configured,prebuild}=await import('../testing/context-product-owner-fixture.mjs');
 const f=memoryThreadFixture(t,{tier});
 for(let i=0;i<3;i++)await f.capture(`My breakfast is value ${i}.`,{occurredAt:chainDate(i)});
 await prebuild(configured(t,f.path,[ns],{service:true}),['memory']);
 const config=configured(t,f.path,[ns]),reader=await config.open();
 const input={readSet:[ns],types:['memory'],query:'breakfast',semantic:false,deadlineMs:5000,budget:{maxItems:1,maxTokens:6000}};
 const pack=unwrap(await reader.contextRead({...input,intent:'current'},config.token));
 assert.equal(pack.metered.items.length,3);
 assert.equal(pack.metered.items.find(item=>item.metadata.thread.status==='current').body,'My breakfast is value 2.');
 assert.ok(pack.metered.items.every(item=>item.date&&item.metadata.thread.eventTime));
 const fetched=unwrap(await reader.fetchCandidateEvidence({readSet:[ns],snapshot:pack.snapshot},config.token));
 assert.deepEqual(fetched.items.map(item=>item.content).sort(),['My breakfast is value 0.','My breakfast is value 1.','My breakfast is value 2.']);
 const history=unwrap(await reader.contextRead({...input,intent:'history'},config.token));
 assert.deepEqual(history.metered.items.map(item=>item.body),['My breakfast is value 0.','My breakfast is value 1.','My breakfast is value 2.']);
 const {budget,...candidateInput}=input;
 const candidates=unwrap(await reader.findCandidates({...candidateInput,intent:'current'},config.token));
 assert.equal(candidates.items.length,3);
 assert.ok(candidates.items.every(item=>!Object.hasOwn(item,'threadKey')&&!Object.hasOwn(item,'threadOrder')&&!Object.hasOwn(item,'threadRank')));
});

for(const tier of [1,2])test(`tier ${tier}: an older repeat receipt cannot rewind a fact's latest support date`,async t=>{
 const f=memoryThreadFixture(t,{tier});
 await f.capture('My breakfast is eggs.',{occurredAt:chainDate(3)});
 await f.capture('My breakfast is oats.',{occurredAt:chainDate(2)});
 await f.capture('My breakfast is eggs.',{occurredAt:chainDate(1)});
 const pack=await f.read({maxItems:1});
 const current=pack.metered.items.find(item=>item.metadata.thread.status==='current');
 assert.equal(current.body,'My breakfast is eggs.');
 assert.equal(current.metadata.thread.eventTime,chainDate(3));
});

for(const [left,right] of [
 ['我喜歡吃蛋餅，早餐幾乎每天都吃蛋餅。','我現在不吃蛋餅了，因為聽說那家早餐店的蛋餅用的是地溝油。'],
 ['我喜歡吃蛋餅。','我不喜歡吃蛋餅了，因為地溝油。'],
 ['I like egg pancakes for breakfast.','I stopped eating egg pancakes because of gutter oil.'],
])test('natural preference change links through capture and the default context read: '+left,async t=>{
 const f=memoryThreadFixture(t);await f.capture(left);await f.capture(right);
 assert.equal(f.db.prepare('SELECT relation FROM memory_relations').get()?.relation,'same_thread');
 const pack=await f.read({query:left,maxItems:1});assert.equal(pack.metered.items.length,2);
 assert.equal(pack.metered.items.find(item=>item.metadata?.thread?.status==='current')?.body,right.normalize('NFKC'));
});
test('labelled natural and templated matcher strata remain separately visible',()=>{
 const pairs=syntheticThreadPairs(),counts=threadClassificationCounts(pairs,sameThreadScore,SAME_THREAD_THRESHOLD);
 console.log(JSON.stringify({kind:'matcher-strata',strata:counts,misses:pairs.filter(p=>p.stratum==='natural'&&p.positive&&sameThreadScore(p.left,p.right)<SAME_THREAD_THRESHOLD)}));
 for(const language of ['en','zh-Hant'])assert.ok(pairs.filter(p=>p.language===language&&p.stratum==='natural').length>=12);
 for(const row of counts)assert.equal(row.fp,0,JSON.stringify(row));
});
