import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';

// Scripted semantic decisions test orchestration and source authority, not model quality.
const namespace = { ownerId: 'ordered-synthetic', scope: 'personal', projectId: null };
const friday = 'Project Alpha deadline is Friday.';
const monday = 'Project Alpha deadline is Monday.';
const source = (id, content, role = 'user') => ({ id, content, role });
const capture = (sequence, content = monday, patch = {}) => ({ namespace, client: 'synthetic',
  sessionId: 'session', eventId: `event-${sequence}`, causal: { streamId: 'source-stream', sequence },
  messages: [source(`message-${sequence}`, content)], ...patch });
const item = (content, sourceIndices = [0]) => ({ content, kind: 'fact', confidence: 0.8, sourceIndices });
const transition = (patch = {}) => ({ replacementIndex: 0, predecessorIndex: 0, evidenceIndices: [0], ...patch });
const noChange = { status: 'complete_no_change', reason: null, retiredCount: 0 };
const applied = { status: 'applied', reason: null, retiredCount: 1 };
const unresolved = (reason) => ({ status: 'unresolved', reason, retiredCount: 0 });
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
const error = (r, code) => assert.deepEqual(r, { ok: false, error: { code, retryable: false } });
const detail = (core, id, ns = namespace) => ok(core.get({ namespace: ns, memoryId: id }));
const list = (core, ns = namespace) => ok(core.list({ namespace: ns })).memories;
const receipt = (eventId, excerpt = eventId) => ({ client: 'synthetic', sessionId: 'session', eventId, role: 'user', excerpt });
function fixture(t, options = {}) {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-ordered-')), 'memory.sqlite');
  const calls = [];
  const model = { contextWindow: 8192, countTokens: () => 1,
    extract: ({ input }) => ({ items: [item(input.messages[0].content)] }),
    reconcile: () => ({ transitions: [transition()] }), ...options };
  for (const method of ['extract', 'reconcile', 'classify']) {
    const fn = model[method];
    if (typeof fn === 'function') model[method] = async (request) => {
      calls.push({ method, input: structuredClone(request.input), system: request.system });
      return fn(request);
    };
  }
  const core = openMemoryCore({ path, model }); const db = new DatabaseSync(path);
  t.after(() => { core.close(); db.close(); });
  return { core, db, path, model, calls };
}
const material = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('admission_claims','capture_events') ORDER BY name").all()
  .map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]);
const first = async (core) => ok(await core.capture(capture(1, friday))).admission.memories[0].id;

test('O1/O4 ordered captures automatically retire Friday, bind real Monday evidence and preserve inferred authority', async (t) => {
  const { core, calls } = fixture(t, { classify: ({ input }) => ({ items: input.memories.map((m) => ({ memoryId: m.id,
    parentIds: [], newL1: { title: m.content, parentL2Ids: [] } })) }) });
  const previous = await first(core); const before = detail(core, previous);
  const result = ok(await core.capture(capture(2)));
  assert.deepEqual(result.reconciliation, applied); assert.equal(result.classification.status, 'applied');
  const replacement = result.admission.memories[0].id;
  const old = detail(core, previous); const current = detail(core, replacement);
  assert.equal(old.memory.state, 'historical'); assert.equal(current.memory.state, 'active');
  assert.equal(current.memory.origin, 'agent-inferred'); assert.equal(current.memory.confidence, 0.8);
  assert.deepEqual(old.receipts, before.receipts);
  assert.deepEqual(current.receipts.map(({ eventId, excerpt }) => ({ eventId, excerpt })), [{ eventId: 'message-2', excerpt: monday }]);
  assert.deepEqual(old.supersession.receiptIds, current.receipts.map((r) => r.id));
  assert.deepEqual(calls.map((c) => c.method), ['extract', 'classify', 'extract', 'reconcile', 'classify']);
  const request = calls.find((c) => c.method === 'reconcile');
  assert.deepEqual(request.input, { messages: [{ index: 0, role: 'user', content: monday }],
    items: [{ index: 0, content: monday, kind: 'fact', sourceIndices: [0] }],
    candidates: [{ index: 0, content: friday, kind: 'fact', receipts: [{ role: 'user', excerpt: friday }] }] });
  for (const hidden of [previous, replacement, namespace.ownerId, 'source-stream', 'message-1', 'message-2', 'event-2'])
    assert.ok(!JSON.stringify(request.input).includes(hidden));
});

test('O1/O2 cold completed replay precedes highwater and returns immutable content-free reconciliation', async (t) => {
  const { core, db, path } = fixture(t); const old = await first(core);
  const result = ok(await core.capture(capture(2))); const replacement = result.admission.memories[0].id;
  const before = material(db); core.close();
  const reopened = openMemoryCore({ path }); t.after(() => reopened.close());
  assert.deepEqual(ok(await reopened.capture(capture(1, friday))), { duplicate: true, memoryIds: [old], suppressedCount: 0, reconciliation: noChange });
  assert.deepEqual(ok(await reopened.capture(capture(2))), { duplicate: true, memoryIds: [replacement], suppressedCount: 0, reconciliation: applied });
  assert.deepEqual(material(db), before);
  ok(reopened.forget({ namespace, memoryId: replacement, expectedRevision: detail(reopened, replacement).memory.revision }));
  assert.deepEqual(ok(await reopened.capture(capture(2))), { duplicate: true, memoryIds: [replacement], suppressedCount: 0, reconciliation: applied });
  for (const table of ['capture_streams', 'capture_events', 'receipt_causality']) {
    const stored = JSON.stringify(db.prepare(`SELECT * FROM ${table}`).all());
    assert.ok(!stored.includes(friday)); assert.ok(!stored.includes(monday));
  }
});

test('O1 causal validation, digest binding and sequence conflicts reject before model calls or partial claims', async (t) => {
  const { core, db, calls } = fixture(t);
  for (const causal of [null, {}, { streamId: ' stream', sequence: 1 }, { streamId: 's', sequence: 0 },
    { streamId: 's', sequence: 1.5 }, { streamId: 's', sequence: Number.MAX_SAFE_INTEGER + 1 },
    { streamId: 's', sequence: 1, fabricated: true }]) error(await core.capture(capture(1, friday, { causal })), 'invalid_input');
  assert.equal(calls.length, 0); assert.equal(db.prepare('SELECT count(*) n FROM admission_claims').get().n, 0);
  await first(core); const beforeCalls = calls.length; const beforeClaims = db.prepare('SELECT * FROM admission_claims').all();
  for (const patch of [{ messages: [source('message-1', 'Changed payload')] },
    { causal: { streamId: 'other-stream', sequence: 1 } }, { causal: { streamId: 'source-stream', sequence: 2 } }]) {
    error(await core.capture(capture(1, friday, patch)), 'event_payload_conflict');
  }
  error(await core.capture(capture(1, friday, { eventId: 'other-event' })), 'capture_order_conflict');
  assert.equal(calls.length, beforeCalls); assert.deepEqual(db.prepare('SELECT * FROM admission_claims').all(), beforeClaims);
});

test('O2 empty extraction advances highwater and unseen older windows reject without extraction', async (t) => {
  const { core, db, calls } = fixture(t, { extract: () => ({ items: [] }) });
  const result = ok(await core.capture(capture(10))); assert.deepEqual(result.reconciliation, noChange);
  assert.deepEqual(result.admission.memories, []);
  const before = material(db);
  error(await core.capture(capture(9)), 'capture_order_conflict');
  assert.equal(calls.length, 1); assert.deepEqual(material(db), before);
  assert.deepEqual(ok(await core.capture(capture(10))), { duplicate: true, memoryIds: [], suppressedCount: 0, reconciliation: noChange });
});

for (const text of ['Could Alpha move to Monday?', 'Alpha might move to Monday; undecided.', 'Project Beta deadline is Monday.'])
  test(`O4 scripted no-transition decision preserves Friday: ${text}`, async (t) => {
    const { core } = fixture(t, { reconcile: () => ({ transitions: [] }) });
    const old = await first(core); const before = detail(core, old);
    const result = ok(await core.capture(capture(2, text)));
    assert.deepEqual(result.reconciliation, noChange); assert.deepEqual(detail(core, old), before);
    assert.equal(list(core).filter((m) => m.state === 'active').length, 2);
  });

test('O4 malformed, forged, duplicate and unbound evidence indices reject the whole judgment atomically', async (t) => {
  const invalid = [null, {}, { transitions: [], extra: true }, { transitions: Array(1) },
    { transitions: [transition(), transition()] }, { transitions: Array(6).fill(transition()) },
    ...[{ replacementIndex: -1 }, { replacementIndex: 1 }, { predecessorIndex: 1 }, { predecessorIndex: 0.5 },
      { predecessorIndex: '0' }, { evidenceIndices: [] }, { evidenceIndices: [0, 0] }, { evidenceIndices: [1] },
      { evidenceIndices: Array(1) }, { evidenceIndices: [null] }, { memoryId: 'forged' },
      { namespace: 'forged' }, { receipts: [receipt('forged')] }, { operation: 'supersede' }]
      .map((patch) => ({ transitions: [transition(patch)] }))];
  for (const output of invalid) {
    const { core, db } = fixture(t, { reconcile: () => output }); await first(core);
    const before = material(db);
    error(await core.capture(capture(2)), 'invalid_model_output'); assert.deepEqual(material(db), before);
    assert.equal(db.prepare("SELECT count(*) n FROM admission_claims WHERE event_id='event-2' AND state='completed'").get().n, 0);
  }
});

test('O4 evidence must be extraction-source subset and contain a current user source', async (t) => {
  for (const mode of ['subset', 'assistant']) {
    const { core, db, model } = fixture(t); await first(core);
    const before = material(db);
    model.extract = () => ({ items: [item(monday, mode === 'subset' ? [0] : [1])] });
    model.reconcile = () => ({ transitions: [transition({ evidenceIndices: [1] })] });
    error(await core.capture(capture(2, monday, { messages: [source('user', monday), source('assistant', 'Monday is certain.', 'assistant')] })), 'invalid_model_output');
    assert.deepEqual(material(db), before);
  }
});

test('O2 ordered receipt causality never launders unordered or another-stream evidence', async (t) => {
  for (const mode of ['unordered', 'other-stream', 'same-stream-reuse', 'explicit', 'mixed']) {
    const { core, db, calls, model } = fixture(t);
    const original = capture(1, friday);
    if (mode === 'unordered') delete original.causal;
    if (mode === 'other-stream') original.causal.streamId = 'other-stream';
    const old = ok(await core.capture(original)).admission.memories[0].id;
    const originalCausality = db.prepare('SELECT * FROM receipt_causality ORDER BY receipt_id').all();
    if (mode === 'explicit') ok(core.correct({ namespace, memoryId: old, expectedRevision: detail(core, old).memory.revision,
      content: friday, kind: 'fact', receipt: receipt('explicit-source', friday) }));
    if (mode === 'mixed') {
      const key = { namespace, client: 'synthetic', eventId: 'unordered-extra', payloadDigest: 'a'.repeat(64) };
      const { token } = ok(core.claimAdmission({ ...key, leaseMs: 125000 }));
      ok(core.finishAdmission({ ...key, token, items: [{ content: friday, kind: 'fact', confidence: 0.8,
        receipts: [receipt('unordered-source', friday)] }] }));
      assert.equal(detail(core, old).memory.origin, 'agent-inferred');
    }
    if (['unordered', 'other-stream', 'same-stream-reuse'].includes(mode)) {
      ok(await core.capture(capture(2, friday, { messages: original.messages })));
      assert.deepEqual(db.prepare('SELECT * FROM receipt_causality ORDER BY receipt_id').all(), originalCausality);
    }
    const result = ok(await core.capture(capture(3)));
    assert.deepEqual(result.reconciliation, mode === 'same-stream-reuse' ? applied : unresolved('unordered_sources'));
    assert.equal(detail(core, old).memory.state, mode === 'same-stream-reuse' ? 'historical' : 'active');
    assert.equal(calls.filter((c) => c.method === 'reconcile').length, mode === 'same-stream-reuse' ? 1 : 0);
    assert.equal(typeof model.extract, 'function');
  }
});

test('O3 namespace and stream scopes are exact; foreign memories are never candidates', async (t) => {
  for (const foreign of [{ ...namespace, ownerId: 'other-owner' }, { ...namespace, scope: 'project', projectId: 'other-project' }]) {
    const { core, calls } = fixture(t);
    const old = ok(await core.capture(capture(1, friday, { namespace: foreign }))).admission.memories[0].id;
    const result = ok(await core.capture(capture(1)));
    assert.deepEqual(result.reconciliation, noChange);
    assert.equal(detail(core, old, foreign).memory.state, 'active');
    assert.equal(calls.filter((c) => c.method === 'reconcile').length, 0);
  }
});

test('O1 client scopes share neither ordering positions nor comparable causal sources', async (t) => {
  const { core, calls } = fixture(t);
  const old = ok(await core.capture(capture(1, friday, { client: 'other-client' }))).admission.memories[0].id;
  const result = ok(await core.capture(capture(1)));
  assert.deepEqual(result.reconciliation, unresolved('unordered_sources'));
  assert.equal(detail(core, old).memory.state, 'active');
  assert.equal(calls.filter((c) => c.method === 'reconcile').length, 0);
});

test('O3 candidate and receipt ceilings produce terminal unresolved statuses without judgment', async (t) => {
  for (const mode of ['candidate_limit', 'unordered_sources']) {
    const { core, calls, model } = fixture(t, { reconcile: () => ({ transitions: [] }) });
    if (mode === 'candidate_limit') {
      for (let seq = 1; seq <= 13; seq++) ok(await core.capture(capture(seq, `Independent synthetic fact ${seq}`)));
    } else {
      for (let seq = 1; seq <= 5; seq++) ok(await core.capture(capture(seq, friday)));
    }
    const beforeCalls = calls.filter((c) => c.method === 'reconcile').length;
    const result = ok(await core.capture(capture(20)));
    assert.deepEqual(result.reconciliation, unresolved(mode));
    assert.equal(calls.filter((c) => c.method === 'reconcile').length, beforeCalls);
    delete model.extract; delete model.reconcile;
    assert.deepEqual(ok(await core.capture(capture(20))).reconciliation, unresolved(mode));
    assert.ok(list(core).every((m) => m.state === 'active'));
  }
});

test('O3 accepted twelve-candidate boundary uses deterministic ID order and complete four-receipt snapshots', async (t) => {
  const { core, calls } = fixture(t, { reconcile: () => ({ transitions: [] }),
    extract: ({ input }) => ({ items: [item(input.messages[0].content, input.messages.map((m) => m.index))] }) });
  for (let seq = 1; seq <= 12; seq++) ok(await core.capture(capture(seq, `Candidate ${seq}`, {
    messages: [0, 1, 2, 3].map((i) => source(`${seq}-${i}`, `Candidate ${seq} source ${i}`)) })));
  const expected = list(core).sort((a, b) => a.id.localeCompare(b.id)).map((m) => detail(core, m.id).memory.content);
  const result = ok(await core.capture(capture(13)));
  assert.deepEqual(result.reconciliation, noChange);
  const request = calls.filter((c) => c.method === 'reconcile').at(-1).input;
  assert.equal(request.candidates.length, 12); assert.deepEqual(request.candidates.map((c) => c.content), expected);
  assert.ok(request.candidates.every((c) => c.receipts.length === 4));
});

test('O4 context overflow admits unresolved while missing port, malformed output and provider errors commit nothing', async (t) => {
  const { core, db, model } = fixture(t); await first(core);
  const before = material(db);
  delete model.reconcile;
  error(await core.capture(capture(2)), 'model_not_configured'); assert.deepEqual(material(db), before);
  model.reconcile = () => { throw Object.assign(new Error('synthetic failure'), { name: 'AbortError' }); };
  error(await core.capture(capture(2)), 'model_cancelled'); assert.deepEqual(material(db), before);
  model.reconcile = () => ({ transitions: [] });
  model.countTokens = (text) => text.includes('"candidates"') ? 6001 : 1;
  const result = ok(await core.capture(capture(2)));
  assert.deepEqual(result.reconciliation, unresolved('context_budget'));
  assert.deepEqual(ok(await core.capture(capture(2))).reconciliation, unresolved('context_budget'));
});

test('O2 correction or forget during judgment fences all admission and retirement writes', async (t) => {
  for (const action of ['correct', 'forget']) {
    let entered; let release; const ready = new Promise((resolve) => { entered = resolve; });
    const { core, db, path } = fixture(t, { reconcile: () => new Promise((resolve) => { release = resolve; entered(); }) });
    const old = await first(core); const pending = core.capture(capture(2)); await ready;
    const other = openMemoryCore({ path }); t.after(() => other.close());
    const revision = detail(other, old).memory.revision;
    if (action === 'forget') ok(other.forget({ namespace, memoryId: old, expectedRevision: revision }));
    else ok(other.correct({ namespace, memoryId: old, expectedRevision: revision, content: 'Actually Wednesday', kind: 'fact', receipt: receipt('corrected') }));
    const afterMutation = material(db); release({ transitions: [transition()] });
    error(await pending, 'index_revision_conflict'); assert.deepEqual(material(db), afterMutation);
  }
});

test('O2 claim expiry and late highwater write failure cannot partially commit replacements', async (t) => {
  let entered; let release; const ready = new Promise((resolve) => { entered = resolve; });
  const { core, db, model } = fixture(t, { reconcile: () => new Promise((resolve) => { release = resolve; entered(); }) });
  await first(core); const before = material(db); const pending = core.capture(capture(2)); await ready;
  db.exec("UPDATE admission_claims SET lease_expires_at=0 WHERE event_id='event-2'");
  release({ transitions: [transition()] }); error(await pending, 'stale_admission'); assert.deepEqual(material(db), before);
  model.reconcile = () => ({ transitions: [transition()] });
  db.exec("CREATE TRIGGER synthetic_completion_failure BEFORE UPDATE OF high_water ON capture_streams BEGIN SELECT RAISE(ABORT,'late failure'); END");
  error(await core.capture(capture(2)), 'storage_error'); assert.deepEqual(material(db), before);
  db.exec('DROP TRIGGER synthetic_completion_failure'); assert.deepEqual(ok(await core.capture(capture(2))).reconciliation, applied);
});

test('O2 concurrent later completion invalidates a pending highwater snapshot without stale admission', async (t) => {
  let entered; let release; const ready = new Promise((resolve) => { entered = resolve; });
  const { core, db, path } = fixture(t, { reconcile: () => new Promise((resolve) => { release = resolve; entered(); }) });
  await first(core); const pending = core.capture(capture(2)); await ready;
  const other = openMemoryCore({ path, model: { contextWindow: 8192, countTokens: () => 1, extract: () => ({ items: [] }) } }); t.after(() => other.close());
  ok(await other.capture(capture(3))); const before = material(db);
  release({ transitions: [transition()] }); error(await pending, 'capture_order_conflict'); assert.deepEqual(material(db), before);
});

test('O4 reconciliation deadline cancels a stalled model and retains a retryable event binding', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let entered; let signal; const ready = new Promise((resolve) => { entered = resolve; });
  const { core, db, model } = fixture(t, { reconcile: (request) => { signal = request.signal; entered(); return new Promise(() => {}); } });
  await first(core); const before = material(db); const pending = core.capture(capture(2)); await ready;
  t.mock.timers.tick(29999); assert.equal(signal.aborted, false);
  t.mock.timers.tick(1); error(await pending, 'model_timeout'); assert.equal(signal.aborted, true);
  assert.deepEqual(material(db), before);
  model.reconcile = () => ({ transitions: [] });
  assert.deepEqual(ok(await core.capture(capture(2))).reconciliation, noChange);
});

test('O4 oversized serialized or counted output and provider failure do not admit new items', async (t) => {
  const { core, db, model } = fixture(t); await first(core); const before = material(db);
  model.reconcile = () => ({ transitions: [], junk: 'x'.repeat(40000) });
  error(await core.capture(capture(2)), 'invalid_model_output'); assert.deepEqual(material(db), before);
  model.reconcile = () => ({ transitions: [] });
  model.countTokens = (text) => text === '{"transitions":[]}' ? 1025 : 1;
  error(await core.capture(capture(2)), 'invalid_model_output'); assert.deepEqual(material(db), before);
  model.countTokens = () => 1;
  model.reconcile = () => { throw new Error('synthetic provider failure'); };
  error(await core.capture(capture(2)), 'reconciliation_failed'); assert.deepEqual(material(db), before);
});

test('O4 replacement aliases sharing one deduplicated successor reject all same-batch transitions', async (t) => {
  let extraction = 0;
  const { core, db } = fixture(t, {
    extract: () => ({ items: extraction++ ? [item(monday), item(monday)] : [item(friday), item('Project Beta deadline is Thursday.')] }),
    reconcile: () => ({ transitions: [transition(), transition({ replacementIndex: 1, predecessorIndex: 1 })] }),
  });
  await first(core); const before = material(db);
  error(await core.capture(capture(2)), 'invalid_ref'); assert.deepEqual(material(db), before);
});

test('O4 an explicit existing successor cannot be adopted to retire inferred history', async (t) => {
  const { core, db } = fixture(t); await first(core);
  ok(core.admit({ namespace, memory: { content: monday, kind: 'fact' }, receipts: [receipt('explicit-Monday', monday)] }));
  const before = material(db);
  error(await core.capture(capture(2)), 'invalid_ref'); assert.deepEqual(material(db), before);
});

test('O2 ordered snapshot defends against source binding corruption during judgment', async (t) => {
  let entered; let release; const ready = new Promise((resolve) => { entered = resolve; });
  const { core, db } = fixture(t, { reconcile: () => new Promise((resolve) => { release = resolve; entered(); }) });
  await first(core); const pending = core.capture(capture(2)); await ready;
  db.exec("UPDATE receipt_causality SET stream_id='other-stream'"); const before = material(db);
  release({ transitions: [transition()] });
  error(await pending, 'index_revision_conflict'); assert.deepEqual(material(db), before);
});

test('O4 reconcile and counters run outside SQLite writer transactions', async (t) => {
  const { core, db, model } = fixture(t); await first(core);
  const writable = () => { db.exec('BEGIN IMMEDIATE'); db.exec('ROLLBACK'); };
  model.countTokens = () => { writable(); return 1; };
  model.reconcile = ({ input }) => {
    writable(); input.candidates[0].content = 'Forged old body';
    input.messages[0].content = 'Forged replacement evidence';
    return { transitions: [transition()] };
  };
  const result = ok(await core.capture(capture(2)));
  assert.deepEqual(detail(core, result.admission.memories[0].id).receipts.map((r) => r.excerpt), [monday]);
});

test('O2 public manual completion cannot bypass ordered judgment or highwater fencing', async (t) => {
  let entered; let release; const ready = new Promise((resolve) => { entered = resolve; });
  const { core, db } = fixture(t, { reconcile: () => new Promise((resolve) => { release = resolve; entered(); }) });
  await first(core); const pending = core.capture(capture(2)); await ready;
  const owned = db.prepare("SELECT token,payload_digest FROM admission_claims WHERE event_id='event-2'").get();
  const before = material(db);
  error(core.finishAdmission({ namespace, client: 'synthetic', eventId: 'event-2', payloadDigest: owned.payload_digest, token: owned.token,
    items: [{ content: 'Bypass attempt', kind: 'fact', confidence: 0.8, receipts: [receipt('bypass')] }] }), 'stale_admission');
  assert.deepEqual(material(db), before);
  release({ transitions: [transition()] }); assert.deepEqual(ok(await pending).reconciliation, applied);
});

test('O2 an expired judgment owner cannot overwrite or abandon a completed successor attempt', async (t) => {
  let entered; let release; const ready = new Promise((resolve) => { entered = resolve; });
  const { core, db, path } = fixture(t, { reconcile: () => new Promise((resolve) => { release = resolve; entered(); }) });
  await first(core); const pending = core.capture(capture(2)); await ready;
  db.exec("UPDATE admission_claims SET lease_expires_at=0 WHERE event_id='event-2'");
  const other = openMemoryCore({ path, model: { contextWindow: 8192, countTokens: () => 1,
    extract: () => ({ items: [item(monday)] }), reconcile: () => ({ transitions: [transition()] }) } });
  t.after(() => other.close()); const committed = ok(await other.capture(capture(2))); assert.deepEqual(committed.reconciliation, applied);
  const before = material(db); release({ transitions: [transition()] }); error(await pending, 'stale_admission');
  assert.deepEqual(material(db), before);
  assert.deepEqual(ok(await core.capture(capture(2))).reconciliation, applied);
});

test('O4 five distinct predecessors can share one replacement item and bind only its selected evidence', async (t) => {
  let count = 0;
  const { core } = fixture(t, {
    extract: () => ({ items: count++ ? [item(monday, [0, 1])] : Array.from({ length: 5 }, (_, i) => item(`Old synthetic deadline ${i}`)) }),
    reconcile: () => ({ transitions: Array.from({ length: 5 }, (_, i) => transition({ predecessorIndex: i, evidenceIndices: [1] })) }),
  });
  const originals = ok(await core.capture(capture(1, friday))).admission.memories;
  const result = ok(await core.capture(capture(2, monday, { messages: [source('unselected', 'Context only.'), source('selected', monday)] })));
  assert.deepEqual(result.reconciliation, { status: 'applied', reason: null, retiredCount: 5 });
  const current = detail(core, result.admission.memories[0].id);
  const selected = current.receipts.find((r) => r.eventId === 'selected').id;
  for (const old of originals) {
    const history = detail(core, old.id); assert.equal(history.memory.state, 'historical');
    assert.deepEqual(history.supersession.receiptIds, [selected]);
    assert.equal(history.supersession.replacement.memoryId, current.memory.id);
  }
});

test('O4 a suppressed successor cannot leave a partial admission or retire its predecessor', async (t) => {
  const { core, db } = fixture(t); await first(core);
  const suppressed = ok(core.admit({ namespace, memory: { content: monday, kind: 'fact' }, receipts: [receipt('forgotten')] })).memory;
  ok(core.forget({ namespace, memoryId: suppressed.id, expectedRevision: suppressed.revision }));
  const before = material(db);
  error(await core.capture(capture(2)), 'memory_suppressed'); assert.deepEqual(material(db), before);
});

test('O2 real process race binds one stream position to one event', { timeout: 15000 }, async (t) => {
  const { core, path, db } = fixture(t);
  const program = `import {openMemoryCore} from ${JSON.stringify(new URL('../contract.mjs', import.meta.url).href)};
    const core=openMemoryCore({path:process.argv[1],model:{contextWindow:8192,countTokens:()=>1,extract:()=>({items:[]})}});
    process.send('ready');process.once('message',async()=>{process.send(await core.capture(JSON.parse(process.argv[2])));core.close();process.disconnect();});`;
  const workers = ['a', 'b'].map((eventId) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', program, path, JSON.stringify(capture(1, monday, { eventId }))],
      { env: { NODE_NO_WARNINGS: '1' }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }); t.after(() => child.kill());
    let isReady = false; let hasResult = false;
    const ready = new Promise((resolve, reject) => { child.on('message', (m) => { if (m === 'ready') { isReady = true; resolve(); } });
      child.once('error', reject); child.once('exit', (code) => { if (!isReady) reject(new Error(`worker exited before ready: ${code}`)); }); });
    const result = new Promise((resolve, reject) => { child.on('message', (m) => { if (m !== 'ready') { hasResult = true; resolve(m); } });
      child.once('error', reject); child.once('exit', (code) => { if (!hasResult) reject(new Error(`worker exited before result: ${code}`)); }); });
    result.catch(() => {}); return { child, ready, result };
  });
  await Promise.all(workers.map((w) => w.ready)); workers.forEach((w) => w.child.send('go'));
  const results = await Promise.all(workers.map((w) => w.result));
  assert.equal(results.filter((r) => r.ok).length, 1); error(results.find((r) => !r.ok), 'capture_order_conflict');
  assert.equal(db.prepare('SELECT count(*) n FROM admission_claims').get().n, 1);
  assert.equal(db.prepare('SELECT count(*) n FROM capture_events').get().n, 1); assert.deepEqual(list(core), []);
});
