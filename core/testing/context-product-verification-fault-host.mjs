import { DatabaseSync } from 'node:sqlite';
import { createContextReadHost as baseHost } from './context-product-index-host.mjs';

export async function createContextReadHost(configuration) {
  if(configuration.verificationStartupPause) {
    // Controlled scheduling delay; the injected operation clock does not advance.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,6000);
    Atomics.add(new Int32Array(configuration.verificationStartupPause),0,1);
  }
  if(configuration.verificationFault) {
    const state=new Int32Array(configuration.verificationFault),exec=DatabaseSync.prototype.exec,prepare=DatabaseSync.prototype.prepare,writers=new WeakSet();
    DatabaseSync.prototype.prepare=function(sql) {
      if(sql.startsWith('SELECT * FROM documents WHERE generation=?')&&sql.includes('ORDER BY identity LIMIT'))Atomics.store(state,0,1);
      return prepare.call(this,sql);
    };
    DatabaseSync.prototype.exec=function(sql) {
      if(sql==='BEGIN IMMEDIATE'&&this.prepare('PRAGMA application_id').get().application_id===0x43525032)writers.add(this);
      if(writers.has(this)&&Atomics.load(state,0)) {
        if(sql==='COMMIT'&&Atomics.compareExchange(state,1,0,1)===0)throw configuration.verificationCodedPrimary
          ?Object.assign(new Error('initiating verification failure'),{code:'ERR_SQLITE_ERROR',errcode:10})
          :new TypeError('initiating verification failure');
        if(sql==='ROLLBACK'&&Atomics.load(state,1)&&Atomics.compareExchange(state,2,0,1)===0) {
          const db=this,record=()=>Atomics.add(state,db.isOpen&&db.isTransaction?3:4,1);
          // Fail before rollback; the write helper must close before reflection.
          throw new Proxy(new RangeError('secondary verification failure'),{
            getPrototypeOf(target){record();return Reflect.getPrototypeOf(target);},
            getOwnPropertyDescriptor(target,key){record();return Reflect.getOwnPropertyDescriptor(target,key);}
          });
        }
      }
      const result=exec.call(this,sql);if(sql==='COMMIT'||sql==='ROLLBACK')writers.delete(this);return result;
    };
  }
  return baseHost(configuration);
}
