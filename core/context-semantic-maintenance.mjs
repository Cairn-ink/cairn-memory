import { createHmac } from 'node:crypto';
import { openContextProductFacade } from './context-read-facade.mjs';
import { productSidecar, canonicalProductIdentity, productFile, PRODUCT_SIDECAR_SUFFIX } from './context-product-sidecar.mjs';
import { productVectors } from './context-product-vectors.mjs';
import { canonicalJson, digest, accessDigest } from './context-product-validation.mjs';
import { mono } from './context-product-control.mjs';
import { safePath } from './context-semantic-input.mjs';
import { fail } from './validation.mjs';

const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
export function semanticMaintenance({c,sqlite,identity,secretState}) {
  const paths=new Map(),views=new Map();
  const coverage=readSet=>({policy:'recent-projects-v1',selectionRevision:'semantic-service',requestedNamespaces:readSet.length,selectedNamespaces:readSet.length,omittedNamespaces:0});
  function open(path,writable=false,journalMode=c.host.configuration.semanticSidecarJournalMode??'DELETE') {
    const key=JSON.stringify([path,writable,journalMode]);let view=views.get(key);if(view)return view;
    const facade=openContextProductFacade(path,{sqlite});
    try {
      const storage=productSidecar({path,db:facade.port.db,identity:facade.port.identity,features:facade.port.features,sqlite,writable,
        sidecarJournalMode:journalMode});
      view={path,facade,storage,vectors:productVectors({storage,facade})};views.set(key,view);return view;
    }catch(error){facade.close();throw error;}
  }
  function describe(target) {
    const view=open(target.canonicalPath),f=view.facade;
    for(const type of target.types)if(!f.capabilities.types.includes(type))fail('invalid_input');
    const canonicalIdentity=f.port.read(()=>canonicalProductIdentity(target.canonicalPath,f.port.db));
    return target.intents.map(intent=>({storeId:f.port.identity.storeId,canonicalIdentity,readSet:target.readSet,types:target.types,intent}));
  }
  function targets(configured) {
    const rows=configured.flatMap(t=>{
      const descriptors=describe(t);for(const d of descriptors)paths.set(digest(d),t.canonicalPath);return descriptors;
    });
    rows.sort((a,b)=>Buffer.compare(Buffer.from(canonicalJson({...a,intent:''})),Buffer.from(canonicalJson({...b,intent:''})))||(['current','history'].indexOf(a.intent)-['current','history'].indexOf(b.intent)));
    if(new Set(rows.map(digest)).size!==rows.length)fail('invalid_input');return rows;
  }
  // Re-resolve paths from safely attested configured targets after a restart.
  function resolve(target) {
    if(!paths.has(digest(target)))targets(c.backfillTargets);
    const path=paths.get(digest(target));if(!path)fail('revision_conflict');return open(path);
  }
  function probe(target,state) {
    const v=resolve(target),p={readSet:target.readSet,types:target.types,intent:target.intent,ownerCoverage:coverage(target.readSet)};
    const currentIdentity=canonicalProductIdentity(v.path,v.facade.port.db);
    if(!same(currentIdentity,target.canonicalIdentity)||v.facade.port.identity.storeId!==target.storeId)return null;
    const access=accessDigest({ownerId:state.ownerId,namespaces:{readSet:target.readSet},...(c.host.configuration.ownerGeneration===undefined?{}:{ownerGeneration:c.host.configuration.ownerGeneration})});
    const observed=v.storage.observe(p,access);
    if(observed.dto.lexical.state!=='ready')return null;
    const vector=v.vectors.observe(p,observed.publication,{identity:identity(),policy:state.policy});
    if(vector.status!=='complete')return null;
    const receipt={targetDigest:digest(target),lexicalValidationDigest:digest(observed.publication),vectorValidationDigest:digest(vector.record),identity:identity(),purgeEpoch:state.policy.purgeEpoch,
      canonical:currentIdentity,sidecar:vector.record.sidecar,canonicalFenceDigest:vector.record.canonicalFenceDigest,dependencyFenceDigest:vector.record.dependencyFenceDigest,accessDigest:vector.record.accessDigest};
    if(Buffer.byteLength(canonicalJson(receipt))>4096)fail('context_item_too_large');return receipt;
  }
  async function validate({input,operation,final,current,change,ledger,coverageStatus,prepare,pending}) {
    let a=await current(),s=a.state;
    if(input.expectedTargetDigest!==s.targetSetDigest)fail('revision_conflict');
    if(!s.targets)fail('revision_conflict');
    if(s.firstCoverageComplete){const value={status:'complete',firstCoverage:coverageStatus(s)};final();return {ok:true,value};}
    targets(c.backfillTargets);
    const cutoff=mono(operation.operationCutoffMonoNs),hasTime=()=>process.hrtime.bigint()+20000000n<cutoff;
    let visited=0,invalid=false;
    const receipts=Object.assign(Object.create(null),s.receipts);
    let ordinal=s.validationOrdinal??0;
    for(let count=0;count<s.targets.length&&visited<input.budget.maxTargets&&hasTime();count++) {
      const i=ordinal++%s.targets.length;
      const v=resolve(s.targets[i]),receipt=v.facade.port.read(()=>probe(s.targets[i],s));visited++;
      if(receipt)receipts[i]=receipt;else{delete receipts[i];invalid=true;}
    }
    const changed=await change(n=>{if(n.targetSetDigest!==s.targetSetDigest||n.policy.purgeEpoch!==s.policy.purgeEpoch)fail('revision_conflict');n.receipts=receipts;n.validationOrdinal=ordinal%s.targets.length;if(invalid)n.validationPending=false;});
    s=changed.state;
    if(Buffer.byteLength(canonicalJson(s.receipts))>262144)fail('context_item_too_large');
    if(Object.keys(receipts).length!==s.targets.length||!hasTime()||!s.policy.semantic||s.blocked||['pending','running','failed'].includes(s.purge.state)) {
      const value={status:'partial',firstCoverage:coverageStatus(s)};final();return {ok:true,value};
    }
    // Prepare all views and the exact anchor before the final sample. The final
    // pass performs only native keyed/scalar comparisons and the prepared CAS.
    const groups=new Map();
    s.targets.forEach((t,i)=>{const v=resolve(t),key=t.storeId+':'+canonicalJson(t.canonicalIdentity);if(!groups.has(key))groups.set(key,{v,targets:[]});groups.get(key).targets.push({t,i});});
    const next=structuredClone(s);next.firstCoverageComplete=true;next.validationPending=false;
    const prepared=await prepare(next);
    const recovery={prepared:prepared.prepared,sealed:prepared.previous,invalidReceipts:[]};
    // Register before any cutoff, authority sample or native final comparison.
    pending(recovery);
    if(!hasTime()){const value={status:'partial',firstCoverage:coverageStatus(s)};final();return {ok:true,value};}
    final();let valid=true;
    for(const [,group] of [...groups].sort(([a],[b])=>Buffer.compare(Buffer.from(a),Buffer.from(b)))) {
      group.v.facade.port.read(()=>{
        group.v.facade.port.db.prepare('SELECT store_id FROM store_metadata WHERE singleton=1').get();
        for(const {t,i} of group.targets)if(!same(probe(t,s),receipts[i])){valid=false;recovery.invalidReceipts.push([i,receipts[i]]);delete s.receipts[i];delete s.hints[i];s.validationPending=false;}
      });
    }
    if(process.hrtime.bigint()>=cutoff)fail('read_timeout');
    if(!valid) {
      return {ok:true,value:{status:'partial',firstCoverage:coverageStatus(s)}};
    }
    const sealed=ledger.commit(prepared,(db,current)=>{
      if(!current.policy.semantic||current.policy.purgeEpoch!==s.policy.purgeEpoch||current.targetSetDigest!==s.targetSetDigest)fail('revision_conflict');
    });
    recovery.sealed=sealed;
    return {ok:true,value:{status:'complete',firstCoverage:coverageStatus(next)}};
  }
  function catalog(input,metadata) {
    safePath(input.canonicalPath);
    if(input.canonicalPath!==metadata.path||input.ownerId!==metadata.ownerId)fail('authority_required');
    const v=open(input.canonicalPath),physical=v.facade.port.read(()=>canonicalProductIdentity(v.path,v.facade.port.db)),sidecar=productFile(v.path+PRODUCT_SIDECAR_SUFFIX);
    if(v.facade.port.identity.storeId!==input.storeId||!same(physical,input.canonicalIdentity)||!same(sidecar,input.sidecarIdentity)||input.catalogId!==digest({storeId:input.storeId,canonicalIdentity:physical,sidecarIdentity:sidecar}))fail('index_unavailable');
  }
  async function purge({input,operation,current,change}) {
    let a=await current(),s=a.state,remaining=input.budget.maxItems;
    const epoch=s.policy.purgeEpoch;
    if(epoch===0)return {status:'complete',purge:s.purge};
    let complete=true;
    for(const [id,entry] of Object.entries(s.catalog).sort(([a],[b])=>Buffer.compare(Buffer.from(a),Buffer.from(b)))) {
      if(entry.purge?.epoch===epoch&&entry.purge.complete)continue;
      if(remaining<=0||process.hrtime.bigint()+20000000n>=mono(operation.operationCutoffMonoNs)){complete=false;break;}
      const sidePath=entry.canonicalPath+PRODUCT_SIDECAR_SUFFIX;
      if(!productFile(sidePath,true)) {
        await change(n=>{n.catalog[id].purge={epoch,deleted:entry.purge?.deleted??0,complete:true};});continue;
      }
      if(!same(productFile(sidePath),entry.sidecarIdentity)){complete=false;break;}
      const v=open(entry.canonicalPath,true,entry.sidecarJournalMode),secret=v.facade.port.identity.cursorSecret;
      const sign=body=>createHmac('sha256',secret).update('context-read-product-v1.1/vector-purge\0'+canonicalJson(body)).digest('base64url');
      const progress=v.storage.vectors(db=>{
        const binding={ownerId:s.ownerId,storeId:entry.storeId,canonicalIdentity:entry.canonicalIdentity,sidecarIdentity:entry.sidecarIdentity};
        let previous={...binding,epoch,deleted:0,complete:false};
        const prior=db.prepare('SELECT record FROM vector_purge_checkpoints WHERE owner=?').get(s.ownerId)?.record;
        if(prior){const p=JSON.parse(prior);if(p.mac!==sign(p.body)||!same({...binding,epoch:p.body.epoch,deleted:p.body.deleted,complete:p.body.complete},p.body))fail('index_unavailable');if(p.body.epoch===epoch)previous=p.body;}
        let used=0,deleted=previous.deleted;
        const cached=db.prepare('SELECT * FROM semantic_vectors WHERE owner=? ORDER BY sort_key,identity,epoch,revision,body_revision,representation LIMIT ?').all(s.ownerId,remaining);
        for(const r of cached){db.prepare('DELETE FROM semantic_vectors WHERE generation=? AND doc=? AND identity=? AND epoch=? AND owner=?').run(r.generation,r.doc,r.identity,r.epoch,r.owner);used++;deleted++;}
        const rows=db.prepare('SELECT r.* FROM vector_rows r JOIN vector_generations g ON g.storage_id=r.generation WHERE g.owner=? ORDER BY r.sort_key,r.generation LIMIT ?').all(s.ownerId,remaining-used);
        for(const r of rows){db.prepare('DELETE FROM vector_rows WHERE generation=? AND doc=?').run(r.generation,r.doc);used++;if(r.vector!==null)deleted++;}
        // Epoch invalidation already bars all pointers. Each physical batch
        // invalidates its matching records in the same native transaction.
        const pointers=db.prepare('SELECT projection FROM vector_publications WHERE owner=? ORDER BY projection LIMIT 128').all(s.ownerId);
        for(const r of pointers)db.prepare('DELETE FROM vector_publications WHERE projection=? AND owner=?').run(r.projection,s.ownerId);
        const records=db.prepare('SELECT publication FROM vector_validation_records WHERE owner=? ORDER BY publication LIMIT 128').all(s.ownerId);
        for(const r of records)db.prepare('DELETE FROM vector_validation_records WHERE publication=? AND owner=?').run(r.publication,s.ownerId);
        const generations=db.prepare('SELECT storage_id,id,projection FROM vector_generations WHERE owner=? AND NOT EXISTS(SELECT 1 FROM vector_rows WHERE generation=vector_generations.storage_id) ORDER BY storage_id LIMIT 128').all(s.ownerId);
        for(const r of generations){db.prepare('DELETE FROM vector_work WHERE generation=?').run(r.storage_id);db.prepare('DELETE FROM vector_generations WHERE id=? AND owner=?').run(r.id,s.ownerId);}
        const exhausted=!db.prepare('SELECT 1 FROM semantic_vectors WHERE owner=? LIMIT 1').get(s.ownerId)&&!db.prepare('SELECT 1 FROM vector_generations WHERE owner=? LIMIT 1').get(s.ownerId)&&
          !db.prepare('SELECT 1 FROM vector_publications WHERE owner=? LIMIT 1').get(s.ownerId)&&!db.prepare('SELECT 1 FROM vector_validation_records WHERE owner=? LIMIT 1').get(s.ownerId);
        const body={...binding,epoch,deleted,complete:exhausted};db.prepare('INSERT OR REPLACE INTO vector_purge_checkpoints VALUES(?,?,?)').run(s.ownerId,epoch,canonicalJson({body,mac:sign(body)}));
        return {...body,used};
      },true);
      if(progress===null){complete=false;break;}
      remaining-=progress.used;complete&&=progress.complete;
      const changed=await change(n=>{
        const old=n.catalog[id].purge?.epoch===epoch?n.catalog[id].purge.deleted:0;
        n.catalog[id].purge={epoch,deleted:progress.deleted,complete:progress.complete};n.purge.deletedVectors+=progress.deleted-old;
        n.purge.state='running';n.purge.checkpoint=digest({id,epoch,deleted:progress.deleted});
      });s=changed.state;
    }
    const result=await change(n=>{
      const done=complete&&Object.values(n.catalog).every(e=>e.purge?.epoch===epoch&&e.purge.complete);
      if(done)n.purge={...n.purge,state:'complete',checkpoint:null,remainingVectors:0,reason:null};
    });
    return {status:result.state.purge.state==='complete'?'complete':'partial',purge:result.state.purge};
  }
  function transmission(input,metadata,state) {
    const p=input.projection;
    if(!p||!same(p.readSet,metadata.readSet)||p.readSet[0].ownerId!==state.ownerId||input.kind==='refresh'&&!metadata.maintenance)fail('authority_required');
    const v=open(metadata.path);
    v.facade.port.read(()=>{
      const observed=v.storage.observe({...p,ownerCoverage:coverage(p.readSet)},p.accessDigest);
      if(observed.dto.lexical.state!=='ready'||digest(observed.publication)!==p.lexicalValidationDigest)fail('index_unavailable');
      if(input.kind==='query') {
        const vector=v.vectors.observe(p,observed.publication,{identity:identity(),policy:state.policy});
        if(vector.status!=='complete'||digest(vector.record)!==p.vectorValidationDigest)fail('index_unavailable');
      }
    });
  }
  return {targets,validate,catalog,purge,transmission,close(){for(const v of views.values()){v.storage.close();v.facade.close();}views.clear();}};
}
