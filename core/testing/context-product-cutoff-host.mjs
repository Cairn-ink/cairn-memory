// Test-only COMMIT barriers. All database inspection uses SQLite statements.
import { DatabaseSync } from 'node:sqlite';
import { createContextReadHost as baseHost } from './context-product-index-host.mjs';
const tables=['documents','postings','statistics','generations','progress_records','work','publications','validation_records'];
export function logicalSnapshot(db,prepare=(sql)=>db.prepare(sql)) {
  return Object.fromEntries(tables.map(table=>[table,prepare('SELECT * FROM '+table).all()
    .map(row=>Object.fromEntries(Object.entries(row))).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))]));
}
export async function createContextReadHost(c) {
  const host=await baseHost(c);
  if(!c.cutoffBarrier)return host;
  const control=new Int32Array(c.cutoffBarrier),payload=new Uint8Array(c.cutoffPayload),half=payload.length/2;
  const exec=DatabaseSync.prototype.exec,prepare=DatabaseSync.prototype.prepare,previous=new WeakMap();
  const snapshot=db=>logicalSnapshot(db,sql=>prepare.call(db,sql));
  const write=(value,offset,slot)=>{
    const bytes=new TextEncoder().encode(JSON.stringify(value));
    if(bytes.length>half)throw Error('cutoff_oracle_payload_bound');
    payload.set(bytes,offset);Atomics.store(control,slot,bytes.length);
  };
  if(c.cutoffInspect){
    let inspected=false;
    DatabaseSync.prototype.prepare=function(sql){
      if(!inspected && sql==='SELECT * FROM product_metadata WHERE singleton=1'){
        // connection(true) has already performed SQLite recovery/schema access;
        // capture before any successor mutation or final status observation.
        inspected=true;write(snapshot(this),0,5);Atomics.store(control,6,1);Atomics.notify(control,6);
      }
      return prepare.call(this,sql);
    };
    return host;
  }
  DatabaseSync.prototype.exec=function(sql){
    if(sql==='BEGIN IMMEDIATE'){
      try {previous.set(this,snapshot(this));exec.call(this,'PRAGMA cache_size=5; PRAGMA synchronous=FULL;');}
      catch(e){if(e.code!=='ERR_SQLITE_ERROR')throw e;}
    }
    const old=previous.get(this);
    if(sql!=='COMMIT'||!old||Atomics.load(control,0)!==1)return exec.call(this,sql);
    const candidate=snapshot(this),prior=new Map(old.generations.map(g=>[g.id,g]));
    const phase=candidate.generations.some(g=>g.published&&!prior.get(g.id)?.published)?'publication':
      candidate.generations.some(g=>prior.has(g.id)&&prior.get(g.id).verify!==g.verify)?'verification':
      candidate.documents.length>old.documents.length?'batch':null;
    if(phase!==c.cutoffPhase)return exec.call(this,sql);
    if(c.cutoffPoint==='after')exec.call(this,sql);
    write(old,0,3);write(candidate,half,4);
    Atomics.store(control,0,0);Atomics.store(control,1,1);Atomics.notify(control,1);
    // Parent observes this exact transaction boundary before requesting termination.
    // No SQLite descriptor is opened/read/closed outside SQLite itself.
    while(Atomics.load(control,2)===0)Atomics.wait(control,2,0);
    if(c.cutoffPoint==='before')return exec.call(this,sql);
  };
  return host;
}
