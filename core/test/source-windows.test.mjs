import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';
import { captureSnapshot } from '../capture-input.mjs';
import { sourceWindowCatalog } from '../source-windows.mjs';

const namespace = { ownerId: 'window-test', scope: 'personal', projectId: null };
const fields = ['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'];
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const error = (result, code) => { assert.equal(result.ok, false, JSON.stringify(result)); assert.equal(result.error.code, code);
  assert.equal(Object.hasOwn(result, 'value'), false);
  assert.equal(Object.hasOwn(result, 'sourceWindowCatalog'), false); };
const input = (contents, patch = {}) => ({ namespace, client: 'synthetic-client', sessionId: 'session', eventId: 'batch',
  messages: contents.map((content, index) => ({ id: `message-${index}`, role: index % 2 ? 'assistant' : 'user', content })), ...patch });
const item = (indices, content = 'Synthetic window memory') => ({ content, kind: 'context', confidence: 0.8, sourceIndices: indices });
const qualify = ({ input: request }) => ({ qualifications: request.items.map(entry => ({ itemIndex: entry.itemIndex,
  ...Object.fromEntries(fields.map(field => [field, { value: ['attribution', 'commitment'].includes(field) ? 'unknown' : null,
    evidenceIndices: field === 'value' ? [entry.candidates[0].candidateIndex] : [] }])) })) });
const select = ({ input: request }) => ({ refs: request.maps.flatMap(map => map.items.filter(entry => entry.type === 'unfiled')
  .map(entry => ({ namespaceIndex: map.namespaceIndex, ...entry.ref }))) });
const rank = ({ input: request }) => ({ refs: request.candidates.slice(0, request.limit)
  .map(entry => ({ namespaceIndex: entry.namespaceIndex, memoryId: entry.memory.id, revision: entry.memory.revision })) });

function fixture(t, overrides = {}, options = {}) {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-source-windows-')), 'memory.sqlite');
  const calls = [];
  const model = { countTokens: () => 1, contextWindow: 8192,
    extract: ({ input: request }) => ({ items: [item([request.messages.length - 1])] }),
    qualifyCandidates: qualify, select, rank, ...overrides };
  for (const method of ['extract', 'qualifyCandidates', 'select', 'rank']) {
    const fn = model[method]; if (typeof fn === 'function') model[method] = request => {
      calls.push({ method, input: structuredClone(request.input), system: request.system }); return fn(request);
    };
  }
  const core = openMemoryCore({ path, model, captureQualification: 'source-bound-v2',
    captureSourcePolicy: 'indexed-windows-v1', ...options });
  const db = new DatabaseSync(path); let closed = false;
  const close = () => { if (!closed) { core.close(); db.close(); closed = true; } };
  t.after(close); return { core, db, path, calls, model, close };
}
const detail = (core, id) => ok(core.get({ namespace, memoryId: id, includeQualification: true }));

test('W1/W7 actual core tail capture, qualification, cold get and source recall retain exact original identity', async t => {
  const content = 'a'.repeat(800) + 'TAIL: only on Friday.';
  const f = fixture(t); const request = input([content]);
  const captured = ok(await f.core.capture(request));
  assert.deepEqual(captured.sourceWindowCatalog, { version: 1, maxUnitsPerWindow: 800,
    messageCount: 1, windowCount: 2, semanticCoverage: 'unassessed' });
  assert.equal(Object.hasOwn(captured, 'retainedSourceWindow'), false);
  assert.deepEqual(f.calls[0].input, { inputMode: 'indexed-windows-v1', messages: [
    { index: 0, messageIndex: 0, role: 'user', content: 'a'.repeat(800) },
    { index: 1, messageIndex: 0, role: 'user', content: 'TAIL: only on Friday.' }] });
  assert.ok(!JSON.stringify(f.calls[0].input).includes('message-0'));
  const id = captured.admission.memories[0].id;
  const saved = detail(f.core, id);
  assert.deepEqual(saved.receipts.map(({ eventId, role, excerpt }) => ({ eventId, role, excerpt })),
    [{ eventId: 'message-0', role: 'user', excerpt: 'TAIL: only on Friday.' }]);
  assert.equal(saved.qualification.anchors[0].text, 'TAIL: only on Friday.');
  const expected = ok(await f.core.recall({ readSet: [namespace], query: 'Friday', contextMode: 'source-evidence' }));
  assert.equal(expected.memories[0].receipts[0].excerpt, 'TAIL: only on Friday.');
  f.close(); const cold = openMemoryCore({ path: f.path, model: f.model, captureQualification: 'source-bound-v2',
    captureSourcePolicy: 'indexed-windows-v1' }); t.after(() => cold.close());
  assert.deepEqual(detail(cold, id), saved);
  assert.deepEqual(ok(await cold.recall({ readSet: [namespace], query: 'Friday', contextMode: 'source-evidence' })), expected);
  assert.equal(ok(await cold.capture(request)).duplicate, true);
  assert.equal(f.calls.filter(call => call.method === 'extract').length, 1);
});

test('W1 constructor rejects invalid modes and active inherited rationale/evidence before database creation', t => {
  for (const options of [
    { captureSourcePolicy: undefined }, { captureSourcePolicy: 'other', captureQualification: 'source-bound-v2' },
    { captureSourcePolicy: 'indexed-windows-v1' },
    { captureSourcePolicy: 'indexed-windows-v1', captureQualification: 'source-bound-v2', captureEvidence: 'staged-v1' },
    { captureSourcePolicy: 'indexed-windows-v1', captureQualification: 'source-bound-v2', captureRationale: 'source-bound-v1' },
  ]) {
    const path = join(mkdtempSync(join(tmpdir(), 'cairn-window-invalid-')), 'store.sqlite');
    assert.throws(() => openMemoryCore({ path, ...options }), { code: 'invalid_input' });
    assert.equal(existsSync(path), false);
  }
  for (const inherited of [{ captureEvidence: 'staged-v1' }, { captureRationale: 'source-bound-v1' }]) {
    const path = join(mkdtempSync(join(tmpdir(), 'cairn-window-inherited-')), 'store.sqlite');
    const options = Object.assign(Object.create(inherited), { path, captureQualification: 'source-bound-v2',
      captureSourcePolicy: 'indexed-windows-v1' });
    assert.throws(() => openMemoryCore(options), { code: 'invalid_input' });
    assert.equal(existsSync(path), false);
  }
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-window-accessor-')), 'store.sqlite');
  let getterCalls = 0;
  const accessor = { path, captureQualification: 'source-bound-v2' };
  Object.defineProperty(accessor, 'captureSourcePolicy', { enumerable: true,
    get: () => { getterCalls++; return 'indexed-windows-v1'; } });
  assert.throws(() => openMemoryCore(accessor), { code: 'invalid_input' });
  assert.equal(getterCalls, 0);
  assert.equal(existsSync(path), false);
});

test('W1/W5 default, v1, v2 and inherited source policy keep legacy prompt, input and digest boundary', async t => {
  const request = input(['x'.repeat(800) + 'UNSELECTED_TAIL']);
  const baselineDigests = new Map([[undefined, 'cb3a34198f182395426c7abf53a97c21387604d1033be827d5c62452fd3e08c4'],
    ['source-bound-v1', '914d24389cd6e88f334ab3eb17cf6f1aa4fcfb33207684f7535659ccf66cfb07'],
    ['source-bound-v2', 'c041c02777f3b03c7946d5f7cb9488cd6f1cfaebd8bddfdb7a30a1db064aac29']]);
  for (const mode of [undefined, 'source-bound-v1', 'source-bound-v2']) {
    const path = join(mkdtempSync(join(tmpdir(), 'cairn-window-control-')), 'store.sqlite');
    const calls = []; const model = { contextWindow: 8192, countTokens: () => 1,
      extract: ({ system, input: wire }) => { calls.push({ system, wire }); return { items: [] }; } };
    const options = { path, model, ...(mode ? { captureQualification: mode } : {}) };
    const core = openMemoryCore(options); t.after(() => core.close());
    const result = ok(await core.capture(request));
    assert.equal(Object.hasOwn(result, 'sourceWindowCatalog'), false);
    assert.equal(calls[0].wire.messages[0].content, mode === 'source-bound-v2' ? 'x'.repeat(800) : request.messages[0].content);
    assert.equal(calls[0].system, readFileSync(new URL(mode === 'source-bound-v2'
      ? '../prompts/extract-retained-sources.md' : '../prompts/extract-memories.md', import.meta.url), 'utf8'));
    const inheritedPath = join(mkdtempSync(join(tmpdir(), 'cairn-window-inherited-control-')), 'store.sqlite');
    const inherited = Object.assign(Object.create({ captureSourcePolicy: 'indexed-windows-v1' }),
      { ...options, path: inheritedPath });
    const inheritedCore = openMemoryCore(inherited); t.after(() => inheritedCore.close());
    assert.deepEqual(ok(await inheritedCore.capture(request)), result);
    assert.equal(calls[1].system, calls[0].system);
    assert.deepEqual(calls[1].wire, calls[0].wire);
    assert.equal(captureSnapshot(request, mode).payloadDigest, baselineDigests.get(mode));
    assert.equal(captureSnapshot(request, mode, undefined).payloadDigest, baselineDigests.get(mode));
  }
});

test('W2/W7 canonical boundaries, Unicode, redaction and two-window support are exact', async t => {
  const secret = 'sk-' + 'a'.repeat(48);
  for (const [raw, expected] of [
    ['x'.repeat(799), ['x'.repeat(799)]], ['x'.repeat(800), ['x'.repeat(800)]],
    ['x'.repeat(801), ['x'.repeat(800), 'x']],
    ['x'.repeat(798) + '🚋TAIL', ['x'.repeat(798) + '🚋', 'TAIL']],
    ['x'.repeat(799) + ' 🚋TAIL', ['x'.repeat(799), '🚋TAIL']],
    [' Ａ '.repeat(450), ['A '.repeat(400).trim(), 'A '.repeat(50).trim()]],
    [`Private ${secret} ` + 'x'.repeat(900), null],
    ['x'.repeat(4000), Array(5).fill('x'.repeat(800))],
  ]) {
    const f = fixture(t, { extract: () => ({ items: [] }) });
    const result = ok(await f.core.capture(input([raw])));
    const windows = f.calls[0].input.messages.map(entry => entry.content);
    if (expected) assert.deepEqual(windows, expected);
    assert.ok(windows.every(window => window.length <= 800 && window.isWellFormed()));
    assert.equal(result.sourceWindowCatalog.windowCount, windows.length);
    assert.ok(!JSON.stringify(f.calls).includes(secret));
  }
  const f = fixture(t, { extract: () => ({ items: [item([0, 1])] }) });
  const result = ok(await f.core.capture(input(['Condition: ' + 'x'.repeat(790) + ' only Friday.'])));
  const receipts = detail(f.core, result.admission.memories[0].id).receipts;
  assert.equal(receipts.length, 2);
  assert.ok(receipts.some(receipt => receipt.excerpt.includes('Condition:')));
  assert.ok(receipts.some(receipt => receipt.excerpt.includes('Friday.')));
});

test('W2 a noncanonical derived passage cannot masquerade as an exact receipt', () => {
  assert.throws(() => sourceWindowCatalog({ messages: [{ id: 'synthetic', role: 'user', content: ' Ａ ' }] }),
    { code: 'invalid_input' });
});

test('W2 valid full source with all-redacted standalone window rejects before claim or model', async t => {
  const f = fixture(t);
  error(await f.core.capture(input(['a'.repeat(800) + '[REDACTED]'])), 'invalid_input');
  assert.deepEqual(f.calls, []);
  for (const table of ['admission_claims', 'memories', 'receipts']) {
    assert.equal(f.db.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0);
  }
});

test('W3/W4 nonadjacent mixed speakers bind only selected original messages; duplicate canonical receipts reject', async t => {
  const f = fixture(t, { extract: () => ({ items: [item([3, 0])] }) });
  const result = ok(await f.core.capture(input(['Antecedent.', 'Unrelated A.', 'Unrelated B.', 'Assistant reply.'])));
  assert.deepEqual(detail(f.core, result.admission.memories[0].id).receipts.map(receipt => [receipt.eventId, receipt.role]).sort(),
    [['message-0', 'user'], ['message-3', 'assistant']]);
  const repeated = 'r'.repeat(800) + 'r'.repeat(800);
  const g = fixture(t, { extract: () => ({ items: [item([0, 1])] }) });
  error(await g.core.capture(input([repeated])), 'invalid_model_output');
  assert.equal(g.calls.some(call => call.method === 'qualifyCandidates'), false);
  assert.equal(g.db.prepare('SELECT count(*) n FROM memories').get().n, 0);
});

test('W4/W7 invalid indices, fifth receipt and later malformed item fail atomically before qualification', async t => {
  for (const indices of [[5], [-1], [0, 0], ['0'], [0, 1, 2, 3, 4]]) {
    const f = fixture(t, { extract: () => ({ items: [item([0]), item(indices, 'Later item')] }) });
    error(await f.core.capture(input(['x'.repeat(4000)])), 'invalid_model_output');
    assert.equal(f.calls.some(call => call.method === 'qualifyCandidates'), false);
    assert.equal(f.db.prepare('SELECT count(*) n FROM memories').get().n, 0);
  }
});

test('W5 replay digest binds unselected tail and policy; ordered source indices retain original chronology', async t => {
  const f = fixture(t, { extract: ({ input: wire }) => ({ items: [item([1], `Synthetic ${wire.messages[1].content}`)] }) });
  const request = input(['x'.repeat(800) + 'Tail.'], { causal: { streamId: 'stream', sequence: 1 } });
  const result = ok(await f.core.capture(request));
  assert.equal(result.reconciliation.reason, 'qualification_requires_identity');
  assert.equal(result.reconciliation.retiredCount, 0);
  const priorId = result.admission.memories[0].id;
  assert.equal(ok(await f.core.capture(request)).duplicate, true);
  error(await f.core.capture(input(['x'.repeat(800) + 'Changed.'], { causal: request.causal })), 'event_payload_conflict');
  const legacy = openMemoryCore({ path: f.path, captureQualification: 'source-bound-v2' }); t.after(() => legacy.close());
  error(await legacy.capture(request), 'event_payload_conflict');
  const successor = ok(await f.core.capture(input(['x'.repeat(800) + 'Different.'], {
    eventId: 'batch-2', causal: { streamId: 'stream', sequence: 2 },
    messages: [{ id: 'message-2', role: 'user', content: 'x'.repeat(800) + 'Different.' }],
  })));
  assert.equal(successor.reconciliation.reason, 'qualification_requires_identity');
  assert.equal(successor.reconciliation.retiredCount, 0);
  assert.equal(detail(f.core, priorId).memory.state, 'active');
  const other = input(['x'.repeat(800) + 'Tail.', 'UNSELECTED'], { causal: request.causal });
  const second = fixture(t, { extract: () => ({ items: [item([0])] }) });
  ok(await second.core.capture(other));
  error(await second.core.capture(input(['x'.repeat(800) + 'Tail.', 'CHANGED_UNSELECTED'],
    { causal: request.causal })), 'event_payload_conflict');
});

test('W7 caller, counter and model-input mutation cannot rewrite selected catalog or replay digest', async t => {
  const request = input(['x'.repeat(800) + 'TRUSTED_TAIL']); const original = structuredClone(request);
  let changed = false;
  const f = fixture(t, { countTokens: () => { if (!changed) { changed = true; request.messages[0].content = 'COUNTER_MUTATION'; } return 1; },
    extract: ({ input: wire }) => { wire.messages[1].content = 'MODEL_MUTATION'; wire.messages[1].index = 24;
      return { items: [item([1])] }; } });
  const result = ok(await f.core.capture(request));
  assert.equal(detail(f.core, result.admission.memories[0].id).receipts[0].excerpt, 'TRUSTED_TAIL');
  assert.equal(ok(await f.core.capture(original)).duplicate, true);
  error(await f.core.capture(input(['x'.repeat(800) + 'DIFFERENT_TAIL'])), 'event_payload_conflict');
});

test('W7 correction, forget suppression, namespace isolation and pre-admission deadline retain existing fences', async t => {
  const request = input(['x'.repeat(800) + 'TAIL']);
  const f = fixture(t, { extract: () => ({ items: [item([1])] }) });
  const first = ok(await f.core.capture(request)); const id = first.admission.memories[0].id;
  const before = detail(f.core, id);
  const otherNamespace = { ownerId: 'foreign-owner', scope: 'personal', projectId: null };
  assert.equal(f.core.get({ namespace: otherNamespace, memoryId: id }).ok, false);
  const corrected = ok(f.core.correct({ namespace, memoryId: id, expectedRevision: before.memory.revision,
    content: 'Trusted manual correction', kind: 'context', receipt: { client: 'manual', sessionId: 'manual',
      eventId: 'manual', role: 'user', excerpt: 'Trusted manual correction' } }));
  assert.notEqual(corrected.memory.revision, before.memory.revision);
  ok(f.core.forget({ namespace, memoryId: id, expectedRevision: corrected.memory.revision }));
  const later = ok(await f.core.capture({ ...request, eventId: 'after-forget' }));
  assert.equal(later.admission.suppressedCount, 1);
  assert.deepEqual(later.admission.memories, []);
  const foreign = ok(await f.core.capture({ ...request, namespace: otherNamespace, eventId: 'foreign' }));
  assert.equal(foreign.admission.memories.length, 1);
  const g = fixture(t, { extract: () => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    return { items: [item([1])] }; } }, { captureDeadlineMs: 5 });
  error(await g.core.capture(request), 'model_timeout');
  assert.equal(g.db.prepare('SELECT count(*) n FROM memories').get().n, 0);
  assert.equal(g.db.prepare('SELECT count(*) n FROM receipts').get().n, 0);
});

test('W6 empty and processing responses disclose only submitted catalog; failure discloses none', async t => {
  let entered, finish; const reached = new Promise(resolve => { entered = resolve; });
  const f = fixture(t, { extract: () => new Promise(resolve => { finish = () => resolve({ items: [] }); entered(); }) });
  const request = input(['x'.repeat(801)]); const pending = f.core.capture(request); await reached;
  const bare = openMemoryCore({ path: f.path, captureQualification: 'source-bound-v2', captureSourcePolicy: 'indexed-windows-v1' });
  assert.equal(ok(await bare.capture(request)).sourceWindowCatalog.windowCount, 2); bare.close();
  finish(); assert.deepEqual(ok(await pending).admission.memories, []);
  assert.equal(ok(await f.core.capture(request)).duplicate, true);
  const g = fixture(t, { extract: () => ({ items: [item([99])] }) });
  error(await g.core.capture(request), 'invalid_model_output');
});
