// Injection-only native rendezvous. Ordinary measurements never load this module.
import sqlite from 'node:sqlite';
import { workerData } from 'node:worker_threads';
const gate=workerData.productQualificationNativeGate;
if(!(gate instanceof SharedArrayBuffer))throw Error('missing_native_injection_gate');
const flags=new Int32Array(gate,0,8),times=new BigInt64Array(gate,32,2);
let holding=false;
function wrap(db) {
  // This callback runs *inside* an actual SQLite SELECT. Its timestamp attests
  // native entry; merely entering a JS observer is insufficient.
  db.function('qualification_native_hold',()=>{
    times[0]=process.hrtime.bigint();Atomics.store(flags,1,1);Atomics.notify(flags,1);
    while(Atomics.load(flags,2)===0)Atomics.wait(flags,2,0,1000);
    times[1]=process.hrtime.bigint();return 1;
  });
  const hold=()=>{
    if(holding||Atomics.compareExchange(flags,0,1,0)!==1)return;
    holding=true;
    try{db.prepare('SELECT qualification_native_hold()').get();}finally{holding=false;}
  };
  return new Proxy(db,{get(target,key){
    if(key==='constructor')return DatabaseSync;
    const value=Reflect.get(target,key,target);
    if(typeof value!=='function')return value;
    if(key==='prepare')return (...args)=>{hold();const statement=Reflect.apply(value,target,args);return new Proxy(statement,{get(s,k){const f=Reflect.get(s,k,s);return typeof f==='function'?(...a)=>{hold();return Reflect.apply(f,s,a);}:f;}});};
    return (...args)=>{if(key!=='close'&&key!==Symbol.dispose)hold();return Reflect.apply(value,target,args);};
  }});
}
export function DatabaseSync(...args) {const db=wrap(Reflect.construct(sqlite.DatabaseSync,args));
  // Constructor entry already belongs to the engine's native open observation.
  if(Atomics.load(flags,0)===1)db.prepare('SELECT 1').get();return db;}
export const {StatementSync,constants,backup}=sqlite;
export default {...sqlite,DatabaseSync};
