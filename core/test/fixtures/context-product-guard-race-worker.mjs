import { workerData } from 'node:worker_threads';
import fs from 'node:fs';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

const c=workerData.host.configuration;
if(c.guardRace) {
  const native=fs.lstatSync,state=new Int32Array(c.guardRace.state);let sampled=false;
  fs.lstatSync=function(path,...args) {
    const value=Reflect.apply(native,this,[path,...args]);
    if(!sampled&&path===c.guardRace.path) {
      sampled=true;Atomics.store(state,0,1);Atomics.notify(state,0);
      while(Atomics.load(state,1)===0)if(Atomics.wait(state,1,0,10000)==='timed-out')throw Error('writer commit timed out');
    }
    return value;
  };
}
if(c.guardTimeout) {
  const native=childProcess.spawnSync;
  childProcess.spawnSync=function(...args) {
    if(args[1]?.[2]?.includes('header[18]')) {
      Atomics.store(new Int32Array(c.guardTimeout),0,args[2].timeout);
      return {status:null,error:Object.assign(Error('synthetic child timeout'),{code:'ETIMEDOUT'}),stdout:''};
    }
    return Reflect.apply(native,this,args);
  };
}
syncBuiltinESMExports();
await import('../../context-product-worker.mjs');
