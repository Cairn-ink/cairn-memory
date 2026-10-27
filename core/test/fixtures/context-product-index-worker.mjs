import { registerHooks } from 'node:module';
import { workerData } from 'node:worker_threads';
import { spawnSync } from 'node:child_process';
const c=workerData.host.configuration, state=new Int32Array(c.state);
const Native=process.getBuiltinModule('node:sqlite').DatabaseSync;
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
    const result=super.exec(sql);
    if(this.side && sql==='COMMIT' && this.checkpoint && c.crashAfterCheckpoint)process.exit(1);
    if(this.side && sql==='COMMIT' && this.publishing){this.publishing=false;Atomics.store(state,7,1);}
    return result;
  }
  prepare(sql){
    if(c.trapReads && /quick_check|foreign_key_check|\bCOUNT\s*\(|\bSUM\s*\(|\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql))throw Error('read scan/mutation');
    if(c.trapReads && this.side && /FROM (documents|postings|statistics)/i.test(sql) && !/WHERE.*generation\s*=\s*\?/i.test(sql))throw Error('unkeyed index scan');
    const stmt=super.prepare(sql),native=this;
    return new Proxy(stmt,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;
      return (...args)=>{if(/UPDATE generations SET published=1/.test(sql))native.publishing=true;if(/INSERT OR REPLACE INTO progress_records/.test(sql))native.checkpoint=true;return Reflect.apply(value,target,args);};}});
  }
};
registerHooks({load(url,context,next){if(url!=='node:sqlite')return next(url,context);return {format:'module',shortCircuit:true,source:`
  export const DatabaseSync=globalThis.productTestDatabase;
  const actual=process.getBuiltinModule('node:sqlite');export const StatementSync=actual.StatementSync,constants=actual.constants,backup=actual.backup;
  export default {...actual,DatabaseSync};`};}});
await import('../../context-product-worker.mjs');
