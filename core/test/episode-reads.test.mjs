import assert from 'node:assert/strict';
import test from 'node:test';
import { openMemoryCore } from '../index.mjs';
import { fixture, batch, register, draft, inspect, ns, ok } from '../testing/episode-helpers.mjs';
import { rangeQuery, rangeInput, rangePage } from '../episode-reads.mjs';
const since='2026-03-08T08:00:00.000Z', until='2026-03-09T07:00:00.000Z'; // Caller-converted US DST day.
const input={namespace:ns,since,until};
function episode(f, id, overrides={}) {
  const b=batch(id,'Synthetic evidence',id), r=register(f,b);
  const row=f.db.prepare('SELECT * FROM session_episodes WHERE id=?').get(r.episodeId);
  const record={...JSON.parse(row.record),eventStart:since,eventEnd:since,eventTimeCoverage:'complete',...overrides};
  f.db.prepare('UPDATE session_episodes SET record=?,first_received_at=? WHERE id=?').run(JSON.stringify(record),since,row.id);
  return row.id;
}
function memory(f, namespace=ns, client='exact', content='Synthetic remembered instruction') {
  return ok(f.core.admit({namespace,memory:{content,kind:'instruction'},receipts:[{client,sessionId:'synthetic',eventId:content,role:'user',excerpt:content}]})).memory;
}
function timeMemories(f) { f.db.prepare('UPDATE memories SET updated_at=?').run(since);f.db.prepare('UPDATE receipts SET created_at=?').run(since); }

test('E9 range orders, DST half-open boundaries, event/receipt disagreement and honest unknown/partial shells',t=>{
  const f=fixture(t);
  const known=episode(f,'known'),partial=episode(f,'partial',{eventTimeCoverage:'partial'});
  const unknown=episode(f,'unknown',{eventStart:null,eventEnd:null,eventTimeCoverage:'unknown'});
  episode(f,'end',{eventStart:until,eventEnd:until});
  const overlapping=episode(f,'overlap',{eventStart:'2026-03-01T00:00:00.000Z',eventEnd:since});
  const outside=episode(f,'outside',{eventStart:'2026-02-01T00:00:00.000Z',eventEnd:'2026-02-01T00:00:00.000Z'});
  f.db.prepare('UPDATE session_episodes SET first_received_at=? WHERE id=?').run(until,known);
  const page=ok(f.core.listEpisodes(input));
  assert.deepEqual(page.items.map(e=>e.id),[known,partial,overlapping].sort());
  assert.equal(page.unknownEventIntervals,'excluded');assert.equal(page.exhausted,true);
  assert.equal(page.items.find(e=>e.id===partial).eventTimeCoverage,'partial');
  assert.equal(page.items[0].processing.state,'pending');assert.equal(page.items[0].gist,null);
  const receipt=ok(f.core.listEpisodes({...input,timeBasis:'receipt'}));
  assert.ok(receipt.items.some(e=>e.id===unknown));assert.ok(receipt.items.some(e=>e.id===outside));
  assert.ok(!receipt.items.some(e=>e.id===known));
});

test('E1/E9 exact client and two-owner two-project isolation across all time reads',t=>{
  const f=fixture(t), own=episode(f,'own');
  const scopes=[ns,{...ns,projectId:'other'},{...ns,ownerId:'other'},{...ns,ownerId:'other',projectId:'other'}];
  const ids=[];
  for(const [i,scope]of scopes.entries()) {
    const b=batch('isolation-'+i,'Synthetic isolated evidence','session-'+i);
    ids.push(f.runtime.reserveEpisodeBatch(scope,b).episodeId);
    memory(f,scope,'exact','Synthetic scope '+i);
    memory(f,scope,'exact.extra','Synthetic extra scope '+i);
  }
  f.db.prepare("UPDATE session_episodes SET first_received_at=?,record=json_set(record,'$.eventStart',?,'$.eventEnd',?)").run(since,since,since);
  timeMemories(f);
  for(const [i,scope]of scopes.entries()) {
    for(const timeBasis of ['event','receipt']) {
      const items=ok(f.core.listEpisodes({...input,namespace:scope,timeBasis,client:'synthetic'})).items;
      assert.deepEqual(items.map(e=>e.id).sort(),(i===0?[own,ids[i]]:[ids[i]]).sort());
      assert.equal(ok(f.core.listEpisodes({...input,namespace:scope,timeBasis,client:'syntheti'})).items.length,0);
    }
    for(const timeBasis of ['receipt','revision']) {
      const items=ok(f.core.listMemoriesByTime({...input,namespace:scope,timeBasis,client:'exact'})).items;
      assert.equal(items.length,1);
    }
  }
});

test('E9 receipt multiplicity, revision filtering, historical labels and deleted exclusion',t=>{
  const f=fixture(t), m=memory(f);
  ok(f.core.admit({namespace:ns,memory:{content:'Synthetic remembered instruction',kind:'instruction'},receipts:[
    {client:'second',sessionId:'s',eventId:'second',role:'user',excerpt:'Synthetic second receipt'}]}));
  timeMemories(f);
  const receipts=ok(f.core.listMemoriesByTime(input)).items;
  assert.equal(receipts.length,2);assert.equal(new Set(receipts.map(r=>r.memory.id)).size,1);
  assert.deepEqual(receipts.map(r=>r.receipt.id),receipts.map(r=>r.receipt.id).sort());
  assert.equal(ok(f.core.listMemoriesByTime({...input,timeBasis:'revision',client:'second'})).items.length,1);
  f.db.prepare("UPDATE memories SET currentness='historical' WHERE id=?").run(m.id);
  assert.equal(ok(f.core.listMemoriesByTime(input)).items.length,0);
  assert.equal(ok(f.core.listMemoriesByTime({...input,states:['historical']})).items[0].memory.state,'historical');
  const current=ok(f.core.get({namespace:ns,memoryId:m.id})).memory;
  ok(f.core.forget({namespace:ns,memoryId:m.id,expectedRevision:current.revision}));
  for(const timeBasis of ['receipt','revision'])assert.equal(ok(f.core.listMemoriesByTime({...input,timeBasis,states:['active','historical']})).items.length,0);
});

test('E9 large-history keyset pages, restart, binding, tampering, stale mutations and inert replay',t=>{
  const f=fixture(t), seed=episode(f,'seed');
  const row=f.db.prepare('SELECT * FROM session_episodes WHERE id=?').get(seed);
  const columns=Object.keys(row), insert=f.db.prepare(`INSERT INTO session_episodes(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`);
  for(let i=0;i<999;i++)insert.run(...Object.values({...row,id:'synthetic-'+String(i).padStart(4,'0'),session_key:'s1:'+i.toString(16).padStart(64,'0')}));
  let page=ok(f.core.listEpisodes(input)), all=[...page.items];assert.equal(page.items.length,20);
  const cursor=page.nextCursor;assert.ok(cursor.length<=8192);
  while(!page.exhausted){page=ok(f.core.listEpisodes({...input,cursor:page.nextCursor}));all.push(...page.items);}
  assert.equal(all.length,1000);assert.equal(new Set(all.map(e=>e.id)).size,1000);
  assert.deepEqual(all.map(e=>e.id),all.map(e=>e.id).sort());
  const reopened=openMemoryCore({path:f.path});t.after(()=>reopened.close());
  assert.equal(ok(reopened.listEpisodes({...input,cursor})).items.length,20);
  for(const patch of [{limit:21},{client:'synthetic'},{timeBasis:'receipt'},{namespace:{...ns,ownerId:'other'}},{until:'2026-03-10T07:00:00.000Z'},
    {cursor:cursor.slice(0,-2)+'!!'},{cursor:'a'.repeat(8193)}])assert.equal(f.core.listEpisodes({...input,cursor,...patch}).error.code,'invalid_cursor');
  const other=openMemoryCore({path:':memory:'});t.after(()=>other.close());
  assert.equal(other.listEpisodes({...input,cursor}).error.code,'invalid_cursor');
  register(f,batch('seed','Synthetic evidence','seed')); // Exact capture registration replay.
  assert.equal(f.core.listEpisodes({...input,cursor}).ok,true);
  memory(f);
  assert.equal(f.core.listEpisodes({...input,cursor}).error.code,'cursor_stale');
});

test('E9 all range inputs reject unknown fields, invalid UTC/ranges/states/limits',t=>{
  const f=fixture(t);
  for(const method of ['listEpisodes','listMemoriesByTime'])for(const patch of [
    {unknown:true},{limit:0},{limit:51},{limit:null},{limit:1.5},{since:until},{until:since},
    {since:'2026-03-08T00:00:00-08:00'},{since:'2026-02-30T00:00:00.000Z'},
    {since:'2024-01-01T00:00:00.000Z'},{client:'exact*'},{timeBasis:'invented'}]) {
    assert.equal(f.core[method]({...input,...patch}).error.code,'invalid_input',JSON.stringify(patch));
  }
  for(const states of [[],['deleted'],['active','active'],null])assert.equal(f.core.listMemoriesByTime({...input,states}).error.code,'invalid_input');
  assert.equal(f.core.listEpisodes({...input,states:['active']}).error.code,'invalid_input');
});

test('E9 indexed keyset plans use intended indexes without sorting, including exact-client variants',t=>{
  const f=fixture(t);
  for(const [operation,bases]of [['listEpisodes',['event','receipt']],['listMemoriesByTime',['receipt','revision']]])
    for(const timeBasis of bases)for(const client of [undefined,'exact'])for(const after of [undefined,{time:since,id:'id',memoryId:'memory'}]) {
      const filter=rangeInput({...input,timeBasis,...(client?{client}:{})},operation);
      const {sql,params}=rangeQuery(ns,operation,filter,after);
      const plan=f.db.prepare('EXPLAIN QUERY PLAN '+sql).all(...params).map(row=>row.detail).join('\n');
      const index=operation==='listEpisodes'?(timeBasis==='event'?'episode_event_read':'episode_receipt_read'):
        timeBasis==='receipt'?'receipt_time_read':'namespace_memories';
      assert.match(plan,new RegExp(index));assert.doesNotMatch(plan,/TEMP B-TREE/);
      assert.equal(params.at(-1),21);
    }
});

test('E3/E7/E9 reads never invoke generation, forgotten episode digests disappear, whole envelopes fit',t=>{
  const f=fixture(t), b=batch('read-only'), r=register(f,b), job=draft(f,r,b);
  f.runtime.commitEpisodeDraft(ns,job.commit);
  const core=openMemoryCore({path:f.path,model:{extract(){throw new Error('generation forbidden');},interpretEpisode(){throw new Error('generation forbidden');},classify(){throw new Error('generation forbidden');},select(){throw new Error('generation forbidden');}}});t.after(()=>core.close());
  for(const method of ['listEpisodes','listMemoriesByTime']) assert.equal(core[method](input).ok,true);
  const detail=ok(core.getEpisode({namespace:ns,episodeId:r.episodeId}));assert.ok(detail.sources.items.length);
  assert.ok(Buffer.byteLength(JSON.stringify({ok:true,value:detail}))<=65536);
  ok(core.forgetEpisode({namespace:ns,episodeId:r.episodeId,expectedRevision:detail.episode.revision}));
  assert.equal(core.getEpisode({namespace:ns,episodeId:r.episodeId}).error.code,'episode_not_found');
  assert.equal(ok(core.listEpisodes({...input,timeBasis:'receipt',since:'2026-01-01T00:00:00.000Z',until:'2027-01-01T00:00:00.000Z'})).items.length,0);
});

test('E9 whole-record envelope budgeting includes cursor and rejects an oversized first item',()=>{
  const filter={limit:20},rows=Array.from({length:21},(_,id)=>({item:{id,text:'中'.repeat(9000)},key:{id}}));
  const encode=()=> 'c'.repeat(1000);
  const value=rangePage({epoch:1,rows},filter,{},encode,'listEpisodes');
  assert.equal(value.status,'budget_exhausted');assert.equal(value.items.length,2);assert.equal(value.exhausted,false);
  assert.ok(Buffer.byteLength(JSON.stringify({ok:true,value}))<=65536);
  assert.throws(()=>rangePage({epoch:1,rows:[{item:{text:'中'.repeat(22000)},key:{id:1}}]},filter,{},encode,'listEpisodes'),{code:'context_item_too_large'});
});

test('E9 receipt and revision pages handle ties with no duplicates, exact replay and mutation epochs',t=>{
  const f=fixture(t);for(let i=0;i<53;i++)memory(f,ns,'exact','Synthetic range item '+i);
  timeMemories(f);
  for(const timeBasis of ['receipt','revision']) {
    const first=ok(f.core.listMemoriesByTime({...input,timeBasis}));assert.equal(first.items.length,20);
    const second=ok(f.core.listMemoriesByTime({...input,timeBasis,cursor:first.nextCursor}));assert.equal(second.items.length,20);
    const third=ok(f.core.listMemoriesByTime({...input,timeBasis,cursor:second.nextCursor}));assert.equal(third.items.length,13);assert.equal(third.exhausted,true);
    const items=[...first.items,...second.items,...third.items];
    const keys=items.map(item=>item.receipt?.id??item.memory.id);assert.equal(new Set(keys).size,53);assert.deepEqual(keys,[...keys].sort());
    memory(f,ns,'exact','Synthetic range item 0');
    assert.equal(f.core.listMemoriesByTime({...input,timeBasis,cursor:first.nextCursor}).ok,true);
    assert.equal(f.core.listEpisodes({...input,cursor:first.nextCursor}).error.code,'invalid_cursor');
  }
  const first=ok(f.core.listMemoriesByTime(input));memory(f,ns,'exact','Synthetic new mutation');
  assert.equal(f.core.listMemoriesByTime({...input,cursor:first.nextCursor}).error.code,'cursor_stale');
});

test('E9 getEpisode page query indexes support deterministic bounded inspection without sorting',t=>{
  const f=fixture(t);
  for(const [index,sql,params]of [
    ['episode_source_page','SELECT * FROM episode_sources WHERE episode_id=? AND id>? ORDER BY id LIMIT ?',['episode','',21]],
    ['episode_lineage_page','SELECT l.* FROM episode_memory_links l JOIN memories m ON m.id=l.memory_id WHERE l.episode_id=? AND l.id>? AND m.deleted=0 AND m.owner_id=? AND m.scope=? AND m.project_id=? ORDER BY l.id LIMIT ?',['episode','',ns.ownerId,ns.scope,ns.projectId,21]],
    ['episode_policy_page','SELECT * FROM episode_events WHERE episode_id=? AND position>? ORDER BY position LIMIT ?',['episode',0,21]],
    ['sqlite_autoindex_episode_keep_actions_3','SELECT * FROM episode_keep_actions WHERE episode_id=? AND keep_ordinal>? ORDER BY keep_ordinal LIMIT ?',['episode',0,21]],
  ]) {
    const plan=f.db.prepare('EXPLAIN QUERY PLAN '+sql).all(...params).map(row=>row.detail).join('\n');
    assert.match(plan,new RegExp(index));assert.doesNotMatch(plan,/TEMP B-TREE/);
  }
});

test('E9 public episode pages budget whole multilingual records including the success envelope',t=>{
  const f=fixture(t);
  for(let i=0;i<23;i++){
    const b=batch('budget-'+i,'Synthetic multilingual source','budget-'+i),r=register(f,b),job=draft(f,r,b);
    job.commit.result.gist.value='中'.repeat(400);
    job.commit.result.outcome={value:'文'.repeat(240),anchors:[{sourceIndex:0,start:0,end:5}]};
    job.commit.result.nextStep.value='字'.repeat(240);
    f.runtime.commitEpisodeDraft(ns,job.commit);
    f.db.prepare('UPDATE session_episodes SET first_received_at=? WHERE id=?').run(since,r.episodeId);
  }
  const request={...input,timeBasis:'receipt'};let page=ok(f.core.listEpisodes(request)),ids=[];
  assert.equal(page.status,'budget_exhausted');assert.ok(page.items.length<20);
  for(;;){assert.ok(Buffer.byteLength(JSON.stringify({ok:true,value:page}))<=65536);ids.push(...page.items.map(e=>e.id));
    if(page.exhausted)break;page=ok(f.core.listEpisodes({...request,cursor:page.nextCursor}));}
  assert.equal(ids.length,23);assert.equal(new Set(ids).size,23);
});

test('E7/E9 inspection cursors report stale after deletion before fresh lookup reports not found',t=>{
  const f=fixture(t),b=batch('first','Synthetic source','same'),r=register(f,b),job=draft(f,r,b);
  f.runtime.commitEpisodeDraft(ns,job.commit);f.runtime.releaseEpisodeWriter(ns,{episodeId:r.episodeId,token:job.writer.token});
  register(f,batch('second','Synthetic newer source','same'));
  const page=inspect(f,r.episodeId,{policyLimit:1});assert.ok(page.policies.nextCursor);
  ok(f.core.forgetEpisode({namespace:ns,episodeId:r.episodeId,expectedRevision:page.episode.revision}));
  assert.equal(f.core.getEpisode({namespace:ns,episodeId:r.episodeId,policyLimit:1,policyCursor:page.policies.nextCursor}).error.code,'cursor_stale');
  assert.equal(f.core.getEpisode({namespace:ns,episodeId:r.episodeId}).error.code,'episode_not_found');
});


test('E1/E9 inspection revalidates lineage target namespace as well as deletion',t=>{
  const f=fixture(t),e=episode(f,'lineage');
  for(const [i,scope] of [{...ns,ownerId:'other'},{...ns,projectId:'other'}].entries()){
    const m=memory(f,scope,'synthetic','Synthetic isolated lineage '+i);
    const receipt=f.db.prepare('SELECT id FROM receipts WHERE memory_id=?').get(m.id).id;
    f.db.prepare('INSERT INTO episode_memory_links VALUES(?,?,?,?,?,?)').run('synthetic-foreign-'+i,e,m.id,'event-'+i,m.revision,JSON.stringify([receipt]));
  }
  assert.deepEqual(inspect(f,e).memoryLinks.items,[]);
});
