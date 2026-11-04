import { openDatabase } from '../database.mjs';
import { beginContentWriteSafety } from '../content-write-safety.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { contentWriteChanges } from '../content-write-changes.mjs';
import { transaction } from '../database.mjs';
import { contentSafetyFacade } from '../content-safety-boundary.mjs';
import { contentReadSafety } from '../content-safety.mjs';
import { contentSafetyInventory } from '../content-safety-migration.mjs';
import { memorySuppressionObservationInside, withContentSuppressionCeilingsInside, writeContentSuppressionInside } from '../content-suppression-storage.mjs';
import { openMemoryCore } from '../index.mjs';
import { safetyFixture, ns, ok, receipt } from '../testing/content-safety-s2h-fixture.mjs';

const admit=core=>ok(core.admit({namespace:ns,memory:{content:'Synthetic session reference',kind:'instruction'},receipts:[receipt('session')]})).memory;

test('r4 native change enumeration retains compound keys, old/new values, triggers and binary metadata',()=>{
  const db=new DatabaseSync(':memory:');
  try{
    db.exec('CREATE TABLE entries(a TEXT,b INTEGER,value TEXT,n REAL,bytes BLOB,PRIMARY KEY(a,b));CREATE TABLE effects(id INTEGER PRIMARY KEY,entry_a TEXT);CREATE TRIGGER touched AFTER INSERT ON entries BEGIN INSERT INTO effects VALUES(NEW.b,NEW.a); END');
    db.prepare('INSERT INTO entries VALUES(?,?,?,?,?)').run('updated',1,'before',1.5,Buffer.from([1]));
    db.prepare('INSERT INTO entries VALUES(?,?,?,?,?)').run('deleted',2,'old',null,null);
    const session=db.createSession();
    db.prepare('UPDATE entries SET value=?,n=? WHERE a=? AND b=?').run('after',2.5,'updated',1);
    db.prepare('DELETE FROM entries WHERE a=? AND b=?').run('deleted',2);
    db.prepare('INSERT INTO entries VALUES(?,?,?,?,?)').run('中'.repeat(100),3,'new',null,Buffer.from([2,3]));
    const bytes=session.changeset(),changes=contentWriteChanges(bytes);session.close();
    assert.equal(changes.length,4);const entries=changes.filter(c=>c.table==='entries');assert.equal(entries.length,3);
    assert.ok(entries.every(c=>c.primary.join()==='1,2,0,0,0'));
    assert.equal(entries.find(c=>c.old?.[0]==='updated').next[2],'after');
    assert.equal(entries.find(c=>c.old?.[0]==='deleted').next,null);
    assert.deepEqual([...entries.find(c=>!c.old).next[4]],[2,3]);
    assert.equal(changes.filter(c=>c.table==='effects').length,1);
    for(const invalid of [bytes.subarray(0,bytes.length-1),Uint8Array.of(23,0),Uint8Array.of(84,1,1,120)])assert.throws(()=>contentWriteChanges(invalid),{code:'evidence_unavailable'});
  }finally{db.close();}
});

test('r4 guard sessions are absent from opens and owner reads, and allocated once per mutation',async t=>{
  const f=safetyFixture(t);await f.migrate();const createSession=DatabaseSync.prototype.createSession;let sessions=0;
  DatabaseSync.prototype.createSession=function(...args){sessions++;return createSession.apply(this,args);};
  let core;try{
    core=openMemoryCore({path:f.path,model:{countTokens:()=>1}});assert.equal(sessions,0);
    ok(core.map({namespace:ns}));assert.equal(sessions,0);
    const memory=admit(core);assert.equal(sessions,1);
    ok(core.get({namespace:ns,memoryId:memory.id}));assert.equal(sessions,1);
    ok(core.forget({namespace:ns,memoryId:memory.id,expectedRevision:memory.revision}));assert.equal(sessions,2);
  }finally{core?.close();DatabaseSync.prototype.createSession=createSession;}
});

test('r4 a trigger-written receipt reference is validated even when absent from the acknowledgement',async t=>{
  const f=safetyFixture(t);await f.migrate();const core=openMemoryCore({path:f.path}),db=f.connect();t.after(()=>{core.close();db.close();});
  const memory=admit(core),r=db.prepare('SELECT id FROM receipts WHERE memory_id=?').get(memory.id);
  transaction(db,()=>writeContentSuppressionInside(db,{namespace:ns,kind:'receipt',key:r.id,reason:'privacy_erase',actionId:'pre-existing'}));
  db.exec(`CREATE TRIGGER synthetic_anchor AFTER UPDATE ON memories BEGIN INSERT INTO procedural_tags SELECT NEW.id,1,1,'explicit',json_array(json_object('receiptId',id,'digest','synthetic','start',0,'end',1)) FROM receipts WHERE memory_id=NEW.id; END`);
  const before=contentSafetyInventory(db);
  const api=contentSafetyFacade({admit(){return transaction(db,()=>{db.prepare("UPDATE memories SET updated_at='uncommitted' WHERE id=?").run(memory.id);return {ok:true,value:{changed:true}};});}},
    {check(){},failure:error=>({ok:false,error:{code:error.code}})});
  assert.equal(api.admit({namespace:ns}).ok,false);assert.equal(contentSafetyInventory(db),before);assert.equal(db.prepare('SELECT count(*) n FROM procedural_tags').get().n,0);
});

test('r4 mutation fact cutoffs and terminal ancestor exemptions never narrow the B3 observation',async t=>{
  const f=safetyFixture(t);await f.migrate();const core=openMemoryCore({path:f.path}),db=f.connect();t.after(()=>{core.close();db.close();});
  const memory=admit(core);transaction(db,()=>{
    const fact=writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:memory.id,reason:'privacy_erase',actionId:'new-fact'});
    for(const ceiling of [0n,1n])withContentSuppressionCeilingsInside(db,new Map([[ns.ownerId,ceiling]]),()=>{
      assert.equal(contentReadSafety(db,{namespace:ns,intent:'history',ref:{type:'memory',namespace:ns,memoryId:memory.id,revision:memory.revision}}).allowed,true);
      const observation=memorySuppressionObservationInside(db,ns,{memoryId:memory.id,revision:memory.revision});assert.equal(observation.complete,true);assert.equal(observation.suppressed,true);assert.equal(observation.matchedCount,1);
    },ceiling===1n?new Set([fact.factId]):undefined);
  });
});

for(const base of [18,23,33])test(`r4 legacy base ${base} mutations allocate no safety session or statements`,()=>{
  const db=openDatabase(':memory:',base===18?{}:base===23?{privateCards:true}:{currentDependencies:true});
  const prepare=db.prepare;let statements=0,sessions=0;const session=db.createSession;
  db.prepare=function(...args){statements++;return prepare.apply(this,args);};
  db.createSession=function(...args){sessions++;return session.apply(this,args);};
  try{assert.equal(beginContentWriteSafety(db,{method:'admit',scopes:[ns]}),null);assert.equal(statements,0);assert.equal(sessions,0);}finally{db.close();}
});

for(const kind of ['owner','namespace'])test(`r4 ${kind} erasure is rechecked in the mutation snapshot before a row-only acknowledgement`,async t=>{
  const f=safetyFixture(t);await f.migrate();const core=openMemoryCore({path:f.path}),db=f.connect();t.after(()=>{core.close();db.close();});
  const memory=admit(core);
  transaction(db,()=>writeContentSuppressionInside(db,{namespace:kind==='owner'?{ownerId:ns.ownerId,scope:'owner',projectId:''}:ns,kind,matchMode:kind,reason:'privacy_erase',actionId:'entry-race'}));
  const before=contentSafetyInventory(db);let mutations=0;
  const api=contentSafetyFacade({releaseEpisodeWriter(){return transaction(db,()=>{mutations++;db.prepare('DELETE FROM namespace_epochs WHERE owner_id=?').run(ns.ownerId);return {ok:true,value:{changed:true}};});}},
    {check(){},failure:error=>({ok:false,error:{code:error.code}})});
  assert.equal(api.releaseEpisodeWriter({namespace:ns}).ok,false);assert.equal(mutations,0);assert.equal(contentSafetyInventory(db),before);
  assert.equal(db.prepare('SELECT revision FROM memories WHERE id=?').get(memory.id).revision,memory.revision);
});
