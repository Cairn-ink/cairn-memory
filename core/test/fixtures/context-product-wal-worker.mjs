// Test-only native and reply rendezvous; never linked by a runtime entry.
import { registerHooks } from 'node:module';
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
