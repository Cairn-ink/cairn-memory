import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { createContextReadHost as offlineHost } from '../../testing/context-semantic-host.mjs';

export async function createContextReadHost(c) {
  if(c.replacementControl) {
    const state=new Int32Array(c.replacementControl),spawn=childProcess.spawnSync;
    childProcess.spawnSync=function(command,args,...rest) {
      if(args?.includes('replace-product-cache')) {
        Atomics.add(state,0,1);
        if(Atomics.load(state,1)===1) {
          // Inside the real lexical replacement guard, before the native
          // helper takes its lifecycle lock or performs a rename.
          Atomics.store(state,2,1);Atomics.notify(state,2);
          let waits=0;
          while(Atomics.load(state,3)===0) {
            if(waits++>=100)throw Error('replacement rendezvous timed out');
            Atomics.wait(state,3,0,100);
          }
        }
      }
      return Reflect.apply(spawn,this,[command,args,...rest]);
    };
    syncBuiltinESMExports();
  }
  return offlineHost(c);
}
