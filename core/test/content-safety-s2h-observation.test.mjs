import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { safetyFixture, ns } from '../testing/content-safety-s2h-fixture.mjs';
import { transaction, readTransaction } from '../database.mjs';
import { attestContentSafety } from '../content-safety-schema.mjs';
import * as publicApi from '../index.mjs';
import { contentSuppressionFenceInside, memorySuppressionObservationInside,
  writeContentSuppressionInside } from '../content-suppression-storage.mjs';

const digest = rows => createHash('sha256').update(JSON.stringify(rows)).digest('base64url');
assert.equal(Object.hasOwn(publicApi,'memorySuppressionObservationInside'),false);
const empty = { complete:true,suppressed:false,matchedCount:0,matchedEpoch:null,factId:null,reason:null,matchedSetDigest:digest([]) };
function memory(db, namespace = ns, revision = 6) {
  const id = randomUUID();
  db.prepare(`INSERT INTO memories(id,owner_id,scope,project_id,fingerprint,content,kind,origin,confidence,revision,deleted,created_at,updated_at)
    VALUES(?,?,?,?,?,'Synthetic observation text','fact','explicit',1,?,0,'time','time')`)
    .run(id,namespace.ownerId,namespace.scope,namespace.projectId ?? '',id,revision);
  return { memoryId:id,revision };
}
function observe(db, namespace, ref, options) {
  const value = memorySuppressionObservationInside(db,namespace,ref,options);
  return value;
}
function expected(db, facts) {
  const rows = facts.map(fact => db.prepare('SELECT * FROM content_suppressions WHERE fact_id=?').get(fact.factId))
    .sort((a,b)=>a.epoch_hi-b.epoch_hi||a.epoch_lo-b.epoch_lo);
  const last = rows.at(-1);
  return { complete:true,suppressed:rows.length > 0,matchedCount:rows.length,matchedEpoch:last ? String((BigInt(last.epoch_hi)<<32n)+BigInt(last.epoch_lo)) : null,
    factId:last?.fact_id ?? null,reason:last?.reason ?? null,matchedSetDigest:digest(rows.map(row=>[row.epoch_hi,row.epoch_lo,row.fact_id])) };
}
// Same snapshot-local prepared-reader shape as S1's createContentReadMemo. The
// S1 fix round is merged separately; no second memo implementation is exported.
function memoFor(db) {
  const statements = new Map();
  return { db:{ get isTransaction(){return db.isTransaction;},prepare(sql){
    if(!statements.has(sql))statements.set(sql,db.prepare(sql));return statements.get(sql);
  } },sources:new Map(),memories:new Map(),receipts:new Map(),contributors:new Map() };
}
function charged(db, { remaining = Infinity, rowLimit = Infinity, error = {code:'source_budget_exceeded'} } = {}) {
  const stats={statements:0,rows:0,sql:[]};
  const reader={get isTransaction(){return db.isTransaction;},prepare(sql){
    const statement=db.prepare(sql);
    return new Proxy(statement,{get(target,key){
      if(!['get','all','iterate'].includes(key)){const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}
      return (...args)=>{
        if(--remaining<0)throw error;
        stats.statements++;stats.sql.push(sql);
        const charge=row=>{if(row){if(++stats.rows>rowLimit)throw error;}return row;};
        if(key==='get')return charge(target.get(...args));
        if(key==='all')return target.all(...args).map(charge);
        return (function*(){for(const row of target.iterate(...args))yield charge(row);})();
      };
    }});
  }};
  return {reader,stats};
}
for(const base of [18,23,33])test(`S2h observation ${base}: legacy capability shape and no transaction allocation`,t=>{
  const f=safetyFixture(t,base),db=f.connect();t.after(()=>db.close());attestContentSafety(db);
  const ref=transaction(db,()=>memory(db));
  readTransaction(db,()=>{
    const {reader,stats}=charged(db);
    assert.deepEqual(observe(db,ns,ref,{reader}),{complete:true,suppressed:false,capability:'none'});
    assert.equal(stats.statements,1);assert.equal(stats.rows,1);
    assert.ok(stats.sql.every(sql=>!/^\s*(?:BEGIN|COMMIT|CREATE|INSERT|UPDATE|DELETE)/i.test(sql)));
  });
});
for(const base of [18,23,33])test(`S2h observation ${base}: complete envelope, match modes, highest epoch and independent digest`,async t=>{
  const f=safetyFixture(t,base);await f.migrate();const db=f.connect();t.after(()=>db.close());attestContentSafety(db);
  for(const mode of ['none','incarnation','version','revision-through','namespace','owner']){
    const namespace={...ns,ownerId:'synthetic-'+mode},ref=transaction(db,()=>memory(db,namespace));
    transaction(db,()=>{
      const write=patch=>writeContentSuppressionInside(db,{namespace,kind:'memory',key:ref.memoryId,reason:'purge',actionId:randomUUID(),...patch});
      // A nonmatching bound version must not appear in the observation digest.
      write({matchMode:'version',sourceVersion:JSON.stringify(['memory-revision-v1',7])});
      let facts=[];
      if(mode!=='none'){
        const target=mode==='owner'?{namespace:{ownerId:namespace.ownerId,scope:'owner',projectId:''},kind:'owner',key:'',matchMode:mode}:
          mode==='namespace'?{kind:'namespace',key:'',matchMode:mode}:{matchMode:mode};
        if(mode==='version')target.sourceVersion=JSON.stringify(['memory-revision-v1',6]);
        if(mode==='revision-through')target.sourceVersion=JSON.stringify(['memory-revision-through-v1',6]);
        facts=[write(target),write({...target,reason:'privacy_erase'})];
      }
      const {reader,stats}=charged(db),memo=memoFor(db);
      // A charged reader takes precedence over the memo's uncharged reader.
      assert.deepEqual(observe(db,namespace,ref,{reader,memo}),expected(db,facts),mode);
      assert.equal(stats.statements,2);assert.equal(stats.rows,mode==='none'?2:4);
      assert.ok(db.isTransaction);
    });
  }
});
test('S2h observation: revision-through M@6 matches M@4 and M@6, never M@7',async t=>{
  const f=safetyFixture(t);await f.migrate();const db=f.connect();t.after(()=>db.close());attestContentSafety(db);
  transaction(db,()=>{
    const ref=memory(db),fact=writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:ref.memoryId,
      matchMode:'revision-through',sourceVersion:JSON.stringify(['memory-revision-through-v1',6]),reason:'correction_supersession',actionId:'through'});
    for(const revision of [4,6,7]){
      db.prepare('UPDATE memories SET revision=? WHERE id=?').run(revision,ref.memoryId);
      assert.deepEqual(observe(db,ns,{...ref,revision}),revision<=6?expected(db,[fact]):empty);
    }
  });
});
test('S2h observation: mutable Raw ancestry changes the digest for {1,2,4} versus {1,3,4}',async t=>{
  const f=safetyFixture(t,33);await f.migrate();const db=f.connect();t.after(()=>db.close());attestContentSafety(db);
  transaction(db,()=>{
    const ref=memory(db),receipts=['receipt-one','receipt-two'];
    for(const id of receipts){
      const source={client:'synthetic',sessionId:'session',eventId:id,role:'user',excerpt:'Synthetic Raw ancestry'};
      db.prepare('INSERT INTO receipts VALUES(?,?,?,?,?,?,?,?,?)').run(id,ref.memoryId,createHash('sha256').update(JSON.stringify(source)).digest('hex'),
        source.client,source.sessionId,source.eventId,source.role,source.excerpt,'time');
    }
    for(const id of ['raw-a','raw-b'])db.prepare('INSERT INTO raw_conversations VALUES(?,?,?,?,?,?,1,?,?)')
      .run(id,ns.ownerId,ns.scope,ns.projectId,'codex',id,'time','time');
    for(const id of receipts)db.prepare("INSERT INTO raw_receipt_lineage VALUES(?,'raw-a','message',1,5,'exact')").run(id);
    const write=patch=>writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:ref.memoryId,reason:'purge',actionId:randomUUID(),...patch});
    const one=write({}),two=write({kind:'raw',key:'raw-a',matchMode:'span',messageId:'message',start:0,end:4}),
      three=write({kind:'raw',key:'raw-b',matchMode:'span',messageId:'message',start:0,end:4}),
      four=write({matchMode:'version',sourceVersion:JSON.stringify(['memory-revision-v1',6]),reason:'privacy_erase'});
    const memo=memoFor(db),before=observe(db,ns,ref,{memo});assert.deepEqual(before,expected(db,[one,two,four]));
    db.prepare("UPDATE raw_receipt_lineage SET conversation_id='raw-b'").run();
    const after=observe(db,ns,ref,{memo});assert.deepEqual(after,expected(db,[one,three,four]));
    assert.equal(before.matchedCount,after.matchedCount);assert.equal(before.matchedEpoch,after.matchedEpoch);
    assert.equal(before.factId,after.factId);assert.notEqual(before.matchedSetDigest,after.matchedSetDigest);
  });
});
test('S2h observation: Raw spans overlap only in the bound conversation and message',async t=>{
  const f=safetyFixture(t,33);await f.migrate();const db=f.connect();t.after(()=>db.close());attestContentSafety(db);
  transaction(db,()=>{
    const ref=memory(db);
    db.prepare("INSERT INTO receipts VALUES('span-receipt',?,'synthetic-key','synthetic','session','event','user','Synthetic span','time')").run(ref.memoryId);
    db.prepare("INSERT INTO raw_conversations VALUES('span-raw',?,?,?,'codex','span-session',1,'time','time')").run(ns.ownerId,ns.scope,ns.projectId);
    db.prepare("INSERT INTO raw_receipt_lineage VALUES('span-receipt','span-raw','message',4,8,'exact')").run();
    const write=patch=>writeContentSuppressionInside(db,{namespace:ns,kind:'raw',key:'span-raw',matchMode:'span',messageId:'message',
      start:0,end:4,reason:'privacy_erase',actionId:randomUUID(),...patch});
    write({});write({messageId:'different-message',start:4,end:8});
    assert.deepEqual(observe(db,ns,ref),empty);
    const span=write({start:7,end:9}),incarnation=write({matchMode:'incarnation',messageId:'',start:0,end:0});
    assert.deepEqual(observe(db,ns,ref),expected(db,[span,incarnation]));
  });
});
test('S2h observation: canonical fence advances on inserts, never on cleanup transitions',async t=>{
  const f=safetyFixture(t);await f.migrate();const db=f.connect();t.after(()=>db.close());attestContentSafety(db);
  transaction(db,()=>{
    const ref=memory(db),write=actionId=>writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:ref.memoryId,reason:'purge',actionId});
    assert.equal(contentSuppressionFenceInside(db,ns.ownerId),'0:0');
    const first=write('first');assert.equal(contentSuppressionFenceInside(db,ns.ownerId),'0:1');
    const before=observe(db,ns,ref);
    for(const status of ['failed','complete']){
      db.prepare('UPDATE content_suppressions SET cleanup_status=?,cleanup_attempt=cleanup_attempt+1 WHERE fact_id=?').run(status,first.factId);
      assert.equal(contentSuppressionFenceInside(db,ns.ownerId),'0:1');assert.deepEqual(observe(db,ns,ref),before);
    }
    assert.deepEqual(write('first'),first);assert.equal(contentSuppressionFenceInside(db,ns.ownerId),'0:1');
    const second=write('second');assert.equal(contentSuppressionFenceInside(db,ns.ownerId),'0:2');
    assert.deepEqual(observe(db,ns,ref),expected(db,[first,second]));
  });
});
test('S2h observation: refused native connections remain incomplete through fresh readers',async t=>{
  const f=safetyFixture(t);await f.migrate();const db=f.connect();t.after(()=>db.close());attestContentSafety(db);
  const ref=transaction(db,()=>memory(db)),guard=db.prepare("SELECT sql FROM sqlite_schema WHERE name='safety_memories_insert'").get().sql;
  db.exec('DROP TRIGGER safety_memories_insert');
  readTransaction(db,()=>assert.deepEqual(memorySuppressionObservationInside(db,ns,ref),{complete:false,cause:'unavailable'}));
  db.exec(guard);
  readTransaction(db,()=>{
    const {reader,stats}=charged(db);
    assert.deepEqual(memorySuppressionObservationInside(db,ns,ref,{reader}),{complete:false,cause:'unavailable'});
    assert.equal(stats.statements,0);
  });
});
test('S2h observation: charged statement and row exhaustion refuse without poisoning attestation',async t=>{
  const f=safetyFixture(t);await f.migrate();const db=f.connect();t.after(()=>db.close());attestContentSafety(db);
  const ref=transaction(db,()=>{
    const ref=memory(db);
    for(const actionId of ['one','two'])writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:ref.memoryId,reason:'purge',actionId});
    return ref;
  });
  assert.deepEqual(memorySuppressionObservationInside(db,ns,ref),{complete:false,cause:'unavailable'});
  readTransaction(db,()=>{
    for(const options of [{remaining:0},{remaining:1},{rowLimit:2},{remaining:0,error:{reason:'work_limit'}},
      {remaining:0,error:{reason:'state_limit'}},{remaining:0,error:{reason:'deadline'}}]){
      const {reader}=charged(db,options);
      assert.deepEqual(memorySuppressionObservationInside(db,ns,ref,{reader,memo:memoFor(db)}),{complete:false,cause:'budget'});
      assert.equal(observe(db,ns,ref).suppressed,true,'exhaustion cannot poison the native connection');
    }
    const {reader,stats}=charged(db);
    assert.equal(observe(db,ns,ref,{reader}).matchedCount,2);
    assert.equal(stats.statements,2);assert.equal(stats.rows,3);
    t.diagnostic('warm observation: statements='+stats.statements+' rows='+stats.rows);
  });
});

test('S2h observation: foreign or missing Raw ancestry refuses even with no matching fact',async t=>{
  const f=safetyFixture(t,33);await f.migrate();const db=f.connect();t.after(()=>db.close());attestContentSafety(db);
  // Deliberately bypass the FK only to represent already-corrupt missing ancestry.
  db.exec('PRAGMA foreign_keys=OFF');
  transaction(db,()=>{
    const ref=memory(db);
    db.prepare("INSERT INTO receipts VALUES('foreign-receipt',?,'foreign-key','synthetic','session','event','user','Synthetic ancestry','time')").run(ref.memoryId);
    db.prepare("INSERT INTO raw_conversations VALUES('foreign-raw','synthetic-other-owner',?,?,'codex','foreign-session',1,'time','time')").run(ns.scope,ns.projectId);
    db.prepare("INSERT INTO raw_receipt_lineage VALUES('foreign-receipt','foreign-raw','message',0,2,'exact')").run();
    const memo=memoFor(db);
    assert.deepEqual(memorySuppressionObservationInside(db,ns,ref,{memo}),{complete:false,cause:'unavailable'});
    db.exec("DELETE FROM raw_conversations WHERE id='foreign-raw'");
    assert.deepEqual(memorySuppressionObservationInside(db,ns,ref,{memo}),{complete:false,cause:'unavailable'});
    db.exec("DELETE FROM raw_receipt_lineage WHERE receipt_id='foreign-receipt'");
    assert.deepEqual(memorySuppressionObservationInside(db,ns,ref,{memo}),empty);
  });
});
