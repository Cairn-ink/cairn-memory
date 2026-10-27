import { isDeepStrictEqual } from 'node:util';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { mergeSegments,validateSubprobes } from './v4-validation.mjs';
import { aggregate,PROTOCOL } from './protocol.mjs';
import { digest } from './report.mjs';
async function* rows(path) {
  for await(const line of createInterface({input:createReadStream(path),crlfDelay:Infinity})){
    if(!line.trim())continue;
    let row;try{row=JSON.parse(line);}catch{throw Error('v4_checkpoint_corrupt');}yield row;
  }
}
function knownFailure(cell,record) {
  if(cell?.kind==='injection'){if(Array.isArray(record.calls))return knownFailure({...cell,kind:'requests'},record);return typeof record.id==='string'&&Object.hasOwn(record,'code')?validateSubprobes(cell,[record]).decision==='failed':false;}
  const wal=cell&&(cell.canonical==='WAL'||cell.sidecar==='WAL');
  function bad(r){
    if(!r||typeof r!=='object')return false;
    if(r.expected===false||r.bounds===false||r.validated===false||r.lateSuccess===true||r.overshootMs>50||
      wal&&(r.nativeBusy>0||r.busy>0||r.publicBusy>0||r.code==='storage_busy')||
      r.deadlineMs!=null&&r.writeElapsedMs>r.deadlineMs||['model_timeout'].includes(r.code))return true;
    for(const [key,v] of Object.entries(r)){
      if(['hostLoop','launcherLoop','startupLoop','loop'].includes(key)&&v&&(v.maxMs>100||v.over100>0))return true;
      if(v&&typeof v==='object'&&(Array.isArray(v)?v.some(bad):bad(v)))return true;
    }return false;
  }
  return bad(record);
}
export async function readSegments(paths) {
  const segments=[];
  for(const path of paths){
    if(!path.endsWith('.jsonl')&&!path.endsWith('.jsonl.partial'))throw Error('v4_checkpoint_report_required');
    let header,headerHash,final;const cells=[];
    for await(const row of rows(path)){
      if(row.type==='registration'){header=row.header;headerHash=row.headerHash;if(digest(header)!==headerHash)throw Error('v4_checkpoint_header_hash');}
      if(row.type==='cell'&&row.decision?.complete===true)cells.push({key:row.cell.key,complete:true,decision:row.decision.decision,cell:row.cell,record:row.decision,summary:row.summary});
      if(row.type==='final')final=row;
    }
    if(header?.protocol?.version!=='P2-product-v4')throw Error('v4_checkpoint_header');
    const base=path.endsWith('.partial')?path.slice(0,-8):path,journal=base+'.records.jsonl';
    if(!await stat(journal).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;}))throw Error('v4_checkpoint_missing_journal');
    let failed=final?.status==='failed';
    for await(const row of rows(journal)){
      if(row.type==='header'&&row.headerHash!==headerHash)throw Error('v4_checkpoint_journal_identity');
      if(row.type==='record'&&(row.series==='failure'||knownFailure(header.inventory.find(c=>c.id===row.cell),row.record)))failed=true;
    }
    segments.push({id:header.segmentId,registrationHash:header.registrationHash,hostId:header.host.id,volumeId:header.volume.id,node:header.node,header,cells,knownFailure:failed});
  }
  return segments;
}
export function checkedSegments(header,segments) {
  const r=mergeSegments({hash:header.registrationHash,hostId:header.host.id,volumeId:header.volume.id,node:header.node,
    segmentIds:header.segments.map(s=>s.id),cellCount:header.cellCount},segments);
  const keys=new Set(header.inventory.map(c=>c.key));
  for(const s of segments)for(const c of s.cells)if(!keys.has(c.key)||!isDeepStrictEqual(c.cell,header.inventory.find(x=>x.key===c.key))||!header.segments.find(x=>x.id===s.id).cellKeys.includes(c.key))throw Error('v4_checkpoint_inventory');
  return {...r,decision:aggregate([r.decision,...(r.complete?[]:['inconclusive'])])};
}
