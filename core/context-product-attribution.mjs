// Private, fixed numeric maintenance telemetry. Never supplies admission proof.
export const maintenanceKinds = Object.freeze(['idle','scan','item','verify','publication','gc','vacuum','begin','commit','save','canonical-read','serialize']);
export const maintenanceWorkFields = Object.freeze(['transformed','canonicalRows','metadataBytes','textRows','textBytes','supportLookups','supportBytes','verifiedRows','reused','replaced','removed','copied','tokenized','retargets','verificationRestarts','verificationKept']);
export const attributionFields = Object.freeze(['unitCount','scanUnits','itemUnits','verificationUnits','publicationUnits','gcUnits',
  'scanRows','itemRows','verificationRows','publicationRows','gcRows','lastUnitKind','lastUnitMs','longestUnitKind','longestUnitMs',
  'beginWaitMaxMs','beginWaitSumMs','commitMaxMs','commitSumMs','canonicalReadWaitMaxMs','saveSigningMs','gcSliceMs','vacuumMs',
  'resultPreparationMs','serializationMs','serializationComplete','deliveryMs','returnMs']);
export const saturate = n => Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, n));
export const add = (a,b) => saturate(a+b);
const slots=Object.freeze(Object.fromEntries(attributionFields.map((name,i)=>[name,i])));
const unitSlots=Object.freeze({scan:slots.scanUnits,item:slots.itemUnits,verify:slots.verificationUnits,publication:slots.publicationUnits,gc:slots.gcUnits,vacuum:slots.gcUnits});
const sumSlots=Object.freeze({save:slots.saveSigningMs,gc:slots.gcSliceMs,vacuum:slots.vacuumMs,serialize:slots.resultPreparationMs});
const waitSlots=Object.freeze({begin:Object.freeze([slots.beginWaitMaxMs,slots.beginWaitSumMs]),commit:Object.freeze([slots.commitMaxMs,slots.commitSumMs])});
// One process-wide join domain, including separately imported runtime instances.
const ordinalKey=Symbol.for('context-read-product/maintenance-dispatch-ordinal');
export const createMaintenanceOrdinalAllocator=state=>()=>{
  // Exhaustion disables joins, never maintenance execution.
  if(!Number.isSafeInteger(state.next)||state.next<0||state.next>=Number.MAX_SAFE_INTEGER)return null;
  return ++state.next;
};
export const allocateMaintenanceOrdinal=createMaintenanceOrdinalAllocator(globalThis[ordinalKey]??={next:0});
const controls=new WeakMap();
export function maintenanceDispatchControl() {const control={};controls.set(control,{ordinal:allocateMaintenanceOrdinal(),claimed:false});return control;}
export function claimMaintenanceOrdinal(control) {
  const state=controls.get(control);if(!state)return allocateMaintenanceOrdinal();
  if(state.claimed)state.ordinal=allocateMaintenanceOrdinal();state.claimed=true;return state.ordinal;
}
export const maintenanceControlState=control=>controls.get(control);
export const bindMaintenanceControl=(control,buffer)=>{const state=controls.get(control);if(state)state.buffer=buffer;};
// Seven unsigned words: operation/start, units, serialization start/end ns,
// parent active ordinal, Worker writer ordinal, parent dispatch start ns.
// Outside the safe-integer ordinal domain; this sentinel is never a join key.
const unjoinedOrdinal=0xffffffffffffffffn;
const markerOrdinal=ordinal=>ordinal===null?unjoinedOrdinal:BigInt(ordinal);
export const maintenanceMarker = () => new SharedArrayBuffer(56);
const view = buffer => buffer instanceof SharedArrayBuffer && buffer.byteLength===56 ? new BigUint64Array(buffer) : null;
export function prepareMaintenanceMarker(buffer,ordinal,enteredNs) {
  const v=view(buffer);if(!v)return;
  Atomics.store(v,6,enteredNs);Atomics.store(v,4,markerOrdinal(ordinal));
}
export function readMaintenanceMarker(buffer, nowNs=process.hrtime.bigint()) {
  const v=view(buffer);if(!v)return undefined;
  const ordinal=Atomics.load(v,4),writer=Atomics.load(v,5);
  if(ordinal===unjoinedOrdinal)return Object.freeze({kind:0,runningMs:0,unitCount:0,unattributed:1});
  const packed=Atomics.load(v,0),kind=Number(packed&15n),start=packed>>4n,units=Atomics.load(v,1);
  if(ordinal!==writer || writer!==Atomics.load(v,5) || ordinal!==Atomics.load(v,4))
    return Object.freeze({kind:0,runningMs:saturate(Number(nowNs-Atomics.load(v,6))/1e6),unitCount:0,ordinal:Number(Atomics.load(v,4)),pendingDispatch:1});
  if(!maintenanceKinds[kind]||!packed)return undefined;
  return Object.freeze({kind,runningMs:saturate(Number(nowNs/1000n-start)/1000),unitCount:saturate(Number(units)),...(ordinal?{ordinal:Number(ordinal),pendingDispatch:0}:{})});
}
export function serializationDiagnostic(buffer, nowNs=process.hrtime.bigint()) {
  const v=view(buffer);if(!v||Atomics.load(v,4)===unjoinedOrdinal||Atomics.load(v,4)!==Atomics.load(v,5))return {};
  const start=Atomics.load(v,2),end=Atomics.load(v,3);if(!start)return {};
  return {serializationMs:saturate(Number((end||nowNs)-start)/1e6),serializationComplete:Number(end>=start)};
}
export function createMaintenanceAttribution({buffer,now=()=>Number(process.hrtime.bigint())/1e6,hrtime=()=>process.hrtime.bigint(),rendezvous}={}) {
  const v=view(buffer),fields=new Float64Array(attributionFields.length);
  const operationStarts=new Float64Array(8),operationKinds=new Uint8Array(8),operationPrevious=new BigUint64Array(8);
  let operationDepth=0,failureNameAtStep,failureStep,failureError,failureSelected=false;
  let current=0n,elapsed=0,readState=0,readStart=0,readElapsed=0,readPrevious=0n;
  const publish=value=>{current=value;if(v)Atomics.store(v,0,value);};
  const restore=previous=>publish((previous&15n)===0n ? hrtime()/1000n<<4n : previous);
  const enter=kind=>{const previous=current;publish((hrtime()/1000n<<4n)|BigInt(maintenanceKinds.indexOf(kind)));return previous;};
  const record=(kind,ms)=>{
    const pair=waitSlots[kind];if(pair){fields[pair[0]]=Math.max(fields[pair[0]],ms);fields[pair[1]]=add(fields[pair[1]],ms);}
    const slot=sumSlots[kind];if(slot!==undefined)fields[slot]=add(fields[slot],ms);
  };
  const acquired=()=>{
    if(readState!==1&&readState!==3)return;
    readElapsed+=saturate(now()-readStart);fields[slots.canonicalReadWaitMaxMs]=Math.max(fields[slots.canonicalReadWaitMaxMs],readElapsed);
    readState=4;restore(readPrevious);
  };
  const api={
    reset(ordinal=v?Atomics.load(v,4):0){
      if(v)Atomics.store(v,5,0n);fields.fill(0);readState=0;operationDepth=0;failureNameAtStep=undefined;failureStep=undefined;failureError=undefined;failureSelected=false;
      if(v){Atomics.store(v,1,0n);Atomics.store(v,2,0n);Atomics.store(v,3,0n);}publish(hrtime()/1000n<<4n);
      if(v)Atomics.store(v,5,markerOrdinal(ordinal));
    },
    start(kind){
      if(operationDepth===operationStarts.length)return -1;
      const at=operationDepth++;operationStarts[at]=now();operationKinds[at]=maintenanceKinds.indexOf(kind);operationPrevious[at]=enter(kind);return at;
    },
    end(at){if(at<0)return;record(maintenanceKinds[operationKinds[at]],saturate(now()-operationStarts[at]));restore(operationPrevious[at]);operationDepth=at;},
    checkpoint(kind){try{rendezvous?.(kind);}catch(error){api.captureFailure(error);throw error;}},
    captureFailure(error){if(failureSelected||failureNameAtStep!==undefined&&error===failureError)return;try{for(let object=Object(error);object;object=Object.getPrototypeOf(object)){const code=Object.getOwnPropertyDescriptor(object,'code');if(code){if(!Object.hasOwn(code,'value')||code.value!==undefined)return;break;}}}catch{return;}failureError=error;failureNameAtStep=maintenanceErrorName(error);failureStep=Number(current&15n);},
    mapFailure(error,mapped){if(failureError===error)failureError=mapped;return mapped;},
    selectFailure(error){if(failureError!==error){failureNameAtStep=undefined;failureStep=undefined;}failureError=undefined;failureSelected=true;},
    failure:()=>failureNameAtStep===undefined?undefined:{kind:'exception',errorName:failureNameAtStep,step:failureStep},
    get stepKind(){return Number(current&15n);},
    snapshot:()=>Object.fromEntries(attributionFields.map((name,i)=>[name,fields[i]])),
    add(name,n){const slot=slots[name];fields[slot]=add(fields[slot],n);},
    get elapsed(){return elapsed;},
    measure(kind,work,unit=false,started,clock=now){
      const start=started??clock();
      if(unit){fields[slots.unitCount]=add(fields[slots.unitCount],1);if(v)Atomics.store(v,1,BigInt(fields[slots.unitCount]));
        const slot=unitSlots[kind];if(slot!==undefined)fields[slot]=add(fields[slot],1);}
      const previous=enter(kind);
      try {rendezvous?.(kind);return work();}
      catch(error){api.captureFailure(error);throw error;}
      finally {
        const ms=saturate(clock()-start);record(kind,ms);
        if(unit){fields[slots.lastUnitKind]=maintenanceKinds.indexOf(kind);fields[slots.lastUnitMs]=ms;
          if(ms>=fields[slots.longestUnitMs]){fields[slots.longestUnitMs]=ms;fields[slots.longestUnitKind]=fields[slots.lastUnitKind];}}
        restore(previous);elapsed=ms;
      }
    },
    transaction(db,work,run){
      readPrevious=enter('canonical-read');readStart=now();readElapsed=0;readState=1;
      try {rendezvous?.('canonical-read');return run(db,work,api);}catch(error){api.captureFailure(error);throw error;}finally{acquired();readState=0;}
    },
    readReady(){
      if(readState!==1)return;
      readElapsed=saturate(now()-readStart);fields[slots.canonicalReadWaitMaxMs]=Math.max(fields[slots.canonicalReadWaitMaxMs],readElapsed);
      readState=2;restore(readPrevious);
    },
    step(){if(readState!==2)return;readPrevious=enter('canonical-read');readStart=now();readState=3;},
    acquired,
    serialize(work){
      const previous=enter('serialize');if(v)Atomics.store(v,2,hrtime());
      try {rendezvous?.('serialize');return work();}catch(error){api.captureFailure(error);throw error;}finally{if(v)Atomics.store(v,3,hrtime());restore(previous);}
    }
  };
  api.reset();return api;
}

// Private failure metadata is separate from the numeric phase/stall contract.
export const maintenanceFailureKinds=Object.freeze(['none','worker_heap_limit','worker_exit','worker_error','protocol','unmapped','exception','observation_timing','engine','spawn','dispatch','call_error','identity','worker_state','cleanup','disposal_proof']);
const failureCode=/^[a-z][a-z0-9_]{0,47}$/,failureName=/^[A-Za-z][A-Za-z0-9_]{0,47}$/;
export const maintenanceFailureCode=value=>typeof value==='string'&&failureCode.test(value)?value:'other';
export const maintenanceFailureCounts=()=>Object.fromEntries(maintenanceFailureKinds.slice(1).map(kind=>[kind,0]));
export function maintenanceErrorName(error){
  try {const constructor=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(error),'constructor')?.value,name=constructor&&Object.getOwnPropertyDescriptor(constructor,'name')?.value;return typeof name==='string'&&failureName.test(name)?name:'other';}catch{return 'other';}
}
export function maintenanceFailureRecord(kind,{engineCode,errorName,exitCode,ordinal,stage,stall,step}={}) {
  if(!maintenanceFailureKinds.includes(kind)||kind==='none')kind='call_error';
  const code=maintenanceFailureCode(engineCode);
  return Object.freeze({cause:kind==='unmapped'?'unmapped:'+code:kind==='exception'?'exception:'+(typeof errorName==='string'&&failureName.test(errorName)?errorName:'other'):kind,
    ...(Number.isInteger(step)&&step>=0&&step<maintenanceKinds.length?{step}:{}),
    ...(kind==='engine'?{engineCode:code}:{}),
    ...(kind==='worker_error'||kind==='spawn'||kind==='dispatch'||kind==='call_error'?{errorName:typeof errorName==='string'&&failureName.test(errorName)?errorName:'other'}:{}),
    ...(kind==='worker_exit'&&Number.isSafeInteger(exitCode)?{exitCode}:{}),
    ...(Number.isSafeInteger(ordinal)&&ordinal>0?{ordinal}:{}),
    ...(['open','refresh','call','idle','close','observation','disposal'].includes(stage)?{stage}:{}),...(stall?{stall}:{})});
}
export const maintenanceFailureKind=record=>record.cause.startsWith('unmapped:')?'unmapped':record.cause.startsWith('exception:')?'exception':record.cause;
export function readMaintenanceFailure(value){
  if(!value||typeof value!=='object'||!maintenanceFailureKinds.includes(value.kind)||value.kind==='none')return undefined;
  const safe=maintenanceFailureRecord(value.kind,{engineCode:value.engineCode,errorName:value.errorName,step:value.step});
  return {kind:value.kind,...(value.kind==='unmapped'?{engineCode:maintenanceFailureCode(value.engineCode)}:{}),
    ...(safe.engineCode?{engineCode:safe.engineCode}:{}),...(value.kind==='exception'?{errorName:safe.cause.slice(10)}:{}),...(safe.step===undefined?{}:{step:safe.step})};
}
