import { AsyncResource } from 'node:async_hooks';
import { openMemoryCore } from '../index.mjs';
import { transaction } from '../database.mjs';
import { suppressOwnerInside,writeContentSuppressionInside } from '../content-suppression-storage.mjs';

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
 if(semanticRole&&portState&&Atomics.load(portState,0)===40&&Atomics.load(portState,14)===1&&this.sourceSQL.startsWith('SELECT epoch_hi,epoch_lo FROM owner_suppression_epochs')&&Atomics.compareExchange(portState,15,0,1)===0)
   throw Object.assign(Error('synthetic owner-epoch I/O failure'),{code:'ERR_SQLITE_ERROR',errcode:10});
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
 if(portState)installPortScenario(value,c);
 return value;
}

function installPortScenario(value,c) {
 const state=portState,detached=new AsyncResource('synthetic-detached-provider-callback');
 const armed=()=>Atomics.load(state,0)>0;
 const refused=()=>Atomics.load(state,1)===1||Atomics.load(state,0)===40&&Atomics.load(state,15)===1;
 const returned=()=>{if(!armed())return;if(portPending)Atomics.add(state,6,1);portPending=true;Atomics.add(state,8,1);};
 async function suspend(mode) {
   if(Atomics.load(state,0)!==mode||Atomics.load(state,1))return;
   Atomics.store(state,10,1);Atomics.notify(state,10);
   while(Atomics.load(state,11)===0)await Atomics.waitAsync(state,11,0).value;
 }
 for(const name of ['authorize','isCurrent']){const fn=value[name];value[name]=function(...args){if(Atomics.load(state,0)>=40&&refused()&&(!c.protectedQuery||JSON.stringify(args).includes(c.protectedQuery)))Atomics.add(state,5,1);return Reflect.apply(fn,value,args);};}
 if(value.counter){const fn=value.counter.countTokens;value.counter.countTokens=function(text){if(refused()&&text.includes('semantic probecommon synthetic evidence'))Atomics.add(state,3,1);return Reflect.apply(fn,value.counter,[text]);};}
 if(value.semanticLedgerAuthority){const authority=value.semanticLedgerAuthority;
   const fields=['ownerId','accountingDomainId','ledgerId','ledgerEpoch','bindingRevision','sequence','stateDigest','pending'];
   for(const [name,mode]of [['load',1],['compareAndSwap',2],['listOwners',6],['confirmDisposed',7]]) {
     const fn=authority[name];if(typeof fn!=='function')continue;
     authority[name]=async function(...args){
       if(refused()) {
         const valid=name==='load'?args.length===1&&typeof args[0]==='string':name==='listOwners'?
           Object.keys(args[0]).sort().join(',')==='accountingDomainId,ledgerId':args.every(a=>Object.keys(a).sort().join(',')===[...fields].sort().join(',')&&
             (a.pending===null||Object.keys(a.pending).sort().join(',')==='sequence,stateDigest'));
         if(!valid||/semantic probecommon|absentterm|"(?:texts|query|ref|namespace|content)":/.test(JSON.stringify(args)))Atomics.add(state,9,1);
       }
       const fault=Atomics.load(state,0),afterReturn=Atomics.load(state,14)===1;
       // 40/41 combine an E1 refusal with a failed settlement load. Modes
       // 42..47 fail load/prepare/seal after provider-return materialization;
       // 48 is the same accounting failure without a content refusal.
       const combined=name==='load'&&(fault===40&&Atomics.load(state,15)===1||fault===41&&Atomics.load(state,1)===1);
       const stage=fault>=42&&fault<=48?(fault===48?0:Math.floor((fault-42)/2)):-1;
       const selectedFault=combined||afterReturn&&(stage===0&&name==='load'||stage===1&&name==='compareAndSwap'&&args[1].pending!==null||stage===2&&name==='compareAndSwap'&&args[0].pending!==null&&args[1].pending===null);
       const inject=selectedFault&&Atomics.compareExchange(state,10,0,1)===0;
       if(inject&& (combined||fault===48||fault%2===1)){returned();throw Object.assign(Error('synthetic accounting unavailable'),{code:'index_unavailable'});}
       callerSQL++;let result;try{result=await Reflect.apply(fn,authority,args);}finally{callerSQL--;}
       const selected=Atomics.load(state,0),ordinal=name==='compareAndSwap'&&armed()?Atomics.add(state,13,1)+1:0;
       if(name==='compareAndSwap'&&selected===23&&ordinal===1)await suspend(23);
       if(name==='compareAndSwap'&&([16,17,18].includes(selected)&&ordinal===selected-14||selected===19&&args[0].pending&&args[1].sequence===args[0].sequence))await suspend(selected);
       if(!(name==='load'&&selected===9))await suspend(name==='load'&&selected===8?8:name==='listOwners'&&selected===10?10:mode);
       returned();
       if(name==='listOwners'&&selected===41)commitForget();
       if(inject)return new Proxy(typeof result==='object'?result:Object(result),{get(target,key){if(key!=='then')Atomics.add(state,4,1);return Reflect.get(target,key);}});
       if(name==='compareAndSwap'&&[23,26].includes(selected)&&ordinal===1)return new Proxy(Object(true),{get(target,key){Atomics.add(state,key==='then'?5:4,1);return Reflect.get(target,key);}});
       if(name==='compareAndSwap'&&selected===24&&ordinal===1){const error=Error('synthetic protected error text');Object.defineProperty(error,'code',{get(){Atomics.add(state,4,1);commitGetter();return 'index_unavailable';}});throw error;}
       if(name==='load'&&selected===8)return new Proxy(result,{get(target,key){if(key!=='then')Atomics.add(state,4,1);return Reflect.get(target,key);}});
       if(name==='load'&&selected===9){const sequence=result.sequence;Object.defineProperty(result,'sequence',{get(){Atomics.add(state,4,1);commitGetter();return sequence;},enumerable:true});}
       if(name==='listOwners'&&selected===10)return new Proxy(result,{get(target,key){if(key==='length')Atomics.add(state,4,1);return Reflect.get(target,key);}});
       return result;
     };
   }
 }
 if(value.contextEmbedding){const model=value.contextEmbedding.embedder,fn=model.embed;
   model.embed=async function(...args){
     if(refused())Atomics.add(state,2,1);
     if(Atomics.load(state,0)===33){
       const authority=value.semanticPriceAuthority,current=authority.current,callback=args[1].beforeDispatch;
       Object.defineProperty(authority,'current',{get(){Atomics.add(state,4,1);return current;},configurable:true});
       args[1]={...args[1],beforeDispatch:()=>detached.runInAsyncScope(callback)};
     }
     let result;try{result=await Reflect.apply(fn,model,args);}catch(error){
       if(Atomics.load(state,0)>=42&&Atomics.load(state,0)<=47){
         Object.defineProperty(error,'code',{configurable:true,get(){Atomics.store(state,14,1);commitGetter();return 'provider_error';}});returned();
       }
       if(Atomics.load(state,0)===28){try{args[1].beforeDispatch();}catch{}returned();}
       if(Atomics.load(state,0)===33)returned();throw error;
     }
     await suspend(3);returned();
     const selected=Atomics.load(state,0);
     if(selected>=42&&selected<=48) {
       // A plain vector getter runs while the Worker makes the return inert.
       // Typed-array element access intentionally uses intrinsic operations.
       const vectors=result.map(v=>Array.from(v)),n=vectors[0][0];
       Object.defineProperty(vectors[0],0,{enumerable:true,get(){Atomics.store(state,14,1);if(selected!==48)commitGetter();return n;}});
       return vectors;
     }
     if(Atomics.load(state,0)===4)return result.map(v=>Array.from(v)).map(vector=>{const n=vector[0];Object.defineProperty(vector,0,{get(){Atomics.add(state,4,1);commitGetter();return n;},enumerable:true});return vector;});
     if(Atomics.load(state,0)===11){const error=Error('synthetic protected error text');Object.defineProperty(error,'code',{get(){Atomics.add(state,4,1);commitGetter();return 'provider_error';}});throw error;}
     if(Atomics.load(state,0)===15)return {get then(){Atomics.add(state,4,1);commitGetter();return resolve=>resolve(result);}};
     if(Atomics.load(state,0)===5){await suspend(5);return new Proxy(result,{get(target,key){if(key==='length')Atomics.add(state,4,1);return Reflect.get(target,key);}});}
     return result;
   };
 }
 if(value.semanticPriceAuthority){const authority=value.semanticPriceAuthority,fn=authority.current,model=value.contextEmbedding?.embedder,embed=model?.embed;
   let priceOrdinal=0;
   authority.current=function(...args){
     const selected=Atomics.load(state,0),result=Reflect.apply(fn,authority,args);if(selected===40)Atomics.store(state,14,1);
     if(selected===28&&Atomics.load(state,1))Atomics.add(state,5,1);
     if([22,28].includes(selected)&&++priceOrdinal===(selected===22?2:3))commitGetter();
     if(selected===12){const promise=Promise.resolve(result);Object.defineProperty(promise,'catch',{get(){Atomics.add(state,4,1);return ()=>{};}});return promise;}
     if(selected===13)Object.defineProperty(model,'embed',{get(){Atomics.add(state,4,1);return embed;},configurable:true});
     if(selected===14&&!Atomics.exchange(state,15,1)){delete model.embed;Object.setPrototypeOf(model,new Proxy({embed},{get(target,key){Atomics.add(state,4,1);return Reflect.get(target,key);}}));}
     return result;
   };
 }
 function commitForget(){
   if(Atomics.load(state,1))return;
   callerSQL++;const db=new DatabaseSync(c.canonicalPath);let row;
   try{row=db.prepare('SELECT id,revision,owner_id,scope,project_id FROM memories ORDER BY id LIMIT 1').get();}finally{db.close();}
   const writer=openMemoryCore({path:c.canonicalPath});
   try{const result=writer.forget({namespace:{ownerId:row.owner_id,scope:row.scope,projectId:row.project_id||null},memoryId:row.id,expectedRevision:row.revision});
     if(!result.ok)throw Error('synthetic Memory forget failed');Atomics.store(state,1,1);
   }finally{writer.close();callerSQL--;}
 }
 function commitGetter(){
   if(Atomics.load(state,1))return;
   callerSQL++;const db=new DatabaseSync(c.canonicalPath);
   try{transaction(db,()=>{
     if(!c.factMutation||c.factMutation==='account')suppressOwnerInside(db,{ownerId:c.semanticServiceBinding.ownerId,reason:'account_erasure',actionId:'synthetic-return'});
     else {const row=db.prepare('SELECT id,revision,owner_id,scope,project_id FROM memories ORDER BY id LIMIT 1').get();
       writeContentSuppressionInside(db,{namespace:{ownerId:row.owner_id,scope:row.scope,projectId:row.project_id||null},kind:'memory',key:row.id,actionId:'synthetic-return',
         reason:{forget:'user_forget',correction:'correction_supersession',privacy:'privacy_erase'}[c.factMutation],
         ...(c.factMutation==='correction'?{matchMode:'revision-through',sourceVersion:JSON.stringify(['memory-revision-through-v1',row.revision])}:{})});
     }
   });Atomics.store(state,1,1);}finally{db.close();callerSQL--;}
 }
}
