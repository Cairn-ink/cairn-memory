// Pure protocol arithmetic. No clocks, storage, imports of SQLite or runtime hooks.
export const PROTOCOL = Object.freeze({ version: 'P2-product-v3', profile: 'context-read-product-v1.1',
  warmups: 3, pumpDrainMs:100, idleBaselineMs:100, mainMinimum: 50, mainCeiling: 500, coldMinimum: 10, coldCeiling: 100,
  repetitions: 5, windowMs: 30000, smokeWindowMs: 2000, writerCadenceMs: 20,
  loopMs: 100, settlementMs: 50, notReadyFraction: .01, availabilityMinimum: 100,
  freshnessMs: 30000, freshnessMinimum: 100, probeIntervalMs: 1000,
  writeOverlap: 20, closeOverlap: 10, commits: 100,
  telemetry: { readerProtocol: 'context-native-v1', readerFailureCapacity: 512,
    writerProtocol: 'product-writer-v1', writerCapacity: 65536, writerMaximumOperations:100000, chunkRecords: 65536 },
  drainSchedule: 'after every read and close; pump engine drain/ack every 100ms (over 500ms is incomplete), serialize between observations; export before immediate ack; writer chunks after every lifecycle; seal after final close, ack before disconnect',
});
export const METHODS = Object.freeze([
  { method: 'findCandidates', limit: 12 }, { method: 'findCandidates', limit: 24 },
  { method: 'contextRead', limit: 12, maxTokens: 1500 }, { method: 'contextRead', limit: 24, maxTokens: 4000 },
  ...[1,24].flatMap(refs => ['full','compact','snapshot'].map(adapter => ({ method: 'fetchCandidateEvidence', refs, adapter }))),
]);
export function buildPlan() {
  const cells = [];
  const add = c => cells.push({ id: cells.length, ...c });
  for (const count of [1112,3336]) for (const schema of [18,23,33])
    for (const canonical of ['DELETE','WAL']) for (const sidecar of ['DELETE','WAL'])
      for (const intent of ['current','history']) for (const language of ['zh','ja','mixed'])
        for (const method of METHODS) for (const load of ['idle','fresh-same','fresh-other','retained-same','retained-other'])
          add({ kind: 'requests', count, schema, canonical, sidecar, intent, language, ...method, load,
            scope: 'launch', series: ['warmups','main','cold', ...(method.method === 'findCandidates' ? ['warm-reference'] : [])],
            windows: load === 'idle' ? 0 : 5, pairedBaseline: load !== 'idle' });
  for (const count of [1112,3336]) for (const schema of [18,23,33])
    for (const canonical of ['DELETE','WAL']) for (const sidecar of ['DELETE','WAL'])
      for (const intent of ['current','history']) {
        for (const type of schema === 18 ? ['memory'] : ['memory','card'])
          add({ kind: 'freshness', count, schema, canonical, sidecar, intent, type, scope: 'launch' });
        add({ kind: 'availability', count, schema, canonical, sidecar, intent, scope: 'launch' });
        add({ kind: 'overflow', count, schema, canonical, sidecar, intent, scope: 'overflow', method:'findCandidates', limit:24, language:'mixed', load:'idle' });
      }
  for (const count of [1112,3336]) for (const schema of [18,23,33])
    for (const canonical of ['DELETE','WAL']) for (const sidecar of ['DELETE','WAL']) {
      add({ kind: 'backup', count, schema, canonical, sidecar, scope: 'launch' });
      for (const injection of ['absent','exhaustion','abort','crash','post-catch-up'])
        add({ kind: 'injection', injection, count, schema, canonical, sidecar, scope: 'launch' });
    }
  return cells;
}
export function quantiles(values) {
  if (values.some(v => typeof v !== 'number' || Number.isNaN(v) || v < 0)) throw Error('invalid_numeric_sample');
  const a = [...values].sort((a,b) => a-b), n = a.length;
  return { n, p50Ms: n ? a[Math.ceil(n*.5)-1] : null, p95Ms: n ? a[Math.ceil(n*.95)-1] : null, maxMs: n ? a[n-1] : null };
}
export const qualifies = (r, concurrent = false) => r.ok === true && r.validated === true && r.bounds === true &&
  r.expected === true && (!concurrent || r.overlap === true);
export function population(records, { cold = false, concurrent = false, warmReference = false } = {}) {
  const a = records.filter(r => qualifies(r,concurrent));
  const minimum = cold ? 10 : 50, ceiling = cold ? 100 : 500;
  return { attempts: records.length, successes: a.length, minimum, ceiling,
    allAttempts: quantiles(records.map(r => warmReference ? r.readMs : r.elapsedMs)),
    successful: quantiles(a.map(r => warmReference ? r.readMs : r.elapsedMs)),
    decision: records.length > ceiling ? 'invalid' : a.length < minimum ? 'inconclusive' : 'passed' };
}
export function exposure(kind, measured, baselineCommits = measured.commits) {
  if (['idle','injection'].includes(kind)) return { decision: 'passed' };
  const checks = { commits: measured.commits >= 100 };
  if (kind !== 'baseline') {
    checks.baselineCommits = baselineCommits >= 100;
    checks.write = measured.activeWriteOverlap.pages >= 20;
    if (kind === 'fresh') checks.close = measured.activeCloseOverlap.pages >= 10;
  }
  return { checks, decision: Object.values(checks).every(Boolean) ? 'passed' : 'invalid' };
}
export function availability(records) {
  const categories = { success:0, not_ready:0, timeout:0, other_error:0, scope_partial:0 };
  for (const r of records) {
    if (!['findCandidates','contextRead'].includes(r.method) || r.scheduled !== true) throw Error('availability_population');
    const category = r.notReady === true || r.code === 'index_unavailable' ? 'not_ready' :
      r.code === 'read_timeout' ? 'timeout' : r.code ? 'other_error' : r.scopePartial ? 'scope_partial' : 'success';
    categories[category]++;
  }
  const fraction = records.length ? categories.not_ready / records.length : null;
  return { categories, fraction, decision: fraction > .01 ? 'failed' : records.length < 100 ? 'inconclusive' : 'passed' };
}
export function freshness(targets) {
  const q = quantiles(targets.map(t => t.observedAt === null ? Infinity : t.observedAt - t.committedAt));
  return { ...q, censored: targets.filter(t => t.observedAt === null).length,
    decision: q.p95Ms > 30000 ? 'failed' : targets.length < 100 ? 'inconclusive' : 'passed' };
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
  checks.functional = records.every(r => r.bounds && r.expected && r.validated);
  checks.unexpectedErrors = records.every(r => !r.code || ['storage_busy','index_unavailable','read_timeout','read_cancelled'].includes(r.code));
  const loops = data.loops ?? records.flatMap(r => [r.hostLoop, ...(r.launcherLoop ? [r.launcherLoop] : []),...(r.startupLoop?[r.startupLoop]:[])]);
  if (!loops.length) invalid.push('missing_loop_coverage');
  checks.loop = loops.every(l => l && l.maxMs <= 100 && l.over100 === 0);
  checks.settlement = records.every(r => (r.overshootMs ?? 0) <= 50 && r.lateSuccess !== true);
  if (wal) {
    if (data.readerCoverage !== 'complete' || data.maintainerCoverage !== 'complete' || data.writerCoverage !== 'complete' || data.baselineCoverage !== 'complete') invalid.push('telemetry');
    checks.busy = (data.nativeBusy ?? 0) === 0 && (data.publicBusy ?? 0) === 0;
  }
  if (data.exposure && data.exposure.decision !== 'passed') invalid.push('exposure');
  if (data.warmups !== undefined && data.warmups !== 3) invalid.push('warmups');
  for (const [series, sample] of Object.entries(data.populations ?? {})) {
    if (sample.decision === 'invalid') invalid.push(series);
    if (sample.decision === 'inconclusive') unknown.push(series);
    const p = sample.successful, candidate = cell.method === 'findCandidates';
    const p95 = candidate ? series === 'warm-reference' ? 300 : cell.count === 1112 ? 700 : 1000 : cell.method === 'contextRead' ? 800 : 150;
    const max = candidate ? 1500 : cell.method === 'contextRead' ? 2000 : 500;
    checks[series+'Latency'] = p.n === 0 ? null : p.p95Ms <= p95 && p.maxMs <= max;
  }
  if(data.writers)checks.writerErrors=data.writers.every(w=>!w.code||!wal&&w.code==='storage_busy');
  for (const op of ['capture','review']) if (data.writers) {
    const w = data.writers.filter(w => w.operation === op);
    if (!w.length || w.some(w => w.deadlineMs === null)) unknown.push(op+'Deadline');
    checks[op+'Deadline'] = w.every(w => w.deadlineMs === null || w.writeElapsedMs <= w.deadlineMs);
    checks[op+'Timeout'] = w.every(w => !['model_timeout','read_timeout'].includes(w.code));
  }
  if (data.availability) checks.availability = data.availability.decision === 'failed' ? false : data.availability.decision === 'inconclusive' ? null : true;
  if (data.freshness) checks.freshness = data.freshness.decision === 'failed' ? false : data.freshness.decision === 'inconclusive' ? null : true;
  if (data.reportOutputsComplete === false || data.production === false) unknown.push('required_outputs_or_platform');
  const failed = Object.values(checks).some(v => v === false);
  return { decision: invalid.length ? 'invalid' : failed ? 'failed' : unknown.length || Object.values(checks).some(v => v === null) ? 'inconclusive' : 'passed',
    checks, invalid, unknown, observedFailure: failed };
}
export function expandPlan(plan) {
  const expanded=[];
  for(const cell of plan) {
    for(const series of cell.series??(cell.kind==='overflow'?['warmups','main','cold']:[cell.kind]))expanded.push({cell:cell.id,series});
    for(let repetition=0;repetition<(cell.windows??0);repetition++)
      for(const variant of repetition%2?['reader','baseline']:['baseline','reader'])expanded.push({cell:cell.id,series:'contention',repetition,variant,windowMs:30000});
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
