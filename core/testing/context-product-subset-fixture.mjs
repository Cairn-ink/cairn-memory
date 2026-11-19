import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';
import { fixture } from './context-read-fixture.mjs';
import { descriptor, card } from './context-product-owner-fixture.mjs';
import { contextReadSet } from '../context-read-input.mjs';
import { PRODUCT_PROFILE } from '../context-product-control.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { productSidecar, PRODUCT_SIDECAR_SUFFIX } from '../context-product-sidecar.mjs';
import { productVectors } from '../context-product-vectors.mjs';
import { openProductIndex } from '../context-product-index.mjs';
import { accessDigest } from '../context-product-validation.mjs';
import { maintenanceQuantum } from '../context-product-quantum.mjs';
import { HOSTED_ID, MODEL } from '../context-semantic-input.mjs';

export const personal={ownerId:'synthetic-subset-owner',scope:'personal',projectId:null};
export const project=projectId=>({...personal,scope:'project',projectId});
export const publication=[personal,project('a'),project('b')];
export const vector=(first=1)=>Array.from({length:1536},(_,i)=>i===0?first:i===1?Math.sqrt(1-first*first):0);
export const snapshot={identity:{provider:'openai',model:MODEL,id:HOSTED_ID,revision:'provider-unversioned',dimensions:1536,normalization:'l2'},policy:{semantic:true,purgeEpoch:0}};
export const bare=code=>({ok:false,error:{code,retryable:false}});
export const ok=result=>{assert.equal(result.ok,true,JSON.stringify(result));return result.value;};
export const stable=value=>JSON.stringify(value,(key,v)=>key==='timings'?{}:v);
export { card };

// All ranking/SQL/evidence work is native. Only authority and semantic service
// ports are synthetic here; a separate Worker integration exercises issuance.
export function subsetFixture(t,{readSet=publication,cards=false,safety=false,seed,semantic=false,rawSearch,authorize,vectorOf=()=>vector(),omitted=7,fixtureFactory=fixture,operationWindowMs=5000}={}) {
  const f=fixtureFactory(t,{cards,coreOptions:safety?{contentSafety:'s2h-v1'}:{}});
  readSet=contextReadSet(readSet,PRODUCT_PROFILE);
  const rows=seed?seed(f):readSet.map((ns,i)=>f.admit('orchard shared '+i,ns));
  const facade=openContextProductFacade(f.path,{}),ownerCoverage=descriptor(readSet,omitted),types=cards?['memory','card']:['memory'];
  const p={readSet,types,intent:'current',ownerCoverage,deadlineAt:Infinity};
  const access=accessDigest({ownerId:readSet[0].ownerId,namespaces:{readSet}});
  const storage=productSidecar({path:f.path,db:facade.port.db,identity:facade.port.identity,features:facade.port.features,writable:true});
  const build=(intent='current')=>{
    const selected={...p,intent};
    for(let i=0;i<10000;i++){
      storage.refresh(selected,access,{maxItems:1024,maxMs:5000});
      const observed=facade.port.read(()=>storage.observe(selected,access));
      if(observed.dto.lexical.state==='ready')return observed.publication;
    }
    assert.fail('publication did not complete');
  };
  const lexical=build(),vectors=productVectors({storage,facade});
  const certify=(intent='current',record=lexical)=>{
    const selected={...p,intent};
    for(let i=0;i<10000;i++){
      const planned=vectors.plan(selected,record,snapshot,64);if(!planned.length)break;
      vectors.put(selected,record,snapshot,planned,planned.map(vectorOf));
      assert.ok(i<9999);
    }
    const now=()=>performance.now();
    for(let i=0;i<10000;i++)if(vectors.certify(selected,record,snapshot,maintenanceQuantum({now,cutoff:now()+5000,maxMs:5000})))return;
    assert.fail('vectors did not complete');
  };
  if(semantic)certify();
  const calls={authorize:[],provider:0,counter:[],raw:0};
  let policy={...snapshot.policy},providerError=null;
  const service={snapshot:async()=>({...snapshot,policy}),gate:{check(){},enter(){return ()=>{};}},
    configuration:{queryEmbeddingMaxMs:3000,selection:{requestTimeoutMs:3000},finalizeReserveMs:1000},
    async call(method,input){assert.equal(method,'embed');calls.provider++;if(providerError)throw Object.assign(Error(providerError),{code:providerError});assert.deepEqual(input.projection.readSet,readSet);return {vectors:[vector()]};}};
  const index=openProductIndex({path:f.path,facade,ownerCoverage,maintenance:false,
    authorize(method,payload){calls.authorize.push({method,payload});if(authorize)return authorize(method,payload);return {accessGenerations:access,check(){},envelope:work=>work()};},
    counter:{id:'synthetic-subset',countTokens(text){calls.counter.push(text);return Math.ceil(text.length/4);}},rawSearch,
    ...(semantic?{semantic:service,operation:()=>({operationCutoffMonoNs:String(process.hrtime.bigint()+BigInt(operationWindowMs)*1000000n)})}:{})});
  t.after(()=>{index.close();storage.close();facade.close();});
  const query={readSet,types,intent:'current',query:'orchard',semantic:false,deadlineMs:5000};
  const side=()=>new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX);
  return {f,rows,facade,storage,lexical,vectors,certify,build,p,access,index,calls,query,readSet,side,
    setPolicy(value){policy=value;},setProviderError(value){providerError=value;},
    run(method,patch={}){return index.run(method,{...query,...patch},{opaque:'synthetic'});}};
}

// Measures native invocations and actual rows returned by SQLite, not a count
// inferred from LIMITs. Callers report plans separately for internal visits.
export function sqlMeter() {
  const prepare=DatabaseSync.prototype.prepare,exec=DatabaseSync.prototype.exec,events=[];
  let active=false;
  DatabaseSync.prototype.prepare=function(sql){
    const statement=prepare.call(this,sql);
    return new Proxy(statement,{get(target,key){const value=Reflect.get(target,key,target);if(!['all','get','run'].includes(key))return typeof value==='function'?value.bind(target):value;
      return (...args)=>{const result=Reflect.apply(value,target,args);if(active)events.push({sql,args,method:key,rows:key==='all'?result.length:key==='get'?Number(result!==undefined):0});return result;};}});
  };
  DatabaseSync.prototype.exec=function(sql){const result=exec.call(this,sql);if(active)events.push({sql,method:'exec',rows:0});return result;};
  return {async measure(work){events.length=0;active=true;const start=performance.now();try{return {value:await work(),events:events.slice(),wallMs:performance.now()-start};}finally{active=false;}},
    close(){DatabaseSync.prototype.prepare=prepare;DatabaseSync.prototype.exec=exec;}};
}
