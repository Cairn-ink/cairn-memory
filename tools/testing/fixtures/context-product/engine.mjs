import { PROTOCOL } from './protocol.mjs';
import { randomUUID } from 'node:crypto';
import { performance, monitorEventLoopDelay, PerformanceObserver } from 'node:perf_hooks';
import threads, { MessageChannel } from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { isDeepStrictEqual } from 'node:util';
export const timestamp=()=>performance.timeOrigin+performance.now();
const immediate=()=>new Promise(r=>setImmediate(r));
export function observeLoop({now=()=>performance.now(), timers=true}={}) {
  let last=now(),maxMs=0,over100=0,finished=false,previousUsage=process.resourceUsage();
  const gcEntries=[],gcObserver=timers?new PerformanceObserver(list=>{for(const e of list.getEntries())gcEntries.push({threadId:0,startAt:performance.timeOrigin+e.startTime,durationMs:e.duration,kind:e.detail.kind});}):null;
  gcObserver?.observe({entryTypes:['gc']});
  const blocks=[],hist=timers?monitorEventLoopDelay({resolution:1}):null;
  hist?.enable();
  const sample=()=>{if(finished)return;const at=now(),gap=at-last,currentUsage=process.resourceUsage();maxMs=Math.max(maxMs,gap);
    if(gap>100){over100++;blocks.push({startedAt:performance.timeOrigin+last,finishedAt:performance.timeOrigin+at,gapMs:gap,resources:resourceDelta(previousUsage,currentUsage)});}last=at;previousUsage=currentUsage;};
  const timer=timers?setInterval(sample,1):null;
  return {sample,async finish(){if(timers){await immediate();await delay(2);}sample();finished=true;clearInterval(timer);hist?.disable();gcObserver?.disconnect();
    for(const block of blocks)block.gc=gcEntries.filter(g=>g.startAt<block.finishedAt&&g.startAt+g.durationMs>block.startedAt);
    return {maxMs:Math.max(maxMs,(hist?.max??0)/1e6),over100,blocks};}};
}
export function resourceDelta(a,b) {
  return Object.fromEntries(['userCPUTime','systemCPUTime','minorPageFault','majorPageFault','voluntaryContextSwitches','involuntaryContextSwitches'].map(k=>[k,b[k]-a[k]]));
}
export function instrumentGc() {
  const Native=threads.Worker,ports=[],entries=[],workers=[];
  const observer=new PerformanceObserver(list=>{for(const e of list.getEntries())entries.push({threadId:0,startAt:performance.timeOrigin+e.startTime,durationMs:e.duration,kind:e.detail.kind});});
  observer.observe({entryTypes:['gc']});
  threads.Worker=class extends Native {
    constructor(url,options){const {port1,port2}=new MessageChannel();ports.push(port1);port1.on('message',m=>entries.push(m));
      super(url,{...options,workerData:{...options.workerData,productGcPort:port2},transferList:[...(options.transferList??[]),port2],
        execArgv:[...(options.execArgv??[]),'--import',new URL('./gc-worker.mjs',import.meta.url).href]});workers.push(this);}
  };syncBuiltinESMExports();
  return {entries,workers,close(){observer.disconnect();ports.forEach(p=>p.close());threads.Worker=Native;syncBuiltinESMExports();}};
}
export function selectReadSet(inventory, selectionRevision) {
  if(!Array.isArray(inventory)||!inventory.length||typeof selectionRevision!=='string'||!selectionRevision.length||selectionRevision.length>200)throw Error('invalid_inventory');
  for(const n of inventory)if(typeof n.ownerId!=='string'||!n.ownerId.length||n.ownerId.length>200||
    (n.scope==='personal'?n.projectId!==null:typeof n.projectId!=='string'||!n.projectId.length||n.projectId.length>200)||
    (n.lastActiveAt!==undefined&&!Number.isSafeInteger(n.lastActiveAt)))throw Error('invalid_inventory');
  const owners=new Set(inventory.map(n=>n.ownerId));if(owners.size!==1)throw Error('mixed_owner');
  const personal=inventory.filter(n=>n.scope==='personal'),projects=inventory.filter(n=>n.scope==='project');
  if(personal.length>1||personal.length+projects.length!==inventory.length)throw Error('invalid_inventory');
  const keys=inventory.map(n=>JSON.stringify([n.ownerId,n.scope,n.projectId]));if(new Set(keys).size!==keys.length)throw Error('duplicate_inventory');
  projects.sort((a,b)=>(b.lastActiveAt??0)-(a.lastActiveAt??0)||Buffer.compare(Buffer.from(a.projectId),Buffer.from(b.projectId)));
  const readSet=[...personal,...projects.slice(0,31)].map(({ownerId,scope,projectId})=>({ownerId,scope,projectId}))
    .sort((a,b)=>Buffer.compare(Buffer.from(JSON.stringify([a.ownerId,a.scope,a.projectId])),Buffer.from(JSON.stringify([b.ownerId,b.scope,b.projectId]))));
  return {readSet,ownerCoverage:{policy:'recent-projects-v1',selectionRevision,requestedNamespaces:inventory.length,selectedNamespaces:readSet.length,omittedNamespaces:inventory.length-readSet.length}};
}
export async function configure(config,service=false) {
  const {credentialDigest}=await import('../../../../core/context-product-control.mjs');
  const {createContextReadSupervisor,openContextProductReader,openContextIndexMaintainer}=await import('../../../../core/index.mjs');
  const supervisor=createContextReadSupervisor(),token={opaque:randomUUID()};
  const ids={requestId:randomUUID(),handleId:randomUUID(),credentialBindingId:randomUUID(),credentialExpiresUtcMs:null};
  const binding={kind:service?'service':'request',...(service?{serviceId:randomUUID(),credentialBindingId:ids.credentialBindingId,credentialExpiresUtcMs:null}:ids),
    credentialDigest:credentialDigest(token),ownerId:config.readSet[0].ownerId,namespaces:{readSet:config.readSet,ownerCoverage:config.ownerCoverage},issuedAt:0};
  const options={supervisor,path:config.path,version:'context-read-v1',profile:'context-read-product-v1.1',readSet:config.readSet,ownerCoverage:config.ownerCoverage,
    diagnostics:true,deadlineMs:config.deadlines.openMs,...(service?{sidecarJournalMode:config.sidecar}:{requestControl:{...ids,requestMaxMs:config.deadlines.requestMs}}),
    host:{moduleUrl:new URL('./host.mjs',import.meta.url).href,configuration:{[service?'serviceBinding':'requestBinding']:binding,
      ...(service?{}:{requestReservation:new SharedArrayBuffer(4)}),counterModule:config.counterModule??null,counterId:config.counterId??null,counterConfiguration:config.counterConfiguration??null,functionalOnly:config.functionalOnly===true}}};
  return {supervisor,token,options,open:(control={})=> (service?openContextIndexMaintainer:openContextProductReader)(options,control)};
}
export async function drain(supervisor) {
  const exported=await supervisor.drain();
  for(const r of exported)supervisor.ackCleanup(r.cleanupId);
  return exported;
}
// Probes real public admission and advertised capabilities; no operator switch.
export async function probeDependencies(config) {
  async function readerProbe(selected) {
    const c=await configure(selected);let h,capabilities,error;
    try{h=await c.open();const r=await h.getContextReadCapabilities();if(r.ok)capabilities=r.value;else error=r.error.code;}
    catch(e){error=e.code??'reader_failed';}
    finally{await h?.close();await c.supervisor.close();await drain(c.supervisor);}
    return {capabilities,error};
  }
  const initial=await readerProbe(config),missing=[];
  const ownerBlocked=config.readSet.length>2&&(initial.error==='invalid_read_set'||initial.capabilities?.readSetMaximum<config.readSet.length);
  if(ownerBlocked)missing.push('P2c');
  const wal=config.canonical==='WAL'||config.sidecar==='WAL';
  const narrow=ownerBlocked?{...config,readSet:config.readSet.slice(0,1),ownerCoverage:{...config.ownerCoverage,requestedNamespaces:1,selectedNamespaces:1,omittedNamespaces:0}}:config;
  const actual=ownerBlocked&&wal?await readerProbe(narrow):initial;
  if(wal&&(actual.error==='index_unavailable'||actual.capabilities&&(!actual.capabilities.journals?.includes(config.canonical)||!actual.capabilities.sidecarJournals?.includes(config.sidecar))))missing.push('P2d-WAL');
  if(missing.length)return {ready:false,blocked:missing,code:initial.error??actual.error??null};
  if(initial.error)return {ready:false,blocked:null,code:initial.error};
  const m=await configure(config,true);let maintainer;
  try{maintainer=await m.open();}
  catch(e){if(e.code==='index_unavailable'&&wal)return {ready:false,blocked:['P2d-WAL'],code:e.code};throw e;}
  finally{await maintainer?.close();await m.supervisor.close();await drain(m.supervisor);}
  return {ready:true,blocked:null,code:null,capabilities:initial.capabilities};
}
// JSON shape language: exact object keys, optional declared keys, arrays, enums,
// unions and primitive constraints. No catch-all object or unknown status branch.
export function closedShape(value,schema) {
  if(!schema||typeof schema!=='object')return false;
  if(schema.enum)return schema.enum.some(v=>isDeepStrictEqual(v,value));
  if(schema.oneOf)return schema.oneOf.some(s=>closedShape(value,s));
  if(schema.type==='array')return Array.isArray(value)&&value.length<=(schema.max??24)&&value.every(v=>closedShape(v,schema.items));
  if(schema.type==='object')return value!==null&&typeof value==='object'&&!Array.isArray(value)&&
    Object.keys(value).every(k=>Object.hasOwn(schema.properties,k))&&Object.keys(schema.properties).filter(k=>!(schema.optional??[]).includes(k)).every(k=>Object.hasOwn(value,k))&&
    Object.entries(value).every(([k,v])=>closedShape(v,schema.properties[k]));
  if(schema.type==='number')return typeof value==='number'&&Number.isFinite(value)&&(!schema.integer||Number.isSafeInteger(value))&&value>=(schema.min??-Infinity)&&value<=(schema.max??Infinity);
  if(schema.type==='string')return typeof value==='string'&&value.length<=(schema.max??65536)&&(!schema.pattern||new RegExp(schema.pattern).test(value));
  return schema.type==='boolean'&&typeof value==='boolean';
}
export async function validateResponse(result,config) {
  const bytes=Buffer.byteLength(JSON.stringify(result));
  const shape=closedShape(result,config.responseSchema);
  const v=result?.value;
  const snapshot=v?.snapshot??null,cursor=v?.nextCursor??null;
  const size=bytes<=PROTOCOL.bounds.responseBytes&&(!snapshot||snapshot.length<=PROTOCOL.bounds.snapshotUnits)&&(!cursor||cursor.length<=PROTOCOL.bounds.cursorUnits);
  let functional=true,tokens=null;
  if(result?.ok&&config.method==='findCandidates')functional=Array.isArray(v.items)&&v.items.length<=(config.input.limit??12)&&v.items.every((item,i)=>item.rank===i+1);
  if(result?.ok&&config.method==='fetchCandidateEvidence')functional=Array.isArray(v.items)&&v.items.length===(config.cell?.refs??config.input.refs?.length??v.items.length);
  if(result?.ok&&config.method==='contextRead') {
    const {meteredText}=await import('../../../../core/context-read-assembly.mjs');
    const counter=config.counterModule?await (await import(config.counterModule)).createCounter(config.counterConfiguration):config.functionalOnly?{id:'functional-characters',countTokens:t=>Array.from(t).length}:null;
    tokens=counter?.countTokens(meteredText(v.metered));
    functional=Number.isSafeInteger(tokens)&&tokens>=0&&tokens<=(config.input.budget.maxTokens??1500)&&
      v.diagnostics.budget.used===tokens&&v.metered.items.length<=(config.input.budget.maxItems??12)&&v.diagnostics.counter.id===counter.id;
  }
  return {bytes,bounds:shape&&size&&functional,validated:shape,tokens};
}
export function retrievalQuality(result,config) {
  const labels=config.oracleData?.relevant;
  if(!Array.isArray(labels))return null;
  const key=ref=>JSON.stringify([ref.type,ref.namespace??config.readSet[ref.ns],ref.memoryId??ref.cardId??ref.id]);
  const relevant=new Set(labels.map(key));
  const refs=(result?.value?.items??result?.value?.metered?.items??[]).map(item=>item.ref);
  const hits=n=>refs.slice(0,n).filter(ref=>relevant.has(key(ref))).length;
  return {relevant:relevant.size,hits5:hits(5),hits12:hits(12),recallAt5:relevant.size?hits(5)/relevant.size:null,
    recallAt12:relevant.size?hits(12)/relevant.size:null,knownMisses:config.oracleData.knownMisses?.length??0};
}
export async function attempt(config,{open,validate=validateResponse,oracle,loopFactory=observeLoop,initialize=false,signal,onWindowEnd,onWindowStart,clock=timestamp}={}) {
  // All configuration, input construction and harness instrumentation is outside observation.
  const c=await configure(config),gc=instrumentGc(),usage=process.resourceUsage();
  const input=config.input;let h,result,readStartedAt=null,readFinishedAt=null,readMs=0,rejectedAt=null,code=null,cleanupId,cancelObservedAt=null;
  let startedAt,finishedAt,publicMs,elapsedMs,exports;

  await onWindowStart?.();
  const loop=loopFactory();
  try {
    await immediate();startedAt=clock();const start=performance.now();
    try {
      h??=await (open?open(c):c.open({signal}));loop.sample();
      let initialized=true;
      if(initialize){const initial=await h[config.method](input,c.token,{signal});if(!initial.ok){result=initial;initialized=false;}}
      readStartedAt=clock();const read=performance.now();
      if(config.injection==='crash')void gc.workers.at(-1)?.terminate();
      const abort=config.injection==='abort'?new AbortController():null;if(abort){cancelObservedAt=clock();abort.abort();}
      if(initialized)result=await h[config.method](input,c.token,{signal:abort?.signal??signal});readMs=performance.now()-read;readFinishedAt=clock();
      code=result.ok?null:result.error.code;
    }catch(e){rejectedAt=clock();code=e.code??'reader_failed';cleanupId=e.cleanupId;}
    finally {
      publicMs=performance.now()-start;
      try {await h?.close();if(cleanupId)await c.supervisor.drain(cleanupId);}
      finally {await c.supervisor.close();exports=await c.supervisor.drain();}
    }
    finishedAt=clock();elapsedMs=performance.now()-start;
  }finally {
    // Final host-loop drain includes engine shutdown. Serialization, oracle and
    // ack record processing start only after the observed window is stopped.
    var hostLoop=await loop.finish();await immediate();gc.close();
  }
  await onWindowEnd?.();
  const resources=resourceDelta(usage,process.resourceUsage());
  let checked;try{checked=result?await validate(result,config):{bytes:0,bounds:true,validated:true};}
  catch{checked={bytes:0,bounds:false,validated:false,validationCode:'harness_validation_failed'};}
  const scopePartial=(result?.value?.coverage??result?.value?.diagnostics?.candidates?.coverage)?.status==='partial';
  let oracleExpected=false;try{oracleExpected=oracle?await oracle(result,{...config,code}):result?.ok===true;}catch{}
  const expected=oracleExpected===true&&(!scopePartial||config.cell?.scope==='overflow');
  const diagnostics=exports.map(r=>r.diagnostics);
  for(const r of exports)c.supervisor.ackCleanup(r.cleanupId);
  const gcBlocks=hostLoop.blocks.map(b=>({...b,gc:gc.entries.filter(g=>g.startAt<b.finishedAt&&g.startAt+g.durationMs>b.startedAt)}));
  const cutoff=Math.min(startedAt+config.deadlines.requestMs,readStartedAt===null?startedAt+config.deadlines.openMs:readStartedAt+(config.input.deadlineMs??5000));
  return {record:{hostPid:process.pid,startedAt,finishedAt,readStartedAt,readFinishedAt,elapsedMs,readMs,publicMs,openMs:(readStartedAt??rejectedAt)-startedAt,cleanupLagMs:elapsedMs-publicMs,rejectedAt,code,ok:result?.ok===true,
    ...checked,expected,quality:retrievalQuality(result,config),scopePartial,overlap:config.load==='idle',hostLoop:{...hostLoop,blocks:gcBlocks},resources,gc:gc.entries,
    nativeBusy:diagnostics.reduce((n,d)=>n+(d.busy??0),0),publicBusy:code==='storage_busy'?1:0,
    telemetry:diagnostics.length&&diagnostics.every(d=>d.coverage==='complete')?'complete':'incomplete',diagnostics,
    overshootMs:Math.max(0,(rejectedAt??readFinishedAt)-cutoff,code==='read_cancelled'&&cancelObservedAt!==null?(rejectedAt??readFinishedAt)-cancelObservedAt:0),lateSuccess:result?.ok===true&&readFinishedAt>=cutoff},result};
}
