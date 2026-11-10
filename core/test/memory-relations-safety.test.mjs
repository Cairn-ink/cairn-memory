import { installMemoryThreadLayout } from '../testing/install-memory-thread-layout.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryCore } from '../index.mjs';
import { host } from '../testing/context-read-core-fixture.mjs';
import { safetyFixture, ns, ok, receipt } from '../testing/content-safety-s2h-fixture.mjs';
import { transaction } from '../database.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';

for(const base of [18,23,33])for(const blocked of ['suppressed','malformed-version','foreign-owner','foreign-namespace','denied'])test(`edge endpoints remain protected: base ${base}, ${blocked}`,async t=>{
 const f=safetyFixture(t,base);await f.migrate();const h=host();h.state.allowed=[ns];
 const core=openMemoryCore({path:f.path,contextRead:{version:'context-read-v1',authority:h.authority,counter:{id:'synthetic',countTokens:()=>1}}}),db=f.connect();
 t.after(()=>{core.close();db.close();});
 const seed=ok(core.admit({namespace:ns,memory:{content:'UniqueRelationSeed visible value',kind:'fact'},receipts:[receipt('relation-seed')]})).memory;
 const foreign=blocked==='foreign-owner'||blocked==='foreign-namespace';
 const peerNamespace=blocked==='foreign-owner'?{...ns,ownerId:'foreign'}:blocked==='foreign-namespace'?{...ns,scope:'project',projectId:'foreign-project'}:ns;
 const peer=ok(core.admit({namespace:peerNamespace,memory:{content:'SecretRelationPeer hidden value',kind:'fact'},receipts:[receipt('relation-peer')],
  ...(!foreign?{conflictHints:[{memoryId:seed.id,expectedRevision:seed.revision,relation:'contradicts'}]}:{})})).memory;
 installMemoryThreadLayout(f.path);
 const read=async()=>h.call(core,'contextRead',{readSet:[ns],types:['memory'],intent:'history',query:'UniqueRelationSeed',semantic:false,budget:{}});
 const before=ok(await read());assert.equal(before.metered.items.length,foreign?1:2,'one-hop delivery stays within the authorized namespace');
 if(['suppressed','malformed-version'].includes(blocked)){transaction(db,()=>writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:peer.id,reason:'purge',actionId:'hide-peer',
  ...(blocked==='malformed-version'?{matchMode:'version',sourceVersion:'["Synthetic malformed source"]'}:{})}));
  assert.equal(db.prepare('SELECT count(*) n FROM memory_relations WHERE from_memory_id=? OR to_memory_id=?').get(peer.id,peer.id).n,0);}
 if(foreign)assert.throws(()=>db.prepare(`INSERT INTO memory_relations
  (id,from_memory_id,from_revision,to_memory_id,to_revision,relation,confidence,decided_by,created_at)
  VALUES('foreign-edge',?,?,?,?,'contradicts',1,'user','now')`).run(seed.id,seed.revision,peer.id,peer.revision),/invalid_relation_boundary/);
 if(blocked==='denied')h.state.enabled=false;
 const after=await read();
 assert.doesNotMatch(JSON.stringify(after),/SecretRelationPeer/);
 assert.ok(!JSON.stringify(after).includes(peer.id),'even relation labels omit the hidden endpoint');
 if(blocked==='denied')assert.equal(after.ok,false);
 else assert.ok(after.ok,'a hidden peer does not make the visible seed unavailable');
});

test('supersession follows only safe endpoints, so suppressing the newest value restores its predecessor',async t=>{
 const f=safetyFixture(t,18);await f.migrate();const h=host();h.state.allowed=[ns];
 const core=openMemoryCore({path:f.path,contextRead:{version:'context-read-v1',authority:h.authority,counter:{id:'synthetic',countTokens:()=>1}}}),db=f.connect();
 t.after(()=>{core.close();db.close();});
 const a=ok(core.admit({namespace:ns,memory:{content:'Breakfast previous value',kind:'fact'},receipts:[receipt('previous')]})).memory;
 const b=ok(core.admit({namespace:ns,memory:{content:'Breakfast newest value',kind:'fact'},receipts:[receipt('newest')]})).memory;
 installMemoryThreadLayout(f.path);
 db.prepare(`INSERT INTO memory_relations(id,from_memory_id,from_revision,to_memory_id,to_revision,relation,confidence,decided_by,created_at)
 VALUES('superseder',?,?,?,?,'supersedes',1,'user','now')`).run(b.id,b.revision,a.id,a.revision);
 const read=()=>h.call(core,'contextRead',{readSet:[ns],types:['memory'],intent:'current',query:'Breakfast',semantic:false,budget:{}});
 assert.equal(ok(await read()).metered.items.find(item=>item.metadata.thread.status==='current').body,'Breakfast newest value');
 transaction(db,()=>writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:b.id,reason:'purge',actionId:'hide-newest'}));
 const result=ok(await read());assert.deepEqual(result.metered.items.map(item=>item.body),['Breakfast previous value']);
 assert.ok(!JSON.stringify(result).includes(b.id));
});
test('a peer suppressed by the token counter cannot remain in relation metadata',async t=>{
 const f=safetyFixture(t,18);await f.migrate();const h=host();h.state.allowed=[ns];const db=f.connect();
 let peer,armed=false,fired=false;
 const counter={id:'synthetic-race',countTokens(text){
  if(armed&&!fired&&text.includes('relations')){fired=true;transaction(db,()=>writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:peer.id,reason:'purge',actionId:'race-peer'}));}
  return 1;
 }};
 const core=openMemoryCore({path:f.path,contextRead:{version:'context-read-v1',authority:h.authority,counter}});t.after(()=>{core.close();db.close();});
 const seed=ok(core.admit({namespace:ns,memory:{content:'Visible current breakfast',kind:'fact'},receipts:[receipt('visible')]})).memory;
 peer=ok(core.admit({namespace:ns,memory:{content:'Hidden historical breakfast',kind:'fact'},receipts:[receipt('peer')]})).memory;
 installMemoryThreadLayout(f.path);
 db.prepare(`INSERT INTO memory_relations(id,from_memory_id,from_revision,to_memory_id,to_revision,relation,confidence,decided_by,created_at)
 VALUES('race',?,?,?,?,'supersedes',1,'user','now')`).run(seed.id,seed.revision,peer.id,peer.revision);
 armed=true;
 const result=await h.call(core,'contextRead',{readSet:[ns],types:['memory'],intent:'current',query:'Visible',semantic:false,budget:{}});
 assert.equal(fired,true);assert.ok(!JSON.stringify(result).includes(peer.id));assert.doesNotMatch(JSON.stringify(result),/Hidden historical breakfast/);
});

test('Raw exclusion removes incident edges and never brings a surviving derived fact through a thread',async t=>{
 const {sourceFixture,savedSource,ns:sourceNamespace}=await import('../testing/raw-source-fixtures.mjs');
 const f=sourceFixture(t,{deletion:true,model:{countTokens:()=>1,extract:()=>({items:[
  {content:'Shared ancestor fact',kind:'fact',confidence:.9,sourceIndices:[0]},
  {content:'Shared derived private fact',kind:'fact',confidence:.9,sourceIndices:[0]}]})}});
 await savedSource(f,'Shared synthetic source.');
 const [ancestor,derived]=f.db.prepare('SELECT * FROM memories ORDER BY content').all();
 const visible=ok(f.core.admit({namespace:sourceNamespace,memory:{content:'UniqueVisibleThread independent fact',kind:'fact'},receipts:[receipt('independent-thread')]})).memory;
 installMemoryThreadLayout(f.path);
 f.db.prepare(`INSERT INTO memory_relations(id,from_memory_id,from_revision,to_memory_id,to_revision,relation,confidence,decided_by,created_at)
  VALUES('raw-thread',?,?,?,?,'same_thread',1,'user','now')`).run(visible.id,visible.revision,derived.id,derived.revision);
 const h=host();h.state.allowed=[sourceNamespace];
 const reader=openMemoryCore({path:f.path,contextRead:{version:'context-read-v1',authority:h.authority,counter:{id:'synthetic',countTokens:()=>1}}});t.after(()=>reader.close());
 const read=()=>h.call(reader,'contextRead',{readSet:[sourceNamespace],types:['memory'],intent:'current',query:'UniqueVisibleThread',semantic:false,budget:{}});
 assert.ok(ok(await read()).metered.items.some(item=>item.ref.id===derived.id));
 ok(f.core.forget({namespace:sourceNamespace,memoryId:ancestor.id,expectedRevision:ancestor.revision}));
 assert.equal(f.db.prepare('SELECT deleted FROM memories WHERE id=?').get(derived.id).deleted,0);
 assert.equal(f.db.prepare('SELECT count(*) n FROM memory_relations WHERE from_memory_id=? OR to_memory_id=?').get(derived.id,derived.id).n,0);
 const result=ok(await read());assert.ok(!JSON.stringify(result).includes(derived.id));assert.doesNotMatch(JSON.stringify(result),/Shared derived private fact/);
});

test('first-install safety preflight accepts the relation package and preserves logical base capabilities',async t=>{
 const {createTestWorkspace}=await import('../../tools/testing/workspace.mjs');
 const {join}=await import('node:path');
 const {cardHost}=await import('../testing/raw-source-fixtures.mjs');
 const {preflightContentSafetyV1}=await import('../content-safety-preflight.mjs');
 for(const cards of [false,true]){
  const workspace=createTestWorkspace(t,{prefix:'thread-preflight-'}),path=join(workspace.path,'store.sqlite'),h=cardHost();
  const core=openMemoryCore({path,...(cards?{privateCards:h.options}:{})});workspace.defer(()=>core.close());
  if(cards){
   const draft=ok(h.call(core,'createCardDraft',{namespace:ns,actionId:'draft',drafting:'authored',input:{
    title:'Synthetic thread title',body:'Synthetic thread body',authoredInput:{text:'Synthetic submitted source',occurredAt:null}}}));
   ok(h.call(core,'confirmCardDraft',{namespace:ns,cardId:draft.id,expectedRevision:draft.revision,actionId:'confirm'}));
  }
  installMemoryThreadLayout(path);await core.close();
  const report=await preflightContentSafetyV1({path});
  assert.equal(report.schemaBase,cards?23:18,JSON.stringify(report));
  assert.equal(report.enumerated,cards?1:0);assert.equal(report.unchangedFiles,true);
 }
});
