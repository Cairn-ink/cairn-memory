import { DatabaseSync } from 'node:sqlite';
import { createContextReadHost as baseHost } from './context-product-index-host.mjs';
export async function createContextReadHost(configuration){
  if(configuration.openingFailure){configuration.resourceOwner.register('lease',()=>{throw new RangeError('private disposal text');});throw Object.assign(new Error('private opening text'),{code:'storage_busy'});}
  if(configuration.closingFailure){configuration.resourceOwner.register('lease',()=>{throw new TypeError('private initiating disposal text');});return baseHost(configuration);}
  const control=new Int32Array(configuration.resumeFailure),prepare=DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.prepare=function(sql){
    if(Atomics.load(control,0)&&sql==='SELECT record FROM progress_records WHERE generation=?'){
      Atomics.add(control,1,1);throw new TypeError('synthetic private resume text');
    }
    return Reflect.apply(prepare,this,[sql]);
  };
  return baseHost(configuration);
}
