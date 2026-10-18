// H5b synthetic resource campaign. Frozen H5 remains an independent failed experiment.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { cpus, hostname, platform, release, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { CELLS, POLICY, WATCHDOG_MS, ChildSupervisor as FrozenSupervisor, assertChild,
  cellSpec, childEnvironment, parseOptions, prepareStore, queryMeasurement, resourceGate,
  validateRanking, worstWorkload } from './source-ranking-measure.mjs';

export { CELLS, POLICY, WATCHDOG_MS, assertChild, cellSpec, childEnvironment, parseOptions,
  prepareStore, queryMeasurement, resourceGate, validateRanking, worstWorkload };
export const PREFIX_SHA256 = '7253269b0b0ee53ee8b24ef8ce01cd25a92887ae6f88e711cfaf19dc1866201c';
export const CAPTURE_TRIALS = 3;
const script = fileURLToPath(import.meta.url);
const foreign = Object.freeze({ ownerId: 'page-measure-capture', scope: 'personal', projectId: null });
const content = 'Synthetic foreign capture for read snapshot contention.';
const captureInput = () => ({ namespace: foreign, client: 'page-measure', sessionId: 'contention',
  eventId: 'foreign-capture', messages: [{ id: 'source-0', role: 'user', content }] });
const stamp = () => process.hrtime.bigint().toString();
const ms = (end, start) => Number(BigInt(end) - BigInt(start)) / 1e6;
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
let DatabaseSync, openMemoryCore, createMemoryRuntime;
async function loadNative() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  assert.ok(major > 22 || major === 22 && minor >= 16, 'measurement_requires_node_22_16');
  ({ DatabaseSync } = await import('node:sqlite'));
  ({ openMemoryCore } = await import('../../core/contract.mjs'));
  ({ createMemoryRuntime } = await import('../../core/runtime.mjs'));
}

// Reuse H5's close-based supervision, environment, raw exits and watchdog. Only
// the executable module changes, so no old campaign code or outcome is edited.
export class ChildSupervisor extends FrozenSupervisor {
  constructor({ launch = spawn, ...options } = {}) {
    super({ ...options, launch(executable, args, childOptions) {
      return launch(executable, [script, ...args.slice(1)], childOptions);
    } });
  }
}

export function captureGate(query, writer) {
  if (writer.ok !== true || writer.complete !== true || writer.writerError || writer.captureTimeoutMs !== 5000
    || writer.admittedCount !== 1 || writer.classification !== 'applied' || writer.disposition !== 'completed'
    || writer.initialClassification !== 'applied')
    return { ...writer, status: 'fail', reason: 'capture_failed' };
  const keys = [query.queryStart, query.firstPhysicalRead, query.queryEnd, writer.captureStart, writer.captureEnd];
  if (keys.some(value => typeof value !== 'string' || !/^\d+$/.test(value)))
    return { ...writer, status: 'inconclusive', reason: 'missing_overlap_timestamps' };
  const [start, page, end, attempt, committed] = keys.map(BigInt);
  const overlap = start <= page && page <= attempt && attempt < end && attempt <= committed;
  const waitMs = ms(writer.captureEnd, writer.captureStart);
  if (!overlap || end < start || committed >= end)
    return { ...writer, waitMs, overlap, status: 'inconclusive', reason: 'capture_not_completed_during_query' };
  return { ...writer, waitMs, overlap, status: waitMs < 2500 ? 'pass' : 'inconclusive',
    reason: waitMs < 2500 ? 'complete_capture_during_query' : 'threshold_crossing' };
}

export function assertClosedSeed(path) {
  for (const suffix of ['-wal', '-shm', '-journal'])
    assert.equal(existsSync(`${path}${suffix}`), false, 'seed_has_sidecar_dependency');
}

// Called only after both children close, outside the timed interval. Compare all
// baseline rows, not merely authorized counts. Only the five expected capture
// rows may be added; every other table must remain identical. Failed legacy
// captures can leave a partial foreign-only disposition, which is still a
// failed observation and never satisfies the complete-capture assertions.
export async function auditCaptureCopy(path, baseline, writer) {
  await loadNative();
  const db = new DatabaseSync(path);
  try {
    db.prepare('ATTACH DATABASE ? AS seed').run(baseline);
    const tables = db.prepare("SELECT name,sql FROM main.sqlite_schema WHERE type='table' ORDER BY name").all();
    assert.deepEqual(tables, db.prepare("SELECT name,sql FROM seed.sqlite_schema WHERE type='table' ORDER BY name").all(), 'contention_schema_changed');
    const expected = new Map([['memories', 1], ['receipts', 1], ['namespace_epochs', 1],
      ['admission_claims', 1], ['capture_initial_classification', 1]]);
    const additions = {};
    for (const { name } of tables) {
      assert.match(name, /^[a-z_]+$/);
      const removed = db.prepare(`SELECT count(*) AS n FROM (SELECT * FROM seed.${name} EXCEPT SELECT * FROM main.${name})`).get().n;
      assert.equal(removed, 0, `baseline_rows_changed:${name}`);
      const extra = db.prepare(`SELECT * FROM main.${name} EXCEPT SELECT * FROM seed.${name}`).all();
      if (writer.complete === true) assert.equal(extra.length, expected.get(name) ?? 0, `unexpected_capture_additions:${name}`);
      else assert.ok(extra.length <= (expected.get(name) ?? 0), `unexpected_capture_additions:${name}`);
      additions[name] = extra.length;
      for (const row of extra) {
        if (name === 'receipts') {
          if (writer.complete === true) assert.equal(row.memory_id, writer.memoryId, 'foreign_receipt_binding');
          assert.equal(db.prepare('SELECT owner_id FROM memories WHERE id=?').get(row.memory_id)?.owner_id,
            foreign.ownerId, 'nonforeign_receipt_addition');
        }
        else assert.equal(row.owner_id, foreign.ownerId, 'nonforeign_capture_addition');
      }
    }
    if (writer.complete !== true) return { captureComplete: false, baselineRowsUnchanged: true, additions,
      durableMemories: additions.memories, durableReceipts: additions.receipts };
    const memory = db.prepare('SELECT * FROM memories WHERE id=?').get(writer.memoryId);
    assert.equal(memory?.content, content, 'cold_memory_missing');
    assert.equal(memory.owner_id, foreign.ownerId); assert.equal(memory.scope, foreign.scope); assert.equal(memory.project_id, '');
    assert.equal(memory.deleted, 0); assert.equal(memory.currentness, 'current');
    const receipts = db.prepare('SELECT * FROM receipts WHERE memory_id=?').all(writer.memoryId);
    assert.equal(receipts.length, 1, 'cold_receipt_missing');
    assert.equal(receipts[0].excerpt, content); assert.equal(receipts[0].event_id, 'source-0');
    const source = { client: 'page-measure', sessionId: 'contention', eventId: 'source-0', role: 'user', excerpt: content };
    assert.equal(receipts[0].client, source.client); assert.equal(receipts[0].session_id, source.sessionId);
    assert.equal(receipts[0].role, source.role);
    assert.equal(receipts[0].receipt_key, createHash('sha256').update(JSON.stringify(source)).digest('hex'));
    const claim = db.prepare('SELECT * FROM admission_claims WHERE owner_id=?').get(foreign.ownerId);
    assert.equal(claim?.state, 'completed', 'cold_admission_incomplete');
    assert.equal(claim.client, 'page-measure'); assert.equal(claim.event_id, 'foreign-capture');
    assert.deepEqual(JSON.parse(claim.memory_ids), [writer.memoryId]); assert.equal(claim.suppressed_count, 0);
    const classification = db.prepare('SELECT * FROM capture_initial_classification WHERE owner_id=?').get(foreign.ownerId);
    assert.equal(classification?.status, 'applied', 'cold_classification_incomplete');
    assert.equal(classification.attempt_token, null);
    const refs = [{ memoryId: memory.id, revision: memory.revision }];
    for (const key of ['bound_refs', 'selected_refs', 'final_refs']) assert.deepEqual(JSON.parse(classification[key]), refs);
    return { durableMemories: 1, durableReceipts: 1, disposition: claim.state,
      initialClassification: classification.status, baselineRowsUnchanged: true, additions };
  } finally { db.close(); }
}

export async function measureContention(supervisor, path, cell, arm) {
  const query = supervisor.start({ role: 'query', path, cell, arm, handshake: true });
  try {
    await query.wait('ready');
    const writer = supervisor.start({ role: 'capture', path });
    await writer.wait('ready');
    query.send({ type: 'go' });
    await query.wait('physical-page');
    writer.send({ type: 'go' });
    const measured = assertChild(await query.done);
    const captured = assertChild(await writer.done);
    return { query: measured, writer: captured, ...captureGate(measured, captured) };
  } finally { await supervisor.stopAll(); }
}

export async function runCampaign({ cells = CELLS, contentionOnly = false,
  observe = value => process.stdout.write(`${JSON.stringify(value)}\n`),
  supervisor = new ChildSupervisor({ observe }), contention = measureContention, audit = auditCaptureCopy } = {}) {
  const workspace = createTestWorkspace(null, { prefix: 'cairn-source-ranking-page-resource-' });
  let interrupted = null;
  const handlers = new Map(['SIGINT', 'SIGTERM', 'SIGHUP'].map(signal => [signal, () => {
    interrupted = signal; void supervisor.stopAll();
  }]));
  for (const [signal, handler] of handlers) process.on(signal, handler);
  const summaries = [];
  let final;
  try {
    observe({ type: 'environment', campaign: 'H5b', synthetic: true, semanticAccuracy: 'not-measured',
      prefixSha256: PREFIX_SHA256, node: process.version, executable: process.execPath,
      hostname: hostname(), platform: platform(), release: release(), cpu: cpus()[0]?.model,
      logicalCpus: cpus().length, totalMemoryBytes: totalmem(), measuredAt: new Date().toISOString(),
      cells, repetitions: 3, captureTrials: CAPTURE_TRIALS, watchdogMs: WATCHDOG_MS,
      execution: 'sequential; operator must exclude unrelated heavy gates',
      legacy: 'labelled observations; original H5 remains failed' });
    for (const cell of cells) {
      const spec = cellSpec(cell);
      if (contentionOnly && spec.authorized !== 20_000) continue;
      assert.equal(interrupted, null, 'campaign_interrupted');
      const path = join(workspace.path, `${cell}.sqlite`);
      const prepared = assertChild(await supervisor.start({ role: 'prepare', path, cell }).done);
      assertClosedSeed(path);
      const unchanged = digest(path);
      observe({ type: 'prepared', cell, ...prepared, databaseSha256: unchanged });
      const observations = [];
      if (!contentionOnly) for (let pair = 0; pair < 3; pair += 1) {
        for (const arm of pair % 2 === 0 ? ['old', 'new'] : ['new', 'old']) {
          assert.equal(interrupted, null, 'campaign_interrupted');
          observations.push({ ...assertChild(await supervisor.start({ role: 'query', path, cell, arm, pair }).done), pair });
          assert.equal(digest(path), unchanged, 'store_changed_between_arms'); assertClosedSeed(path);
        }
      }
      const resource = contentionOnly ? null : resourceGate(observations);
      const trials = [];
      if (resource?.status !== 'fail' && spec.authorized === 20_000) {
        for (const arm of ['new', 'old']) {
          for (let trial = 0; trial < (arm === 'new' ? CAPTURE_TRIALS : 1); trial += 1) {
            assert.equal(interrupted, null, 'campaign_interrupted'); assertClosedSeed(path);
            const copy = join(workspace.path, `${cell}-${arm}-${trial}.sqlite`);
            copyFileSync(path, copy);
            assert.equal(digest(copy), unchanged, 'contention_copy_not_identical');
            const result = await contention(supervisor, copy, cell, arm);
            const durable = await audit(copy, path, result.writer);
            const record = { type: 'capture-contention', cell, arm, trial,
              role: arm === 'new' ? 'candidate-gate' : 'legacy-observation', ...result, durable };
            trials.push(record); observe(record);
            assert.equal(digest(path), unchanged, 'seed_changed_during_contention'); assertClosedSeed(path);
          }
        }
      }
      const candidate = trials.filter(row => row.arm === 'new');
      const status = resource?.status === 'fail' || candidate.some(row => row.status === 'fail') ? 'fail'
        : candidate.some(row => row.status !== 'pass') ? 'inconclusive' : 'pass';
      const summary = { type: 'cell-gate', cell, resource, contention: trials, status,
        legacyAffectsCandidateDecision: false };
      summaries.push(summary); observe(summary);
      if (status !== 'pass') break;
    }
    const required = cells.filter(cell => !contentionOnly || cellSpec(cell).authorized === 20_000).length;
    final = { type: 'promotion', campaign: 'H5b', status: required > 0 && summaries.length === required
      && summaries.every(row => row.status === 'pass') ? 'pass' : 'stop', summaries, interrupted };
    return final;
  } catch (error) {
    observe({ type: 'promotion', campaign: 'H5b', status: 'stop', reason: error.message, interrupted }); throw error;
  } finally {
    try {
      // Never remove a store while child closure is unverified. A failed
      // supervision teardown fails the campaign and retains its owned scratch.
      await supervisor.stopAll(); await workspace.cleanup();
      if (final) observe(final);
    } catch (error) {
      observe({ type: 'promotion', campaign: 'H5b', status: 'stop', reason: 'owned_cleanup_failed', interrupted }); throw error;
    } finally { for (const [signal, handler] of handlers) process.removeListener(signal, handler); }
  }
}

const send = message => new Promise((resolveSend, reject) => process.send(message, error => error ? reject(error) : resolveSend()));
const receive = type => new Promise(resolveReceive => {
  const listener = message => { if (message.type === type) { process.off('message', listener); resolveReceive(message); } };
  process.on('message', listener);
});

// Process-local observation only: no artificial wait and no production hook.
export function observePhysicalPage(Database, observed) {
  const original = Database.prototype.prepare;
  let seen = false;
  Database.prototype.prepare = function (sql, ...args) {
    const statement = original.call(this, sql, ...args);
    if (/^SELECT\s+id\s*,\s*revision\s+FROM memories\s+INDEXED BY capture_current_memories/i.test(sql.trim())) {
      const all = statement.all;
      statement.all = function (...parameters) {
        const rows = all.apply(this, parameters);
        if (!seen && rows.length) { seen = true; observed(stamp()); }
        return rows;
      };
    }
    return statement;
  };
  return () => { Database.prototype.prepare = original; };
}

async function captureChild(path) {
  const model = { contextWindow: 8192, countTokens: () => 1,
    extract: () => ({ items: [{ content, kind: 'fact', confidence: 0.8, sourceIndices: [0] }] }),
    classify: ({ input }) => ({ items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) }) };
  // Observe the real core connection during initialization, then inspect its
  // configured timeout. This does not replace or raise the SQLite busy timeout.
  const prepare = DatabaseSync.prototype.prepare;
  let connection;
  let core;
  try {
    DatabaseSync.prototype.prepare = function (...args) { connection = this; return prepare.apply(this, args); };
    core = openMemoryCore({ path, model });
  } finally { DatabaseSync.prototype.prepare = prepare; }
  try {
    const captureTimeoutMs = connection.prepare('PRAGMA busy_timeout').get().timeout;
    assert.equal(captureTimeoutMs, 5000, 'capture_timeout_changed');
    const go = receive('go'); await send({ type: 'ready' }); await go;
    const captureStart = stamp();
    const result = await core.capture(captureInput());
    const captureEnd = stamp();
    // Inspection is outside the recorded capture interval.
    const disposition = core.inspectAdmission({ namespace: foreign, client: 'page-measure',
      eventId: 'foreign-capture', includeInitialClassification: true });
    const admitted = result.ok && result.value.admission?.memories;
    const complete = result.ok === true && result.value.duplicate === false && admitted?.length === 1
      && result.value.admission.suppressedCount === 0 && result.value.classification?.status === 'applied'
      && disposition.ok === true && disposition.value.status === 'completed'
      && disposition.value.suppressedCount === 0 && disposition.value.members.length === 1
      && disposition.value.members[0].status === 'current'
      && disposition.value.members[0].memoryId === admitted[0].id
      && disposition.value.initialClassification?.status === 'applied';
    return { ok: result.ok, complete: Boolean(complete), captureStart, captureEnd, captureTimeoutMs,
      memoryId: admitted?.[0]?.id, admittedCount: admitted?.length ?? 0,
      classification: result.ok ? result.value.classification?.status : null,
      disposition: disposition.ok ? disposition.value.status : null,
      writerError: result.ok ? complete ? null : 'incomplete_capture' : result.error.code,
      // Numeric/status-only diagnostics: no source text, query or receipts.
      initialClassification: disposition.ok ? disposition.value.initialClassification?.status : null };
  } finally { core.close(); }
}

async function queryChild(input) {
  const runtime = createMemoryRuntime({ path: input.path });
  const db = new DatabaseSync(input.path);
  let restore = () => {};
  try {
    const spec = cellSpec(input.cell);
    const counts = db.prepare('SELECT (SELECT count(*) FROM memories) AS memories,(SELECT count(*) FROM receipts) AS receipts').get();
    assert.equal(counts.memories, spec.authorized + spec.foreign + 2);
    assert.equal(counts.receipts, spec.authorized * spec.receiptsPerRow + spec.foreign + 2);
    const queryPlan = db.prepare(`EXPLAIN QUERY PLAN SELECT id,revision FROM memories INDEXED BY capture_current_memories
      WHERE owner_id=? AND scope=? AND project_id=? AND deleted=0 AND review_state!='awaiting'
      AND currentness='current' AND id>? ORDER BY id LIMIT ?`).all('keyset-measure', 'personal', '', '', 256).map(row => row.detail);
    assert.ok(queryPlan.some(row => row.includes('SEARCH memories USING INDEX capture_current_memories')));
    assert.ok(queryPlan.every(row => !row.includes('TEMP B-TREE')));
    let firstPhysicalRead;
    if (input.handshake) {
      restore = observePhysicalPage(DatabaseSync, time => {
        firstPhysicalRead = time;
        process.send({ type: 'physical-page', at: time });
      });
      const go = receive('go'); await send({ type: 'ready' }); await go;
    }
    const result = queryMeasurement(runtime, spec, input.arm);
    if (input.handshake) assert.ok(firstPhysicalRead, 'first_physical_read_not_observed');
    const fileBytes = suffix => existsSync(`${input.path}${suffix}`) ? statSync(`${input.path}${suffix}`).size : 0;
    return { ...result, ...counts, queryPlan, ...(firstPhysicalRead ? { firstPhysicalRead } : {}),
      databaseMainBytes: fileBytes(''), databaseWalBytes: fileBytes('-wal'), databaseShmBytes: fileBytes('-shm'),
      peakIncludes: 'fresh process startup and core open', sqlitePostingWork: 'not-measured' };
  } finally { restore(); db.close(); runtime.close(); }
}

if (resolve(process.argv[1] ?? '') === script) {
  try {
    if (process.argv[2] === '--child') {
      const input = JSON.parse(process.argv[3]); await loadNative();
      assert.ok(['prepare', 'query', 'capture'].includes(input.role), 'invalid_child_role');
      const value = input.role === 'prepare' ? await prepareStore(input.path, input.cell)
        : input.role === 'capture' ? await captureChild(input.path) : await queryChild(input);
      await send({ type: 'result', value }); process.disconnect();
    } else {
      const result = await runCampaign(parseOptions(process.argv.slice(2)));
      if (result.status !== 'pass') process.exitCode = 1;
    }
  } catch (error) {
    const failure = { type: 'failure', code: error.code ?? error.name, reason: error.message.split('\n')[0] };
    if (process.send) { await send(failure); process.disconnect(); }
    else process.stderr.write(`${JSON.stringify(failure)}\n`);
    process.exitCode = 1;
  }
}
