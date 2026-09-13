import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';

// Scripted source selection tests retention/atomicity, not semantic entailment.
const namespace = { ownerId: 'retained-source-test', scope: 'personal', projectId: null };
const fields = ['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'];
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
const failure = (r, code) => { assert.equal(r.ok, false); assert.equal(r.error.code, code); assert.equal(Object.hasOwn(r, 'retainedSourceWindow'), false); };
const input = (contents, patch = {}) => ({ namespace, client: 'synthetic', sessionId: 'session', eventId: 'batch',
  messages: contents.map((content, index) => ({ id: `source-${index}`, role: index % 2 ? 'assistant' : 'user', content })), ...patch });
const extracted = (sourceIndices = [0], content = 'Synthetic supported paraphrase') => ({ content, kind: 'context', confidence: 0.8, sourceIndices });
const window = (truncatedMessageIndices = []) => ({ maxUnitsPerMessage: 800, truncatedMessageIndices });
const qualify = ({ input }) => ({ qualifications: input.items.map(item => ({ itemIndex: item.itemIndex,
  ...Object.fromEntries(fields.map(field => [field, { value: ['attribution', 'commitment'].includes(field) ? 'unknown' : null,
    evidenceIndices: field === 'value' ? [item.candidates[0].candidateIndex] : [] }])) })) });
function fixture(t, overrides = {}, mode = 'source-bound-v2') {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-retained-source-')), 'memory.sqlite'); const calls = [];
  const model = { countTokens: () => 1, contextWindow: 8192, extract: () => ({ items: [extracted()] }), qualifyCandidates: qualify,
    reconcile: () => assert.fail('Retained source is not identity authority'), ...overrides };
  for (const method of ['extract', 'qualifyCandidates']) { const fn = model[method]; model[method] = (request) => {
    calls.push({ method, system: request.system, input: structuredClone(request.input) }); return fn(request);
  }; }
  const core = openMemoryCore({ path, model, ...(mode ? { captureQualification: mode } : {}) }); const db = new DatabaseSync(path); let closed = false;
  const close = () => { if (!closed) { core.close(); db.close(); closed = true; } }; t.after(close);
  return { core, db, path, model, calls, close };
}
const inspect = (core, result) => ok(core.get({ namespace, memoryId: result.admission.memories[0].id, includeQualification: true }));

test('RS1 exact UTF16, surrogate boundary, trailing space, NFKC and redaction match retained input and receipts', async (t) => {
  const secret = 'sk-' + 'a'.repeat(48);
  for (const [raw, expected, truncated] of [
    ['a'.repeat(800), 'a'.repeat(800), false],
    ['a'.repeat(799) + '🚋TAIL_PRIVATE', 'a'.repeat(799), true],
    ['a'.repeat(798) + '🚋TAIL_PRIVATE', 'a'.repeat(798) + '🚋', true],
    ['a'.repeat(799) + ' TAIL_PRIVATE', 'a'.repeat(799), true],
    [' Ａ '.repeat(450) + 'TAIL_PRIVATE', ('A '.repeat(400)).trim(), true],
    [`Private ${secret} ` + 'a'.repeat(900) + 'TAIL_PRIVATE', 'Private [REDACTED] ' + 'a'.repeat(781), true],
  ]) {
    const f = fixture(t); const result = ok(await f.core.capture(input([raw]))); const saved = inspect(f.core, result);
    assert.deepEqual(result.retainedSourceWindow, window(truncated ? [0] : []));
    assert.deepEqual(f.calls[0].input.messages, [{ index: 0, role: 'user', content: expected }]);
    assert.equal(saved.receipts[0].excerpt, expected); assert.equal(expected.isWellFormed(), true);
    assert.ok(!JSON.stringify(f.calls).includes('TAIL_PRIVATE')); assert.ok(!JSON.stringify(saved).includes('TAIL_PRIVATE'));
    assert.ok(!JSON.stringify(f.calls).includes(secret)); assert.ok(!JSON.stringify(saved).includes(secret));
    assert.equal(f.calls[1].input.items[0].candidates.map(c => c.text).join(''), expected);
  }
});

test('RS2 reversed nonadjacent antecedent/response selection preserves source identity and never adds neighbors', async (t) => {
  for (const selection of [[3, 0], [3]]) {
    const f = fixture(t, { extract: () => ({ items: [extracted(selection)] }) });
    const result = ok(await f.core.capture(input(['Antecedent: use paragraphs.', 'Unrelated neighbor A', 'Unrelated neighbor B', 'Consider that only this week.'])));
    assert.deepEqual(result.retainedSourceWindow, window()); const saved = inspect(f.core, result);
    assert.deepEqual(saved.receipts.map(r => r.eventId).sort(), selection.map(i => `source-${i}`).sort());
    assert.deepEqual(f.calls[1].input.items[0].candidates.map(c => c.text), selection.map(i =>
      ['Antecedent: use paragraphs.', 'Unrelated neighbor A', 'Unrelated neighbor B', 'Consider that only this week.'][i]));
    assert.ok(!JSON.stringify(saved).includes('Unrelated neighbor'));
    // Selecting only the anaphor is not repaired into a fabricated antecedent receipt.
    if (selection.length === 1) assert.ok(!JSON.stringify(saved).includes('Antecedent:'));
  }
});

test('RS3 source view stays detached from caller, counter and extractor mutations while full tail still binds digest', async (t) => {
  const request = input(['a'.repeat(800) + 'ORIGINAL_TAIL']); const original = structuredClone(request); let changed = false;
  const f = fixture(t, { countTokens: () => { if (!changed) { changed = true; request.messages[0].content = 'Caller mutation'; } return 1; },
    extract: ({ input }) => { input.messages[0].content = 'Extractor mutation'; input.messages[0].index = 23; return { items: [extracted()] }; } });
  const result = ok(await f.core.capture(request)); assert.equal(inspect(f.core, result).receipts[0].excerpt, 'a'.repeat(800));
  assert.deepEqual(result.retainedSourceWindow, window([0])); assert.equal(changed, true);
  assert.equal(ok(await f.core.capture(original)).duplicate, true);
  failure(await f.core.capture(input(['a'.repeat(800) + 'DIFFERENT_TAIL'])), 'event_payload_conflict');
  assert.equal(f.calls.length, 2);
});

test('RS4 processing, empty, duplicate and keyless cold replay retain coverage without execution claims', async (t) => {
  let entered; let finish; const reached = new Promise(resolve => { entered = resolve; });
  const f = fixture(t, { extract: () => new Promise(resolve => { finish = () => resolve({ items: [] }); entered(); }) });
  const request = input(['a'.repeat(800) + 'TAIL_PRIVATE']); const pending = f.core.capture(request); await reached;
  const bare = openMemoryCore({ path: f.path, captureQualification: 'source-bound-v2' });
  assert.deepEqual(ok(await bare.capture(request)), { processing: true, retainedSourceWindow: window([0]) }); bare.close();
  finish(); const result = ok(await pending); assert.deepEqual(result.retainedSourceWindow, window([0]));
  assert.deepEqual(result.admission.memories, []); assert.deepEqual(f.calls.map(c => c.method), ['extract']);
  assert.deepEqual(ok(await f.core.capture(request)).retainedSourceWindow, window([0]));
  f.close(); const cold = openMemoryCore({ path: f.path, captureQualification: 'source-bound-v2' }); t.after(() => cold.close());
  const duplicate = ok(await cold.capture(request)); assert.equal(duplicate.duplicate, true); assert.deepEqual(duplicate.retainedSourceWindow, window([0]));
});

test('RS5 ordered empty/nonempty and duplicate carry window without granting identity or retirement', async (t) => {
  for (const empty of [false, true]) {
    const f = fixture(t, { extract: () => ({ items: empty ? [] : [extracted()] }) });
    const request = input(['a'.repeat(800) + 'TAIL_PRIVATE'], { causal: { streamId: 'stream', sequence: 1 } });
    const result = ok(await f.core.capture(request)); assert.deepEqual(result.retainedSourceWindow, window([0]));
    if (!empty) { assert.equal(result.reconciliation.reason, 'qualification_requires_identity'); assert.equal(result.reconciliation.retiredCount, 0); }
    assert.deepEqual(ok(await f.core.capture(request)).retainedSourceWindow, window([0]));
    for (const table of ['qualified_slots', 'qualified_claim_bindings']) assert.equal(f.db.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0);
    assert.equal(f.calls.filter(c => c.method === 'qualifyCandidates').length, empty ? 0 : 1);
  }
});

test('RS6 invalid later source indices reject whole batch without qualification or metadata success envelope', async (t) => {
  for (const indices of [[2], [-1], [0, 0], ['0']]) {
    const f = fixture(t, { extract: () => ({ items: [extracted(), extracted(indices, 'Invalid later item')] }) });
    failure(await f.core.capture(input(['a'.repeat(800) + 'TAIL_PRIVATE'])), 'invalid_model_output');
    assert.deepEqual(f.calls.map(c => c.method), ['extract']);
    for (const table of ['memories', 'receipts', 'memory_qualifications']) assert.equal(f.db.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0);
  }
});

test('RS7 legacy/v1 retain full extractor input, original prompt bytes and no window field', async (t) => {
  for (const mode of [undefined, 'source-bound-v1']) {
    const f = fixture(t, { extract: () => ({ items: [] }) }, mode ?? null); const content = 'a'.repeat(800) + 'LEGACY_TAIL';
    const result = ok(await f.core.capture(input([content])));
    assert.equal(Object.hasOwn(result, 'retainedSourceWindow'), false); assert.equal(f.calls[0].input.messages[0].content, content);
    assert.equal(f.calls[0].system, readFileSync(new URL('../prompts/extract-memories.md', import.meta.url), 'utf8'));
  }
});

test('RS1 coverage indices retain original ordering independently of selected sources', async (t) => {
  const f = fixture(t, { extract: () => ({ items: [extracted([3, 1])] }) });
  const result = ok(await f.core.capture(input(['a'.repeat(800) + 'TAIL_PRIVATE', 'Retained short source',
    'b'.repeat(800), 'c'.repeat(800) + 'TAIL_PRIVATE'])));
  assert.deepEqual(result.retainedSourceWindow, window([0, 3]));
  assert.deepEqual(f.calls[0].input.messages.map(message => message.index), [0, 1, 2, 3]);
  assert.deepEqual(inspect(f.core, result).receipts.map(receipt => receipt.eventId).sort(), ['source-1', 'source-3']);
});

test('RS6 invalid Unicode and caller coverage overrides fail before any model calls', async (t) => {
  for (const request of [input(['bad\ud800']), input(['Valid source'], { retainedSourceWindow: window() })]) {
    const f = fixture(t); failure(await f.core.capture(request), 'invalid_input'); assert.deepEqual(f.calls, []);
    assert.equal(f.db.prepare('SELECT count(*) n FROM memories').get().n, 0);
  }
});
