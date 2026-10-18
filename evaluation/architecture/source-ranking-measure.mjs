// H5 synthetic-only resource gate. This is not a semantic evaluation or a SLA.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { hostname, cpus, totalmem, platform, release } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { createQueryScore } from '../../core/query-candidates.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

export const CELLS = Object.freeze(['1000', '20000', 'worst1000', 'foreign1000', 'worst20000']);
export const POLICY = 'bounded-idf-v1';
export const WATCHDOG_MS = 60_000;
export const PROBE_INTERVAL_MS = 5;
export const PREFIX_SHA256 = '8ed97e23f6449d68e67fe8901cc5ec59410bc3a95d9e6e6411a53e9c7309926f';
const script = fileURLToPath(import.meta.url);
const ns = Object.freeze({ ownerId: 'keyset-measure', scope: 'personal', projectId: '' });
const stamp = () => process.hrtime.bigint().toString();
const milliseconds = (end, start) => Number(BigInt(end) - BigInt(start)) / 1e6;
const rowId = (owner, i) => `${owner}-${String(i).padStart(6, '0')}`;
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
let DatabaseSync, openMemoryCore, createMemoryRuntime;
async function loadNative() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  assert.ok(major > 22 || major === 22 && minor >= 16, 'measurement_requires_node_22_16');
  ({ DatabaseSync } = await import('node:sqlite'));
  ({ openMemoryCore } = await import('../../core/contract.mjs'));
  ({ createMemoryRuntime } = await import('../../core/runtime.mjs'));
}

export function cellSpec(cell) {
  assert.ok(CELLS.includes(cell), 'invalid_resource_cell');
  return { cell, authorized: ['20000', 'worst20000'].includes(cell) ? 20_000 : 1000,
    foreign: cell === 'foreign1000' ? 10_000 : 0,
    receiptsPerRow: cell.startsWith('worst') ? 4 : 1,
    receiptLength: cell.startsWith('worst') ? 800 : 80,
    queryTokenCount: cell === 'worst20000' ? 2000 : 1 };
}

export function worstWorkload() {
  const tokens = Array.from({ length: 2000 }, (_, i) => String.fromCodePoint(0x4e00 + i));
  const query = `${tokens.join(' ')}?`;
  assert.equal(query.length, 4000);
  return { query, passages(i) {
    return i % 2 === 0 ? { body: query, receipts: Array.from({ length: 4 }, (_, j) =>
      `${tokens.slice(400 * j, 400 * (j + 1)).join(' ')}?`) }
      : { body: `${tokens[i % 2000]} ${'x'.repeat(3998)}`,
        receipts: Array.from({ length: 4 }, (_, j) => `${tokens[(i + j + 1) % 2000]} ${'x'.repeat(798)}`) };
  } };
}

// Only called by the fresh preparation process; structural capacity fixtures.
export async function prepareStore(path, cell) {
  await loadNative();
  const spec = cellSpec(cell);
  const core = openMemoryCore({ path, sourceCandidatePolicy: 'bounded-keyset-v1' });
  const db = new DatabaseSync(path);
  try {
    const memory = db.prepare(`INSERT INTO memories
      (id,owner_id,scope,project_id,fingerprint,content,kind,origin,confidence,revision,
       deleted,created_at,updated_at,filing_status,currentness)
      VALUES (?,?,'personal','',?,?,'fact','explicit',1,1,?,'2026-01-01','2026-01-01','unfiled',?)`);
    const receipt = db.prepare(`INSERT INTO receipts
      (id,memory_id,receipt_key,client,session_id,event_id,role,excerpt,created_at)
      VALUES (?,?,?,'synthetic','resource',?,'user',?,'2026-01-01')`);
    const worst = worstWorkload();
    function seed(owner, count, receiptsPerRow, receiptLength, worstCase = false) {
      for (let i = 0; i < count; i += 1) {
        const memoryId = rowId(owner, i + 1);
        const passages = worstCase ? worst.passages(i) : null;
        memory.run(memoryId, owner, `${owner}-fingerprint-${i + 1}`,
          passages?.body ?? `${i === count - 1 ? 'tailmarker ' : ''}synthetic row ${i + 1}`, 0, 'current');
        for (let j = 0; j < receiptsPerRow; j += 1) {
          const eventId = `${memoryId}-r${j + 1}`;
          const suffix = ` source ${i + 1} ${j + 1}`;
          const excerpt = passages?.receipts[j] ?? `${'r'.repeat(receiptLength - suffix.length)}${suffix}`;
          assert.equal(excerpt.length, receiptLength);
          const key = createHash('sha256').update(JSON.stringify({ client: 'synthetic',
            sessionId: 'resource', eventId, role: 'user', excerpt })).digest('hex');
          receipt.run(eventId, memoryId, key, eventId, excerpt);
        }
      }
    }
    db.exec('BEGIN');
    try {
      seed(ns.ownerId, spec.authorized, spec.receiptsPerRow, spec.receiptLength, cell === 'worst20000');
      if (spec.foreign) seed('foreign-keyset-measure', spec.foreign, 1, 80);
      for (const [suffix, deleted, currentness] of [['history', 0, 'historical'], ['tombstone', 1, 'current']]) {
        const id = `${ns.ownerId}-${suffix}`;
        memory.run(id, ns.ownerId, id, deleted ? null : 'excludedmarker tailmarker', deleted, currentness);
        receipt.run(`${id}-r`, id, 'invalid', id, 'excludedmarker tailmarker');
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    const counts = inspectStore(db, spec);
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    return { ...spec, ...counts, denseRows: cell === 'worst20000' ? 10_000 : 0,
      sparseRows: cell === 'worst20000' ? 10_000 : 0 };
  } finally { db.close(); core.close(); }
}

function inspectStore(db, spec) {
  const memories = db.prepare('SELECT count(*) AS n FROM memories').get().n;
  const receipts = db.prepare('SELECT count(*) AS n FROM receipts').get().n;
  assert.equal(memories, spec.authorized + spec.foreign + 2, 'invalid_memory_count');
  assert.equal(receipts, spec.authorized * spec.receiptsPerRow + spec.foreign + 2, 'invalid_receipt_count');
  const queryPlan = db.prepare(`EXPLAIN QUERY PLAN SELECT id,revision FROM memories
    INDEXED BY capture_current_memories WHERE owner_id=? AND scope=? AND project_id=?
      AND deleted=0 AND review_state!='awaiting' AND currentness='current' AND id>? ORDER BY id LIMIT ?`)
    .all(ns.ownerId, ns.scope, ns.projectId, '', 256).map(row => row.detail);
  assert.ok(queryPlan.some(detail => detail.includes('SEARCH memories USING INDEX capture_current_memories')), 'missing_indexed_plan');
  assert.ok(queryPlan.every(detail => !detail.includes('TEMP B-TREE')), 'invalid_sort_plan');
  return { memories, receipts, queryPlan };
}

export function queryMeasurement(runtime, spec, arm) {
  assert.ok(['old', 'new'].includes(arm), 'invalid_resource_arm');
  const query = spec.cell === 'worst20000' ? worstWorkload().query : 'tailmarker';
  const scorer = createQueryScore(query);
  let scored = 0;
  let excludedScored = false;
  const options = { score(text) { scored += 1; excludedScored ||= text.includes('excludedmarker'); return scorer(text); },
    memoryLabel: text => [...text].slice(0, 120).join(''),
    sourceReceiptLimit: 4, sourceCandidatePolicy: 'bounded-keyset-v1',
    ...(arm === 'new' ? { sourceRankingPolicy: POLICY, query } : {}) };
  const rssBefore = process.memoryUsage().rss;
  const cpuBefore = process.cpuUsage();
  const queryStart = stamp();
  const started = performance.now();
  const result = runtime.queryCandidateRows(ns, options);
  const elapsedMs = performance.now() - started;
  const queryEnd = stamp();
  const cpu = process.cpuUsage(cpuBefore);
  const rssAfter = process.memoryUsage().rss;
  const peakRssBytes = process.resourceUsage().maxRSS * 1024;
  assert.equal(result.rows.length, Math.min(spec.authorized, 1024), 'invalid_retained_count');
  assert.equal(result.scanExhausted, spec.authorized <= 1024, 'invalid_scan_exhaustion');
  assert.equal(excludedScored, false, 'excluded_source_read');
  if (arm === 'old') {
    assert.equal(scored, spec.authorized * (spec.receiptsPerRow + 1), 'invalid_old_score_count');
    assert.equal(result.ranking, undefined, 'old_shape_changed');
  } else {
    validateRanking(result.ranking, spec);
    assert.equal(scored, 0, 'new_ranking_called_legacy_scorer');
  }
  return { arm, cell: spec.cell, queryStart, queryEnd, elapsedMs,
    cpuUserMs: cpu.user / 1000, cpuSystemMs: cpu.system / 1000,
    cpuTotalMs: (cpu.user + cpu.system) / 1000, rssBefore, rssAfter, peakRssBytes,
    retained: result.rows.length, scored, scanExhausted: result.scanExhausted,
    ...(arm === 'new' ? { ranking: result.ranking } : { maskBytes: 0 }) };
}

export function validateRanking(ranking, spec) {
  assert.equal(ranking?.version, POLICY, 'ranking_policy_not_active');
  assert.deepEqual(Object.keys(ranking).sort(), ['version', 'physicalRows', 'eligibleMemories', 'receiptReads',
    'retainedRows', 'maskBytes', 'queryTokenCount', 'retainedReceiptReads'].sort(), 'unexpected_ranking_metadata');
  for (const key of ['physicalRows', 'eligibleMemories', 'receiptReads', 'retainedRows',
    'maskBytes', 'queryTokenCount', 'retainedReceiptReads']) {
    assert.ok(Number.isSafeInteger(ranking[key]) && ranking[key] >= 0, `invalid_ranking_${key}`);
  }
  assert.equal(ranking.physicalRows, spec.authorized, 'invalid_physical_rows');
  assert.equal(ranking.eligibleMemories, spec.authorized, 'invalid_eligible_memories');
  assert.equal(ranking.receiptReads, spec.authorized * spec.receiptsPerRow, 'invalid_receipt_reads');
  assert.equal(ranking.retainedRows, Math.min(spec.authorized, 1024), 'invalid_retained_rows');
  assert.equal(ranking.queryTokenCount, spec.queryTokenCount, 'invalid_query_token_count');
  // Five bounded passage slots per physical row are allowed even when this
  // particular structural cell supplies fewer receipts.
  const maximumMaskBytes = spec.authorized * 5 * Math.ceil(spec.queryTokenCount / 32) * 4;
  assert.ok(ranking.maskBytes <= maximumMaskBytes, 'mask_payload_bound_exceeded');
  assert.ok(ranking.retainedReceiptReads <= ranking.retainedRows, 'retained_reread_bound_exceeded');
  return maximumMaskBytes;
}

export function childEnvironment(env = process.env) {
  const clean = { PATH: env.PATH ?? '/usr/bin:/bin', NODE_NO_WARNINGS: '1' };
  for (const key of ['TMPDIR', 'TMP', 'TEMP']) {
    if (typeof env[key] === 'string' && env[key].startsWith('/') && existsSync(env[key]) && statSync(env[key]).isDirectory()) clean[key] = env[key];
  }
  return clean;
}

// Every child is awaited through close (not just exit), including failures and
// signals. No detached child or OS background handoff is used.
export class ChildSupervisor {
  constructor({ launch = spawn, observe = () => {}, watchdogMs = WATCHDOG_MS } = {}) {
    this.launch = launch; this.observe = observe; this.watchdogMs = watchdogMs; this.children = new Set();
  }
  start(input) {
    const child = this.launch(process.execPath, [script, '--child', JSON.stringify(input)], {
      env: childEnvironment(), stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    const state = { input, child, messages: [], stdout: '', stderr: '', waiters: [], timedOut: false, error: null };
    this.children.add(state);
    const timer = setTimeout(() => { state.timedOut = true; child.kill('SIGKILL'); }, this.watchdogMs);
    const collect = key => data => {
      state[key] += data.toString();
      if (state[key].length > 65_536) { state.error = 'child_output_limit'; child.kill('SIGKILL'); }
    };
    child.stdout.on('data', collect('stdout')); child.stderr.on('data', collect('stderr'));
    child.on('message', message => {
      state.messages.push(message);
      for (const waiter of [...state.waiters]) if (message.type === waiter.type) {
        state.waiters.splice(state.waiters.indexOf(waiter), 1); waiter.resolve(message);
      }
    });
    child.on('error', error => { state.error = error.code ?? error.name; });
    state.done = new Promise(resolveDone => child.on('close', (status, signal) => {
      clearTimeout(timer); this.children.delete(state);
      const raw = { type: 'child', input, status, signal, timedOut: state.timedOut,
        error: state.error, stdout: state.stdout, stderr: state.stderr, messages: state.messages };
      this.observe(raw);
      for (const waiter of state.waiters.splice(0)) waiter.reject(new Error('child_closed_before_handshake'));
      state.closed = true; resolveDone(raw);
    }));
    state.send = message => {
      assert.ok(!state.closed, 'child_already_closed');
      if (!child.connected) return;
      child.send(message, error => { if (error) { state.error = error.code ?? error.name; child.kill('SIGKILL'); } });
    };
    state.wait = type => {
      const message = state.messages.find(value => value.type === type);
      if (message) return Promise.resolve(message);
      if (state.closed) return Promise.reject(new Error('child_closed_before_handshake'));
      return new Promise((resolveWait, reject) => state.waiters.push({ type, resolve: resolveWait, reject }));
    };
    return state;
  }
  async stopAll() {
    const owned = [...this.children];
    for (const state of owned) state.child.kill('SIGKILL');
    await Promise.all(owned.map(state => state.done));
  }
}

export function assertChild(raw) {
  assert.equal(raw.status, 0, 'child_nonzero_exit');
  assert.equal(raw.signal, null, 'child_signal');
  assert.equal(raw.timedOut, false, 'child_watchdog');
  assert.equal(raw.error, null, 'child_process_error');
  const results = raw.messages.filter(message => message.type === 'result');
  assert.equal(results.length, 1, 'invalid_child_result_count');
  return results[0].value;
}

const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
export function resourceGate(observations) {
  assert.equal(observations.length, 6, 'three_pairs_required');
  for (let pair = 0; pair < 3; pair += 1) {
    assert.deepEqual(observations.filter(row => row.pair === pair).map(row => row.arm).sort(), ['new', 'old'], 'invalid_paired_observations');
  }
  const old = observations.filter(row => row.arm === 'old');
  const fresh = observations.filter(row => row.arm === 'new');
  assert.equal(old.length, 3); assert.equal(fresh.length, 3);
  const metrics = {};
  let pass = true;
  for (const metric of ['elapsedMs', 'cpuTotalMs', 'peakRssBytes']) {
    for (const row of observations) assert.ok(Number.isFinite(row[metric]) && row[metric] >= 0, 'invalid_resource_metric');
    const oldMedian = median(old.map(row => row[metric]));
    const newMedian = median(fresh.map(row => row[metric]));
    const limit = metric === 'peakRssBytes' ? oldMedian + 64 * 1024 * 1024 : 2 * oldMedian + 10;
    metrics[metric] = { oldMedian, newMedian, limit, pass: newMedian <= limit };
    pass &&= metrics[metric].pass;
  }
  return { status: pass ? 'pass' : 'fail', metrics };
}

export function contentionGate(query, probe) {
  if (probe.writerError || probe.writerSucceeded === false) return { ...probe, status: 'fail', reason: 'writer_failed' };
  if (probe.probeIntervalMs !== PROBE_INTERVAL_MS || probe.writerWaitMs >= 5000
    || (probe.writerTimeoutMs !== undefined && probe.writerTimeoutMs !== 5000)) {
    return { ...probe, status: 'fail', reason: 'invalid_probe_bound_or_busy_timeout' };
  }
  if (!probe.lastSuccessRelease || !probe.firstAcquire || !probe.firstRelease || !probe.firstBusy || !query.queryStart || !query.queryEnd) {
    return { ...probe, status: 'inconclusive', reason: 'missing_bracket_or_overlap' };
  }
  const overlap = BigInt(probe.firstBusy) >= BigInt(query.queryStart) && BigInt(probe.firstBusy) <= BigInt(query.queryEnd);
  const bracketMs = milliseconds(probe.firstRelease, probe.lastSuccessRelease);
  const valid = BigInt(probe.lastSuccessRelease) <= BigInt(probe.firstBusy)
    && BigInt(probe.firstBusy) <= BigInt(probe.firstAcquire) && BigInt(probe.firstAcquire) <= BigInt(probe.firstRelease);
  if (!valid || !overlap || !Number.isFinite(probe.writerWaitMs) || probe.writerWaitMs < 0) {
    return { ...probe, status: 'inconclusive', reason: 'invalid_bracket_or_missing_overlap', overlap, bracketMs };
  }
  return { ...probe, overlap, bracketMs, status: bracketMs < 2500 && probe.writerWaitMs < 2500 ? 'pass' : 'inconclusive',
    reason: bracketMs < 2500 && probe.writerWaitMs < 2500 ? 'bounded_observed_blocking' : 'threshold_crossing' };
}

export async function measureContention(supervisor, path, cell, arm) {
  const query = supervisor.start({ role: 'query', path, cell, arm, handshake: true });
  try {
    // Core open can itself reserve a writer. Finish it before even opening the
    // zero-timeout probe connection, so its baseline cannot collide with open.
    await query.wait('ready');
    const probe = supervisor.start({ role: 'probe', path });
    await probe.wait('ready');
    // A successful zero-timeout probe has already completed on the ready probe
    // connection; neither connection is initialized after the query GO.
    query.send({ type: 'go' });
    await query.wait('starting');
    probe.send({ type: 'go' });
    const queryRaw = await query.done;
    const measured = assertChild(queryRaw);
    if (!probe.closed) probe.send({ type: 'stop' });
    const probeResult = assertChild(await probe.done);
    return contentionGate(measured, probeResult);
  } finally { await supervisor.stopAll(); }
}

export async function runCampaign({ cells = CELLS, contentionOnly = false, observe = value => process.stdout.write(`${JSON.stringify(value)}\n`),
  supervisor = new ChildSupervisor({ observe }) } = {}) {
  const workspace = createTestWorkspace(null, { prefix: 'cairn-source-ranking-resource-' });
  let interrupted = null;
  const handlers = new Map(['SIGINT', 'SIGTERM', 'SIGHUP'].map(signal => [signal, () => { interrupted = signal; void supervisor.stopAll(); }]));
  for (const [signal, handler] of handlers) process.on(signal, handler);
  const summaries = [];
  let final;
  try {
    observe({ type: 'environment', synthetic: true, semanticAccuracy: 'not-measured', prefixSha256: PREFIX_SHA256,
      node: process.version, executable: process.execPath, hostname: hostname(), platform: platform(), release: release(),
      cpu: cpus()[0]?.model, logicalCpus: cpus().length, totalMemoryBytes: totalmem(),
      measuredAt: new Date().toISOString(), cells, repetitions: 3, watchdogMs: WATCHDOG_MS,
      probeIntervalMs: PROBE_INTERVAL_MS, execution: 'sequential; operator must exclude unrelated heavy gates' });
    for (const cell of cells) {
      const spec = cellSpec(cell);
      if (contentionOnly && spec.authorized !== 20_000) continue;
      assert.equal(interrupted, null, 'campaign_interrupted');
      const path = join(workspace.path, `${cell}.sqlite`);
      const prepared = assertChild(await supervisor.start({ role: 'prepare', path, cell }).done);
      const unchanged = digest(path);
      observe({ type: 'prepared', cell, ...prepared, databaseSha256: unchanged });
      const observations = [];
      if (!contentionOnly) for (let pair = 0; pair < 3; pair += 1) {
        for (const arm of pair % 2 === 0 ? ['old', 'new'] : ['new', 'old']) {
          assert.equal(interrupted, null, 'campaign_interrupted');
          const result = assertChild(await supervisor.start({ role: 'query', path, cell, arm, pair }).done);
          observations.push({ ...result, pair });
          assert.equal(digest(path), unchanged, 'store_changed_between_arms');
        }
      }
      const resource = contentionOnly ? null : resourceGate(observations);
      const locks = [];
      // A failed resource gate stops promotion immediately; do not run later cells.
      if (resource?.status !== 'fail' && spec.authorized === 20_000) for (const arm of ['old', 'new']) {
        assert.equal(interrupted, null, 'campaign_interrupted');
        const result = await measureContention(supervisor, path, cell, arm);
        locks.push({ arm, ...result });
        observe({ type: 'contention', cell, arm, ...result });
        assert.equal(digest(path), unchanged, 'store_changed_during_contention');
        if (result.status !== 'pass') break;
      }
      const summary = { type: 'cell-gate', cell, resource, contention: locks,
        status: resource?.status === 'fail' || locks.some(row => row.status === 'fail') ? 'fail'
          : locks.some(row => row.status !== 'pass') ? 'inconclusive' : 'pass' };
      summaries.push(summary); observe(summary);
      if (summary.status !== 'pass') break;
    }
    const pass = summaries.length === cells.filter(cell => !contentionOnly || cellSpec(cell).authorized === 20_000).length
      && summaries.every(row => row.status === 'pass') && summaries.length > 0;
    final = { type: 'promotion', status: pass ? 'pass' : 'stop', summaries, interrupted };
    return final;
  } catch (error) {
    observe({ type: 'promotion', status: 'stop', reason: error.message, interrupted });
    throw error;
  } finally {
    try {
      await supervisor.stopAll();
      await workspace.cleanup();
      if (final) observe(final);
    } catch (error) {
      observe({ type: 'promotion', status: 'stop', reason: 'owned_cleanup_failed', interrupted });
      throw error;
    } finally {
      for (const [signal, handler] of handlers) process.removeListener(signal, handler);
    }
  }
}

const send = message => new Promise((resolveSend, reject) => process.send(message, error => error ? reject(error) : resolveSend()));
const receive = type => new Promise(resolveReceive => {
  const listener = message => { if (message.type === type) { process.off('message', listener); resolveReceive(message); } };
  process.on('message', listener);
});

async function runProbe(path) {
  const db = new DatabaseSync(path);
  let lastSuccessRelease;
  let stopped = false;
  const stop = message => { if (message.type === 'stop') stopped = true; };
  process.on('message', stop);
  try {
    db.exec('PRAGMA busy_timeout=0');
    db.exec('BEGIN IMMEDIATE'); db.exec('ROLLBACK');
    lastSuccessRelease = stamp();
    const go = receive('go');
    await send({ type: 'ready', baselineSuccessRelease: lastSuccessRelease });
    await go;
    let probes = 0;
    while (!stopped) {
      probes += 1;
      try {
        db.exec('BEGIN IMMEDIATE'); db.exec('ROLLBACK'); lastSuccessRelease = stamp();
      } catch (error) {
        if (!Number.isInteger(error.errcode) || (error.errcode & 0xff) !== 5) throw error;
        const firstBusy = stamp();
        await send({ type: 'busy', lastSuccessRelease, firstBusy });
        db.exec('PRAGMA busy_timeout=5000');
        const writerStart = stamp();
        try {
          db.exec('BEGIN IMMEDIATE');
          const firstAcquire = stamp();
          db.exec('ROLLBACK');
          return { probeIntervalMs: PROBE_INTERVAL_MS, probes, lastSuccessRelease, firstBusy,
            firstAcquire, firstRelease: stamp(), writerSucceeded: true,
            writerWaitMs: milliseconds(firstAcquire, writerStart), writerTimeoutMs: 5000 };
        } catch (writerError) {
          return { probeIntervalMs: PROBE_INTERVAL_MS, probes, lastSuccessRelease, firstBusy,
            writerSucceeded: false, writerError: writerError.code ?? writerError.name,
            writerWaitMs: milliseconds(stamp(), writerStart), writerTimeoutMs: 5000 };
        }
      }
      await new Promise(resolveTimer => setTimeout(resolveTimer, PROBE_INTERVAL_MS));
    }
    return { probeIntervalMs: PROBE_INTERVAL_MS, probes, lastSuccessRelease, writerSucceeded: null };
  } finally { process.off('message', stop); db.close(); }
}

async function childMain(input) {
  await loadNative();
  if (input.role === 'prepare') return prepareStore(input.path, input.cell);
  if (input.role === 'probe') return runProbe(input.path);
  assert.equal(input.role, 'query', 'invalid_child_role');
  const spec = cellSpec(input.cell);
  const runtime = createMemoryRuntime({ path: input.path });
  const db = new DatabaseSync(input.path);
  try {
    const inspected = inspectStore(db, spec);
    if (input.handshake) {
      const go = receive('go');
      await send({ type: 'ready' }); await go;
      await send({ type: 'starting' });
    }
    const result = queryMeasurement(runtime, spec, input.arm);
    const fileBytes = suffix => existsSync(`${input.path}${suffix}`) ? statSync(`${input.path}${suffix}`).size : 0;
    return { ...result, ...inspected, databaseMainBytes: fileBytes(''),
      databaseWalBytes: fileBytes('-wal'), databaseShmBytes: fileBytes('-shm'),
      sqlitePostingWork: 'not-measured', peakIncludes: 'fresh process startup and core open' };
  } finally { db.close(); runtime.close(); }
}

export function parseOptions(arguments_) {
  const args = [...arguments_];
  let cell;
  let contentionOnly = false;
  while (args.length) {
    const option = args.shift();
    if (option === '--cell' && cell === undefined) { cell = args.shift(); cellSpec(cell); }
    else if (option === '--contention-only' && !contentionOnly) contentionOnly = true;
    else throw new Error('invalid_measurement_option');
  }
  if (contentionOnly && cell !== undefined) assert.equal(cellSpec(cell).authorized, 20_000, 'contention_requires_20000_cell');
  return { cells: cell === undefined ? CELLS : [cell], contentionOnly };
}

if (resolve(process.argv[1] ?? '') === script) {
  try {
    if (process.argv[2] === '--child') {
      const value = await childMain(JSON.parse(process.argv[3]));
      await send({ type: 'result', value }); process.disconnect();
    } else {
      const result = await runCampaign(parseOptions(process.argv.slice(2)));
      if (result.status !== 'pass') process.exitCode = 1;
    }
  } catch (error) {
    if (process.send) { await send({ type: 'failure', code: error.code ?? error.name, reason: error.message.split('\n')[0] }); process.disconnect(); }
    else process.stderr.write(`${JSON.stringify({ type: 'failure', code: error.code ?? error.name, reason: error.message.split('\n')[0] })}\n`);
    process.exitCode = 1;
  }
}
