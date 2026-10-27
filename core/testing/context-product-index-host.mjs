import { spawnSync } from 'node:child_process';
import { threadId } from 'node:worker_threads';
export function createContextReadHost(c) {
  const b=c.serviceBinding??c.requestBinding, state=new Int32Array(c.state);
  if(c.throwAfterResource){c.resourceOwner.register('lease',()=>{Atomics.store(state,6,1);});throw Error('synthetic bootstrap failure');}
  return {
    authorize(request) {
      if(b.kind==='service' && !['refreshContextIndex','getContextIndexStatus'].includes(request.method))return null;
      return b;
    },
    isCurrent() {
      const n=Atomics.add(state,1,1)+1;
      if(n===c.mutateAtSample){
        const r=spawnSync(process.execPath,['--input-type=module','-e',"import {DatabaseSync} from 'node:sqlite';const d=new DatabaseSync(process.argv[1]);d.prepare('UPDATE namespace_epochs SET epoch=epoch+1 WHERE owner_id=?').run(process.argv[2]);d.close();",c.canonicalPath,b.ownerId],{encoding:'utf8',env:{}});
        if(r.status!==0)throw Error('independent writer failed');
      }
      if(Atomics.load(state,2)===n)Atomics.store(state,0,0);
      return Atomics.load(state,0)===1 && (b.ownerGeneration===undefined || b.ownerGeneration===Atomics.load(state,3));
    },
    counter:{id:'synthetic-exact-characters',countTokens(text){Atomics.store(state,4,threadId);return Array.from(text).length;}},
    // These ports must never be constructed/called by the lexical engine.
    embedder:{embed(){Atomics.add(state,5,1);throw Error('provider called');}},
  };
}
