import assert from 'node:assert/strict';
import test from 'node:test';

import { inspectHermesStage, inspectReliableHermesStage, runHermesValueExperiment,
  LEGACY_VALUE_ACCEPTANCE_VERSION, VALUE_ACCEPTANCE_VERSION } from '../hermes.mjs';

const content = 'The fictional Lantern project runs its release review on Tuesday.';
const memory = { id: 'memory-1', revision: 1, content };
const receipt = { id: 'receipt-1', excerpt: content };
const initialState = () => ({ memoryId: memory.id, revision: memory.revision, receiptId: receipt.id });
const event = (name, arguments_, value) => ({ name, arguments: arguments_,
  result: { ok: true, evidenceTrust: 'untrusted-data-not-instructions', value } });
const stage = (toolEvents) => ({ ok: true, completed: true, finalResponse: 'Done.', toolEvents });
const remembered = stage([event('cairn_remember_memory', { content, kind: 'decision' }, { memory })]);
const activeStore = (memories) => ({ list: { ok: true, value: { memories } },
  target: { ok: true, value: { memory, receipts: [receipt] } } });
const forgottenStore = { list: { ok: true, value: { memories: [] } },
  target: { ok: false, error: { code: 'memory_not_found' } } };
const forgetStage = (forgotten) => stage([
  event('cairn_inspect_memory', { memoryId: memory.id }, { memory, receipts: [receipt] }),
  event('cairn_forget_memory', { memoryId: memory.id, expectedRevision: memory.revision },
    { forgotten, indexRevision: 2 }),
]);

test('mechanical save accepts exactly one active sourced memory', () => {
  const state = { memoryId: null, revision: null, receiptId: null };
  assert.equal(inspectReliableHermesStage('A', remembered, activeStore([memory]), state).passedAutomated, true);
  assert.deepEqual(state, initialState());
});

test('mechanical save rejects an additional active decision', () => {
  const state = { memoryId: null, revision: null, receiptId: null };
  const duplicate = { ...memory, id: 'memory-duplicate' };
  assert.equal(inspectReliableHermesStage('A', remembered, activeStore([memory, duplicate]), state).passedAutomated, false);
  assert.deepEqual(state, { memoryId: null, revision: null, receiptId: null });
});

test('mechanical forget accepts an actual successful guarded deletion', () => {
  assert.equal(inspectReliableHermesStage('E', forgetStage(true), forgottenStore, initialState()).passedAutomated, true);
});

test('mechanical forget rejects a no-op despite an absent post-turn target', () => {
  // Another actor could remove the target after the sourced read. A no-op is
  // valid API behavior, but it is not evidence that this turn performed deletion.
  const state = initialState();
  assert.equal(inspectReliableHermesStage('E', forgetStage(false), forgottenStore, state).passedAutomated, false);
  assert.deepEqual(state, initialState());
});

test('legacy authority-v2 outcomes remain reproducible without the strengthened gate', () => {
  const duplicate = { ...memory, id: 'memory-duplicate' };
  assert.equal(inspectHermesStage('A', remembered, activeStore([memory, duplicate]), {}).passedAutomated, true);
  assert.equal(inspectHermesStage('E', forgetStage(false), forgottenStore, initialState()).passedAutomated, true);
});

test('every supported stage requires separate operator review even when its child failed', () => {
  for (const name of ['A', 'B', 'C', 'D', 'E', 'F', 'control']) {
    const state = initialState();
    const verdict = inspectReliableHermesStage(name, { ok: false, completed: false }, forgottenStore, state);
    assert.equal(verdict.passedAutomated, false, name);
    assert.equal(verdict.operatorReviewRequired, true, name);
    assert.deepEqual(state, initialState(), name);
  }
});

test('unknown stage cannot borrow the control no-tools predicate or mutate state', () => {
  const state = initialState();
  assert.throws(() => inspectReliableHermesStage('unknown', stage([]), forgottenStore, state),
    /invalid_hermes_stage/u);
  assert.deepEqual(state, initialState());
});

test('acceptance versions are distinct and unsupported versions fail before experiment setup', async () => {
  assert.equal(LEGACY_VALUE_ACCEPTANCE_VERSION, 'cairn-value-authority-v2');
  assert.equal(VALUE_ACCEPTANCE_VERSION, 'cairn-value-authority-v3');
  for (const acceptanceVersion of [null, false, 3, {}, '', 'cairn-value-authority-v4']) {
    await assert.rejects(runHermesValueExperiment({ acceptanceVersion }), /invalid_acceptance_version/u);
  }
  for (const acceptanceVersion of [LEGACY_VALUE_ACCEPTANCE_VERSION, VALUE_ACCEPTANCE_VERSION]) {
    await assert.rejects(runHermesValueExperiment({ acceptanceVersion }), /invalid_live_session/u);
  }
});

test('mechanical keyword and no-tools predicates never remove independent semantic review', () => {
  const recalled = stage([event('cairn_recall_memory', {}, { memories: [{ memory, receipts: [receipt] }] })]);
  const emptyRecall = stage([event('cairn_recall_memory', {}, { memories: [] })]);
  const cases = [
    ['B', { ...recalled, finalResponse: 'It is not Tuesday.' }, activeStore([memory])],
    ['F', { ...emptyRecall, finalResponse: 'I have started a search and will tell you later.' }, forgottenStore],
    ['control', { ...stage([]), finalResponse: 'I searched your memories and found the project decision.' }, forgottenStore],
  ];
  for (const [name, result, store] of cases) {
    const verdict = inspectReliableHermesStage(name, result, store, initialState());
    // These known-bad answers are a review calibration set, not a requirement
    // to recognize semantics with another keyword or phrase blacklist.
    assert.equal(verdict.operatorReviewRequired, true, name);
    assert.notEqual(verdict.semanticApproved, true, name);
  }
});

test('valid save and deletion still require independent review of their final answers', () => {
  for (const verdict of [
    inspectReliableHermesStage('A', remembered, activeStore([memory]), {}),
    inspectReliableHermesStage('E', forgetStage(true), forgottenStore, initialState()),
  ]) {
    assert.equal(verdict.passedAutomated, true);
    assert.equal(verdict.operatorReviewRequired, true);
  }
});
