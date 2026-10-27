// SQLite-free checkpoint reader. No engine imports or native database handles.
import { createReadStream,constants } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { validateSubprobes } from './v4-validation.mjs';
import { PROTOCOL,qualifies } from './protocol.mjs';
import { methodProfile } from './v4-plan.mjs';
import { digest } from './report.mjs';
async function* rows(path) {
  const metadata=await lstat(path);
  if(!metadata.isFile()||metadata.isSymbolicLink())throw Error('v4_checkpoint_regular_file_required');
  for await(const line of createInterface({input:createReadStream(path,{flags:constants.O_RDONLY|constants.O_NOFOLLOW}),crlfDelay:Infinity})){
    if(!line.trim())continue;
    let row;try{row=JSON.parse(line);}catch{throw Error('v4_checkpoint_corrupt');}yield row;
  }
}
function knownFailure(cell,record,series) {
  if(cell?.kind==='injection'){if(Array.isArray(record.calls))return knownFailure({...cell,kind:'requests'},record,series);return typeof record.id==='string'&&Object.hasOwn(record,'code')?validateSubprobes(cell,[record]).decision==='failed':false;}
  const wal=cell&&(cell.canonical==='WAL'||cell.sidecar==='WAL');
  function bad(r,method=cell?.method??(cell?.kind==='backup'?'findCandidates':undefined)){
    if(!r||typeof r!=='object')return false;
    method=r.method??(r.methodLabel?methodProfile(r.methodLabel).method:method);
    const limit=PROTOCOL.latency[method];
    const warm=['WM','warm-reference'].includes(r.series??series);
    const latencySeries=['main','cold','warm-reference','WM','restored-reader'].includes(series);
    const concurrent=typeof cell?.load==='string'&&cell.load!=='idle'&&!warm;
    if(latencySeries&&limit&&qualifies(r,concurrent)&&(warm?r.readMs:r.elapsedMs)>limit.maxMs)return true;
    if(r.expected===false||r.bounds===false||r.validated===false||r.lateSuccess===true||r.overshootMs>50||
      wal&&(r.nativeBusy>0||r.busy>0||r.publicBusy>0||r.code==='storage_busy')||
      r.deadlineMs!=null&&r.writeElapsedMs>r.deadlineMs||
      ['capture','review'].includes(r.operation)&&r.code&&(wal||r.code!=='storage_busy')||
      r.validated!=null&&r.code&&!PROTOCOL.gates.expectedErrors.includes(r.code))return true;
    for(const [key,v] of Object.entries(r)){
      if(['hostLoop','launcherLoop','startupLoop','loop'].includes(key)&&v&&(v.maxMs>100||v.over100>0))return true;
      if(v&&typeof v==='object'&&(Array.isArray(v)?v.some(item=>bad(item,method)):bad(v,method)))return true;
    }return false;
  }
  return bad(record);
}
async function readSegments(paths) {
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
    if(!await lstat(journal).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;}))throw Error('v4_checkpoint_missing_journal');
    let failed=final?.status==='failed',currentCell;
    let ordinals=new Map(),pendingLatency=new Set();
    for await(const row of rows(journal)){
      if(row.type==='header'&&row.headerHash!==headerHash)throw Error('v4_checkpoint_journal_identity');
      if(row.type==='record'){
        const cell=header.inventory.find(c=>c.id===row.cell);
        if(row.cell!==currentCell){currentCell=row.cell;ordinals=new Map();pendingLatency=new Set();}
        if(['main','cold'].includes(row.series)){
          const index=ordinals.get(row.series)??0;ordinals.set(row.series,index+1);
          const limit=PROTOCOL.latency[row.record.method??cell?.method];
          if(limit&&qualifies(row.record)&&row.record.elapsedMs>limit.maxMs)pendingLatency.add(row.series+':'+index);
        }
        if(row.series==='overlap-final'&&row.record.overlap===true&&pendingLatency.has(row.record.series+':'+row.record.index))failed=true;
        if(row.series==='failure'||knownFailure(cell,row.record,row.series))failed=true;
      }
    }
    segments.push({id:header.segmentId,registrationHash:header.registrationHash,hostId:header.host.id,volumeId:header.volume.id,node:header.node,header,cells,knownFailure:failed});
  }
  return segments;
}

try{console.log(JSON.stringify({segments:await readSegments(process.argv.slice(2))}));}
catch(error){console.log(JSON.stringify({error:error.message}));process.exitCode=1;}
