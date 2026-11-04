import { types } from 'node:util';
import { ownData } from './local-authority-input.mjs';
import { fail } from './validation.mjs';
import { add } from './context-product-attribution.mjs';

const captures=new WeakMap(),promiseConstructor=Promise,promisePrototype=Promise.prototype,then=Promise.prototype.then,
  promiseSpecies=Object.getOwnPropertyDescriptor(Promise,Symbol.species).get;
const reasons=['stopped','renewal_expired','generation_changed','budget_exhausted','spacing','lane_changed','admission_held'];
// Independent of admission-domain retirement and capacity epochs. There is
// deliberately no deletion/reset API: restarting this realm clears poison.
const poisonKey=Symbol.for('context-read/maintenance-turn-poison/v1');
const poisonState=()=>globalThis[poisonKey]??={ports:new WeakSet(),locations:new Set(),physical:new Set()};
function ignoreFactoryRejection(value){
  // A malformed Promise ticket must not execute a caller's constructor/species
  // accessor merely to suppress a rejection from an accidental async factory.
  if(!types.isPromise(value)||Object.getPrototypeOf(value)!==promisePrototype||Object.hasOwn(value,'constructor'))return;
  const constructor=Object.getOwnPropertyDescriptor(promisePrototype,'constructor'),species=Object.getOwnPropertyDescriptor(promiseConstructor,Symbol.species);
  if(constructor?.value===promiseConstructor&&species?.get===promiseSpecies)Reflect.apply(then,value,[undefined,()=>{}]);
}
// The lazy form avoids even identity probing on the unchanged, unbrokered
// path when this process has no poisoned claims. It cannot bypass a poison by
// omitting the port on a successor pump.
export function maintenanceTurnPoisoned(identity,port){
  const state=poisonState();
  if(!state.locations.size&&!state.physical.size)return false;
  if(typeof identity==='function')identity=identity();
  const held=port!==undefined&&state.ports.has(port)||state.locations.has(identity.key)||
    identity.physical!==undefined&&state.physical.has(identity.physical);
  if(held){if(port!==undefined)state.ports.add(port);state.locations.add(identity.key);if(identity.physical!==undefined)state.physical.add(identity.physical);}
  return held;
}
function fields(port){
  if(!port||typeof port!=='object'||types.isProxy(port))fail('invalid_input');
  const result=[],chain=[];
  for(let value=port;value;value=Object.getPrototypeOf(value)){
    if(types.isProxy(value))fail('invalid_input');chain.push(value);
  }
  for(const name of ['version','maxWaitMs','createTurn']){
    let found;
    for(const value of chain){
      const descriptor=Object.getOwnPropertyDescriptor(value,name);
      if(descriptor){
        if(!Object.hasOwn(descriptor,'value'))fail('invalid_input');
        found={owner:value,...descriptor};break;
      }
    }
    if(!found)fail('invalid_input');result.push(found);
  }
  const [version,maxWaitMs,createTurn]=result.map(d=>d.value);
  if(version!==1||!Number.isInteger(maxWaitMs)||maxWaitMs<1||maxWaitMs>5000||typeof createTurn!=='function'||types.isProxy(createTurn))fail('invalid_input');
  return result;
}
export function captureMaintenanceTurnPort(port){
  if(port===undefined)return undefined;
  const descriptors=fields(port),capture=Object.freeze({port,maxWaitMs:descriptors[1].value});
  captures.set(capture,descriptors);return capture;
}
function unchanged(capture){
  try {
    const current=fields(capture.port),saved=captures.get(capture);
    return current.every((d,i)=>['owner','value','writable','enumerable','configurable'].every(k=>d[k]===saved[i][k]));
  }catch{return false;}
}
export function maintenanceTurnRequest(input){
  const names=['version','pumpId','windowId','lane','family','kind','phase','intent','maxMs'],r=ownData(input,names);
  if(names.some(name=>!Object.hasOwn(r,name)))fail('invalid_input');
  if(r.version!==1||['pumpId','windowId'].some(k=>typeof r[k]!=='string'||!r[k].length||r[k].length>200)||
    !Number.isSafeInteger(r.lane)||r.lane<0||!['lexical','semantic'].includes(r.family)||
    !['lexical','embeddings','status','validation'].includes(r.kind)||!['admission','work'].includes(r.phase)||
    !['current','history',null].includes(r.intent)||!Number.isSafeInteger(r.maxMs)||r.maxMs<1)fail('invalid_input');
  return Object.freeze(r);
}

// Family-agnostic ticket lifecycle. The pump owns cadence and the work/disposal
// join; a grant is retained until that pump explicitly settles or poisons it.
export function createMaintenanceTurnController(capture,{now,setTimer,clearTimer}){
  if(!captures.has(capture))fail('invalid_input');
  let phase='idle',active,waitMs=0,deferred=0,misses=0;
  const declined=Object.fromEntries(reasons.map(reason=>[reason,0]));
  const tickets=new WeakMap();
  function poisoned(identity){
    const held=maintenanceTurnPoisoned(identity,capture.port);
    if(held)phase='poisoned';
    return held;
  }
  function bindIdentity(ticket,identity){
    const state=tickets.get(ticket);if(!state)fail('invalid_input');
    state.identities.push({key:identity.key,physical:identity.physical});
    if(state.poisoned)poison(ticket);
  }
  function poison(ticket){
    const state=tickets.get(ticket);if(!state)fail('invalid_input');
    state.poisoned=true;phase='poisoned';
    const held=poisonState();held.ports.add(capture.port);
    for(const identity of state.identities){held.locations.add(identity.key);if(identity.physical!==undefined)held.physical.add(identity.physical);}
  }
  function release(ticket,outcome,reason){
    const state=tickets.get(ticket);if(!state)fail('invalid_input');
    if(state.attempted||state.poisoned)return state.poisoned?'poisoned':'ignored';
    if(!['withdrawn','declined','settled'].includes(outcome)||(outcome==='declined'?!reasons.includes(reason):reason!==undefined))fail('invalid_input');
    // Mark first, including on throws and reentrant calls. Withdrawal is final.
    state.attempted=true;
    if(outcome==='declined')declined[reason]=add(declined[reason],1);
    try{Reflect.apply(state.release,state.receiver,[outcome,...(reason===undefined?[]:[reason])]);}
    catch{poison(ticket);return 'poisoned';}
    if(phase!=='poisoned')phase='idle';return unchanged(capture)?'released':'authority_required';
  }
  async function wait(input,{signal,untilMonoMs,identity}){
    if(active||phase==='running'||phase==='settling')fail('read_in_progress');
    if(poisoned(identity))return {status:'failed',error:'reader_failed'};
    if(!unchanged(capture))return {status:'failed',error:'authority_required'};
    const request=maintenanceTurnRequest(input);
    let receiver,methods;
    try{
      receiver=Reflect.apply(captures.get(capture)[2].value,capture.port,[request]);
      // A Promise from the synchronous factory is malformed, but consume a
      // rejection without adopting it or invoking a user-supplied then method.
      ignoreFactoryRejection(receiver);
      methods=ownData(receiver,['enter','release']);
      if(['enter','release'].some(k=>!Object.hasOwn(methods,k)||typeof methods[k]!=='function'||types.isProxy(methods[k])))throw null;
    }catch{return {status:'failed',error:'authority_required'};}
    const ticket=Object.freeze({});
    tickets.set(ticket,{receiver,release:methods.release,identities:[],attempted:false,poisoned:false});bindIdentity(ticket,identity);
    const start=now(),controller=new AbortController();let timer,done=false,granted=false,cancelCause;
    phase='waiting';active={start};
    const finishWait=()=>{waitMs=add(waitMs,Math.max(0,now()-start));active=undefined;clearTimer(timer);signal.removeEventListener('abort',cancel);};
    let complete;
    const result=new Promise(resolve=>{complete=resolve;});
    function finish(status){
      if(done)return;done=true;finishWait();
      if(status==='admitted'){granted=true;phase='running';}
      else if(status==='defer')deferred=add(deferred,1);
      if(status!=='admitted'){
        const released=release(ticket,'withdrawn');
        if(released==='poisoned'){complete({status:'failed',error:'reader_failed'});return;}
        if(released==='authority_required'){complete({status:'failed',error:'authority_required'});return;}
      }
      if(status==='failed')complete({status,error:'authority_required'});
      else complete({status,...(granted?{ticket}:{})});
    }
    function cancel(){
      // Aborting a queued ticket tombstones it. If entry was already observed,
      // ownership stays with the pump; abort is never a granted-turn release.
      cancelCause='cancelled';controller.abort();queueMicrotask(()=>finish('cancelled'));
    }
    signal.addEventListener('abort',cancel,{once:true});
    timer=setTimer(()=>{cancelCause='defer';controller.abort();queueMicrotask(()=>finish('defer'));},Math.max(0,Math.ceil(untilMonoMs-now())));
    if(!unchanged(capture)){finish('failed');return result;}
    if(signal.aborted){cancel();return result;}
    if(now()>=untilMonoMs){controller.abort();finish('defer');return result;}
    function outcome(value){
      if(done)return;
      if(!unchanged(capture)){finish('failed');return;}
      // A raced grant owns the permit until the pump's post-grant recheck.
      // Only a completed withdrawal (the done guard above) makes it late.
      if(value==='admitted'){finish('admitted');return;}
      if(now()>=untilMonoMs){controller.abort();finish('defer');return;}
      if(value!=='admitted'&&cancelCause){finish(cancelCause);return;}
      finish(value==='admitted'||value==='defer'?value:'failed');
    }
    try{
      const value=Reflect.apply(methods.enter,receiver,[Object.freeze({signal:controller.signal,untilMonoMs})]);
      // Captured then bypasses a hostile then getter, but not constructor or
      // species. If either throws, catch below without retrying adoption or
      // inspecting value again: no derived Promise was created by then, and
      // the host's original rejection may remain unhandled. Await/resolve and
      // combinators still require constructor or then lookups.
      if(types.isPromise(value))Reflect.apply(then,value,[outcome,()=>finish(cancelCause??'failed')]);
      else outcome(value); // No Promise.resolve: non-native thenables stay inert.
    }catch{finish(cancelCause??'failed');}
    return result;
  }
  return Object.freeze({wait,release,poison,bindIdentity,isPoisoned:poisoned,
    settling(ticket){const state=tickets.get(ticket);if(!state)fail('invalid_input');if(!state.attempted&&!state.poisoned)phase='settling';},
    portUnchanged:()=>unchanged(capture),
    missedObservation(){misses=add(misses,1);},
    snapshot(admissionHold){return Object.freeze({deferredTurns:deferred,turnWaitMs:add(waitMs,active?Math.max(0,now()-active.start):0),
      declinedTurns:Object.freeze({...declined}),turnPhase:phase,missedObservations:misses,
      ...(admissionHold===undefined?{}:{admissionHold:Object.freeze({...admissionHold})})});}
  });
}
