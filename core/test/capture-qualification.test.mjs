import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';

// Scripted judgments and real synthetic SQLite verify source contracts, not truth.
const namespace = { ownerId: 'automatic-qualification-test', scope: 'personal', projectId: null };
const content = 'I choose the violet tram 🚋.';
const input = (patch = {}) => ({ namespace, client: 'synthetic-client', sessionId: 'synthetic-session',
  eventId: 'capture-event', messages: [{ id: 'source-message', role: 'user', content }], ...patch });
const extracted = (patch = {}) => ({ content, kind: 'decision', confidence: 0.8, sourceIndices: [0], ...patch });
const qualification = (text = content, patch = {}) => ({ version: 1,
  slot: { subject: 'I', property: 'transport', scope: null, applies: null }, value: 'violet tram',
  attribution: 'direct', commitment: 'adopted', anchors: [{ receiptIndex: 0, start: 0,
    end: text.length, text, fields: ['subject', 'property', 'value', 'attribution', 'commitment'] }], ...patch });
const qualify = ({ input: request }) => ({ qualifications: request.items.map(({ itemIndex, sources }) =>
  ({ itemIndex, qualification: qualification(sources[0].excerpt.slice(0, 100)) })) });
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
const error = (r, code) => assert.deepEqual(r, { ok: false, error: { code, retryable: false } });
function fixture(t, overrides = {}, setting = 'source-bound-v1') {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-auto-qualification-')), 'memory.sqlite');
  const calls = [];
  const model = { contextWindow: 8192, countTokens: () => 1,
    extract: () => ({ items: [extracted()] }), qualify, ...overrides };
  for (const method of ['extract', 'qualify', 'classify', 'reconcile']) {
    const fn = model[method];
    if (typeof fn === 'function') model[method] = async (request) => {
      calls.push({ method, input: structuredClone(request.input), system: request.system,
        maxOutputTokens: request.maxOutputTokens, signal: request.signal });
      return fn(request);
    };
  }
  const options = { path, model, ...(setting === 'legacy' ? {} : { captureQualification: setting }) };
  const core = openMemoryCore(options); const db = new DatabaseSync(path); let closed = false;
  const close = () => { if (!closed) { core.close(); db.close(); closed = true; } };
  t.after(close);
  return { core, db, path, calls, model, options, close };
}
const material = (db) => ['memories', 'receipts', 'memory_qualifications', 'qualification_anchors',
  'qualified_slots', 'qualified_claim_bindings'].map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]);
const detail = (core, id) => ok(core.get({ namespace, memoryId: id, includeQualification: true }));

test('AQ1 constructor rejects explicit alternatives before database creation and snapshots enabled mode', async (t) => {
  for (const captureQualification of [undefined, null, false, true, '', 'legacy', {}, [], 1]) {
    const path = join(mkdtempSync(join(tmpdir(), 'cairn-auto-options-')), 'absent.sqlite');
    assert.throws(() => openMemoryCore({ path, captureQualification }), { code: 'invalid_input' });
    assert.equal(existsSync(path), false);
  }
  const f = fixture(t); f.options.captureQualification = 'changed-after-open';
  ok(await f.core.capture(input())); assert.equal(f.calls.filter((c) => c.method === 'qualify').length, 1);
});

test('AQ2 one bounded source-local batch persists qualification across complete cold reopen without trusted bindings', async (t) => {
  const f = fixture(t); const result = ok(await f.core.capture(input())); const id = result.admission.memories[0].id;
  assert.deepEqual(f.calls.map((c) => c.method), ['extract', 'qualify']);
  const request = f.calls[1];
  assert.deepEqual(request.input, { items: [{ itemIndex: 0, content, kind: 'decision',
    sources: [{ receiptIndex: 0, role: 'user', excerpt: content }] }] });
  assert.equal(request.maxOutputTokens, 1024); assert.ok(request.signal instanceof AbortSignal);
  for (const hidden of [namespace.ownerId, 'synthetic-client', 'synthetic-session', 'source-message', 'capture-event'])
    assert.ok(!JSON.stringify(request.input).includes(hidden));
  const saved = detail(f.core, id); assert.equal(saved.qualification.commitment, 'adopted');
  assert.equal(saved.qualification.anchors[0].text, content);
  assert.equal(Object.hasOwn(saved.qualification, 'singleClaim'), false);
  assert.equal(f.db.prepare('SELECT count(*) n FROM qualified_claim_bindings').get().n, 0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM qualified_slots').get().n, 0);
  f.close(); const cold = openMemoryCore({ path: f.path }); t.after(() => cold.close());
  assert.deepEqual(detail(cold, id), saved);
});

test('AQ3 [3,0] selection uses local positions and exact redacted NFKC multilingual astral receipts', async (t) => {
  const secret = 'sk-' + 'a'.repeat(48);
  const messages = [{ id: 'm0', role: 'user', content: '  Ａ 🚋 我選擇電車  ' },
    { id: 'm1', role: 'user', content: 'Excluded one' }, { id: 'm2', role: 'assistant', content: 'Excluded two' },
    { id: 'm3', role: 'assistant', content: `Token ${secret} is private.` }];
  const f = fixture(t, { extract: () => ({ items: [extracted({ sourceIndices: [3, 0] })] }),
    qualify: ({ input: request }) => {
      const sources = request.items[0].sources;
      assert.deepEqual(sources.map((s) => [s.receiptIndex, s.role]), [[0, 'assistant'], [1, 'user']]);
      assert.equal(sources[1].excerpt, 'A 🚋 我選擇電車');
      assert.ok(!JSON.stringify(request).includes(secret));
      return { qualifications: [{ itemIndex: 0, qualification: qualification('🚋', {
        anchors: [{ receiptIndex: 1, start: 2, end: 4, text: '🚋', fields: ['subject', 'property', 'value', 'attribution', 'commitment'] }] }) }] };
    } });
  const saved = detail(f.core, ok(await f.core.capture(input({ messages }))).admission.memories[0].id);
  assert.equal(saved.qualification.anchors[0].text, '🚋');
  assert.equal(saved.receipts.find((r) => r.id === saved.qualification.anchors[0].receiptId).eventId, 'm0');
});

test('AQ3 source evidence beyond canonical 800 units is absent and cannot anchor a claim', async (t) => {
  const f = fixture(t, { qualify: ({ input: request }) => {
    assert.equal(request.items[0].sources[0].excerpt.length, 799);
    assert.ok(!JSON.stringify(request).includes('HIDDEN_EVIDENCE'));
    return { qualifications: [{ itemIndex: 0, qualification: qualification('HIDDEN_EVIDENCE', {
      anchors: [{ receiptIndex: 0, start: 801, end: 816, text: 'HIDDEN_EVIDENCE', fields: ['subject', 'property', 'value', 'attribution', 'commitment'] }] }) }] };
  } });
  const before = material(f.db);
  error(await f.core.capture(input({ messages: [{ id: 'long', role: 'user', content: 'z'.repeat(799) + '🚋HIDDEN_EVIDENCE' }] })), 'invalid_model_output');
  assert.deepEqual(material(f.db), before);
});

test('AQ3 exact coverage and malformed later qualifications reject atomically without unqualified fallback', async (t) => {
  const valid = () => ({ itemIndex: 0, qualification: qualification() });
  const outputs = [null, {}, { qualifications: null }, { qualifications: [] },
    { qualifications: [valid()], extra: true }, { qualifications: [valid(), valid()] },
    { qualifications: [{ ...valid(), itemIndex: 1 }] }, { qualifications: [{ ...valid(), itemIndex: '0' }] },
    { qualifications: [{ ...valid(), qualification: null }] }, { qualifications: [{ ...valid(), extra: true }] },
    { qualifications: [{ ...valid(), qualification: { ...qualification(), singleClaim: true } }] },
    { qualifications: [{ ...valid(), qualification: { ...qualification(), slot: { ...qualification().slot, extra: true } } }] },
    { qualifications: [{ ...valid(), qualification: { ...qualification(), value: ' Ａ ' } }] }];
  for (const output of outputs) {
    const f = fixture(t, { qualify: () => output }); const before = material(f.db);
    error(await f.core.capture(input()), 'invalid_model_output'); assert.deepEqual(material(f.db), before);
  }
  const f = fixture(t, { extract: () => ({ items: [extracted(), extracted({ content: 'A second decision' })] }),
    qualify: () => ({ qualifications: [valid(), { itemIndex: 1, qualification: { ...qualification(), anchors: [] } }] }) });
  const before = material(f.db); error(await f.core.capture(input()), 'invalid_model_output');
  assert.deepEqual(material(f.db), before);
});

test('AQ1 malformed source Unicode rejects before models; malformed extracted content never admits', async (t) => {
  const f = fixture(t); const before = material(f.db);
  error(await f.core.capture(input({ messages: [{ id: 'bad', role: 'user', content: 'bad\ud800' }] })), 'invalid_input');
  assert.equal(f.calls.length, 0); assert.deepEqual(material(f.db), before);
  const broken = fixture(t, { extract: () => ({ items: [extracted({ content: 'bad\udc00' })] }) });
  error(await broken.core.capture(input()), 'invalid_model_output');
  assert.equal(broken.calls.filter((c) => c.method === 'qualify').length, 0);
  assert.equal(broken.db.prepare('SELECT count(*) n FROM memories').get().n, 0);
});

test('AQ1 legacy digest bytes remain fixed and event reuse across modes conflicts in both directions', async (t) => {
  for (const mode of ['legacy', 'source-bound-v1']) {
    const f = fixture(t, { extract: () => ({ items: [] }) }, mode); const v = input(); ok(await f.core.capture(v));
    const baseline = createHash('sha256').update(JSON.stringify(['cairn.capture.v1',
      [namespace.ownerId, namespace.scope, namespace.projectId], v.client, v.eventId, v.sessionId,
      v.messages.map((m) => [m.id, m.role, m.content])])).digest('hex');
    const actual = f.db.prepare('SELECT payload_digest FROM admission_claims').get().payload_digest;
    if (mode === 'legacy') assert.equal(actual, baseline); else assert.notEqual(actual, baseline);
    const other = openMemoryCore({ path: f.path, model: f.model,
      ...(mode === 'legacy' ? { captureQualification: 'source-bound-v1' } : {}) }); t.after(() => other.close());
    error(await other.capture(v), 'event_payload_conflict');
    assert.equal(f.calls.filter((c) => c.method === 'qualify').length, 0);
    assert.equal(f.calls.filter((c) => c.method === 'extract').length, 1);
  }
});

test('AQ3 empty capture and completed replay never invoke qualification again', async (t) => {
  for (const empty of [true, false]) {
    const f = fixture(t, { extract: () => ({ items: empty ? [] : [extracted()] }) });
    const result = ok(await f.core.capture(input())); const before = material(f.db);
    assert.deepEqual(ok(await f.core.capture(input())), { duplicate: true,
      memoryIds: result.admission.memories.map((m) => m.id), suppressedCount: 0 });
    assert.equal(f.calls.filter((c) => c.method === 'qualify').length, empty ? 0 : 1);
    assert.deepEqual(material(f.db), before);
  }
});

test('AQ3 missing qualifier, timeout and bounded overflow preserve atomicity and permit retry', async (t) => {
  for (const [overrides, code] of [
    [{ qualify: undefined }, 'model_not_configured'],
    [{ qualify: () => { throw Object.assign(new Error('synthetic'), { code: 'model_timeout' }); } }, 'model_timeout'],
    [{ qualify: () => { throw Object.assign(new Error('synthetic'), { name: 'AbortError' }); } }, 'model_cancelled'],
    [{ countTokens: (text) => text.includes('"qualifications"') ? 1025 : 1 }, 'invalid_model_output'],
    [{ countTokens: (text) => text.includes('"receiptIndex"') && text.includes('maxOutputTokens') ? 6001 : 1 }, 'context_budget_exceeded'],
  ]) {
    const f = fixture(t, overrides); const before = material(f.db);
    error(await f.core.capture(input()), code); assert.deepEqual(material(f.db), before);
    f.model.qualify = qualify; f.model.countTokens = () => 1;
    assert.equal(ok(await f.core.capture(input())).admission.memories.length, 1);
  }
});

test('AQ4 ordered captures remain unresolved even all-unknown metadata, with durable replay and no retirement', async (t) => {
  const f = fixture(t, { extract: ({ input: request }) => ({ items: [extracted({ content: request.messages[0].content })] }),
    reconcile: () => assert.fail('automatic source qualification is not trusted identity'),
    qualify: ({ input: request }) => ({ qualifications: request.items.map(({ itemIndex }) => ({ itemIndex,
      qualification: { version: 1, slot: { subject: null, property: null, scope: null, applies: null },
        value: null, attribution: 'unknown', commitment: 'unknown', anchors: [{ receiptIndex: 0, start: 0,
          end: 1, text: 'I', fields: ['attribution'] }] } })) }) });
  const outcome = { status: 'unresolved', reason: 'qualification_requires_identity', retiredCount: 0 };
  const first = input({ causal: { streamId: 'stream', sequence: 1 } });
  const old = ok(await f.core.capture(first)); assert.deepEqual(old.reconciliation, outcome);
  const next = input({ eventId: 'next', causal: { streamId: 'stream', sequence: 2 },
    messages: [{ id: 'next-source', role: 'user', content: 'I now choose a bus.' }] });
  const changed = ok(await f.core.capture(next)); assert.deepEqual(changed.reconciliation, outcome);
  assert.equal(detail(f.core, old.admission.memories[0].id).memory.state, 'active');
  assert.equal(f.db.prepare('SELECT count(*) n FROM qualified_claim_bindings').get().n, 0);
  f.close(); const cold = openMemoryCore({ path: f.path, captureQualification: 'source-bound-v1',
    model: { extract: () => assert.fail('completed replay cannot call models') } }); t.after(() => cold.close());
  assert.deepEqual(ok(await cold.capture(next)), { duplicate: true,
    memoryIds: changed.admission.memories.map((m) => m.id), suppressedCount: 0, reconciliation: outcome });
});

test('AQ3 exact dedup succeeds but changed source binding rejects entire later batch; tombstones remain suppressed', async (t) => {
  const f = fixture(t); const first = ok(await f.core.capture(input()));
  const again = ok(await f.core.capture(input({ eventId: 'second-event' })));
  assert.equal(again.admission.memories[0].id, first.admission.memories[0].id);
  const before = material(f.db);
  f.model.extract = () => ({ items: [extracted({ content: 'A new independent decision' }), extracted()] });
  error(await f.core.capture(input({ eventId: 'conflict', messages: [{ id: 'different-source', role: 'user', content }] })), 'qualification_conflict');
  assert.deepEqual(material(f.db), before);
  const prior = detail(f.core, first.admission.memories[0].id);
  ok(f.core.forget({ namespace, memoryId: prior.memory.id, expectedRevision: prior.memory.revision }));
  f.model.extract = () => ({ items: [extracted()] });
  const suppressed = ok(await f.core.capture(input({ eventId: 'suppressed', causal: { streamId: 'stream', sequence: 1 } })));
  assert.equal(suppressed.admission.suppressedCount, 1);
  assert.deepEqual(suppressed.reconciliation, { status: 'unresolved', reason: 'qualification_requires_identity', retiredCount: 0 });
});

test('AQ1 pending qualifier cannot finish or abandon a successor after lease expiration', async (t) => {
  let release; let started;
  const reached = new Promise((resolve) => { started = resolve; });
  const f = fixture(t, { qualify: (request) => new Promise((resolve) => { release = () => resolve(qualify(request)); started(); }) });
  const pending = f.core.capture(input()); await reached;
  const row = f.db.prepare('SELECT payload_digest, token FROM admission_claims').get();
  f.db.exec('UPDATE admission_claims SET lease_expires_at=0');
  const other = openMemoryCore({ path: f.path }); t.after(() => other.close());
  const key = { namespace, client: input().client, eventId: input().eventId, payloadDigest: row.payload_digest };
  const successor = ok(other.claimAdmission({ ...key, leaseMs: 125000 })); assert.notEqual(successor.token, row.token);
  release(); error(await pending, 'stale_admission');
  assert.equal(f.db.prepare('SELECT token FROM admission_claims').get().token, successor.token);
  assert.equal(f.db.prepare('SELECT count(*) n FROM memories').get().n, 0);
  ok(other.finishAdmission({ ...key, token: successor.token, items: [] }));
});

test('AQ2 exact reversed item coverage correlates distinct qualifications in one batch outside write transactions', async (t) => {
  let db;
  const f = fixture(t, { extract: () => ({ items: [extracted(), extracted({ content: 'I choose the blue bus.' })] }),
    qualify: ({ input: request }) => {
      db.exec('BEGIN IMMEDIATE'); db.exec('ROLLBACK');
      assert.deepEqual(request.items.map((item) => item.itemIndex), [0, 1]);
      return { qualifications: [{ itemIndex: 1, qualification: qualification(content, { value: 'blue bus' }) },
        { itemIndex: 0, qualification: qualification() }] };
    } }); db = f.db;
  const result = ok(await f.core.capture(input())); assert.equal(result.admission.memories.length, 2);
  assert.deepEqual(result.admission.memories.map((m) => detail(f.core, m.id).qualification.value), ['violet tram', 'blue bus']);
  assert.equal(f.calls.filter((call) => call.method === 'qualify').length, 1);
});

test('AQ2 actual 30-second qualifier timeout aborts without writes or lease renewal using synthetic clock', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let started; let signal;
  const reached = new Promise((resolve) => { started = resolve; });
  const f = fixture(t, { qualify: (request) => { signal = request.signal; started(); return new Promise(() => {}); } });
  const pending = f.core.capture(input()); await reached;
  const lease = f.db.prepare('SELECT lease_expires_at FROM admission_claims').get().lease_expires_at;
  t.mock.timers.tick(29999); assert.equal(signal.aborted, false);
  assert.equal(f.db.prepare('SELECT lease_expires_at FROM admission_claims').get().lease_expires_at, lease);
  t.mock.timers.tick(1); error(await pending, 'model_timeout'); assert.equal(signal.aborted, true);
  assert.equal(f.db.prepare('SELECT count(*) n FROM memories').get().n, 0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM memory_qualifications').get().n, 0);
});

test('AQ6 diagnostic reasons stay finite/content-free and hostile observers cannot change failure', async (t) => {
  for (const providerFailure of [false, true]) {
    const events = [];
    const f = fixture(t, { qualify: () => {
      if (providerFailure) throw new Error(content);
      return { qualifications: [{ itemIndex: 0, qualification: { ...qualification(), value: 'secret\ud800' } }] };
    }, onDiagnostic: (event) => { events.push(event); throw new Error('observer'); } });
    error(await f.core.capture(input()), providerFailure ? 'qualification_failed' : 'invalid_model_output');
    assert.deepEqual(events, [{ version: 1, stage: 'qualify',
      layer: providerFailure ? 'core_call' : 'core_validation', reason: providerFailure ? 'provider_failure' : 'invalid_qualification' }]);
    assert.equal(Object.isFrozen(events[0]), true); assert.ok(!JSON.stringify(events).includes(content));
  }
});

test('AQ4 ordered empty extraction keeps no-change and ordered qualified dedup never calls reconcile', async (t) => {
  for (const empty of [false, true]) {
    const f = fixture(t, { extract: () => ({ items: empty ? [] : [extracted()] }),
      reconcile: () => assert.fail('source qualification never authorizes reconcile') });
    const first = ok(await f.core.capture(input({ causal: { streamId: 'stream', sequence: 1 } })));
    const second = ok(await f.core.capture(input({ eventId: 'second', causal: { streamId: 'stream', sequence: 2 } })));
    const expected = empty ? { status: 'complete_no_change', reason: null, retiredCount: 0 }
      : { status: 'unresolved', reason: 'qualification_requires_identity', retiredCount: 0 };
    assert.deepEqual(first.reconciliation, expected); assert.deepEqual(second.reconciliation, expected);
    if (!empty) assert.equal(second.admission.memories[0].id, first.admission.memories[0].id);
    assert.equal(f.calls.filter((call) => call.method === 'qualify').length, empty ? 0 : 2);
  }
});
