import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../contract.mjs';
import { qualificationInput } from '../claim-qualification-input.mjs';
import { qualifyExtractedItems } from '../automatic-qualification.mjs';
import { createQualificationCandidateSnapshot, compileQualificationCandidates } from '../qualification-candidates.mjs';

const fields = ['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'];
const source = 'Temporary exception: use paragraphs, then return to lists 🚋.';
const receipt = (excerpt = source) => ({ client: 'synthetic', sessionId: 'session', eventId: 'source', role: 'user', excerpt });
const item = () => ({ content: source, kind: 'preference', confidence: 0.8, receipts: [receipt()] });
const entry = (itemIndex = 0, candidateIndex = 0) => ({ itemIndex,
  ...Object.fromEntries(fields.map((field) => [field, { value: field === 'attribution' ? 'direct' : field === 'commitment' ? 'considered' : 'Known',
    evidenceIndices: [candidateIndex] }])) });
const output = (value = entry()) => ({ qualifications: [value] });
const invalid = (value, snapshot) => assert.throws(() => compileQualificationCandidates(value, snapshot), { code: 'invalid_model_output' });
const ok = (result) => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };

test('N1 regression: v2 compiles fullwidth descriptive comma without changing source anchors', () => {
  const snapshot = createQualificationCandidateSnapshot([item()]); const value = entry();
  value.value.value = 'paragraphs，then lists';
  const compiled = compileQualificationCandidates(output(value), snapshot)[0].qualification;
  assert.equal(compiled.value, 'paragraphs,then lists');
  assert.equal(compiled.anchors[0].text, source);
});

test('N1 all five descriptive labels normalize compatibility text, preserve null/astral and never mutate inputs', () => {
  const snapshot = createQualificationCandidateSnapshot([item()]); const before = structuredClone(snapshot);
  for (const raw of ['Ａ，Ｂ', 'ﬁancée', '𝒜 option', 'one\u00a0two', '🚋 option', null]) {
    const value = entry(); for (const field of fields.slice(0, 5)) value[field].value = raw;
    const providerOutput = output(value); const untouched = structuredClone(providerOutput);
    const compiled = compileQualificationCandidates(providerOutput, snapshot)[0].qualification;
    for (const field of fields.slice(0, 5)) assert.equal(field === 'value' ? compiled.value : compiled.slot[field], raw?.normalize('NFKC') ?? null);
    assert.deepEqual(compiled.anchors, [{ receiptIndex: 0, start: 0, end: source.length, text: source, fields }]);
    assert.deepEqual(providerOutput, untouched); assert.deepEqual(snapshot, before);
  }
});

test('N2 raw and expanded UTF16 limits reject without truncation, including compatibility contractions', () => {
  const snapshot = createQualificationCandidateSnapshot([item()]);
  for (const field of fields.slice(0, 5)) {
    const maximum = ['scope', 'applies'].includes(field) ? 120 : 160;
    for (const raw of ['Ａ'.repeat(maximum), '🚋'.repeat(maximum / 2)]) {
      const value = entry(); value[field].value = raw; compileQualificationCandidates(output(value), snapshot);
    }
    // Mathematical styled A contracts from two UTF16 units to one, but raw bound still applies.
    for (const raw of ['a'.repeat(maximum + 1), '𝒜'.repeat(maximum / 2 + 1), 'a'.repeat(maximum - 1) + 'ﬁ', 'bad\ud800', '\udc00', 4, undefined]) {
      const value = entry(); value[field].value = raw; invalid(output(value), snapshot);
    }
  }
});

test('N2 whitespace and secrets remain rejection cases, not trim/collapse/redact repairs', () => {
  const snapshot = createQualificationCandidateSnapshot([item()]);
  for (const raw of ['', ' Ａ', 'Ａ ', 'a  b', 'a\tb', 'a\nb', '\u00a0A', 'A\u00a0', 'a\u00a0\u00a0b', 'sk-' + 'a'.repeat(48)]) {
    const value = entry(); value.value.value = raw; const before = structuredClone(value);
    invalid(output(value), snapshot); assert.deepEqual(value, before);
  }
});

test('N3 enum, source coverage and fifth anchor failures cannot be normalized into acceptance', () => {
  const snapshot = createQualificationCandidateSnapshot([item(), item()]);
  const good = { qualifications: [entry(0, 0), entry(1, 1)] };
  for (const [field, patch] of [['attribution', { value: 'ｄｉｒｅｃｔ', evidenceIndices: [0] }],
    ['commitment', { value: ' considered ', evidenceIndices: [0] }], ['value', { value: 'Ａ', evidenceIndices: [] }],
    ['value', { value: 'Ａ', evidenceIndices: [1] }], ['value', { value: 'Ａ', evidenceIndices: [99] }]]) {
    const bad = structuredClone(good); bad.qualifications[0][field] = patch; invalid(bad, snapshot);
  }
  const long = createQualificationCandidateSnapshot([{ ...item(), receipts: [receipt('a'.repeat(800)), { ...receipt('b'), eventId: 'second' }] }]);
  const value = entry(); value.subject.evidenceIndices = [0, 1, 2, 3]; value.value = { value: 'Ａ', evidenceIndices: [4] };
  invalid(output(value), long);
});

test('N3 manual S1 and automatic v1 still reject noncanonical labels', async () => {
  const snapshot = createQualificationCandidateSnapshot([item()]);
  const qualification = compileQualificationCandidates(output(), snapshot)[0].qualification;
  qualification.value = 'paragraphs，then lists';
  assert.throws(() => qualificationInput(qualification, item().receipts), { code: 'invalid_input' });
  await assert.rejects(qualifyExtractedItems({ countTokens: () => 1, contextWindow: 8192,
    qualify: () => ({ qualifications: [{ itemIndex: 0, qualification }] }) }, [item()]), { code: 'invalid_model_output' });
});

const namespace = { ownerId: 'canonical-label-tests', scope: 'personal', projectId: null };
const captureInput = (messages = [{ id: 'source', role: 'user', content: source }]) => ({ namespace, client: 'synthetic', sessionId: 'session',
  eventId: 'batch', messages, causal: { streamId: 'stream', sequence: 1 } });
function fixture(t, laterInvalid = false) {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-label-canonicalization-')), 'memory.sqlite'); const calls = []; const raw = [];
  const model = { countTokens: () => 1, contextWindow: 8192,
    extract: ({ input }) => { calls.push('extract'); return { items: input.messages.map(message => ({ content: message.content, kind: 'preference',
      confidence: 0.8, sourceIndices: [message.index] })) }; },
    qualifyCandidates: ({ input }) => { calls.push('qualifyCandidates'); const result = { qualifications: input.items.map((item, index) => {
      const value = entry(item.itemIndex, item.candidates[0].candidateIndex); value.value.value = index && laterInvalid ? ' bad ' : 'paragraphs，then lists'; return value;
    }) }; raw.push(structuredClone(result)); return result; },
    reconcile: () => assert.fail('Normalization must not grant identity or retirement') };
  const core = openMemoryCore({ path, model, captureQualification: 'source-bound-v2' }); const db = new DatabaseSync(path); let closed = false;
  const close = () => { if (!closed) { core.close(); db.close(); closed = true; } }; t.after(close);
  return { core, db, path, calls, raw, close };
}

test('N4 actual capture stores canonical labels, cold inspection/replay needs no calls or identity writes', async (t) => {
  const f = fixture(t); const result = ok(await f.core.capture(captureInput())); const id = result.admission.memories[0].id;
  const saved = ok(f.core.get({ namespace, memoryId: id, includeQualification: true }));
  assert.equal(saved.qualification.value, 'paragraphs,then lists'); assert.equal(saved.qualification.anchors[0].text, source);
  assert.equal(saved.memory.state, 'active');
  assert.deepEqual(result.reconciliation, { status: 'unresolved', reason: 'qualification_requires_identity', retiredCount: 0 });
  for (const table of ['qualified_slots', 'qualified_claim_bindings']) assert.equal(f.db.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0);
  assert.deepEqual(f.calls, ['extract', 'qualifyCandidates']); assert.equal(f.raw[0].qualifications[0].value.value, 'paragraphs，then lists');
  f.close(); const cold = openMemoryCore({ path: f.path, captureQualification: 'source-bound-v2' }); t.after(() => cold.close());
  assert.deepEqual(ok(cold.get({ namespace, memoryId: id, includeQualification: true })), saved);
  assert.equal(ok(await cold.capture(captureInput())).duplicate, true); assert.deepEqual(f.calls, ['extract', 'qualifyCandidates']);
});

test('N4 later invalid member prevents admission of earlier successfully canonicalized member', async (t) => {
  const f = fixture(t, true); const result = await f.core.capture(captureInput([{ id: 'one', role: 'user', content: source },
    { id: 'two', role: 'user', content: 'A second synthetic memory.' }]));
  assert.equal(result.ok, false); assert.equal(result.error.code, 'invalid_model_output');
  for (const table of ['memories', 'receipts', 'memory_qualifications', 'qualification_anchors', 'qualified_slots', 'qualified_claim_bindings'])
    assert.equal(f.db.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0);
});
