// Offline synthetic service. Never imports a hosted transport or reads a key.
import { DatabaseSync } from 'node:sqlite';
import { HOSTED_ID } from '../context-semantic-input.mjs';
import { digest, canonicalJson } from '../context-product-validation.mjs';
export async function createContextReadHost(c) {
  const state=new Int32Array(c.state),binding=c.semanticServiceBinding??c.serviceBinding??c.requestBinding;
  const base={authorize(){return binding;},isCurrent(){const n=Atomics.add(state,1,1)+1;return Atomics.load(state,0)===1&&Atomics.load(state,2)!==n;},
    counter:{id:'synthetic-exact-characters',countTokens:text=>Array.from(text).length}};
  if(!c.semanticServiceBinding)return base;
  if(c.localRuntime)return {...base,contextEmbedding:{embedder:{id:'local:bge-m3:dense',revision:'synthetic',dimensions:1024,normalization:'l2',embed(){Atomics.add(state,4,1);}},policy:{family:'local',maxRequests:100,maxConcurrent:1,maxBatchDocuments:1},localStatus(){Atomics.add(state,8,1);}}};
  if(c.utcClock){const clock=new BigInt64Array(c.utcClock);Date.now=()=>Number(Atomics.load(clock,0));}
  if(c.killCommit) {
    const original=DatabaseSync.prototype.exec,prepare=DatabaseSync.prototype.prepare;let count=0;
    DatabaseSync.prototype.exec=function(sql){
      const selected=sql==='COMMIT'&&prepare.call(this,'PRAGMA database_list').all().some(r=>r.file.endsWith('.context-read-product-v1.1.sqlite'));
      if(selected&&++count===c.killCommit.ordinal&&c.killCommit.stage==='before')process.kill(process.pid,'SIGKILL');
      const result=Reflect.apply(original,this,[sql]);
      if(selected&&count===c.killCommit.ordinal&&c.killCommit.stage==='after')process.kill(process.pid,'SIGKILL');return result;
    };
  }
  const policy=c.resourceOwner.sqlitePolicy;
  const anchor=policy.open(new DatabaseSync(c.anchorPath),c.anchorPath).db;
  const load=ownerId=>{const r=anchor.prepare('SELECT anchor FROM anchors WHERE owner=?').get(ownerId);return r?JSON.parse(r.anchor):null;};
  const compareAndSwap=(expected,next)=>{
    const match=stage=>c.killCAS?.stage===stage&&(next.pending?.sequence??next.sequence)===c.killCAS.sequence&&(!c.killCAS.phase||c.killCAS.phase===(next.pending?'prepare':'seal'));
    if(match('before'))process.kill(process.pid,'SIGKILL');
    anchor.exec('BEGIN IMMEDIATE');
    try {
      const row=load(expected.ownerId);
      if(canonicalJson(row)!==canonicalJson(expected)){anchor.exec('ROLLBACK');return false;}
      anchor.prepare('UPDATE anchors SET anchor=? WHERE owner=?').run(canonicalJson(next),expected.ownerId);anchor.exec('COMMIT');if(match('after'))process.kill(process.pid,'SIGKILL');return true;
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
  return {...base,isCurrent(){const a=load(binding.ownerId);return base.isCurrent()&&a?.ledgerEpoch===binding.ledgerEpoch&&a?.bindingRevision===binding.bindingRevision;},
    contextEmbedding:{embedder,policy:{family:'hosted',maxRequests:c.maxRequests??100000,maxConcurrent:4,maxUsd:100}},
    semanticLedgerAuthority:{load,compareAndSwap,confirmDisposed:()=>c.recovery===true},
    semanticPriceAuthority:{current(){if(Atomics.load(state,9))return null;const p=c.priceTable;return {authorityId:p.authorityId,revision:p.revision,sequence:p.sequence,tableDigest:digest(p),effectiveFromUtcMs:p.effectiveFromUtcMs,effectiveUntilUtcMs:p.effectiveUntilUtcMs};}},
    close(){anchor.close();}};
}
