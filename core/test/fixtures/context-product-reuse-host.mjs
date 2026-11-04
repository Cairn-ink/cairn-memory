import { testClock } from '../../testing/context-product-test-clock.mjs';
import { DatabaseSync } from 'node:sqlite';
import { createContextReadHost as baseHost } from '../../testing/context-product-index-host.mjs';

export async function createContextReadHost(configuration) {
  const control=new Int32Array(configuration.reuseControl),prepare=DatabaseSync.prototype.prepare,exec=DatabaseSync.prototype.exec,close=DatabaseSync.prototype.close,hrtime=process.hrtime.bigint;
  const writes=new WeakSet(),sideHandles=new WeakSet(),countSql=control.length>10;
  process.hrtime.bigint=function() {
    if(Atomics.compareExchange(control,6,2,3)===2)throw new TypeError('synthetic post-index failure');
    return hrtime();
  };
  DatabaseSync.prototype.prepare=function(sql) {
    const statement=Reflect.apply(prepare,this,[sql]);
    if(sql==='PRAGMA user_version'&&Reflect.apply(prepare,this,['PRAGMA database_list']).get().file===configuration.reuseSidePath&&!sideHandles.has(this)) {
      sideHandles.add(this);Atomics.add(control,8,1);
    }
    const index=sql==='PRAGMA quick_check'?0:sql==='PRAGMA foreign_key_check'?1:-1;
    if(index<0&&!countSql)return statement;
    // Count executed SQL, excluding prepare and the instrumentation's database_list probe.
    return new Proxy(statement,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;
      return (...args)=>{
        if(countSql&&['get','all','iterate','run'].includes(key))Atomics.add(control,10,1);
        if(key==='get'&&index>=0)Atomics.add(control,index,1);
        return Reflect.apply(value,target,args);
      };}});
  };
  DatabaseSync.prototype.close=function() {
    if(sideHandles.has(this)&&this.isOpen)Atomics.add(control,9,1);
    return Reflect.apply(close,this,[]);
  };
  DatabaseSync.prototype.exec=function(sql) {
    if(countSql)Atomics.add(control,10,sql.split(';').filter(part=>part.trim()).length);
    if(sql==='BEGIN IMMEDIATE') {
      const fault=Atomics.exchange(control,2,0);
      if(fault===3) {
        Atomics.store(control,3,1);Atomics.notify(control,3);
        while(Atomics.load(control,3)===1)Atomics.wait(control,3,1);
        return Reflect.apply(exec,this,[sql]);
      }
      if(fault)throw Object.assign(Error('synthetic maintenance failure'),{code:fault===2?'read_timeout':'storage_error'});
    }
    const result=Reflect.apply(exec,this,[sql]);
    if(sql==='BEGIN IMMEDIATE')writes.add(this);
    if(sql==='COMMIT'&&writes.has(this)) {
      const committed=Atomics.add(control,4,1);writes.delete(this);
      // Spend the first quantum after a successful writable commit, leaving
      // enough budget for a rebuilding result and a second initialization call.
      if(configuration.reuseSplitInitialization&&committed===0)
        void testClock.advance(4900,{waitForWorkers:false});
    }
    if(sql==='ROLLBACK')writes.delete(this);
    return result;
  };
  const host=await baseHost(configuration);
  return {...host,isCurrent(...args){
    const current=host.isCurrent(...args);Atomics.store(control,5,Atomics.load(control,4));
    // Let index.run finish successfully, then fail in the real Worker's
    // post-await clock sample, outside every sidecar/index catch boundary.
    if(Atomics.load(control,4)>Atomics.load(control,7)&&Atomics.compareExchange(control,6,1,4)===1)
      queueMicrotask(()=>Atomics.store(control,6,2));
    return current;
  }};
}
