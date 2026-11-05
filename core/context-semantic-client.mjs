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
export function semanticClient(port,configuration,operation) {
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
  function call(method,input={},cutoff) {
    if(closed)fail('ledger_unavailable');
    const id=randomUUID(),op={...operation()};if(cutoff!==undefined&&cutoff<mono(op.operationCutoffMonoNs))op.operationCutoffMonoNs=String(cutoff);
    return new Promise((resolve,reject)=>{
      const attemptState=new SharedArrayBuffer(8),attempts=new Int32Array(attemptState);
      const timer=setTimeout(()=>{pending.delete(id);reject(decisionError(attempts,'timeout'));},Math.max(0,Number(mono(op.operationCutoffMonoNs)-process.hrtime.bigint())/1e6));
      pending.set(id,{resolve,reject,timer,attempts,cutoff:mono(op.operationCutoffMonoNs)});port.postMessage({id,method,input,operation:op,attemptState,...(contentFence?.operationId===op.operationId?{contentFence}: {})});
    });
  }
  const gate=semanticGate(configuration.ownerState,BigInt(configuration.writer));
  return {configuration,call,gate,bindContentFence(fence){contentFence=fence?Object.freeze({...fence,operationId:operation().operationId}):undefined;},close(){port.close();},async snapshot(){try{return await call('snapshot');}catch(error){if(error.safetyFence)throw error;return {policy:null,identity:configuration.providerIdentity??null,unavailable:true};}}};
}
