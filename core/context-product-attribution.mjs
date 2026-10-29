// Private, fixed numeric maintenance telemetry. Never supplies admission proof.
export const maintenanceKinds = Object.freeze(['idle','scan','item','verify','publication','gc','vacuum','begin','commit','save','canonical-read','serialize']);
export const maintenanceWorkFields = Object.freeze(['transformed','canonicalRows','metadataBytes','textRows','textBytes','supportLookups','supportBytes','verifiedRows','reused','replaced','removed','copied','tokenized','retargets','verificationRestarts','verificationKept']);
export const attributionFields = Object.freeze(['unitCount','scanUnits','itemUnits','verificationUnits','publicationUnits','gcUnits',
  'scanRows','itemRows','verificationRows','publicationRows','gcRows','lastUnitKind','lastUnitMs','longestUnitKind','longestUnitMs',
  'beginWaitMaxMs','beginWaitSumMs','commitMaxMs','commitSumMs','canonicalReadWaitMaxMs','saveSigningMs','gcSliceMs','vacuumMs',
  'resultPreparationMs','serializationMs','serializationComplete','deliveryMs','returnMs']);
export const saturate = n => Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, n));
export const add = (a,b) => saturate(a+b);
// Four unsigned 64-bit words: packed operation (hrtime microseconds << 4 | kind),
// admitted unit count, serialization start ns, serialization end ns. A transition
// publishes its kind AND timestamp with one atomic store. No locks or retries.
export const maintenanceMarker = () => new SharedArrayBuffer(32);
const view = buffer => buffer instanceof SharedArrayBuffer && buffer.byteLength===32 ? new BigUint64Array(buffer) : null;
export function readMaintenanceMarker(buffer, nowNs=process.hrtime.bigint()) {
  const v=view(buffer);if(!v)return undefined;
  const packed=Atomics.load(v,0),kind=Number(packed&15n),start=packed>>4n;
  if(!maintenanceKinds[kind]||!packed)return undefined;
  return Object.freeze({kind,runningMs:saturate(Math.max(0,Number(nowNs/1000n-start)/1000)),unitCount:saturate(Number(Atomics.load(v,1)))});
}
export function serializationDiagnostic(buffer, nowNs=process.hrtime.bigint()) {
  const v=view(buffer);if(!v)return {};
  const start=Atomics.load(v,2),end=Atomics.load(v,3);
  if(!start)return {};
  // Parent delivery can race postMessage's return. Never wait: explicitly mark
  // that rare sample as incomplete; its elapsed value is a lower bound.
  return {serializationMs:saturate(Number((end||nowNs)-start)/1e6),serializationComplete:Number(end>=start)};
}
export function createMaintenanceAttribution({buffer,now=()=>Number(process.hrtime.bigint())/1e6,hrtime=()=>process.hrtime.bigint(),rendezvous=()=>{}}={}) {
  const v=view(buffer);let current=0n,fields={},pending;
  const publish=value=>{current=value;if(v)Atomics.store(v,0,value);};
  const restore=previous=>publish((previous&15n)===0n ? hrtime()/1000n<<4n : previous);
  const enter=kind=>{const previous=current;publish((hrtime()/1000n<<4n)|BigInt(maintenanceKinds.indexOf(kind)));return previous;};
  const record=(kind,ms)=>{
    const pair=kind==='begin'?['beginWaitMaxMs','beginWaitSumMs']:kind==='commit'?['commitMaxMs','commitSumMs']:null;
    if(pair){fields[pair[0]]=Math.max(fields[pair[0]],ms);fields[pair[1]]=add(fields[pair[1]],ms);}
    const name={save:'saveSigningMs',gc:'gcSliceMs',vacuum:'vacuumMs',serialize:'resultPreparationMs'}[kind];if(name)fields[name]=add(fields[name],ms);
  };
  const api={
    reset(){fields=Object.fromEntries(attributionFields.map(k=>[k,0]));pending=undefined;if(v){Atomics.store(v,1,0n);Atomics.store(v,2,0n);Atomics.store(v,3,0n);}publish(hrtime()/1000n<<4n);},
    snapshot:()=>({...fields}),
    add(name,n){fields[name]=add(fields[name]??0,n);},
    measure(kind,work,unit=false){
      const start=now();
      if(unit){fields.unitCount=add(fields.unitCount,1);if(v)Atomics.store(v,1,BigInt(fields.unitCount));
        const name={scan:'scanUnits',item:'itemUnits',verify:'verificationUnits',publication:'publicationUnits',gc:'gcUnits',vacuum:'gcUnits'}[kind];if(name)fields[name]=add(fields[name],1);}
      const previous=enter(kind);
      try {rendezvous(kind);return work();}
      finally {
        const ms=saturate(now()-start);record(kind,ms);
        if(unit){fields.lastUnitKind=maintenanceKinds.indexOf(kind);fields.lastUnitMs=ms;
          if(ms>=fields.longestUnitMs){fields.longestUnitMs=ms;fields.longestUnitKind=fields.lastUnitKind;}}
        restore(previous);
      }
    },
    read(work){
      const previous=enter('canonical-read'),start=now(),before=pending;
      const acquired=()=>{if(pending!==acquired)return;fields.canonicalReadWaitMaxMs=Math.max(fields.canonicalReadWaitMaxMs,saturate(now()-start));pending=before;restore(previous);};
      pending=acquired;
      try {rendezvous('canonical-read');return work();}finally{acquired();}
    },
    acquired(){pending?.();},
    serialize(work){
      const previous=enter('serialize');if(v)Atomics.store(v,2,hrtime());
      try {rendezvous('serialize');return work();}finally{if(v)Atomics.store(v,3,hrtime());restore(previous);}
    }
  };
  api.reset();return api;
}
