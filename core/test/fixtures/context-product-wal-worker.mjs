// Test-only native and reply rendezvous; never linked by a runtime entry.
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import childProcess from 'node:child_process';
import { parentPort, workerData } from 'node:worker_threads';
const { port, gate, behavior }=workerData.walTestControl;
const wait=new Int32Array(gate),Native=process.getBuiltinModule('node:sqlite').DatabaseSync;
let method='open',fired=false;
parentPort.on('message',m=>{if(m.method)method=m.method;});
const send=parentPort.postMessage.bind(parentPort);
parentPort.postMessage=function(message,...args){
  if((behavior.startsWith('busy') && fired || behavior==='reply') && message.operation && method!=='open' && !message.kind){
    port.postMessage('failure-committed');Atomics.wait(wait,0,0);
  }
  return send(message,...args);
};
// Faults execute inside the real staged child, through the actual maintainer.
if(behavior.startsWith('init-')){
  const spawn=childProcess.spawnSync;let injected=false;
  childProcess.spawnSync=(command,args,options)=>{
    if(!injected && args[6] && args[2]?.includes('const init =')){
      injected=true;args=[...args];
      const [_,boundary,code='14']=behavior.split('-');
      const failure=`Object.assign(Error('private initialization fault'),{code:'ERR_SQLITE_ERROR',errcode:${Number(code)}})`;
      if(boundary==='open')args[2]=args[2].replace('new DatabaseSync(path,options)',`(()=>{if(role==='initialize')throw ${failure};return new DatabaseSync(path,options);})()`);
      if(['mode','execute','truncatedbusy','repair'].includes(boundary))args[2]=args[2].replace('native.exec(sql)',`(()=>{if(role==='initialize' && ${boundary!=='execute'?"sql.startsWith('PRAGMA journal_mode=')":"stage==='begin'"})throw ${failure};return native.exec(sql);})()`);
      if(boundary==='repair')args[2]=args[2].replace('native.prepare(sql)',`(()=>{if(role==='incumbent')throw Object.assign(Error('private incumbent corruption'),{code:'ERR_SQLITE_ERROR',errcode:11});return native.prepare(sql);})()`);
      if(boundary==='close')args[2]=args[2].replace('()=>native.close()',`()=>{native.close();if(role==='initialize')throw ${failure};}`);
      // Also target the historical child so the same regression reproduces
      // the review defect at 1c769bdb, rather than relying on new syntax alone.
      if(!args[2].includes('const call = (database') && boundary==='open')args[2]=args[2].replace('const db = new DatabaseSync(temporary);',`const db = (()=>{throw ${failure};})();`);
      if(!args[2].includes('const call = (database') && ['mode','truncatedbusy'].includes(boundary))args[2]=args[2].replace("db.exec('PRAGMA journal_mode=' + init.journalMode);",`throw ${failure};`);
      if(!args[2].includes('const call = (database') && boundary==='execute')args[2]=args[2].replace("db.exec('BEGIN IMMEDIATE;' + init.sql);",`throw ${failure};`);
      if(!args[2].includes('const call = (database') && boundary==='close')args[2]=args[2].replace('db.close();',`db.close();throw ${failure};`);
      const result=spawn(command,args,options);
      if(['truncated','truncatedbusy'].includes(boundary))result.stdout=result.stdout.trim().split('\n').filter(line=>!line.includes('"outcome"') || !line.includes('"journal_mode"')).join('\n')+'\n';
      if(boundary==='omitted')result.stdout=result.stdout.trim().split('\n').filter(line=>!line.includes('"close"')).join('\n')+'\n';
      return result;
    }
    return spawn(command,args,options);
  };
  syncBuiltinESMExports();
}
globalThis.productWalTestDatabase=class extends Native {
  constructor(path,options){super(path,options);this.canonical=String(path)===workerData.path;this.side=String(path).endsWith('.context-read-product-v1.1.sqlite');}
  prepare(sql){
    if(!fired && sql==='PRAGMA journal_mode' && (behavior==='canonical-close' && this.canonical || behavior==='side-close' && this.side)){
      fired=true;port.postMessage('opening-mode-entered');Atomics.wait(wait,0,0);
    }
    if(['busy5','busy6','inflight','snapshot'].includes(behavior) && this.canonical && method!=='open' && !fired && /SELECT store_id FROM store_metadata/.test(sql)){
      fired=true;
      if(behavior.startsWith('busy'))throw Object.assign(Error('synthetic private WAL native failure'),{code:'ERR_SQLITE_ERROR',errcode:behavior==='busy5'?261:262});
      if(behavior==='snapshot')super.prepare('SELECT store_id FROM store_metadata WHERE singleton=1').get();
      // SQLite is executing a native UDF while the outer observed call is in
      // flight. The WAL canonical snapshot (snapshot case) stays pinned.
      const outer=new Native(':memory:');
      outer.function('wal_rendezvous',()=>{port.postMessage('entered-native');Atomics.wait(wait,0,0);return 1;});
      outer.prepare('SELECT wal_rendezvous()').get();outer.close();
    }
    return super.prepare(sql);
  }
};
registerHooks({load(url,context,next){if(url!=='node:sqlite')return next(url,context);return {format:'module',shortCircuit:true,source:`
  export const DatabaseSync=globalThis.productWalTestDatabase;
  const actual=process.getBuiltinModule('node:sqlite');export const StatementSync=actual.StatementSync,constants=actual.constants,backup=actual.backup;
  export default {...actual,DatabaseSync};`};}});
await import('../../context-product-worker.mjs');
