import test from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryCore } from '../index.mjs';
import { host } from '../testing/context-read-core-fixture.mjs';
import { safetyFixture, ns, ok, receipt } from '../testing/content-safety-s2h-fixture.mjs';
import { transaction } from '../database.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';

for(const base of [18,23,33])for(const blocked of ['suppressed','foreign-owner','foreign-namespace','denied'])test(`edge endpoints remain protected: base ${base}, ${blocked}`,async t=>{
 const f=safetyFixture(t,base);await f.migrate();const h=host();h.state.allowed=[ns];
 const core=openMemoryCore({path:f.path,contextRead:{version:'context-read-v1',authority:h.authority,counter:{id:'synthetic',countTokens:()=>1}}}),db=f.connect();
 t.after(()=>{core.close();db.close();});
 const seed=ok(core.admit({namespace:ns,memory:{content:'UniqueRelationSeed visible value',kind:'fact'},receipts:[receipt('relation-seed')]})).memory;
 const foreign=blocked==='foreign-owner'||blocked==='foreign-namespace';
 const peerNamespace=blocked==='foreign-owner'?{...ns,ownerId:'foreign'}:blocked==='foreign-namespace'?{...ns,scope:'project',projectId:'foreign-project'}:ns;
 const peer=ok(core.admit({namespace:peerNamespace,memory:{content:'SecretRelationPeer hidden value',kind:'fact'},receipts:[receipt('relation-peer')],
  ...(!foreign?{conflictHints:[{memoryId:seed.id,expectedRevision:seed.revision,relation:'contradicts'}]}:{})})).memory;
 const read=async()=>h.call(core,'contextRead',{readSet:[ns],types:['memory'],intent:'history',query:'UniqueRelationSeed',semantic:false,budget:{}});
 const before=ok(await read());assert.equal(before.metered.items.length,foreign?1:2,'one-hop delivery stays within the authorized namespace');
 if(blocked==='suppressed')transaction(db,()=>writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:peer.id,reason:'purge',actionId:'hide-peer'}));
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
 db.prepare(`INSERT INTO memory_relations(id,from_memory_id,from_revision,to_memory_id,to_revision,relation,confidence,decided_by,created_at)
 VALUES('superseder',?,?,?,?,'supersedes',1,'user','now')`).run(b.id,b.revision,a.id,a.revision);
 const read=()=>h.call(core,'contextRead',{readSet:[ns],types:['memory'],intent:'current',query:'Breakfast',semantic:false,budget:{}});
 assert.deepEqual(ok(await read()).metered.items.map(item=>item.body),['Breakfast newest value']);
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
 db.prepare(`INSERT INTO memory_relations(id,from_memory_id,from_revision,to_memory_id,to_revision,relation,confidence,decided_by,created_at)
 VALUES('race',?,?,?,?,'supersedes',1,'user','now')`).run(seed.id,seed.revision,peer.id,peer.revision);
 armed=true;
 const result=await h.call(core,'contextRead',{readSet:[ns],types:['memory'],intent:'current',query:'Visible',semantic:false,budget:{}});
 assert.equal(fired,true);assert.ok(!JSON.stringify(result).includes(peer.id));assert.doesNotMatch(JSON.stringify(result),/Hidden historical breakfast/);
});
