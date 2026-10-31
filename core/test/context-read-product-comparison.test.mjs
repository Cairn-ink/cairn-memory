import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync, backup } from 'node:sqlite';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chmodSync, existsSync, writeFileSync } from 'node:fs';
import { readTransaction, transaction } from '../database.mjs';
import { safetyFixture, ns } from '../testing/content-safety-s2h-fixture.mjs';
import { fixture, ok } from '../testing/context-read-fixture.mjs';
import { attestContentSafety } from '../content-safety-schema.mjs';
import { memorySuppressionObservationInside, writeContentSuppressionInside } from '../content-suppression-storage.mjs';
import { canonicalJson, accessDigest, projectionDigest, signedRecord } from '../context-product-validation.mjs';
import { productSidecar, PRODUCT_SIDECAR_SUFFIX } from '../context-product-sidecar.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import * as attribution from '../context-product-attribution.mjs';
import { createProductReaderRuntime, maintenancePhaseDiagnostic } from '../context-product-reader.mjs';
import { createContextReadSupervisor } from '../index.mjs';
import { CONTENT_SAFETY_POLICY_REVISION } from '../content-safety.mjs';
import { credentialDigest, PRODUCT_PROFILE } from '../context-product-control.mjs';

// Base qualification reaches the intended status/root assertions rather than
// failing module resolution before a test can execute its counterexample.
const loadComparison=url=>import(url.href).catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND'&&error.url===url.href)return {};throw error;
});
const implementation=await loadComparison(new URL('../context-product-comparison.mjs',import.meta.url));
const {maintenanceWorkFields}=attribution;
const memoryComparisonQualified=attribution.memoryComparisonQualified??(()=>false);
const maintenanceComparison=attribution.maintenanceComparison??(()=>undefined);
const createComparator=implementation.createMemoryComparator??(()=>()=>({status:'not_implemented'}));
const hash=s=>createHash('sha256').update(s).digest('base64url');
const selection={readSet:[ns],types:['memory'],intent:'current'};
const coverage={policy:'recent-projects-v1',selectionRevision:'synthetic',requestedNamespaces:1,selectedNamespaces:1,omittedNamespaces:0};
function memory(db,id='memory-a',text='Synthetic orchard text') {
  db.prepare(`INSERT INTO memories(id,owner_id,scope,project_id,fingerprint,content,kind,origin,confidence,revision,deleted,created_at,updated_at)
    VALUES(?,?,?,?,?,?,'fact','explicit',1,1,0,'time','time')`).run(id,ns.ownerId,ns.scope,ns.projectId,id,text);
  return id;
}
function runner(db,storeId,{read=work=>readTransaction(db,work),sample=()=> '7'}={}) {
  const capture=createComparator();let previous=null;
  return (options={})=>{
    const value=capture({db,read,selection,identity:{storeId},access:'synthetic-access',now:()=>0,cutoff:10000,
      budget:{maxItems:1,maxMs:5000},sample,loadBase:()=>previous,...options});
    previous=value.status?.startsWith('complete/')?value:null;return value;
  };
}
function setup(t,base=18) {
  const f=safetyFixture(t,base),db=f.connect();t.after(()=>db.close());
  return {f,db,run:runner(db,f.storeId)};
}
const root=value=>value.envelope?JSON.parse(value.envelope).root:null;
const frames=value=>(value.manifest??[]).flatMap(s=>s.trimEnd().split('\n').map(JSON.parse));
const items=value=>frames(value).filter(v=>v.item==='memory');

test('B3 legacy: no authenticated base is different; issuer-authenticated complete base is equal',t=>{
  const {db,run}=setup(t);memory(db);
  const first=run();assert.equal(first.status,'complete/different');
  assert.equal(run().status,'complete/equal');
  assert.equal(run({loadBase:()=>structuredClone(first)}).status,'complete/different','transport alone is no authentication');
  assert.equal(JSON.parse(first.envelope).sample,'7');
  assert.deepEqual(JSON.parse(first.envelope).usage,{rows:first.rows,bytes:first.bytes});
  assert.equal(frames(first).find(r=>r.fence==='suppression').epoch,null);
  assert.equal(items(first)[0].suppression.capability,'none');
  assert.ok(Object.isFrozen(first));assert.ok(first.payloads.every(s=>typeof s==='string'));
  assert.equal(db.isTransaction,false);assert.equal(db.isOpen,true);
});

test('B3 delete without epoch proves absence, including gap and tail keys',t=>{
  const {db,run}=setup(t);for(const key of ['a','b','z'])memory(db,key,key);
  const before=run();db.exec("DELETE FROM memories WHERE id IN ('b','z')");
  const after=run();assert.equal(after.status,'complete/different');assert.notEqual(root(before),root(after));
  assert.deepEqual(items(after).map(r=>r.id),['a']);
});

for(const intent of ['current','history'])test(`B3 eligibility without revision: ${intent}`,t=>{
  const {db,run}=setup(t);memory(db);
  const p={...selection,intent},before=run({selection:p});
  db.exec("UPDATE memories SET review_state='awaiting',currentness='historical'");
  const after=run({selection:p});assert.equal(after.status,'complete/different');
  assert.notEqual(root(before),root(after));assert.equal(items(after)[0].eligible,intent==='history');
});

test('B3 fence-only changes bind a new root with unchanged document tuples',t=>{
  const {db,run}=setup(t);memory(db);
  db.prepare('INSERT OR IGNORE INTO namespace_epochs VALUES(?,?,?,1)').run(ns.ownerId,ns.scope,ns.projectId);
  const before=run();db.exec('UPDATE namespace_epochs SET epoch=epoch+1');
  const after=run();assert.equal(after.status,'complete/different');
  assert.notEqual(root(before),root(after));assert.deepEqual(items(before),items(after));
});

test('B3 coherent frozen-E oracle: writer behind the cursor is E+1, never stitched',async t=>{
  const {f,db}=setup(t,33);for(let i=0;i<130;i++)memory(db,'m'+String(i).padStart(3,'0'),'orchard '+i);
  db.exec("UPDATE memories SET review_state='awaiting' WHERE id='m001'; UPDATE memories SET deleted=1,content=NULL WHERE id='m002'");
  const frozen=join(f.workspace.path,'frozen.sqlite');await backup(db,frozen);chmodSync(frozen,0o600);
  db.exec('PRAGMA journal_mode=WAL');
  const writer=f.connect();t.after(()=>writer.close());let changed=false,sampleBefore=false;
  const metered=new Proxy(db,{get(target,key){if(key!=='prepare'){const v=Reflect.get(target,key,target);return typeof v==='function'?v.bind(target):v;}
    return sql=>{const statement=target.prepare(sql);return new Proxy(statement,{get(s,k){const v=Reflect.get(s,k,s);if(typeof v!=='function')return v;
      return (...args)=>{const value=Reflect.apply(v,s,args);if(k==='iterate'&&sql.includes('SELECT id,revision,deleted')&&!sql.includes('typeof(')&&!changed){
        changed=true;memory(writer,'a-behind','inserted behind cursor');
        writer.prepare("UPDATE memories SET content='new E text',revision=revision+1 WHERE id='m000'").run();
        writer.exec("DELETE FROM memories WHERE id='m129'; UPDATE memories SET content='new denied body',fingerprint='new denied fingerprint' WHERE id='m001'");
      }return value;};}});};}});
  const run=runner(metered,f.storeId,{sample:()=>{assert.equal(db.isTransaction,false);sampleBefore=true;return '19';},read:work=>readTransaction(db,work)});
  const captured=run();assert.equal(captured.status,'complete/different');assert.ok(changed&&sampleBefore);
  const oracle=new DatabaseSync(frozen);t.after(()=>oracle.close());
  // Independent full SQL rebuild of this frozen fixture's input manifest. It
  // uses neither the comparator nor its cursor, eligibility or fence helpers.
  const expectedItems=oracle.prepare('SELECT id,revision,deleted,currentness,review_state,content,fingerprint FROM memories ORDER BY id COLLATE BINARY').all();
  const expectedBinding={domain:'context-read/b3-input-v2',storeId:f.storeId,canonical:null,
    projection:projectionDigest(selection),access:'synthetic-access',resources:'b3-capture-v1',safetyPolicyRevision:CONTENT_SAFETY_POLICY_REVISION};
  const expectedFrames=[{binding:expectedBinding,capability:'none',suppressionDomain:null},
    {fence:'suppression',owner:ns.ownerId,storeId:f.storeId,suppressionDomain:null,epoch:null},
    {fence:'namespace',namespace:[ns.ownerId,ns.scope,ns.projectId],epoch:null}];
  assert.equal(oracle.prepare('SELECT count(*) AS n FROM namespace_epochs').get().n,0);
  for(const table of ['raw_conversations','raw_session_fences','raw_exclusion_clocks','raw_source_exclusions']){
    assert.equal(oracle.prepare(`SELECT count(*) AS n FROM ${table}`).get().n,0);
    expectedFrames.push({fence:table,namespace:[ns.ownerId,ns.scope,ns.projectId],count:0,digest:hash('')});
  }
  for(const {content,fingerprint,...row}of expectedItems){
    const eligible=!row.deleted&&row.currentness==='current'&&row.review_state!=='awaiting';
    expectedFrames.push({item:'memory',namespace:[ns.ownerId,ns.scope,ns.projectId],...row,eligible,
      content:eligible?hash(content):null,contentIdentity:createHash('sha256').update(JSON.stringify([content,fingerprint])).digest('hex'),
      suppression:{suppressed:false,capability:'none'}});
  }
  expectedFrames.push({terminal:true,count:expectedItems.length});
  assert.equal(root(captured),hash(expectedFrames.map(canonicalJson).join('\n')+'\n'),'independent frozen database root');
  assert.deepEqual(items(captured).map(r=>[r.id,r.revision,r.content]),expectedItems.map(r=>[r.id,r.revision,!r.deleted&&r.review_state!=='awaiting'?hash(r.content):null]));
  const capturedLocations=captured.locations.flatMap(chunk=>chunk.trimEnd().split('\n').map(JSON.parse));
  assert.equal(capturedLocations.length,expectedItems.filter(r=>!r.deleted&&r.review_state!=='awaiting').length);
  for(const location of capturedLocations)assert.equal(location.spans.map(span=>captured.payloads[span.chunk].slice(span.start,span.end)).join(''),expectedItems[location.item].content);
  assert.equal(JSON.parse(captured.envelope).sample,'19');
  assert.notEqual(root(run()),root(captured));
});

for(const [kind,limits]of [['row',{rows:1}],['byte',{bytes:128}],['chunk',{chunks:1}],['frame',{frame:32}]])
test(`B3 ${kind} exhaustion drops every partial proof and retry starts over`,t=>{
  const {db,run}=setup(t);memory(db);const before=run();
  const partial=run({limits});assert.equal(partial.status,'incomplete');
  for(const key of ['envelope','manifest','payloads','locations','sample','root'])assert.equal(Object.hasOwn(partial,key),false,key);
  const retry=run();assert.equal(retry.status,'complete/different','aborted basis was dropped');assert.equal(root(retry),root(before));
});
test('B3 capture cutoff never redates or renews a partial proof',t=>{
  const {db,run}=setup(t);memory(db);let tick=0;
  const exhausted=run({now:()=>tick++,cutoff:8});assert.equal(exhausted.status,'incomplete');
  assert.equal(Object.hasOwn(exhausted,'envelope'),false);
  const fresh=runner(db,db.prepare('SELECT store_id FROM store_metadata').get().store_id,{sample:()=> '41'})();
  assert.equal(fresh.status,'complete/different');assert.equal(JSON.parse(fresh.envelope).sample,'41');
});

test('B3 lost capture delivery is incomplete and cannot authenticate an equality basis',t=>{
  const {f,db}=setup(t);memory(db);
  const run=runner(db,f.storeId,{read:work=>{readTransaction(db,work);throw Error('synthetic lost delivery');}});
  const lost=run();assert.equal(lost.status,'incomplete');assert.equal(Object.hasOwn(lost,'envelope'),false);
  assert.equal(db.isTransaction,false);
  assert.equal(runner(db,f.storeId)().status,'complete/different');
});

test('B3 preflight does not materialize oversized ids, references, bodies or encodings',t=>{
  const {db,run}=setup(t);memory(db,'x'.repeat(20000),'x'.repeat(20000));
  const value=run({limits:{bytes:4096}});assert.equal(value.status,'incomplete');
  assert.ok(value.bytes<=4096);assert.equal(Object.hasOwn(value,'payloads'),false);
  if(implementation.comparisonReader){
    const account=implementation.comparisonAccount({now:()=>0,cutoff:1,limits:{bytes:128}});
    readTransaction(db,()=>assert.throws(()=>implementation.comparisonReader(db,account).prepare('SELECT content AS reference FROM memories').get(),/comparison_incomplete/));
  }
});

for(const column of ['id','reference','dependency','body','sealed'])test(`B3 preflight ${column} refuses before materialization`,t=>{
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  db.exec('CREATE TABLE records(id TEXT,reference TEXT,dependency TEXT,body TEXT,sealed BLOB)');
  db.prepare('INSERT INTO records VALUES(?,?,?,?,?)').run(...Array(4).fill('x'.repeat(4096)),Buffer.alloc(4096));
  const boundedReader=implementation.comparisonReader??(native=>native);
  const makeAccount=implementation.comparisonAccount??(()=>({bytes:0}));
  let materialized=0;
  const proxy=new Proxy(db,{get(target,key){if(key!=='prepare'){const v=Reflect.get(target,key,target);return typeof v==='function'?v.bind(target):v;}
    return sql=>{const statement=target.prepare(sql);return new Proxy(statement,{get(s,k){const v=Reflect.get(s,k,s);if(typeof v!=='function')return v;
      return (...args)=>{if(k==='iterate'&&sql.startsWith('SELECT q.*,'))materialized++;return Reflect.apply(v,s,args);};}});};}});
  readTransaction(db,()=>{
    const account=makeAccount({now:()=>0,cutoff:10000,limits:{bytes:1024}});
    assert.throws(()=>boundedReader(proxy,account).prepare(`SELECT ${column} FROM records`).get(),/comparison_incomplete/);
    assert.equal(materialized,0,column);assert.ok(account.bytes<=1024);
  });
});

test('B3 exhausted row allowance stops before stepping even a fixed-width preflight result',t=>{
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec("CREATE TABLE records(id TEXT);INSERT INTO records VALUES('small')");
  let steps=0;
  const proxy=new Proxy(db,{get(target,key){if(key!=='prepare'){const v=Reflect.get(target,key,target);return typeof v==='function'?v.bind(target):v;}
    return sql=>{const statement=target.prepare(sql);return new Proxy(statement,{get(s,k){const v=Reflect.get(s,k,s);if(typeof v!=='function')return v;
      return (...args)=>{const value=Reflect.apply(v,s,args);if(k!=='iterate')return value;
        return new Proxy(value,{get(it,name){const method=Reflect.get(it,name,it);return typeof method==='function'?(...a)=>{if(name==='next')steps++;return Reflect.apply(method,it,a);}:method;}});
      };}});};}});
  const account=implementation.comparisonAccount?.({now:()=>0,cutoff:10000,limits:{rows:0}})??{};
  const boundedReader=implementation.comparisonReader??(native=>native);
  readTransaction(db,()=>assert.throws(()=>boundedReader(proxy,account).prepare('SELECT id FROM records').get(),/comparison_incomplete/));
  assert.equal(steps,0);
});

for(const [kind,sample]of [['nodes',()=>Array(8192).fill(0)],['bytes',()=> 'x'.repeat(262144)]])
test(`B3 actual envelope ${kind} limit is independent of aggregate traffic`,t=>{
  const {db,run}=setup(t);memory(db);
  const value=run({sample});assert.equal(value.status,'incomplete');
  assert.equal(Object.hasOwn(value,'envelope'),false);assert.equal(db.isOpen,true);
});

test('B3 plain string chunks preserve astral text and fit serialized frame bounds',t=>{
  const {db,run}=setup(t),text='orchard '+ '😀'.repeat(20000);memory(db,'chunk-memory',text);
  const value=run();assert.equal(value.status,'complete/different');assert.equal(value.payloads.join(''),text);
  assert.ok(value.payloads.length>1);for(const chunk of [...value.payloads,...value.manifest,...value.locations]){
    assert.equal(typeof chunk,'string');assert.equal(chunk.isWellFormed(),true);assert.ok(Buffer.byteLength(canonicalJson(chunk))<=262144);
  }
  const envelope=JSON.parse(value.envelope);assert.equal(envelope.usage.bytes,value.bytes);
  assert.ok(value.payloads.length+value.manifest.length+value.locations.length+envelope.descriptors.length<=1024);
});

test('B3 payload packing keeps a complete input map outside the bounded envelope',t=>{
  const {db,run}=setup(t);for(let i=0;i<500;i++)memory(db,'packed-'+String(i).padStart(4,'0'),'packed orchard '+i);
  const value=run();assert.equal(value.status,'complete/different');const observed=items(value);
  const locations=value.locations.flatMap(chunk=>chunk.trimEnd().split('\n').map(JSON.parse));
  assert.equal(observed.length,500);assert.equal(locations.length,500);assert.ok(value.payloads.length<500);
  for(const location of locations){
    const text=location.spans.map(span=>value.payloads[span.chunk].slice(span.start,span.end)).join('');
    assert.equal(hash(text),observed[location.item].content);assert.equal(Buffer.byteLength(text),location.bytes);
  }
  const envelope=JSON.parse(value.envelope);assert.equal(envelope.locationRecords,500);
  assert.ok(envelope.descriptors.length<500);assert.ok(Buffer.byteLength(value.envelope)<=262144);
});

test('B3 Raw fence cursor overrides NOCASE session columns and includes Z and z',t=>{
  const {db,run}=setup(t,33);
  db.exec(`DROP TABLE raw_session_fences;CREATE TABLE raw_session_fences(owner_id TEXT,scope TEXT,project_id TEXT,
    client TEXT,session_key TEXT COLLATE NOCASE,PRIMARY KEY(owner_id,scope,project_id,client,session_key COLLATE BINARY))`);
  for(const key of ['Z','z'])db.prepare('INSERT INTO raw_session_fences VALUES(?,?,?,?,?)').run(ns.ownerId,ns.scope,ns.projectId,'codex',key);
  const before=run({pageSize:1});assert.equal(before.status,'complete/different');
  assert.equal(frames(before).find(r=>r.fence==='raw_session_fences').count,2);
  db.prepare('DELETE FROM raw_session_fences WHERE session_key COLLATE BINARY=?').run('z');
  const after=run();assert.equal(after.status,'complete/different');assert.notEqual(root(before),root(after));
});

test('B3 NUL Raw session keys stay distinct or make capture incomplete',t=>{
  const {db,run}=setup(t,33);
  for(const key of ['session\0old','session\0new'])db.prepare('INSERT INTO raw_session_fences VALUES(?,?,?,?,?)').run(ns.ownerId,ns.scope,ns.projectId,'codex',key);
  const value=run();
  if(value.status==='incomplete'){assert.equal(value.cause,'encoding');return;}
  assert.equal(value.status,'complete/different');assert.equal(frames(value).find(r=>r.fence==='raw_session_fences').count,2);
  db.prepare('DELETE FROM raw_session_fences WHERE session_key COLLATE BINARY=?').run('session\0new');
  const after=run();assert.equal(after.status,'complete/different');assert.notEqual(root(value),root(after));
});

test('B3 Raw conversation, exclusion-clock and exclusion-tuple fences change independently',t=>{
  const {db,run}=setup(t,33);memory(db);
  db.prepare("INSERT INTO raw_conversations VALUES('raw-a',?,?,?,'codex','raw-a',1,'time','time')").run(ns.ownerId,ns.scope,ns.projectId);
  const mutations=[()=>db.exec("UPDATE raw_conversations SET revision=revision+1"),
    ()=>db.prepare('INSERT INTO raw_exclusion_clocks VALUES(?,?,?,1)').run(ns.ownerId,ns.scope,ns.projectId),
    ()=>db.exec("INSERT INTO raw_source_exclusions VALUES('raw-a','message',0,4,1)")];
  let before=run();for(const mutate of mutations){mutate();const after=run();assert.equal(after.status,'complete/different');assert.notEqual(root(before),root(after));assert.deepEqual(items(before),items(after));before=after;}
});

test('B3 legacy migration null-to-epoch forces recapture and a changed root',async t=>{
  const f=safetyFixture(t,18);let db=f.connect();memory(db);const capture=createComparator();
  const call=base=>capture({db,read:work=>readTransaction(db,work),selection,identity:{storeId:f.storeId},access:'a',now:()=>0,cutoff:10000,budget:{maxItems:1},loadBase:()=>base});
  const legacy=call(null);db.close();await f.migrate();db=f.connect();t.after(()=>db.close());
  const migrated=call(legacy);assert.equal(migrated.status,'complete/different');assert.notEqual(root(legacy),root(migrated));
  assert.equal(frames(migrated).find(r=>r.fence==='suppression').epoch,'0:0');
});

test('B3 failed safety layout attestation is incomplete, never legacy success',t=>{
  const {db,run}=setup(t);db.exec('CREATE TABLE content_suppressions(spoof TEXT)');
  const result=run();assert.equal(result.status,'incomplete');assert.equal(Object.hasOwn(result,'envelope'),false);
});

test('B3 missing digest or interrupted suppression observation is incomplete; charged reader forwards transaction state',async t=>{
  const f=safetyFixture(t);await f.migrate();const db=f.connect();t.after(()=>db.close());memory(db);
  const run=runner(db,f.storeId);
  for(const result of [{complete:true,suppressed:false,matchedCount:0,matchedEpoch:null,factId:null,reason:null},
    {complete:false,cause:'budget'},{complete:false,cause:'unavailable'}]){
    const value=run({observeMemory(native,namespace,ref,{reader,memo}){
      assert.equal(native,db);assert.equal(reader.isTransaction,true);assert.ok(memo.db);return result;
    }});
    assert.equal(value.status,'incomplete');assert.equal(Object.hasOwn(value,'envelope'),false);
  }
});

test('B3 Raw per-source observation allowance stays inside the aggregate account',async t=>{
  const f=safetyFixture(t,33);await f.migrate();const db=f.connect();t.after(()=>db.close());const id=memory(db);
  transaction(db,()=>{for(let i=0;i<200;i++)writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:id,reason:'purge',actionId:'fact-'+i});});
  const value=runner(db,f.storeId)();assert.equal(value.status,'incomplete');assert.ok(value.bytes<33554432);
});

test('B3 receipt-only suppression is not an indexed Memory observation; cleanup diagnostics do not affect equality',async t=>{
  const f=safetyFixture(t);await f.migrate();const db=f.connect();t.after(()=>db.close());const id=memory(db);
  const run=runner(db,f.storeId),before=run();
  const fact=transaction(db,()=>writeContentSuppressionInside(db,{namespace:ns,kind:'receipt',key:'receipt-only',reason:'purge',actionId:'receipt-action'}));
  const after=run();assert.equal(after.status,'complete/different');assert.deepEqual(items(after),items(before));
  transaction(db,()=>db.prepare("UPDATE content_suppressions SET cleanup_status='failed',cleanup_attempt=cleanup_attempt+1 WHERE fact_id=?").run(fact.factId));
  assert.equal(run().status,'complete/equal');assert.equal(items(after)[0].eligible,true);assert.equal(items(after)[0].id,id);
});

test('B3 suppression equality uses exact matched set through mutable Raw ancestry',async t=>{
  const f=safetyFixture(t,33);await f.migrate();const db=f.connect();t.after(()=>db.close());
  const id=memory(db);db.prepare("INSERT INTO receipts VALUES('receipt-a',?,'key','synthetic','session','event','user','receipt sentinel','time')").run(id);
  for(const key of ['raw-a','raw-b'])db.prepare("INSERT INTO raw_conversations VALUES(?,?,?,?,'codex',?,1,'time','time')")
    .run(key,ns.ownerId,ns.scope,ns.projectId,key);
  db.exec("INSERT INTO raw_receipt_lineage VALUES('receipt-a','raw-a','message',1,5,'exact')");
  transaction(db,()=>{
    const write=patch=>writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:id,reason:'purge',actionId:randomUUID(),...patch});
    write({});write({kind:'raw',key:'raw-a',matchMode:'span',messageId:'message',start:0,end:4});
    write({kind:'raw',key:'raw-b',matchMode:'span',messageId:'message',start:0,end:4});write({});
  });
  const observe=()=>readTransaction(db,()=>memorySuppressionObservationInside(db,ns,{memoryId:id,revision:1}));
  const run=runner(db,f.storeId),before=run(),stamp=observe();
  db.exec("UPDATE raw_receipt_lineage SET conversation_id='raw-b'");
  const after=run(),changed=observe();assert.equal(after.status,'complete/different');
  assert.equal(stamp.matchedCount,changed.matchedCount);assert.equal(stamp.matchedEpoch,changed.matchedEpoch);
  assert.notEqual(stamp.matchedSetDigest,changed.matchedSetDigest);assert.notEqual(root(before),root(after));
  db.exec('UPDATE raw_receipt_lineage SET start=2');
  assert.equal(run().status,'complete/equal','ancestry with the same matched set and unchanged other inputs');
});

test('B3 Card selections are preparation-only; Memory projection identity is unchanged',t=>{
  const {db,run}=setup(t,23);
  const result=run({selection:{...selection,types:['memory','card']}});assert.equal(result.status,'incomplete');
  assert.equal(result.cause,'card_preparation');assert.ok(result.selection.contentSafetyPolicy);
  assert.equal(projectionDigest(selection),hash(canonicalJson({profile:PRODUCT_PROFILE,readSet:selection.readSet,types:['memory'],intent:'current'})));
});

test('B3 gate default is disabled; enabled ready/no-op refreshes compare and status is scan-free',t=>{
  const f=fixture(t);f.admit('gate orchard');const facade=openContextProductFacade(f.path,{});
  let samples=0;const p={...selection,ownerCoverage:coverage},access=accessDigest({ownerId:ns.ownerId,namespaces:{readSet:[ns]}});
  const storage=productSidecar({path:f.path,db:facade.port.db,identity:facade.port.identity,features:facade.port.features,writable:true,
    memoryComparison:implementation,comparisonOptions:{sample(){samples++;return '51';}}});
  t.after(()=>{storage.close();facade.close();});
  storage.refresh(p,access,{maxItems:1024,maxMs:5000});
  const ready=storage.refresh(p,access,{maxItems:1024,maxMs:5000});assert.equal(ready.comparison?.status,'complete/different');
  const noop=storage.refresh(p,access,{maxItems:1024,maxMs:5000});assert.equal(noop.comparison?.status,'complete/equal');
  assert.equal(noop.comparisonAttempts,1);assert.ok(samples>=3);
  const before=samples;readTransaction(facade.port.db,()=>storage.observe(p,access));assert.equal(samples,before);
});

test('B3 provider refresh comparison does not create or publish a missing sidecar',t=>{
  const f=fixture(t);f.admit('provider orchard');const facade=openContextProductFacade(f.path,{});
  const storage=productSidecar({path:f.path,db:facade.port.db,identity:facade.port.identity,features:facade.port.features,writable:true,memoryComparison:implementation});
  t.after(()=>{storage.close();facade.close();});
  const result=storage.compare?.({...selection,ownerCoverage:coverage},'synthetic-access',{maxItems:1,maxMs:5000})??{comparison:{status:'not_implemented'}};
  assert.equal(result.comparison?.status,'complete/different');assert.equal(existsSync(f.path+PRODUCT_SIDECAR_SUFFIX),false);
});

test('B3 provider comparison inherits the existing quantum cutoff and reserve',t=>{
  const f=fixture(t);f.admit('inherited cutoff orchard');const facade=openContextProductFacade(f.path,{});
  let samples=0;
  const storage=productSidecar({path:f.path,db:facade.port.db,identity:facade.port.identity,features:facade.port.features,
    writable:true,now:()=>0,memoryComparison:implementation,comparisonOptions:{sample(){samples++;return '1';}}});
  t.after(()=>{storage.close();facade.close();});
  const quantum={cutoff:50,reserve:50,measure:work=>work()};
  const result=storage.compare?.({...selection,ownerCoverage:coverage},'synthetic-access',{maxItems:1,maxMs:5000},quantum);
  assert.equal(result?.comparison?.status,'incomplete');assert.equal(result.comparison.cause,'time');
  assert.equal(samples,0,'expired inherited reserve prevents capture acquisition');
});

test('B3 tampered sidecar seal is incomplete, never an absent authenticated base',t=>{
  const f=fixture(t);f.admit('seal orchard');const facade=openContextProductFacade(f.path,{});
  const storage=productSidecar({path:f.path,db:facade.port.db,identity:facade.port.identity,features:facade.port.features,writable:true,memoryComparison:implementation});
  t.after(()=>{storage.close();facade.close();});
  const p={...selection,ownerCoverage:coverage},access=accessDigest({ownerId:ns.ownerId,namespaces:{readSet:[ns]}}),budget={maxItems:1024,maxMs:5000};
  storage.refresh(p,access,budget);
  const native=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX);
  try{native.exec("UPDATE validation_records SET record=json_set(record,'$.mac','forged')");}finally{native.close();}
  const result=(storage.compare?.(p,access,budget)??{comparison:{status:'not_implemented'}}).comparison;
  assert.equal(result.status,'incomplete');assert.equal(Object.hasOwn(result,'envelope'),false);
});

test('B3 an unsigned checkpoint mutation cannot authenticate a work-map seal',t=>{
  const f=fixture(t);for(let i=0;i<3;i++)f.admit('checkpoint orchard '+i);
  const facade=openContextProductFacade(f.path,{}),storage=productSidecar({path:f.path,db:facade.port.db,identity:facade.port.identity,
    features:facade.port.features,writable:true,memoryComparison:implementation});
  t.after(()=>{storage.close();facade.close();});
  const p={...selection,ownerCoverage:coverage},access=accessDigest({ownerId:ns.ownerId,namespaces:{readSet:[ns]}}),budget={maxItems:1,maxMs:5000};
  storage.refresh(p,access,budget);
  const native=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX);
  try{native.exec('UPDATE generations SET checkpoint=checkpoint+1 WHERE published=0');}finally{native.close();}
  const value=(storage.compare?.(p,access,budget)??{comparison:{status:'not_implemented'}}).comparison;
  assert.equal(value.status,'incomplete');assert.equal(Object.hasOwn(value,'envelope'),false);
});

test('B3 passing control: default qualification and public exports stay inactive',async()=>{
  assert.equal(memoryComparisonQualified(),false);
  const api=await import('../index.mjs');assert.equal(Object.hasOwn(api,'createMemoryComparator'),false);
});

test('B3 passing control: gate-off refresh does no comparison work',t=>{
  const f=fixture(t);f.admit('gate off orchard');const facade=openContextProductFacade(f.path,{});
  const storage=productSidecar({path:f.path,db:facade.port.db,identity:facade.port.identity,features:facade.port.features,writable:true,
    comparisonOptions:{sample(){assert.fail('disabled comparison sampled a clock');}}});
  t.after(()=>{storage.close();facade.close();});
  const result=storage.refresh({...selection,ownerCoverage:coverage},accessDigest({ownerId:ns.ownerId,namespaces:{readSet:[ns]}}),{maxItems:1024,maxMs:5000});
  assert.equal(result.comparison,undefined);assert.equal(result.comparisonAttempts,undefined);
});

test('B3 passing control: opaque Buffer output discards a read connection',t=>{
  const db=new DatabaseSync(':memory:');t.after(()=>{if(db.isOpen)db.close();});
  assert.throws(()=>readTransaction(db,()=>({chunks:[Buffer.from('synthetic')]})),{code:'storage_error'});
  assert.equal(db.isOpen,false);
});

test('B3 Worker transport is private, bounded, and does not change serving results',async t=>{
  const f=fixture(t);f.admit('Worker orchard');const supervisor=createContextReadSupervisor();t.after(()=>supervisor.close());
  const token={opaque:randomUUID()},binding={kind:'service',serviceId:randomUUID(),credentialBindingId:randomUUID(),credentialExpiresUtcMs:null,
    credentialDigest:credentialDigest(token),ownerId:ns.ownerId,namespaces:{readSet:[ns],ownerCoverage:coverage},issuedAt:0};
  const state=new SharedArrayBuffer(32);new Int32Array(state)[0]=1;
  const options={supervisor,path:f.path,version:'context-read-v1',profile:PRODUCT_PROFILE,readSet:[ns],ownerCoverage:coverage,
    sidecarJournalMode:'DELETE',host:{moduleUrl:new URL('../testing/context-product-index-host.mjs',import.meta.url).href,configuration:{serviceBinding:binding,state}}};
  const open=createProductReaderRuntime({maintenance:true,comparisonQualified:()=>true}),handle=await open(options);t.after(()=>handle.close());
  const payload={...selection,mode:'lexical',budget:{maxItems:1024,maxMs:5000}};
  let result;for(let i=0;i<3;i++)result=await handle.refreshContextIndex(payload,token);
  assert.equal(ok(result).status,'complete');assert.equal(maintenanceComparison(result)?.status,'complete/equal');
  assert.ok(Object.isFrozen(maintenanceComparison(result)));assert.ok(Object.isFrozen(maintenanceComparison(result).payloads));
  assert.equal(Object.hasOwn(result.value,'comparison'),false);assert.equal(maintenancePhaseDiagnostic(result).comparisonAttempts,1);
  assert.ok(maintenanceWorkFields.includes('comparisonRows'));
  const noop=await handle.refreshContextIndex({...payload,mode:'embeddings'},token);
  assert.equal(ok(noop).status,'partial');assert.equal(maintenanceComparison(noop)?.status,'complete/equal');
  assert.equal(maintenanceComparison(await handle.getContextIndexStatus({...selection,deadlineMs:5000},token)),undefined);
});

// Review regressions: content identity, physical bindings and bounded preflight.
for(const [label,sql]of [
  ['awaiting body',"UPDATE memories SET content='changed awaiting body'"],
  ['eligible fingerprint',"UPDATE memories SET fingerprint='changed fingerprint'"]
])test(`B3 F1 ${label} without a revision bump changes identity`,t=>{
  const {db,run}=setup(t);memory(db);
  if(label==='awaiting body')db.exec("UPDATE memories SET review_state='awaiting'");
  const before=run();assert.equal(before.status,'complete/different');assert.equal(run().status,'complete/equal');
  db.exec(sql);const after=run();assert.equal(after.status,'complete/different');
  assert.notEqual(root(before),root(after));assert.notEqual(items(before)[0].contentIdentity,items(after)[0].contentIdentity);
  if(label==='awaiting body'){assert.deepEqual(after.payloads,[]);assert.deepEqual(after.locations,[]);}
});

function comparisonStore(t){
  const f=fixture(t);f.admit('binding orchard');const facade=openContextProductFacade(f.path,{});
  const storage=productSidecar({path:f.path,db:facade.port.db,identity:facade.port.identity,features:facade.port.features,
    writable:true,memoryComparison:implementation});
  t.after(()=>{storage.close();facade.close();});
  const p={...selection,ownerCoverage:coverage},access=accessDigest({ownerId:ns.ownerId,namespaces:{readSet:[ns]}}),budget={maxItems:1024,maxMs:5000};
  for(let i=0;i<3;i++)storage.refresh(p,access,budget);
  const compare=()=>storage.compare(p,access,budget).comparison;
  assert.equal(compare().status,'complete/equal');assert.equal(compare().status,'complete/equal');
  return {f,facade,storage,p,access,budget,compare};
}
for(const mutation of ['incarnation','store_id','canonical identity','representation'])test(`B3 F2 current ${mutation} mismatch rejects the basis`,t=>{
  const c=comparisonStore(t),path=mutation==='canonical identity'?c.f.path:c.f.path+PRODUCT_SIDECAR_SUFFIX;
  const db=new DatabaseSync(path);let original;
  try{
    if(['incarnation','store_id'].includes(mutation)){
      original=db.prepare(`SELECT ${mutation} AS value FROM product_metadata`).get().value;
      db.prepare(`UPDATE product_metadata SET ${mutation}=?`).run(randomUUID());
    }else if(mutation==='canonical identity')db.exec('CREATE INDEX comparison_identity_probe ON memories(confidence)');
    else {
      const row=db.prepare('SELECT publication,record FROM validation_records').get();original=row;
      const value=JSON.parse(row.record);delete value.mac;value.representation='different-representation';
      db.prepare('UPDATE validation_records SET record=? WHERE publication=?').run(signedRecord(c.facade.port.identity.cursorSecret,'validation',value),row.publication);
    }
    assert.equal(c.compare().status,'incomplete');
    if(['incarnation','store_id'].includes(mutation)){
      db.prepare(`UPDATE product_metadata SET ${mutation}=?`).run(original);
      assert.equal(c.compare().status,'complete/different','failed binding cleared the volatile basis');
    }
  }finally{db.close();}
});

test('B3 passing control: F2 fence retarget remains a complete comparison',t=>{
  const c=comparisonStore(t),db=new DatabaseSync(c.f.path);t.after(()=>db.close());
  db.exec('UPDATE namespace_epochs SET epoch=epoch+1');
  assert.equal(c.compare().status,'complete/different');assert.equal(c.compare().status,'complete/equal');
  const result=c.storage.refresh(c.p,c.access,c.budget);assert.notEqual(result.comparison.status,'incomplete');
});

test('B3 F3 string sizing observes cutoff during the scan',()=>{
  let tick=0,characters=0;const original=Buffer.byteLength;
  const account=implementation.comparisonAccount({now:()=>tick,cutoff:1000});
  try{
    Buffer.byteLength=function(value,...args){if(value==='x'){characters++;tick++;}return Reflect.apply(original,Buffer,[value,...args]);};
    assert.throws(()=>implementation.comparisonJson('x'.repeat(10000),account),/comparison_incomplete/);
  }finally{Buffer.byteLength=original;}
  assert.ok(characters<=1100,'sizing stopped near its cutoff');
});

test('B3 F3 string sizing stops at the remaining frame allowance',()=>{
  let characters=0;const original=Buffer.byteLength;
  const account=implementation.comparisonAccount({now:()=>0,cutoff:10000,limits:{frame:128}});
  try{
    Buffer.byteLength=function(value,...args){if(value==='x')characters++;return Reflect.apply(original,Buffer,[value,...args]);};
    assert.throws(()=>implementation.comparisonJson('x'.repeat(10000),account),/comparison_incomplete/);
  }finally{Buffer.byteLength=original;}
  assert.ok(characters<=128,'sizing rejected before scanning the remainder');
});

test('B3 F4 safety revision binds the root independently of projection identity',t=>{
  const {db,run}=setup(t);memory(db);const a=run(),projection=projectionDigest(selection);
  const b=run({safetyPolicyRevision:CONTENT_SAFETY_POLICY_REVISION+'-changed'});
  assert.equal(b.status,'complete/different');assert.notEqual(root(a),root(b));
  assert.equal(JSON.parse(a.envelope).binding.projection,projection);assert.equal(JSON.parse(b.envelope).binding.projection,projection);
});

function reencodeInside(source,to,encoding){
  const quote=name=>'"'+name.replaceAll('"','""')+'"';
  to.exec(`PRAGMA encoding='${encoding}'; PRAGMA foreign_keys=OFF; BEGIN`);
  const schema=source.prepare("SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type='table' DESC,name").all();
  for(const row of schema.filter(r=>r.type==='table'))to.exec(row.sql);
  for(const row of schema.filter(r=>r.type==='table')){
    const fields=source.prepare('PRAGMA table_info('+quote(row.name)+')').all().map(r=>r.name);
    const insert=to.prepare('INSERT INTO '+quote(row.name)+'('+fields.map(quote).join(',')+') VALUES('+fields.map(()=>'?').join(',')+')');
    for(const data of source.prepare('SELECT * FROM '+quote(row.name)).all())insert.run(...fields.map(k=>data[k]));
  }
  for(const row of schema.filter(r=>r.type!=='table'))to.exec(row.sql);
  for(const name of ['application_id','user_version'])to.exec('PRAGMA '+name+'='+source.prepare('PRAGMA '+name).get()[name]);
  to.exec('COMMIT');
}
for(const target of ['canonical','sidecar'])test(`B3 F5 rejects ${target} UTF-16 before variable-length materialization`,t=>{
  const {db:source,f}=setup(t);memory(source,'unicode','ࠀ'.repeat(10000));
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());reencodeInside(source,db,'UTF-16le');
  let materialized=0;
  const proxy=new Proxy(db,{get(native,key){if(key!=='prepare'){const v=Reflect.get(native,key,native);return typeof v==='function'?v.bind(native):v;}
    return sql=>{const statement=native.prepare(sql);return new Proxy(statement,{get(s,k){const method=Reflect.get(s,k,s);return typeof method==='function'?(...args)=>{if(k==='iterate'&&sql.startsWith('SELECT q.*,'))materialized++;return Reflect.apply(method,s,args);}:method;}});};}});
  let value;
  if(target==='canonical')value=createComparator()({db:proxy,read:work=>readTransaction(db,work),selection,identity:{storeId:f.storeId},access:'access',now:()=>0,cutoff:10000,
    loadBase(){source.prepare('SELECT content FROM memories').get();materialized++;return null;}});
  else {
    const account=implementation.comparisonAccount({now:()=>0,cutoff:10000,limits:{bytes:61000}});
    readTransaction(db,()=>assert.throws(()=>implementation.comparisonReader(proxy,account).prepare('SELECT content FROM memories').get(),/comparison_incomplete/));
    value={status:'incomplete'};
  }
  assert.equal(value.status,'incomplete');assert.equal(materialized,0,'unsupported encoding fetched no variable fields');
});

test('B3 F6 transitive import errors are not comparator absence',async t=>{
  const f=safetyFixture(t),path=join(f.workspace.path,'comparison-import.mjs');
  writeFileSync(path,"import './missing-comparison-dependency.mjs'; export const value=1;\n");
  await assert.rejects(()=>loadComparison(pathToFileURL(path)),{code:'ERR_MODULE_NOT_FOUND'});
});
