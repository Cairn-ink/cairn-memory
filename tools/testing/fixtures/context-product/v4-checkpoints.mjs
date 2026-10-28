import { isDeepStrictEqual } from 'node:util';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mergeSegments } from './v4-validation.mjs';
import { aggregate } from './protocol.mjs';
// Operator paths can name database inodes. Only the SQLite-free child opens them.
export async function readSegments(paths) {
  const child=spawnSync(process.execPath,[fileURLToPath(new URL('./v4-checkpoint-child.mjs',import.meta.url)),...paths],
    {env:{},encoding:'utf8',timeout:30000,maxBuffer:64*1024*1024});
  let value;try{value=JSON.parse(child.stdout);}catch{}
  if(child.status!==0||child.signal||child.error||!value?.segments)throw Error(value?.error??'v4_checkpoint_child_failed');
  return value.segments;
}
export function checkedSegments(header,segments) {
  if(header.mode==='rehearse'||header.qualifying===false)throw Error('rehearsal_cannot_qualify');
  const r=mergeSegments({hash:header.registrationHash,hostId:header.host.id,volumeId:header.volume.id,node:header.node,
    segmentIds:header.segments.map(s=>s.id),cellCount:header.cellCount},segments);
  const keys=new Set(header.inventory.map(c=>c.key));
  for(const s of segments)for(const c of s.cells)if(!keys.has(c.key)||!isDeepStrictEqual(c.cell,header.inventory.find(x=>x.key===c.key))||!header.segments.find(x=>x.id===s.id).cellKeys.includes(c.key))throw Error('v4_checkpoint_inventory');
  return {...r,decision:aggregate([r.decision,...(r.complete?[]:['inconclusive'])])};
}
