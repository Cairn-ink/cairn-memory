import { DatabaseSync } from 'node:sqlite';
import { createContextReadHost as baseHost } from './context-product-index-host.mjs';
export async function createContextReadHost(configuration){
  const control=new Int32Array(configuration.resumeFailure),prepare=DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.prepare=function(sql){
    if(Atomics.load(control,0)&&sql==='SELECT record FROM progress_records WHERE generation=?'){
      Atomics.add(control,1,1);throw new TypeError('synthetic private resume text');
    }
    return Reflect.apply(prepare,this,[sql]);
  };
  return baseHost(configuration);
}
