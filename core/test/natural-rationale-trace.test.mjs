import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runDecisionEvolutionCore } from '../../evaluation/decision-evolution/core-runner.mjs';
import { observeRelate, projectRelateCalls, sourceObservation } from '../../evaluation/decision-evolution/natural-rationale-trace.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';

const fixture = JSON.parse(readFileSync(new URL('../../evaluation/decision-evolution/fixture.json', import.meta.url)));
const only = id => ({ ...fixture, cases: [structuredClone(fixture.cases.find(item => item.id === id))] });
const run = (source, makeModel = () => rationaleModel(), options = {}) => runDecisionEvolutionCore({
  fixture: source, modelFactory: makeModel, naturalRationaleTrace: true, ...options,
});

test('observer keeps frozen-model binding, invalid return and rejection identity; projected reports detach', async () => {
  const calls = []; const problem = new Error('private');
  const invalid = { edges: [{ unsafe: () => {} }] };
  const model = Object.freeze({ marker: 'original', relate(request) {
    assert.equal(this, model);
    if (request.fail) return Promise.reject(problem);
    return invalid;
  } });
  const wrapped = observeRelate(model, calls);
  assert.equal(wrapped.relate({ input: { memories: [] } }), invalid);
  assert.equal(calls[0].status, 'returned');
  assert.equal(calls[0].proposedEdges, null);
  await assert.rejects(wrapped.relate({ input: { memories: [] }, fail: true }), error => error === problem);
  assert.equal(calls[1].status, 'rejected');
  const snapshot = projectRelateCalls(calls, [], []);
  calls[0].status = 'changed-later';
  assert.equal(snapshot[0].status, 'returned');
  let finish;
  const delayed = observeRelate({ relate: () => new Promise(resolve => { finish = resolve; }) }, calls);
  const pending = delayed.relate({ input: { memories: [] } });
  const before = projectRelateCalls(calls.slice(-1), [], []);
  assert.equal(before[0].status, 'called');
  finish({ edges: [] }); await pending;
  assert.equal(before[0].status, 'called');
  assert.deepEqual(before[0].proposedEdges, null);
});

test('raw observation states do not silently equate source, candidate, proposal and storage', async () => {
  const source = only('dev-vendor-transition-en');
  source.cases[0].events = source.cases[0].events.slice(0, 1);
  const empty = (await run(source, () => ({ ...rationaleModel(), extract: () => ({ items: [] }) }))).cases[0];
  assert.equal(empty.captures[0].naturalRationale.observation, 'admission-absent');
  const admission = { memories: [{ id: 'memory' }] };
  const receipts = [{ sourceId: 'd1', receiptId: 'receipt', memoryId: 'memory', excerpt: 'source' }];
  assert.equal(sourceObservation('d1', admission, [], [], { edges: [] }), 'source-absent');
  assert.equal(sourceObservation('d1', admission, receipts, [], { edges: [] }), 'not-candidate');
  const seen = [{ status: 'returned', candidates: [{ index: 0, receipts: [{ index: 0,
    provenance: { status: 'matched', sourceId: 'd1', memoryId: 'memory', receiptId: 'receipt' } }] }], proposedEdges: [] }];
  assert.equal(sourceObservation('d1', admission, receipts, seen, { edges: [] }), 'candidate-seen-no-proposal');
  seen[0].proposedEdges = [{ from: 0, to: 0, fromReceipt: 0, toReceipt: 0,
    relation: 'supports-decision' }];
  assert.equal(sourceObservation('d1', admission, receipts, seen, { edges: [] }),
    'candidate-seen-proposal-not-stored');
  assert.equal(sourceObservation('d1', admission, receipts, seen, { edges: [{ from: 'memory', to: 'memory',
    fromReceipt: 'receipt', toReceipt: 'receipt', relation: 'supports-decision' }] }),
    'stored-model-proposed');
  assert.equal(sourceObservation('d1', admission, receipts, seen, { edges: [{ from: 'memory', to: 'memory',
    fromReceipt: 'receipt', toReceipt: 'other', relation: 'supports-decision' }] }),
  'candidate-seen-proposal-not-stored');
});

test('NR1 opt-in uses actual automatic source-bound path while default stays unchanged', async () => {
  const source = only('dev-vendor-transition-en');
  const plain = (await runDecisionEvolutionCore({ fixture: source, modelFactory: () => rationaleModel() })).cases[0];
  assert.equal(Object.hasOwn(plain.captures[0], 'naturalRationale'), false);
  assert.equal(Object.hasOwn(plain.captures[0].admission, 'rationale'), false);
  const observed = (await run(source)).cases[0];
  assert.equal(observed.captures.length, source.cases[0].events.length);
  assert.equal(observed.captures[0].naturalRationale.captureRationale.status, 'reviewed');
  assert.equal(observed.captures[0].naturalRationale.relateCalls.length, 1);
  assert.equal(observed.captures[0].naturalRationale.relateCalls[0].status, 'returned');
  assert.ok(observed.captures[0].naturalRationale.relateCalls[0].candidates[0].receipts[0].excerpt
    .includes('[Event d1'));
  assert.equal(observed.captures[0].naturalRationale.relateCalls[0].candidates[0].receipts[0]
    .provenance.sourceId, 'd1');
  assert.equal(JSON.stringify(observed).includes('rubric'), false);
});

test('NR2 actual candidate window reports truncation beyond six without completeness claim', async () => {
  const source = only('dev-vendor-transition-en');
  source.cases[0].events = Array.from({ length: 9 }, (_, i) => ({ id: `w${i}`, actor: 'Maya',
    occurredAt: '2026-01-01', ingestedAt: '2026-01-01', text: `I chose A offline reason ${i}.` }));
  const item = (await run(source)).cases[0];
  assert.equal(item.captures.length, 9);
  assert.ok(item.captures.some(capture => capture.naturalRationale.captureRationale.discovery.candidatesTruncated));
  assert.ok(item.captures.every(capture => capture.naturalRationale.relateCalls.every(call =>
    call.candidates.length <= 6)));
  assert.equal(item.incompleteCapture, false);
});

test('NR3 callback failure is distinct from saved admission and proposal absence', async () => {
  const source = only('dev-vendor-transition-en');
  source.cases[0].events = source.cases[0].events.slice(0, 1);
  const item = (await run(source, () => ({ ...rationaleModel(), relate() { throw new Error('private model body'); } }))).cases[0];
  const capture = item.captures[0];
  assert.equal(capture.status, 'ok');
  assert.equal(capture.naturalRationale.captureRationale.status, 'failed');
  assert.equal(capture.naturalRationale.relateCalls[0].status, 'threw');
  assert.equal(capture.naturalRationale.relateCalls[0].proposedEdges, null);
  assert.equal(capture.naturalRationale.afterCapture.edges.length, 0);
  assert.equal(JSON.stringify(capture).includes('private model body'), false);
  assert.ok(capture.admission.memories.length);
});

test('malformed null proposal stays a core rationale failure, not a runner exception', async () => {
  const source = only('dev-vendor-transition-en');
  source.cases[0].events = source.cases[0].events.slice(0, 1);
  const item = (await run(source, () => ({ ...rationaleModel(), relate: () => ({ edges: [null] }) }))).cases[0];
  const capture = item.captures[0];
  assert.equal(capture.status, 'ok');
  assert.equal(capture.naturalRationale.captureRationale.status, 'failed');
  assert.equal(capture.naturalRationale.relateCalls[0].status, 'returned');
  assert.deepEqual(capture.naturalRationale.relateCalls[0].proposedEdges, [null]);
  assert.equal(capture.naturalRationale.observation, 'candidate-seen-no-proposal');
  assert.equal(capture.naturalRationale.afterCapture.edges.length, 0);
});

test('NR4 identical retained excerpts are ambiguous, not assigned an event identity', async () => {
  const source = only('dev-vendor-transition-en');
  source.cases[0].events = source.cases[0].events.slice(0, 1);
  const item = (await run(source, () => ({ ...rationaleModel(), extract() { return { items: [
    { content: 'I chose A offline.', kind: 'decision', confidence: 0.8, sourceIndices: [0] },
    { content: 'Offline use matters.', kind: 'context', confidence: 0.8, sourceIndices: [0] },
  ] }; } }))).cases[0];
  const observed = item.captures[0].naturalRationale;
  assert.equal(item.sourceReceipts.length, 2);
  assert.ok(observed.relateCalls.some(call => call.candidates.some(candidate => candidate.receipts.some(receipt =>
    receipt.provenance.status === 'ambiguous'))));
  assert.equal(observed.observation, 'candidate-ambiguous');
});

test('NR5 proposed links survive later filing and cold reopen as separate lifecycle reads', async () => {
  const source = only('dev-vendor-transition-en');
  source.cases[0].events = [
    { id: 'a', actor: 'Maya', occurredAt: '2026-01-01', ingestedAt: '2026-01-01',
      text: 'I chose A because it supports offline work.' },
    { id: 'b', actor: 'Maya', occurredAt: '2026-01-02', ingestedAt: '2026-01-02',
      text: 'I checked: A cannot work offline.' },
  ];
  const item = (await run(source, () => ({ ...rationaleModel(), relate({ input }) {
    const decision = input.memories.find(memory => memory.receipts.some(receipt =>
      receipt.excerpt.includes('I chose A because')));
    const challenge = input.memories.find(memory => memory.receipts.some(receipt =>
      receipt.excerpt.includes('A cannot work offline')));
    if (!decision) return { edges: [] };
    const edge = (from, to, relation) => ({ from, to, relation, fromReceipt: 0, toReceipt: 0 });
    return { edges: [edge(decision.index, decision.index, 'supports-decision'),
      ...(challenge ? [edge(challenge.index, decision.index, 'challenges-premise')] : [])] };
  } }), { coldReopen: true,
    beforeColdReopen({ core, namespace, captures }) {
      const ref = captures[0].classification.memoryRevisions[0];
      const mapped = core.map({ namespace, purpose: 'classification' });
      assert.equal(mapped.ok, true);
      const placed = core.applyPlacement({ namespace, proposal: { items: [{ memoryId: ref.memoryId,
        parentIds: [], newL1: { title: 'Refiling', parentL2Ids: [] } }] },
      expectedMemoryRevisions: [ref], expectedIndexRevision: mapped.value.indexRevision });
      assert.equal(placed.ok, true, JSON.stringify(placed));
    } })).cases[0];
  const second = item.captures[1].naturalRationale;
  assert.equal(second.observation, 'stored-model-proposed');
  assert.ok(second.afterCapture.edges.some(edge => edge.relation === 'challenges-premise'));
  assert.deepEqual(second.afterColdReopen.edges, second.afterCapture.edges);
  assert.equal(second.afterColdReopen.status, 'ok');
  assert.ok(second.afterCapture.edges.every(edge => edge.interpretationStatus === 'model-proposed'));
});
