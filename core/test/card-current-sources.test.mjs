import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, ok, ns, query, adopt, child, host } from './card-current-fixture.mjs';
const all=['relations-one-hop-v1','moc-v1'];
const receipt=text=>({client:'synthetic',sessionId:'s',eventId:text,role:'user',excerpt:text});
function member(f,ref) {
 const index=ok(f.call('mapEvidence',{namespace:ns,type:'card'})).indexRevision;
 return ok(f.call('applyCardPlacement',{namespace:ns,actionId:'placement',refs:[ref],expectedIndexRevision:index,proposal:{items:[{cardId:ref.cardId,parentIds:[],newL1:{title:'finance topic',parentL2Ids:[],newL2Title:'finance root'}}]}}));
}
function graph(f) {
 const m=ok(f.core.admit({namespace:ns,memory:{content:'finance seed',kind:'fact'},receipts:[receipt('finance seed')]})).memory;
 const ref=f.card({title:'Endpoint',body:'monthly report uses v1',memoryRefs:[{type:'memory',namespace:ns,memoryId:m.id,revision:m.revision}]});member(f,ref);return {m,ref};
}
test('C18/C19 stale Card relation endpoints/witnesses and MOC members/title sources disappear; warmed organization cursor refuses',async t=>{
 const f=fixture(t,{sources:all}),{m,ref}=graph(f);
 const initial=ok(await f.call('findCandidates',query({types:['memory','card'],limit:1})));assert.ok(initial.nextCursor);
 const allRows=ok(await f.call('findCandidates',query({types:['memory','card']})));assert.ok(allRows.items.some(i=>i.ref.cardId===ref.cardId));
 const organization=ok(f.call('mapEvidence',{namespace:ns,type:'card',limit:1}));assert.ok(organization.nextCursor);
 f.change();
 assert.equal((await f.call('findCandidates',query({types:['memory','card'],limit:1,cursor:initial.nextCursor}))).error.code,'cursor_stale');
 assert.equal(f.call('mapEvidence',{namespace:ns,type:'card',limit:1,cursor:organization.nextCursor}).error.code,'cursor_stale');
 const fresh=ok(await f.call('findCandidates',query({types:['memory','card']})));assert.deepEqual(fresh.items.map(i=>i.ref.memoryId),[m.id]);
 const map=ok(f.call('mapEvidence',{namespace:ns,type:'card'}));assert.ok(map.items.filter(i=>i.type==='topic').every(i=>i.topic.title===null));assert.ok(map.items.every(i=>i.ref?.childId!==ref.cardId));
});
for(const undelivered of [false,true])test(`C18/C19 adoption during counting invalidates source projections including undelivered Card seeds (${undelivered})`,async t=>{
 let f,armed=false;const h=host({counter:{id:'source-race',countTokens(text){if(armed){armed=false;child(f,{method:'adoptMethodVersion',input:adopt(f.v2,'source-change',null,ns,1,[ns])});}return undelivered&&text.includes('monthly report uses v1')?5001:1;}}});
 f=fixture(t,{h,sources:all});graph(f);armed=true;
 const result=await f.call('contextRead',query({types:['memory','card'],budget:{maxItems:1,maxTokens:4000}}));assert.equal(result.error?.code,'snapshot_stale');
});

for (const source of all) test(`C18/C19 isolated ${source} contributes a Card before adoption and removes it afterwards`, async t => {
  const f = fixture(t, { sources: [source] }), { m, ref } = graph(f);
  const request = query({ types: ['memory', 'card'] });
  const before = ok(await f.call('findCandidates', request));
  const contributed = before.items.find(item => item.ref.cardId === ref.cardId);
  assert.ok(contributed, 'the isolated channel must actually contribute the Card');
  assert.equal(contributed.channels.lexical, null);
  assert.equal(contributed.channels.semantic, null);
  if (source === 'relations-one-hop-v1') {
    assert.ok(contributed.via);
    assert.ok(before.trace.sources[source].additions.some(item => item.ref.cardId === ref.cardId));
  } else {
    assert.ok(contributed.channels.moc?.rank > 0);
    assert.ok(before.trace.sources[source].membersRanked > 0);
    assert.equal(contributed.via, undefined);
  }
  const direct = ok(await f.call('findCandidates', { ...request, sources: [] }));
  assert.equal(direct.items.some(item => item.ref.cardId === ref.cardId), false);
  assert.ok(direct.items.some(item => item.ref.memoryId === m.id));
  const first = ok(await f.call('findCandidates', { ...request, limit: 1 }));
  assert.ok(first.nextCursor);
  f.change();
  assert.equal((await f.call('findCandidates', { ...request, limit: 1, cursor: first.nextCursor })).error.code, 'cursor_stale');
  const after = ok(await f.call('findCandidates', request));
  assert.equal(after.items.some(item => item.ref.cardId === ref.cardId), false);
  assert.ok(after.items.some(item => item.ref.memoryId === m.id));
  if (source === 'relations-one-hop-v1') assert.equal(after.trace.sources[source].additions.some(item => item.ref.cardId === ref.cardId), false);
  else assert.equal(after.trace.sources[source].membersRanked, 0);
});
