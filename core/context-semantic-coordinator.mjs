import { Worker, MessageChannel } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { ownData } from './local-authority-input.mjs';
import { supervisorOwner } from './context-read-supervisor.mjs';
import { boundedData, hostConfiguration, credentialDigest, requestRecord, operationRecord, mono } from './context-product-control.mjs';
import { SEMANTIC_VERSION, hostedSelection, ledgerIdentity, caps, priceTable, backfillTargets, semanticBinding, safePath, semanticOperationInput, exact } from './context-semantic-input.mjs';
import { deadline } from './context-product-control.mjs';
import { productFailure, signalAborted, signalCancelled } from './context-product-reader.mjs';
import { fail } from './validation.mjs';
import { semanticClient } from './context-semantic-client.mjs';
import { addAbortListener } from 'node:events';

const handles=globalThis[Symbol.for('context-read-product-p2e-v1/handles')]??=new WeakMap();
const coordinatorsKey=Symbol.for('context-read-product-p2e-v1/coordinators');
export function semanticHandle(value) {const h=handles.get(value);if(!h||h.closed())fail('invalid_input');return h;}
export function semanticConfiguration(value,{maintenance=false,requestMaxMs=5000}={}) {
  const c=exact(value,maintenance?'version,coordinator':'version,coordinator,queryEmbeddingMaxMs,finalizeReserveMs');
  if(c.version!==SEMANTIC_VERSION)fail('invalid_input');
  const handle=semanticHandle(c.coordinator);
  if(!maintenance) {
    if(!Number.isSafeInteger(c.queryEmbeddingMaxMs)||c.queryEmbeddingMaxMs<1||c.queryEmbeddingMaxMs>5000)fail('invalid_input');
    if(!Number.isSafeInteger(c.finalizeReserveMs)||c.finalizeReserveMs<1||c.finalizeReserveMs>4999||c.queryEmbeddingMaxMs+c.finalizeReserveMs>requestMaxMs)fail('invalid_input');
  }
  const writerKey=Symbol.for('context-read-product-p2e-v1/writer-sequence');
  const writer=(globalThis[writerKey]??0n)+1n;globalThis[writerKey]=writer;
  return {handle,configuration:{version:SEMANTIC_VERSION,selection:handle.selection,providerIdentity:handle.providerIdentity,ownerState:handle.ownerState,cancellation:new SharedArrayBuffer(4),writer:String(writer),...(!maintenance?{queryEmbeddingMaxMs:c.queryEmbeddingMaxMs,finalizeReserveMs:c.finalizeReserveMs}:{})}};
}
export async function openContextSemanticCoordinator(original,controls={}) {
  const entered=process.hrtime.bigint(),utc=Date.now();
  const c=ownData(original,['version','supervisor','ledgerPath','ledgerIdentity','host','provider','refreshCaps','backfillTargets','priceTable','deadlineMs']);
  // Selection precedes ownership, module loading, file work and registration.
  const provider=hostedSelection(c.provider);
  if(c.version!==SEMANTIC_VERSION)fail('invalid_input');
  const identity=ledgerIdentity(c.ledgerIdentity),refreshCaps=caps(c.refreshCaps),prices=priceTable(c.priceTable),targets=backfillTargets(c.backfillTargets);
  safePath(c.ledgerPath);
  const host=ownData(c.host,['moduleUrl','configuration']);
  let moduleUrl;try{if(typeof host.moduleUrl!=='string'||fileURLToPath(host.moduleUrl).includes('\0'))fail('invalid_input');moduleUrl=pathToFileURL(resolve(fileURLToPath(host.moduleUrl))).href;}catch{fail('invalid_input');}
  const configuration=hostConfiguration(host.configuration),binding=semanticBinding(configuration.semanticServiceBinding,identity);
  if(targets.some(t=>t.readSet[0].ownerId!==binding.ownerId))fail('authority_required');
  const {signal}=ownData(controls,['signal']);if(signalAborted(signal))fail('read_cancelled');
  const {owner,registry}=supervisorOwner(c.supervisor),all=globalThis[coordinatorsKey]??=new Map();
  const key=JSON.stringify([identity,binding.ownerId]);if(all.has(key))fail('read_in_progress');
  const request=(at=process.hrtime.bigint())=>requestRecord({requestId:randomUUID(),handleId:randomUUID(),credentialBindingId:binding.credentialBindingId,
    credentialExpiresUtcMs:binding.credentialExpiresUtcMs,requestMaxMs:5000},at,Date.now());
  const first=requestRecord({requestId:randomUUID(),handleId:randomUUID(),credentialBindingId:binding.credentialBindingId,credentialExpiresUtcMs:binding.credentialExpiresUtcMs,requestMaxMs:5000},entered,utc);
  const firstOperation=operationRecord(first,entered,deadline(c.deadlineMs??5000),1);
  const ownerState=new SharedArrayBuffer(64),policyRegistry=globalThis[Symbol.for('context-read-product-p2e-v1/identity-policy')]??=new Map();
  const policyKey='openai:text-embedding-3-small:provider-unversioned';
  const policyLedger=JSON.stringify(identity);
  const physicalPolicies=globalThis[Symbol.for('context-read-product-p2e-v1/physical-policy')]??=new Map();
  const policyConflict=policyRegistry.has(policyKey)&&policyRegistry.get(policyKey)!==policyLedger,newPolicyBinding=!policyRegistry.has(policyKey);
  const data={ledgerPath:c.ledgerPath,ledgerIdentity:identity,provider,refreshCaps,priceTable:prices,backfillTargets:targets,ownerState,
    host:{moduleUrl,configuration},binding,request:first,operation:firstOperation};hostConfiguration(data);
  const resourceDomain=SEMANTIC_VERSION+'/coordinator';
  const resources=new SharedArrayBuffer(16),resource=registry.register(owner,{path:c.ledgerPath,domain:resourceDomain,resources});
  if(policyConflict){registry.finish(resource);throw Object.assign(Error('index_unavailable'),{code:'index_unavailable',cleanupId:resource.id});}
  policyRegistry.set(policyKey,policyLedger);
  const pending=new Map();let worker,exited=false,closed=false,closing,opened=false,readyResolve,readyReject,providerIdentity;
  const ready=new Promise((r,j)=>{readyResolve=r;readyReject=j;});
  all.set(key,resource);
  function reject(code,finished=false) {
    for(const p of pending.values()){clearTimeout(p.timer);p.detach?.();p.resolve(productFailure(code));if(finished)registry.finish(p.record);}
    if(finished)pending.clear();readyReject(Object.assign(Error(code),{code,cleanupId:resource.id}));
  }
  async function stop() {
    if(closing)return closing;
    closed=true;Atomics.store(new BigInt64Array(ownerState),6,1n);registry.cleanup(resource);
    return closing=(async()=>{
      if(worker&&!exited) {
        await new Promise((resolve,reject)=>{
          worker.ref();worker.once('exit',code=>code===0?resolve():reject(Error('reader_failed')));worker.once('error',reject);worker.postMessage({kind:'close'});
        }).then(()=>registry.finish(resource),()=>registry.finish(resource,false));
      } else registry.finish(resource);
      all.delete(key);reject('store_closed',true);await resource.delivery;
    })();
  }
  resource.stop=()=>{void stop().catch(()=>{});};
  function failOpening(code) {
    if(opened||closed)return;closed=true;clearTimeout(timeout);registry.cleanup(resource);reject(code);
    if(worker)worker.terminate().then(()=>registry.finish(resource),()=>registry.finish(resource,false));else registry.finish(resource);
  }
  const timeout=setTimeout(()=>failOpening('read_timeout'),Math.max(0,Number(mono(firstOperation.operationCutoffMonoNs)-process.hrtime.bigint())/1e6));
  const openingAbort=signal?addAbortListener(signal,()=>failOpening('read_cancelled')):null;
  try {
    if(signalCancelled(signal))failOpening('read_cancelled');
    if(owner.closed)failOpening('store_closed');
    if(closed){await ready;fail('store_closed');}
    resource.workerStopped=false;resource.nativeDisposed=false;
    worker=new Worker(new URL('./context-semantic-worker.mjs',import.meta.url),{workerData:{...data,resources},env:{},execArgv:[],stdout:true,stderr:true,resourceLimits:{maxOldGenerationSizeMb:192}});
    worker.stdout.resume();worker.stderr.resume();
    worker.on('error',()=>reject('reader_failed'));
    worker.on('exit',code=>{exited=true;if(!closed){closed=true;registry.cleanup(resource);registry.finish(resource,true);all.delete(key);reject('reader_failed',true);}});
    worker.on('message',message=>{
      if(message.kind==='identity') {
        try {
          if(typeof message.identity!=='string'||!/^\d+:\d+$/.test(message.identity)||JSON.stringify(message.operation)!==JSON.stringify(firstOperation))fail('reader_failed');
          // A logical ID cannot bind a second accounting file and multiply the
          // process-wide allowance, including after the first service closes.
          if(physicalPolicies.has(policyKey)&&physicalPolicies.get(policyKey)!==message.identity)fail('index_unavailable');
          physicalPolicies.set(policyKey,message.identity);
          registry.bind(resource,message.identity);worker.postMessage({kind:'identity-ack',operation:firstOperation});
        }catch(error){closed=true;registry.cleanup(resource);reject(error.code??'reader_failed');worker.terminate().then(()=>registry.finish(resource),()=>registry.finish(resource,false));}
        return;
      }
      if(message.kind==='ready') {
        clearTimeout(timeout);
        if(closed||process.hrtime.bigint()>=mono(firstOperation.operationCutoffMonoNs))return;
        if(!message.result?.ok){closed=true;registry.cleanup(resource);reject(message.result?.error?.code??'reader_failed');worker.terminate().then(()=>registry.finish(resource),()=>registry.finish(resource,false));all.delete(key);return;}
        providerIdentity=message.result.value.identity;opened=true;readyResolve();return;
      }
      const p=pending.get(message.id);if(!p)return;
      pending.delete(message.id);clearTimeout(p.timer);p.detach?.();
      let result=message.result;
      try{boundedData(result,65536);}catch{result=productFailure('reader_failed');}
      registry.finish(p.record);
      if(process.hrtime.bigint()>=mono(p.operation.operationCutoffMonoNs))result=productFailure('read_timeout');
      if(signalCancelled(p.signal))result=productFailure('read_cancelled');p.resolve(result);
    });
    await ready;
  } catch(error){clearTimeout(timeout);if(!closed){closed=true;registry.cleanup(resource);await worker?.terminate();registry.finish(resource);}all.delete(key);
    if(newPolicyBinding&&![...all.keys()].some(key=>JSON.stringify(JSON.parse(key)[0])===policyLedger))policyRegistry.delete(policyKey);
    throw error;}finally{openingAbort?.[Symbol.dispose]();}
  function call(method,input,credential,control={}) {
    const at=process.hrtime.bigint();
    try {
      if(closed)return Promise.resolve(productFailure('store_closed'));
      const value=semanticOperationInput(method,input);
      if(!binding.methods.includes(method)||credential===undefined||credentialDigest(credential)!==binding.credentialDigest)fail('authority_required');
      const token=boundedData(credential,16384),{signal}=ownData(control,['signal']);
      if(signalAborted(signal))return Promise.resolve(productFailure('read_cancelled'));
      const r=request(at),operation=operationRecord(r,at,deadline(value.budget?.maxMs??value.deadlineMs??5000),1),id=randomUUID();
      const record=registry.register(owner,{path:c.ledgerPath,domain:resourceDomain,parent:resource});
      return new Promise(resolve=>{
        const p={resolve,record,operation,signal};pending.set(id,p);
        const cancelled=()=>{resolve(productFailure('read_cancelled'));worker.postMessage({kind:'cancel',id});};
        signal?.addEventListener('abort',cancelled,{once:true});p.detach=()=>signal?.removeEventListener('abort',cancelled);
        p.timer=setTimeout(()=>{resolve(productFailure('read_timeout'));worker.postMessage({kind:'cancel',id});},Math.max(0,Number(mono(operation.operationCutoffMonoNs)-process.hrtime.bigint())/1e6));
        worker.postMessage({kind:'call',id,method,input:value,credential:token,request:r,operation});
      });
    }catch(error){return Promise.resolve(productFailure(error.code));}
  }
  const api=Object.freeze(Object.fromEntries(['setOwnerSemantic','getOwnerSemanticStatus','validateOwnerSemanticCoverage','purgeOwnerVectors'].map(method=>[method,(...args)=>call(method,...args)]).concat([['close',stop]])));
  let pumpPort,pumpOperation;
  const attachment=metadata=>{if(closed)fail('store_closed');const {port1,port2}=new MessageChannel();worker.postMessage({kind:'attach',port:port1,metadata},[port1]);return port2;};
  handles.set(api,{closed:()=>closed,ownerId:binding.ownerId,selection:provider,ownerState,providerIdentity,configuration:{...identity},targets,
    validatePumpCredential(credential){if(!binding.methods.includes('validateOwnerSemanticCoverage')||credentialDigest(credential)!==binding.credentialDigest)fail('authority_required');},
    pumpCall(method,input,duration=5000){
      if(!pumpPort)pumpPort=semanticClient(attachment({ownerId:binding.ownerId,pump:true}),{ownerState,writer:'0'},()=>pumpOperation);
      const r=request();pumpOperation=operationRecord(r,process.hrtime.bigint(),duration,1);return pumpPort.call(method,input);
    },
    cancel(operationId){try{worker.postMessage({kind:'cancel-operation',operationId});}catch{}},
    attach:attachment});
  return api;
}
