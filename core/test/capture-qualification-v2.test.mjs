import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';

const namespace = { ownerId: 'candidate-capture-test', scope: 'personal', projectId: null };
const source = 'For my personal reading notes, use short numbered lists.';
const input = (patch = {}) => ({ namespace, client: 'synthetic', sessionId: 'session', eventId: 'batch',
  messages: [{ id: 'source', role: 'user', content: source }], ...patch });
const fields = ['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'];
const qualifyCandidates = ({ input }) => ({ qualifications: input.items.map((item) => ({ itemIndex: item.itemIndex,
  ...Object.fromEntries(fields.map((field) => [field, { value: field === 'attribution' ? 'direct' : field === 'commitment' ? 'adopted' : 'Synthetic',
    evidenceIndices: [item.candidates[0].candidateIndex] }])) })) });
const ok = (result) => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const error = (result, code) => { assert.equal(result.ok, false, JSON.stringify(result)); assert.equal(result.error.code, code); };
function fixture(t, overrides = {}) {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-v2-capture-')), 'memory.sqlite');
  const calls = []; const model = { countTokens: () => 1, contextWindow: 8192,
    extract: ({ input }) => ({ items: input.messages.map((message) => ({ content: message.content.slice(0, 100), kind: 'preference', confidence: 0.9,
      sourceIndices: [message.index] })) }), qualifyCandidates, qualify: () => assert.fail('v1 method must not run'),
    reconcile: () => assert.fail('v2 is not trusted same-slot identity'), ...overrides };
  for (const method of ['extract', 'qualifyCandidates']) {
    const fn = model[method]; if (typeof fn === 'function') model[method] = async (request) => {
      calls.push({ method, input: structuredClone(request.input), signal: request.signal }); return fn(request);
    };
  }
  const core = openMemoryCore({ path, model, captureQualification: 'source-bound-v2' }); const db = new DatabaseSync(path); let closed = false;
  const close = () => { if (!closed) { core.close(); db.close(); closed = true; } }; t.after(close);
  return { core, db, model, calls, path, close };
}
const detail = (core, id) => ok(core.get({ namespace, memoryId: id, includeQualification: true }));
const material = (db) => ['memories', 'receipts', 'memory_qualifications', 'qualification_anchors', 'qualified_claim_bindings']
  .map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]);

test('CV2 candidate capture stores exact core-derived source span, cold-inspects and replays with no model calls', async (t) => {
  const f = fixture(t); const result = ok(await f.core.capture(input())); const id = result.admission.memories[0].id;
  assert.deepEqual(f.calls.map((call) => call.method), ['extract', 'qualifyCandidates']);
  assert.deepEqual(f.calls[1].input, { items: [{ itemIndex: 0, content: source, kind: 'preference', candidates: [{ candidateIndex: 0, role: 'user', text: source }] }] });
  const saved = detail(f.core, id); assert.equal(saved.qualification.anchors[0].end, source.length);
  assert.deepEqual(saved.qualification.anchors[0].fields, fields);
  assert.equal(f.db.prepare('SELECT count(*) n FROM qualified_claim_bindings').get().n, 0);
  assert.equal(f.db.prepare('PRAGMA user_version').get().user_version, 12);
  f.close(); const cold = openMemoryCore({ path: f.path, captureQualification: 'source-bound-v2' }); t.after(() => cold.close());
  assert.deepEqual(detail(cold, id), saved); assert.equal(ok(await cold.capture(input())).duplicate, true);
  for (const mode of [undefined, 'source-bound-v1']) {
    const other = openMemoryCore({ path: f.path, ...(mode ? { captureQualification: mode } : {}) }); t.after(() => other.close());
    error(await other.capture(input()), 'event_payload_conflict');
  }
});

test('CV2 canonical NFKC redaction astral receipts and [3,0] selection never expose identities or offsets', async (t) => {
  const secret = 'sk-' + 'a'.repeat(48);
  const f = fixture(t, { extract: () => ({ items: [{ content: 'Synthetic preference', kind: 'preference', confidence: 0.8, sourceIndices: [3, 0] }] }) });
  const result = ok(await f.core.capture(input({ messages: [{ id: 'zero', role: 'user', content: ' Ａ 🚋 repeated repeated ' },
    { id: 'one', role: 'user', content: 'excluded' }, { id: 'two', role: 'assistant', content: 'excluded too' },
    { id: 'three', role: 'assistant', content: `Private ${secret}` }] })));
  assert.deepEqual(f.calls[1].input.items[0].candidates, [{ candidateIndex: 0, role: 'assistant', text: 'Private [REDACTED]' },
    { candidateIndex: 1, role: 'user', text: 'A 🚋 repeated repeated' }]);
  assert.ok(!JSON.stringify(f.calls).includes(secret));
  const saved = detail(f.core, result.admission.memories[0].id);
  assert.equal(saved.qualification.anchors[0].text, 'Private [REDACTED]');
});

test('CV2 foreign item candidate and malformed later output fail complete SQLite admission atomically', async (t) => {
  for (const variant of ['foreign', 'missing-field', 'fifth-anchor']) {
    const f = fixture(t, { qualifyCandidates: (request) => {
      const output = qualifyCandidates(request);
      if (variant === 'foreign') output.qualifications[1].subject.evidenceIndices = [0];
      if (variant === 'missing-field') delete output.qualifications[1].value;
      if (variant === 'fifth-anchor') {
        // First item spans five windows due to a surrogate-safe 199-unit split.
        output.qualifications[0].subject.evidenceIndices = [0, 1, 2, 3]; output.qualifications[0].value.evidenceIndices = [4];
      }
      return output;
    } }); const before = material(f.db);
    const long = 'a'.repeat(199) + '🚋' + 'b'.repeat(599);
    error(await f.core.capture(input({ messages: [{ id: 'first', role: 'user', content: variant === 'fifth-anchor' ? long : 'First statement' },
      { id: 'second', role: 'user', content: 'Second statement' }] })), 'invalid_model_output');
    assert.deepEqual(material(f.db), before);
  }
});

test('CV2 ordered captures remain unresolved without retirement or trusted bindings', async (t) => {
  const f = fixture(t);
  for (const sequence of [1, 2]) {
    const result = ok(await f.core.capture(input({ eventId: `batch-${sequence}`, causal: { streamId: 'stream', sequence },
      messages: [{ id: `message-${sequence}`, role: 'user', content: `Deadline is ${sequence === 1 ? 'Friday' : 'Monday'}.` }] })));
    assert.deepEqual(result.reconciliation, { status: 'unresolved', reason: 'qualification_requires_identity', retiredCount: 0 });
    assert.equal(detail(f.core, result.admission.memories[0].id).memory.state, 'active');
  }
  assert.deepEqual(ok(f.core.list({ namespace, states: ['historical'] })).memories, []);
  assert.equal(f.db.prepare('SELECT count(*) n FROM qualified_claim_bindings').get().n, 0);
});

test('CV2 unchanged v1 still rejects observed malformed offset and missing value coverage', async (t) => {
  const f = fixture(t); let end = 41;
  const quote = source.slice(0, -1); assert.equal(quote.length, 55);
  const legacy = openMemoryCore({ path: f.path, captureQualification: 'source-bound-v1', model: { ...f.model,
    qualify: () => ({ qualifications: [{ itemIndex: 0, qualification: { version: 1,
      slot: { subject: null, property: null, scope: null, applies: null }, value: 'short numbered lists',
      attribution: 'direct', commitment: 'adopted', anchors: [{ receiptIndex: 0, start: 0, end, text: quote,
        fields: ['attribution', 'commitment'] }] } }] }) } }); t.after(() => legacy.close());
  error(await legacy.capture(input()), 'invalid_model_output'); end = 55;
  error(await legacy.capture(input()), 'invalid_model_output'); assert.equal(f.db.prepare('SELECT count(*) n FROM memories').get().n, 0);
});

test('CV2 missing method, output/input budget overflow and cancellation never admit partially', async (t) => {
  for (const [overrides, code] of [[{ qualifyCandidates: undefined }, 'model_not_configured'],
    [{ qualifyCandidates: () => { throw Object.assign(new Error(), { name: 'AbortError' }); } }, 'model_cancelled'],
    [{ countTokens: (text) => text.includes('"qualifications"') ? 1025 : 1 }, 'invalid_model_output'],
    [{ countTokens: (text) => text.includes('"candidateIndex"') && text.includes('maxOutputTokens') ? 6001 : 1 }, 'context_budget_exceeded']]) {
    const f = fixture(t, overrides); const before = material(f.db);
    error(await f.core.capture(input()), code); assert.deepEqual(material(f.db), before);
  }
});

test('CV2 actual 30-second synthetic-clock timeout aborts and diagnostics identify new stage', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); let started; let signal;
  const reached = new Promise((resolve) => { started = resolve; }); const diagnostics = [];
  const f = fixture(t, { qualifyCandidates: (request) => { signal = request.signal; started(); return new Promise(() => {}); },
    onDiagnostic: (event) => diagnostics.push(event) });
  const pending = f.core.capture(input()); await reached;
  t.mock.timers.tick(29999); assert.equal(signal.aborted, false);
  t.mock.timers.tick(1); error(await pending, 'model_timeout'); assert.equal(signal.aborted, true);
  assert.deepEqual(diagnostics, [{ version: 1, stage: 'qualifyCandidates', layer: 'core_call', reason: 'model_timeout' }]);
  assert.equal(f.db.prepare('SELECT count(*) n FROM memories').get().n, 0);
});

test('CV2 whitespace at receipt truncation boundary uses exact stored canonical source without rejecting valid capture', async (t) => {
  const f = fixture(t); const retained = 'a'.repeat(799);
  const result = ok(await f.core.capture(input({ messages: [{ id: 'boundary', role: 'user', content: retained + ' tail' }] })));
  const candidates = f.calls.find((call) => call.method === 'qualifyCandidates').input.items[0].candidates;
  assert.equal(candidates.map((candidate) => candidate.text).join(''), retained);
  assert.equal(detail(f.core, result.admission.memories[0].id).receipts[0].excerpt, retained);
});

test('CV2 qualified dedup stays immutable, changed sources roll back whole batch and forgetting suppresses recapture', async (t) => {
  const f = fixture(t); const first = ok(await f.core.capture(input())); const id = first.admission.memories[0].id;
  assert.equal(ok(await f.core.capture(input({ eventId: 'same-source' }))).admission.memories[0].id, id);
  const before = material(f.db);
  error(await f.core.capture(input({ eventId: 'changed-source', messages: [
    { id: 'new-item', role: 'user', content: 'New independent item' }, { id: 'other-receipt', role: 'user', content: source }] })), 'qualification_conflict');
  assert.deepEqual(material(f.db), before);
  const saved = detail(f.core, id); ok(f.core.forget({ namespace, memoryId: id, expectedRevision: saved.memory.revision }));
  const result = ok(await f.core.capture(input({ eventId: 'after-forget' })));
  assert.equal(result.admission.suppressedCount, 1); assert.deepEqual(result.admission.memories, []);
});

test('CV2 qualifier input mutation cannot rewrite original source binding', async (t) => {
  const f = fixture(t, { qualifyCandidates: (request) => {
    const result = qualifyCandidates(request); request.input.items[0].candidates[0].text = 'Forged replacement';
    request.input.items[0].content = 'Forged memory'; return result;
  } });
  const result = ok(await f.core.capture(input())); const saved = detail(f.core, result.admission.memories[0].id);
  assert.equal(saved.memory.content, source); assert.equal(saved.qualification.anchors[0].text, source);
});
