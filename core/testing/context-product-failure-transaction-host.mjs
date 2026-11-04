import { DatabaseSync } from 'node:sqlite';
import { createContextReadHost as baseHost } from './context-product-index-host.mjs';
export async function createContextReadHost(configuration){
  const state=new Int32Array(configuration.transactionFailure),exec=DatabaseSync.prototype.exec,writers=new WeakSet();
  DatabaseSync.prototype.exec=function(sql){
    if(sql==='BEGIN IMMEDIATE')writers.add(this);
    if(sql==='COMMIT'&&writers.has(this)&&Atomics.compareExchange(state,0,0,1)===0){
      const db=this,record=()=>Atomics.add(state,db.isTransaction?1:2,1);
      throw new Proxy(new TypeError('private transaction failure'),{
        getPrototypeOf(target){record();return Reflect.getPrototypeOf(target);},
        getOwnPropertyDescriptor(target,key){record();return Reflect.getOwnPropertyDescriptor(target,key);},
      });
    }
    return Reflect.apply(exec,this,[sql]);
  };
  return baseHost(configuration);
}
