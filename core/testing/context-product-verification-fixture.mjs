import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { productSidecar, PRODUCT_SIDECAR_SUFFIX } from '../context-product-sidecar.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { accessDigest, verifiedRecord } from '../context-product-validation.mjs';
import { createProductSqlitePolicy } from '../context-product-sqlite.mjs';
import { createMaintenanceAttribution } from '../context-product-attribution.mjs';
import { ns } from './context-read-fixture.mjs';
export const selection={readSet:[ns],types:['memory'],intent:'current',ownerCoverage:{policy:'recent-projects-v1',selectionRevision:'synthetic',requestedNamespaces:1,selectedNamespaces:1,omittedNamespaces:0}};
export function inspect(path,work) {
  const db=new DatabaseSync(path+PRODUCT_SIDECAR_SUFFIX);
  try {return work(db);}finally{db.close();}
}
export const workRow=path=>inspect(path,db=>db.prepare('SELECT g.* FROM generations g JOIN work w ON w.generation=g.id').get());
export function local(path,{mode='DELETE',enabled=false,state=new SharedArrayBuffer(8),types=['memory']}={}) {
  let clock=0,hook=()=>{},storage,closed=false,chunks=0,maximumChunks=0;const p={...selection,types};
  const sqlite=createProductSqlitePolicy({now:()=>clock});sqlite.start(Infinity);
  const facade=openContextProductFacade(path,{sqlite}),attribution=createMaintenanceAttribution({now:()=>clock});
  const access=accessDigest({ownerId:ns.ownerId,namespaces:{readSet:[ns]}});
  function reopen() {
    storage?.close();storage=productSidecar({path,db:facade.port.db,identity:facade.port.identity,features:facade.port.features,sqlite,
      writable:true,sidecarJournalMode:mode,verificationBatching:enabled,verificationBatchState:state,attribution,now:()=>clock,rendezvous:point=>{
        if(point==='verification-chunk')chunks++;
        if(point==='verification'){maximumChunks=Math.max(maximumChunks,chunks);chunks=0;}hook(point);
      }});
  }
  reopen();
  return {p,facade,state,attribution,setHook(fn){hook=fn;},setClock(n){clock=n;},reopen,
    batchChunks:()=>maximumChunks,
    step(maxItems=1024){clock=0;chunks=0;attribution.reset();return storage.refresh(p,access,{maxItems,maxMs:1000});},
    prepare(){hook=point=>{if(point==='checkpoint')clock=900;};
      for(let i=0;i<100;i++){this.step();if(workRow(path)?.phase>=1){hook=()=>{};return;}}
      assert.fail('preparation must converge');},
    finish(){for(let i=0;i<200;i++){this.step();const result=storage.observe(p,access);if(result.publication)return result.publication;}assert.fail('verification must converge');},
    observe:()=>storage.observe(p,access),lexical:(publication,query)=>storage.lexical(p,publication,query),
    close(){if(!closed){closed=true;storage.close();facade.close();}}
  };
}
export function snapshot(db) {
  const g=db.prepare('SELECT g.* FROM generations g JOIN work w ON w.generation=g.id').get();
  return JSON.parse(JSON.stringify({generation:g,progress:db.prepare('SELECT record FROM progress_records WHERE generation=?').get(g.id).record,
    documents:db.prepare('SELECT * FROM documents WHERE generation=? ORDER BY identity').all(g.storage_id),
    postings:db.prepare('SELECT * FROM postings WHERE generation=? ORDER BY doc,position').all(g.storage_id),
    statistics:db.prepare('SELECT * FROM statistics WHERE generation=? ORDER BY term').all(g.storage_id)}));
}
export function authenticate(a,value) {
  const record=verifiedRecord(a.facade.port.identity.cursorSecret,'progress',value.progress);
  assert.equal(record.progress.checkpoint,value.generation.checkpoint);
  assert.equal(record.generation.incarnation,value.generation.incarnation);
}
