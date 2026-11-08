import { hrtime } from 'node:process';
import { types } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mono } from './context-product-control.mjs';
import { fail } from './validation.mjs';
import { semanticGate } from './context-semantic-gate.mjs';

// The Atomics load is the decision point relative to the Worker's latch store.
// An unlatched call keeps its existing timeout/close error and degradation.
function decisionError(attempts,code) {
  const refusal=Atomics.load(attempts,1)!==0;
  if(refusal)code='evidence_unavailable';
  return Object.assign(Error(code),{code,attempts:Atomics.load(attempts,0),...(refusal?{safetyFence:true}:{})});
}
// Word 1 serializes seal and increment. -1 is a short engine-owned lock;
// 2 is a permanent protocol-violation latch. No caller increments after seal.
export function semanticOutstandingStart(semanticOutstanding) {
  if(!types.isSharedArrayBuffer(semanticOutstanding)||semanticOutstanding.byteLength!==8)fail('authority_required');
  const state=new Int32Array(semanticOutstanding);
  const start=hrtime(),elapsed=()=>{const [seconds,nanos]=hrtime(start);return seconds*1000+nanos/1e6;};
  let flag;
  while((flag=Atomics.compareExchange(state,1,0,-1))===-1&&elapsed()<5000)Atomics.wait(state,1,-1,1);
  if(flag!==0){
    Atomics.store(state,1,2);Atomics.notify(state,1);Atomics.notify(state,0);fail('reader_failed');
  }
  try{Atomics.add(state,0,1);}finally{Atomics.compareExchange(state,1,-1,0);Atomics.notify(state,1);}
  return state;
}
export function semanticClient(port,configuration,operation,{semanticOutstanding}={}) {
  const pending=new Map();let closed=false,contentFence;
  port.on('message',message=>{
    const p=pending.get(message.id);if(!p)return;
    if(Atomics.load(p.attempts,1)!==0){pending.delete(message.id);clearTimeout(p.timer);p.reject(Object.assign(Error('evidence_unavailable'),{code:'evidence_unavailable',safetyFence:true,attempts:Atomics.load(p.attempts,0)}));return;}
    if(process.hrtime.bigint()>=p.cutoff&&!message.safetyFence){pending.delete(message.id);clearTimeout(p.timer);p.reject(Object.assign(Error('timeout'),{code:'timeout',attempts:Atomics.load(p.attempts,0)}));return;}
    if(message.parts!==undefined) {
      if(message.parts<1||message.parts>2||!Number.isInteger(message.part)||message.part<0||message.part>=message.parts||p.parts?.[message.part]){pending.delete(message.id);clearTimeout(p.timer);p.reject(Object.assign(Error('provider_error'),{code:'provider_error',attempts:Atomics.load(p.attempts,0)}));return;}
      p.parts??=[];p.parts[message.part]=message.value.vectors;
      if(p.parts.filter(Boolean).length<message.parts)return;
      message.value={...message.value,vectors:p.parts.flat()};
    }
    pending.delete(message.id);clearTimeout(p.timer);
    if(message.ok)p.resolve(message.value);else p.reject(Object.assign(Error(message.code),{code:message.code,attempts:message.attempts??0,...(message.safetyFence?{safetyFence:true}:{})}));
  });
  port.on('close',()=>{closed=true;for(const p of pending.values()){clearTimeout(p.timer);p.reject(decisionError(p.attempts,'ledger_unavailable'));}pending.clear();});
  function call(method,input={},cutoff,internal={}) {
    if(closed)fail('ledger_unavailable');
    const id=randomUUID(),op={...operation()};if(cutoff!==undefined&&cutoff<mono(op.operationCutoffMonoNs))op.operationCutoffMonoNs=String(cutoff);
    return new Promise((resolve,reject)=>{
      const attemptState=new SharedArrayBuffer(8),attempts=new Int32Array(attemptState);
      const timer=setTimeout(()=>{pending.delete(id);reject(decisionError(attempts,'timeout'));},Math.max(0,Number(mono(op.operationCutoffMonoNs)-process.hrtime.bigint())/1e6));
      pending.set(id,{resolve,reject,timer,attempts,cutoff:mono(op.operationCutoffMonoNs)});
      const outstanding=internal.semanticOutstanding??(method==='embed'?semanticOutstanding?.():undefined);let counted;
      if(outstanding===undefined){port.postMessage({id,method,input,operation:op,attemptState,...(contentFence?.operationId===op.operationId?{contentFence}: {})});return;}
      try{
        if(outstanding!==undefined)counted=semanticOutstandingStart(outstanding);
        port.postMessage({id,method,input,operation:op,attemptState,...(contentFence?.operationId===op.operationId?{contentFence}: {}),...(outstanding===undefined?{}:{semanticOutstanding:outstanding})});
      }catch(error){if(counted){Atomics.sub(counted,0,1);Atomics.notify(counted,0);}pending.delete(id);clearTimeout(timer);reject(error);}
    });
  }
  const gate=semanticGate(configuration.ownerState,BigInt(configuration.writer));
  return {configuration,call,gate,bindContentFence(fence){contentFence=fence?Object.freeze({...fence,operationId:operation().operationId}):undefined;},close(){port.close();},async snapshot(){try{return await call('snapshot');}catch(error){if(error.safetyFence)throw error;return {policy:null,identity:configuration.providerIdentity??null,unavailable:true};}}};
}
