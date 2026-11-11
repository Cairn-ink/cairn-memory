import test from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryCore } from '../index.mjs';
import { openDatabase, transaction } from '../database.mjs';
import { safetyFixture, ns, ok, receipt } from '../testing/content-safety-s2h-fixture.mjs';
import { sourceFixture, savedSource, ns as rawNamespace } from '../testing/raw-source-fixtures.mjs';
import { installMemoryThreadLayout } from '../testing/install-memory-thread-layout.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';

function seed(db,a,b){
 const p=db.prepare('SELECT id FROM receipts WHERE memory_id=?').get(a.id).id;
 db.prepare('INSERT INTO memory_relation_times VALUES(?,?,?,?)').run(a.id,a.revision,'2026-01-01T00:00:00.000Z',p);
 db.prepare(`INSERT INTO memory_relations(id,from_memory_id,from_revision,to_memory_id,to_revision,relation,confidence,decided_by,reason,created_at)
 VALUES('synthetic-edge',?,?,?,?,'supersedes',1,'llm','Synthetic private reason','now')`).run(b.id,b.revision,a.id,a.revision);
 return p;
}
function purged(db,id){
 assert.equal(db.prepare('SELECT count(*) n FROM memory_relations WHERE from_memory_id=? OR to_memory_id=?').get(id,id).n,0,'incident model reason is erased');
 assert.equal(db.prepare('SELECT count(*) n FROM memory_relation_times WHERE memory_id=?').get(id).n,0,'unreadable memory has no retained relation time');
}
for(const kind of ['memory','receipt','namespace','owner'])test(`durable ${kind} suppression purges incident model reasons and relation times`,async t=>{
 const f=safetyFixture(t);await f.migrate();
 const core=openMemoryCore({path:f.path}),db=openDatabase(f.path);t.after(()=>{core.close();db.close();});
 const admit=text=>ok(core.admit({namespace:ns,memory:{content:text,kind:'fact'},receipts:[receipt(text)]})).memory;
 const a=admit('Synthetic hidden breakfast'),b=admit('Synthetic visible breakfast');installMemoryThreadLayout(f.path);
 const p=seed(db,a,b);
 transaction(db,()=>writeContentSuppressionInside(db,{namespace:kind==='owner'?{ownerId:ns.ownerId,scope:'owner',projectId:''}:ns,kind,key:kind==='memory'?a.id:kind==='receipt'?p:'',
  ...(['owner','namespace'].includes(kind)?{matchMode:kind}:{}),reason:'purge',actionId:'synthetic-suppression'}));
 assert.equal(db.prepare('SELECT deleted FROM memories WHERE id=?').get(a.id).deleted,0);
 purged(db,a.id);
});
for(const safety of [false,true])test(`Raw exclusion purges surviving derived memory reasons and times; safety=${safety}`,async t=>{
 const f=sourceFixture(t,{deletion:true,model:{countTokens:()=>1,extract:()=>({items:[
  {content:'Synthetic ancestor breakfast',kind:'fact',confidence:.9,sourceIndices:[0]},
  {content:'Synthetic derived breakfast',kind:'fact',confidence:.9,sourceIndices:[0]}]})}});
 await savedSource(f,'Synthetic shared source.');
 const [a,x]=f.db.prepare('SELECT * FROM memories ORDER BY content').all();
 if(safety){
  await f.core.close();openDatabase(f.path,{currentDependencies:true}).close();
  const {migrateContentSafety}=await import('../content-safety-migration.mjs');
  const {copySqliteFixture,quiescence}=await import('../testing/content-safety-s2h-fixture.mjs');
  const backupPath=f.path+'.backup';copySqliteFixture(f.path,backupPath);
  const storeId=f.db.prepare('SELECT store_id FROM store_metadata').get().store_id;
  await migrateContentSafety({path:f.path,backupPath,expected:{storeId,base:33},quiescence});f.reopen();
 }
 const b=ok(f.core.admit({namespace:rawNamespace,memory:{content:'Synthetic independent breakfast',kind:'fact'},receipts:[receipt('independent')]})).memory;
 installMemoryThreadLayout(f.path);seed(f.db,x,b);
 ok(f.core.forget({namespace:rawNamespace,memoryId:a.id,expectedRevision:a.revision}));
 assert.equal(f.db.prepare('SELECT deleted FROM memories WHERE id=?').get(x.id).deleted,0);
 purged(f.db,x.id);
});

for(const operation of ['forget','suppress'])test(`erasing a non-endpoint candidate cannot leave its text in get, recall or context reasons: ${operation}`,async t=>{
 const {host}=await import('../testing/context-read-core-fixture.mjs');
 const f=safetyFixture(t);await f.migrate();const h=host();h.state.allowed=[ns];
 let target,shown;
 const model={contextWindow:8192,countTokens:()=>1,
  extract:({input})=>({items:[{content:input.messages[0].content,kind:'fact',confidence:1,sourceIndices:[0]}]}),
  relateMemories:({input})=>{shown=input;return {facts:[{factIndex:0,edges:[{candidateId:target.id,relation:'supersedes',confidence:1,
   reason:'My breakfast is private oats. Eggs were replaced by toast.'}]}]};},
  select:()=>({refs:[]}),rank:({input})=>({refs:input.candidates.map(c=>({namespaceIndex:c.namespaceIndex,memoryId:c.memory.id,revision:c.memory.revision}))})};
 const core=openMemoryCore({path:f.path,model,contextRead:{version:'context-read-v1',authority:h.authority,counter:{id:'synthetic',countTokens:()=>1}}}),db=openDatabase(f.path);
 t.after(()=>{core.close();db.close();});
 const x=ok(core.admit({namespace:ns,memory:{content:'My breakfast is private oats.',kind:'fact'},receipts:[receipt('oats')]})).memory;
 target=ok(core.admit({namespace:ns,memory:{content:'My breakfast is eggs.',kind:'fact'},receipts:[receipt('eggs')]})).memory;
 const capture=ok(await core.capture({namespace:ns,client:'synthetic',sessionId:'synthetic',eventId:'toast',messages:[{id:'toast',role:'user',content:'My breakfast is toast.'}]}));
 const y=capture.admission.memories[0];assert.deepEqual(shown.candidates[0].map(c=>c.id).sort(),[x.id,target.id].sort());
 assert.equal(db.prepare('SELECT reason FROM memory_relations').get().reason,null,'batch prose is discarded before persistence');
 if(operation==='forget')ok(core.forget({namespace:ns,memoryId:x.id,expectedRevision:x.revision}));
 else transaction(db,()=>writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:x.id,reason:'purge',actionId:'erase-oats'}));
 model.select=()=>({refs:[{namespaceIndex:0,memoryId:y.id,revision:y.revision}]});
 const outputs=[ok(core.get({namespace:ns,memoryId:y.id})),ok(await core.recall({readSet:[ns],query:'breakfast',limit:2})),
  ok(await h.call(core,'contextRead',{readSet:[ns],types:['memory'],intent:'history',query:'breakfast',semantic:false,budget:{}}))];
 assert.equal(db.prepare('SELECT count(*) n FROM memory_relations').get().n,1,'the independently valid dated link remains');
 for(const output of outputs){assert.ok(!JSON.stringify(output).includes(x.id));assert.doesNotMatch(JSON.stringify(output),/private oats/);}
});

for(const graph of [false,true])test(`excluded Raw contributors cannot reach discovery, resolution, insertion or model dispatch; graph=${graph}`,async t=>{
 let dispatches=0;
 const f=sourceFixture(t,{deletion:true,model:{countTokens:()=>1,extract:()=>({items:[
  {content:'Synthetic ancestor',kind:'fact',confidence:1,sourceIndices:[0]},
  {content:'My project codename is LARK.',kind:'fact',confidence:1,sourceIndices:[0]}]}),
  relateMemories:()=>{dispatches++;return {facts:[]};}}});
 await savedSource(f,'Synthetic retained source.');
 const x=f.db.prepare("SELECT * FROM memories WHERE content='My project codename is LARK.'").get(),a=f.db.prepare("SELECT * FROM memories WHERE content='Synthetic ancestor'").get();
 if(graph)installMemoryThreadLayout(f.path);
 ok(f.core.forget({namespace:rawNamespace,memoryId:a.id,expectedRevision:a.revision}));
 const {createMemoryRuntime}=await import('../runtime.mjs');
 const {createMemoryRelationStorage}=await import('../memory-relations-storage.mjs');
 const runtime=createMemoryRuntime({path:f.path});t.after(()=>runtime.close());
 assert.deepEqual(runtime.relationCandidates(rawNamespace,[{content:'My project codename is ORION.'}]),[[]]);
 assert.deepEqual(runtime.resolveRelationCandidates(rawNamespace,[{id:x.id,revision:x.revision}]),[]);
 assert.deepEqual(runtime.expandRelationRefs([rawNamespace],[{namespaceIndex:0,memoryId:x.id,revision:x.revision}]),[]);
 f.model.extract=()=>({items:[{content:'My project codename is ORION.',kind:'fact',confidence:1,sourceIndices:[0]}]});
 const c=ok(await f.core.capture({namespace:rawNamespace,client:'synthetic',sessionId:'independent',eventId:'independent',messages:[{id:'independent',role:'user',content:'My project codename is ORION.'}]})).admission.memories[0];
 assert.equal(dispatches,0,'excluded contributor refused before model dispatch');
 const db=openDatabase(f.path);t.after(()=>db.close());
 const storage=createMemoryRelationStorage({db,advanceEpoch:()=>{}}),p=db.prepare('SELECT id FROM receipts WHERE memory_id=?').get(c.id).id;
 const snapshot=transaction(db,()=>storage.insert(rawNamespace,[{factIndex:0,memoryId:c.id,memoryRevision:c.revision,item:{},insertedReceiptIds:[p]}],
  [{factIndex:0,candidateId:x.id,candidateRevision:x.revision,relation:'supersedes',confidence:1,decidedBy:'llm',reason:'LARK changed to ORION'}]));
 assert.deepEqual(snapshot.edges,[]);
 if(graph)assert.equal(db.prepare('SELECT count(*) n FROM memory_relations').get().n,0);
 else assert.equal(db.prepare('PRAGMA user_version').get().user_version,28);
});

test('direct durable Raw suppression purges a surviving derived memory clock and model reason',async t=>{
 const f=sourceFixture(t,{deletion:true,model:{countTokens:()=>1,extract:()=>({items:[{content:'Synthetic derived breakfast',kind:'fact',confidence:1,sourceIndices:[0]}]})}});
 const source=await savedSource(f,'Synthetic source.');const x=f.db.prepare('SELECT * FROM memories').get();
 await f.core.close();openDatabase(f.path,{currentDependencies:true}).close();
 const {migrateContentSafety}=await import('../content-safety-migration.mjs');
 const {copySqliteFixture,quiescence}=await import('../testing/content-safety-s2h-fixture.mjs');
 const backupPath=f.path+'.backup';copySqliteFixture(f.path,backupPath);
 await migrateContentSafety({path:f.path,backupPath,expected:{storeId:f.db.prepare('SELECT store_id FROM store_metadata').get().store_id,base:33},quiescence});f.reopen();
 const b=ok(f.core.admit({namespace:rawNamespace,memory:{content:'Independent breakfast',kind:'fact'},receipts:[receipt('independent')]})).memory;
 installMemoryThreadLayout(f.path);seed(f.db,x,b);
 transaction(f.db,()=>writeContentSuppressionInside(f.db,{namespace:rawNamespace,kind:'raw',key:source.conversationId,matchMode:'span',messageId:source.messageId,start:0,end:source.text.length,reason:'purge',actionId:'hide-source'}));
 purged(f.db,x.id);
});
