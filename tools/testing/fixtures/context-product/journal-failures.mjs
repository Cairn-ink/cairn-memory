// SQLite-free durable failure vocabulary shared by journal writers and replay.
// Status/exit shapes are checked here. Contextual timing and T rules stay in replay.
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const text=v=>typeof v==='string'&&v.length>0;
const integer=v=>Number.isSafeInteger(v)&&v>=0;
const member=(v,values)=>values.includes(v);
const exit=v=>object(v)&&!Object.hasOwn(v,'kind')&&v.code===0&&v.signal===null&&(!Object.hasOwn(v,'disconnected')||v.disconnected===true);
const decisions=['passed','invalid','inconclusive'];
const verdict=v=>object(v)&&member(v.decision,decisions)&&(!Object.hasOwn(v,'functionalPassed')||v.functionalPassed===true)&&(!Object.hasOwn(v,'observedFailure')||v.observedFailure===false);
const errors=['index_unavailable','storage_busy','read_timeout','read_cancelled','reader_failed','snapshot_stale','revision_conflict','evidence_unavailable','scope_changed','authority_required','invalid_input','invalid_snapshot','token_count_unavailable','context_item_too_large'];
const read=v=>object(v)&&typeof v.ok==='boolean'&&v.expected===true&&v.bounds===true&&v.validated===true&&
  (v.ok?(!Object.hasOwn(v,'code')||v.code===null):member(v.code,errors))&&
  (!Object.hasOwn(v,'initialization')||read(v.initialization))&&(!Object.hasOwn(v,'telemetry')||member(v.telemetry,['complete','incomplete']));
const pumpState=v=>object(v)&&!Object.hasOwn(v,'kind')&&member(v.state,['active','stopped','budget_exhausted','renewal_expired'])&&(!Object.hasOwn(v,'error')||v.error===null);
const pump=v=>v.kind==='renew'?pumpState(v.status):!Object.hasOwn(v,'kind')&&pumpState(v);
const attribution=v=>object(v)&&(v.supported===false||v.supported===true&&exit(v.exit)&&member(v.coverage,['complete','incomplete']));
const loop=v=>object(v)&&Number.isFinite(v.maxMs)&&v.maxMs>=0&&integer(v.over100)&&Array.isArray(v.blocks);
export const coverageSentinel=r=>object(r)&&Object.keys(r).length===1&&object(r.diagnostics)&&Object.keys(r.diagnostics).sort().join(',')==='busy,coverage,protocol,records'&&r.diagnostics.protocol==='context-native-v1'&&r.diagnostics.coverage==='incomplete'&&r.diagnostics.busy===0&&Array.isArray(r.diagnostics.records)&&r.diagnostics.records.length===0;
const drain=v=>Array.isArray(v)&&v.every(r=>coverageSentinel(r)||object(r)&&r.state==='complete'&&r.workerStopped===true&&r.nativeDisposed===true);
const writer=v=>object(v)&&exit(v.exit)&&Array.isArray(v.calls)&&v.calls.every(c=>object(c)&&member(c.operation,['capture','review'])&&(c.code===null||c.code==='storage_busy'));
const target=v=>object(v)&&member(v.type,['memory','card'])&&text(v.id)&&member(v.intent,['current','history'])&&integer(v.revision)&&v.revision>0;
const inherited=v=>object(v)&&Array.isArray(v.retainedDecisions)&&v.retainedDecisions.every(d=>member(d,decisions))&&
  (!Object.hasOwn(v,'inheritedFailure')||v.inheritedFailure===false)&&
  (!Object.hasOwn(v,'cellKeys')||Array.isArray(v.cellKeys)&&v.cellKeys.every(text))&&
  (!Object.hasOwn(v,'cells')||Array.isArray(v.cells)&&v.cells.every(c=>object(c)&&text(c.key)&&c.complete===true&&member(c.decision,decisions)&&object(c.cell)));
const subprobe=v=>object(v)&&member(v.id,['status','opening','candidates','fetch','assembly',...['opening','candidates','fetch','assembly'].flatMap(p=>[p+'-abort',p+'-timeout'])])&&v.expected===true&&(v.code===null||member(v.code,errors));
const shapes={
  pump,maintenance:v=>member(v.status,['complete','partial','rebuilding']),
  'lane-exit':v=>exit(v.exit),'locker-exit':v=>exit(v.exit),
  capability:v=>v.ready===true||v.ready===false&&Array.isArray(v.blocked)&&v.blocked.length>0&&v.blocked.every(text),
  checkpoint:v=>verdict(v.decision),pair:v=>verdict(v.decision),
  'resumed-checkpoints':inherited,'session-validation':verdict,'WM-functional':verdict,'exposure-final':verdict,
  'WM-evidence':v=>verdict(v.validation)&&Array.isArray(v.decisions)&&v.decisions.every(verdict),
  'exposure-functional':v=>integer(v.windows)&&v.windows>0&&verdict(v.WM),
  'freshness-targets':v=>Array.isArray(v)&&v.every(target),
  'maintenance-drain':drain,'pump-drain':drain,'state-reader-final-drain':drain,
  'lane-startup':v=>integer(v.pid)&&v.pid>0,
  'session-parent-loop':v=>integer(v.hostPid)&&v.hostPid>0&&(!Object.hasOwn(v,'hostLoop')||loop(v.hostLoop)),
  'idle-baseline':loop,
  population:v=>object(v.initial)&&object(v.final)&&['memories','cards','schema'].every(k=>integer(v.initial[k])&&integer(v.final[k])),
  'window-boundary':v=>integer(v.repetition)&&member(v.variant,['baseline','reader']),
  'overlap-final':v=>member(v.series,['warmups','main','cold','warm-reference','WM','window'])&&integer(v.index)&&typeof v.overlap==='boolean',
  'admission-stopped':v=>member(v.reason,['stalled_activity','missing_progress','projected_overrun','operator_interrupted','stalled_child_activity','harness_failed'])&&integer(v.remaining),
  'backup-output':v=>Array.isArray(v.verifiedIntents)&&v.verifiedIntents.length>0&&v.verifiedIntents.every(i=>member(i,['current','history']))&&object(v.sidecar)&&['main','wal','shm','total'].every(k=>integer(v.sidecar[k]))&&member(v.maintainerCoverage,['complete','incomplete']),
  subprobe,
};
for(const series of ['warmups','main','cold','warm-reference','WM','window','probe','availability','restored-reader','functional','smoke','injection','c12','c24','a1500','a4000','f1-full','f1-compact','f1-snapshot','f24-full','f24-compact','f24-snapshot'])shapes[series]=read;
for(const series of ['writer','session-writer','window-writer','state-writer','catchup-writer','injected-writer'])shapes[series]=writer;
for(const series of ['attribution','backup-attribution','session-parent-attribution'])shapes[series]=attribution;
for(const series of ['failure','lane-failure','session-supervision','schedule-omission','subprobe-incomplete'])shapes[series]=()=>false;
export const JOURNAL_SERIES=Object.freeze(Object.keys(shapes).sort());
export function failedVerdict(value) {
  if(!value||typeof value!=='object')return false;
  if(value.decision==='failed'||value.observedFailure===true||value.functionalPassed===false)return true;
  return Object.values(value).some(v=>v&&typeof v==='object'&&failedVerdict(v));
}
export function journalFailure(series,record) {
  if(!Object.hasOwn(shapes,series)||failedVerdict(record))return true;
  if(!object(record)&&!Array.isArray(record))return true;
  // Only pump renewals and session read metadata have a top-level kind.
  if(Object.hasOwn(record,'kind')&&!member(record.kind,series==='pump'?['renew']:series==='availability'?['availability']:series==='probe'?['probe']:[]))return true;
  function bad(value) {
    if(!value||typeof value!=='object')return false;
    if(['writer_failed','writer_startup_failed','parent_sampler_failed'].includes(value.error))return true;
    if(Object.hasOwn(value,'exitCode')&&(value.exitCode!==0||value.signal!=null))return true;
    for(const [key,v] of Object.entries(value)){
      if(['exit','processExit','writerExit','lockerExit'].includes(key)&&v!=null&&!exit(v))return true;
      if(v&&typeof v==='object'&&bad(v))return true;
    }
    return false;
  }
  try{return bad(record)||!shapes[series](record);}catch{return true;}
}
