import assert from 'node:assert/strict';
import test from 'node:test';
import { chmodSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';
import { openMemoryReader } from '../index.mjs';
import { createTopicMemberReader } from '../topic-members-reader.mjs';
import { createTopicTokens } from '../topic-snapshot.mjs';
import { membersInput } from '../topic-members-input.mjs';
import { memberFixture, smallHierarchy, namespace, overview, ok } from '../testing/topic-members-fixture.mjs';
import { alternateLayout, complete, observedReader } from '../testing/topic-members-review-fixture.mjs';
const base = { namespace, selection: { type:'unfiled' }, accessRevision:'review' };
const refused = { ok:false, error:{code:'unsupported_database'} };

test('spec P1: Accepted column collations can break namespace isolation', async t => {
  const f = memberFixture(t); f.admit('foreign-case');
  const path = alternateLayout(f, { nocaseOwner:true }); chmodSync(path,0o600);
  const reader = openMemoryReader({path,ownerId:namespace.ownerId}); t.after(()=>reader.close());
  assert.deepEqual(await reader.readTopicMembers(base),refused);
  assert.deepEqual(await reader.readTopicOverview({namespace,snapshotVersion:'topic-snapshot-v1'}),refused);
});

test('spec P1: BINARY ordering does not guarantee unsigned UTF-8 ordering', async t => {
  const f=memberFixture(t),h=smallHierarchy(f);
  f.place(namespace,[{memoryId:h.u.id,parentIds:[h.l1.id]}]);
  const ids=['A','ā','\uE000','\u{10000}'];
  f.db.exec('PRAGMA foreign_keys=OFF');
  for(const [i,row] of [h.a,h.b,h.c,h.u].entries()) {
    f.db.prepare('UPDATE memories SET id=? WHERE id=?').run(ids[i],row.id);
    f.db.prepare('UPDATE moc_memory_refs SET memory_id=? WHERE memory_id=?').run(ids[i],row.id);
    f.db.prepare('UPDATE moc_title_sources SET memory_id=? WHERE memory_id=?').run(ids[i],row.id);
  }
  for(const [old,id] of [[h.l1.id,'\u{10000}'],[h.l2.id,'\uE000']]) {
    f.db.prepare('UPDATE mocs SET id=? WHERE id=?').run(id,old);
    f.db.prepare('UPDATE moc_memory_refs SET moc_id=? WHERE moc_id=?').run(id,old);
    f.db.prepare('UPDATE moc_edges SET child_id=? WHERE child_id=?').run(id,old);
    f.db.prepare('UPDATE moc_title_sources SET moc_id=? WHERE moc_id=?').run(id,old);
  }
  const reader=f.reader(),issued=await overview(reader),root=issued.items.find(row=>row.level==='L2');
  const input={...base,selection:{type:'moc',mocId:root.id,revision:root.revision,level:'L2'},limit:1};
  const refs=await complete(reader,input);
  assert.deepEqual(refs.map(row=>row.id),ids);
  assert.equal(refs.find(row=>row.id===ids[2]).reportedUnder.mocId,'\uE000');
  for(const encoding of ['UTF-16le','UTF-16be']) {
    const path=alternateLayout(f,{encoding});chmodSync(path,0o600);
    const other=openMemoryReader({path,ownerId:namespace.ownerId});
    try {
      assert.deepEqual(await other.readTopicMembers(input),refused);
      assert.deepEqual(await other.readTopicOverview({namespace,snapshotVersion:'topic-snapshot-v1'}),refused);
      assert.equal((await other.readTopicOverview({namespace})).ok,true,'legacy opening remains unchanged');
    } finally {await other.close();}
  }
});

for(const [name,extraIndexes] of [
  ['spec P1: Opening performs unbounded, uncharged metadata work',128],
  ['standards P1: Member opening bypasses workLimit',0],
]) test(name,async t=>{
  const f=memberFixture(t);
  for(let i=0;i<extraIndexes;i++)f.db.exec(`CREATE INDEX review_extra_${i} ON memories(created_at)`);
  const observed=observedReader(t,f),{reader,report}=observed,input={...base,workLimit:16,deadlineMs:5000};
  let cursor,complete=false,maxPhysical=0,calls=0;const schemaRows=[];
  for(let i=0;i<3000;i++) {
    const page=ok(await reader.readTopicMembers({...input,...(cursor?{cursor}:{})})),physical=await report();
    calls++;maxPhysical=Math.max(maxPhysical,physical.visits);
    assert.ok(physical.visits<=4*input.workLimit,JSON.stringify({page:i,...physical}));
    assert.equal(physical.allCalls,0,'opening must not materialize index inventories');
    schemaRows.push(...physical.schemaRows);
    if(i===0){assert.equal(page.coverage.reason,'work_limit');assert.deepEqual(page.items,[]);}
    cursor=page.nextCursor;
    if(!cursor){assert.equal(page.coverage.complete,true);complete=true;break;}
  }
  assert.equal(complete,true);assert.ok(schemaRows.length>extraIndexes);
  t.diagnostic(JSON.stringify({finding:name,extraIndexes,calls,maxPhysicalVisits:maxPhysical,allowedPhysicalVisits:64,schemaRows:schemaRows.length}));
  assert.deepEqual(schemaRows,[...new Set(schemaRows)].sort((a,b)=>a-b),'schema keyset never rescans a consumed prefix');
  // Opt-in overview must use the same bounded initialization path on a cold handle.
  await reader.close(); observed.restore();
  const other=observedReader(t,f);let overviewCursor;
  for(let i=0;i<3000;i++) {
    const page=ok(await other.reader.readTopicOverview({namespace,snapshotVersion:'topic-snapshot-v1',workLimit:16,...(overviewCursor?{cursor:overviewCursor}:{})}));
    const physical=await other.report();assert.ok(physical.visits<=64,JSON.stringify(physical));assert.equal(physical.allCalls,0);
    overviewCursor=page.nextCursor;if(!overviewCursor){assert.equal(page.coverage.countsComplete,true);break;}
    assert.ok(i<2999,'opt-in initialization completes');
  }
});

function clockEngine() {
  let time=100,steps=0,onSnapshot=()=>{},onStep=()=>{};
  const tokens=createTopicTokens({now:()=>time});
  const storage={target(){},create:()=>({offset:0,pending:null,done:false}),step(s){steps++;onStep();
    if(s.offset===2)s.done=true;else s.pending={id:'id-'+s.offset++,revision:1,kind:'fact',reportedUnder:null};}};
  const reader=createTopicMemberReader({storage,tokens,transaction:fn=>fn(),snapshot:()=>{onSnapshot();return{storeId:'review',indexRevision:1,generation:null};},
    originBinding:()=>({scope:'review'}),now:()=>time,yieldQuantum:async()=>{}});
  return{read:(input={},deadline)=>reader.read(membersInput({...base,limit:1,...input},namespace.ownerId),deadline),
    get steps(){return steps;},set time(v){time=v;},set snapshot(fn){onSnapshot=fn;},set step(fn){onStep=fn;}};
}
test('standards P2: Cached replay bypasses deadline enforcement',async t=>{
  const e=clockEngine(),first=ok(await e.read()),input={cursor:first.nextCursor};
  ok(await e.read(input));e.time=200;
  await assert.rejects(e.read(input,199),{code:'read_timeout'});
  const terminal=clockEngine();terminal.step=()=>{terminal.time=250;const error=Error();error.code='state_limit';throw error;};
  await assert.rejects(terminal.read({},200),{code:'read_timeout'},'terminal partials also obey the deadline');
});
test('standards P2: Cached replay bypasses deadline enforcement — parent delivery guard',async t=>{
  const f=memberFixture(t),reader=f.reader();let time=100;
  t.mock.method(performance,'now',()=>time);t.mock.timers.enable({apis:['setTimeout']});
  t.mock.method(Worker.prototype,'postMessage',function(){time=151;queueMicrotask(()=>this.emit('message',{ok:true,value:{late:true}}));});
  assert.deepEqual(await reader.readTopicMembers({...base,deadlineMs:50}),{ok:false,error:{code:'read_timeout'}});
});
test('standards P2: Deadline partials can repeatedly make no traversal progress',async()=>{
  const e=clockEngine();let cursor,timedOut=false;
  for(let attempt=0;attempt<5;attempt++) {
    const start=100+attempt*50;e.time=start;e.snapshot=()=>{e.time=start+46;};
    try {const page=ok(await e.read({deadlineMs:50,...(cursor?{cursor}:{})},start+50));cursor=page.nextCursor;
      assert.equal(page.coverage.reason,'deadline');assert.deepEqual(page.items,[]);
    } catch(error) {assert.equal(error.code,'read_timeout');timedOut=true;break;}
  }
  assert.equal(e.steps,0);assert.equal(timedOut,true,'cannot issue an endless chain of unchanged deadline checkpoints');
});
