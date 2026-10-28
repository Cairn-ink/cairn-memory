import { registerHooks } from 'node:module';
import { workerData } from 'node:worker_threads';
import { spawnSync } from 'node:child_process';
const c=workerData.host.configuration, state=new Int32Array(c.state);
const Native=process.getBuiltinModule('node:sqlite').DatabaseSync;
let pendingCollection=false;
function collectCaptured(){
  const code=`
    import {DatabaseSync} from 'node:sqlite';
    import {openContextProductFacade} from ${JSON.stringify(new URL('../../context-read-facade.mjs',import.meta.url).href)};
    import {productSidecar} from ${JSON.stringify(new URL('../../context-product-sidecar.mjs',import.meta.url).href)};
    import {accessDigest} from ${JSON.stringify(new URL('../../context-product-validation.mjs',import.meta.url).href)};
    const path=process.argv[1],original=JSON.parse(process.argv[2]),cutover=process.argv[3]==='selection';
    if(!cutover){const db=new DatabaseSync(path);db.prepare('UPDATE namespace_epochs SET epoch=epoch+1 WHERE owner_id=?').run(original[0].ownerId);db.close();}
    const readSet=cutover?original.slice(0,2):original;
    const facade=openContextProductFacade(path,{}),storage=productSidecar({path,db:facade.port.db,identity:facade.port.identity,features:facade.port.features,writable:true});
    const p={readSet,types:['memory'],intent:'current',ownerCoverage:{policy:'recent-projects-v1',selectionRevision:'race',requestedNamespaces:readSet.length,selectedNamespaces:readSet.length,omittedNamespaces:0}};
    const access=accessDigest({ownerId:readSet[0].ownerId,namespaces:{readSet}});
    try {let ready=false;for(let i=0;i<100;i++){storage.refresh(p,access,{maxItems:1024,maxMs:5000});if(storage.observe(p,access).dto.lexical.state==='ready'){ready=true;break;}}if(!ready)throw Error('race build incomplete');}
    finally{storage.close();facade.close();}
  `;
  const result=spawnSync(process.execPath,['--input-type=module','-e',code,workerData.path,JSON.stringify(workerData.readSet),c.collectCaptured],{encoding:'utf8',env:{}});
  if(result.status!==0)throw Error('competing maintenance exit '+result.status+': '+result.stderr);
}
function mutate(){
  const result=spawnSync(process.execPath,['--input-type=module','-e',`
    import {DatabaseSync} from 'node:sqlite';
    const d=new DatabaseSync(process.argv[1]);d.exec('PRAGMA busy_timeout=5000;BEGIN IMMEDIATE');
    d.prepare('UPDATE namespace_epochs SET epoch=epoch+1 WHERE owner_id=?').run(process.argv[2]);d.exec('COMMIT');d.close();`,workerData.path,workerData.readSet[0].ownerId],{encoding:'utf8',env:{}});
  if(result.status!==0)throw Error('independent writer failed');
}
globalThis.productTestDatabase=class extends Native {
  constructor(path,options){
    if(c.syntheticCorrupt && String(path).endsWith('.context-read-product-v1.1.sqlite')){Atomics.add(state,6,1);throw Object.assign(Error('synthetic corrupt cache'),{code:'ERR_SQLITE_ERROR',errcode:11});}
    if(c.trapReads && options?.readOnly!==true)throw Error('read created writable connection');
    super(path,options);this.side=String(path).endsWith('.context-read-product-v1.1.sqlite');this.publishing=false;this.checkpoint=false;
  }
  exec(sql){
    if(c.trapReads && /CREATE|INSERT|UPDATE|DELETE|REPLACE|BEGIN IMMEDIATE|quick_check|foreign_key_check/i.test(sql))throw Error('read mutation/deep validation');
    if(this.side && sql==='COMMIT' && this.publishing && c.publicationRace){mutate();Atomics.add(state,6,1);}
    if(this.side && sql==='COMMIT' && this.batchMutated && c.crashBeforeBatchCommit){
      // The first transformed checkpoint was committed by the preceding call.
      // These document/posting/statistic mutations are still in this transaction.
      Atomics.add(state,6,1);process.exit(1);
    }
    const result=super.exec(sql);
    if(this.side && sql==='COMMIT' && this.captured && c.collectCaptured && Atomics.load(state,6)===1){
      this.captured=false;pendingCollection=true;
    }
    // Both snapshots have released their DELETE locks before the canonical
    // writer/catch-up runs. This is still before lexical storageKey lookup.
    if(!this.side && sql==='COMMIT' && pendingCollection && Atomics.compareExchange(state,6,1,2)===1){
      pendingCollection=false;collectCaptured();
    }
    if(!this.side && sql==='COMMIT' && c.afterSnapshotRace && Atomics.load(state,7) && !Atomics.load(state,6)){
      mutate();Atomics.add(state,6,1);
    }
    if(this.side && sql==='COMMIT' && this.checkpoint && (c.crashAfterCheckpoint || (c.crashAtCheckpoint!==undefined && this.savedCheckpoint===c.crashAtCheckpoint)))process.exit(1);
    if(this.side && sql==='COMMIT' && this.publishing){this.publishing=false;Atomics.store(state,7,1);}
    return result;
  }
  prepare(sql){
    if(c.trapReads && /quick_check|foreign_key_check|\bCOUNT\s*\(|\bSUM\s*\(|\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql))throw Error('read scan/mutation');
    if(c.trapReads && this.side && /FROM (documents|postings|statistics)/i.test(sql) && !/WHERE.*generation\s*=\s*\?/i.test(sql))throw Error('unkeyed index scan');
    if(this.side && /SELECT \* FROM publications WHERE projection=/.test(sql))this.captured=true;
    const stmt=super.prepare(sql),native=this;
    return new Proxy(stmt,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;
      return (...args)=>{if(/UPDATE generations SET published=1/.test(sql))native.publishing=true;if(/INSERT OR REPLACE INTO progress_records/.test(sql))native.checkpoint=true;const result=Reflect.apply(value,target,args);
        if(/INSERT OR REPLACE INTO progress_records/.test(sql))native.savedCheckpoint=JSON.parse(args[1]).progress.checkpoint;
        if(native.side && /UPDATE statistics SET n=/.test(sql))native.batchMutated=true;
        return result;};}});
  }
};
registerHooks({load(url,context,next){if(url!=='node:sqlite')return next(url,context);return {format:'module',shortCircuit:true,source:`
  export const DatabaseSync=globalThis.productTestDatabase;
  const actual=process.getBuiltinModule('node:sqlite');export const StatementSync=actual.StatementSync,constants=actual.constants,backup=actual.backup;
  export default {...actual,DatabaseSync};`};}});
await import('../../context-product-worker.mjs');
