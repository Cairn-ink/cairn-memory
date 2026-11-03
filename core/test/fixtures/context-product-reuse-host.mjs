import { DatabaseSync } from 'node:sqlite';
import { createContextReadHost as baseHost } from '../../testing/context-product-index-host.mjs';

export async function createContextReadHost(configuration) {
  const control=new Int32Array(configuration.reuseControl),prepare=DatabaseSync.prototype.prepare,exec=DatabaseSync.prototype.exec;
  DatabaseSync.prototype.prepare=function(sql) {
    const statement=Reflect.apply(prepare,this,[sql]);
    const index=sql==='PRAGMA quick_check'?0:sql==='PRAGMA foreign_key_check'?1:-1;
    if(index<0)return statement;
    return new Proxy(statement,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;
      return (...args)=>{if(key==='get')Atomics.add(control,index,1);return Reflect.apply(value,target,args);};}});
  };
  DatabaseSync.prototype.exec=function(sql) {
    if(sql==='BEGIN IMMEDIATE') {
      const fault=Atomics.exchange(control,2,0);
      if(fault===3) {
        Atomics.store(control,3,1);Atomics.notify(control,3);
        while(Atomics.load(control,3)===1)Atomics.wait(control,3,1);
        return Reflect.apply(exec,this,[sql]);
      }
      if(fault)throw Object.assign(Error('synthetic maintenance failure'),{code:fault===2?'read_timeout':'storage_error'});
    }
    return Reflect.apply(exec,this,[sql]);
  };
  return baseHost(configuration);
}
