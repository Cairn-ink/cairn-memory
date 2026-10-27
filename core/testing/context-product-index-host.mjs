import { spawnSync } from 'node:child_process';
import { threadId } from 'node:worker_threads';
export async function createContextReadHost(c) {
  const b=c.serviceBinding??c.requestBinding, state=new Int32Array(c.state);
  const assembly=c.assemblyRendezvous && new Int32Array(c.assemblyRendezvous);
  if(assembly){
    // Test-only instrumentation inside the actual product Worker. Preparation
    // and final evidence reads are distinguished by the first counter call.
    const {DatabaseSync}=await import('node:sqlite'),prepare=DatabaseSync.prototype.prepare,exec=DatabaseSync.prototype.exec;
    DatabaseSync.prototype.exec=function(sql){
      const result=exec.call(this,sql);
      if(sql==='BEGIN')Atomics.add(assembly,6,1);
      if(sql==='COMMIT'||sql==='ROLLBACK')Atomics.sub(assembly,6,1);
      return result;
    };
    DatabaseSync.prototype.prepare=function(sql){
      const stmt=prepare.call(this,sql);
      if(!/^SELECT \* FROM (?:memories|private_cards) WHERE/.test(sql))return stmt;
      return new Proxy(stmt,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;
        return (...args)=>{if(Atomics.load(assembly,2)>0)Atomics.add(assembly,3,1);return Reflect.apply(value,target,args);};}});
    };
  }
  const callback=()=>{if(assembly){Atomics.add(assembly,7,1);if(Atomics.load(assembly,3)>0)Atomics.add(assembly,4,1);}};
  if(c.throwAfterResource){c.resourceOwner.register('lease',()=>{Atomics.store(state,6,1);});throw Error('synthetic bootstrap failure');}
  return {
    authorize(request) {
      callback();
      if(b.kind==='service' && !['refreshContextIndex','getContextIndexStatus'].includes(request.method))return null;
      return b;
    },
    isCurrent() {
      callback();
      const n=Atomics.add(state,1,1)+1;
      if(n===c.mutateAtSample){
        const r=spawnSync(process.execPath,['--input-type=module','-e',"import {DatabaseSync} from 'node:sqlite';const d=new DatabaseSync(process.argv[1]);d.prepare('UPDATE namespace_epochs SET epoch=epoch+1 WHERE owner_id=?').run(process.argv[2]);d.close();",c.canonicalPath,b.ownerId],{encoding:'utf8',env:{}});
        if(r.status!==0)throw Error('independent writer failed');
      }
      if(Atomics.load(state,2)===n)Atomics.store(state,0,0);
      return Atomics.load(state,0)===1 && (b.ownerGeneration===undefined || b.ownerGeneration===Atomics.load(state,3));
    },
    counter:{id:'synthetic-exact-characters',countTokens(text){
      Atomics.store(state,4,threadId);callback();
      if(assembly){
        if(Atomics.load(assembly,3)>0||Atomics.load(assembly,6)!==0)throw Error('counter after final read or inside transaction');
        Atomics.add(assembly,2,1);
        if(Atomics.compareExchange(assembly,0,0,1)===0){
          queueMicrotask(()=>{Atomics.store(assembly,5,1);Atomics.notify(assembly,5);});
          Atomics.notify(assembly,0);
          while(Atomics.load(assembly,1)===0)Atomics.wait(assembly,1,0);
        }
      }
      return Array.from(text).length;
    }},
    // These ports must never be constructed/called by the lexical engine.
    embedder:{embed(){Atomics.add(state,5,1);throw Error('provider called');}},
  };
}
