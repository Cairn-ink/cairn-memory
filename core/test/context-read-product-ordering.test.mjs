import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync, backup } from 'node:sqlite';
import { chmodSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, ok } from '../testing/context-read-fixture.mjs';
import { four, descriptor, card, configured } from '../testing/context-product-owner-fixture.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { productSidecar, PRODUCT_SIDECAR_SUFFIX } from '../context-product-sidecar.mjs';
import { createProductSqlitePolicy } from '../context-product-sqlite.mjs';
import { accessDigest, digest, signedRecord } from '../context-product-validation.mjs';
import { termFrequencies } from '../context-read-tokenize.mjs';

let oracleSequence=0;
const ids=['\uE000','\u{10000}'];
const budget={maxItems:1024,maxMs:1000};
const quote=name=>'"'+name.replaceAll('"','""')+'"';
function sql(path,fn) {const db=new DatabaseSync(path);db.exec('PRAGMA foreign_keys=OFF');try{return fn(db);}finally{db.close();}}
// SQL-level logical copy changes encoding; SQLite backup deliberately preserves
// it. No raw database file copy or descriptor is used for either operation.
function reencode(source,path,encoding,{nocase=false}={}) {
  const from=new DatabaseSync(source,{readOnly:true}),to=new DatabaseSync(path);chmodSync(path,0o600);
  try {
    to.exec(`PRAGMA foreign_keys=OFF; PRAGMA encoding='${encoding}'; BEGIN`);
    const schema=from.prepare("SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type='table' DESC,name").all();
    const collated=row=>nocase && ['memories','private_cards'].includes(row.name);
    for(const row of schema.filter(r=>r.type==='table'))to.exec(collated(row)
      ? row.sql.replace(/id TEXT PRIMARY KEY/, 'id TEXT COLLATE NOCASE').replace(/\)\s*STRICT$/i,',PRIMARY KEY(id COLLATE BINARY)) STRICT') : row.sql);
    for(const row of schema.filter(r=>r.type==='table')) {
      const columns=from.prepare(`PRAGMA table_info(${quote(row.name)})`).all().map(c=>c.name);
      const insert=to.prepare(`INSERT INTO ${quote(row.name)}(${columns.map(quote).join(',')}) VALUES(${columns.map(()=>'?').join(',')})`);
      for(const data of from.prepare(`SELECT * FROM ${quote(row.name)}`).all())insert.run(...columns.map(c=>data[c]));
    }
    for(const row of schema.filter(r=>r.type!=='table'))to.exec(nocase && row.type==='index' && / ON (memories|private_cards)\s*\(/i.test(row.sql)
      ? row.sql.replace(/\bid\b/g,'id COLLATE BINARY') : row.sql);
    if(nocase)to.exec('CREATE UNIQUE INDEX nocase_memory_id ON memories(id); CREATE UNIQUE INDEX nocase_card_id ON private_cards(id)');
    for(const name of ['application_id','user_version'])to.exec(`PRAGMA ${name}=${from.prepare('PRAGMA '+name).get()[name]}`);
    to.exec('COMMIT');assert.equal(to.prepare('PRAGMA encoding').get().encoding,encoding);
  } finally {to.close();from.close();}
}
function seed(t) {
  const f=fixture(t,{cards:true});
  const memories=[f.admit('orchard needle first',four[0]),f.admit('orchard needle second',four[0])];
  const cards=[card(f,four[0],'orchard cardalphatitle','needle cardalphabody'),card(f,four[0],'orchard cardbetatitle','needle cardbetabody')];
  return {f,memories,cards};
}
function unicode(path,seeded,values=ids) {
  sql(path,db=>{
    db.exec('BEGIN');
    const tables=db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    for(const [type,rows] of [['memory',seeded.memories],['card',seeded.cards]])for(const [i,row] of rows.entries()) {
      db.prepare(`UPDATE ${type==='memory'?'memories':'private_cards'} SET id=? WHERE id=?`).run(values[i],row.id);
      for(const {name} of tables)if(db.prepare(`PRAGMA table_info(${quote(name)})`).all().some(c=>c.name===type+'_id'))
        db.prepare(`UPDATE ${quote(name)} SET ${quote(type+'_id')}=? WHERE ${quote(type+'_id')}=?`).run(values[i],row.id);
    }
    db.exec('UPDATE namespace_epochs SET epoch=epoch+1; UPDATE card_epochs SET generation=generation+1; COMMIT');
  });
}
const bump=path=>sql(path,db=>db.exec('UPDATE namespace_epochs SET epoch=epoch+1; UPDATE card_epochs SET generation=generation+1'));
function local(t,path,mode='DELETE',observer) {
  let clock=0,stop,storage;
  const sqlite=createProductSqlitePolicy({observer});sqlite.start(Infinity);
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
      const r=storage.observe(p,access);if(!preparing && !g && r.dto.lexical.state==='ready')return {totals,publication:r.publication};
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
    ...(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='private_cards' AND type='table'").get()
      ? db.prepare("SELECT id FROM private_cards WHERE state='confirmed'").all().map(r=>'card:'+r.id) : [])
  ].sort());
}
function documentStreams(a) {
  return a.p.readSet.flatMap(ns=>['card','memory'].filter(type=>a.p.types.includes(type)).flatMap(type=>Array(type==='card'?4:1).fill({ns,type})));
}
function documentSet(a,publication) {
  const streams=documentStreams(a);
  return sql(a.path+PRODUCT_SIDECAR_SUFFIX,db=>db.prepare(`SELECT stream,id FROM documents WHERE eligible=1 AND generation=
    (SELECT storage_id FROM generations WHERE id=?)`).all(publication.generation.id).map(r=>streams[r.stream].type+':'+r.id).sort());
}
async function equivalent(t,a,result,label) {
  // Membership is checked against canonical SQL before invoking the independent
  // builder, so the same builder defect cannot make this oracle pass.
  assert.deepEqual(documentSet(a,result.publication),canonicalSet(a.path),label+' document set equals canonical eligible set');
  ownTerms(a,result.publication,label+' every eligible document indexes its own canonical body');
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

// The accepted schema attests BINARY primary/seek indexes, but does not attest
// the column collation. Extra NOCASE unique indexes keep foreign keys valid.
for(const seek of ['BINARY','NOCASE'])for(const build of ['fresh','retarget'])
test(`F3 NOCASE columns / ${seek} seek indexes / ${build}: independent membership`,async t=>{
  const seeded=seed(t),{f}=seeded,path=join(f.workspace.path,'collated.sqlite');
  reencode(f.path,path,'UTF-8',{nocase:true});unicode(path,seeded,['Z','a']);
  sql(path,db=>assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[],'collated fixture has valid foreign keys'));
  const a=local(t,path); // The real product validator accepts this schema.
  if(build==='retarget'){a.finish();bump(path);a.prepare();bump(path);}
  const changeSeek=collation=>sql(path,db=>db.exec(`DROP INDEX index_memory_keyset; DROP INDEX private_card_scope;
    CREATE INDEX index_memory_keyset ON memories(owner_id,scope,project_id,id COLLATE ${collation});
    CREATE INDEX private_card_scope ON private_cards(owner_id,scope,project_id,state,id COLLATE ${collation})`));
  // A NOCASE named seek index is refused on opening. Replace it only after
  // validation to exercise SQLite's prefix-scan/sort behavior during refresh.
  if(seek==='NOCASE')changeSeek(seek);
  const plans=sql(path,db=>[['memories','index_memory_keyset',[]],['private_cards','private_card_scope',['confirmed']]].map(([table,index,state])=>{
    const query=`SELECT id FROM ${table} INDEXED BY ${index} WHERE owner_id=? AND scope=? AND project_id=? ${state.length?'AND state=?':''}
      AND id COLLATE BINARY>? ORDER BY id COLLATE BINARY LIMIT ?`;
    const args=[four[0].ownerId,four[0].scope,'',...state,'',1];
    return {index,details:db.prepare('EXPLAIN QUERY PLAN '+query).all(...args).map(r=>r.detail).join('; '),
      first:db.prepare(query).all(...args).map(r=>r.id),next:db.prepare(query).all(...args.slice(0,-2),'Z',1).map(r=>r.id)};
  }));
  const result=a.finish();
  if(seek==='NOCASE')changeSeek('BINARY'); // Permit the independent oracle to open.
  await equivalent(t,a,result,`NOCASE columns ${seek} seek ${build}`);
  for(const plan of plans){
    assert.ok(plan.details.includes(plan.index),'forced named index remains usable');
    assert.equal(plan.details.includes('USE TEMP B-TREE'),seek==='NOCASE','only incompatible seek collation requires sorting');
    assert.deepEqual(plan.first,['Z'],'explicit BINARY order ignores column collation');
    assert.deepEqual(plan.next,['a'],'explicit BINARY cursor agrees with order');
  }
  if(seek==='NOCASE'){
    changeSeek(seek);
    assert.throws(()=>openContextProductFacade(path,{sqlite:createProductSqlitePolicy()}),e=>e.code==='unsupported_database',
      'new open refuses incompatible named seek index');
  }
});

// Downgrade only the authenticated construction state, using the actual store
// secret. The resulting signed records have the same shape as B0-era artifacts.
function legacy(a,id) {
  sql(a.path+PRODUCT_SIDECAR_SUFFIX,db=>{
    const g=db.prepare('SELECT * FROM generations WHERE id=?').get(id),v=JSON.parse(g.verify);
    delete v.byteSafe;delete v.appendOnly;
    const incarnation=digest({seed:g.seed,id:g.id,projection:g.projection,sequence:g.sequence,baseSequence:g.base_sequence,
      kind:g.kind,access:g.access,fences:JSON.parse(g.fences),phase:g.phase,lastKey:g.last_key,verify:v});
    db.exec('BEGIN');db.prepare('UPDATE generations SET verify=?,incarnation=? WHERE id=?').run(JSON.stringify(v),incarnation,id);
    for(const [table,purpose] of [['progress_records','progress'],['validation_records','validation']]) {
      const row=db.prepare(`SELECT record FROM ${table} WHERE generation=?`).get(id);
      if(!row)continue;
      const {mac,...record}=JSON.parse(row.record);record.generation.incarnation=incarnation;
      db.prepare(`UPDATE ${table} SET record=? WHERE generation=?`).run(signedRecord(a.facade.port.identity.cursorSecret,purpose,record),id);
    }
    db.exec('COMMIT');
  });
}
const generation=(a,id)=>sql(a.path+PRODUCT_SIDECAR_SUFFIX,db=>db.prepare('SELECT * FROM generations WHERE id=?').get(id));
function ownTerms(a,publication,label) {
  const streams=documentStreams(a);
  const canonical=sql(a.path,db=>{
    const entries=(type,rows)=>rows.map(r=>[JSON.stringify([r.owner_id,r.scope,r.project_id,type,r.id]),r.text]);
    return new Map([
      ...entries('memory',db.prepare('SELECT owner_id,scope,project_id,id,content AS text FROM memories WHERE deleted=0').all()),
      ...(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='private_cards' AND type='table'").get()
        ? entries('card',db.prepare("SELECT owner_id,scope,project_id,id,title||char(10)||body AS text FROM private_cards WHERE title IS NOT NULL AND body IS NOT NULL").all()) : [])
    ]);
  });
  sql(a.path+PRODUCT_SIDECAR_SUFFIX,db=>{
    const g=generation(a,publication.generation.id);
    for(const doc of db.prepare('SELECT * FROM documents WHERE generation=? AND eligible=1').all(g.storage_id)) {
      const actual=db.prepare(`SELECT s.term,p.frequency FROM postings p JOIN statistics s ON s.generation=p.generation AND s.term_id=p.term
        WHERE p.generation=? AND p.doc=? ORDER BY s.term`).all(g.storage_id,doc.doc).map(r=>[r.term,r.frequency]);
      const {ns,type}=streams[doc.stream],key=JSON.stringify([ns.ownerId,ns.scope,ns.projectId??'',type,doc.id]);
      assert.deepEqual(actual,[...termFrequencies(canonical.get(key)).frequencies].sort(),label);
    }
  });
}

test('F4 unmarked certificate rebuilds while its reads remain available',async t=>{
  const {f}=seed(t),a=local(t,f.path),old=a.finish().publication;legacy(a,old.generation.id);
  const m=a.step('verification');
  assert.ok(m.canonicalRows>0,'unmarked certificate must trigger canonical rebuild instead of noop');
  assert.equal(a.observed().dto.lexical.state,'ready','legacy reads stay ready during replacement');
  assert.equal(a.observed().publication.publicationId,old.publicationId);
  assert.equal(a.rank(old).matched,4,'legacy lexical reads stay available');
  const result=a.finish();
  assert.notEqual(result.publication.generation.id,old.generation.id);
  assert.equal(JSON.parse(generation(a,result.publication.generation.id).verify).byteSafe,1);
  await equivalent(t,a,result,'marked upgrade');
});

test('F4 legacy aliasing certificate serves until canonical repair permits marked publication',async t=>{
  const seeded=seed(t),{f}=seeded,replacementId=String.fromCodePoint(0xfffd);unicode(f.path,seeded,[replacementId,'safe-second']);
  const a=local(t,f.path),old=a.finish().publication;legacy(a,old.generation.id);
  // Recreate the canonical state behind B0's collapsed certificate without
  // changing its fences: the malformed ID and U+FFFD decode to one JS identity.
  sql(f.path,db=>{
    const columns=db.prepare('PRAGMA table_info(memories)').all().map(c=>c.name);
    const value=c=>c==='id'?"CAST(X'80' AS TEXT)":c==='content'?"'aliasuniqueterm'":c==='fingerprint'?"fingerprint||'-alias'":quote(c);
    db.prepare(`INSERT INTO memories(${columns.map(quote)}) SELECT ${columns.map(value)} FROM memories WHERE id=?`).run(replacementId);
  });
  assert.equal(a.observed().dto.lexical.state,'ready');
  assert.throws(()=>a.step(),e=>e.code==='index_unavailable'&&e.reason==='corrupt','legacy aliasing certificate must not bypass byte-safe scanning');
  assert.equal(a.observed().dto.lexical.state,'ready','legacy reads survive refusal of invalid canonical IDs');
  assert.equal(a.observed().publication.publicationId,old.publicationId);assert.ok(a.rank(old).matched>0);
  // Repair the synthetic raw ID at the same fence to isolate upgrade behavior.
  sql(f.path,db=>db.exec("UPDATE memories SET id='repaired-alias' WHERE hex(CAST(id AS BLOB))='80'"));
  const result=a.finish();await equivalent(t,a,result,'repaired marked upgrade');
  ownTerms(a,result.publication,'marked upgrade indexes every repaired canonical body');
  assert.equal(JSON.parse(generation(a,result.publication.generation.id).verify).byteSafe,1);
});

test('F4 unmarked in-verification work starts a new generation',t=>{
  const {f}=seed(t),a=local(t,f.path),old=a.prepare().g;legacy(a,old.id);
  const result=a.finish();
  assert.notEqual(result.publication.generation.id,old.id,'unmarked verification work must restart');
  assert.equal(JSON.parse(generation(a,result.publication.generation.id).verify).byteSafe,1);
  assert.equal(result.totals.tokenized,4);
});

test('F4 unmarked base contributions are never copied',t=>{
  const {f}=seed(t),a=local(t,f.path),old=a.finish().publication;legacy(a,old.generation.id);bump(f.path);
  const result=a.finish();
  assert.equal(result.totals.copied,0,'unmarked base must not supply copied contributions');
  assert.equal(result.totals.tokenized,4);
  assert.equal(generation(a,result.publication.generation.id).base_id,null);
});

for(const encoding of ['UTF-16le','UTF-16be'])test(`F5 ${encoding} native binding cannot certify an alias body`,t=>{
  const f=fixture(t),rows=['appleuniqueterm','bananauniqueterm','cherryuniqueterm'].map(text=>f.admit(text,four[0]));
  const path=join(f.workspace.path,'native-binding.sqlite');reencode(f.path,path,encoding);
  const raw=encoding==='UTF-16le'?['7800FDFF','7800FEFF','7A00']:['0078FFFD','0078FFFE','007A'];
  sql(path,db=>{
    const tables=db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    for(const [i,row] of rows.entries()) {
      db.prepare(`UPDATE memories SET id=CAST(X'${raw[i]}' AS TEXT) WHERE id=?`).run(row.id);
      for(const {name} of tables)if(db.prepare(`PRAGMA table_info(${quote(name)})`).all().some(c=>c.name==='memory_id'))
        db.prepare(`UPDATE ${quote(name)} SET memory_id=CAST(X'${raw[i]}' AS TEXT) WHERE memory_id=?`).run(row.id);
    }
  });
  const a=local(t,path);a.p.types=['memory'];let result;
  try {result=a.finish();}catch(e){assert.equal(e.code,'index_unavailable');assert.equal(e.reason,'corrupt');}
  if(!result){
    assert.notEqual(a.observed().dto.lexical.state,'ready','native binding mismatch cannot certify');
    sql(path,db=>{
      db.prepare("UPDATE memories SET id='repaired-special' WHERE hex(CAST(id AS BLOB))=?").run(raw[1]);
      for(const {name} of db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all())
        if(db.prepare(`PRAGMA table_info(${quote(name)})`).all().some(c=>c.name==='memory_id'))
          db.prepare(`UPDATE ${quote(name)} SET memory_id='repaired-special' WHERE hex(CAST(memory_id AS BLOB))=?`).run(raw[1]);
    });
    result=a.finish();
  }
  ownTerms(a,result.publication,'every certified document indexes its own canonical body');
  assert.deepEqual(documentSet(a,result.publication),canonicalSet(path),'binding-safe publication covers canonical documents');
});

test('F4 maintenance reports replacement work while legacy channels remain ready',async t=>{
  const {f}=seed(t),a=local(t,f.path),old=a.finish().publication;legacy(a,old.generation.id);a.closeStorage();
  const service=configured(t,f.path,four,{service:true}),h=await service.open();
  const result=ok(await h.refreshContextIndex({readSet:four,types:['memory','card'],intent:'current',mode:'lexical',
    budget:{maxItems:1,maxMs:5000}},service.token));
  assert.equal(result.status,'rebuilding','legacy availability must not report upgrade maintenance complete');
  assert.equal(result.channels.lexical.state,'ready');
  assert.equal(ok(await h.getContextIndexStatus({readSet:four,types:['memory','card'],intent:'current',deadlineMs:5000},service.token)).lexical.state,'ready');
});

for(const encoding of ['UTF-16le','UTF-16be'])test(`F5 UTF-8 canonical / ${encoding} cache preserves stored identity`,t=>{
  const f=fixture(t,{cards:true}),memory=f.admit('cacheuniqueterm',four[0]),special='x'+String.fromCodePoint(0xfffe);
  unicode(f.path,{memories:[memory],cards:[]},[special]);const a=local(t,f.path);a.p.types=['memory'];
  a.step('opened');a.closeStorage();
  const target=f.path+PRODUCT_SIDECAR_SUFFIX,converted=target+'-converted';reencode(target,converted,encoding);renameSync(converted,target);a.reopen();
  let result;
  try {result=a.finish();}catch(e){assert.equal(e.code,'index_unavailable');assert.equal(e.reason,'corrupt');}
  if(!result){
    assert.notEqual(a.observed().dto.lexical.state,'ready');
    sql(f.path,db=>{
      db.prepare("UPDATE memories SET id='safe-cache-id' WHERE id COLLATE BINARY=?").run(special);
      for(const {name} of db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all())
        if(db.prepare(`PRAGMA table_info(${quote(name)})`).all().some(c=>c.name==='memory_id'))
          db.prepare(`UPDATE ${quote(name)} SET memory_id='safe-cache-id' WHERE memory_id COLLATE BINARY=?`).run(special);
    });
    result=a.finish();
  }
  assert.deepEqual(documentSet(a,result.publication),canonicalSet(f.path),'cache binding must preserve canonical document identity');
  ownTerms(a,result.publication,'cache publication indexes its own canonical body');
});

function statementCounter() {
  const counts={roundTrips:0,readBacks:0,encodings:0};
  return {counts,database(native){return new Proxy(native,{get(target,key){
    if(key==='prepare')return query=>{
      const statement=target.prepare(query);
      return new Proxy(statement,{get(stmt,method){const value=Reflect.get(stmt,method,stmt);
        if(typeof value!=='function')return value;
        return (...args)=>{
          if(['get','all','run'].includes(method)){
            if(/^SELECT hex\(CAST\(id AS BLOB\)\) AS bytes FROM /.test(query))counts.roundTrips++;
            if(query==='SELECT id,identity FROM documents WHERE generation=? AND doc=?')counts.readBacks++;
            if(query==='PRAGMA encoding')counts.encodings++;
          }
          return value.apply(stmt,args);
        };
      }});
    };
    const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
  }});}};
}

test('G1 UTF-8 unchanged retarget avoids per-row native identity checks',t=>{
  const {f}=seed(t),observer=statementCounter(),a=local(t,f.path,'DELETE',observer);
  a.finish();const buildReadBacks=observer.counts.readBacks;
  bump(f.path);a.prepare();bump(f.path);
  observer.counts.roundTrips=0;observer.counts.readBacks=0;
  const totals={};let maximumEncodings=0;
  for(let i=0;i<100;i++){
    const before=observer.counts.encodings,m=a.step('verification');
    maximumEncodings=Math.max(maximumEncodings,observer.counts.encodings-before);
    for(const [k,v] of Object.entries(m))totals[k]=(totals[k]??0)+v;
    if(a.state().phase>=20)break;
  }
  assert.equal(observer.counts.roundTrips,0,'UTF-8 unchanged retarget issues no per-row ID round-trip statements');
  assert.equal(buildReadBacks,0,'UTF-8 inserts issue no native ID read-back statements');
  assert.equal(observer.counts.readBacks,0);
  assert.equal(maximumEncodings,2,'each refresh reads each connection encoding once');
  assert.equal(totals.reused,4);assert.equal(totals.retargets,1);assert.equal(totals.tokenized,0);
});

test('G2 independent Card body oracle detects swaps with unchanged membership',t=>{
  const {f,cards}=seed(t),a=local(t,f.path),result=a.finish(),before=documentSet(a,result.publication);
  ownTerms(a,result.publication,'each eligible Card indexes its own canonical title and body');
  sql(f.path,db=>{
    const [first,second]=cards.map(c=>db.prepare('SELECT body FROM private_cards WHERE id=?').get(c.id).body);
    db.prepare('UPDATE private_cards SET body=? WHERE id=?').run(second,cards[0].id);
    db.prepare('UPDATE private_cards SET body=? WHERE id=?').run(first,cards[1].id);
  });
  assert.deepEqual(documentSet(a,result.publication),before);
  assert.throws(()=>ownTerms(a,result.publication,'each eligible Card indexes its own canonical title and body'),
    e=>e.code==='ERR_ASSERTION'&&e.message.startsWith('each eligible Card indexes its own canonical title and body'),
    'Card body oracle must detect a swap with unchanged membership');
});
