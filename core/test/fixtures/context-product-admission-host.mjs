import { testClock } from '../../testing/context-product-test-clock.mjs';
import { DatabaseSync } from 'node:sqlite';
import { createContextReadHost as baseHost } from '../../testing/context-product-index-host.mjs';

export async function createContextReadHost(configuration) {
  const c=new Int32Array(configuration.admissionControl),prepare=DatabaseSync.prototype.prepare,exec=DatabaseSync.prototype.exec;
  const handles=new Set();
  DatabaseSync.prototype.prepare=function(sql){
    handles.add(this);const stmt=Reflect.apply(prepare,this,[sql]);
    const slot=sql==='PRAGMA quick_check'?0:sql==='PRAGMA foreign_key_check'?1:
      !sql.startsWith('SELECT substr(record,')&&!/^SELECT 1 FROM (?:publications p|work w) LEFT JOIN/.test(sql)&&/\bFROM (?:memories|documents|postings|statistics|generations|work|publications|progress_records|validation_records|selections)\b/i.test(sql)?2:-1;
    return new Proxy(stmt,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;
      return (...args)=>{
        if(['get','all','iterate','run'].includes(key)){
          if(slot>=0)Atomics.add(c,slot,1);
          const attestation=sql==='SELECT CAST(stamp AS TEXT) AS stamp,typeof(stamp) AS stampType,record FROM product_attestation WHERE singleton=1';
          if(attestation)Atomics.add(c,8,1);
          if(attestation&&Atomics.compareExchange(c,7,1,2)===1){Atomics.notify(c,7);while(Atomics.load(c,7)===2)Atomics.wait(c,7,2);}
          if(attestation&&Atomics.load(c,5))void testClock.advance(Atomics.exchange(c,5,0),{waitForWorkers:false});
        }
        return Reflect.apply(value,target,args);
      };}});
  };
  DatabaseSync.prototype.exec=function(sql){
    handles.add(this);
    if(sql==='BEGIN IMMEDIATE'&&Atomics.exchange(c,4,0))throw Object.assign(Error('synthetic writable failure'),{code:'storage_error'});
    return Reflect.apply(exec,this,[sql]);
  };
  const base=await baseHost(configuration);
  return {...base,isCurrent(...args){
    // Final authority sampling occurs after admission released its snapshots.
    if(Atomics.load(c,3))for(const db of handles)if(db.isOpen&&db.isTransaction)Atomics.add(c,6,1);
    return base.isCurrent(...args);
  }};
}
