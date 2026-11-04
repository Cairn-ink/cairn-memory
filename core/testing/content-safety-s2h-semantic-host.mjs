
import { DatabaseSync,StatementSync } from 'node:sqlite';
import { createContextReadHost as original } from './context-semantic-host.mjs';
let counters,portState,semanticRole=false,portPending=false,callerSQL=0;const hosts=new WeakSet(),connections=new WeakMap();
const prepare=DatabaseSync.prototype.prepare,exec=DatabaseSync.prototype.exec;
function record(sql,db){
 if(semanticRole&&portState&&Atomics.load(portState,0)&&!callerSQL&&sql.startsWith('SELECT epoch_hi,epoch_lo FROM owner_suppression_epochs'))Atomics.add(portState,12,1);
 if(portPending&&!callerSQL){portPending=false;Atomics.add(portState,sql.startsWith('SELECT epoch_hi,epoch_lo FROM owner_suppression_epochs')&&!db.isTransaction?7:6,1);}

 if(!counters||!Atomics.load(counters,0))return;
 const host=hosts.has(db);Atomics.add(counters,host?3:1,1);
 if(/^BEGIN/.test(sql.trim()))Atomics.add(counters,host?4:2,1);
 if(sql.startsWith('SELECT epoch_hi,epoch_lo FROM owner_suppression_epochs'))Atomics.add(counters,9,1);
 if(sql.startsWith('SELECT schema_version AS cookie,(SELECT user_version FROM pragma_user_version) AS physical,'))Atomics.add(counters,10,1);
 if(process.env.CAIRN_S2H_SQL_REPORT==='1')console.log(JSON.stringify({tag:'S2H_PRODUCT_SQL',sql,host,semanticRole,transaction:db.isTransaction}));

}
DatabaseSync.prototype.prepare=function(sql){if(/\banchors\b|\benrollments\b/.test(sql))hosts.add(this);const st=Reflect.apply(prepare,this,[sql]);connections.set(st,this);return st;};
for(const key of ['get','all','iterate','run']){const native=StatementSync.prototype[key];StatementSync.prototype[key]=function(...args){record(this.sourceSQL,connections.get(this));
 if(key==='run'&&portState&&Atomics.load(portState,0)===19&&!Atomics.load(portState,14)&&this.sourceSQL.startsWith('UPDATE semantic_owners SET sequence=')){
   Atomics.store(portState,14,1);throw Object.assign(Error('synthetic native admission failure'),{code:'ERR_SQLITE_ERROR',errcode:10});
 }
 return Reflect.apply(native,this,args);};}
DatabaseSync.prototype.exec=function(sql){for(const part of sql.split(';').filter(s=>s.trim()))record(part,this);return Reflect.apply(exec,this,[sql]);};
export async function createContextReadHost(c){
 counters=new Int32Array(c.semanticMeter??new SharedArrayBuffer(64));portState=c.portState?new Int32Array(c.portState):null;semanticRole=Boolean(c.semanticServiceBinding);
 const value=await original(c);
 const wrap=(target,key,at)=>{const fn=target[key];if(typeof fn!=='function')return;target[key]=function(...args){if(Atomics.load(counters,0)){Atomics.add(counters,8,1);if(at)Atomics.add(counters,at,1);}return Reflect.apply(fn,target,args);};};
 for(const key of ['authorize','isCurrent'])wrap(value,key);
 wrap(value.counter,'countTokens',5);
 if(value.contextEmbedding)wrap(value.contextEmbedding.embedder,'embed',6);
 if(value.semanticLedgerAuthority)for(const key of ['load','compareAndSwap','listOwners','confirmDisposed'])wrap(value.semanticLedgerAuthority,key,7);
 if(value.semanticPriceAuthority)wrap(value.semanticPriceAuthority,'current');
 return value;
}
