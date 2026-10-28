// Offline synthetic service. Never imports a hosted transport or reads a key.
import { DatabaseSync } from 'node:sqlite';
import { HOSTED_ID } from '../context-semantic-input.mjs';
import { digest, canonicalJson } from '../context-product-validation.mjs';
export async function createContextReadHost(c) {
  const state=new Int32Array(c.state),binding=c.semanticServiceBinding??c.serviceBinding??c.requestBinding;
  const base={authorize(){return binding;},isCurrent(){const n=Atomics.add(state,1,1)+1;return Atomics.load(state,0)===1&&Atomics.load(state,2)!==n;},
    counter:{id:c.counterDivisor?'synthetic-scaled-characters':'synthetic-exact-characters',countTokens(text){if(c.counterBarrier){const barrier=new Int32Array(c.counterBarrier);if(barrier.length>3)Atomics.add(barrier,3,1);if(Atomics.exchange(barrier,0,0)===1){Atomics.store(barrier,1,1);Atomics.notify(barrier,1);while(Atomics.load(barrier,2)===0)Atomics.wait(barrier,2,0);}}if(c.counterThrow)throw Error('synthetic counter fault');return Math.ceil(Array.from(text).length/(c.counterDivisor??1));}}};
  if(!c.semanticServiceBinding)return base;
  if(c.utcClock){const clock=new BigInt64Array(c.utcClock);Date.now=()=>Number(Atomics.load(clock,0));}
  if(c.abortState){const counts=new Int32Array(c.abortState),Controller=globalThis.AbortController;globalThis.AbortController=class extends Controller {constructor(){super();Atomics.add(counts,0,1);}abort(...args){if(!this.signal.aborted)Atomics.add(counts,1,1);return super.abort(...args);}};}
  if(c.killCommit) {
    const original=DatabaseSync.prototype.exec,prepare=DatabaseSync.prototype.prepare;let count=0;
    DatabaseSync.prototype.exec=function(sql){
      const selected=sql==='COMMIT'&&prepare.call(this,'PRAGMA database_list').all().some(r=>r.file.endsWith('.context-read-product-v1.1.sqlite'));
      if(selected&&++count===c.killCommit.ordinal&&c.killCommit.stage==='before')process.kill(process.pid,'SIGKILL');
      const result=Reflect.apply(original,this,[sql]);
      if(selected&&count===c.killCommit.ordinal&&c.killCommit.stage==='after')process.kill(process.pid,'SIGKILL');return result;
    };
  }
  const hooks=c.casHooks?new Int32Array(c.casHooks):null;
  const hrtime=process.hrtime.bigint;
  const expireOnce=()=>{process.hrtime.bigint=()=>{process.hrtime.bigint=hrtime;return 9223372036854775807n;};};
  if(hooks) {
    const prepare=DatabaseSync.prototype.prepare,exec=DatabaseSync.prototype.exec;
    DatabaseSync.prototype.exec=function(sql){
      const selected=sql==='COMMIT'&&Atomics.load(hooks,4)===5&&prepare.call(this,"SELECT 1 FROM sqlite_schema WHERE name='semantic_owners'").get();
      const value=Reflect.apply(exec,this,[sql]);
      if(selected){Atomics.store(hooks,4,0);throw Object.assign(Error('synthetic post-commit fault'),{code:'ERR_SQLITE_ERROR',errcode:10});}
      return value;
    };
    DatabaseSync.prototype.prepare=function(sql) {
      const stmt=Reflect.apply(prepare,this,[sql]);
      if(sql==='SELECT store_id FROM store_metadata WHERE singleton=1') {
        const get=stmt.get;
        stmt.get=function(...args){
          const mode=Atomics.load(hooks,4);if(mode===3||mode===4)Atomics.store(hooks,4,0);
          if(mode===3)throw Object.assign(Error('synthetic native fault'),{code:'ERR_SQLITE_ERROR',errcode:10});
          const value=Reflect.apply(get,this,args);if(mode===4)expireOnce();return value;
        };
      }
      return stmt;
    };
  }
  const policy=c.resourceOwner.sqlitePolicy;
  const anchor=policy.open(new DatabaseSync(c.anchorPath),c.anchorPath).db;
  const load=ownerId=>{Atomics.add(state,14,1);const r=anchor.prepare('SELECT anchor FROM anchors WHERE owner=?').get(ownerId);return r?JSON.parse(r.anchor):null;};
  const compareAndSwap=(expected,next)=>{
    Atomics.add(state,14,1);
    const match=stage=>c.killCAS?.stage===stage&&(next.pending?.sequence??next.sequence)===c.killCAS.sequence&&(!c.killCAS.phase||c.killCAS.phase===(next.pending?'prepare':'seal'));
    if(match('before'))process.kill(process.pid,'SIGKILL');
    anchor.exec('BEGIN IMMEDIATE');
    try {
      const row=load(expected.ownerId);
      if(canonicalJson(row)!==canonicalJson(expected)){anchor.exec('ROLLBACK');return false;}
      anchor.prepare('UPDATE anchors SET anchor=? WHERE owner=?').run(canonicalJson(next),expected.ownerId);anchor.exec('COMMIT');if(match('after'))process.kill(process.pid,'SIGKILL');
      if(hooks&&(next.pending?.sequence??next.sequence)===Atomics.load(hooks,1)) {
        const mode=Atomics.load(hooks,0);
        if(mode===1&&!next.pending){Atomics.store(hooks,0,0);expireOnce();}
        else if(mode===6&&!next.pending){Atomics.store(hooks,0,0);Atomics.store(hooks,4,5);}
        else if(mode>=2&&mode<=5&&next.pending) {
          Atomics.store(hooks,2,1);Atomics.notify(hooks,2);
          return (async()=>{while(Atomics.load(hooks,3)===0)await Atomics.waitAsync(hooks,3,0).value;if(mode>=3)Atomics.store(hooks,4,mode);return true;})();
        }
      }
      return true;
    }catch(error){if(anchor.isTransaction)anchor.exec('ROLLBACK');throw error;}
  };
  const embedder={id:HOSTED_ID,revision:'provider-unversioned',dimensions:1536,normalization:'l2',async embed(texts,controls) {
    Atomics.add(state,4,1);Atomics.add(state,5,texts.length);
    if(Atomics.load(state,7)===6&&c.utcClock)Atomics.store(new BigInt64Array(c.utcClock),0,BigInt(c.priceTable.effectiveUntilUtcMs));
    controls.beforeDispatch();Atomics.add(state,6,1);
    if(c.killAfterSend)process.kill(process.pid,'SIGKILL');
    if(Atomics.load(state,7)===12)process.exit(1);
    if(Atomics.load(state,7)===7){Atomics.store(state,10,1);Atomics.notify(state,10);while(Atomics.load(state,11)===0)await Atomics.waitAsync(state,11,0).value;}
    if(Atomics.load(state,7)===1)throw Object.assign(Error('synthetic canary text credential'),{code:'provider_error'});
    if(Atomics.load(state,7)===2)throw Object.assign(Error('synthetic'),{code:'rate_limited'});
    if(Atomics.load(state,7)===5)throw Object.assign(Error('synthetic'),{code:'provider_unavailable'});
    if(Atomics.load(state,7)===8)controls.settleInputTokens(1000000);
    if(Atomics.load(state,7)!==3)controls.settleInputTokens(texts.reduce((n,text)=>n+Buffer.byteLength(text),0));
    return texts.map(text=>{const v=new Float32Array(Atomics.load(state,7)===4?3:1536);v[text.includes('semantic')||/語意|意味/.test(text)?1:0]=1;return v;});
  }};
  Atomics.add(state,12,1);
  return {...base,isCurrent(){const a=load(binding.ownerId);return base.isCurrent()&&a?.ledgerEpoch===binding.ledgerEpoch&&a?.bindingRevision===binding.bindingRevision;},
    contextEmbedding:c.localRuntime?{embedder:{...embedder,id:'local:bge-m3:dense',revision:'synthetic',dimensions:1024},policy:c.localRuntime==='identity'?{family:'hosted',maxRequests:100,maxConcurrent:1,maxUsd:100}:{family:'local',maxRequests:100,maxConcurrent:1,maxBatchDocuments:1},...(c.localRuntime==='shape'?{localStatus(){Atomics.add(state,8,1);}}:{})}:
      {embedder,policy:{family:'hosted',maxRequests:c.maxRequests??100000,maxConcurrent:c.maxConcurrent??4,maxUsd:100}},
    semanticLedgerAuthority:{load,compareAndSwap,
      // Independent anchors are permanent enrollment records, never ledger
      // discovery. A missing ledger row cannot remove an anchored member.
      listOwners({accountingDomainId,ledgerId}){return anchor.prepare("SELECT owner FROM anchors WHERE json_extract(anchor,'$.accountingDomainId')=? AND json_extract(anchor,'$.ledgerId')=? ORDER BY owner").all(accountingDomainId,ledgerId).map(row=>row.owner);},
      confirmDisposed:()=>c.recovery===true},
    semanticPriceAuthority:{current(){Atomics.add(state,15,1);if(Atomics.load(state,9))return null;const p=c.priceState&&Atomics.load(new Int32Array(c.priceState),0)?c.nextPriceTable:c.priceTable;return {authorityId:p.authorityId,revision:p.revision,sequence:p.sequence,tableDigest:digest(p),effectiveFromUtcMs:p.effectiveFromUtcMs,effectiveUntilUtcMs:p.effectiveUntilUtcMs};}},
    close(){anchor.close();Atomics.add(state,13,1);}};
}
