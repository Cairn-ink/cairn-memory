import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';
import { captureSnapshot } from '../capture-input.mjs';

const namespace = { ownerId: 'indexed-evidence-test', scope: 'personal', projectId: null };
const policy = { captureSourcePolicy: 'indexed-evidence-v1' };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const denied = (result, code) => { assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.error.code, code); assert.equal(Object.hasOwn(result, 'value'), false); };
const input = (texts = ['Synthetic source'], patch = {}) => ({ namespace, client: 'synthetic',
  sessionId: 'session', eventId: 'batch', messages: texts.map((content, index) => ({
    id: `source-${index}`, role: index % 2 ? 'assistant' : 'user', content })), ...patch });
const item = (sourceIndices, content = 'Synthetic selected evidence') => ({ content,
  kind: 'context', confidence: 0.8, sourceIndices });
const detail = (core, memoryId) => ok(core.get({ namespace, memoryId, includeQualification: true }));
const methods = ['qualify', 'qualifyCandidates', 'reconcile', 'relate', 'reviewBasis'];

function fixture(t, overrides = {}, options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cairn-indexed-evidence-'));
  const path = join(root, 'store.sqlite'), calls = [];
  const model = { contextWindow: 8192, countTokens: () => 1,
    extract: request => { calls.push({ method: 'extract', input: structuredClone(request.input), system: request.system });
      return overrides.extract ? overrides.extract(request) : { items: [item([request.input.messages.length - 1])] }; },
    classify: request => { calls.push({ method: 'classify' });
      return overrides.classify ? overrides.classify(request) : { items: request.input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) }; },
    select: request => ({ refs: request.input.maps.flatMap(map => map.items.filter(row => row.type === 'unfiled')
      .map(row => ({ namespaceIndex: map.namespaceIndex, ...row.ref }))) }),
    rank: request => ({ refs: request.input.candidates.slice(0, request.input.limit).map(row => ({
      namespaceIndex: row.namespaceIndex, memoryId: row.memory.id, revision: row.memory.revision })) }),
    ...(overrides.countTokens ? { countTokens: overrides.countTokens } : {}) };
  for (const method of methods) Object.defineProperty(model, method, { get() { assert.fail(`forbidden method access: ${method}`); } });
  const core = openMemoryCore({ path, model, ...policy, ...options });
  const db = new DatabaseSync(path); let closed = false;
  const close = () => { if (!closed) { core.close(); db.close(); closed = true; } };
  t.after(() => { close(); rmSync(root, { recursive: true, force: true }); });
  return { root, path, core, db, model, calls, close };
}
const count = (db, table) => db.prepare(`SELECT count(*) n FROM ${table}`).get().n;

test('E2/E3/E5 actual tail admission survives cold source-only reads without accessing interpreters', async t => {
  const tail = '2024-01-01: choose Friday for this trip.';
  const f = fixture(t); const request = input(['x'.repeat(800) + tail]);
  const result = ok(await f.core.capture(request));
  assert.equal(result.qualificationStatus, 'not-requested');
  assert.deepEqual(f.calls.map(call => call.method), ['extract', 'classify']);
  assert.equal(f.calls[0].system, readFileSync(new URL('../prompts/extract-source-windows.md', import.meta.url), 'utf8'));
  assert.equal(f.calls[0].input.inputMode, 'indexed-windows-v1');
  assert.equal(f.calls[0].input.messages[1].content, tail);
  assert.equal(result.sourceWindowCatalog.windowCount, 2);
  const id = result.admission.memories[0].id;
  assert.equal(detail(f.core, id).qualification, null);
  assert.deepEqual(detail(f.core, id).receipts.map(row => [row.eventId, row.role, row.excerpt]), [['source-0', 'user', tail]]);
  for (const table of ['memory_qualifications', 'qualification_anchors', 'qualified_claim_bindings', 'memory_supersessions']) {
    assert.equal(count(f.db, table), 0);
  }
  assert.equal(ok(await f.core.capture(request)).duplicate, true);
  assert.equal(f.calls.length, 2);
  f.close(); const cold = openMemoryCore({ path: f.path, model: f.model, ...policy }); t.after(() => cold.close());
  const before = f.calls.length;
  assert.equal(ok(await cold.capture(request)).qualificationStatus, 'not-requested');
  assert.equal(f.calls.length, before);
  const fetched = ok(cold.fetch({ namespace, contextMode: 'source-evidence', refs: [{ memoryId: id, revision: detail(cold, id).memory.revision }] }));
  assert.equal(fetched.items[0].receipts[0].excerpt, tail);
  const recalled = ok(await cold.recall({ readSet: [namespace], query: 'Friday', contextMode: 'source-evidence' }));
  assert.equal(recalled.memories[0].receipts[0].excerpt, tail);
  assert.equal(Object.hasOwn(recalled.memories[0], 'qualification'), false);
  assert.equal(Object.hasOwn(recalled.memories[0].memory, 'content'), false);
});

test('E6 old qualified capture failure versus new evidence admission uses the actual persistence seam', async t => {
  const f = fixture(t); const request = input(['x'.repeat(800) + 'Useful tail']);
  const path = join(f.root, 'qualified-control.sqlite'); let qualifications = 0;
  const old = openMemoryCore({ path, captureQualification: 'source-bound-v2', captureSourcePolicy: 'indexed-windows-v1',
    model: { contextWindow: 8192, countTokens: () => 1, extract: f.model.extract,
      qualifyCandidates() { qualifications++; throw new Error('synthetic_qualifier_failure'); } } });
  try {
    denied(await old.capture(request), 'qualification_failed');
    assert.equal(qualifications, 1); assert.equal(ok(old.list({ namespace })).memories.length, 0);
  } finally { old.close(); }
  const result = ok(await f.core.capture(request)); const id = result.admission.memories[0].id;
  f.close(); const cold = openMemoryCore({ path: f.path });
  try { assert.equal(detail(cold, id).receipts[0].excerpt, 'Useful tail'); }
  finally { cold.close(); }
});

test('E1 invalid own configuration fails before database creation and getter access', () => {
  const root = mkdtempSync(join(tmpdir(), 'cairn-indexed-options-'));
  try {
    for (const options of [{ captureSourcePolicy: undefined }, { captureSourcePolicy: 'wrong' },
      ...['captureQualification', 'captureEvidence', 'captureRationale'].flatMap(key => [
        { ...policy, [key]: undefined }, { ...policy, [key]: key === 'captureQualification' ? 'source-bound-v2' : 'staged-v1' }])]) {
      const path = join(root, 'invalid.sqlite');
      assert.throws(() => openMemoryCore({ path, ...options }), { code: 'invalid_input' });
      assert.equal(existsSync(path), false);
    }
    for (const key of ['captureSourcePolicy', 'captureQualification', 'captureEvidence', 'captureRationale']) {
      let reads = 0; const path = join(root, 'getter.sqlite'), options = { path, ...policy };
      Object.defineProperty(options, key, { enumerable: true, get() { reads++; throw new Error('getter'); } });
      assert.throws(() => openMemoryCore(options), { code: 'invalid_input' });
      assert.equal(reads, 0); assert.equal(existsSync(path), false);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('E1 inherited policy retains default prompt/result/digest while new lane ignores inherited enrichment', async t => {
  const f = fixture(t); const path = join(f.root, 'inherited.sqlite');
  const inherited = Object.assign(Object.create(policy), { path, model: f.model });
  const core = openMemoryCore(inherited); t.after(() => core.close());
  const result = ok(await core.capture(input()));
  assert.equal(Object.hasOwn(result, 'qualificationStatus'), false);
  assert.equal(Object.hasOwn(result, 'sourceWindowCatalog'), false);
  assert.equal(f.calls[0].system, readFileSync(new URL('../prompts/extract-memories.md', import.meta.url), 'utf8'));
  const options = Object.assign(Object.create({ get captureRationale() { assert.fail('inherited rationale'); },
    get captureEvidence() { assert.fail('inherited staging'); } }), { path: join(f.root, 'inherited-enrichment.sqlite'), model: f.model, ...policy });
  const evidence = openMemoryCore(options); t.after(() => evidence.close());
  assert.equal(ok(await evidence.capture(input())).qualificationStatus, 'not-requested');
  assert.notEqual(captureSnapshot(input(), undefined, 'indexed-evidence-v1').payloadDigest,
    captureSnapshot(input(), 'source-bound-v2', 'indexed-windows-v1').payloadDigest);
});

test('E3 any own causal field rejects before claims, model access or writes', async t => {
  const f = fixture(t);
  for (const causal of [undefined, null, { streamId: 'stream', sequence: 1 }]) denied(await f.core.capture(input(['Source'], { causal })), 'invalid_input');
  let reads = 0; const request = input(); Object.defineProperty(request, 'causal', { enumerable: true,
    get() { reads++; throw new Error('causal_getter'); } });
  denied(await f.core.capture(request), 'invalid_input'); assert.equal(reads, 0);
  for (const table of ['admission_claims', 'memories', 'receipts']) assert.equal(count(f.db, table), 0);
  assert.deepEqual(f.calls, []);
});

test('E2/E3 malformed later items, duplicated receipts and malformed Unicode remain atomic', async t => {
  for (const bad of [item([99]), item([0, 0]), item([0, 1, 2, 3, 4]), item([0], '\ud800'), item([0], 123)]) {
    const f = fixture(t, { extract: () => ({ items: [item([0]), bad] }) });
    denied(await f.core.capture(input(['x'.repeat(4000)])), 'invalid_model_output');
    assert.equal(count(f.db, 'memories'), 0); assert.equal(count(f.db, 'receipts'), 0);
    assert.deepEqual(f.calls.map(call => call.method), ['extract']);
  }
  const duplicate = fixture(t, { extract: () => ({ items: [item([0, 1])] }) });
  denied(await duplicate.core.capture(input(['x'.repeat(1600)])), 'invalid_model_output');
  assert.equal(count(duplicate.db, 'memories'), 0);
  const malformed = fixture(t); denied(await malformed.core.capture(input(['\ud800'])), 'invalid_input');
  assert.deepEqual(malformed.calls, []); assert.equal(count(malformed.db, 'admission_claims'), 0);
});

test('E2 multiwindow support preserves normalized Unicode and redaction; mutation cannot forge sources', async t => {
  const secret = 'sk-' + 'a'.repeat(48), request = input([' Ａ 🚋 ' + 'x'.repeat(799) + `Private ${secret} tail`]);
  const original = structuredClone(request);
  const f = fixture(t, { countTokens() { request.messages[0].content = 'caller mutation'; return 1; },
    extract({ input: wire }) { wire.messages[1].content = 'model mutation'; return { items: [item([0, 1])] }; } });
  const result = ok(await f.core.capture(request)); const receipts = detail(f.core, result.admission.memories[0].id).receipts;
  assert.equal(receipts.length, 2); assert.ok(receipts.some(row => row.excerpt.startsWith('A 🚋')));
  assert.ok(receipts.some(row => row.excerpt.includes('Private [REDACTED] tail')));
  assert.ok(!JSON.stringify(receipts).includes(secret)); assert.ok(!JSON.stringify(receipts).includes('mutation'));
  assert.equal(ok(await f.core.capture(original)).duplicate, true);
});

test('E3/E5 conflicting dated choices both remain current evidence with no retirement or authority', async t => {
  const f = fixture(t, { extract: ({ input: wire }) => ({ items: [item([0], wire.messages[0].content)] }) });
  for (const [index, text] of ['2024-01-01: choose Friday.', '2024-01-02: choose Monday.'].entries()) {
    const result = ok(await f.core.capture(input([text], { eventId: `choice-${index}` })));
    assert.equal(Object.hasOwn(result, 'reconciliation'), false);
  }
  assert.equal(ok(f.core.list({ namespace })).memories.length, 2);
  assert.equal(ok(f.core.list({ namespace, states: ['historical'] })).memories.length, 0);
  const sources = ok(f.core.sourceSnapshot({ readSet: [namespace], limit: 6 }));
  assert.deepEqual(sources.memories.map(row => row.receipts[0].excerpt).sort(),
    ['2024-01-01: choose Friday.', '2024-01-02: choose Monday.']);
  assert.equal(count(f.db, 'qualified_claim_bindings'), 0);
});

test('E3 classification failure remains an explicit post-admission result', async t => {
  const f = fixture(t, { classify() { throw new Error('synthetic classifier failure'); } });
  const result = ok(await f.core.capture(input()));
  assert.equal(result.qualificationStatus, 'not-requested'); assert.equal(result.classification.status, 'failed');
  assert.equal(detail(f.core, result.admission.memories[0].id).memory.filing.status, 'unfiled');
});

test('E4 processing, empty and duplicate successes carry status; payload/policy changes conflict', async t => {
  let reached, release; const started = new Promise(resolve => { reached = resolve; });
  const f = fixture(t, { extract() { reached(); return new Promise(resolve => { release = () => resolve({ items: [] }); }); } });
  const request = input(['x'.repeat(801)]), pending = f.core.capture(request); await started;
  const processing = ok(await f.core.capture(request)); assert.equal(processing.processing, true);
  assert.equal(processing.qualificationStatus, 'not-requested'); assert.equal(processing.sourceWindowCatalog.windowCount, 2);
  release(); assert.deepEqual(ok(await pending).admission.memories, []);
  assert.equal(ok(await f.core.capture(request)).qualificationStatus, 'not-requested');
  denied(await f.core.capture(input(['x'.repeat(800) + 'changed'])), 'event_payload_conflict');
  for (const options of [{}, { captureQualification: 'source-bound-v2', captureSourcePolicy: 'indexed-windows-v1' }]) {
    const other = openMemoryCore({ path: f.path, model: f.model, ...options });
    try { denied(await other.capture(request), 'event_payload_conflict'); } finally { other.close(); }
  }
});

test('E4 correction/forget, suppression, namespace and deadline fences are preserved', async t => {
  const f = fixture(t); const request = input(); const first = ok(await f.core.capture(request)); const id = first.admission.memories[0].id;
  const foreign = { ...namespace, ownerId: 'foreign-owner' };
  denied(f.core.get({ namespace: foreign, memoryId: id }), 'memory_not_found');
  const saved = detail(f.core, id);
  const corrected = ok(f.core.correct({ namespace, memoryId: id, expectedRevision: saved.memory.revision,
    content: 'Manual correction', kind: 'context', receipt: { client: 'manual', sessionId: 'manual', eventId: 'manual', role: 'user', excerpt: 'Manual correction' } }));
  const before = f.calls.length; assert.equal(ok(await f.core.capture(request)).duplicate, true); assert.equal(f.calls.length, before);
  assert.equal(detail(f.core, id).memory.content, 'Manual correction');
  ok(f.core.forget({ namespace, memoryId: id, expectedRevision: corrected.memory.revision }));
  assert.equal(ok(await f.core.capture(request)).duplicate, true); denied(f.core.get({ namespace, memoryId: id }), 'memory_not_found');
  const suppressed = ok(await f.core.capture({ ...request, eventId: 'new-event' })); assert.equal(suppressed.admission.suppressedCount, 1);
  assert.equal(ok(await f.core.capture({ ...request, namespace: foreign, eventId: 'foreign' })).admission.memories.length, 1);
  const timed = fixture(t, { extract() { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25); return { items: [item([0])] }; } }, { captureDeadlineMs: 5 });
  denied(await timed.core.capture(request), 'model_timeout'); assert.equal(count(timed.db, 'memories'), 0);
});

test('E5 mixed qualified/unqualified dedup preserves prior qualification and rejects retroactive qualification', async t => {
  const qualifyCandidates = ({ input: wire }) => ({ qualifications: wire.items.map(entry => ({ itemIndex: entry.itemIndex,
    ...Object.fromEntries(['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'].map(field => [field,
      { value: ['attribution', 'commitment'].includes(field) ? 'unknown' : null,
        evidenceIndices: field === 'value' ? [entry.candidates[0].candidateIndex] : [] }])) })) });
  for (const qualifiedFirst of [true, false]) {
    const f = fixture(t);
    const qualified = openMemoryCore({ path: f.path, model: { ...f.model, qualifyCandidates },
      captureQualification: 'source-bound-v2', captureSourcePolicy: 'indexed-windows-v1' });
    try {
      const request = input(), first = ok(await (qualifiedFirst ? qualified : f.core).capture(request));
      const id = first.admission.memories[0].id, before = detail(f.core, id).qualification;
      const later = { ...request, eventId: 'other-policy-event' };
      if (qualifiedFirst) {
        const result = ok(await f.core.capture(later));
        assert.equal(result.qualificationStatus, 'not-requested');
        assert.equal(result.admission.memories[0].id, id);
        assert.deepEqual(detail(f.core, id).qualification, before);
      } else {
        denied(await qualified.capture(later), 'qualification_conflict');
        assert.equal(detail(f.core, id).qualification, null);
        assert.equal(count(f.db, 'memories'), 1);
      }
    } finally { qualified.close(); }
  }
});

test('E2 submitted message/count/batch bounds reject before a claim', async t => {
  for (const texts of [Array(25).fill('source'), ['x'.repeat(4001)], Array(6).fill('x'.repeat(4000))]) {
    const f = fixture(t); denied(await f.core.capture(input(texts)), 'invalid_input');
    assert.equal(count(f.db, 'admission_claims'), 0); assert.deepEqual(f.calls, []);
  }
});
