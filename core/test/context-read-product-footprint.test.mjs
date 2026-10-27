import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
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

test('format 2 uses integer postings, reconstructs identical current/history manifests and binds certificates',t=>{
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
  assert.equal(current.format,2);
  const side=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX);t.after(()=>side.close());
  assert.equal(side.prepare('PRAGMA user_version').get().user_version,2);
  assert.equal(side.prepare('PRAGMA auto_vacuum').get().auto_vacuum,2);
  assert.deepEqual(side.prepare('PRAGMA table_info(postings)').all().map(r=>[r.name,r.type]),
    [['generation','INTEGER'],['doc','INTEGER'],['term','INTEGER'],['frequency','INTEGER']]);
  assert.match(side.prepare("SELECT sql FROM sqlite_schema WHERE name='postings'").get().sql,/WITHOUT ROWID/);
  assert.deepEqual(side.prepare('PRAGMA foreign_key_check').all(),[]);
  const {mac,...body}=current;
  const old=signedRecord(a.facade.port.identity.cursorSecret,'validation',{...body,format:1});
  assert.throws(()=>verifiedRecord(a.facade.port.identity.cursorSecret,'validation',old),{reason:'validation_invalid'});
  assert.equal(verifiedRecord(a.facade.port.identity.cursorSecret,'validation',canonicalJson(current)).format,2);
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
  assert.equal(build(local(t,f)).format,2);
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

test('expensive open and per-item costs yield ok durable partial progress, repeated quanta finish without timeout',t=>{
  const f=fixture(t);for(let i=0;i<9;i++)f.admit('quantum 東京 '+i,four[0]);
  let clock=0,items=0;
  const facade=openContextProductFacade(f.path,{}),ownerCoverage=descriptor(four);
  const index=openProductIndex({path:f.path,facade,ownerCoverage,maintenance:true,now:()=>clock,
    authorize:()=>({accessGenerations:accessDigest({ownerId:four[0].ownerId,namespaces:{readSet:four}}),check(){},envelope:fn=>fn()}),
    storageOptions:{rendezvous(point){if(point==='opened')clock+=600;if(point==='scan')clock+=100;if(point==='item'){clock+=70;items++;}if(point==='verify-item')clock+=10;if(point==='checkpoint')clock+=20;}}});
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
