import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { captureMessages } from '../capture.mjs';
import { isStorageBusy, readTransaction, transaction } from '../database.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';
import { attestContentSafety } from '../content-safety-schema.mjs';
import { MemoryStoreError } from '../validation.mjs';
import { safetyFixture, ns, ok, receipt } from '../testing/content-safety-s2h-fixture.mjs';
import { measureContentRead } from '../testing/content-safety-cost-meter.mjs';

const layouts = [18,23,33,34,38,48];
const baseOf = layout => ({34:18,38:23,48:33})[layout] ?? layout;
const methods = ['filterCaptureSources','assertCaptureSources'];
const evidence = receipt('source', 'Synthetic capture source.');
const input = { namespace: ns, client: evidence.client, sessionId: evidence.sessionId,
  eventId: 'capture', messages: [{ id: evidence.eventId, role: evidence.role, content: evidence.excerpt }] };
const failure = error => ({ ok: false, error: { code: error instanceof MemoryStoreError ? error.code
  : isStorageBusy(error) ? 'storage_busy' : 'storage_error',
  retryable: error.code === 'storage_busy' || isStorageBusy(error) } });

async function fixture(t, layout, journal = 'WAL') {
  const f = safetyFixture(t, baseOf(layout));
  if (layout !== baseOf(layout)) await f.migrate();
  const writer = f.connect();
  assert.equal(writer.prepare('PRAGMA journal_mode=' + journal).get().journal_mode, journal.toLowerCase());
  let coreDb;
  const prepare = DatabaseSync.prototype.prepare;
  // Observe the engine-owned connection; never open a raw database fd.
  const mock = t.mock.method(DatabaseSync.prototype, 'prepare', function(...args) {
    coreDb = this; return Reflect.apply(prepare, this, args);
  });
  const core = openMemoryCore({ path: f.path }); mock.mock.restore();
  coreDb.exec('PRAGMA busy_timeout=0');
  let runtimeDb;
  const runtime = createMemoryRuntime({ path: f.path }, { attachRaw(db) {
    runtimeDb = db; db.exec('PRAGMA busy_timeout=0');
  } });
  t.after(() => { runtime.close(); core.close(); writer.close(); });
  assert.equal(writer.prepare('PRAGMA user_version').get().user_version, layout);
  const unlocked = () => {
    assert.equal(writer.isTransaction, false, 'no writer transaction spans a host callback or await');
    assert.equal(runtimeDb.isTransaction, false, 'source snapshot ended before host dispatch');
    assert.equal(coreDb.isTransaction, false, 'admission transaction ended before host dispatch');
  };
  function locked(work, exclusive = false) {
    unlocked(); writer.exec(exclusive ? 'BEGIN EXCLUSIVE' : 'BEGIN IMMEDIATE');
    try { return work(); } finally { writer.exec('ROLLBACK'); unlocked(); }
  }
  // Hosted-style ordinary capture: same captureMessages and public admission
  // envelopes as contract.mjs. Only the two synchronous source boundaries are
  // wrapped so a canonical second-connection lock cannot span an await.
  function host({ stage, exclusive = false, finishBusy = false, denied = false, trace = [] } = {}) {
    unlocked(); trace.push('authority');
    if (denied) return Promise.resolve({ ok: false, error: { code: 'authority_required', retryable: false } });
    trace.push('capture');
    const source = method => sources => {
      trace.push(method);
      return method === stage ? locked(() => runtime[method](ns, sources), exclusive) : runtime[method](ns, sources);
    };
    return captureMessages({ input, model: { contextWindow: 8192,
      countTokens() { unlocked(); trace.push('counter'); return 1; },
      extract() { unlocked(); trace.push('extract'); return { items: [{ content: 'Synthetic captured fact.',
        kind: 'fact', confidence: 0.8, sourceIndices: [0] }] }; } },
      operations: {
        filterCaptureSources: source(methods[0]), assertCaptureSources: source(methods[1]),
        claimAdmission: value => core.claimAdmission({ ...value, leaseMs: 125000 }),
        finishAdmission: value => finishBusy ? locked(() => core.finishAdmission(value)) : core.finishAdmission(value),
        abandonAdmission: value => core.abandonAdmission(value),
        get: core.get, map: core.map, beginInitialClassification: core.beginInitialClassification,
        failInitialClassification: core.failInitialClassification,
      } }).then(value => ({ ok: true, value }), failure);
  }
  return { ...f, writer, runtime, runtimeDb, core, locked, unlocked, host,
    memories: () => writer.prepare('SELECT count(*) n FROM memories WHERE deleted=0').get().n };
}

// Regressions: every layout/journal/source-stage cell fails on S2h-2 with
// extraction_failed. The old engine and the fix succeed while a RESERVED
// writer exists, and replay admits exactly once.
for (const layout of layouts) for (const journal of ['WAL','DELETE']) for (const stage of methods)
test(`capture source writer contention v${layout} ${journal} ${stage}`, async t => {
  const f = await fixture(t, layout, journal), trace = [];
  const first = await f.host({ stage, trace });
  assert.equal(first.ok, true, 'source checks must read through a RESERVED writer: ' + JSON.stringify(first));
  assert.equal(trace.filter(value => value === stage).length > 0, true, 'capture reached the contested source boundary');
  assert.equal(ok(first).admission.memories.length, 1);
  const replay = ok(await f.host());
  assert.equal(replay.duplicate, true);
  assert.deepEqual(replay.memoryIds, [ok(first).admission.memories[0].id]);
  assert.equal(f.writer.prepare('SELECT count(*) n FROM receipts').get().n, 1);
  assert.equal(f.writer.prepare('SELECT count(*) n FROM admission_claims').get().n, 1);
  assert.equal(f.memories(), 1, 'released-lock retry admits exactly once'); f.unlocked();
});

// Regressions: a real EXCLUSIVE DELETE lock forces even a read-only source
// snapshot to hit SQLite busy. Catch it at the safety boundary, including the
// facade's delivery fence, before capture.mjs sees the exception.
for (const layout of [34,38,48]) for (const stage of methods)
test(`capture source read busy is retryable v${layout} ${stage}`, async t => {
  const f = await fixture(t, layout, 'DELETE');
  assert.deepEqual(await f.host({ stage, exclusive: true }),
    { ok: false, error: { code: 'storage_busy', retryable: true } }, 'source busy must never become extraction_failed');
  assert.equal(f.memories(), 0);
  assert.equal(ok(await f.host()).admission.memories.length, 1);
  assert.equal(ok(await f.host()).duplicate, true); assert.equal(f.memories(), 1);
});

// Regressions: pin the host retry shape against the old engine. The first
// attempt reaches the intended admission busy after source checks; a revoked
// host authority is checked before any retry work, then reauthorization admits.
for (const layout of [18,23,33]) for (const journal of ['WAL','DELETE'])
test(`capture source authority order on retry v${layout} ${journal}`, async t => {
  const f = await fixture(t, layout, journal), trace = [];
  assert.deepEqual(await f.host({ stage: 'filterCaptureSources', finishBusy: true, trace }),
    { ok: false, error: { code: 'storage_busy', retryable: true } });
  assert.equal(f.memories(), 0);
  const checkpoint = trace.length;
  assert.deepEqual(await f.host({ denied: true, trace }),
    { ok: false, error: { code: 'authority_required', retryable: false } });
  assert.deepEqual(trace.slice(checkpoint), ['authority'], 'authority rejection reached before retry capture');
  assert.equal(ok(await f.host({ trace })).admission.memories.length, 1);
  assert.equal(ok(await f.host({ trace })).duplicate, true); assert.equal(f.memories(), 1);
  assert.equal(trace.filter(value => value === 'authority').length, 4);
  assert.equal(trace.filter(value => value === 'capture').length, 3);
  const attempt = ['authority','capture','counter','counter','extract','counter'];
  assert.deepEqual(trace.filter(value => !methods.includes(value)),
    [...attempt,'authority',...attempt,'authority','capture','counter'],
    'exact retry host invocation order equals main 26f9e467');
  assert.equal(trace.filter(value => value === 'filterCaptureSources').length, 2);
  assert.equal(trace.filter(value => value === 'assertCaptureSources').length, 8);
  t.diagnostic('AUTHORITY_ORDER ' + JSON.stringify({ layout, journal, trace }));
});

// Separate exact pin, measured on main 26f9e467 with this file. Do not change
// the existing unmigrated inventory. Cold/warm/empty/missing/duplicate cells
// catch the historical available=false lookup semantics too.
for (const layout of [18,23,33]) for (const method of methods)
test(`capture source unmigrated cost main 26f9e467 v${layout} ${method}`, async t => {
  const f = await fixture(t, layout);
  const cells = [['cold',[evidence],layout === 33 ? 7 : 1],['warm',[evidence],layout === 33 ? 5 : 1],
    ['empty',[],layout === 33 ? 0 : 1],
    ['missing',[receipt('absent')],layout === 33 ? 5 : 1],
    ['duplicate',[evidence,evidence],layout === 33 ? 10 : 1]];
  const rows = [];
  for (const [variant, sources, statements] of cells) {
    const row = await measureContentRead(method, variant, () => f.runtime[method](ns, sources));
    rows.push({ variant, sources, statements, row });
    t.diagnostic('CAPTURE_SOURCE_COST ' + JSON.stringify({ layout,method,variant,
      counts:[row.statements,row.begin,row.hostInvocations],sql:row.sql }));
  }
  for (const { variant, sources, statements, row } of rows) {
    assert.deepEqual([row.statements,row.begin,row.hostInvocations,row.ports], [statements,0,0,0],
      'exact source cost equals main 26f9e467: ' + JSON.stringify({ method,layout,variant,sql:row.sql }));
    const units = sources.length;
    const expectedSql = layout === 33 ? [
      ...(variant === 'cold' ? [["SELECT 1 FROM sqlite_master WHERE name='raw_source_maps'",1],
        ["SELECT 1 FROM sqlite_master WHERE name='raw_deletion_actions'",1]] : []),
      ...(units ? [['SELECT secret FROM episode_identity WHERE singleton=1',2*units],
        ['SELECT 1 FROM raw_session_fences WHERE owner_id=? AND scope=? AND project_id=? AND client=? AND session_key=?',2*units],
        [`SELECT c.id,m.total_units,m.role FROM raw_conversations c JOIN raw_messages m ON m.conversation_id=c.id
      WHERE c.owner_id=? AND c.scope=? AND c.project_id=? AND c.client=? AND c.session_key IN (?,?) AND m.message_id=?`,units]] : []),
    ] : statements ? [["SELECT 1 FROM sqlite_master WHERE name='raw_source_maps'",statements]] : [];
    assert.deepEqual(row.sql, expectedSql, 'exact main SQL, including presence/absence cache semantics');
    assert.deepEqual(row.result, method === 'filterCaptureSources' ? sources.map((_,i) => i) : undefined);
  }
});

// Regressions: both methods execute every safety lookup in a query-only,
// attested snapshot, with a separate delivery attestation after COMMIT.
for (const layout of [34,38,48]) for (const method of methods)
test(`capture source safety snapshot v${layout} ${method}`, async t => {
  const f = await fixture(t, layout);
  const row = await measureContentRead(method, 'snapshot', () => f.runtime[method](ns, [evidence]));
  assert.equal(row.begin, 1); assert.equal(row.sql.filter(([sql]) => sql.trim() === 'BEGIN IMMEDIATE').length, 0);
  assert.equal(row.sql.filter(([sql]) => sql.trim() === 'PRAGMA query_only=ON').length, 1);
  assert.equal(row.trace.filter(entry => /schema_version AS cookie/.test(entry.sql) && entry.transaction).length > 0, true);
  assert.equal(row.trace.filter(entry => /schema_version AS cookie/.test(entry.sql) && !entry.transaction).length > 0, true);
  assert.equal(f.runtimeDb.prepare('PRAGMA query_only').get().query_only, 0); f.unlocked();
});

// Controls, not fail-before regressions: S2h-2 already rejects a retained
// receipt with a user-forget suppression fact. No suppressed index survives.
for (const layout of [34,38,48])
test(`control: capture source suppression v${layout}`, async t => {
  const f = await fixture(t, layout);
  const memory = ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic forgotten fact.', kind: 'fact' },
    receipts: [evidence] })).memory;
  const source = f.writer.prepare('SELECT id FROM receipts WHERE memory_id=?').get(memory.id);
  transaction(f.writer, () => writeContentSuppressionInside(f.writer, { namespace: ns, kind: 'receipt',
    key: source.id, reason: 'user_forget', actionId: 'synthetic-source-forget' }));
  assert.deepEqual(f.runtime.filterCaptureSources(ns, [evidence]), []);
  assert.throws(() => f.runtime.assertCaptureSources(ns, [evidence]), { code: 'source_excluded' });
  const result = await f.host(); assert.equal(result.ok, false); assert.equal(result.error.code, 'source_excluded');
  assert.equal(f.memories(), 1, 'the suppressed source cannot create another memory');
});

// Regressions: do not nest a read snapshot inside a transaction or active read.
for (const layout of [34,38,48]) for (const method of methods)
test(`capture source refuses nested snapshot v${layout} ${method}`, async t => {
  const f = await fixture(t, layout);
  f.runtimeDb.exec('BEGIN');
  try { assert.throws(() => f.runtime[method](ns, [evidence]), { code: 'storage_error' }); }
  finally { f.runtimeDb.exec('ROLLBACK'); }
  assert.throws(() => readTransaction(f.runtimeDb, () => f.runtime[method](ns, [evidence])), { code: 'storage_error' });
  f.unlocked();
});

// Controls: the public capture facade already succeeds without contention.
// Exercise its real suppression request context as well as the hosted harness.
for (const layout of layouts)
test(`control: public capture source context v${layout}`, async t => {
  const f = await fixture(t, layout);
  const core = openMemoryCore({ path: f.path, model: { contextWindow: 8192, countTokens: () => 1,
    extract: () => ({ items: [{ content: 'Synthetic captured fact.', kind: 'fact', confidence: 0.8, sourceIndices: [0] }] }) } });
  t.after(() => core.close());
  assert.equal(ok(await core.capture(input)).admission.memories.length, 1);
  assert.equal(ok(await core.capture(input)).duplicate, true); assert.equal(f.memories(), 1);
});

// Regressions: operational busy can occur during snapshot acquisition,
// canonical source lookup, COMMIT or the facade's delivery attestation. Count
// each injected native failure and require the original engine-owned framing.
for (const layout of [34,38,48]) for (const method of methods)
for (const phase of ['acquire','source','commit','restore','delivery']) for (const errcode of [5,6])
test(`capture source busy boundary v${layout} ${method} ${phase} sqlite${errcode}`, async t => {
  const f = await fixture(t, layout);
  const exec = DatabaseSync.prototype.exec, prepare = DatabaseSync.prototype.prepare;
  let injected = 0, committed = false;
  const busy = Object.assign(new Error('synthetic SQLite contention'), { code: 'ERR_SQLITE_ERROR', errcode });
  const hit = () => { injected++; throw busy; };
  const execMock = t.mock.method(DatabaseSync.prototype, 'exec', function(sql) {
    if (this === f.runtimeDb) {
      if (!injected && ((phase === 'acquire' && sql === 'BEGIN') ||
          (phase === 'commit' && sql === 'COMMIT') || (phase === 'restore' && sql === 'PRAGMA query_only=OFF'))) hit();
      const result = Reflect.apply(exec, this, [sql]);
      if (sql === 'COMMIT') committed = true;
      return result;
    }
    return Reflect.apply(exec, this, [sql]);
  });
  const prepareMock = t.mock.method(DatabaseSync.prototype, 'prepare', function(sql) {
    if (this === f.runtimeDb && !injected && ((phase === 'source' && sql.includes('SELECT r.*,m.revision AS memory_revision')) ||
        (phase === 'delivery' && committed && sql.includes('schema_version AS cookie')))) hit();
    return Reflect.apply(prepare, this, [sql]);
  });
  try {
    assert.throws(() => f.runtime[method](ns, [evidence]), error => error instanceof MemoryStoreError && error.code === 'storage_busy');
    assert.equal(injected, 1, 'one SQLite failure at the chosen source-check phase');
  } finally { execMock.mock.restore(); prepareMock.mock.restore(); }
  // readTransaction permanently discards a connection on failed cleanup.
  if (phase === 'restore') assert.equal(f.runtimeDb.isOpen, false);
  else {
    assert.equal(f.runtimeDb.isTransaction, false);
    assert.equal(f.runtimeDb.prepare('PRAGMA query_only').get().query_only, 0);
    assert.deepEqual(f.runtime[method](ns, [evidence]), method === 'filterCaptureSources' ? [0] : undefined);
  }
});

// Controls: unmigrated layouts preserve raw native busy errors rather than
// changing their exception contract. Removing the new writer acquisition is
// what fixes hosted captures on those layouts.
for (const layout of [18,23,33]) for (const method of methods)
test(`control: capture source unmigrated native error v${layout} ${method}`, async t => {
  const f = await fixture(t, layout, 'DELETE');
  assert.throws(() => f.locked(() => f.runtime[method](ns, [evidence]), true),
    error => !(error instanceof MemoryStoreError) && error.code === 'ERR_SQLITE_ERROR' && error.errcode === 5);
  assert.deepEqual(f.runtime[method](ns, [evidence]), method === 'filterCaptureSources' ? [0] : undefined);
  f.unlocked();
});

// Controls: S2h-2 already refuses a source forgotten by a provider callback.
for (const layout of [34,38,48])
test(`control: public capture refuses source forgotten in flight v${layout}`, async t => {
  const f = await fixture(t, layout);
  const memory = ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic source fact.', kind: 'fact' }, receipts: [evidence] })).memory;
  let calls = 0;
  const core = openMemoryCore({ path: f.path, model: { contextWindow: 8192, countTokens: () => 1,
    extract() {
      f.unlocked(); calls++;
      ok(f.core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
      return { items: [{ content: 'Synthetic captured fact.', kind: 'fact', confidence: 0.8, sourceIndices: [0] }] };
    } } });
  t.after(() => core.close());
  assert.deepEqual(await core.capture(input), { ok: false, error: { code: 'evidence_unavailable', retryable: false } });
  assert.equal(calls, 1); assert.equal(f.memories(), 0);
});

// Regressions: the read snapshot permits a concurrent suppression writer in
// WAL, but its old allowed view must never survive the delivery epoch fence.
for (const layout of [34,38,48]) for (const method of methods)
test(`capture source snapshot delivery fences concurrent forget v${layout} ${method}`, async t => {
  const f = await fixture(t, layout);
  const memory = ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic source fact.', kind: 'fact' }, receipts: [evidence] })).memory;
  const prepare = DatabaseSync.prototype.prepare; let writes = 0;
  const mock = t.mock.method(DatabaseSync.prototype, 'prepare', function(sql) {
    if (this === f.runtimeDb && !writes && sql.includes('SELECT r.*,m.revision AS memory_revision')) {
      writes++;
      assert.equal(this.isTransaction, true);
      ok(f.core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
    }
    return Reflect.apply(prepare, this, [sql]);
  });
  try { assert.throws(() => f.runtime[method](ns, [evidence]), { code: 'evidence_unavailable' }); }
  finally { mock.mock.restore(); }
  assert.equal(writes, 1); assert.equal(f.memories(), 0); f.unlocked();
});

// Controls: readTransaction's suppression-request acquisition already attests
// this DDL in round 1. Keep the original transaction refusal code and prove the
// failure happens after BEGIN, before source work, rather than only at delivery.
// Dropping this one guard follows the existing S2h attestation fixture pattern.
for (const layout of [34,38,48]) for (const method of methods)
test(`control: capture source installed safety refusal inside snapshot v${layout} ${method}`, async t => {
  const f = await fixture(t, layout);
  attestContentSafety(f.writer);
  f.writer.exec('DROP TRIGGER safety_memories_insert');
  let original;
  assert.throws(() => transaction(f.writer, () => assert.fail('unsafe writer reached work')),
    error => { original = error.code; return error instanceof MemoryStoreError && original === 'unsupported_database'; });
  const db = f.runtimeDb;
  const exec = db.exec.bind(db), prepare = db.prepare.bind(db);
  let began = 0, rolledBack = 0, snapshotMetadata = 0, sourceReads = 0, committed = 0;
  const execMock = t.mock.method(db, 'exec', sql => {
    const result = exec(sql);
    if (sql === 'BEGIN') began++;
    if (sql === 'ROLLBACK') rolledBack++;
    if (sql === 'COMMIT') committed++;
    return result;
  });
  const prepareMock = t.mock.method(db, 'prepare', sql => {
    if (db.isTransaction && sql.includes('schema_version AS cookie')) snapshotMetadata++;
    if (sql.includes('SELECT r.*,m.revision AS memory_revision')) sourceReads++;
    return prepare(sql);
  });
  try { assert.throws(() => f.runtime[method](ns, [evidence]), { code: original }); }
  finally { execMock.mock.restore(); prepareMock.mock.restore(); }
  assert.equal(began, 1);
  assert.equal(rolledBack, 1);
  assert.equal(committed, 0);
  assert.ok(snapshotMetadata > 0, 'installed-safety refusal inspected metadata inside the snapshot');
  assert.equal(sourceReads, 0, 'unsafe layout never reaches source work');
  assert.equal(db.isTransaction, false);
  assert.equal(db.prepare('PRAGMA query_only').get().query_only, 0);
});
