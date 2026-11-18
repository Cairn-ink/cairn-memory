import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fixture, ns, ok, receipt, readTransaction } from '../testing/context-read-fixture.mjs';
import { descriptor } from '../testing/context-product-owner-fixture.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { canonicalProductFences, productSidecar, PRODUCT_SIDECAR_SUFFIX } from '../context-product-sidecar.mjs';
import { createProductSqlitePolicy } from '../context-product-sqlite.mjs';
import { productVectors } from '../context-product-vectors.mjs';
import { accessDigest, canonicalJson, digest } from '../context-product-validation.mjs';
import { HOSTED_ID } from '../context-semantic-input.mjs';
import { PRODUCT_PROFILE, credentialDigest } from '../context-product-control.mjs';
import { provisionSemanticOwner } from '../context-semantic-ledger.mjs';
import { createExclusiveSqliteFile } from '../sqlite-journal-probe.mjs';
import { createContextReadSupervisor, openContextIndexMaintainer, openContextProductReader, openContextSemanticCoordinator, openMemoryCore } from '../index.mjs';

const projection={readSet:[ns],types:['memory'],intent:'current'};
const budget={maxItems:1024,maxMs:5000};
const hostUrl=new URL('../testing/context-semantic-host.mjs',import.meta.url).href;
const identity={provider:'openai',model:'text-embedding-3-small',id:HOSTED_ID,revision:'provider-unversioned',dimensions:1536,normalization:'l2'};
const p={...projection,ownerCoverage:descriptor([ns])};
const access=accessDigest({ownerId:ns.ownerId,namespaces:{readSet:[ns]}});
const snapshot={identity,policy:{purgeEpoch:0}};
const quantum={admit:()=>true,measure:work=>work()};
const target=row=>({namespace:ns,memoryId:row.id,expectedRevision:row.revision});
function sqlite(path,read) {
  const db=new DatabaseSync(path+PRODUCT_SIDECAR_SUFFIX,{readOnly:true});
  try{return readTransaction(db,()=>read(db));}finally{db.close();}
}
function physical(path,projection,retired) {
  return sqlite(path,db=>{
    const lexical=db.prepare('SELECT g.storage_id,g.manifest,p.publication FROM publications p JOIN generations g ON g.id=p.generation WHERE p.projection=?').get(projection);
    const vector=db.prepare('SELECT p.generation,r.record FROM vector_publications p JOIN vector_validation_records r ON r.generation=p.generation WHERE p.projection=?').get(projection);
    const detached=retired??lexical.storage_id;
    return {lexical,vector,
      retiredLexical:db.prepare('SELECT count(*) AS n FROM generations WHERE storage_id=?').get(detached).n,
      retiredPostings:db.prepare('SELECT count(*) AS n FROM postings WHERE generation=?').get(detached).n,
      retiredVectors:db.prepare('SELECT count(*) AS n FROM vector_rows r JOIN vector_generations g ON g.storage_id=r.generation WHERE g.lexical_generation=?').get(detached).n,
      retiredCache:db.prepare('SELECT count(*) AS n FROM semantic_vectors WHERE generation=?').get(detached).n};
  });
}
function local(path,mode,work,onPoint=()=>{},observer) {
  let clock=0,stopAt;
  const sqlite=createProductSqlitePolicy({observer});sqlite.start(Infinity);
  const facade=openContextProductFacade(path,{sqlite});
  const storage=productSidecar({path,db:facade.port.db,identity:facade.port.identity,features:facade.port.features,
    writable:true,sqlite,sidecarJournalMode:mode,now:()=>clock,rendezvous(point){
      if(point===stopAt)clock=4800;
      onPoint(point);
    }});
  try {
    storage.admit(Infinity);
    const vectors=productVectors({storage,facade});
    const current=()=>facade.port.read(()=>storage.observe(p,access)).publication;
    const step=(stop)=>{clock=0;stopAt=stop;return storage.refresh(p,access,budget,true);};
    return work({storage,vectors,current,step});
  }finally{storage.close();facade.close();}
}
function replace(path,mode) {
  return local(path,mode,({current,step})=>{
    for(let i=0;i<20;i++){step('published');const publication=current();if(publication)return publication;}
    assert.fail('replacement did not publish');
  });
}
function drain(path,mode,projection,retired) {
  local(path,mode,({step})=>{
    for(let i=0;i<20;i++){if(!physical(path,projection,retired).retiredLexical)return;step();}
    assert.fail('retired generation was not collected');
  });
}
async function setup(t,mode,corpus) {
  if(!globalThis[Symbol.for('context-read-product-p2e-v1/coordinators')]?.size)
    globalThis[Symbol.for('context-read-product-p2e-v1/physical-policy')]?.clear();
  const f=fixture(t),memories=corpus.map(text=>f.admit(text));
  f.core.close();
  const supervisor=createContextReadSupervisor();
  f.workspace.defer(()=>supervisor.close());
  const state=new SharedArrayBuffer(64),counts=new Int32Array(state);counts[0]=1;
  const anchorPath=join(f.workspace.path,'authority.sqlite'),ledgerPath=join(f.workspace.path,'ledger.sqlite');
  const ledgerIdentity={accountingDomainId:'synthetic-accounting',ledgerId:'synthetic-ledger'};
  createExclusiveSqliteFile(anchorPath);
  const anchors=new DatabaseSync(anchorPath);
  try {
    anchors.exec('CREATE TABLE anchors(owner TEXT PRIMARY KEY,anchor TEXT NOT NULL) STRICT');
    await provisionSemanticOwner({path:ledgerPath,identity:ledgerIdentity,ownerId:ns.ownerId,
      deadlineAt:Number(process.hrtime.bigint())/1e6+5000,enrollment:{authorizeNeverBound:()=>true,
        createIfNeverBound(anchor){return anchors.prepare('INSERT OR IGNORE INTO anchors VALUES(?,?)').run(ns.ownerId,canonicalJson(anchor)).changes===1;}}});
  }finally{anchors.close();}
  const token={opaque:randomUUID()},semanticServiceBinding={kind:'semantic-service',serviceId:randomUUID(),
    credentialBindingId:randomUUID(),credentialExpiresUtcMs:null,credentialDigest:credentialDigest(token),
    ownerId:ns.ownerId,scope:'owner',issuedAt:0,...ledgerIdentity,ledgerEpoch:1,bindingRevision:1,
    methods:['setOwnerSemantic','getOwnerSemanticStatus','validateOwnerSemanticCoverage','purgeOwnerVectors']};
  const now=Date.now(),priceTable={authorityId:'synthetic-price',revision:'one',sequence:1,effectiveFromUtcMs:now-1000,
    effectiveUntilUtcMs:now+3600000,usdPerMillionInputTokens:{'text-embedding-3-small':'0.02'}};
  const coordinator=await openContextSemanticCoordinator({version:'context-read-product-p2e-v1',supervisor,ledgerPath,ledgerIdentity,
    provider:{provider:identity.provider,model:identity.model,dimensions:identity.dimensions,normalization:identity.normalization,
      requestTimeoutMs:3000,maxBatchDocuments:64},
    refreshCaps:{steady:{maxItemsPerUtcDay:2000,maxUsdPerUtcDay:'0.05'},backfill:{maxItemsPerUtcDay:20000,maxUsdPerUtcDay:'0.50',maxUsdTotal:'5'}},
    backfillTargets:[{canonicalPath:f.path,readSet:[ns],types:['memory'],intents:['current','history']}],priceTable,
    host:{moduleUrl:hostUrl,configuration:{semanticServiceBinding,anchorPath,state,priceTable}}});
  f.workspace.defer(()=>coordinator.close());
  ok(await coordinator.setOwnerSemantic({ownerId:ns.ownerId,semantic:true,expectedRevision:0},token));
  const config=service=>{
    const token={opaque:randomUUID()},credentialBindingId=randomUUID(),credentialExpiresUtcMs=null;
    const requestControl={requestId:randomUUID(),handleId:randomUUID(),credentialBindingId,credentialExpiresUtcMs};
    const binding={kind:service?'service':'request',...(service?{serviceId:randomUUID(),credentialBindingId,credentialExpiresUtcMs}:requestControl),
      credentialDigest:credentialDigest(token),ownerId:ns.ownerId,namespaces:{readSet:p.readSet,ownerCoverage:p.ownerCoverage},issuedAt:0};
    const options={supervisor,path:f.path,version:'context-read-v1',profile:PRODUCT_PROFILE,readSet:p.readSet,ownerCoverage:p.ownerCoverage,
      wal:mode==='WAL',diagnostics:true,...(service?{sidecarJournalMode:mode}:{requestControl:{...requestControl,requestMaxMs:5000}}),
      semanticConfig:{version:'context-read-product-p2e-v1',coordinator,...(!service&&{queryEmbeddingMaxMs:3000,finalizeReserveMs:1000})},
      host:{moduleUrl:hostUrl,configuration:{
        [service?'serviceBinding':'requestBinding']:binding,state,...(!service&&{requestReservation:new SharedArrayBuffer(4)})}}};
    return {token,async open(){
      const handle=await (service?openContextIndexMaintainer:openContextProductReader)(options);
      f.workspace.defer(()=>handle.close());return handle;
    }};
  };
  const service=config(true);
  const maintainer=await service.open();
  const refresh=async(mode,intent='current')=>{
    for(let i=0;i<20;i++){
      const value=ok(await maintainer.refreshContextIndex({...projection,intent,mode,budget:{...budget,...(mode==='embeddings'&&{maxUsd:'0.50'})}},service.token));
      if(value.status==='complete')return;
    }
    assert.fail(mode+' did not complete');
  };
  for(const intent of ['current','history']){await refresh('lexical',intent);await refresh('embeddings',intent);}
  const status=ok(await coordinator.getOwnerSemanticStatus({ownerId:ns.ownerId},token));
  const validated=ok(await coordinator.validateOwnerSemanticCoverage({ownerId:ns.ownerId,
    expectedTargetDigest:status.firstCoverage.targetSetDigest,budget:{maxTargets:64,maxMs:5000}},token));
  assert.equal(validated.status,'complete');
  assert.equal(ok(await coordinator.getOwnerSemanticStatus({ownerId:ns.ownerId},token)).refresh.phase,'steady');
  return {f,memories,counts,refresh,request:()=>config(false)};
}
function normalize(value) {
  return JSON.parse(JSON.stringify(value,(key,entry)=>
    ['timings','elapsedMs','queryEmbeddingMs','queryEmbeddingBudgetMs','nextCursor','cursor'].includes(key)?undefined:entry));
}
async function observation(request) {
  const reader=await request.open(),input={...projection,query:'semantic',deadlineMs:5000,semantic:true};
  try {
    const first=ok(await reader.findCandidates({...input,limit:1},request.token));
    assert.ok(first.nextCursor);
    const second=ok(await reader.findCandidates({...input,limit:1,cursor:first.nextCursor},request.token));
    assert.notDeepEqual(second.items,first.items);
    const assembly=ok(await reader.contextRead({...input,budget:{maxItems:24,maxTokens:4000}},request.token));
    assert.ok(assembly.metered.items.length>0);
    return normalize({first,second,assembly});
  }finally{await reader.close();}
}

for(const mode of ['DELETE','WAL'])test('epoch-only retarget rebinds the sweep before publication in '+mode,async t=>{
  const {f,memories}=await setup(t,mode,['semantic orchard','semantic garden','semantic trail']);
  const published=replace(f.path,mode);
  const item=JSON.stringify([ns.ownerId,ns.scope,ns.projectId,'memory',memories[0].id]);
  const obsolete=()=>sqlite(f.path,db=>({
    cache:db.prepare(`SELECT generation,doc,owner,identity,epoch,item,revision,body_revision,representation,
      hex(vector) AS vector,hex(sort_key) AS sort_key FROM semantic_vectors WHERE item=?`).all(item),
    vectors:db.prepare('SELECT revision,body_revision FROM vector_rows WHERE item=?').all(item)
  }));
  const original=obsolete();
  assert.ok(original.cache.length>0);
  assert.ok(original.vectors.length>0);
  const writer=openMemoryCore({path:f.path});
  try{ok(writer.forget(target(memories[0])));}finally{writer.close();}

  const work=()=>sqlite(f.path,db=>{
    const row=db.prepare(`SELECT g.id,g.storage_id,g.verify,g.fences FROM work w
      JOIN generations g ON g.id=w.generation WHERE w.projection=?`).get(published.projectionDigest);
    return {...row,verify:JSON.parse(row.verify),fences:JSON.parse(row.fences)};
  });
  const verifiedDf=g=>sqlite(f.path,db=>db.prepare(
    'SELECT term_id,verified_df FROM statistics WHERE generation=? ORDER BY term_id'
  ).all(g.storage_id));
  const pointer=()=>physical(f.path,published.projectionDigest).lexical.publication;
  const sweep={head:null,epochs:[]};
  let before,dfs,newFences,pending;
  local(f.path,mode,({step})=>step(),point=>{
    if(point!=='precommit')return;
    before=work();
    assert.equal(before.verify.phase,3);
    assert.ok(before.verify.hash.bytes>0 && before.verify.resetDone && before.verify.postings>0);
    assert.equal(before.verify.sweep.done,true);
    dfs=verifiedDf(before);
    assert.deepEqual(obsolete(),{cache:[],vectors:[]});

    // A late cache row from the old publication must be swept under the new fence.
    const cache=original.cache[0];
    local(f.path,mode,({storage,step})=>{
      storage.vectors(db=>db.prepare('INSERT INTO semantic_vectors VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(
        cache.generation,cache.doc,cache.owner,cache.identity,cache.epoch,cache.item,cache.revision,
        cache.body_revision,cache.representation,Buffer.from(cache.vector,'hex'),Buffer.from(cache.sort_key,'hex')
      ),true);
      assert.equal(obsolete().cache.length,1);
      const canonical=new DatabaseSync(f.path);
      try{
        canonical.exec('UPDATE namespace_epochs SET epoch=epoch+1');
        newFences=readTransaction(canonical,()=>canonicalProductFences(canonical,p,sweep));
      }finally{canonical.close();}
      const metrics=step('sweep-committed');
      pending=work();
      assert.equal(pending.id,before.id);
      assert.notEqual(pending.verify.sweep.binding,before.verify.sweep.binding);
      assert.equal(pending.verify.sweep.binding,digest([
        newFences.canonicalFenceDigest,newFences.dependencyFenceDigest,sweep.head
      ]));
      assert.equal(metrics.retargets,1);
      assert.equal(pending.verify.sweep.done,false);
    });
  });
  assert.ok(pending);
  assert.equal(pointer(),published.publicationId);
  assert.deepEqual(work(),pending);

  local(f.path,mode,({step,current})=>{
    const metrics=step('checkpoint');
    const rebound=work();
    assert.equal(rebound.id,before.id);
    assert.equal(metrics.verificationKept,1);
    assert.equal(metrics.verificationRestarts,0);
    const {sweep:oldSweep,...oldCheckpoint}=before.verify;
    const {sweep:newSweep,...newCheckpoint}=rebound.verify;
    assert.deepEqual(newCheckpoint,oldCheckpoint);
    assert.deepEqual(verifiedDf(rebound),dfs);
    assert.deepEqual(newSweep,{binding:pending.verify.sweep.binding,done:true});
    assert.notEqual(newSweep.binding,oldSweep.binding);
    assert.equal(pointer(),published.publicationId);

    step('published');
    const replacement=current();
    assert.notEqual(replacement.publicationId,published.publicationId);
    assert.equal(replacement.generation.id,before.id);
    assert.equal(replacement.canonicalFenceDigest,newFences.canonicalFenceDigest);
    assert.equal(replacement.dependencyFenceDigest,newFences.dependencyFenceDigest);
    assert.deepEqual(obsolete(),{cache:[],vectors:[]});
  });
});

for(const mode of ['DELETE','WAL'])for(const partial of [false,true])
test('serving output survives retirement of lexical and vector rows in '+mode+(partial?' with partial coverage':' with complete coverage'),async t=>{
  const s=await setup(t,mode,['semantic orchard','semantic garden','semantic trail']);
  const before=replace(s.f.path,mode),prior=physical(s.f.path,before.projectionDigest);
  assert.ok(prior.vector);
  const writer=openMemoryCore({path:s.f.path});
  try{ok(writer.admit({namespace:ns,memory:{content:'semantic harbor',kind:'fact'},receipts:[receipt('harbor')]}));}finally{writer.close();}
  const live=replace(s.f.path,mode);
  if(partial)local(s.f.path,mode,({vectors})=>assert.equal(vectors.certify(p,live,snapshot,quantum),true));
  else await s.refresh('embeddings');
  const kept=physical(s.f.path,live.projectionDigest,prior.lexical.storage_id);
  assert.equal(kept.lexical.publication,live.publicationId);
  assert.equal(kept.retiredLexical,1);assert.ok(kept.retiredPostings>0);assert.ok(kept.retiredVectors>0);
  const coverage=JSON.parse(kept.vector.record).counts.byType.memory;
  assert.equal(coverage.eligible-coverage.embedded,partial?1:0);
  const left=await observation(s.request());
  assert.equal(left.first.trace.effective,partial?'lexical':'hybrid');
  if(partial) {
    assert.equal(left.first.trace.semantic.coverage,'partial');
    assert.equal(left.first.trace.semantic.degradedReason,'missing_vectors');
  }
  drain(s.f.path,mode,live.projectionDigest,prior.lexical.storage_id);
  const gone=physical(s.f.path,live.projectionDigest,prior.lexical.storage_id);
  assert.deepEqual([gone.retiredLexical,gone.retiredPostings,gone.retiredVectors,gone.retiredCache],[0,0,0,0]);
  assert.deepEqual(gone.lexical,kept.lexical);assert.deepEqual(gone.vector,kept.vector);
  assert.deepEqual(await observation(s.request()),left);
});

for(const mode of ['DELETE','WAL'])for(const drained of [false,true])
test('warm re-publications request inputs only for a new eligible version in '+mode+(drained?' with drained collection':' with early stop'),async t=>{
  const s=await setup(t,mode,['semantic orchard','semantic garden','semantic trail','semantic harbor']);
  let lexical=replace(s.f.path,mode);
  for(const [i,expected] of [0,1,0].entries()) {
    const retired=physical(s.f.path,lexical.projectionDigest).lexical.storage_id;
    const writer=openMemoryCore({path:s.f.path});
    try{
      if(i===1)ok(writer.correct({...target(s.memories[i]),content:'semantic revised garden',kind:'fact',receipt:receipt('corrected')}));
      else ok(writer.forget(target(s.memories[i])));
    }finally{writer.close();}
    lexical=replace(s.f.path,mode);
    if(drained)drain(s.f.path,mode,lexical.projectionDigest,retired);
    else assert.ok(physical(s.f.path,lexical.projectionDigest,retired).retiredPostings>0);
    const before=s.counts[5];
    await s.refresh('embeddings');
    assert.equal(s.counts[5]-before,expected);
  }
});

for(const mode of ['DELETE','WAL'])test('collection moves retained cache rows before deleting the retired generation cache in '+mode,async t=>{
  const {f,memories}=await setup(t,mode,['semantic orchard','semantic garden','semantic trail']);
  const old=replace(f.path,mode),retired=physical(f.path,old.projectionDigest).lexical.storage_id;
  const item=JSON.stringify([ns.ownerId,ns.scope,ns.projectId,'memory',memories[1].id]);
  const cacheRow=`SELECT generation,doc,owner,identity,epoch,item,revision,body_revision,representation,
    hex(vector) AS vector,hex(sort_key) AS sort_key FROM semantic_vectors WHERE item=?`;
  const row=()=>sqlite(f.path,db=>db.prepare(cacheRow).get(item));
  const original=row();
  assert.equal(original.generation,retired);
  const writer=openMemoryCore({path:f.path});
  try{ok(writer.forget(target(memories[0])));}finally{writer.close();}
  const live=replace(f.path,mode),destination=physical(f.path,live.projectionDigest).lexical.storage_id;
  assert.notEqual(destination,retired);
  assert.deepEqual(row(),original);
  const movedDoc=sqlite(f.path,db=>db.prepare('SELECT doc FROM documents WHERE generation=? AND identity=?').get(destination,item).doc);
  const moved={...original,generation:destination,doc:movedDoc};

  let deletes=0;
  const observer={database(native){
    return new Proxy(native,{get(db,key){
      if(key==='prepare')return sql=>{
        const statement=db.prepare(sql);
        if(!sql.startsWith('DELETE FROM semantic_vectors WHERE owner=? AND generation=?'))return statement;
        return new Proxy(statement,{get(stmt,method){
          if(method==='run')return (...args)=>{
            if(args[1]!==retired)return stmt.run(...args);
            const cached=db.prepare(cacheRow);
            assert.ok(db.isTransaction);
            assert.deepEqual({...cached.get(item)},moved);
            const result=stmt.run(...args);
            assert.equal(result.changes,0);
            assert.deepEqual({...cached.get(item)},moved);
            deletes++;
            return result;
          };
          const value=Reflect.get(stmt,method,stmt);
          return typeof value==='function'?value.bind(stmt):value;
        }});
      };
      const value=Reflect.get(db,key,db);
      return typeof value==='function'?value.bind(db):value;
    }});
  }};
  local(f.path,mode,({step})=>{
    for(let i=0;i<20&&physical(f.path,live.projectionDigest,retired).retiredLexical;i++)step();
  },undefined,observer);
  assert.equal(physical(f.path,live.projectionDigest,retired).retiredLexical,0);
  assert.ok(deletes>0);
  assert.deepEqual({...row()},moved);
});

for(const mode of ['DELETE','WAL'])test('collection expires an orphan and resets the destination cache audit in '+mode,async t=>{
  const s=await setup(t,mode,['semantic orchard','semantic garden','semantic trail','semantic harbor','semantic meadow','semantic river']);
  const old=replace(s.f.path,mode),retired=physical(s.f.path,old.projectionDigest).lexical.storage_id;
  const orphan=JSON.stringify([ns.ownerId,ns.scope,ns.projectId,'memory',s.memories[1].id]);
  local(s.f.path,mode,({storage})=>storage.vectors(db=>{
    assert.equal(db.prepare('UPDATE semantic_vectors SET doc=1000 WHERE generation=? AND item=?').run(retired,orphan).changes,1);
  },true));
  const writer=openMemoryCore({path:s.f.path});
  try{ok(writer.forget(target(s.memories[0])));}finally{writer.close();}
  const live=replace(s.f.path,mode);
  const work=()=>sqlite(s.f.path,db=>db.prepare('SELECT g.storage_id,g.state FROM vector_work w JOIN vector_generations g ON g.storage_id=w.generation WHERE w.projection=?').get(live.projectionDigest));
  const destination=physical(s.f.path,live.projectionDigest).lexical.storage_id;
  const firstIncoming=local(s.f.path,mode,({storage,vectors})=>{
    const {orphanRow,incoming}=storage.vectors(db=>{
      const orphanRow=db.prepare('SELECT * FROM semantic_vectors WHERE generation=? AND item=?').get(retired,orphan);
      assert.equal(orphanRow.doc,1000);
      db.prepare('DELETE FROM semantic_vectors WHERE generation=? AND item=?').run(retired,orphan);
      const anchors=db.prepare(`SELECT d.doc AS destination,c.doc,c.owner,c.identity,c.epoch
        FROM semantic_vectors c JOIN documents d ON d.generation=? AND d.identity=c.item
        WHERE c.generation=? ORDER BY d.doc DESC`).all(destination,retired);
      assert.equal(anchors.length,4);
      const move=db.prepare('UPDATE semantic_vectors SET generation=?,doc=? WHERE generation=? AND doc=? AND owner=? AND identity=? AND epoch=?');
      for(const row of anchors.slice(0,2))assert.equal(move.run(destination,row.destination,retired,row.doc,row.owner,row.identity,row.epoch).changes,1);
      return {orphanRow,incoming:anchors.at(-1).destination};
    },true);
    let scans=0,audited=0;
    const limited={admit:kind=>!(scans===3&&audited===1),measure(fn,kind){
      if(kind==='vector-scan')scans++;
      const result=fn();
      if(scans===3&&kind==='vector-verification')audited++;
      return result;
    }};
    assert.equal(vectors.certify(p,live,snapshot,limited),false);
    const checkpoint=JSON.parse(work().state).body;
    assert.equal(checkpoint.phase,2);assert.ok(checkpoint.cacheLast[0]>incoming);
    storage.vectors(db=>{
      const r=orphanRow;
      db.prepare('INSERT INTO semantic_vectors VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(r.generation,r.doc,r.owner,r.identity,r.epoch,
        r.item,r.revision,r.body_revision,r.representation,r.vector,r.sort_key);
    },true);
    return incoming;
  });
  drain(s.f.path,mode,live.projectionDigest,retired);
  assert.equal(work(),undefined);
  assert.equal(sqlite(s.f.path,db=>db.prepare('SELECT count(*) AS n FROM semantic_vectors WHERE generation=? AND doc=?').get(destination,firstIncoming).n),1);
  assert.equal(sqlite(s.f.path,db=>db.prepare('SELECT count(*) AS n FROM semantic_vectors WHERE item=?').get(orphan).n),0);
  const before=s.counts[5];
  await s.refresh('embeddings');
  assert.equal(s.counts[5]-before,1);
});
