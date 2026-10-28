import { isDeepStrictEqual } from 'node:util';
import { resolve } from 'node:path';
import { release,platform } from 'node:os';
import { createTestWorkspace } from '../../workspace.mjs';
import claims from './v4-claims.json' with {type:'json'};
import { V4,DEFINITIONS,buildV4Plan,estimateV4,rotatingCell } from './v4-plan.mjs';
import { validateSessionRegistration,admissionBudget,rotationCoverage } from './v4-validation.mjs';
import { V3_DEFINITION,PROTOCOL,aggregate } from './protocol.mjs';
import { createReportSink,digest,immutable,persistFailure } from './report.mjs';
import { selectReadSet } from './engine.mjs';
import { build,requestSeries } from './series.mjs';
import { exposureCell } from './v4-windows.mjs';
import { stateCell } from './v4-state.mjs';
import { readSegments,checkedSegments } from './v4-checkpoints.mjs';
import { sharedSession } from './v4-session.mjs';
export function validateV4Registration(input,profile,plan=buildV4Plan(profile)) {
  if(input.rehearsal!==undefined)throw Error('rehearsal_cannot_qualify');
  if(!DEFINITIONS[profile])throw Error('v4_profile_required');
  if(input.protocolDefinition&&!isDeepStrictEqual(input.protocolDefinition,DEFINITIONS[profile]))throw Error('protocol_revision_required');
  for(const [name,value] of Object.entries({host:input.host,volume:input.volume}))if(!value||typeof value.id!=='string'||!value.id)throw Error('v4_'+name+'_identity');
  for(const key of ['cpu','ramBytes','os','owner'])if(!input.host[key])throw Error('v4_host_inputs');
  if(!input.volume.mount||!input.volume.filesystem||input.volume.production!==true&&profile==='production')throw Error('v4_volume_inputs');
  if(!/^v24\.\d+\.\d+$/.test(input.productionNode))throw Error('v4_node_patch');
  if(profile==='production'&&(input.platformRole!=='production-linux-ext4'||input.volume.filesystem!=='ext4'||input.volume.nonWSL!==true))throw Error('v4_production_platform');
  if(!isDeepStrictEqual(input.telemetryCapacities,PROTOCOL.telemetry)||input.drainSchedule!==PROTOCOL.drainSchedule)throw Error('v4_telemetry_inputs');
  if(!input.reservation||input.reservation.seconds!==V4.profiles[profile].reservationSeconds||input.reservation.exclusive!==true||!input.reservation.owner||
    !Number.isSafeInteger(input.observationBudgetMs)||input.observationBudgetMs!==input.reservation.seconds*1000)throw Error('v4_reservation');
  for(const key of ['stallMs','progressMs','drainAllowanceMs'])if(!Number.isSafeInteger(input.supervision?.[key])||input.supervision[key]<1)throw Error('v4_supervision');
  if(!input.deadlineProvenance||!input.writerProfile?.provenance)throw Error('v4_deadline_provenance');
  for(const key of ['opening','candidates','fetch','assembly'])if(!Number.isInteger(input.stateDeadlines?.[key])||input.stateDeadlines[key]<1||input.stateDeadlines[key]>5000)throw Error('v4_state_deadlines');
  for(const fixture of input.fixtures??[]){
    const selected=selectReadSet(fixture.inventory,fixture.selectionRevision),other=selectReadSet([fixture.otherOwnerNamespace],fixture.selectionRevision),overflow=selectReadSet(fixture.overflowInventory,fixture.selectionRevision);
    if(!Number.isSafeInteger(fixture.cards)||fixture.inventory.filter(n=>n.scope==='personal').length!==1||fixture.inventory.filter(n=>n.scope==='project').length!==3||selected.readSet.length!==4||
      overflow.ownerCoverage.requestedNamespaces!==33||overflow.ownerCoverage.selectedNamespaces!==32||overflow.ownerCoverage.omittedNamespaces!==1)throw Error('v4_fixture_selection');
    if(selected.readSet[0].ownerId===other.readSet[0].ownerId)throw Error('v4_writer_target_must_be_other_owner');
  }
  const expected=new Set(plan.filter(c=>c.kind==='freshness').map(c=>JSON.stringify([c.count,c.schema,c.canonical,c.sidecar])));
  if(input.sessions?.length!==12||new Set(input.sessions.map(s=>s.key)).size!==12)throw Error('v4_session_inventory');
  for(const session of input.sessions){if(!expected.delete(session.key)||validateSessionRegistration(session,JSON.parse(session.key)[1]).decision!=='passed'||
    !Array.isArray(session.batches)||session.batches.length>10||session.probeEveryMs<1||session.probeEveryMs>1000)throw Error('v4_session_schedule');
    for(const b of session.batches)if(!Number.isInteger(b.ordinal)||b.ordinal<0||b.ordinal>=10||typeof b.query!=='string'||!b.query||
      session.targets.filter(t=>t.batch===b.ordinal).length<1)throw Error('v4_probe_batch');
  }
  for(const cell of plan.filter(c=>c.kind==='injection'&&c.injection==='post-catch-up'))for(const probe of cell.subprobes)
    if(typeof input.stateProbes?.[cell.key+':'+probe.id]!=='string'||!input.stateProbes[cell.key+':'+probe.id])throw Error('v4_state_probes');
  const assignments=new Set(),ids=new Set();
  if(!input.segments?.length)throw Error('v4_preregistered_segments');
  for(const s of input.segments){if(typeof s.id!=='string'||!s.id||ids.has(s.id)||!Array.isArray(s.cellKeys)||!s.cellKeys.length)throw Error('v4_segment');ids.add(s.id);
    for(const key of s.cellKeys){if(assignments.has(key)||!plan.some(c=>c.key===key))throw Error('v4_segment_cell');assignments.add(key);}
    // A shared physical session is a complete scheduling unit at a checkpoint.
    for(const session of input.sessions){const keys=plan.filter(c=>['freshness','availability'].includes(c.kind)&&JSON.stringify([c.count,c.schema,c.canonical,c.sidecar])===session.key).map(c=>c.key);
      const n=keys.filter(k=>s.cellKeys.includes(k)).length;if(n&&n!==keys.length)throw Error('v4_split_session');}
  }
  if(assignments.size!==plan.length)throw Error('v4_segment_partition');
  return input;
}
export async function runV4(input,{profile,segmentId,reportPath,registrationPath,resume=[]},deps) {
  const plan=buildV4Plan(profile);validateV4Registration(input,profile,plan);
  deps.validateRegistration({...input,protocolDefinition:V3_DEFINITION,freshnessObservationMs:180000,availabilityWindows:1});
  const segment=input.segments.find(s=>s.id===segmentId);if(!segment)throw Error('v4_segment_required');
  const legacy=await deps.preregister({...input,protocolDefinition:V3_DEFINITION},input.writerProfile,[],registrationPath);
  if(process.version!==input.productionNode)throw Error('v4_registered_node_patch_required');
  if(profile==='production'&&(platform()!=='linux'||/microsoft/i.test(release())||Number(legacy.filesystem.type)!==0xef53))throw Error('v4_production_runtime_or_volume');
  const registrationHash=digest({input,node:process.version,implementationCommit:legacy.implementationCommit,hardware:{platform:legacy.hardware.platform,release:legacy.hardware.release,arch:legacy.hardware.arch,models:legacy.hardware.cpus.map(c=>c.model),memoryBytes:legacy.hardware.memoryBytes},filesystem:{type:legacy.filesystem.type,blockSize:legacy.filesystem.blockSize},source:legacy.sourceDiffHash,sourceHashes:legacy.changedSourceHashes,corpus:legacy.corpus,inputHashes:legacy.inputHashes});
  const baseHeader=immutable({...legacy,protocol:{...PROTOCOL,version:V4.protocol,revision:1},platformProfile:V4.profiles[profile],protocolDefinition:DEFINITIONS[profile],
    estimate:estimateV4(profile,plan),inventory:plan,cellCount:plan.length,expandedInventory:undefined,expandedCellCount:undefined,
    minimumFixedWindowMs:estimateV4(profile).fixedWindows*30000,registrationHash,segmentId,segments:input.segments,
    productInputs:input.productInputs,readCutoffReport:input.readCutoffReport,host:input.host,volume:input.volume,reservation:input.reservation,observationBudgetMs:input.observationBudgetMs,supervision:input.supervision,
    sessionSchedules:input.sessions,claimsTable:claims.claimsTable,coverageTable:claims.coverageTable,unclaimed:claims.unclaimed});
  const previous=resume.length?checkedSegments(baseHeader,await readSegments(resume)):{cells:[]};
  const carried={inheritedFailure:previous.decision==='failed',cells:previous.cells,cellKeys:previous.cells.map(c=>c.key),retainedDecisions:[...(previous.decision==='failed'?['failed']:[]),...previous.cells.map(c=>c.decision)]};
  // The first replayable registration frame must already carry its ancestry.
  // A process can stop before the later resumed-checkpoints record is written.
  const header=resume.length?immutable({...baseHeader,resumedCheckpoint:carried}):baseHeader;
  const adapter=await import(input.adapterModule),tally={},completed=new Set(),decisions=[];
  const workspace=createTestWorkspace(null,{parent:resolve(input.volumeRoot),prefix:'product-v4-'});let sink,descendantsConfirmed=true;
  try{sink=await createReportSink(reportPath,header);}catch(error){await workspace.cleanup();throw error;}
  if(previous.decision==='failed')decisions.push('failed');
  for(const c of previous.cells){completed.add(c.key);decisions.push(c.decision);}
  let stopped=null,lastActivityAt=Date.now(),lastProgressAt=lastActivityAt,currentCell=null,status='inconclusive';const startedAt=lastActivityAt;
  const record=sink.record.bind(sink);sink.record=async(...args)=>{await record(...args);lastActivityAt=Date.now();if(!['attribution','pump','maintenance-drain'].includes(args[1]))lastProgressAt=lastActivityAt;};
  const actors=new Set();globalThis[Symbol.for('product-qualification-actors')]=actors;
  const stop=()=>{stopped??='operator_interrupted';};process.once('SIGINT',stop);process.once('SIGTERM',stop);
  const supervise=()=>{
    if([...actors].some(c=>c.stalled))stopped??='stalled_child_activity';
    const b=admissionBudget({now:Date.now(),startedAt,reservationMs:input.reservation.seconds*1000,observationMs:input.observationBudgetMs,lastActivityAt,lastProgressAt,
      stallMs:input.supervision.stallMs,progressMs:input.supervision.progressMs,projectedCellMs:0,drainMs:input.supervision.drainAllowanceMs});
    if(!b.admit&&!stopped){stopped=b.reason;console.error(JSON.stringify({status:'incomplete',reason:stopped,cell:currentCell}));}
  };
  const monitorEvery=Math.min(1000,input.supervision.stallMs,input.supervision.progressMs);
  let monitor=setInterval(supervise,monitorEvery);
  const estimate=estimateV4(profile),initialRate=estimate.estimateSeconds*1000/plan.length,observedCosts=new Map();
  const complete=async(cell,decision,genuine=true)=>{if(decision.observedFailure)decision={...decision,decision:'failed'};decisions.push(decision.decision);if(genuine)completed.add(cell.key);tally[decision.decision]=(tally[decision.decision]??0)+1;
    const value={...decision,complete:genuine,key:cell.key};await sink.cell(cell,value);await sink.record(cell.id,'checkpoint',{segmentId,registrationHash,complete:genuine,cellKey:cell.key,decision:value});};
  try {
    input.registeredFixtureHashes=Object.fromEntries(header.corpus.map(f=>[f.id,f.hash]));
    if(resume.length)await sink.record(-1,'resumed-checkpoints',carried);
    await sink.record(-1,'idle-baseline',await deps.idleBaseline());
    for(const cell of plan.filter(c=>segment.cellKeys.includes(c.key))){
      if(completed.has(cell.key))continue;
      const expected=observedCosts.get(cell.kind)??initialRate;
      const remaining=plan.filter(c=>segment.cellKeys.includes(c.key)&&!completed.has(c.key)).reduce((n,c)=>n+(observedCosts.get(c.kind)??initialRate),0);
      const admission=admissionBudget({now:Date.now(),startedAt,reservationMs:input.reservation.seconds*1000,observationMs:input.observationBudgetMs,lastActivityAt,lastProgressAt,
        stallMs:input.supervision.stallMs,progressMs:input.supervision.progressMs,projectedCellMs:Math.max(expected,remaining),drainMs:input.supervision.drainAllowanceMs});
      if(stopped||!admission.admit){stopped??=admission.reason;await sink.record(-1,'admission-stopped',{reason:stopped,remaining:plan.length-completed.size});break;}
      currentCell=cell.id;const began=Date.now();console.error(JSON.stringify({cell:cell.id,total:plan.length,kind:cell.kind,segmentId}));
      const cellWorkspace=createTestWorkspace(null,{parent:workspace.path,prefix:'cell-'});
      const prepare=async(c,suffix)=>{
        const config=await deps.prepareCell(input,c,cellWorkspace,null,suffix);
        const fixture=input.fixtures.find(f=>f.count===c.count&&f.schema===c.schema);
        return {...config,protocol:V4.protocol,supervision:input.supervision,cell:c,sameNamespace:config.readSet[0],otherOwnerNamespace:fixture.otherOwnerNamespace,
          inspectLedger:async()=>(await deps.storage('inspect',{path:config.path})).value,
          production:profile==='engine'?process.version===input.productionNode:config.production};
      };
      const prepareInput=async(config,slot)=>({...await deps.prepareInput({...config,cell:slot,method:slot.method??config.method},adapter),oracle:adapter.validate});
      try {
        let config=await prepare(cell,'main'),decision;
        const probe=await deps.probeDependencies(config);await sink.record(cell.id,'capability',probe);
        if(!probe.ready){decision={decision:probe.blocked?'invalid':'failed',reason:probe.blocked?'blocked_dependency':probe.code,dependency:probe.blocked};await complete(cell,decision);continue;}
        const buildCell=async c=>{const b=await build(c,(s,r)=>sink.record(cell.id,s,r));return {...c,maintainerCoverage:b.coverage,maintainerDiagnostics:b.diagnostics.map(r=>r.diagnostics)};};
        if(cell.kind==='exposure')decision=await exposureCell(cell,{sink,prepareInput,prepareClone:async suffix=>buildCell(await prepare(cell,suffix))});
        else if(['freshness','availability'].includes(cell.kind)){
          const key=JSON.stringify([cell.count,cell.schema,cell.canonical,cell.sidecar]),session=input.sessions.find(s=>s.key===key),group=plan.filter(c=>['freshness','availability'].includes(c.kind)&&JSON.stringify([c.count,c.schema,c.canonical,c.sidecar])===key);
          if(typeof adapter.validateProbe!=='function')throw Error('v4_batching_adapter_required');
          config=await buildCell(config);
          config.sessionDeadlineAt=startedAt+Math.min(input.reservation.seconds*1000,input.observationBudgetMs)-input.supervision.drainAllowanceMs;
          // Session child owns harness supervision and journal writes. Suspend
          // this variable-size admission/record callback in the engine window.
          clearInterval(monitor);let ds;
          try{ds=await sharedSession(group,session,{sink,config});}
          finally{
            // Do not erase elapsed time or manufacture activity at the boundary.
            // Session supervision is delegated while the journal is leased; the
            // parent's independent deadline stays armed through child shutdown.
            if(Date.now()+input.supervision.drainAllowanceMs>startedAt+Math.min(input.reservation.seconds*1000,input.observationBudgetMs))stopped??='projected_overrun';
            monitor=setInterval(supervise,monitorEvery);
          }
          // Returned evidence survives a budget stop, but the overrun cannot
          // supply a complete checkpoint or promote the profile to passed.
          for(const c of group){const returned=ds.get(c.key);if(!completed.has(c.key)||returned.decision==='failed'||returned.observedFailure)await complete(c,returned,!stopped);}
          if(stopped){await sink.record(-1,'admission-stopped',{reason:stopped,remaining:plan.length-completed.size});break;}
          continue;
        }else if(cell.kind==='injection')decision=await stateCell(cell,{sink,input,prepare:(c,s)=>prepare(c,s),prepareInput,build:buildCell});
        else {
          config=await buildCell(config);config=await prepareInput(config,rotatingCell(cell,0));
          if(cell.kind==='backup')decision=await deps.backupSeries(config,cell,cellWorkspace,sink,adapter.validate);
          else {
            const r=await requestSeries(config,{cell,sink,oracle:adapter.validate},{prepareAttempt:prepareInput});decision=r.decision;
            if(decision.observedFailure)decision.decision='failed';
            // Replay language coverage from the journal via the per-attempt slot
            // callback; success coverage cannot be inferred from a count alone.
            // requestSeries returns its own independently computed coverage.
            if(cell.language==='language-rotation-v4'&&r.languageCoverage===false)decision={...decision,decision:aggregate([decision.decision,'inconclusive'])};
          }
        }
        if(!['injection','exposure'].includes(cell.kind)){const final=await config.inspectLedger();await sink.record(cell.id,'population',{initial:config.initialCounts,final:{memories:final.memories,cards:final.cardCount,schema:final.schema}});}
        await complete(cell,decision);
      }catch(e){if(e.cleanup?.descendantsUnconfirmed){descendantsConfirmed=false;try{await persistFailure(sink,cell.id,'failure',{stage:'runner-cleanup',code:e.code??e.message,cleanup:e.cleanup});}catch(journalError){e.journalError=journalError.code??journalError.message;}console.error(JSON.stringify({status:'failed',reason:e.code??e.message,workspaceRetained:true,cleanup:e.cleanup}));throw e;}await sink.record(cell.id,'failure',{code:e.code??e.message,exitCode:e.exitCode??null,signal:e.signal??null,...(e.cleanup?{cleanup:e.cleanup}:{}),...(e.diagnostics?{diagnostics:e.diagnostics}:{})});await complete(cell,{decision:'failed',reason:'harness_failed'},false);stopped='harness_failed';}
      finally{if(descendantsConfirmed)await cellWorkspace.cleanup();observedCosts.set(cell.kind,Math.max(observedCosts.get(cell.kind)??0,Date.now()-began));}
    }
    status=stopped?(decisions.includes('failed')?'failed':'inconclusive'):aggregate([...decisions,...(completed.size===plan.length?[]:['inconclusive'])]);
  }finally{
    clearInterval(monitor);delete globalThis[Symbol.for('product-qualification-actors')];process.off('SIGINT',stop);process.off('SIGTERM',stop);if(descendantsConfirmed)await workspace.cleanup();
    if(!descendantsConfirmed)await sink.interrupt();
    else await sink.finish(status,{tally,complete:!stopped&&completed.size===plan.length,segmentComplete:!stopped&&completed.size===segment.cellKeys.length,completedCells:completed.size,requiredCells:plan.length,stopReason:stopped});
  }
  console.log(status);return {status,tally};
}
