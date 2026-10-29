import { createMaintenanceAttribution } from '../context-product-attribution.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync, backup } from 'node:sqlite';
import { chmodSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, ok, readTransaction } from '../testing/context-read-fixture.mjs';
import { four, personal, project, descriptor, card } from '../testing/context-product-owner-fixture.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { productSidecar, PRODUCT_SIDECAR_SUFFIX } from '../context-product-sidecar.mjs';
import { accessDigest, verifiedRecord } from '../context-product-validation.mjs';
import { createProductSqlitePolicy } from '../context-product-sqlite.mjs';
import { fixture as dependencyFixture, ns as dependencyNamespace } from './card-current-fixture.mjs';

const budget={maxItems:1024,maxMs:1000};
const counterNames=['reused','replaced','removed','copied','tokenized','retargets','verificationRestarts','verificationKept'];
function local(t,path,readSet=four,intent='current',mode='DELETE') {
  let clock=0,stop=null,hook=()=>{},storage;
  const attribution=createMaintenanceAttribution({now:()=>clock});
  const sqlite=createProductSqlitePolicy();sqlite.start(Infinity);
  const facade=openContextProductFacade(path,{sqlite});
  const p={readSet,types:facade.port.features.cards?['memory','card']:['memory'],intent,ownerCoverage:descriptor(readSet)};
  let access=accessDigest({ownerId:readSet[0].ownerId,namespaces:{readSet}});
  function reopen() {
    storage?.close();
    storage=productSidecar({path,db:facade.port.db,identity:facade.port.identity,features:facade.port.features,sqlite,
      writable:true,sidecarJournalMode:mode,attribution,now:()=>clock,rendezvous(point){hook(point);if(point===stop)clock=900;}});
  }
  reopen();t.after(()=>{storage.close();facade.close();});
  return {p,facade,reopen,setAccess(value){access=value;},setHook(value){hook=value;},
    step(point=null,maxItems=1024) {clock=0;attribution.reset();stop=point;return storage.refresh(p,access,{...budget,maxItems});},
    observe(){return readTransaction(facade.port.db,()=>storage.observe(p,access));},
    lexical(publication,query){return storage.lexical(p,publication,query);},
    reconcile(){const totals={},end=p.readSet.length*p.types.reduce((n,type)=>n+(type==='card'?4:1),0);
      for(let i=0;i<1000;i++) {
        const m=this.step('verification');for(const [k,v] of Object.entries(m))totals[k]=(totals[k]??0)+v;
        const g=work(path);if(!g || g.phase>=end)return totals;
      }assert.fail('comparison must converge');
    },
    finish(){const totals={};for(let i=0;i<200;i++){
      const m=this.step();for(const [k,v] of Object.entries(m))totals[k]=(totals[k]??0)+v;
      const r=this.observe();if(r.dto.lexical.state==='ready')return {publication:r.publication,totals};
    }assert.fail('reconcile must converge');}
  };
}
function inspect(path,fn,mutation=false) {
  const db=new DatabaseSync(path+PRODUCT_SIDECAR_SUFFIX);
  try{return mutation?fn(db):readTransaction(db,()=>fn(db));}finally{db.close();}
}
const tamper=(path,fn)=>inspect(path,fn,true);
const work=path=>inspect(path,db=>db.prepare('SELECT g.*,r.record FROM work w JOIN generations g ON g.id=w.generation JOIN progress_records r ON r.generation=g.id ORDER BY g.storage_id DESC').get());
const documents=path=>inspect(path,db=>db.prepare('SELECT d.* FROM documents d JOIN work w JOIN generations g ON g.id=w.generation AND d.generation=g.storage_id ORDER BY d.stream,d.id').all());
function mutate(f,sql,...args) {
  const db=new DatabaseSync(f.path);try{db.prepare(sql).run(...args);}finally{db.close();}
}
function bump(f) {mutate(f,'UPDATE namespace_epochs SET epoch=epoch+1');}
function correct(f,row,namespace,text='corrected orchard needle') {
  ok(f.core.correct({namespace,memoryId:row.id,expectedRevision:row.revision,content:text,kind:'fact',
    receipt:{client:'synthetic',sessionId:'retarget',eventId:'correction-'+row.id,role:'user',excerpt:text}}));
}
async function oracle(t,f,a,label) {
  // SQLite backup captures committed logical state, including live WAL content.
  // No database file is copied or opened through a raw file descriptor.
  const path=join(f.workspace?.path??f.dir,'oracle-'+label+'.sqlite');await backup(f.db,path);chmodSync(path,0o600);
  const b=local(t,path,a.p.readSet,a.p.intent);b.p.types=[...a.p.types];
  const expected=b.finish().publication,actual=a.finish().publication;
  assert.equal(actual.manifestDigest,expected.manifestDigest,label);
  assert.deepEqual(actual.counts,expected.counts,label);
  for(const query of ['orchard','needle','uniqueobsolete','corrected','card','finance'])
    assert.deepEqual(a.lexical(actual,query),b.lexical(expected,query),label+': '+query);
  return actual;
}

for(const mode of ['DELETE','WAL'])for(const width of [4,16])for(const intent of ['current','history'])
test(`B1 backup oracle: ${mode}, ${width} namespaces, ${intent}`,async t=>{
  const readSet=width===4?four:[personal,...Array.from({length:15},(_,i)=>project('n'+String(i).padStart(2,'0')))];
  const f=fixture(t,{cards:true}),rows=[];
  for(let i=0;i<width*2;i++)rows.push(f.admit('orchard needle uniqueobsolete '+i,readSet[i%width]));
  const c=card(f,readSet[0],'card orchard','needle uniqueobsolete');
  const a=local(t,f.path,readSet,intent,mode);a.finish();
  const cases=[
    ['insert',()=>f.admit('new orchard needle',readSet[0])],
    ['revision',()=>correct(f,rows[0],readSet[0])],
    ['forget',()=>ok(f.core.forget({namespace:readSet[1],memoryId:rows[1].id,expectedRevision:rows[1].revision}))],
    ['review',()=>{mutate(f,"UPDATE memories SET review_state='awaiting' WHERE id=?",rows[2].id);bump(f);}],
    ['currentness',()=>{mutate(f,"UPDATE memories SET currentness='historical' WHERE id=?",rows[3].id);bump(f);}],
    ['card-state',()=>{mutate(f,"UPDATE private_cards SET state='draft' WHERE id=?",c.id);bump(f);}],
    ['card-body',()=>{mutate(f,"UPDATE private_cards SET state='confirmed',body='corrected card needle',body_revision=body_revision+1 WHERE id=?",c.id);bump(f);}],
    ['delete-with-fence',()=>{mutate(f,'DELETE FROM memories WHERE id=?',rows[4].id);bump(f);}]
  ];
  for(const [label,change] of cases) {
    bump(f);a.reconcile();const before=work(f.path);assert.ok(before);
    change();const m=a.step('checkpoint'),after=work(f.path);
    assert.equal(m.retargets,1,label);assert.equal(after.id,before.id,label);
    assert.notEqual(after.incarnation,before.incarnation,label);
    await oracle(t,f,a,label);
  }
  assert.equal(inspect(f.path,db=>db.prepare('PRAGMA user_version').get().user_version),3);
  assert.equal(inspect(f.path,db=>db.prepare('PRAGMA journal_mode').get().journal_mode),mode.toLowerCase());
});

test('B1 no re-copy: changed N of M work documents replace/tokenize only N; published base stays immutable',t=>{
  const f=fixture(t),rows=[];for(let i=0;i<40;i++)rows.push(f.admit('orchard needle '+i,four[0]));
  const a=local(t,f.path,four);const base=a.finish().publication;
  const before=inspect(f.path,db=>db.prepare('SELECT * FROM documents ORDER BY generation,doc').all());
  bump(f);const first=a.reconcile();assert.equal(first.copied,40);assert.equal(first.tokenized,0);
  const id=work(f.path).id;
  for(let i=0;i<3;i++)correct(f,rows[i],four[0],'changed orchard needle '+i);
  const m=a.reconcile();
  assert.equal(work(f.path).id,id);assert.equal(m.retargets,1);assert.equal(m.reused,37);
  assert.equal(m.tokenized,3);assert.equal(m.replaced,3);assert.equal(m.copied,0);assert.equal(m.verificationRestarts,1);
  assert.deepEqual(inspect(f.path,db=>db.prepare('SELECT * FROM documents WHERE generation=(SELECT storage_id FROM generations WHERE id=?) ORDER BY generation,doc').all(base.generation.id)),before);
  a.finish();
});

for(const changed of [false,true])test(`B1 verification retarget ${changed?'restarts on change':'keeps exact checkpoint and verified_df'}`,async t=>{
  const f=fixture(t),rows=[];for(let i=0;i<160;i++)rows.push(f.admit('orchard needle '+i,four[0]));
  const a=local(t,f.path);
  for(let i=0;i<20;i++){a.step('verification');if(JSON.parse(work(f.path).verify).postings>0)break;}
  const before=work(f.path),v=JSON.parse(before.verify);assert.ok(v.hash.bytes>0);assert.ok(v.resetDone);assert.ok(v.postings>0);
  const dfs=inspect(f.path,db=>db.prepare('SELECT term_id,verified_df FROM statistics WHERE generation=? ORDER BY term_id').all(before.storage_id));
  if(changed)correct(f,rows[0],four[0]);else bump(f);
  const totals={};let after;
  // Stop at each comparison checkpoint so verification cannot run in this call.
  for(let i=0;i<100;i++) {
    const m=a.step('checkpoint');for(const name of counterNames)totals[name]=(totals[name]??0)+m[name];
    after=work(f.path);if(after.phase>=a.p.readSet.length*a.p.types.reduce((n,type)=>n+(type==='card'?4:1),0))break;
  }
  assert.equal(after.id,before.id);assert.equal(totals.retargets,1);
  if(changed){assert.equal(totals.verificationRestarts,1);assert.equal(totals.verificationKept,0);assert.equal(JSON.parse(after.verify).hash.bytes,0);}
  else {assert.equal(totals.verificationRestarts,0);assert.equal(totals.verificationKept,1);assert.deepEqual(JSON.parse(after.verify),v);
    assert.deepEqual(inspect(f.path,db=>db.prepare('SELECT term_id,verified_df FROM statistics WHERE generation=? ORDER BY term_id').all(before.storage_id)),dfs);}
  await oracle(t,f,a,changed?'verify-restart':'verify-keep');
});

test('B1 transform retarget and in-batch race preserve completed contributions across reopen',async t=>{
  const f=fixture(t),rows=[];for(let i=0;i<8;i++)rows.push(f.admit('orchard needle '+i,four[0]));
  const a=local(t,f.path);a.p.types=['memory'];a.step(null,3);
  const before=work(f.path),docs=documents(f.path);assert.equal(docs.length,3);
  bump(f);let raced=false;
  a.setHook(point=>{if(point==='scan'&&!raced){raced=true;mutate(f,'DELETE FROM memories WHERE id=?',rows.map(row=>row.id).sort().at(-1));bump(f);}});
  a.step();assert.ok(raced);assert.deepEqual(work(f.path),before);assert.deepEqual(documents(f.path),docs);
  a.reopen();a.setHook(()=>{});const m=a.step('checkpoint');assert.equal(m.retargets,1);assert.equal(m.reused,3);assert.equal(work(f.path).id,before.id);
  a.reopen();await oracle(t,f,a,'reopen');
});

test('B1 rebinding waits for first admitted comparison and signed record refuses replay/tampering',t=>{
  const f=fixture(t);for(let i=0;i<5;i++)f.admit('orchard needle '+i,four[0]);
  const a=local(t,f.path);a.step('verification');const old=work(f.path);bump(f);
  // Opening consumes scan admission: no provisional rebind may commit alone.
  assert.equal(a.step('opened').retargets,0);a.reopen();assert.deepEqual(work(f.path),old);
  a.setHook(point=>{if(point==='batch')throw Error('crash before commit');});
  assert.throws(()=>a.step(),/crash before commit/);a.setHook(()=>{});a.reopen();assert.deepEqual(work(f.path),old);
  a.setHook(point=>{if(point==='checkpoint')throw Error('crash after rebind commit');});
  assert.throws(()=>a.step(),/crash after rebind commit/);a.setHook(()=>{});const rebound=work(f.path);assert.equal(rebound.id,old.id);assert.notEqual(rebound.record,old.record);
  const record=verifiedRecord(a.facade.port.identity.cursorSecret,'progress',rebound.record);
  assert.equal(record.generation.incarnation,rebound.incarnation);assert.notEqual(record.canonicalFenceDigest,JSON.parse(old.fences).canonicalFenceDigest);
  a.reopen();assert.notEqual(a.observe().dto.lexical.reason,'validation_invalid');
  tamper(f.path,db=>db.prepare('UPDATE progress_records SET record=? WHERE generation=?').run(old.record,rebound.id));
  assert.equal(a.observe().dto.lexical.reason,'validation_invalid');
  a.step('checkpoint');assert.notEqual(work(f.path).id,old.id);
  const valid=work(f.path);tamper(f.path,db=>db.prepare('UPDATE progress_records SET record=? WHERE generation=?').run(valid.record.replace(/"mac":"./,'"mac":"!'),valid.id));
  assert.equal(a.observe().dto.lexical.reason,'validation_invalid');a.step('checkpoint');assert.notEqual(work(f.path).id,valid.id);a.finish();
});

test('B1 access change and projection change create new generations',t=>{
  const f=fixture(t);f.admit('orchard needle',four[0]);const a=local(t,f.path);a.reconcile();const before=work(f.path);
  a.setAccess('new-access');const m=a.step('checkpoint');assert.equal(m.retargets,0);assert.notEqual(work(f.path).id,before.id);
  const accessWork=work(f.path);a.p.intent='history';a.step('checkpoint');assert.notEqual(work(f.path).id,accessWork.id);
});

test('B1 ordered absence detection removes page gaps and the entire tail, including zero-df terms',async t=>{
  const f=fixture(t);for(let i=0;i<260;i++)f.admit('orchard needle '+i,four[0]);
  const a=local(t,f.path);a.p.types=['memory'];a.reconcile();
  const before=work(f.path),all=documents(f.path);assert.equal(all.length,260);
  const victims=[all[0],all[126],all[128],...all.slice(255)];
  for(const row of victims)mutate(f,'DELETE FROM memories WHERE id=?',row.id);
  bump(f);const m=a.reconcile();assert.equal(m.removed,8);assert.equal(m.reused,252);assert.equal(m.copied,0);assert.equal(m.tokenized,0);
  assert.equal(work(f.path).id,before.id);assert.equal(documents(f.path).length,252);
  await oracle(t,f,a,'ranges');
});

test('B1 removal deletes the last posting and zero-df dictionary row and adjusts totals',async t=>{
  const f=fixture(t),victim=f.admit('uniqueobsolete uniqueobsolete',four[0]);f.admit('orchard needle',four[0]);
  const a=local(t,f.path);a.reconcile();const before=work(f.path);
  mutate(f,'DELETE FROM memories WHERE id=?',victim.id);bump(f);const m=a.reconcile();assert.equal(m.removed,1);
  assert.equal(inspect(f.path,db=>db.prepare("SELECT count(*) n FROM statistics WHERE generation=? AND term='uniqueobsolete'").get(before.storage_id).n),0);
  assert.equal(inspect(f.path,db=>db.prepare("SELECT n FROM statistics WHERE generation=? AND term=''").get(before.storage_id).n),1);
  await oracle(t,f,a,'zero-df');
});

test('B1 refuses to rebind a work pointer to a certified generation',t=>{
  const f=fixture(t);f.admit('orchard needle',four[0]);const a=local(t,f.path),base=a.finish().publication;
  tamper(f.path,db=>db.prepare('INSERT INTO work VALUES(?,?)').run(base.projectionDigest,base.generation.id));bump(f);
  assert.equal(a.observe().dto.lexical.reason,'validation_invalid');a.step('checkpoint');assert.notEqual(work(f.path).id,base.generation.id);
  a.finish();
});

for(const intent of ['current','history'])test(`B1 dependency-only retarget reobserves eligibility: ${intent}`,async t=>{
  const f=dependencyFixture(t);f.card();const a=local(t,f.path,[dependencyNamespace],intent);a.p.types=['card'];a.step('verification');
  const before=work(f.path);f.change();assert.equal(a.observe().dto.lexical.reason,'dependency_changed');
  const m=a.reconcile(),after=work(f.path);assert.equal(after.id,before.id);assert.equal(m.retargets,1);
  assert.equal(JSON.parse(after.fences).canonicalFenceDigest,JSON.parse(before.fences).canonicalFenceDigest);
  if(intent==='current'){assert.equal(m.replaced,1);assert.equal(m.verificationRestarts,1);}
  else {assert.equal(m.reused,1);assert.equal(m.verificationKept,1);assert.equal(m.verificationRestarts,0);}
  await oracle(t,f,a,'dependency');
});

test('B1 a fully verified no-change retarget cannot publish before completing reconciliation',async t=>{
  const f=fixture(t);f.admit('orchard needle',four[0]);const a=local(t,f.path);let before;
  for(let i=0;i<20;i++){a.step('verification');before=work(f.path);if(JSON.parse(before.verify).phase===3)break;}
  assert.equal(JSON.parse(before.verify).phase,3);bump(f);
  const m=a.step('checkpoint');assert.equal(m.retargets,1);assert.equal(work(f.path).id,before.id);
  assert.equal(JSON.parse(work(f.path).verify).phase,3);assert.equal(a.observe().publication,null);
  a.reopen();const completed=a.finish();assert.equal(completed.totals.verificationKept,1);assert.equal(completed.totals.verificationRestarts,0);
  await oracle(t,f,a,'fully-verified');
});

test('B1 unavailable publication still abandons delta work with a nonzero base sequence',t=>{
  const f=fixture(t);f.admit('orchard needle',four[0]);const a=local(t,f.path);const base=a.finish().publication;
  bump(f);a.reconcile();const before=work(f.path);assert.ok(before.base_sequence>0);
  tamper(f.path,db=>db.prepare("UPDATE validation_records SET record='invalid' WHERE publication=?").run(base.publicationId));bump(f);
  const m=a.step('checkpoint'),after=work(f.path);assert.equal(m.retargets,0);assert.notEqual(after.id,before.id);assert.equal(after.base_sequence,0);
  a.finish();
});

for(const intent of ['current','history'])test(`B1 removal deletes old Card stream contributions in either direction: ${intent}`,async t=>{
  const f=fixture(t,{cards:true}),c=card(f,four[0],'card orchard','needle');const a=local(t,f.path,four,intent);
  a.reconcile();const id=work(f.path).id;
  for(const state of ['draft','confirmed']) {
    mutate(f,'UPDATE private_cards SET state=? WHERE id=?',state,c.id);mutate(f,'UPDATE card_epochs SET generation=generation+1');
    const m=a.reconcile();assert.equal(work(f.path).id,id);assert.equal(m.removed,1);assert.equal(m.replaced,0);assert.equal(m.tokenized,1);
  }
  await oracle(t,f,a,'card-moves');
});
