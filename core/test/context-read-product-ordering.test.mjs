import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync, backup } from 'node:sqlite';
import { chmodSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from '../testing/context-read-fixture.mjs';
import { four, descriptor, card } from '../testing/context-product-owner-fixture.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { productSidecar, PRODUCT_SIDECAR_SUFFIX } from '../context-product-sidecar.mjs';
import { createProductSqlitePolicy } from '../context-product-sqlite.mjs';
import { accessDigest } from '../context-product-validation.mjs';

let oracleSequence=0;
const ids=['\uE000','\u{10000}'];
const budget={maxItems:1024,maxMs:1000};
const quote=name=>'"'+name.replaceAll('"','""')+'"';
function sql(path,fn) {const db=new DatabaseSync(path);db.exec('PRAGMA foreign_keys=OFF');try{return fn(db);}finally{db.close();}}
// SQL-level logical copy changes encoding; SQLite backup deliberately preserves
// it. No raw database file copy or descriptor is used for either operation.
function reencode(source,path,encoding) {
  const from=new DatabaseSync(source,{readOnly:true}),to=new DatabaseSync(path);chmodSync(path,0o600);
  try {
    to.exec(`PRAGMA foreign_keys=OFF; PRAGMA encoding='${encoding}'; BEGIN`);
    const schema=from.prepare("SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type='table' DESC,name").all();
    for(const row of schema.filter(r=>r.type==='table'))to.exec(row.sql);
    for(const row of schema.filter(r=>r.type==='table')) {
      const columns=from.prepare(`PRAGMA table_info(${quote(row.name)})`).all().map(c=>c.name);
      const insert=to.prepare(`INSERT INTO ${quote(row.name)}(${columns.map(quote).join(',')}) VALUES(${columns.map(()=>'?').join(',')})`);
      for(const data of from.prepare(`SELECT * FROM ${quote(row.name)}`).all())insert.run(...columns.map(c=>data[c]));
    }
    for(const row of schema.filter(r=>r.type!=='table'))to.exec(row.sql);
    for(const name of ['application_id','user_version'])to.exec(`PRAGMA ${name}=${from.prepare('PRAGMA '+name).get()[name]}`);
    to.exec('COMMIT');assert.equal(to.prepare('PRAGMA encoding').get().encoding,encoding);
  } finally {to.close();from.close();}
}
function seed(t) {
  const f=fixture(t,{cards:true});
  const memories=[f.admit('orchard needle first',four[0]),f.admit('orchard needle second',four[0])];
  const cards=[card(f,four[0],'orchard first','needle first'),card(f,four[0],'orchard second','needle second')];
  return {f,memories,cards};
}
function unicode(path,seeded) {
  sql(path,db=>{
    db.exec('BEGIN');
    const tables=db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    for(const [type,rows] of [['memory',seeded.memories],['card',seeded.cards]])for(const [i,row] of rows.entries()) {
      db.prepare(`UPDATE ${type==='memory'?'memories':'private_cards'} SET id=? WHERE id=?`).run(ids[i],row.id);
      for(const {name} of tables)if(db.prepare(`PRAGMA table_info(${quote(name)})`).all().some(c=>c.name===type+'_id'))
        db.prepare(`UPDATE ${quote(name)} SET ${quote(type+'_id')}=? WHERE ${quote(type+'_id')}=?`).run(ids[i],row.id);
    }
    db.exec('UPDATE namespace_epochs SET epoch=epoch+1; UPDATE card_epochs SET generation=generation+1; COMMIT');
  });
}
const bump=path=>sql(path,db=>db.exec('UPDATE namespace_epochs SET epoch=epoch+1; UPDATE card_epochs SET generation=generation+1'));
function local(t,path,mode='DELETE') {
  let clock=0,stop,storage;
  const sqlite=createProductSqlitePolicy();sqlite.start(Infinity);
  const facade=openContextProductFacade(path,{sqlite});
  const p={readSet:four,types:['memory','card'],intent:'current',ownerCoverage:descriptor(four)};
  const access=accessDigest({ownerId:four[0].ownerId,namespaces:{readSet:four}});
  function reopen() {storage=productSidecar({path,db:facade.port.db,identity:facade.port.identity,features:facade.port.features,sqlite,writable:true,
    sidecarJournalMode:mode,now:()=>clock,rendezvous(point){if(point===stop)clock=900;}});}
  reopen();t.after(()=>{storage.close();facade.close();});
  const state=()=>sql(path+PRODUCT_SIDECAR_SUFFIX,db=>db.prepare('SELECT g.* FROM work w JOIN generations g ON g.id=w.generation').get());
  function step(point) {clock=0;stop=point;return storage.refresh(p,access,budget);}
  function until(preparing) {
    const totals={};
    for(let i=0;i<300;i++) {
      const m=step(preparing?'verification':null);for(const [k,v] of Object.entries(m))totals[k]=(totals[k]??0)+v;
      const g=state();if(preparing && g?.phase>=20)return {totals,g};
      const r=storage.observe(p,access);if(!preparing && r.dto.lexical.state==='ready')return {totals,publication:r.publication};
    }
    assert.fail('ordered builder must converge');
  }
  return {path,p,facade,state,step,prepare:()=>until(true),finish:()=>until(false),
    closeStorage:()=>storage.close(),reopen,
    rank:publication=>storage.lexical(p,publication,'orchard needle'),
    observed:()=>storage.observe(p,access)};
}
function canonicalSet(path) {
  return sql(path,db=>[
    ...db.prepare("SELECT id FROM memories WHERE deleted=0 AND currentness='current' AND review_state<>'awaiting'").all().map(r=>'memory:'+r.id),
    ...db.prepare("SELECT id FROM private_cards WHERE state='confirmed'").all().map(r=>'card:'+r.id)
  ].sort());
}
function documentSet(a,publication) {
  return sql(a.path+PRODUCT_SIDECAR_SUFFIX,db=>db.prepare(`SELECT stream,id FROM documents WHERE eligible=1 AND generation=
    (SELECT storage_id FROM generations WHERE id=?)`).all(publication.generation.id).map(r=>(r.stream%5===4?'memory:':'card:')+r.id).sort());
}
async function equivalent(t,a,result,label) {
  // Membership is checked against canonical SQL before invoking the independent
  // builder, so the same builder defect cannot make this oracle pass.
  assert.deepEqual(documentSet(a,result.publication),canonicalSet(a.path),label+' document set equals canonical eligible set');
  const path=a.path+'-oracle-'+(oracleSequence++)+'.sqlite',native=new DatabaseSync(a.path,{readOnly:true});
  try {await backup(native,path);} finally {native.close();}
  chmodSync(path,0o600);
  const oracle=local(t,path),expected=oracle.finish();
  assert.deepEqual(documentSet(oracle,expected.publication),canonicalSet(path),'oracle independently covers canonical eligible set');
  assert.deepEqual(a.rank(result.publication),oracle.rank(expected.publication),label+' BM25 equals backup oracle');
  assert.deepEqual(result.publication.counts,expected.publication.counts,label+' counts equal backup oracle');
}
function malformed(a,type) {
  sql(a.path,db=>{
    if(type==='card')db.prepare("UPDATE private_cards SET id=CAST(X'80' AS TEXT),state='draft' WHERE id=?").run(ids[0]);
    else db.prepare("UPDATE memories SET id=CAST(X'80' AS TEXT),deleted=1,content=NULL WHERE id=?").run(ids[0]);
    db.exec('UPDATE namespace_epochs SET epoch=epoch+1; UPDATE card_epochs SET generation=generation+1');
  });
  assert.throws(()=>a.finish(),e=>e.code==='index_unavailable'&&e.reason==='corrupt','malformed stored ID must not certify a lossy cursor');
  assert.notEqual(a.observed().dto.lexical.state,'ready','malformed stored ID cannot publish current coverage');
}

for(const encoding of ['UTF-8','UTF-16le','UTF-16be'])for(const build of ['fresh','retarget'])
test(`F1 ${encoding} ${build}: independent Unicode Card/Memory membership and backup BM25`,async t=>{
  const seeded=seed(t),{f}=seeded;
  const path=join(f.workspace.path,'ordered.sqlite');reencode(f.path,path,encoding);
  if(build==='fresh')unicode(path,seeded);
  const a=local(t,path);
  let old;
  if(build==='retarget') {
    a.finish();unicode(path,seeded);old=a.prepare().g.id;bump(path);
  }
  const result=a.finish();await equivalent(t,a,result,encoding+' '+build);
  if(build==='retarget') {
    assert.equal(result.publication.generation.id===old,encoding==='UTF-8','only UTF-8 ordering may retarget in place');
    assert.equal(result.totals.retargets,encoding==='UTF-8'?1:0);
    if(encoding==='UTF-8')assert.equal(result.totals.reused,4,'UTF-8 comparison reuses all four Unicode contributions');
  }
  // These controls also require the new stored-byte guard. The baseline's
  // valid-Unicode UTF-8 pass is already correct, but it certifies this alias.
  if(encoding==='UTF-8')malformed(a,build==='fresh'?'card':'memory');
});

for(const encoding of ['UTF-16le','UTF-16be'])test(`F1 UTF-8 canonical / ${encoding} sidecar uses append-only fallback`,async t=>{
  const seeded=seed(t),{f}=seeded;unicode(f.path,seeded);
  const a=local(t,f.path);a.step('opened');a.closeStorage();
  const target=f.path+PRODUCT_SIDECAR_SUFFIX,converted=target+'-converted';reencode(target,converted,encoding);renameSync(converted,target);a.reopen();
  const result=a.finish();await equivalent(t,a,result,encoding+' sidecar');
  bump(f.path);const old=a.prepare().g.id;bump(f.path);const next=a.finish();
  assert.notEqual(next.publication.generation.id,old,'UTF-16 sidecar cannot retarget work');
  assert.equal(next.totals.retargets,0);await equivalent(t,a,next,encoding+' sidecar retarget');
});


test('F1 malformed UTF-8 work ID is refused before ordered comparison',t=>{
  const seeded=seed(t),{f}=seeded;unicode(f.path,seeded);const a=local(t,f.path);a.prepare();
  sql(f.path+PRODUCT_SIDECAR_SUFFIX,db=>db.prepare("UPDATE documents SET id=CAST(X'80' AS TEXT) WHERE doc=(SELECT min(doc) FROM documents)").run());
  bump(f.path);
  assert.throws(()=>a.finish(),e=>e.code==='index_unavailable'&&e.reason==='corrupt','malformed work ID must not enter the JavaScript merge');
  assert.notEqual(a.observed().dto.lexical.state,'ready');
});
