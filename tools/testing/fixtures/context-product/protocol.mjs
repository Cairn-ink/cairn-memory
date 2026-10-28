// Pure protocol arithmetic. No clocks, storage, imports of SQLite or runtime hooks.
import { isDeepStrictEqual } from 'node:util';
export const PROTOCOL = Object.freeze({ version: 'P2-product-v3', profile: 'context-read-product-v1.1',
  warmups: 3, pumpDrainMs:100, idleBaselineMs:100, mainMinimum: 50, mainCeiling: 500, coldMinimum: 10, coldCeiling: 100,
  repetitions: 5, windowMs: 30000, smokeWindowMs: 2000, writerCadenceMs: 20,
  loopMs: 100, settlementMs: 50, notReadyFraction: .01, availabilityMinimum: 100,
  freshnessMs: 30000, freshnessMinimum: 100, probeIntervalMs: 1000,
  writeOverlap: 20, closeOverlap: 10, commits: 100,
  latency: { findCandidates: { p95ByCount: {1112:700,3336:1000}, referenceP95Ms:300, maxMs:1500 },
    contextRead:{p95Ms:800,maxMs:2000}, fetchCandidateEvidence:{p95Ms:150,maxMs:500} },
  bounds: {responseBytes:65536,snapshotUnits:16384,cursorUnits:8192,candidateLimit:24,
    assembly:[{maxTokens:1500,maxItems:12},{maxTokens:4000,maxItems:24}]},
  gates: {walNativeBusy:0,walPublicBusy:0,walCoverage:['reader','maintainer','writer','baseline'],
    deleteBusy:'report_only',writerDeadline:'host_profile_no_overrun',writerTimeouts:['model_timeout','read_timeout'],
    expectedErrors:['storage_busy','index_unavailable','read_timeout','read_cancelled'],
    functional:'closed_DTO_and_frozen_selected_projection_oracle',overflow:'omissions_required',
    language:'frozen_known_answers_and_ranking; recall_and_known_misses_report_only',
    outputs:'size_backup_restore_build_deep_verify_fresh_reader_verify_required; no_numeric_threshold',
    production:'exact_registered_Node_patch_on_production_linux_ext4'},
  sampler: {intervalMs:10,capacity:4096,batchSize:128},
  telemetry: { readerProtocol: 'context-native-v1', readerFailureCapacity: 512,
    writerProtocol: 'product-writer-v1', writerCapacity: 65536, writerMaximumOperations:100000, chunkRecords: 65536 },
  drainSchedule: 'after every read and close; pump engine drain/ack every 100ms (over 500ms is incomplete), serialize between observations; export before immediate ack; writer chunks after every lifecycle; seal after final close, ack before disconnect',
});
export const METHODS = Object.freeze([
  { method: 'findCandidates', limit: 12 }, { method: 'findCandidates', limit: 24 },
  { method: 'contextRead', limit: 12, maxTokens: 1500 }, { method: 'contextRead', limit: 24, maxTokens: 4000 },
  ...[1,24].flatMap(refs => ['full','compact','snapshot'].map(adapter => ({ method: 'fetchCandidateEvidence', refs, adapter }))),
]);
// The plan is data: axes name dimensions; dependent dimensions resolve from the
// partial row. Ordering is deliberate and preserves the registered v3 inventory.
const samples={warmups:{minimum:3,ceiling:3},main:{minimum:50,ceiling:500},cold:{minimum:10,ceiling:100},
  'warm-reference':{minimum:50,ceiling:500}};
export const V3_DEFINITION = {
  version:'P2-product-v3', perAttemptFloorMs:1,
  dimensions:{count:[1112,3336],schema:[18,23,33],canonical:['DELETE','WAL'],sidecar:['DELETE','WAL'],
    intent:['current','history'],language:['zh','ja','mixed'],method:METHODS,
    load:['idle','fresh-same','fresh-other','retained-same','retained-other'],
    type:{by:'schema',values:{18:['memory'],23:['memory','card'],33:['memory','card']}},
    injection:['absent','exhaustion','abort','crash','post-catch-up']},
  modeClasses:{required:[['DELETE','DELETE'],['WAL','WAL']],control:[['DELETE','WAL'],['WAL','DELETE']]},
  fixedWindows:{loads:['fresh-same','fresh-other','retained-same','retained-other'],repetitions:5,windowMs:30000,paired:true},
  groups:[{axes:[],kinds:['requests']},
    {axes:['count','schema','canonical','sidecar','intent'],kinds:['freshness','availability','overflow']},
    {axes:['count','schema','canonical','sidecar'],kinds:['backup','injection']}],
  kinds:[
    {kind:'requests',fixedWindows:true,axes:['count','schema','canonical','sidecar','intent','language','method','load'],scope:'launch',
      series:['warmups','main','cold'],additionalSeries:{by:'method',values:{findCandidates:['warm-reference']}},samples},
    {kind:'freshness',axes:['count','schema','canonical','sidecar','intent','type'],scope:'launch',samples:{freshness:{minimum:100,ceiling:null}}},
    {kind:'availability',axes:['count','schema','canonical','sidecar','intent'],scope:'launch',samples:{availability:{minimum:100,ceiling:null}}},
    {kind:'overflow',axes:['count','schema','canonical','sidecar','intent'],scope:'overflow',
      defaults:{method:'findCandidates',limit:24,language:'mixed',load:'idle'},series:['warmups','main','cold'],samples},
    {kind:'backup',axes:['count','schema','canonical','sidecar'],scope:'launch',samples:{'restored-reader':{minimum:1,ceiling:1}}},
    {kind:'injection',axes:['count','schema','canonical','sidecar','injection'],scope:'launch',samples:{injection:{minimum:1,ceiling:1}}},
  ],
};
const scalarDimensions={count:[1112,3336],schema:[18,23,33],canonical:['DELETE','WAL'],sidecar:['DELETE','WAL'],
  intent:['current','history'],language:['zh','ja','mixed'],load:['idle','fresh-same','fresh-other','retained-same','retained-other'],
  type:['memory','card'],injection:['absent','exhaustion','abort','crash','post-catch-up']};
const kindAxes=Object.fromEntries(V3_DEFINITION.kinds.map(s=>[s.kind,[...s.axes]]));
const definitionError=field=>{throw Error('invalid_protocol_definition:'+field);};
const uniqueArray=value=>Array.isArray(value)&&new Set(value).size===value.length;
function dimensionValues(axis,values) {
  if(!uniqueArray(values)||!values.length)definitionError(axis);
  for(const value of values) {
    // A method entry is a closed workload profile, not an arbitrary row to
    // spread. Every field of the selected profile is a registered scalar.
    if(axis==='method') {if(!METHODS.some(m=>isDeepStrictEqual(m,value)))definitionError(axis);}
    else if(!scalarDimensions[axis]?.includes(value))definitionError(axis);
  }
}
export function validateDefinition(definition=V3_DEFINITION) {
  if(!definition||typeof definition.version!=='string'||!definition.version||!definition.dimensions||
    !Array.isArray(definition.kinds)||!definition.kinds.length||!Array.isArray(definition.groups)||!definition.groups.length)definitionError('shape');
  for(const [axis,dimension] of Object.entries(definition.dimensions)) {
    if(axis!=='method'&&!Object.hasOwn(scalarDimensions,axis))definitionError('axis');
    if(Array.isArray(dimension))dimensionValues(axis,dimension);
    else {
      if(axis!=='type'||!isDeepStrictEqual(Object.keys(dimension??{}).sort(),['by','values'])||dimension.by!=='schema'||
        !dimension.values||!isDeepStrictEqual(Object.keys(dimension.values).sort(),['18','23','33']))definitionError(axis);
      for(const [schema,values] of Object.entries(dimension.values)) {
        dimensionValues(axis,values);
        if(schema==='18'&&values.includes('card'))definitionError('type_schema');
      }
    }
  }
  const kinds=new Set();
  for(const spec of definition.kinds) {
    const required=kindAxes[spec.kind];
    if(!required||kinds.has(spec.kind)||!uniqueArray(spec.axes)||spec.axes.length!==required.length||
      required.some(axis=>!spec.axes.includes(axis)||!Object.hasOwn(definition.dimensions,axis)))definitionError('required_axes');
    kinds.add(spec.kind);
    if(spec.scope!==(spec.kind==='overflow'?'overflow':'launch'))definitionError('scope');
    const defaults=spec.kind==='overflow'?['method','limit','language','load']:[];
    if(Object.keys(spec.defaults??{}).some(key=>!defaults.includes(key)))definitionError('defaults');
    if(spec.kind==='overflow'&&(!['findCandidates'].includes(spec.defaults?.method)||![12,24].includes(spec.defaults?.limit)||
      !scalarDimensions.language.includes(spec.defaults?.language)||!scalarDimensions.load.includes(spec.defaults?.load)))definitionError('overflow_identity');
  }
  const grouped=[];
  for(const group of definition.groups) {
    if(!uniqueArray(group.axes)||!uniqueArray(group.kinds)||!group.kinds.length)definitionError('groups');
    for(const kind of group.kinds) {
      const spec=definition.kinds.find(s=>s.kind===kind);
      if(!spec||group.axes.some(axis=>!spec.axes.includes(axis)))definitionError('group_axes');
      grouped.push(kind);
    }
  }
  if(new Set(grouped).size!==grouped.length||grouped.length!==kinds.size)definitionError('group_kinds');
  const fixed=definition.fixedWindows;
  // The execution protocol always requires a separately seeded baseline.
  if(fixed?.paired!==true)definitionError('paired_baseline_required');
  if(!uniqueArray(fixed.loads)||fixed.loads.some(load=>!scalarDimensions.load.includes(load)||load==='idle')||
    !Number.isSafeInteger(fixed.repetitions)||fixed.repetitions<1||!Number.isSafeInteger(fixed.windowMs)||fixed.windowMs<1)definitionError('fixed_windows');
  return definition;
}
function cross(axes,dimensions,row={}) {
  if(!axes.length)return [row];
  const [axis,...rest]=axes,dimension=dimensions[axis];
  const values=Array.isArray(dimension)?dimension:dimension.values[row[dimension.by]];
  return values.flatMap(value=>cross(rest,dimensions,{...row,...(axis==='method'?value:{[axis]:value})}));
}
export function buildPlan(definition=V3_DEFINITION) {
  validateDefinition(definition);
  const cells=[];
  for(const group of definition.groups)for(const prefix of cross(group.axes,definition.dimensions)) {
    for(const kind of group.kinds) {
      const spec=definition.kinds.find(s=>s.kind===kind);
      for(const row of cross(spec.axes.filter(a=>!group.axes.includes(a)),definition.dimensions,prefix)) {
        if(spec.axes.some(axis=>axis==='method'?!METHODS.some(m=>Object.entries(m).every(([k,v])=>row[k]===v)):
          !scalarDimensions[axis].includes(row[axis]))||row.schema===18&&row.type==='card')definitionError('population_identity');
        const series=spec.series?[...spec.series,...(spec.additionalSeries?.values[row[spec.additionalSeries.by]]??[])]:undefined;
        const modeClass=Object.entries(definition.modeClasses).find(([,pairs])=>pairs.some(([c,s])=>c===row.canonical&&s===row.sidecar))?.[0];
        if(!modeClass)throw Error('unregistered_mode_cross_product');
        const fixed=spec.fixedWindows&&definition.fixedWindows.loads.includes(row.load);
        cells.push({id:cells.length,kind:spec.kind,scope:spec.scope,...spec.defaults,...row,modeClass,
          ...(series?{series}:{}),sampleRules:spec.samples,
          ...(spec.fixedWindows?{windows:fixed?definition.fixedWindows.repetitions:0,pairedBaseline:fixed&&definition.fixedWindows.paired,
            windowMs:definition.fixedWindows.windowMs}:{})});
      }
    }
  }
  return cells;
}
export function estimatePlan(plan=buildPlan(),definition=V3_DEFINITION) {
  const counts={},minimumSamplesByKind={};let fixedWindowMs=0,minimumAttempts=0;
  for(const cell of plan) {
    counts[cell.kind]=(counts[cell.kind]??0)+1;
    fixedWindowMs+=(cell.windows??0)*(cell.pairedBaseline?2:1)*(cell.windowMs??definition.fixedWindows.windowMs);
    const rules=cell.sampleRules??{};
    const n=(cell.series??Object.keys(rules)).reduce((sum,s)=>sum+(rules[s]?.minimum??0),0);
    minimumSamplesByKind[cell.kind]=(minimumSamplesByKind[cell.kind]??0)+n;minimumAttempts+=n;
  }
  const perAttemptFloorMs=definition.perAttemptFloorMs;
  return {protocol:definition.version,cellCount:plan.length,counts,minimumSamplesByKind,fixedWindowMs,minimumAttempts,perAttemptFloorMs,
    lowerBoundWallClockMs:fixedWindowMs+minimumAttempts*perAttemptFloorMs,
    assumption:`Serial cells; assumed ${perAttemptFloorMs} ms per minimum attempt outside fixed windows; excludes setup, rebuilds, extra attempts, availability windows and freshness waits. Not a measured runtime guarantee.`};
}
export function maintainerCoverage(diagnostics,fallback) {
  return fallback==='incomplete'?'incomplete':diagnostics.length?diagnostics.every(d=>d.coverage==='complete')?'complete':'incomplete':fallback??'incomplete';
}
export const readerLoops=records=>records.flatMap(r=>[r.hostLoop,...(r.launcherLoop?[r.launcherLoop]:[]),...(r.startupLoop?[r.startupLoop]:[])]);
export function quantiles(values) {
  if (values.some(v => typeof v !== 'number' || Number.isNaN(v) || v < 0)) throw Error('invalid_numeric_sample');
  const a = [...values].sort((a,b) => a-b), n = a.length;
  return { n, p50Ms: n ? a[Math.ceil(n*.5)-1] : null, p95Ms: n ? a[Math.ceil(n*.95)-1] : null, maxMs: n ? a[n-1] : null };
}
export const qualifies = (r, concurrent = false) => r.ok === true && r.validated === true && r.bounds === true &&
  r.expected === true && (!concurrent || r.overlap === true);
export function population(records, { cold = false, concurrent = false, warmReference = false, rule } = {}) {
  const a = records.filter(r => qualifies(r,concurrent));
  const {minimum,ceiling}=rule??{minimum:cold?10:50,ceiling:cold?100:500};
  return { attempts: records.length, successes: a.length, minimum, ceiling,
    allAttempts: quantiles(records.map(r => warmReference ? r.readMs : r.elapsedMs)),
    successful: quantiles(a.map(r => warmReference ? r.readMs : r.elapsedMs)),
    decision: records.length > ceiling ? 'invalid' : a.length < minimum ? 'inconclusive' : 'passed' };
}
export function exposure(kind, measured, baselineCommits = measured.commits) {
  if (['idle','injection'].includes(kind)) return { decision: 'passed' };
  const checks = { commits: measured.commits >= PROTOCOL.commits };
  if (kind !== 'baseline') {
    checks.baselineCommits = baselineCommits >= PROTOCOL.commits;
    checks.write = measured.activeWriteOverlap.pages >= PROTOCOL.writeOverlap;
    if (kind === 'fresh') checks.close = measured.activeCloseOverlap.pages >= PROTOCOL.closeOverlap;
  }
  return { checks, decision: Object.values(checks).every(Boolean) ? 'passed' : 'invalid' };
}
export function availability(records,{minimum=PROTOCOL.availabilityMinimum}={}) {
  const categories = { success:0, not_ready:0, timeout:0, other_error:0, scope_partial:0 };
  for (const r of records) {
    if (!['findCandidates','contextRead'].includes(r.method) || r.scheduled !== true) throw Error('availability_population');
    const category = r.notReady === true || r.code === 'index_unavailable' ? 'not_ready' :
      r.code === 'read_timeout' ? 'timeout' : r.code ? 'other_error' : r.scopePartial ? 'scope_partial' : 'success';
    categories[category]++;
  }
  const fraction = records.length ? categories.not_ready / records.length : null;
  return { categories, fraction, decision: fraction > PROTOCOL.notReadyFraction ? 'failed' : records.length < minimum ? 'inconclusive' : 'passed' };
}
export function freshness(targets,{minimum=PROTOCOL.freshnessMinimum}={}) {
  const q = quantiles(targets.map(t => t.observedAt === null ? Infinity : t.observedAt - t.committedAt));
  return { ...q, censored: targets.filter(t => t.observedAt === null).length,
    decision: q.p95Ms > PROTOCOL.freshnessMs ? 'failed' : targets.length < minimum ? 'inconclusive' : 'passed' };
}
export function aggregate(decisions) {
  return decisions.includes('failed') ? 'failed' : decisions.includes('invalid') ? 'invalid' :
    decisions.length === 0 || decisions.includes('inconclusive') ? 'inconclusive' : 'passed';
}
// Known failures are retained even when missing coverage separately invalidates a comparison.
export function decide(cell, data) {
  const checks = {}, invalid = [], unknown = [];
  if (data.blocked) return { decision: 'invalid', reason: 'blocked_dependency', dependency: data.blocked, checks };
  if (data.smoke || data.functionalOnly) return { decision: 'inconclusive', reason: 'operation_only', checks };
  const records = data.records ?? [], wal = cell.canonical === 'WAL' || cell.sidecar === 'WAL';
  if(cell.scope==='overflow'&&!(data.ownerCoverage?.omittedNamespaces>0))invalid.push('overflow_without_omissions');
  if(data.rebuildCoverage!==undefined&&data.rebuildCoverage!=='complete')invalid.push('rebuild_telemetry');
  checks.functional = records.every(r => r.bounds && r.expected && r.validated);
  checks.unexpectedErrors = records.every(r => !r.code || PROTOCOL.gates.expectedErrors.includes(r.code));
  const loops = data.loops ?? records.flatMap(r => [r.hostLoop, ...(r.launcherLoop ? [r.launcherLoop] : []),...(r.startupLoop?[r.startupLoop]:[])]);
  if (!loops.length) invalid.push('missing_loop_coverage');
  checks.loop = loops.every(l => l && l.maxMs <= PROTOCOL.loopMs && l.over100 === 0);
  checks.settlement = records.every(r => (r.overshootMs ?? 0) <= PROTOCOL.settlementMs && r.lateSuccess !== true);
  if (wal) {
    if (data.readerCoverage !== 'complete' || data.maintainerCoverage !== 'complete' || data.writerCoverage !== 'complete' || data.baselineCoverage !== 'complete') invalid.push('telemetry');
    checks.busy = (data.nativeBusy ?? 0) === PROTOCOL.gates.walNativeBusy && (data.publicBusy ?? 0) === PROTOCOL.gates.walPublicBusy;
  }
  if (data.exposure && data.exposure.decision !== 'passed') invalid.push('exposure');
  if (data.warmups !== undefined && data.warmups !== (cell.sampleRules?.warmups.minimum??PROTOCOL.warmups)) invalid.push('warmups');
  for (const [series, sample] of Object.entries(data.populations ?? {})) {
    if (sample.decision === 'invalid') invalid.push(series);
    if (sample.decision === 'inconclusive') unknown.push(series);
    const p = sample.successful, candidate = cell.method === 'findCandidates';
    const limits=PROTOCOL.latency[cell.method],p95=candidate?(series==='warm-reference'?limits.referenceP95Ms:limits.p95ByCount[cell.count]):limits.p95Ms,max=limits.maxMs;
    checks[series+'Latency'] = p.n === 0 ? null : p.p95Ms <= p95 && p.maxMs <= max;
  }
  if(data.writers)checks.writerErrors=data.writers.every(w=>!w.code||!wal&&w.code==='storage_busy');
  for (const op of ['capture','review']) if (data.writers) {
    const w = data.writers.filter(w => w.operation === op);
    if (!w.length || w.some(w => w.deadlineMs === null)) unknown.push(op+'Deadline');
    checks[op+'Deadline'] = w.every(w => w.deadlineMs === null || w.writeElapsedMs <= w.deadlineMs);
    checks[op+'Timeout'] = w.every(w => !PROTOCOL.gates.writerTimeouts.includes(w.code));
  }
  if (data.availability) checks.availability = data.availability.decision === 'failed' ? false : data.availability.decision === 'inconclusive' ? null : true;
  if (data.freshness) checks.freshness = data.freshness.decision === 'failed' ? false : data.freshness.decision === 'inconclusive' ? null : true;
  if (data.reportOutputsComplete === false || (data.enginePlatformEligible ?? data.production) === false) unknown.push('required_outputs_or_platform');
  const failed = Object.values(checks).some(v => v === false);
  return { decision: invalid.length ? 'invalid' : failed ? 'failed' : unknown.length || Object.values(checks).some(v => v === null) ? 'inconclusive' : 'passed',
    checks, invalid, unknown, observedFailure: failed };
}
export function expandPlan(plan) {
  const expanded=[];
  for(const cell of plan) {
    for(const series of cell.series??(cell.kind==='overflow'?['warmups','main','cold']:[cell.kind]))expanded.push({cell:cell.id,series});
    for(let repetition=0;repetition<(cell.windows??0);repetition++)
      for(const variant of cell.pairedBaseline?(repetition%2?['reader','baseline']:['baseline','reader']):['reader'])expanded.push({cell:cell.id,series:'contention',repetition,variant,windowMs:cell.windowMs??PROTOCOL.windowMs});
  }
  return expanded;
}
export function writerStatistics(result) {
  return Object.fromEntries(['capture','review'].map(operation=>{
    const calls=result.calls.filter(c=>c.operation===operation);
    return [operation,{attempts:calls.length,publicWrite:quantiles(calls.map(c=>c.writeElapsedMs).filter(Number.isFinite)),
      fullLifecycle:quantiles(calls.map(c=>c.elapsedMs)),perWriteClose:quantiles(calls.filter(c=>Number.isFinite(c.closeStartedAt)).map(c=>Math.max(0,c.finishedAt-c.closeStartedAt))),
      deadlines:[...new Set(calls.map(c=>c.deadlineMs))],errors:calls.filter(c=>c.code).length,
      missingDeadlines:calls.filter(c=>c.deadlineMs===null).length}];
  }));
}
