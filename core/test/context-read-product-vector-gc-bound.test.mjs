import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fixture, ns, ok, receipt, readTransaction } from '../testing/context-read-fixture.mjs';
import { card, descriptor } from '../testing/context-product-owner-fixture.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { productSidecar, PRODUCT_SIDECAR_SUFFIX } from '../context-product-sidecar.mjs';
import { createProductSqlitePolicy } from '../context-product-sqlite.mjs';
import { productVectors } from '../context-product-vectors.mjs';
import { accessDigest, digest, signedRecord } from '../context-product-validation.mjs';
import { HOSTED_ID } from '../context-semantic-input.mjs';

const snapshot = { identity: { provider:'openai',model:'text-embedding-3-small',id:HOSTED_ID,
  revision:'provider-unversioned',dimensions:1536,normalization:'l2' },policy:{purgeEpoch:0} };
const budget = { maxItems:1024,maxMs:1000 };
const quantum = { admit:()=>true,measure:work=>work() };
const sortKey = parts => Buffer.concat(parts.map(part=>Buffer.from(part+'\0')));
const identity = (namespace,type,key) => [namespace.ownerId,namespace.scope,namespace.projectId??'',type,key];
const lane = (readSet=[ns],intent='current',types=['memory']) => ({ readSet, intent, types, ownerCoverage:descriptor(readSet) });
const access = p => accessDigest({ ownerId:p.readSet[0].ownerId,namespaces:{readSet:p.readSet} });
const target = (row,namespace=ns) => ({ namespace,memoryId:row.id,expectedRevision:row.revision });
const nextVersion = (f,row) => ok(f.core.supersede({ ...target(row),replacement:{content:'replacement '+row.id,kind:'fact'},
  receipts:[receipt('replacement-'+row.id)] })).previous;
const forget = (f,row,namespace) => ok(f.core.forget(target(row,namespace)));
const correct = (f,row) => ok(f.core.correct({ ...target(row),content:'corrected specimen',kind:'fact',receipt:receipt('corrected') }));
function inspect(path,work) {
  const db=new DatabaseSync(path+PRODUCT_SIDECAR_SUFFIX,{readOnly:true});
  try { return readTransaction(db,()=>work(db)); } finally { db.close(); }
}
function inventory(path) {
  return inspect(path,db=>({
    cache:db.prepare('SELECT owner,generation,doc,identity,epoch,item,revision,body_revision,representation FROM semantic_vectors ORDER BY owner,item,revision,body_revision,generation,doc,identity,epoch').all(),
    vectors:db.prepare('SELECT g.owner,r.generation,r.doc,r.item,r.revision,r.body_revision,r.representation,r.vector IS NULL AS empty FROM vector_rows r JOIN vector_generations g ON g.storage_id=r.generation ORDER BY g.owner,r.item,r.revision,r.body_revision,r.generation,r.doc').all()
  }));
}
const entry = (rows,namespace,type,row) => rows.filter(r=>r.item===JSON.stringify(identity(namespace,type,row.id))&&r.revision===row.revision);
function workState(path,projection) {
  return inspect(path,db=>{
    const g=db.prepare('SELECT g.id, g.verify, g.phase, g.checkpoint FROM work w JOIN generations g ON g.id=w.generation WHERE w.projection=?').get(projection);
    return g&&{...g,verify:JSON.parse(g.verify)};
  });
}
function local(path,mode,hook) {
  let clock=0;
  const sqlite=createProductSqlitePolicy();sqlite.start(Infinity);
  const facade=openContextProductFacade(path,{sqlite});
  const storage=productSidecar({path,db:facade.port.db,identity:facade.port.identity,features:facade.port.features,sqlite,
    sidecarJournalMode:mode,writable:true,now:()=>clock,rendezvous(point){hook?.(point,()=>{clock=900;});}});
  const vectors=productVectors({storage,facade});
  const observe=p=>facade.port.read(()=>storage.observe(p,access(p)));
  function step(p) { clock=0;return storage.refresh(p,access(p),budget); }
  function ready(p) {
    for(let i=0;i<20;i++){step(p);const r=observe(p);if(r.dto.lexical.state==='ready')return r.publication;}
    assert.fail('lexical publication did not converge');
  }
  function embed(p,lexical,selected=snapshot) {
    const rows=vectors.plan(p,lexical,selected,1024,quantum),vector=new Float32Array(1536);vector[0]=1;
    if(rows.length)vectors.put(p,lexical,selected,rows,rows.map(()=>vector));
    assert.equal(vectors.certify(p,lexical,selected,quantum),true);
  }
  return { storage,vectors,observe,step,ready,embed,
    signProgress:record=>signedRecord(facade.port.identity.cursorSecret,'progress',record),close(){storage.close();facade.close();} };
}
function seedPages(engine,lexical,old) {
  return engine.storage.vectors(db=>{
    const cache=db.prepare('SELECT * FROM semantic_vectors WHERE item=?').get(JSON.stringify(identity(ns,'memory',old.id)));
    const cacheInsert=db.prepare('INSERT INTO semantic_vectors VALUES(?,?,?,?,?,?,?,?,?,?,?)');
    for(let epoch=1;epoch<=280;epoch++)cacheInsert.run(cache.generation,cache.doc,cache.owner,cache.identity,epoch,
      cache.item,cache.revision,cache.body_revision,cache.representation,cache.vector,cache.sort_key);
    const source=db.prepare('SELECT g.* FROM vector_publications p JOIN vector_generations g ON g.storage_id=p.generation WHERE p.projection=?').get(lexical.projectionDigest);
    const generation=db.prepare('INSERT INTO vector_generations(id,lexical_generation,owner,projection,identity,epoch,lexical,state,published) VALUES(?,?,?,?,?,?,?,?,0)');
    const staging=generation.run(randomUUID(),source.lexical_generation,source.owner,source.projection,source.identity,source.epoch,source.lexical,source.state).lastInsertRowid;
    const row=db.prepare('INSERT INTO vector_rows VALUES(?,?,?,?,?,?,NULL,?)');
    const absent=[];
    for(let i=1;i<=280;i++) {
      const parts=identity(ns,'memory','missing-'+i);
      absent.push(JSON.stringify(parts));
      row.run(staging,i,JSON.stringify(parts),1,0,lexical.representation,sortKey(parts));
    }
    for(let i=0;i<128;i++)generation.run(randomUUID(),source.lexical_generation,source.owner,source.projection,source.identity,source.epoch,source.lexical,source.state);
    return {staging,absent,source};
  },true);
}

for(const mode of ['DELETE','WAL'])test('owner sweep bounds work and deletes only obsolete versions before lexical collection in '+mode,t=>{
  const f=fixture(t,{cards:true}),other={...ns,projectId:'outside'},foreign={...ns,ownerId:'synthetic-foreign'};
  const forgotten=f.admit('obsolete orchard'),edited=f.admit('old orchard'),superseded=f.admit('former orchard');
  const historical=nextVersion(f,f.admit('historical orchard')),otherItem=f.admit('other intent orchard',other);
  const foreignItem=f.admit('foreign orchard',foreign),terminal=card(f,ns,'card orchard','card inventory');
  const p=lane([ns],'current',['memory','card']),history=lane([ns],'history'),outside=lane([other],'current'),separate=lane([foreign]);
  let watching=false,slices=0,previous,finishSweep=false;
  let lexical,seed;
  const engine=local(f.path,mode,(point,stop)=>{
    if(!watching)return;
    if(point==='sweep-committed'){
      const now=inventory(f.path);slices++;
      const removedCache=previous.cache.length-now.cache.length,removedVectors=previous.vectors.length-now.vectors.length;
      assert.ok(removedCache>=0&&removedVectors>=0&&removedCache+removedVectors<=128);
      assert.ok(removedCache===0||removedVectors===0);
      previous=now;
      if(finishSweep&&workState(f.path,lexical.projectionDigest).verify.sweep.done)stop();
    }
    assert.ok(!['gc','scan','item','verification','published'].includes(point),point);
  });
  f.workspace.defer(()=>engine.close());
  for(const projection of [history,outside,separate])engine.embed(projection,engine.ready(projection));
  lexical=engine.ready(p);engine.embed(p,lexical);
  seed=seedPages(engine,lexical,forgotten);
  const postings=()=>inspect(f.path,db=>db.prepare('SELECT count(*) AS n FROM postings WHERE generation=?').get(seed.source.lexical_generation).n);
  const beforePostings=postings();assert.ok(beforePostings>0);
  const stale={...snapshot,policy:{purgeEpoch:999}};
  const putRows=engine.vectors.plan(p,lexical,stale,1,quantum);
  assert.equal(putRows.length,1);
  let staged=0;
  const oneRow={admit:()=>staged===0,measure(work,kind){const result=work();if(kind==='vector-verification')staged++;return result;}};
  assert.equal(engine.vectors.certify(p,lexical,stale,oneRow),false);
  const stagingWork=inspect(f.path,db=>db.prepare('SELECT generation FROM vector_work WHERE projection=?').get(lexical.projectionDigest).generation);
  forget(f,forgotten);correct(f,edited);nextVersion(f,superseded);
  ok(f.call('deleteKnowledgeCard',{namespace:ns,cardId:terminal.id,expectedRevision:terminal.revision,actionId:'terminal'}));
  const before=inventory(f.path);previous=before;
  assert.equal(engine.observe(outside).dto.lexical.state,'ready');
  assert.equal(engine.observe(p).dto.lexical.state,'stale');
  watching=true;engine.step(p);const firstPassSlices=slices;
  assert.equal(firstPassSlices,128);
  assert.equal(postings(),beforePostings);
  assert.equal(workState(f.path,lexical.projectionDigest).verify.sweep.done,false);
  assert.notEqual(engine.observe(p).dto.lexical.state,'ready');
  finishSweep=true;engine.step(p);watching=false;
  assert.ok(slices>firstPassSlices&&slices<=256);
  assert.equal(workState(f.path,lexical.projectionDigest).verify.sweep.done,true);
  assert.notEqual(engine.observe(p).dto.lexical.state,'ready');
  assert.equal(postings(),beforePostings);
  const after=inventory(f.path);
  for(const name of ['cache','vectors']) {
    for(const obsolete of [forgotten,edited,superseded]) {
      assert.ok(entry(before[name],ns,'memory',obsolete).length>0);
      assert.deepEqual(entry(after[name],ns,'memory',obsolete),[]);
    }
    assert.ok(entry(before[name],ns,'card',terminal).length>0);
    assert.deepEqual(entry(after[name],ns,'card',terminal),[]);
    for(const [namespace,row] of [[ns,historical],[other,otherItem],[foreign,foreignItem]]) {
      const original=entry(before[name],namespace,'memory',row);
      assert.ok(original.length>0);assert.deepEqual(entry(after[name],namespace,'memory',row),original);
    }
    const removed=new Set([...seed.absent,...[forgotten,edited,superseded].map(row=>JSON.stringify(identity(ns,'memory',row.id))),
      JSON.stringify(identity(ns,'card',terminal.id))]);
    assert.deepEqual(after[name],before[name].filter(row=>!removed.has(row.item)));
  }
  assert.equal(after.vectors.filter(r=>r.generation===seed.staging).length,0);
  assert.equal(inspect(f.path,db=>db.prepare('SELECT count(*) AS n FROM vector_publications WHERE generation=?').get(seed.source.storage_id).n),0);
  assert.equal(inspect(f.path,db=>db.prepare('SELECT count(*) AS n FROM vector_work WHERE generation=?').get(stagingWork).n),0);
  assert.throws(()=>engine.vectors.put(p,lexical,stale,putRows,[new Float32Array(1536)]),{code:'index_unavailable'});
  assert.throws(()=>engine.vectors.certify(p,lexical,stale,quantum),{code:'index_unavailable'});
  assert.deepEqual(inventory(f.path),after);
  engine.ready(p);
  assert.equal(engine.observe(p).dto.lexical.state,'ready');
});

for(const mode of ['DELETE','WAL'])test('retarget and an owner mutation restart the signed sweep in '+mode,t=>{
  const f=fixture(t,{coreOptions:{contentSafety:'s2h-v1'}}),other={...ns,projectId:'first'};
  const later=f.admit('early position',other),first=f.admit('first target'),edit=f.admit('edit target');
  const p=lane(),q=lane([other],'history');
  let stopPoint;
  const engine=local(f.path,mode,(point,stop)=>{if(point===stopPoint)stop();});f.workspace.defer(()=>engine.close());
  engine.embed(q,engine.ready(q));const old=engine.ready(p);engine.embed(p,old);
  forget(f,first);
  stopPoint='sweep-committed';engine.step(p);
  const original=workState(f.path,old.projectionDigest);
  assert.equal(original.verify.sweep.done,false);
  assert.deepEqual(entry(inventory(f.path).cache,ns,'memory',first),[]);
  const beforeSecond=inventory(f.path);
  for(const rows of Object.values(beforeSecond))assert.equal(entry(rows,other,'memory',later).length,1);
  forget(f,later,other);
  engine.step(p);
  const replay=workState(f.path,old.projectionDigest);
  assert.equal(replay.id,original.id);
  assert.notEqual(replay.verify.sweep.binding,original.verify.sweep.binding);
  assert.deepEqual(entry(inventory(f.path).cache,other,'memory',later),[]);
  correct(f,edit);
  assert.equal(engine.step(p).retargets,1);
  const retarget=workState(f.path,old.projectionDigest);
  assert.equal(retarget.id,original.id);
  assert.notEqual(retarget.verify.sweep.binding,replay.verify.sweep.binding);
  assert.equal(retarget.verify.sweep.done,false);
  assert.notEqual(engine.observe(p).dto.lexical.state,'ready');
  stopPoint=null;engine.ready(p);
  for(const rows of Object.values(inventory(f.path))) {
    assert.deepEqual(entry(rows,other,'memory',later),[]);
    assert.deepEqual(entry(rows,ns,'memory',edit),[]);
  }
});

test('authenticated work from before the sweep must finish cleanup before publication',t=>{
  const f=fixture(t),old=f.admit('obsolete orchard'),p=lane();
  f.admit('retained orchard');
  let stopPoint;
  const pause=Error('pause before publishing');
  const engine=local(f.path,'DELETE',(point,stop)=>{
    if(point!==stopPoint)return;
    if(point==='precommit')throw pause;
    stop();
  });
  f.workspace.defer(()=>engine.close());
  const oldLexical=engine.ready(p),item=JSON.stringify(identity(ns,'memory',old.id));
  engine.embed(p,oldLexical);
  const oldCache=inspect(f.path,db=>db.prepare(`SELECT generation,doc,owner,identity,epoch,item,revision,body_revision,representation,
    hex(vector) AS vector,hex(sort_key) AS sort_key FROM semantic_vectors WHERE item=?`).get(item));
  forget(f,old);
  stopPoint='precommit';
  assert.throws(()=>engine.step(p),error=>error===pause);
  engine.storage.vectors(db=>{
    const g=db.prepare('SELECT g.*,r.record FROM work w JOIN generations g ON g.id=w.generation JOIN progress_records r ON r.generation=g.id').get();
    const verify=JSON.parse(g.verify);
    assert.equal(verify.phase,3);
    delete verify.sweep;
    const incarnation=digest({seed:g.seed,id:g.id,projection:g.projection,sequence:g.sequence,baseSequence:g.base_sequence,kind:g.kind,
      access:g.access,fences:JSON.parse(g.fences),phase:g.phase,lastKey:g.last_key,verify});
    const {mac,...record}=JSON.parse(g.record);
    record.generation.incarnation=incarnation;
    db.prepare('UPDATE generations SET verify=?,incarnation=? WHERE id=?').run(JSON.stringify(verify),incarnation,g.id);
    db.prepare('UPDATE progress_records SET record=? WHERE generation=?').run(engine.signProgress(record),g.id);
    const r=oldCache;
    db.prepare('INSERT INTO semantic_vectors VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(r.generation,r.doc,r.owner,r.identity,r.epoch,
      r.item,r.revision,r.body_revision,r.representation,Buffer.from(r.vector,'hex'),Buffer.from(r.sort_key,'hex'));
  },true);
  stopPoint='sweep-committed';engine.step(p);
  const pending=workState(f.path,oldLexical.projectionDigest);
  assert.equal(pending.verify.phase,3);
  assert.equal(pending.verify.sweep.done,false);
  assert.deepEqual(entry(inventory(f.path).cache,ns,'memory',old),[]);
  assert.notEqual(engine.observe(p).dto.lexical.state,'ready');
  stopPoint=null;engine.ready(p);
});

const crashSource = `
import { productSidecar } from ${JSON.stringify(new URL('../context-product-sidecar.mjs',import.meta.url).href)};
import { openContextProductFacade } from ${JSON.stringify(new URL('../context-read-facade.mjs',import.meta.url).href)};
import { createProductSqlitePolicy } from ${JSON.stringify(new URL('../context-product-sqlite.mjs',import.meta.url).href)};
const [path,mode,stop,encoded,access]=process.argv.slice(1);
const sqlite=createProductSqlitePolicy();sqlite.start(Infinity);
const facade=openContextProductFacade(path,{sqlite});
const storage=productSidecar({path,db:facade.port.db,identity:facade.port.identity,features:facade.port.features,
  sqlite,writable:true,sidecarJournalMode:mode,rendezvous(point){if(point===stop)process.kill(process.pid,'SIGKILL');}});
storage.admit(Infinity);
storage.refresh(JSON.parse(encoded),access,{maxItems:1024,maxMs:5000},true);
process.exitCode=1;
`;
for(const mode of ['DELETE','WAL'])for(const [stage,point] of [['before','sweep-before-commit'],['after','sweep-committed']])
test('reopen through admission after process death '+stage+' sweep commit in '+mode,t=>{
  const f=fixture(t),old=f.admit('forgotten orchard'),survivor=f.admit('retained orchard'),p=lane();
  const engine=local(f.path,mode),lexical=engine.ready(p);engine.embed(p,lexical);engine.close();
  const before=inventory(f.path);
  forget(f,old);
  const child=spawnSync(process.execPath,['--input-type=module','-e',crashSource,f.path,mode,point,JSON.stringify(p),access(p)],
    {encoding:'utf8',timeout:30000});
  assert.equal(child.error,undefined,child.stderr);assert.equal(child.signal,'SIGKILL',child.stderr);
  const next=local(f.path,mode);f.workspace.defer(()=>next.close());
  next.storage.admit(Infinity);
  const after=inventory(f.path),saved=workState(f.path,lexical.projectionDigest);
  assert.equal(saved.verify.sweep.done,false);
  assert.equal(saved.checkpoint,stage==='before'?0:1);
  assert.deepEqual(after.vectors,before.vectors);
  assert.deepEqual(after.cache,stage==='before'?before.cache:before.cache.filter(r=>r.item!==JSON.stringify(identity(ns,'memory',old.id))));
  next.ready(p);
  const final=inventory(f.path);
  for(const rows of Object.values(final))assert.deepEqual(entry(rows,ns,'memory',old),[]);
  assert.equal(entry(final.cache,ns,'memory',survivor).length,1);
});
