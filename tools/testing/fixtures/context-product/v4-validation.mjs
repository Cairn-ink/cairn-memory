import { isDeepStrictEqual } from 'node:util';
import { V4, LABELS, LANGUAGES, INTENTS, windowSlot } from './v4-plan.mjs';
import { aggregate, qualifies } from './protocol.mjs';
import { digest } from './report.mjs';
const result=errors=>({decision:errors.length?'invalid':'passed',errors});
const interval=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&b>a;
const intersects=(a,b,c,d,start,end)=>interval(a,b)&&interval(c,d)&&Math.max(a,c,start)<Math.min(b,d,end);
export const validLoop=l=>l&&Number.isFinite(l.maxMs)&&l.maxMs>=0&&Number.isSafeInteger(l.over100)&&l.over100>=0;
export function normalizeV4Decision(decision,loops) {
  if(!loops.length||loops.some(l=>!validLoop(l))){
    const bad=loops.some(l=>validLoop(l)&&(l.maxMs>100||l.over100>0));
    decision.checks.loop=bad?false:null;decision.invalid??=[];decision.invalid.push('missing_loop_coverage');
    decision.observedFailure=Object.values(decision.checks).some(v=>v===false);
    decision.decision=decision.observedFailure?'failed':'invalid';
  }else if(decision.observedFailure)decision.decision='failed';
  return decision;
}
export function validateExposure(cell,windows) {
  const errors=[],retained=cell.load==='retained-target-rotation',targets=retained?['same','other']:[cell.load==='fresh-other'?'other':'same'];
  const credits=Object.fromEntries(targets.map(target=>[target,Object.fromEntries(LABELS.map(m=>[m,{write:0,close:0,writeWindows:new Set(),closeWindows:new Set()}]))]));
  const mix=Object.fromEntries(LABELS.map(m=>[m,{languages:new Set(),intents:new Set()}]));
  if(windows.length!==cell.windows||new Set(windows.map(w=>w.repetition)).size!==cell.windows)errors.push('reader_windows');
  const seen=new Set();
  for(const w of windows) {
    const methods=new Set(),languages=new Set(),intents=new Set();
    if(!Number.isInteger(w.repetition)||w.repetition<0||w.repetition>=cell.windows||w.endAt-w.startAt!==30000)errors.push('fixed_window');
    const perTarget=Object.fromEntries(targets.map(t=>[t,{write:0,close:0,commits:0,baselineCommits:0}]));
    const calls=w.writer.calls??[],native=w.writer.diagnostics?.records??[],base=w.baseline.writer.diagnostics?.records??[];
    for(const writer of [w.writer,w.baseline.writer])for(const [k,c] of writer.calls.entries()){const expected=retained?V4.windows.retainedCycle[k%4]:[targets[0],V4.windows.freshOperations[k%2]];if(c.writerTarget!==expected[0]||c.operation!==expected[1]||c.lifecycle!==(retained?'retained':'fresh'))errors.push('writer_cycle');}
    for(const t of targets){
      const targetCall=c=>c.writerTarget===t;
      const countCommits=(records,cs,start,end)=>records.filter(r=>r.kind==='native_end'&&r.stage==='commit'&&r.ok===true&&r.commit&&r.phase==='write'&&r.at>=start&&r.at<end&&cs.some(c=>c.id===r.operation&&targetCall(c)&&r.at>=c.writeStartedAt&&r.at<=c.writeFinishedAt)).length;
      perTarget[t].commits=countCommits(native,calls,w.startAt,w.endAt);
      perTarget[t].baselineCommits=countCommits(base,w.baseline.writer.calls,w.baseline.startAt,w.baseline.endAt);
    }
    for(const [k,r] of w.attempts.entries()) {
      const scheduled=windowSlot(cell,w.repetition,k);
      if(r.slot!==k||r.methodLabel!==scheduled.methodLabel||r.language!==scheduled.language||r.intent!==scheduled.intent)errors.push('mix_schedule');
      if(!LABELS.includes(r.methodLabel)||!LANGUAGES.includes(r.language)||!INTENTS.includes(r.intent)){errors.push('mix_identity');continue;}
      if(Number.isFinite(r.readStartedAt)&&r.readStartedAt>=w.startAt&&r.readStartedAt<w.endAt){methods.add(r.methodLabel);languages.add(r.language);intents.add(r.intent);mix[r.methodLabel].languages.add(r.language);mix[r.methodLabel].intents.add(r.intent);}
      for(const t of targets) {
        const key=JSON.stringify([cell.key,w.repetition,r.slot,r.methodLabel,t]);if(seen.has(key)){errors.push('duplicate_attempt');continue;}seen.add(key);
        const hit=kind=>calls.some(c=>c.writerTarget===t&&intersects(r.readStartedAt,r.readFinishedAt??r.rejectedAt,c[kind+'StartedAt'],c[kind+'FinishedAt'],w.startAt,w.endAt));
        const write=hit('write'),close=!retained&&hit('close');
        // Original per-window detector counts actual calls, including refused calls.
        perTarget[t].write+=Number(write);perTarget[t].close+=Number(close);
        // Method credits are exclusively complete, independently validated successes.
        if(r.series!=='window'||!qualifies(r)||!write)continue;
        const c=credits[t][r.methodLabel];c.write++;c.writeWindows.add(w.repetition);
        if(close){c.close++;c.closeWindows.add(w.repetition);}
      }
    }
    if(methods.size!==10||languages.size!==3||intents.size!==2)errors.push('per_window_mix');
    for(const [t,c] of Object.entries(perTarget))if(c.write<20||c.commits<100||c.baselineCommits<100||!retained&&c.close<10)errors.push('window_minima:'+w.repetition+':'+t);
  }
  for(const label of LABELS){
    if(mix[label].languages.size!==3||mix[label].intents.size!==2)errors.push('cell_mix:'+label);
    for(const t of targets){const c=credits[t][label];if(c.write<20||c.writeWindows.size<3||!retained&&(c.close<10||c.closeWindows.size<3))errors.push('method_minima:'+t+':'+label);}
  }
  return {...result(errors),credits:Object.fromEntries(Object.entries(credits).map(([t,labels])=>[t,Object.fromEntries(Object.entries(labels).map(([m,c])=>[m,{...c,writeWindows:[...c.writeWindows],closeWindows:[...c.closeWindows]}]))]))};
}
export function rotationCoverage(records,concurrent=false) {return new Set(records.filter(r=>qualifies(r,concurrent)).map(r=>r.language)).size===3;}
export function validateWM(cell,evidence) {
  const errors=[],unknown=[],s=V4.series.windowReference,trace=evidence.trace??[];
  if(!Number.isFinite(evidence.writerStoppedAt)||evidence.readinessWait===true||evidence.pumpReplaced===true||trace.some(t=>t.replaced===true)||
    !evidence.pumpId||evidence.pumpId!==evidence.finalWindowPumpId||evidence.pumpStoppedAt<evidence.writerStoppedAt||
    !trace.some(t=>t.kind==='start')||!trace.some(t=>t.kind==='renew')||!trace.some(t=>t.kind==='quantum')||!trace.some(t=>t.kind==='stop')||evidence.telemetry!=='complete')errors.push('pump_activity');
  const stopIndex=trace.findIndex(t=>t.kind==='stopping'||t.kind==='stop'),live=trace.slice(0,stopIndex<0?trace.length:stopIndex);
  const during=live.filter(t=>['renew','quantum'].includes(t.kind)&&t.at>=evidence.writerStoppedAt);
  if(!during.length||during.some(t=>t.status?.state!=='active'||t.status?.id!==evidence.pumpId)||
    !live.some(t=>t.kind==='quantum'&&(t.status?.usedItems>0||t.status?.usedMs>0)))errors.push('pump_inactive_or_unattested');
  const bySeries=new Map(s.seriesOrder.map(([m,i])=>[m+':'+i,[]]));
  for(const r of evidence.records??[]) {
    const list=bySeries.get(r.methodLabel+':'+r.intent);
    if(!list||r.startedAt<evidence.writerStoppedAt||r.finishedAt>evidence.pumpStoppedAt){errors.push('reference_interval');continue;}
    if(r.language!==LANGUAGES[list.length%3])errors.push('reference_language');list.push(r);
  }
  // Replay the attempted-slot scheduler, including series whose successes finish later.
  const cursors=new Map([...bySeries].map(([key])=>[key,0]));let offset=0,active=[...bySeries.keys()];
  while(active.length){const next=[];for(const key of active){const list=bySeries.get(key),index=cursors.get(key);
    if(index>=list.length)continue;
    if(evidence.records[offset++]!==list[index])errors.push('reference_interleave');cursors.set(key,index+1);
    if(index+1<list.length)next.push(key);
  }active=next;}
  for(const [key,records] of bySeries)if(!records.length||records.length>500)errors.push('reference_population:'+key);else if(!rotationCoverage(records))unknown.push('reference_language:'+key);
  return {...result(errors),decision:errors.length?'invalid':unknown.length?'inconclusive':'passed',unknown};
}
export function validateAvailabilitySchedule(schedule) {
  const errors=[],ids=new Set();
  for(const intent of INTENTS) {
    const list=schedule.filter(s=>s.intent===intent).sort((a,b)=>a.releaseMs-b.releaseMs);
    const counts={c12:0,a1500:0};
    for(const [k,s] of list.entries()){
      if(typeof s.id!=='string'||!s.id||ids.has(s.id)||s.methodLabel!==['c12','a1500'][k%2]||!LANGUAGES.includes(s.language)||s.language!==LANGUAGES[k%3]||
        !Number.isFinite(s.releaseMs)||s.releaseMs<0||s.releaseMs>=180000||k&&s.releaseMs<=list[k-1].releaseMs)errors.push('schedule_identity');
      ids.add(s.id);if(s.methodLabel in counts)counts[s.methodLabel]++;
    }
    if(counts.c12<50||counts.a1500<50||Math.abs(counts.c12-counts.a1500)>1)errors.push('schedule_balance:'+intent);
    if(!list.length||list[0].releaseMs>=180000/list.length||list.at(-1).releaseMs<180000-180000/list.length)errors.push('schedule_span:'+intent);
  }
  if(schedule.some(s=>!INTENTS.includes(s.intent)))errors.push('schedule_intent');
  return result(errors);
}
export function reconcileAvailability(schedule,records) {
  const errors=[...validateAvailabilitySchedule(schedule).errors];
  if(records.length!==schedule.length||new Set(records.map(r=>r.scheduledId)).size!==schedule.length)errors.push('schedule_bijection');
  for(const s of schedule){const r=records.find(r=>r.scheduledId===s.id);if(!r||r.methodLabel!==s.methodLabel||r.intent!==s.intent||r.language!==s.language||r.scheduled!==true||r.releaseMs!==s.releaseMs)errors.push('schedule_actual');}
  for(const intent of INTENTS){const ordered=records.filter(r=>r.intent===intent).sort((a,b)=>a.startedAt-b.startedAt);if(!isDeepStrictEqual(ordered.map(r=>r.scheduledId),schedule.filter(s=>s.intent===intent).sort((a,b)=>a.releaseMs-b.releaseMs).map(s=>s.id)))errors.push('schedule_release_order');}
  return result(errors);
}
export function validateSessionRegistration(session,schema) {
  const errors=[...validateAvailabilitySchedule(session.availability??[]).errors],w=session.writer;
  if(!w||w.lifecycle!=='fresh'||w.target!=='same-projection'||w.cadenceMs!==20||w.backlog!==false||w.keeper!==false||
    !isDeepStrictEqual(w.operations,['capture','review'])||w.startMs!==0||w.endMs!==180000)errors.push('session_writer');
  if(session.durationMs!==180000||session.probeLanes!==20||session.availabilityLanes!==1)errors.push('session_capacity');
  const types=schema===18?['memory']:['memory','card'];
  for(const type of types){const targets=(session.targets??[]).filter(t=>t.type===type);
    if(targets.length!==100||new Set(targets.map(t=>t.id)).size!==100)errors.push('target_identities');
    for(const t of targets)if(typeof t.probe!=='string'||!t.probe||t.createMs<0||t.createMs>85000||t.reviewMs!==t.createMs+35000||!Number.isInteger(t.batch)||t.batch<0||t.batch>=10)errors.push('target_recipe');
  }
  if((session.targets??[]).some(t=>!types.includes(t.type))||new Set((session.targets??[]).map(t=>t.probe)).size!==session.targets?.length)errors.push('target_types_or_probes');
  for(const b of new Set((session.targets??[]).map(t=>t.batch)))if(session.targets.filter(t=>t.batch===b).length>20)errors.push('probe_batch');
  return {...result(errors),scheduleHash:digest(session)};
}
export function validateSessionEvidence(session,e) {
  const errors=[...reconcileAvailability(session.availability,e.availability??[]).errors];
  const w=e.writer,calls=w?.calls??[],ordinary=calls.filter(c=>c.streamKind==='ordinary');
  if(w?.diagnostics?.coverage!=='complete'||w.exit?.code!==0||w.exit?.signal||e.writerEndAt<e.startAt+180000||!ordinary.length)errors.push('writer_seal_exit_tail');
  for(const [k,c] of ordinary.entries())if(c.ordinaryOrdinal!==k||c.lifecycle!=='fresh'||c.writerTarget!=='same'||c.operation!==['capture','review'][k%2]||
    !interval(c.openStartedAt,c.openFinishedAt)||!interval(c.writeStartedAt,c.writeFinishedAt)||!interval(c.closeStartedAt,c.closeFinishedAt)||
    c.openFinishedAt>c.writeStartedAt||c.writeFinishedAt>c.closeStartedAt||c.closeFinishedAt>c.finishedAt||!c.nativeCommit)errors.push('writer_lifecycle');
  const pacing=w?.pacing??[];
  if(pacing.length!==ordinary.length)errors.push('writer_pacing_coverage');
  for(const [k,p] of pacing.entries())if(p.ordinal!==k||p.startedMono!==ordinary[k]?.cycleStartedMono||p.delayMs!==Math.max(0,Math.ceil(20-(p.workFinishedMono-p.startedMono)))||p.resumedMono<p.workFinishedMono||k&&p.startedMono<pacing[k-1].resumedMono)errors.push('writer_pacing');
  if(!Number.isFinite(ordinary[0]?.startedAt)||ordinary[0].startedAt>e.startAt+20||ordinary.at(-1)?.finishedAt<e.startAt+180000-20)errors.push('ordinary_writer_tail');
  if(e.scheduleHash!==digest(session)||e.durationMs!==180000||e.cadenceMissed||e.omittedReleases||e.probeCadenceMissed)errors.push('session_reconciliation');
  for(const target of e.targets??[]){
    const native=w?.diagnostics?.records?.find(r=>r.sequence===target.nativeCommitSequence&&r.operation===target.nativeCommitOperation&&r.kind==='native_end'&&r.phase==='write'&&r.commit&&r.at===target.committedAt);
    const call=calls.find(c=>c.id===target.nativeCommitOperation&&c.streamKind==='target');
    if(!native||!call||native.at<call.writeStartedAt||native.at>call.writeFinishedAt||call.operation!==(target.type==='memory'&&target.intent==='history'?'capture':'review'))errors.push('eligible_native_commit');
    const recipe=session.targets.find(t=>t.id===target.targetId&&t.type===target.type);
    if(!recipe||target.committedAt<e.startAt+(target.type==='memory'&&target.intent==='history'?recipe.createMs:recipe.reviewMs)||target.type==='card'&&!(target.bodyRevision>=1))errors.push('eligible_release_binding');
    if(target.committedAt>e.startAt+120000||target.firstEligibility!==true||!INTENTS.includes(target.intent)||
    target.eligibilityCoverage!=='complete'||!Number.isInteger(target.revision)||target.revision<1||e.writerEndAt-target.committedAt<30000)errors.push('target_eligibility_tail');
  }
  return result(errors);
}
const expectedCode=(kind,probe)=>kind==='absent'?(['candidates','assembly'].includes(probe.id)?'index_unavailable':null):
  kind==='exhaustion'?'storage_busy':kind==='abort'?(probe.trigger==='abort'?'read_cancelled':'read_timeout'):kind==='crash'?'reader_failed':null;
export function validateSubprobes(cell,records) {
  const errors=[],failures=[],unknown=[],manifest=V4.stateSubprobes[cell.injection];
  if(!manifest)throw Error('v4_state_manifest');
  if(records.length!==manifest.length||new Set(records.map(r=>r.id)).size!==manifest.length||records.some(r=>!manifest.some(p=>p.id===r.id)))errors.push('subprobe_manifest');
  for(const p of manifest) {
    const r=records.find(r=>r.id===p.id);if(!r){errors.push('missing:'+p.id);continue;}
    const path=p.path??p.id;
    if(r.path!==path||r.trigger!==(p.trigger??null)||r.resetId==null||records.some(other=>other!==r&&other.resetId===r.resetId)||r.ownershipDrained!==true)errors.push('subprobe_identity_or_reset:'+p.id);
    if(r.code!==expectedCode(cell.injection,p)||r.expected!==true||r.noLateData!==true||validLoop(r.loop)&&(r.loop.maxMs>100||r.loop.over100>0)||r.writer?.hostLoop?.maxMs>100||r.writer?.hostLoop?.over100>0)failures.push('outcome:'+p.id);
    if(!validLoop(r.loop)||r.actualExitConfirmed!==true)errors.push('subprobe_observation:'+p.id);
    if(cell.injection==='absent'&&r.sidecarUnchanged!==true)failures.push('absent_side_effect');
    if(cell.injection==='absent'&&path==='status'&&(r.state!=='absent'&&r.state!=='missing'||r.progress!==null||r.counts!==null))failures.push('absent_status');
    if(cell.injection==='post-catch-up'&&(r.explicitBuild!==true||path==='status'&&r.state!=='ready'))errors.push('catchup_build');
    if(cell.injection==='abort'||cell.injection==='exhaustion'){
      if(!Number.isFinite(r.cutoffAt)||!Number.isFinite(r.nativeEnteredAt)||r.nativeEnteredAt>=r.cutoffAt||!Number.isFinite(r.settledAt))errors.push('cutoff_evidence');
    }
    if(cell.injection==='exhaustion'&&(!(r.nativePrimary===5||r.nativePrimary===6)||r.nativeProvenanceComplete!==true||r.settledAt>=r.cutoffAt||r.handleEscaped===true))failures.push('exhaustion_provenance');
    if(cell.injection==='abort'){
      const from=p.trigger==='abort'?r.abortObservedAt:r.cutoffAt;
      if(!Number.isFinite(from)||r.settledAt-from>50||p.trigger==='abort'&&r.abortObservedAt<r.nativeEnteredAt)failures.push('settlement');
      if(!validLoop(r.writer?.hostLoop)||!['capture','review'].every(op=>r.writer.calls.some(c=>c.operation===op&&c.lifecycle==='fresh'&&c.writerTarget==='same')))errors.push('cleanup_writer_lifecycle');
      if(r.writerCoverage!=='complete'||r.writerExit?.code!==0||r.writerExit?.signal)errors.push('cleanup_writer_coverage');
      if(r.writerProfileComplete===false)unknown.push('cleanup_writer_deadline');
      if(r.writer?.calls.some(c=>c.deadlineMs!==null&&c.writeElapsedMs>c.deadlineMs||['read_timeout','model_timeout'].includes(c.code)||c.code&&c.code!=='storage_busy')||
        (cell.canonical==='WAL'||cell.sidecar==='WAL')&&(r.writer?.diagnostics.busy>0||r.writer?.calls.some(c=>c.code==='storage_busy')))failures.push('cleanup_writer_gate');
      if(r.nativePendingAtSettlement!==true||r.writerCommitWhileCleanupPending!==true||r.writerDeadlineOverrun!==false||r.supervisedUntilDisposal!==true||r.nativeDisposed!==true)errors.push('abort_cleanup');
    }
    if(cell.injection==='crash'&&(r.workerExitConfirmed!==true||r.nativeDisposed!==true||r.supervisedUntilDisposal!==true))errors.push('crash_cleanup');
    if(['abort','crash'].includes(cell.injection)&&path==='opening'&&(r.cleanupId==null||r.handleEscaped!==false))errors.push('opening_cleanup');
  }
  return {decision:failures.length?'failed':errors.length?'invalid':unknown.length?'inconclusive':'passed',errors,failures,unknown,normalZeroBusyPopulation:false};
}
export function admissionBudget({now,startedAt,reservationMs,observationMs,lastActivityAt,lastProgressAt,stallMs,progressMs,projectedCellMs,drainMs=0}) {
  const reason=now-lastActivityAt>stallMs?'stalled_activity':now-lastProgressAt>progressMs?'missing_progress':
    now+projectedCellMs+drainMs>startedAt+Math.min(reservationMs,observationMs)?'projected_overrun':null;
  return {admit:reason===null,reason,decision:reason?'inconclusive':'passed'};
}
export function mergeSegments(registration,segments) {
  const cells=[],seen=new Set();
  for(const segment of segments){
    if(!registration.segmentIds.includes(segment.id)||segment.registrationHash!==registration.hash||segment.hostId!==registration.hostId||
      segment.volumeId!==registration.volumeId||segment.node!==registration.node)throw Error('segment_identity');
    for(const c of segment.cells){if(c.complete!==true)continue;if(seen.has(c.key))throw Error('segment_duplicate_cell');seen.add(c.key);cells.push(c);}
  }
  return {cells,decision:aggregate([...cells.map(c=>c.decision),...(segments.some(s=>s.knownFailure)?['failed']:[])]),complete:cells.length===registration.cellCount};
}
