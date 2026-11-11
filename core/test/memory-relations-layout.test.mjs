import test from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryCore } from '../index.mjs';
import { openDatabase, transaction } from '../database.mjs';
import { resolveContentLayout, RELATION_LAYOUTS } from '../content-safety-layout.mjs';
import { attestContentSafety, receiptEventTimeEnabled, contentSafetyDDL } from '../content-safety-schema.mjs';
import { installMemoryRelations, previousRelationDDL } from '../memory-relations-schema.mjs';
import { migrateCardLineage } from '../content-safety-migration.mjs';
import { upgradeLayoutBase } from '../layout-base-upgrade.mjs';
import { installLocalRawPrivacy } from '../local-authority-schema.mjs';
import { safetyFixture, copySqliteFixture, quiescence, ns, ok, receipt } from '../testing/content-safety-s2h-fixture.mjs';
import { migrateEventTime } from '../testing/receipt-event-time-fixture.mjs';
import { host } from '../testing/context-read-core-fixture.mjs';

function install(db,revision){
 transaction(db,()=>{
  if(revision===2)installMemoryRelations(db);
  else {
   const physical=db.prepare('PRAGMA user_version').get().user_version;
   db.exec('ALTER TABLE memory_conflicts RENAME TO old_conflicts');db.exec(previousRelationDDL);
   db.exec(`DROP TABLE old_conflicts; PRAGMA user_version=${physical+100}`);
  }
  attestContentSafety(db);
 });
}
function seed(f,revision){
 const core=openMemoryCore({path:f.path});
 const a=ok(core.admit({namespace:ns,memory:{content:'Synthetic earlier breakfast',kind:'fact'},receipts:[receipt('earlier')]})).memory;
 const b=ok(core.admit({namespace:ns,memory:{content:'Synthetic later breakfast',kind:'fact'},receipts:[receipt('later')]})).memory;core.close();
 const db=openDatabase(f.path);install(db,revision);
 db.prepare(`INSERT INTO memory_relations(id,from_memory_id,from_revision,to_memory_id,to_revision,relation,confidence,decided_by,created_at${revision===2?',reason':''})
 VALUES('synthetic',?,?,?,?,'refines',1,'llm','now'${revision===2?",'Synthetic endpoint clarification'":''})`).run(b.id,b.revision,a.id,a.revision);
 for(const m of [a,b])db.prepare('INSERT INTO memory_relation_times VALUES(?,?,?,?)').run(m.id,m.revision,'2026-01-01T00:00:00.000Z',db.prepare('SELECT id FROM receipts WHERE memory_id=?').get(m.id).id);
 const expected=snapshot(db);db.close();return expected;
}
const snapshot=db=>({edges:db.prepare('SELECT * FROM memory_relations ORDER BY id').all(),times:db.prepare('SELECT * FROM memory_relation_times ORDER BY memory_id').all()});
function preserved(f,revision,expected){
 const db=openDatabase(f.path);try{
  assert.equal(attestContentSafety(db).relationsRevision,revision);assert.deepEqual(snapshot(db),expected);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
 }finally{db.close();}
}

test('all 42 relation families inherit exactly their base and reject adjacent/future families',()=>{
 const inherited=[18,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,38,48,51,52,53];
 assert.equal(RELATION_LAYOUTS.length,42);
 assert.deepEqual([...RELATION_LAYOUTS].sort((a,b)=>a-b),inherited.flatMap(n=>[n+100,n+200]).sort((a,b)=>a-b));
 for(const base of inherited)for(const revision of [1,2]){
  const layout=resolveContentLayout(base+100*revision),plain=resolveContentLayout(base);
  assert.deepEqual({...layout,physical:base,relationsRevision:0},plain);
  for(const adjacent of [layout.physical-1,layout.physical+1])if(!RELATION_LAYOUTS.includes(adjacent))assert.throws(()=>resolveContentLayout(adjacent),{code:'unsupported_database'});
  assert.equal(receiptEventTimeEnabled(layout),false,'unattested integers cannot grant receipt dates');
 }
 for(const unsupported of [300,318,333,351,999,NaN,Infinity,-1,218.5])assert.throws(()=>resolveContentLayout(unsupported),{code:'unsupported_database'});
});

for(const base of [18,23,33])for(const revision of [1,2])test(`safety, receipt-date and card-lineage migrations preserve relation revisions, edges, times and reasons: base=${base}, revision=${revision}`,async t=>{
 const f=safetyFixture(t,base),expected=seed(f,revision);
 await f.migrate();preserved(f,revision,expected);
 await migrateEventTime(f);preserved(f,revision,expected);
 if(base!==18){
  const db=openDatabase(f.path),suppressionDomain=db.prepare('SELECT suppression_domain FROM content_safety_control').get().suppression_domain;db.close();
  copySqliteFixture(f.path,f.backupPath);
  await migrateCardLineage({path:f.path,backupPath:f.backupPath,expected:{storeId:f.storeId,base,suppressionDomain},quiescence});
  preserved(f,revision,expected);
 }
});

for(const base of [18,23,33])for(const revision of [1,2])test(`attested flags 0/1 select receipt-date DDL at the same relation integer: base=${base}, revision=${revision}`,async t=>{
 const f=safetyFixture(t,base);await migrateEventTime(f);
 const db=openDatabase(f.path);t.after(()=>db.close());install(db,revision);
 const physical=db.prepare('PRAGMA user_version').get().user_version;
 assert.equal(receiptEventTimeEnabled(attestContentSafety(db)),true);
 db.exec('DROP TRIGGER safety_control_update; UPDATE content_safety_control SET receipt_event_time=0; DROP TRIGGER safety_receipt_identity; ALTER TABLE receipts DROP COLUMN occurred_at');
 const ddl=contentSafetyDDL(base,false,true);
 db.exec(ddl.match(/CREATE TRIGGER safety_receipt_identity[\s\S]*?END;/)[0]);
 db.exec(ddl.match(/CREATE TRIGGER safety_control_update[\s\S]*?END;/)[0]);
 assert.equal(attestContentSafety(db).physical,physical);assert.equal(receiptEventTimeEnabled(attestContentSafety(db)),false);
 db.exec('DROP TRIGGER safety_control_update; UPDATE content_safety_control SET receipt_event_time=1');
 assert.throws(()=>attestContentSafety(db),{code:'unsupported_database'},'integer alone cannot hide flag/DDL mismatch');
});

for(const revision of [1,2])test(`base 18 relation layout upgrades to base 33 while retaining relation revision ${revision}`,async t=>{
 const f=safetyFixture(t),expected=seed(f,revision);copySqliteFixture(f.path,f.backupPath);
 const result=await upgradeLayoutBase({path:f.path,backupPath:f.backupPath,expected:{storeId:f.storeId,fromBase:18,toBase:33},quiescence});
 assert.equal(result.toBase,33,JSON.stringify(result));preserved(f,revision,expected);
 const db=openDatabase(f.path);assert.equal(attestContentSafety(db).physical,33+100*revision);db.close();
});

for(const installed of [false,true])test(`embedded capabilities omit unsupported relations only on recognized relation layouts: ${installed}`,t=>{
 const f=safetyFixture(t),h=host();h.state.allowed=[ns];
 if(installed){const db=openDatabase(f.path);install(db,2);db.close();}
 const core=openMemoryCore({path:f.path,contextRead:{version:'context-read-v1',authority:h.authority}});t.after(()=>core.close());
 assert.equal(ok(core.getContextReadCapabilities()).unsupported.includes('relations'),!installed);
});

for(const localFirst of [false,true])test(`complete lineage inventory opens with both relations and local Raw privacy: local first=${localFirst}`,async t=>{
 const f=safetyFixture(t,33);await migrateEventTime(f);
 let db=openDatabase(f.path);
 const suppressionDomain=db.prepare('SELECT suppression_domain FROM content_safety_control').get().suppression_domain;db.close();
 copySqliteFixture(f.path,f.backupPath);
 await migrateCardLineage({path:f.path,backupPath:f.backupPath,expected:{storeId:f.storeId,base:33,suppressionDomain},quiescence});
 db=openDatabase(f.path);
 try{
  if(localFirst)transaction(db,()=>installLocalRawPrivacy(db));
  install(db,2);
  if(!localFirst)transaction(db,()=>installLocalRawPrivacy(db));
  assert.equal(attestContentSafety(db).relationsRevision,2);
 }finally{db.close();}
 const core=openMemoryCore({path:f.path});
 try{assert.deepEqual(ok(core.list({namespace:ns})).memories,[]);}
 finally{await core.close();}
 // The combined package must still refuse one extra, undeclared schema object.
 db=openDatabase(f.path);db.exec('CREATE TABLE unreviewed_object(value TEXT)');db.close();
 assert.throws(()=>openMemoryCore({path:f.path}),{code:'unsupported_database'});
});
