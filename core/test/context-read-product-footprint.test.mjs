import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fixture } from '../testing/context-read-fixture.mjs';
import { four, descriptor } from '../testing/context-product-owner-fixture.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { openProductIndex } from '../context-product-index.mjs';
import { productSidecar, PRODUCT_SIDECAR_SUFFIX } from '../context-product-sidecar.mjs';
import { accessDigest, verifiedRecord, canonicalJson, signedRecord } from '../context-product-validation.mjs';
import { maintenanceQuantum } from '../context-product-quantum.mjs';

function local(t,f,options={}) {
  const facade=openContextProductFacade(f.path,{}), readSet=four;
  const storage=productSidecar({path:f.path,db:facade.port.db,identity:facade.port.identity,features:facade.port.features,writable:true,...options});
  t.after(()=>{storage.close();facade.close();});
  return {storage,facade,p:{readSet,types:['memory'],intent:'current',ownerCoverage:descriptor(readSet)},
    access:accessDigest({ownerId:four[0].ownerId,namespaces:{readSet}})};
}
const budget={maxItems:1024,maxMs:5000};
function build(a,p=a.p) {
  for(let i=0;i<1000;i++) {
    a.storage.refresh(p,a.access,budget);
    const observed=a.storage.observe(p,a.access);
    if(observed.dto.lexical.state==='ready')return observed.publication;
  }
  assert.fail('build must finish');
}

test('format 3 uses integer postings, reconstructs identical current/history manifests and binds certificates',t=>{
  const f=fixture(t),documents=[];
  for(let i=0;i<12;i++) {
    const ns=four[i%4],m=f.admit('東京 索引 orchard '+i,ns);
    documents.push({identity:[ns.ownerId,ns.scope,ns.projectId??'','memory',m.id],revision:m.revision,terms:['東京','索引','orchard',String(i)]});
  }
  const a=local(t,f),current=build(a),history=build(a,{...a.p,intent:'history'});
  assert.equal(current.manifestDigest,history.manifestDigest);
  // Independent logical oracle: hand-known tokens, original typed identities
  // and the frozen tuple stream, without the compact SQL or ManifestHash.
  const bytes=(a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)),tuples=[],df=new Map();
  documents.sort((a,b)=>bytes(JSON.stringify(a.identity),JSON.stringify(b.identity)));
  for(const d of documents)tuples.push(['document',d.identity,d.revision,0,1,'candidate-text-v1',4]);
  for(const d of documents)for(const term of [...d.terms].sort(bytes)) {
    tuples.push(['posting',d.identity,term,1]);df.set(term,(df.get(term)??0)+1);
  }
  tuples.push(['statistics','',0,12,48]);
  for(const term of [...df.keys()].sort(bytes))tuples.push(['statistics',term,df.get(term),0,0]);
  assert.equal(current.manifestDigest,createHash('sha256').update(tuples.map(t=>JSON.stringify(t)+'\n').join('')).digest('base64url'));
  assert.equal(current.format,3);
  const side=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX);t.after(()=>side.close());
  assert.equal(side.prepare('PRAGMA user_version').get().user_version,3);
  assert.equal(side.prepare('PRAGMA auto_vacuum').get().auto_vacuum,2);
  assert.deepEqual(side.prepare('PRAGMA table_info(postings)').all().map(r=>[r.name,r.type]),
    [['generation','INTEGER'],['doc','INTEGER'],['term','INTEGER'],['frequency','INTEGER'],['position','INTEGER']]);
  assert.match(side.prepare("SELECT sql FROM sqlite_schema WHERE name='postings'").get().sql,/WITHOUT ROWID/);
  assert.deepEqual(side.prepare('PRAGMA foreign_key_check').all(),[]);
  const {mac,...body}=current;
  const old=signedRecord(a.facade.port.identity.cursorSecret,'validation',{...body,format:1});
  assert.throws(()=>verifiedRecord(a.facade.port.identity.cursorSecret,'validation',old),{reason:'validation_invalid'});
  assert.equal(verifiedRecord(a.facade.port.identity.cursorSecret,'validation',canonicalJson(current)).format,3);
  const changed=signedRecord(a.facade.port.identity.cursorSecret,'validation',{...body,representation:'unexpected'});
  side.prepare('UPDATE validation_records SET record=? WHERE publication=?').run(changed,current.publicationId);
  assert.equal(a.storage.observe(a.p,a.access).dto.lexical.reason,'validation_invalid');
  side.prepare('UPDATE validation_records SET record=? WHERE publication=?').run(canonicalJson(current),current.publicationId);
});

test('quantum admission keeps the conservative observed high-water item estimate',()=>{
  let clock=600;
  const q=maintenanceQuantum({now:()=>clock,cutoff:1000,maxMs:1000});
  assert.equal(q.admit(),true);
  q.measure(()=>{clock+=70;});assert.equal(q.admit(),true);
  q.measure(()=>{clock+=1;});assert.equal(q.admit(),true);
  clock=720;assert.equal(q.admit(),false); // 280 remaining: 150 reserve + 140 retained estimate.
  q.measure(()=>{clock+=80;});assert.equal(q.admit(),false);
  assert.ok(clock<1000-q.reserve);
});

test('a costly metadata batch cannot prevent admission of a cheap first item',()=>{
  let clock=600;
  const q=maintenanceQuantum({now:()=>clock,cutoff:1000,maxMs:1000});
  q.measure(()=>{clock+=100;},'scan');
  assert.equal(q.admit('scan'),false);
  assert.equal(q.admit('item'),true);
  q.measure(()=>{clock+=70;});assert.equal(q.admit('item'),false);
  assert.ok(clock<1000-q.reserve);
});

test('format 1 refuses both observation and refresh without replacement; explicit cache discard permits rebuild',t=>{
  const f=fixture(t);f.admit('old cache',four[0]);let a=local(t,f);build(a);a.storage.close();a.facade.close();
  const side=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX);
  side.exec('PRAGMA user_version=1');const before=side.prepare('SELECT record FROM validation_records').get().record;side.close();
  a=local(t,f);
  assert.equal(a.storage.observe(a.p,a.access).dto.lexical.reason,'incompatible');
  assert.throws(()=>a.storage.refresh(a.p,a.access,budget),{reason:'incompatible'});
  const inspect=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX,{readOnly:true});
  assert.equal(inspect.prepare('SELECT record FROM validation_records').get().record,before);inspect.close();
  // All product/cache connections are stopped and drained. The fixture writer
  // is quiescent; explicit host discard retains the lifecycle lock.
  a.storage.close();a.facade.close();unlinkSync(f.path+PRODUCT_SIDECAR_SUFFIX);
  assert.equal(build(local(t,f)).format,3);
});

test('superseded generations and old selections are collected, other intent and active delta base survive',t=>{
  const f=fixture(t);for(let i=0;i<9;i++)f.admit('gc orchard '+i,four[i%4]);
  const a=local(t,f);build(a);const history=build(a,{...a.p,intent:'history'});
  f.admit('gc delta',four[0]);a.storage.refresh(a.p,a.access,{maxItems:1,maxMs:5000});
  const side=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX,{readOnly:true});t.after(()=>side.close());
  assert.equal(side.prepare('SELECT count(*) AS n FROM generations').get().n,3);
  build(a);
  for(let i=0;i<10;i++)a.storage.refresh(a.p,a.access,budget);
  assert.equal(side.prepare('SELECT count(*) AS n FROM generations').get().n,2);
  const next={...a.p,readSet:[four[0],four[1]],ownerCoverage:descriptor([four[0],four[1]])};
  build(a,next);
  for(let i=0;i<10;i++)a.storage.refresh(next,a.access,budget);
  assert.equal(a.storage.observe(a.p,a.access).dto.lexical.state,'absent');
  assert.equal(side.prepare('SELECT count(*) AS n FROM generations').get().n,2);
  assert.ok(side.prepare('SELECT id FROM generations WHERE id=?').get(history.generation.id));
  assert.equal(side.prepare('SELECT count(*) AS n FROM validation_records').get().n,2);
  assert.deepEqual(side.prepare('PRAGMA foreign_key_check').all(),[]);
});

for(const scanCost of [100,250])test(`expensive open and ${scanCost}ms scans yield ok durable partial progress, repeated quanta finish without timeout`,t=>{
  const f=fixture(t);for(let i=0;i<9;i++)f.admit('quantum 東京 '+i,four[0]);
  let clock=0,items=0;
  const facade=openContextProductFacade(f.path,{}),ownerCoverage=descriptor(four);
  const index=openProductIndex({path:f.path,facade,ownerCoverage,maintenance:true,now:()=>clock,
    authorize:()=>({accessGenerations:accessDigest({ownerId:four[0].ownerId,namespaces:{readSet:four}}),check(){},envelope:fn=>fn()}),
    storageOptions:{rendezvous(point){if(point==='opened')clock+=600;if(point==='scan')clock+=scanCost;if(point==='item'){clock+=scanCost===250?1:70;items++;}if(point==='verify-item')clock+=10;if(point==='checkpoint')clock+=20;}}});
  t.after(()=>{index.close();facade.close();});
  const input={readSet:four,types:['memory'],intent:'current',mode:'lexical',budget:{maxItems:1024,maxMs:1000}};
  const first=index.run('refreshContextIndex',input,{},1000);
  assert.equal(first.ok,true,JSON.stringify(first));assert.equal(first.value.status,'rebuilding');
  assert.ok(items>0 && items<9);assert.ok(clock<1000);
  const checkpoint=first.value.progress.lexical.checkpoint;
  assert.ok(checkpoint>0);
  let complete=false;
  for(let i=0;i<100;i++) {
    clock=0;const r=index.run('refreshContextIndex',input,{},1000);
    assert.equal(r.ok,true,JSON.stringify(r));assert.ok(clock<1000);
    if(r.value.status==='complete'){complete=true;break;}
  }
  assert.equal(complete,true);assert.equal(items,9);
});

test('bounded GC deletion survives close/reopen and resumes from remaining durable rows',t=>{
  const f=fixture(t),words=Array.from({length:80},(_,i)=>'term'+i).join(' ');
  for(let i=0;i<8;i++)f.admit(words+' '+i,four[0]);
  let clock=0,slow=false,slices=0;
  let a=local(t,f,{now:()=>clock,rendezvous(point){if(slow && point==='gc'){clock+=4500;slices++;}}});
  const old=build(a);f.admit(words+' delta',four[0]);slow=true;build(a);
  assert.equal(slices,1);
  const inspect=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX,{readOnly:true});
  assert.ok(inspect.prepare('SELECT id FROM generations WHERE id=?').get(old.generation.id));
  inspect.close();a.storage.close();a.facade.close();
  a=local(t,f);
  for(let i=0;i<20;i++)a.storage.refresh(a.p,a.access,budget);
  const final=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX,{readOnly:true});
  try {
    assert.equal(final.prepare('SELECT count(*) AS n FROM generations').get().n,1);
    assert.equal(final.prepare('SELECT count(*) AS n FROM validation_records').get().n,1);
    assert.deepEqual(final.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally {final.close();}
});

test('a single uninterruptible item may cross cutoff; its admitted work still commits',t=>{
  const f=fixture(t);f.admit('uninterruptible',four[0]);let clock=0;
  const a=local(t,f,{now:()=>clock,rendezvous(point){if(point==='item')clock+=1200;}});
  const m=a.storage.refresh({...a.p,deadlineAt:1000},a.access,{maxItems:1024,maxMs:1000});
  assert.equal(m.transformed,1);assert.ok(clock>=1000);
  assert.ok(a.storage.observe(a.p,a.access).dto.lexical.progress.checkpoint>0);
  // The existing parent/Worker cutoff regressions discard this late envelope,
  // settle read_timeout, and preserve the independently committed checkpoint.
});

// Exercise corruption after a signed item checkpoint, while its generation is
// still staging. Each edit leaves the physical schema and signed cursor intact.
for(const firstTerms of [1,2])for(const partial of [false,true])test(`Fix round 2 rejects missing ${firstTerms} + 128 terms (${partial?'partial':'full'} posting page)`,t=>{
  const f=fixture(t),first=f.admit(firstTerms===1?'badtoken':'badtoken missingtoken',four[0]);
  f.admit(Array.from({length:128},(_,i)=>'term'+String(i).padStart(3,'0')).join(' '),four[1]);
  let clock=0;
  const a=local(t,f,{now:()=>clock,rendezvous(point){if(partial && point==='verify-item')clock+=1500;}});
  a.storage.refresh(a.p,a.access,{maxItems:2,maxMs:5000});
  const side=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX);t.after(()=>side.close());
  const documents=side.prepare('SELECT * FROM documents ORDER BY identity').all();
  assert.equal(documents.length,2);assert.equal(documents[0].id,first.id);assert.equal(documents[0].token_length,firstTerms);
  side.prepare('DELETE FROM statistics WHERE generation=? AND term_id IN (SELECT term FROM postings WHERE generation=? AND doc=?)')
    .run(documents[0].generation,documents[0].generation,documents[0].doc);
  side.prepare('DELETE FROM postings WHERE generation=? AND doc=?').run(documents[0].generation,documents[0].doc);
  assert.equal(side.prepare('SELECT count(*) AS n FROM postings').get().n,128);
  assert.deepEqual(side.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.throws(()=>build(a),{code:'index_unavailable',reason:'corrupt'});
  assert.equal(side.prepare('SELECT count(*) AS n FROM publications').get().n,0);
});

test('Fix round 2 rejects a copied posting with negative document key',t=>{
  const f=fixture(t);f.admit('badtoken',four[0]);const a=local(t,f);
  a.storage.refresh(a.p,a.access,{maxItems:1,maxMs:5000});
  const side=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX);t.after(()=>side.close());
  side.exec('PRAGMA foreign_keys=OFF; PRAGMA ignore_check_constraints=ON');
  const row=side.prepare('SELECT * FROM postings LIMIT 1').get();
  side.prepare(`INSERT INTO postings(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).run(...Object.values({...row,doc:-1}));
  assert.equal(side.prepare('SELECT count(*) AS n FROM postings').get().n,2);
  assert.equal(side.prepare('PRAGMA foreign_key_check').all().length,1);
  assert.throws(()=>build(a),{code:'index_unavailable',reason:'corrupt'});
  assert.equal(side.prepare('SELECT count(*) AS n FROM publications').get().n,0);
});

for(const doc of [-1,0])for(const term of [1,-1])test(`Fix round 3 rejects linked document/posting key ${doc} (term ${term})`,t=>{
  const f=fixture(t);f.admit('badtoken',four[0]);const a=local(t,f);
  a.storage.refresh(a.p,a.access,{maxItems:1,maxMs:5000});
  const side=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX);t.after(()=>side.close());
  // Bypass DDL to model a tampered file. Keep the admitted maintenance
  // connection open so refusal must come from deep verification, not reopen.
  side.exec('PRAGMA foreign_keys=OFF; PRAGMA ignore_check_constraints=ON; BEGIN');
  side.prepare('UPDATE documents SET doc=?').run(doc);
  side.prepare('UPDATE postings SET doc=?,term=?').run(doc,term);
  side.prepare("UPDATE statistics SET term_id=? WHERE term='badtoken'").run(term);
  side.exec('COMMIT');
  assert.deepEqual(side.prepare('PRAGMA foreign_key_check').all(),[]);
  const pair=side.prepare(`SELECT d.doc,p.doc AS posting_doc,s.term FROM documents d
    JOIN postings p ON p.generation=d.generation AND p.doc=d.doc
    JOIN statistics s ON s.generation=p.generation AND s.term_id=p.term`).all();
  assert.deepEqual(pair.map(r=>[r.doc,r.posting_doc,r.term]),[[doc,doc,'badtoken']]);
  assert.throws(()=>build(a),{code:'index_unavailable',reason:'corrupt'});
  assert.equal(side.prepare('SELECT count(*) AS n FROM publications').get().n,0);
  assert.equal(side.prepare('SELECT count(*) AS n FROM validation_records').get().n,0);
});

test('Fix round 3 attested document and posting DDL requires positive integer keys',t=>{
  const f=fixture(t);f.admit('badtoken',four[0]);const a=local(t,f);build(a);
  const side=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX);t.after(()=>side.close());
  side.exec('PRAGMA foreign_keys=OFF');
  for(const table of ['documents','postings'])for(const doc of [-1,0,0.5]) {
    assert.throws(()=>side.prepare(`UPDATE ${table} SET doc=?`).run(doc),doc<=0 ? /CHECK constraint failed/ : /cannot store REAL/);
  }
  // Reader attestation rejects the older format-2 DDL too, even with the
  // same format number and otherwise valid publication.
  side.enableDefensive?.(false);
  side.exec('PRAGMA writable_schema=ON');
  side.prepare("UPDATE sqlite_schema SET sql=replace(sql,' CHECK(doc > 0)','') WHERE name IN ('documents','postings')").run();
  side.exec('PRAGMA writable_schema=OFF');
  assert.equal(a.storage.observe(a.p,a.access).dto.lexical.reason,'incompatible');
});

for(const key of [-1,0])test(`Fix round 3 dictionary and storage key ${key} remain reachable by equality lookup`,t=>{
  const f=fixture(t);f.admit('badtoken',four[0]);const a=local(t,f);
  a.storage.refresh(a.p,a.access,{maxItems:1,maxMs:5000});
  const side=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX);t.after(()=>side.close());
  side.exec('PRAGMA foreign_keys=OFF; BEGIN');
  // Zero is normally the empty-term sentinel. Relocate it before giving
  // its key to a nonempty term; verification uses term text, not its ID.
  side.prepare("UPDATE statistics SET term_id=-2 WHERE term=''").run();
  side.prepare("UPDATE statistics SET term_id=? WHERE term='badtoken'").run(key);
  side.prepare('UPDATE postings SET term=?').run(key);
  side.prepare('UPDATE generations SET storage_id=?').run(key);
  for(const table of ['documents','postings','statistics'])side.prepare(`UPDATE ${table} SET generation=?`).run(key);
  side.exec('COMMIT');
  assert.deepEqual(side.prepare('PRAGMA foreign_key_check').all(),[]);
  const publication=build(a),result=a.storage.lexical(a.p,publication,'badtoken');
  assert.equal(publication.counts.documents,1);assert.equal(publication.counts.terms,1);
  assert.equal(result.matched,1);assert.equal(result.rows.length,1);
  a.storage.close();
  const reopened=local(t,f);
  assert.equal(reopened.storage.observe(reopened.p,reopened.access).dto.lexical.state,'ready');
  assert.deepEqual(reopened.storage.lexical(reopened.p,publication,'badtoken'),result);
});

test('Fix round 2 document, posting and statistics cursors resume partial pages with identical results',t=>{
  const f=fixture(t);
  for(let i=0;i<130;i++)f.admit(i<128?'orchard term'+String(i).padStart(3,'0'):i===128?'!!!':'???',four[i%4]);
  let clock=0,partial=false;
  const options={now:()=>clock,rendezvous(point){if(partial && point==='verify-item')clock+=100;}};
  let a=local(t,f,options);const current=build(a),expected=a.storage.lexical(a.p,current,'orchard term000');
  const side=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX,{readOnly:true});t.after(()=>side.close());
  const history={...a.p,intent:'history'},seen=new Set();let publication,reopened=false;
  partial=true;
  for(let i=0;i<1000;i++) {
    a.storage.refresh(history,a.access,{maxItems:1024,maxMs:1000});
    const g=side.prepare('SELECT verify FROM generations WHERE published=0').get();
    if(g) {
      const v=JSON.parse(g.verify);
      if(v.phase===0 && v.counts.documents>0 && v.counts.documents<130)seen.add('documents');
      if(v.phase===1 && v.documentLength>0)seen.add('mid-document');
      if(v.phase===1 && v.documentDone)seen.add('completed-document');
      if(v.phase===2 && !v.statisticsDone && v.last.length)seen.add('statistics');
      if(!reopened && seen.has('mid-document')) {
        a.storage.close();a.facade.close();a=local(t,f,options);reopened=true;
      }
    }
    publication=a.storage.observe(history,a.access).publication;
    if(publication)break;
  }
  assert.ok(publication,'partial checkpoints must finish');assert.equal(reopened,true);
  assert.deepEqual([...seen].sort(),['completed-document','documents','mid-document','statistics']);
  assert.equal(publication.manifestDigest,current.manifestDigest);assert.deepEqual(publication.counts,current.counts);
  assert.deepEqual(a.storage.lexical(history,publication,'orchard term000'),expected);
});

for(const damage of ['badtoken','orphan-document','orphan-term','seeded-counter','df','N','total-length'])test(`Fix round 1 deep verification rejects ${damage}`,t=>{
  const f=fixture(t);f.admit('badtoken orchard',four[0]);const a=local(t,f);
  a.storage.refresh(a.p,a.access,{maxItems:1,maxMs:5000});
  const side=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX);t.after(()=>side.close());
  const generation=side.prepare('SELECT storage_id FROM generations').get().storage_id;
  if(damage==='badtoken')side.prepare("DELETE FROM statistics WHERE generation=? AND term='badtoken'").run(generation);
  if(damage==='orphan-document') {
    // No document FK enforcement on this deliberately hostile editor.
    side.exec('PRAGMA foreign_keys=OFF');
    const row=side.prepare('SELECT * FROM postings LIMIT 1').get();
    side.prepare(`INSERT INTO postings(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).run(...Object.values({...row,doc:99999}));
  }
  if(damage==='orphan-term')side.prepare("INSERT INTO statistics(generation,term_id,term,df,n,total_length) VALUES(?,99999,'unposted',0,0,0)").run(generation);
  if(damage==='seeded-counter') {
    const counter=side.prepare('PRAGMA table_info(statistics)').all().some(r=>r.name==='verified_df') ? ',verified_df=verified_df+1' : '';
    side.prepare(`UPDATE statistics SET df=df+1${counter} WHERE term='badtoken'`).run();
  }
  if(damage==='df')side.prepare("UPDATE statistics SET df=df+1 WHERE term='badtoken'").run();
  if(damage==='N')side.prepare("UPDATE statistics SET n=n+1 WHERE term=''").run();
  if(damage==='total-length')side.prepare("UPDATE statistics SET total_length=total_length+1 WHERE term=''").run();
  if(damage==='badtoken')assert.deepEqual(side.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.throws(()=>build(a),{code:'index_unavailable',reason:'corrupt'});
  assert.equal(side.prepare('SELECT count(*) AS n FROM publications').get().n,0);
});

test('Fix round 1 format 1 wrong-store refusal survives maintenance without replacement',t=>{
  const f=fixture(t);f.admit('cache',four[0]);const a=local(t,f);build(a);a.storage.close();a.facade.close();
  const side=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX);t.after(()=>side.close());
  side.exec("PRAGMA user_version=1; UPDATE product_metadata SET store_id='foreign-store'");
  const before=side.prepare('SELECT * FROM product_metadata').get(),records=side.prepare('SELECT * FROM validation_records').all();
  const b=local(t,f);assert.equal(b.storage.observe(b.p,b.access).dto.lexical.reason,'wrong_store');
  assert.throws(()=>b.storage.refresh(b.p,b.access,budget),{code:'index_unavailable',reason:'wrong_store'});
  assert.deepEqual(side.prepare('SELECT * FROM product_metadata').get(),before);
  assert.deepEqual(side.prepare('SELECT * FROM validation_records').all(),records);
});

test('Fix round 1 changed canonical text between metadata and transformation rolls back the whole checkpoint',t=>{
  const f=fixture(t),memory=f.admit('revisionone',four[0]);let armed=true;
  const a=local(t,f,{rendezvous(point){if(armed && point==='scan') {
    armed=false;
    const result=f.core.correct({namespace:four[0],memoryId:memory.id,expectedRevision:1,content:'revisiontwo',kind:'fact',
      receipt:{client:'synthetic',sessionId:'checkpoint',eventId:'revision-two',role:'user',excerpt:'revisiontwo'}});
    assert.equal(result.ok,true,JSON.stringify(result));
  }}});
  assert.equal(a.storage.refresh(a.p,a.access,budget).transformed,1);
  assert.equal(a.storage.observe(a.p,a.access).dto.lexical.state,'stale');
  const side=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX,{readOnly:true});t.after(()=>side.close());
  assert.equal(side.prepare('SELECT count(*) AS n FROM documents').get().n,0);
  assert.equal(side.prepare('SELECT count(*) AS n FROM postings').get().n,0);
  const g=side.prepare('SELECT * FROM generations').get();assert.equal(g.checkpoint,0);
  const progress=verifiedRecord(a.facade.port.identity.cursorSecret,'progress',side.prepare('SELECT record FROM progress_records').get().record);
  assert.equal(progress.progress.checkpoint,0);
  assert.equal(build(a).counts.documents,1);
  assert.equal(side.prepare('SELECT revision FROM documents').get().revision,2);
});

test('Fix round 1 600ms open plus 250ms verification scan makes strictly increasing durable progress',t=>{
  const f=fixture(t);for(let i=0;i<8;i++)f.admit('verification orchard '+i,four[0]);
  let clock=0,slow=false;
  const a=local(t,f,{now:()=>clock,observer:instrumentDatabase((sql,method)=>{
    if(slow && method==='all' && /SELECT \* FROM documents.*ORDER BY identity LIMIT 128/.test(sql))clock+=250;
  }),rendezvous(point){
    if(slow && point==='opened')clock+=600;

    if(slow && point==='verify-item')clock+=1;
    // Stage the documents first, so every tested quantum starts in verification.
    if(!slow && point==='checkpoint')clock=900;
  }});
  for(let i=0;i<4;i++){clock=0;a.storage.refresh(a.p,a.access,{maxItems:1024,maxMs:1000});}
  const side=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX,{readOnly:true});t.after(()=>side.close());
  assert.equal(JSON.parse(side.prepare('SELECT verify FROM generations').get().verify).phase,0);
  slow=true;let previous=0;
  for(let i=0;i<3;i++) {
    clock=0;const m=a.storage.refresh(a.p,a.access,{maxItems:1024,maxMs:1000});
    assert.ok(m.verifiedRows>0,'a successful scanning quantum must process a row');
    const v=JSON.parse(side.prepare('SELECT verify FROM generations').get().verify);
    assert.ok(v.counts.documents>previous);previous=v.counts.documents;
    assert.ok(clock<1000);
  }
});

function instrumentDatabase(onStatement) {
  return {invoke(_stage,_kind,work){return work();},database(native){
    return new Proxy(native,{get(target,key){
      if(key==='prepare')return sql=>{
        const stmt=target.prepare(sql);
        return new Proxy(stmt,{get(statement,method){
          const value=Reflect.get(statement,method,statement);
          return typeof value==='function' ? (...args)=>{
            const result=Reflect.apply(value,statement,args);onStatement(sql,method,args,result,target);return result;
          } : value;
        }});
      };
      const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
    }});
  }};
}

test('Fix round 1 cross-projection GC revalidates under its transaction and never reuses storage IDs',t=>{
  const f=fixture(t);f.admit('gc needle',four[0]);let armed=false,raced=0;
  const b=local(t,f),history={...b.p,intent:'history'};build(b,history);
  const inTransaction=[];
  function race(){
    if(!armed)return;armed=false;raced++;
    // While history is still ready, drain the highest retired generation
    // completely. Only then force history to allocate its replacement.
    for(let i=0;i<10 && side.prepare('SELECT 1 FROM generations WHERE id=?').get(old.generation.id);i++)b.storage.refresh(history,b.access,budget);
    assert.equal(side.prepare('SELECT 1 FROM generations WHERE id=?').get(old.generation.id),undefined);
    f.admit('replacement needle',four[0]);build(b,history);
  }
  const observer=instrumentDatabase((sql,method,args,result,native)=>{
    if(method==='get' && /SELECT storage_id,id FROM generations g/.test(sql)) {
      inTransaction.push(native.isTransaction);
      if(!native.isTransaction)race();
    }
  });
  const a=local(t,f,{observer,rendezvous(point){if(point==='gc-candidate')race();}});const old=build(a);
  const side=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX);t.after(()=>side.close());
  const oldId=side.prepare('SELECT storage_id FROM generations WHERE id=?').get(old.generation.id).storage_id;
  side.prepare('DELETE FROM publications WHERE generation=?').run(old.generation.id);
  armed=true;a.storage.refresh(a.p,a.access,budget);
  assert.equal(raced,1);
  const publication=b.storage.observe(history,b.access).publication;
  const g=side.prepare('SELECT storage_id FROM generations WHERE id=?').get(publication.generation.id);
  assert.ok(side.prepare('SELECT count(*) AS n FROM postings WHERE generation=?').get(g.storage_id).n>0,'the competing publication must retain its postings');
  assert.ok(g.storage_id>oldId,'deleted high storage IDs must not be reused');
  assert.deepEqual(side.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.ok(inTransaction.length>0);
  assert.ok(inTransaction.every(Boolean),'candidate ownership/protection must be checked inside deletion transaction');
});


test('Fix round 1 verification and query-frequency pages have bounded SQLite VM work at 19000 terms',t=>{
  const f=fixture(t);f.admit('needle orchard '+Array.from({length:130},(_,i)=>'term'+String(i).padStart(5,'0')).join(' '),four[0]);const sql={};
  const observer=instrumentDatabase((statement,method,args)=>{
    if(method!=='all')return;
    if(/UPDATE statistics SET verified_df=0/.test(statement))sql.reset={statement,args};
    if(/FROM (documents d|postings p)/.test(statement) && /LIMIT 128/.test(statement) && /s.term/.test(statement) && /p.position|d.identity/.test(statement))sql.verify={statement,args};
    if(/SELECT s.term,p.frequency/.test(statement) && / IN \(/.test(statement))sql.score={statement,args};
    if(/SELECT p.doc,p.term,d.eligible/.test(statement))sql[args.length===1?'auditStart':'auditResume']={statement,args};
    if(/SELECT \* FROM documents.*ORDER BY identity LIMIT 128/.test(statement))sql.documents={statement,args};
    if(/SELECT \* FROM statistics.*ORDER BY term LIMIT 128/.test(statement))sql.statistics={statement,args};
  });
  const a=local(t,f,{observer});const publication=build(a);a.storage.lexical(a.p,publication,'needle absent');
  for(const name of ['verify','score','auditStart','auditResume','documents','statistics'])assert.ok(sql[name],name);
  const side=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX,{readOnly:true});
  const schema=side.prepare("SELECT sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY type DESC,name").all().map(r=>r.sql);side.close();
  // SQLite's instruction callback counts every executed VM instruction. Feed
  // the actual production statements into independent in-memory databases;
  // neither the counter nor the threshold depends on wall-clock scheduling.
  const probe=spawnSync('python3',['-c',String.raw`
import json,sqlite3,sys
source=json.load(sys.stdin)
results=[]
for size in [1000,19000]:
 db=sqlite3.connect(':memory:')
 # Tables before indexes, matching sqlite_schema's descending type order.
 for sql in source['schema']: db.execute(sql)
 db.execute("INSERT INTO documents VALUES(1,1,0,'id','identity',1,0,1,?)",(size,))
 for i in range(2,size+1):
  db.execute("INSERT INTO documents VALUES(1,?,0,?,?,1,0,1,0)",(i,'id%05d'%i,'identity%05d'%i))
 position=any(r[1]=='position' for r in db.execute('PRAGMA table_info(postings)'))
 for i in range(1,size+1):
  term='needle' if i==1 else 'term%05d'%i
  db.execute('INSERT INTO statistics(generation,term_id,term,df,n,total_length) VALUES(1,?,?,1,0,0)',(i,term))
  db.execute('INSERT INTO postings VALUES('+','.join('?' for _ in range(5 if position else 4))+')',(1,1,i,1,i) if position else (1,1,i,1))
 counts={}
 for name in ['verify','score','auditStart','auditResume','documents','statistics']+(['reset'] if 'reset' in source else []):
  calls=[0]
  def step(): calls[0]+=1;return 0
  db.set_progress_handler(step,1)
  rows=db.execute(source[name]['statement'],source[name]['args']).fetchall()
  db.set_progress_handler(None,0)
  counts[name]={'steps':calls[0],'rows':len(rows)}
 results.append(counts)
print(json.dumps(results))
`],{input:JSON.stringify({...sql,schema}),encoding:'utf8',env:{}});
  assert.equal(probe.status,0,probe.stderr);
  const [small,large]=JSON.parse(probe.stdout);t.diagnostic(JSON.stringify({small,large}));
  assert.equal(large.verify.rows,128);assert.equal(large.score.rows,1);
  assert.ok(large.verify.steps<10000,JSON.stringify(large.verify));
  assert.ok(large.score.steps<1000,JSON.stringify(large.score));
  if(sql.reset){assert.equal(large.reset.rows,128);assert.ok(large.reset.steps<10000,JSON.stringify(large.reset));}
  for(const name of ['auditStart','auditResume','documents','statistics']) {
    assert.equal(large[name].rows,128,name);assert.ok(large[name].steps<10000,JSON.stringify(large[name]));
  }
  for(const kind of Object.keys(large))assert.ok(large[kind].steps<=small[kind].steps+500);
});

for(const scenario of ['selection','catchup'])test(`Fix round 1 collected captured generation returns index_unavailable and preserves reader (${scenario})`,async t=>{
  const f=fixture(t);for(let i=0;i<4;i++)f.admit('reader needle '+i,four[i]);
  const a=local(t,f);const publication=build(a);
  const {configured}=await import('../testing/context-product-owner-fixture.mjs');
  const {createProductReaderRuntime}=await import('../context-product-reader.mjs');
  const {Worker}=await import('node:worker_threads');
  const c=configured(t,f.path,four);c.options.host.configuration.collectCaptured=scenario;
  const open=createProductReaderRuntime({spawnWorker:data=>new Worker(new URL('./fixtures/context-product-index-worker.mjs',import.meta.url),
    {workerData:data,env:{},execArgv:[],stdout:true,stderr:true})});
  const reader=await open(c.options);t.after(()=>reader.close());
  c.view[6]=1;
  const input={readSet:four,types:['memory'],intent:'current',query:'needle',deadlineMs:5000};
  const result=await reader.findCandidates(input,c.token);
  assert.equal(c.view[6],2,'rendezvous must collect after observation and before lexical snapshot');
  assert.equal(result.ok,false,JSON.stringify(result));assert.equal(result.error.code,'index_unavailable');
  const side=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX,{readOnly:true});
  assert.equal(side.prepare('SELECT 1 FROM generations WHERE id=?').get(publication.generation.id),undefined);side.close();
  const status=await reader.getContextIndexStatus({readSet:four,types:['memory'],intent:'current',deadlineMs:5000},c.token);
  assert.equal(status.ok,true,JSON.stringify(status));
  assert.equal(status.value.lexical.state,scenario==='selection'?'absent':'ready');
  const next=await reader.findCandidates(input,c.token);
  assert.equal(next.ok,scenario==='catchup',JSON.stringify(next));
  if(scenario==='selection')assert.equal(next.error.code,'index_unavailable');
});

test('Fix round 1 ordered posting verification preserves the manifest across exact page boundaries and empty documents',t=>{
  const f=fixture(t),terms=Array.from({length:130},(_,i)=>'term'+String(i).padStart(3,'0'));
  f.admit(terms.slice(0,128).join(' '),four[0]);f.admit('!!!',four[1]);f.admit(terms.join(' ')+' term000',four[2]);
  const a=local(t,f),publication=build(a),side=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX,{readOnly:true});t.after(()=>side.close());
  const generation=side.prepare('SELECT storage_id FROM generations WHERE id=?').get(publication.generation.id).storage_id;
  const tuples=[];
  for(const d of side.prepare('SELECT * FROM documents WHERE generation=? ORDER BY identity').all(generation)) {
    tuples.push(['document',JSON.parse(d.identity),d.revision,d.body_revision,d.eligible,'candidate-text-v1',d.token_length]);
  }
  for(const r of side.prepare(`SELECT d.identity,s.term,p.frequency FROM postings p JOIN documents d ON d.generation=p.generation AND d.doc=p.doc
    JOIN statistics s ON s.generation=p.generation AND s.term_id=p.term WHERE p.generation=? ORDER BY d.identity,s.term`).all(generation)) {
    tuples.push(['posting',JSON.parse(r.identity),r.term,r.frequency]);
  }
  for(const r of side.prepare('SELECT * FROM statistics WHERE generation=? ORDER BY term').all(generation))tuples.push(['statistics',r.term,r.df,r.n,r.total_length]);
  assert.equal(publication.manifestDigest,createHash('sha256').update(tuples.map(t=>JSON.stringify(t)+'\n').join('')).digest('base64url'));
  assert.equal(publication.counts.documents,3);assert.equal(publication.counts.terms,130);assert.equal(publication.counts.totalTokenLength,259);
  assert.equal(a.storage.lexical(a.p,publication,'term129').matched,1);
});
