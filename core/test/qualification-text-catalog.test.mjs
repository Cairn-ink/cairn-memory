import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { createQualificationCandidateSnapshot, qualifyCandidateItems } from '../qualification-candidates.mjs';
import { createQualificationTextCatalog, snapshotQualificationTextCatalog } from '../qualification-text-catalog.mjs';

const receipt = (excerpt, eventId, role = 'user') => ({ client: 'synthetic', sessionId: 'session', eventId, role, excerpt });
const item = (receipts) => ({ content: 'Synthetic claim', kind: 'fact', confidence: 0.8, receipts });
const shaText = () => Array.from({ length: 13 }, (_, n) => createHash('sha256').update(`same-${n}`).digest('hex')).join('').slice(0, 800);
const repeated = () => Array.from({ length: 5 }, (_, i) => item(Array.from({ length: 4 }, (_, r) =>
  receipt(shaText(), `event-${i}-${r}`, r % 2 ? 'assistant' : 'user'))));
const small = () => [item([receipt('Synthetic source text', 'one')])];
const result = (input) => ({ qualifications: input.items.map((entry) => ({ itemIndex: entry.itemIndex,
  subject: { value: null, evidenceIndices: [entry.candidates[0].candidateIndex] },
  property: { value: null, evidenceIndices: [] }, scope: { value: null, evidenceIndices: [] },
  applies: { value: null, evidenceIndices: [] }, value: { value: null, evidenceIndices: [] },
  attribution: { value: 'unknown', evidenceIndices: [] }, commitment: { value: 'unknown', evidenceIndices: [] } })) });

test('first-occurrence dictionary shares bytes only, preserving 80 candidate IDs and 20 receipt event IDs', () => {
  const snapshot = createQualificationCandidateSnapshot(repeated());
  const { catalog, expanded } = createQualificationTextCatalog(snapshot.input);
  assert.equal(snapshot.input.items.flatMap((entry) => entry.candidates).length, 80);
  assert.equal(catalog.texts.length, 4);
  assert.deepEqual(expanded, snapshot.input);
  assert.deepEqual(catalog.items[0].candidates.map((entry) => entry.textIndex), [0, 1, 2, 3, 0, 1, 2, 3,
    0, 1, 2, 3, 0, 1, 2, 3]);
  assert.equal(new Set(snapshot.items.flatMap((entry) => entry.receipts.map((source) => source.eventId))).size, 20);
  assert.ok(Object.isFrozen(catalog.items[0].candidates[0]));
  assert.deepEqual(snapshotQualificationTextCatalog(catalog).expanded, snapshot.input);
});

test('astral boundary can yield 100 candidates without merging a fifth window', () => {
  const boundary = 'a'.repeat(199) + '🚋' + 'b'.repeat(599);
  const source = Array.from({ length: 5 }, (_, i) => item(Array.from({ length: 4 }, (_, r) =>
    receipt(boundary, `astral-${i}-${r}`, r % 2 ? 'assistant' : 'user'))));
  const snapshot = createQualificationCandidateSnapshot(source);
  assert.equal(snapshot.input.items.flatMap((entry) => entry.candidates).length, 100);
  assert.equal(snapshot.input.items[0].candidates.length, 20);
  const { catalog, expanded } = createQualificationTextCatalog(snapshot.input);
  assert.equal(catalog.texts.length, 4);
  assert.deepEqual(expanded, snapshot.input);
});

test('strict catalog rejects repairable and accessor shapes before serialization', () => {
  const base = createQualificationTextCatalog(createQualificationCandidateSnapshot(small()).input).catalog;
  const mutate = [
    (v) => { v.extra = true; }, (v) => { delete v.items[0].kind; },
    (v) => { v.inputMode = 'inline'; }, (v) => { v.texts.push('unused'); },
    (v) => { v.texts.unshift('wrong first use'); }, (v) => { v.texts[0] = '\ud800'; },
    (v) => { v.items = Array(1); }, (v) => { v.items[0].candidates = Array(1); },
    (v) => { v.items[0].candidates[0].textIndex = 9; },
    (v) => { v.items[0].candidates[0].role = 'system'; },
    (v) => { v.items[0].candidates[0].candidateIndex = -1; },
    (v) => { v.items[0].candidates[0].extra = true; },
    (v) => { Object.defineProperty(v.items[0], 'kind', { enumerable: true, get() { throw new Error('getter'); } }); },
    (v) => { Object.defineProperty(v.texts, '0', { enumerable: true, get() { throw new Error('getter'); } }); },
  ];
  for (const change of mutate) {
    const value = structuredClone(base); change(value);
    assert.throws(() => snapshotQualificationTextCatalog(value), /invalid_qualification_text_catalog/);
  }
  const repeatedId = structuredClone(base);
  repeatedId.items[0].candidates.push({ ...repeatedId.items[0].candidates[0] });
  assert.throws(() => snapshotQualificationTextCatalog(repeatedId), /invalid_qualification_text_catalog/);
});

test('legacy no-fit path and inline-fit choice keep one original call', async () => {
  const calls = []; const fitCalls = [];
  const model = { contextWindow: 8192, countTokens: () => 1,
    fitsQualificationRequest(request) { fitCalls.push(request.input); return true; },
    qualifyCandidates(request) { calls.push(request.input); return result(request.input); } };
  await qualifyCandidateItems(model, small());
  assert.equal(fitCalls.length, 1); assert.equal(calls.length, 1);
  assert.equal(Object.hasOwn(calls[0], 'inputMode'), false);
  delete model.fitsQualificationRequest;
  await qualifyCandidateItems(model, small());
  assert.equal(fitCalls.length, 1); assert.equal(calls.length, 2);
  await assert.rejects(qualifyCandidateItems(null, small()), error => error.code === 'model_not_configured');
});

test('catalog-fit uses two local fit checks and still one model invocation', async () => {
  const fits = []; const calls = [];
  const model = { contextWindow: 8192, countTokens: () => 1,
    fitsQualificationRequest(request) { fits.push(request.input); return fits.length === 2; },
    qualifyCandidates(request) { calls.push(request.input); return result(createQualificationTextCatalog(
      createQualificationCandidateSnapshot(small()).input).expanded); } };
  await qualifyCandidateItems(model, small());
  assert.equal(fits.length, 2); assert.equal(calls.length, 1);
  assert.equal(calls[0].inputMode, 'text-catalog-v1');
});

test('fit callback sees a detached request and cannot rewrite authoritative source text', async () => {
  const calls = [];
  const model = { contextWindow: 8192, countTokens: () => 1,
    fitsQualificationRequest(request) {
      request.input.items[0].candidates[0].text = 'forged source';
      request.input.items[0].content = 'forged claim';
      return true;
    },
    qualifyCandidates(request) { calls.push(request.input); return result(request.input); } };
  const admitted = await qualifyCandidateItems(model, small());
  assert.equal(calls[0].items[0].candidates[0].text, 'Synthetic source text');
  assert.equal(admitted[0].qualification.anchors[0].text, 'Synthetic source text');
  assert.equal(admitted[0].content, 'Synthetic claim');
});

test('neither-fit and invalid fit results refuse before model invocation, including cross-realm rejection', async () => {
  const calls = []; const source = small();
  for (const badFit of [() => false, () => undefined, () => Promise.reject(new Error('private')),
    () => runInNewContext('Promise.reject(new Error("private"))'), () => { throw new Error('private'); }]) {
    let checks = 0;
    const model = { contextWindow: 8192, countTokens: () => 1,
      fitsQualificationRequest() { checks++; return badFit(); },
      qualifyCandidates() { calls.push(1); } };
    await assert.rejects(qualifyCandidateItems(model, source), error =>
      error.code === (checks === 2 ? 'context_budget_exceeded' : 'token_count_unavailable'));
  }
  const accessor = { contextWindow: 8192, countTokens: () => 1,
    qualifyCandidates() { calls.push(1); } };
  Object.defineProperty(accessor, 'fitsQualificationRequest', { get() { throw new Error('private'); } });
  await assert.rejects(qualifyCandidateItems(accessor, source), error => error.code === 'token_count_unavailable');
  assert.equal(calls.length, 0);
});

test('pre-dispatch fit failures emit only finite source-free core diagnostics', async () => {
  for (const [fit, code] of [[() => false, 'context_budget_exceeded'],
    [() => Promise.reject(new Error('private source')), 'token_count_unavailable']]) {
    const events = [];
    const model = { contextWindow: 8192, countTokens: () => 1, fitsQualificationRequest: fit,
      onDiagnostic: (event) => events.push(event), qualifyCandidates: () => assert.fail('No dispatch') };
    await assert.rejects(qualifyCandidateItems(model, small()), error => error.code === code);
    assert.deepEqual(events, [{ version: 1, stage: 'qualifyCandidates', layer: 'core_call', reason: code }]);
    assert.equal(JSON.stringify(events).includes('Synthetic source text'), false);
    assert.equal(JSON.stringify(events).includes('private source'), false);
  }
});

test('deadline is rechecked after fit callback before any model invocation', async () => {
  let expired = false; let calls = 0;
  const deadline = { check() { if (expired) throw Object.assign(new Error('model_timeout'), { code: 'model_timeout' }); } };
  const model = { contextWindow: 8192, countTokens: () => 1,
    fitsQualificationRequest() { expired = true; return true; },
    qualifyCandidates() { calls++; } };
  await assert.rejects(qualifyCandidateItems(model, small(), deadline), error => error.code === 'model_timeout');
  assert.equal(calls, 0);
});
