/** Opt-in P2-product-v3 qualification. --functional-only never measures a gate.
 * Production runs and --smoke require explicit frozen host registration inputs.
 * No change to canonical schema, writer defaults, engine modules or rollout. */
import { spawnSync, spawn } from 'node:child_process';
import { readFile, stat, statfs } from 'node:fs/promises';
import { cpus, platform, release, arch, totalmem, loadavg } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { DEFINITIONS, buildV4Plan, estimateV4, estimateV4Segment } from './fixtures/context-product/v4-plan.mjs';
import { rehearseV4 } from './fixtures/context-product/v4-rehearsal.mjs';
import { runV4,validateV4Registration } from './fixtures/context-product/v4-runner.mjs';
import { readSegments,checkedSegments } from './fixtures/context-product/v4-checkpoints.mjs';
import { createTestWorkspace } from './workspace.mjs';
import { PROTOCOL, buildPlan, expandPlan, aggregate, decide, availability, freshness, population, estimatePlan, V3_DEFINITION, readerLoops, maintainerCoverage, validateDefinition, validateNativeVolume } from './fixtures/context-product/protocol.mjs';
import { configure, drain, attempt, observeLoop, probeDependencies, selectReadSet } from './fixtures/context-product/engine.mjs';
import { fileChild, terminate, startSampler, actor } from './fixtures/context-product/actors.mjs';
import { startWriter, recordedWriter } from './fixtures/context-product/controller.mjs';
import { build, startPump, requestSeries, pairedWindows } from './fixtures/context-product/series.mjs';
import { createReportSink, digest, immutable } from './fixtures/context-product/report.mjs';
export { PROTOCOL, buildPlan, buildV4Plan, DEFINITIONS };
const storageUrl=new URL('./fixtures/context-product/storage-child.mjs',import.meta.url);
export async function storage(kind,configuration) {
  const child=spawn(process.execPath,[fileURLToPath(storageUrl),kind,JSON.stringify(configuration)],{env:{},stdio:['ignore','pipe','pipe']});
  const chunks=[];let stdoutBytes=0,stderrBytes=0;child.stdout.on('data',b=>{stdoutBytes+=b.length;if(stdoutBytes>64*1024*1024)child.kill('SIGKILL');else chunks.push(b);});child.stderr.on('data',b=>{stderrBytes+=b.length;});
  const timeout=configuration.protocol==='P2-product-v4'?null:setTimeout(()=>child.kill('SIGKILL'),30000);
  try {const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
    if(stdoutBytes>64*1024*1024)throw Error('storage_child_output_size');
    if(exit.code!==0||exit.signal)throw Object.assign(Error('storage_child_failed'),{code:'child_failed',exitCode:exit.code,signal:exit.signal,stderrBytes});
    return {...JSON.parse(Buffer.concat(chunks).toString('utf8')),exit};
  }finally{clearTimeout(timeout);}
}
export function writerProfile(value) {
  if(!value||typeof value.provenance!=='string'||!value.provenance||['captureMs','reviewMs'].some(k=>value[k]!==null&&(!Number.isSafeInteger(value[k])||value[k]<1||k==='captureMs'&&value[k]>120000))||
    Object.keys(value).sort().join(',')!=='captureMs,provenance,reviewMs')throw Error('invalid_writer_profile');
  return value;
}
function git(...args) {
  const r=spawnSync('git',args,{encoding:'utf8'});if(r.status!==0)throw Error('git_failed');return r.stdout.trim();
}
export function validateRegistration(input,{engineProfile=false}={}) {
  validateNativeVolume(input);
  if(input.platformRole==='native-linux-ext4'&&!engineProfile)throw Error('native_platform_engine_profile_only');
  if(input.rehearsal!==undefined)throw Error('rehearsal_cannot_qualify');
  if(input.protocolDefinition?.version===V3_DEFINITION.version&&!isDeepStrictEqual(input.protocolDefinition,V3_DEFINITION))throw Error('protocol_revision_required');
  validateDefinition(input.protocolDefinition??V3_DEFINITION);
  const positive=k=>Number.isSafeInteger(input[k])&&input[k]>0;
  if(new Set(input.fixtures?.map(f=>f.id)).size!==6||input.fixtures?.some(f=>typeof f.id!=='string'||!f.id))throw Error('fixture_ids');
  if(!/^v24\.\d+\.\d+$/.test(input.productionNode)||!['production-linux-ext4','wsl2-ext4','apfs','native-linux-ext4'].includes(input.platformRole)||
    !input.filesystem||!input.counterId||!Array.isArray(input.fixtures)||input.fixtures.length!==6||
    !['seriesCeilingMs','buildCeiling','freshnessObservationMs','availabilityWindows'].every(positive)||input.freshnessObservationMs<30000)throw Error('invalid_registration');
  for(const k of ['profileCommit','protocolCommit'])if(!/^[a-f0-9]{40}$/.test(input[k]))throw Error('commit_required');
  for(const k of ['openMs','requestMs','readMs'])if(!Number.isSafeInteger(input.deadlines?.[k])||input.deadlines[k]<2000||input.deadlines[k]>5000)throw Error('production_deadlines_required');
  const p=input.pump;
  if(!p||![20000,60000].includes(p.cronMs)||!Number.isSafeInteger(p.pollMs)||p.pollMs<1||p.pollMs>5000||!Number.isSafeInteger(p.renewalMs)||p.renewalMs<1||p.renewalMs>60000||
    !Number.isSafeInteger(p.quantum?.maxItems)||p.quantum.maxItems<1||p.quantum.maxItems>1024||!Number.isSafeInteger(p.quantum?.maxMs)||p.quantum.maxMs<1||p.quantum.maxMs>2500||
    2*Math.max(p.pollMs,p.quantum.maxMs)+p.quantum.maxMs>5000||!Number.isSafeInteger(p.budgets?.maxItems)||p.budgets.maxItems<1||!Number.isSafeInteger(p.budgets?.maxMs)||p.budgets.maxMs<1)throw Error('pump_registration');
  for(const count of [1112,3336])for(const schema of [18,23,33]) {
    const f=input.fixtures.filter(f=>f.count===count&&f.schema===schema);if(f.length!==1)throw Error('fixture_inventory');
    if(f[0].consistency!=='closed-snapshot'||f[0].cards<(schema===18?0:1)||schema===18&&f[0].cards!==0||f[0].inventory?.length!==4||!f[0].overflowInventory||!f[0].otherOwnerNamespace)throw Error('fixture_metadata');
    requireOverflow(selectReadSet(f[0].overflowInventory,f[0].selectionRevision));
  }
  for(const k of ['adapterModule','counterModule'])if(!input[k]?.startsWith('file:'))throw Error('local_module_required');
  if(typeof input.volumeRoot!=='string'||!input.volumeRoot)throw Error('production_volume_required');
  if(!input.labelsFile||!input.queriesFile)throw Error('frozen_labels_and_queries_required');
  return input;
}
export async function preregister(input,profile,plan,registrationPath) {
  const definition=input.protocolDefinition??V3_DEFINITION;
  const changedSources=git('ls-files','--modified','--others','--exclude-standard').split('\n').filter(p=>/^(core\/|tools\/testing\/|package\.json$)/.test(p)&&!p.includes('.p2d-'));
  const sourceHashes=changedSources.length?fileChild('hash',...changedSources).value:[];
  const paths=[registrationPath,...input.fixtures.map(f=>resolve(f.path)),fileURLToPath(input.adapterModule),fileURLToPath(input.counterModule),...(input.inputFiles??[]).map(p=>resolve(p)),resolve(input.labelsFile),resolve(input.queriesFile)];
  const hashes=fileChild('hash',...paths).value;
  const fs=await statfs(resolve(input.volumeRoot));
  return immutable({protocol:{...PROTOCOL,version:definition.version},registeredAt:new Date().toISOString(),implementationCommit:git('rev-parse','HEAD'),
    sourceDiffHash:digest(git('diff','HEAD')),changedSourceHashes:changedSources.map((path,i)=>({path,...sourceHashes[i]})),profileCommit:input.profileCommit,protocolCommit:input.protocolCommit,
    protocolDefinition:definition,estimate:estimatePlan(plan,definition),inventory:plan,cellCount:plan.length,expandedInventory:expandPlan(plan),expandedCellCount:expandPlan(plan).length,minimumFixedWindowMs:expandPlan(plan).filter(c=>c.series==='contention').reduce((n,c)=>n+c.windowMs,0),corpus:input.fixtures.map((f,i)=>({id:f.id,count:f.count,schema:f.schema,cards:f.cards,hash:hashes[i+1].hash,inventory:f.inventory,selectionRevision:f.selectionRevision})),
    inputHashes:hashes,labelsHash:hashes.at(-2).hash,queriesHash:hashes.at(-1).hash,node:process.version,productionNode:input.productionNode,
    hardware:{platform:platform(),release:release(),arch:arch(),cpus:cpus().map(c=>({model:c.model,speed:c.speed})),memoryBytes:totalmem()},
    filesystem:{type:String(fs.type),blockSize:fs.bsize,hostDescription:input.filesystem},load:loadavg(),platformRole:input.platformRole,
    deadlines:input.deadlines,writerProfile:profile,pump:input.pump,writerRates:{cadenceMs:20,saturatedBacklog:false},
    diagnosticCapacities:PROTOCOL.telemetry,drainSchedule:PROTOCOL.drainSchedule,counter:{id:input.counterId,moduleHash:hashes[input.fixtures.length+2]?.hash},
    seriesCeilingMs:input.seriesCeilingMs,buildCeiling:input.buildCeiling,freshnessObservationMs:input.freshnessObservationMs,
    availabilityWindows:input.availabilityWindows,probes:input.probes,settingsHash:digest(input)});
}
export async function prepareCell(input,cell,workspace,adapter,suffix='main') {
  const fixture=input.fixtures.find(f=>f.count===cell.count&&f.schema===cell.schema);
  if(!fixture)throw Error('missing_fixture');
  const path=join(workspace.path,`cell-${cell.id}-${suffix}.sqlite`);
  // Registered fixtures must be closed, quiescent consistent snapshots. These
  // raw operations execute only in the short SQLite-free child.
  for(const suffix of ['-wal','-shm','-journal'])if(await stat(resolve(fixture.path)+suffix).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;}))throw Error('fixture_not_quiescent');
  const copied=fileChild('copy',resolve(fixture.path),path);
  if(input.registeredFixtureHashes&&copied.value.hash!==input.registeredFixtureHashes[fixture.id])throw Error('fixture_changed_after_registration');
  await storage('mode',{path,mode:cell.canonical,...(cell.protocol?{protocol:cell.protocol}:{})});
  const inspected=await storage('inspect',{path,...(cell.protocol?{protocol:cell.protocol}:{})});
  if(inspected.value.schema!==cell.schema||inspected.value.memories!==cell.count||inspected.value.cardCount!==fixture.cards)throw Error('fixture_population_mismatch');
  const inventory=cell.scope==='overflow'?fixture.overflowInventory:fixture.inventory;
  if(!inventory)throw Error('missing_overflow_inventory');
  const selection=selectReadSet(cell.scope==='smoke'?inventory.slice(0,2):inventory,fixture.selectionRevision);
  if(cell.scope==='overflow')requireOverflow(selection);
  if(cell.scope==='launch'&&selection.readSet.length!==4)throw Error('launch_requires_four_namespaces');
  const config={path,...selection,types:cell.schema===18?['memory']:['memory','card'],canonical:cell.canonical,sidecar:cell.sidecar,
    readCutoffReport:input.readCutoffReport,deadlines:input.deadlines,pump:{...input.pump,id:`product-${cell.id}-${suffix}`},buildCeiling:input.buildCeiling,
    counterModule:input.counterModule,counterId:input.counterId,counterConfiguration:input.counterConfiguration,production:process.version===input.productionNode&&input.platformRole==='production-linux-ext4'&&platform()==='linux'&&!/microsoft/i.test(release())&&Number((await statfs(workspace.path)).type)===0xef53,
    seriesCeilingMs:input.seriesCeilingMs,load:cell.load??'idle',writerProfile:input.writerProfile,
    namespace:cell.load?.endsWith('other')?fixture.otherOwnerNamespace:selection.readSet[0],
    oracleModule:input.adapterModule,cell};
  const initialCounts={memories:inspected.value.memories,cards:inspected.value.cardCount,schema:inspected.value.schema};
  const base={...config,cell,ledger:inspected.value,initialCounts,method:cell.method??'findCandidates'};
  return adapter?prepareInput(base,adapter):base;
}
export async function prepareInput(config,adapter) {
  const prepared=await adapter.prepare({cell:config.cell,config,ledger:config.ledger});
  validateWorkload(config,prepared.input);
  if(['findCandidates','contextRead'].includes(config.method)&&(!Array.isArray(prepared.oracleData?.relevant)||!Array.isArray(prepared.oracleData?.knownMisses)))throw Error('frozen_relevance_labels_required');
  return {...config,input:prepared.input,responseSchema:prepared.responseSchema,schemas:prepared.schemas,oracleData:prepared.oracleData};
}

export function requireOverflow(selection) {
  if(!(selection.ownerCoverage?.omittedNamespaces>0))throw Object.assign(Error('overflow_without_omissions'),{code:'invalid_cell'});
}
export function validateWorkload(config,input) {
  const invalid=dimension=>{throw Object.assign(Error('adapter_'+dimension),{code:'invalid_cell'});};
  if(!isDeepStrictEqual(input?.readSet,config.readSet))invalid('read_set');
  if(input.deadlineMs!==config.deadlines.readMs)invalid('deadline');
  const intent=config.cell.intent??'current';
  if(config.method==='fetchCandidateEvidence') {
    // Compact tool refs reach the engine as full refs plus mandatory aligned
    // eight-character fences. These three profiles must remain distinct.
    const profile=config.cell.adapter,has=key=>Object.hasOwn(input,key);
    if(profile==='snapshot') {
      if(typeof input.snapshot!=='string'||!input.snapshot||input.snapshot.length>PROTOCOL.bounds.snapshotUnits||
        ['refs','intent','fences'].some(has))invalid('snapshot');
    } else {
      if(!['full','compact'].includes(profile)||has('snapshot')||input.intent!==intent||!Array.isArray(input.refs)||
        input.refs.length!==config.cell.refs)invalid('refs');
      for(const ref of input.refs) {
        const keys=ref?.type==='card'?['type','namespace','cardId','revision','bodyRevision']:['type','namespace','memoryId','revision'];
        if(!ref||!config.types.includes(ref.type)||!isDeepStrictEqual(Object.keys(ref).sort(),keys.sort())||
          !config.readSet.some(ns=>isDeepStrictEqual(ns,ref.namespace))||
          typeof (ref.memoryId??ref.cardId)!=='string'||!(ref.memoryId??ref.cardId)||
          !Number.isSafeInteger(ref.revision)||ref.revision<1||ref.type==='card'&&(!Number.isSafeInteger(ref.bodyRevision)||ref.bodyRevision<1))invalid('refs');
      }
      if(profile==='full'&&has('fences'))invalid('full_fences');
      if(profile==='compact'&&(!Array.isArray(input.fences)||input.fences.length!==input.refs.length||
        Array.from(input.fences).some(f=>typeof f!=='string'||!/^[A-Za-z0-9_-]{8}$/.test(f))))invalid('compact_fences');
    }
    return;
  }
  if(input.intent!==intent)invalid('intent');
  if(!isDeepStrictEqual(input.types,config.types))invalid('types');
  if(config.method==='findCandidates'&&input.limit!==(config.cell.limit??12))invalid('limit');
  if(config.method==='contextRead'&&!isDeepStrictEqual(input.budget,{maxTokens:config.cell.maxTokens??1500,maxItems:config.cell.limit??12}))invalid('budget');
}
export function ingestTargets(targets,messages) {
  for(const {target} of messages) {
    const old=targets.find(t=>t.id===target.id&&t.type===target.type);
    if(old)Object.assign(old,target,{committedAt:old.committedAt});
    else targets.push({...target,observedAt:null,lastProbeAt:null});
  }
}
export async function availabilitySeries(config,cell,input,sink,oracle,{startPump:makePump=startPump,startWriter:makeWriter=startWriter,attempt:readAttempt=attempt,now=Date.now}={}) {
  const write=(series,record)=>sink.record(cell.id,series,record);
  const records=[];let result,pumpDrain,pump,writer;
  try {
    pump=await makePump(config,write);writer=await recordedWriter(()=>makeWriter(config),write);
    const endAt=now()+input.availabilityWindows*30000;writer.start(now(),endAt);
    while(now()<endAt&&!config.signal?.aborted){
      for(const method of ['findCandidates','contextRead']){
        const inputFor=method==='contextRead'?{...config.input,budget:{maxTokens:1500,maxItems:12}}:{...config.input,limit:12};delete inputFor.budget;if(method==='contextRead'){delete inputFor.limit;inputFor.budget={maxTokens:1500,maxItems:12};}
        const {record}=await readAttempt({...config,method,input:inputFor,responseSchema:config.schemas?.[method]??config.responseSchema},{oracle,signal:config.signal});
        const r={...record,method,scheduled:true,notReady:record.code==='index_unavailable',scopePartial:record.scopePartial};records.push(r);writer.flush();await pump.flush();await write('availability',r);
      }
    }
    result=await writer.stop();pumpDrain=await pump.stop();await write('pump-drain',pumpDrain);
    const maintenance=[...(config.maintainerDiagnostics??[]),...pumpDrain.map(r=>r.diagnostics).filter(d=>d.protocol==='context-native-v1')];
    const metrics=availability(records,{minimum:cell.sampleRules?.availability.minimum??PROTOCOL.availabilityMinimum});
    return {...decide(cell,{records,loops:[...readerLoops(records),result.hostLoop],availability:metrics,readerCoverage:records.every(r=>r.telemetry==='complete')?'complete':'incomplete',
      maintainerCoverage:maintainerCoverage(maintenance,config.maintainerCoverage),writerCoverage:result.diagnostics.coverage,baselineCoverage:result.diagnostics.coverage,
      nativeBusy:records.reduce((n,r)=>n+r.nativeBusy,0)+result.diagnostics.busy+maintenance.reduce((n,d)=>n+(d.busy??0),0),publicBusy:records.reduce((n,r)=>n+r.publicBusy,0),writers:result.calls,production:config.production,enginePlatformEligible:config.enginePlatformEligible}),availability:metrics};
  }finally{try {if(writer&&!result)await writer.stop();}
    finally {if(pump&&!pumpDrain)await write('pump-drain',await pump.stop());}}
}
export async function freshnessSeries(config,cell,input,sink,{startPump:makePump=startPump,startWriter:makeWriter=startWriter,attempt:readAttempt=attempt,now=Date.now}={}) {
  const minimum=cell.sampleRules?.freshness.minimum??PROTOCOL.freshnessMinimum;
  const probes=input.probes?.[`${cell.count}:${cell.schema}:${cell.type}:${cell.intent}`];
  if(!Array.isArray(probes)||probes.length<minimum||new Set(probes).size!==probes.length||probes.some(p=>typeof p!=='string'||!/^[a-z][a-z0-9]{12,80}$/.test(p)))throw Error('unregistered_unique_probes');
  const corpus=JSON.stringify([config.ledger.memory,config.ledger.cards]).normalize('NFKC').toLowerCase();
  if(probes.some(p=>corpus.includes(p)))throw Error('probe_already_in_corpus');
  const write=(series,r)=>sink.record(cell.id,series,r),targets=[],records=[];let writerResult,intervalValid=true,pumpDrain,pump,writer;
  try {
    pump=await makePump(config,write);writer=await recordedWriter(()=>makeWriter({...config,targetType:cell.type,probes}),write);
    const endAt=now()+input.freshnessObservationMs;writer.start(now(),endAt);
    while(now()<endAt&&!config.signal?.aborted) {
      ingestTargets(targets,writer.child.take('target'));
      for(const target of targets.filter(t=>t.observedAt===null)) {
        const at=now();if(at-(target.lastProbeAt??target.committedAt)>PROTOCOL.probeIntervalMs)intervalValid=false;target.lastProbeAt=at;
        const {record,result}=await readAttempt({...config,method:'findCandidates',input:{readSet:config.readSet,types:config.types,intent:cell.intent,query:target.probe,limit:24,deadlineMs:config.deadlines.readMs},responseSchema:config.schemas?.findCandidates??config.responseSchema,oracleData:{relevant:[{type:target.type,namespace:config.namespace,...(target.type==='memory'?{memoryId:target.id}:{cardId:target.id})}],knownMisses:[]}},
          {oracle:r=>r?.ok!==true||r.value.items.length===1&&r.value.items[0].ref.type===target.type&&(r.value.items[0].ref.memoryId??r.value.items[0].ref.cardId)===target.id&&r.value.items[0].ref.revision===target.revision&&(target.type!=='card'||r.value.items[0].ref.bodyRevision===target.bodyRevision)});
        if(result?.ok&&result.value.items.some(i=>i.ref.type===target.type&&(i.ref.memoryId??i.ref.cardId)===target.id&&i.ref.revision===target.revision&&(target.type!=='card'||i.ref.bodyRevision===target.bodyRevision)))target.observedAt=now();
        records.push(record);await pump.flush();await write('probe',{...record,targetIndex:targets.indexOf(target)});writer.flush();
      }
      if(targets.length>=minimum&&now()-Math.max(...targets.map(t=>t.committedAt))>=PROTOCOL.freshnessMs)break;
      await delay(Math.min(250,Math.max(1,endAt-now())));writer.flush();
    }
    writerResult=await writer.stop();ingestTargets(targets,writer.child.take('target'));await write('freshness-targets',targets);
    pumpDrain=await pump.stop();await write('pump-drain',pumpDrain);
    const maintenance=[...(config.maintainerDiagnostics??[]),...pumpDrain.map(r=>r.diagnostics).filter(d=>d.protocol==='context-native-v1')];
    const metrics=freshness(targets,{minimum:cell.sampleRules?.freshness.minimum??PROTOCOL.freshnessMinimum});
    const decision=decide(cell,{records,loops:[...readerLoops(records),writerResult.hostLoop],freshness:metrics,readerCoverage:records.every(r=>r.telemetry==='complete')?'complete':'incomplete',
      maintainerCoverage:maintainerCoverage(maintenance,config.maintainerCoverage),writerCoverage:writerResult.diagnostics.coverage,baselineCoverage:writerResult.diagnostics.coverage,
      nativeBusy:records.reduce((n,r)=>n+r.nativeBusy,0)+writerResult.diagnostics.busy+maintenance.reduce((n,d)=>n+(d.busy??0),0),publicBusy:records.reduce((n,r)=>n+r.publicBusy,0),writers:writerResult.calls,production:config.production,enginePlatformEligible:config.enginePlatformEligible});
    if(!intervalValid||targets.some(t=>now()-t.committedAt<PROTOCOL.freshnessMs))return {...decision,decision:'invalid',reason:'probe_cadence_or_writer_drain'};
    return {...decision,freshness:{...metrics,p50Ms:Number.isFinite(metrics.p50Ms)?metrics.p50Ms:null,p95Ms:Number.isFinite(metrics.p95Ms)?metrics.p95Ms:null,maxMs:Number.isFinite(metrics.maxMs)?metrics.maxMs:null,p95Infinite:metrics.p95Ms===Infinity,maxInfinite:metrics.maxMs===Infinity,finiteMaximumMs:Math.max(0,...targets.filter(t=>t.observedAt!==null).map(t=>t.observedAt-t.committedAt))}};
  }finally{try {if(writer&&!writerResult)await writer.stop();}
    finally {if(pump&&!pumpDrain)await write('pump-drain',await pump.stop());}}
}
export async function backupSeries(config,cell,workspace,sink,oracle,{startSampler:makeSampler=startSampler,storage:store=storage,fileChild:files=fileChild,build:rebuild=build,configure:setup=configure,attempt:readAttempt=attempt,stat:fileStat=stat,observeLoop:makeLoop=observeLoop}={}) {
  // All clients, writers and maintenance are stopped and drained before backup.
  const backupPath=join(workspace.path,`backup-${cell.id}.sqlite`),restored=join(workspace.path,`restore-${cell.id}.sqlite`);
  const sampler=await makeSampler([process.pid],workspace.path);let attribution;
  try {
    const before=await store('verify',{path:config.path,...(config.protocol?{protocol:config.protocol}:{})});
    const backup=await store('backup',{path:config.path,destination:backupPath,...(config.protocol?{protocol:config.protocol}:{})});
    files('copy',backupPath,restored);
    const canonical=await store('verify',{path:restored,...(config.protocol?{protocol:config.protocol}:{})});
    if(canonical.value.logicalHash!==before.value.logicalHash||canonical.value.schema!==cell.schema)throw Error('restore_canonical_mismatch');
    const fresh={...config,path:restored},started=performance.now(),rebuilt=await rebuild(fresh,(s,r)=>sink.record(cell.id,s,r));
    const sidecarRebuildMs=performance.now()-started,suffix='.context-read-product-v1.1.sqlite';
    const deep=await store('verify-sidecar',{path:restored+suffix,...(config.protocol?{protocol:config.protocol}:{})});
    // A separately minted request observes bounded ready checks. Old request
    // bindings and copied certificates are never revived across this restore.
    let status;const verificationDiagnostics=[],verifiedIntents=[],verificationLoops=[];
    const verifyStart=performance.now();
    for(const intent of config.protocol==='P2-product-v4'?['current','history']:['current']){
      const c=await setup(fresh);let h;const observed=config.protocol==='P2-product-v4'?makeLoop():null;
      try {h=await c.open();status=await h.getContextIndexStatus({readSet:config.readSet,types:config.types,intent,deadlineMs:config.deadlines.readMs},c.token);}
      finally{await h?.close();await c.supervisor.close();if(observed)verificationLoops.push(await observed.finish());verificationDiagnostics.push(...await drain(c.supervisor));}
      if(!status?.ok||status.value.lexical.state!=='ready')throw Error('restore_not_ready');verifiedIntents.push(intent);
    }
    const freshReaderVerifyMs=performance.now()-verifyStart;
    if(!status?.ok||status.value.lexical.state!=='ready')throw Error('restore_not_ready');
    const read=await readAttempt(fresh,{oracle});await sink.record(cell.id,'restored-reader',read.record);
    const sizes={};
    for(const [key,path] of Object.entries({main:restored+suffix,wal:restored+suffix+'-wal',shm:restored+suffix+'-shm'}))sizes[key]=await fileStat(path).then(s=>s.size,e=>{if(e.code==='ENOENT')return 0;throw e;});
    attribution=await sampler.stop();
    const diskSamples=attribution.samples??[];
    const peaks=diskSamples.map(s=>(s.sizes??[]).reduce((n,f)=>n+f.bytes,0));
    const sidePeaks=diskSamples.map(s=>(s.sizes??[]).filter(f=>f.name.startsWith(`restore-${cell.id}.sqlite`+suffix)).reduce((n,f)=>n+f.bytes,0));
    const output={backupMs:backup.value.backupMs,restoreCanonicalVerifyMs:canonical.value.verifyMs,sidecarRebuildMs,sidecarVerifyMs:deep.value.sidecarVerifyMs,
      freshReaderVerifyMs,verifiedIntents,freshReaderVerifyInterval:'fresh public open/status/await close; includes bounded verification and transport',
      backupBytes:(await fileStat(backupPath)).size,restoredBytes:(await fileStat(restored)).size,
      sidecar:{...sizes,total:sizes.main+sizes.wal+sizes.shm,peak:sidePeaks.length?Math.max(...sidePeaks):null},
      temporaryPeakBytes:peaks.length?Math.max(...peaks):null,peakSamplingMs:PROTOCOL.sampler.intervalMs,peakSamplingCoverage:attribution.coverage??'incomplete',maintainerCoverage:rebuilt.coverage};
    await sink.record(cell.id,'backup-output',output);await sink.record(cell.id,'backup-attribution',attribution);
    const maintenance=[...(config.maintainerDiagnostics??[]),...rebuilt.diagnostics.map(r=>r.diagnostics),...verificationDiagnostics.map(r=>r.diagnostics)];
    const decision=decide({...cell,method:config.method},{records:[read.record],...(config.protocol==='P2-product-v4'?{loops:[...readerLoops([read.record]),...verificationLoops]}:{}),populations:{restored:population([read.record],{rule:cell.sampleRules?.['restored-reader']??{minimum:1,ceiling:1}})},
      readerCoverage:read.record.telemetry,maintainerCoverage:maintainerCoverage(maintenance,rebuilt.coverage),rebuildCoverage:rebuilt.coverage,
      writerCoverage:'complete',baselineCoverage:'complete',nativeBusy:(read.record.nativeBusy??0)+maintenance.reduce((n,d)=>n+(d.busy??0),0),publicBusy:read.record.publicBusy,
      production:config.production,enginePlatformEligible:config.enginePlatformEligible,reportOutputsComplete:output.sidecar.peak!==null&&output.peakSamplingCoverage==='complete'});
    return {...decision,outputs:output};
  }finally{if(!attribution)await sampler.stop();}
}
export async function injectionSeries(config,cell,sink,oracle) {
  const kind=cell.injection,write=(series,record)=>sink.record(cell.id,series,record);let lock,writer,result;
  try {
    if(kind==='exhaustion') {
      lock=actor('lock',{path:config.path},{url:storageUrl,stallMs:30000});await lock.wait('ready');
      writer=await recordedWriter(()=>startWriter({...config,oneOperation:true}),write,'injected-writer');writer.start(Date.now(),Date.now());result=await writer.stop();writer=null;
      return {decision:result.diagnostics.busy>0&&result.calls.some(c=>c.code==='storage_busy')?'passed':'failed',
        expected:'storage_busy',diagnosticCoverage:result.diagnostics.coverage,normalZeroBusyPopulation:false};
    }
    if(kind==='post-catch-up') {
      writer=await recordedWriter(()=>startWriter({...config,oneOperation:true}),write,'injected-writer');writer.start(Date.now(),Date.now());result=await writer.stop();writer=null;
      await build(config,(s,r)=>sink.record(cell.id,s,r));
    }
    const {record}=await attempt({...config,injection:kind},{oracle:kind==='post-catch-up'?oracle:(r,c)=>c.code===({absent:'index_unavailable',abort:'read_cancelled',crash:'reader_failed'})[kind]});
    await sink.record(cell.id,'injection',record);
    return {decision:record.expected&&record.hostLoop.maxMs<=100&&record.hostLoop.over100===0&&record.overshootMs<=50?'passed':'failed',expected:kind,diagnosticCoverage:record.telemetry,normalZeroBusyPopulation:false};
  }finally {
    try {if(writer)await writer.stop();}
    finally {if(lock){try{if(lock.connected){lock.send({type:'release'});await lock.wait('result');await lock.exited;}}finally{await terminate(lock);}}}
  }
}
export async function runRegistered(input,{reportPath,registrationPath,smoke=false},{
  validateRegistration:validate=validateRegistration,buildPlan:makePlan=buildPlan,preregister:register=preregister,
  prepareCell:prepare=prepareCell,probeDependencies:probeCell=probeDependencies,build:buildCell=build,
  prepareInput:prepareRequest=prepareInput,requestSeries:requestsFor=requestSeries,storage:store=storage,
  loadAdapter=url=>import(url),idleBaseline=async()=>{const loop=observeLoop();await delay(PROTOCOL.idleBaselineMs);return loop.finish();},
}={}) {
  validate(input);
  const fullPlan=makePlan(input.protocolDefinition??V3_DEFINITION),plan=smoke?[{...fullPlan[0],scope:'smoke'}]:fullPlan,header=await register(input,input.writerProfile,plan,registrationPath),sink=await createReportSink(reportPath,header);
  input.registeredFixtureHashes=Object.fromEntries(header.corpus.map(f=>[f.id,f.hash]));
  const workspace=createTestWorkspace(null,{parent:resolve(input.volumeRoot),prefix:'product-qualification-'}),adapter=await loadAdapter(input.adapterModule),tally={},dependencyProbes=new Map();let status='invalid';
  const controller=new AbortController(),cancel=()=>controller.abort();process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
  try {
    await sink.record(-1,'idle-baseline',await idleBaseline());
    for(const cell of plan) {
      if(controller.signal.aborted)throw Error('interrupted');
      console.error(JSON.stringify({cell:cell.id,total:plan.length,kind:cell.kind}));
      let decision,summary={};
      const dependencyKey=JSON.stringify([cell.count,cell.schema,cell.canonical,cell.sidecar,cell.scope]);
      const cached=dependencyProbes.get(dependencyKey);
      if(cached?.blocked){decision=decide(cell,{blocked:cached.blocked});tally.invalid=(tally.invalid??0)+1;await sink.record(cell.id,'capability',{...cached,reused:true});await sink.cell(cell,decision);continue;}
      const cellWorkspace=createTestWorkspace(null,{parent:workspace.path,prefix:'cell-'});
      try {
      let config=await prepare(input,cell,cellWorkspace,null);config.signal=controller.signal;const probe=await probeCell(config);dependencyProbes.set(dependencyKey,probe);
      await sink.record(cell.id,'capability',probe);
      if(!probe.ready)decision=probe.blocked?decide(cell,{blocked:probe.blocked}):{decision:'failed',reason:probe.code};
      else {
        if(!(cell.kind==='injection'&&cell.injection==='absent')) {const built=await buildCell(config,(series,r)=>sink.record(cell.id,series,r));config.maintainerCoverage=built.coverage;config.maintainerDiagnostics=built.diagnostics.map(r=>r.diagnostics);await sink.record(cell.id,'maintenance-drain',built.diagnostics);}
        config=await prepareRequest(config,adapter);
        if(smoke) {
          const end=Date.now()+2000;let attempts=0,valid=true;while(Date.now()<end&&!controller.signal.aborted){const r=await attempt(config,{oracle:adapter.validate});valid&&=r.record.bounds&&r.record.validated&&r.record.expected;await sink.record(cell.id,'smoke',r.record);attempts++;}
          decision={decision:valid?'inconclusive':'failed',reason:'smoke_operation_only',attempts,windowMs:2000};
        } else if(cell.kind==='requests'||cell.kind==='overflow') {
          const requests=await requestsFor(config,{cell:{...cell,load:cell.load??'idle'},sink,oracle:adapter.validate,smoke});
          decision={...requests.decision,populations:requests.populations};summary.reader=requests.populations;
          if((cell.windows??0)>0) {
            const pairs=await pairedWindows(config,{cell,sink,oracle:adapter.validate,smoke},async suffix=>{
              const fresh=await prepare(input,cell,cellWorkspace,null,suffix);const b=await buildCell(fresh);return {...await prepareRequest(fresh,adapter),maintainerCoverage:b.coverage,maintainerDiagnostics:b.diagnostics.map(r=>r.diagnostics)};
            });decision={decision:aggregate([decision.decision,pairs.decision]),requests:decision,pairs:pairs.decisions};
          }
        } else if(cell.kind==='availability')decision=await availabilitySeries(config,cell,input,sink,adapter.validate);
        else if(cell.kind==='freshness')decision=await freshnessSeries(config,cell,input,sink);
        else if(cell.kind==='backup')decision=await backupSeries(config,cell,cellWorkspace,sink,adapter.validate);
        else decision=await injectionSeries(config,cell,sink,adapter.validate);
      }
      const finalCounts=(await store('inspect',{path:config.path})).value;await sink.record(cell.id,'population',{initial:config.initialCounts,final:{memories:finalCounts.memories,cards:finalCounts.cardCount,schema:finalCounts.schema}});
      tally[decision.decision]=(tally[decision.decision]??0)+1;await sink.cell(cell,decision,summary);
      if(smoke)break;
      }catch(e){
        if(e.code!=='invalid_cell')throw e;
        decision={decision:'invalid',reason:e.message};tally.invalid=(tally.invalid??0)+1;await sink.cell(cell,decision);
      }finally{await cellWorkspace.cleanup();}
    }
    status=smoke?(tally.failed?'failed':tally.invalid?'invalid':'inconclusive'):aggregate(Object.keys(tally));
  }catch(e){await sink.record(-1,'failure',{code:e.code??'harness_failed',exitCode:e.exitCode??null,...(e.writerEvidence?{writerEvidence:e.writerEvidence}:{})});status=controller.signal.aborted?'invalid':'failed';}
  finally{process.off('SIGINT',cancel);process.off('SIGTERM',cancel);try{await workspace.cleanup();}catch{status='failed';}await sink.finish(status,{tally});}
  console.log(status);return {status,tally};
}
export async function functionalOnly(reportPath,namespaces=1) {
  // A tiny deterministic run exercises the actual engine and file lifecycle.
  // No quantile, exposure, heartbeat or elapsed value is used for acceptance.
  const workspace=createTestWorkspace(null,{prefix:'product-functional-'}),path=join(workspace.path,'tiny.sqlite');
  const inventory=[{ownerId:'synthetic-product',scope:'personal',projectId:null},...(namespaces===2?[{ownerId:'synthetic-product',scope:'project',projectId:'one'}]:[])];
  const selection=selectReadSet(inventory,'functional'),cell={id:0,kind:'functional',method:'findCandidates',load:'idle',canonical:'DELETE',sidecar:'DELETE'};
  const config={path,...selection,functionalOnly:true,sidecar:'DELETE',canonical:'DELETE',deadlines:{openMs:5000,requestMs:5000,readMs:5000},
    types:['memory'],load:'idle',buildCeiling:100,pump:{quantum:{maxItems:1024,maxMs:5000}},method:'findCandidates',input:{readSet:selection.readSet,types:['memory'],intent:'current',query:'needle',limit:12,deadlineMs:5000}};
  const header=immutable({protocol:PROTOCOL,mode:'functional-only',timingGates:false,inventory:[cell],cellCount:1,node:process.version});
  const sink=await createReportSink(reportPath,header);let status='failed',record;
  try {
    await storage('seed',{path,count:4,inventory});const ledger=(await storage('inspect',{path})).value;
    const {tinySchema}=await import('./fixtures/context-product/tiny-schema.mjs');config.responseSchema=tinySchema;
    const probe=await probeDependencies(config);if(!probe.ready)throw Error('tiny_dependency');
    const {buildForTests}=await import('./fixtures/context-product/test-preparation.mjs');
    await buildForTests(config,(s,r)=>sink.record(0,s,r));
    const r=await attempt(config,{oracle:result=>result?.ok===true&&result.value.items.length===4&&result.value.items.every(i=>ledger.memory.some(m=>m.id===i.ref.memoryId&&m.revision===i.ref.revision))});
    record=r.record;await sink.record(0,'functional',record);
    if(!record.ok||!record.validated||!record.bounds||!record.expected||record.telemetry!=='complete')throw Error('functional_assertion');
    status='inconclusive';await sink.cell(cell,{decision:'inconclusive',reason:'functional_only',functionalPassed:true});
  }catch(e){await sink.record(0,'failure',{code:e.code??e.message});}
  finally{await workspace.cleanup();await sink.finish(status,{functionalPassed:status==='inconclusive',cleanup:true});}
  console.log(status);return {status,functionalPassed:status==='inconclusive',record};
}
export async function main(args=process.argv.slice(2)) {
  let reportPath=resolve('context-read-product-report.jsonl'),registrationPath,profilePath,smoke=false,functional=false,rehearse=false,namespaces=1,plan=false,estimate=false,profile='engine',profileExplicit=false,protocol='v4',segmentId;const resume=[],merge=[];
  for(let i=0;i<args.length;i++) {
    const a=args[i];if(a==='--profile'){profile=args[++i];profileExplicit=true;}else if(a==='--protocol')protocol=args[++i];else if(a==='--segment')segmentId=args[++i];else if(a==='--resume')resume.push(resolve(args[++i]));else if(a==='--merge')merge.push(resolve(args[++i]));else if(a==='--estimate')estimate=true;else if(a==='--smoke')smoke=true;else if(a==='--rehearse')rehearse=true;else if(a==='--functional-only')functional=true;else if(a==='--plan')plan=true;
    else if(a==='--report')reportPath=resolve(args[++i]);else if(a==='--registration')registrationPath=resolve(args[++i]);
    else if(a==='--writer-profile')profilePath=resolve(args[++i]);else if(a==='--namespaces')namespaces=Number(args[++i]);else throw Error('usage');
  }
  if(![1,2].includes(namespaces)||!reportPath.endsWith('.jsonl'))throw Error('invalid_output_or_namespace_count');
  if(!['engine','production'].includes(profile)||!['v3','v4'].includes(protocol))throw Error('invalid_profile_or_protocol');
  let result;
  if(rehearse&&(merge.length||resume.length||smoke||functional||estimate||plan||protocol!=='v4'||profile!=='engine'))throw Error('rehearsal_mode_conflict');
  if(merge.length){
    const segments=await readSegments(merge),header=segments[0].header,checked=checkedSegments(header,segments),sink=await createReportSink(reportPath,{...header,mergedSegments:segments.map(s=>s.id)});
    for(const c of checked.cells)await sink.cell(c.cell,c.record,c.summary);await sink.finish(checked.decision,{complete:checked.complete,mergedCells:checked.cells.length,...(checked.diagnostic?{qualifying:false,diagnostic:true,diagnosticReason:checked.diagnosticReason}:{})});
    console.log(checked.diagnostic?JSON.stringify({status:checked.decision,qualifying:false,diagnostic:true,diagnosticReason:checked.diagnosticReason}):checked.decision);if(checked.decision!=='passed')process.exitCode=1;return checked;
  }
  if(estimate){
    if(protocol==='v4'&&!registrationPath){const value=estimateV4(profile);console.log(JSON.stringify(value));return value;}
    const definition=registrationPath?JSON.parse(await readFile(registrationPath,'utf8')).protocolDefinition??(protocol==='v4'?DEFINITIONS[profile]:V3_DEFINITION):V3_DEFINITION;
    if(definition.protocol==='P2-product-v4'){if(!isDeepStrictEqual(definition,DEFINITIONS[definition.platformProfile??profile]))throw Error('protocol_revision_required');const registered=JSON.parse(await readFile(registrationPath,'utf8'));validateV4Registration(registered,definition.platformProfile??profile);const value=segmentId?estimateV4Segment(definition.platformProfile??profile,registered,segmentId):estimateV4(definition.platformProfile??profile);console.log(JSON.stringify(value));return value;}
    const value=estimatePlan(buildPlan(definition),definition);console.log(JSON.stringify(value));return value;
  }
  if(plan){const inventory=protocol==='v4'?buildV4Plan(profile):buildPlan();console.log(JSON.stringify({protocol:protocol==='v4'?{...PROTOCOL,version:'P2-product-v4',revision:1,platformProfile:profile}:PROTOCOL,cellCount:inventory.length,inventory}));result={status:'inconclusive'};console.log(result.status);}
  else if(functional)result=await functionalOnly(reportPath,namespaces);
  else {
    if(!registrationPath||!profilePath)throw Error('registration_and_writer_profile_required');
    if(!registrationPath.endsWith('.json')||!profilePath.endsWith('.json'))throw Error('json_inputs_required');
    const input=JSON.parse(await readFile(registrationPath,'utf8'));input.writerProfile=writerProfile(JSON.parse(await readFile(profilePath,'utf8')));
    input.inputFiles=[...(input.inputFiles??[]),profilePath];
    if(rehearse){result=await rehearseV4(input,{reportPath});}
    else if(protocol==='v4'&&!smoke){
      if(!profileExplicit)throw Error('v4_explicit_profile_required');
      result=await runV4(input,{profile,segmentId,reportPath,registrationPath,resume},{validateRegistration,preregister,prepareCell,prepareInput,backupSeries,probeDependencies,storage,
        idleBaseline:async()=>{const loop=observeLoop();await delay(PROTOCOL.idleBaselineMs);return loop.finish();}});
    }else result=await runRegistered(input,{reportPath,registrationPath,smoke});
  }
  if(result.status!=='passed')process.exitCode=1;return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{await main();}catch(e){console.error(JSON.stringify({code:e.code??'harness_failed'}));console.log('failed');process.exitCode=1;}
}
