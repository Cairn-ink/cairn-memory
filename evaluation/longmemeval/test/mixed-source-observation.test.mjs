import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import { createOpenAIModel } from '../../../adapters/openai/index.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { packMixedAnswer } from '../mixed-answer.mjs';
import { ingestIndexedEvidenceLongMemEvalCase } from '../ingestion.mjs';
import { prepareMixedSourceCase } from '../mixed-source.mjs';
import { locateMixedSource, observedMixedCairnModel } from '../mixed-source-observation.mjs';
import { trackedTransport } from '../mixed-transport.mjs';
import { fakeMixedHttp, sourceRow, syntheticMixedFixture } from '../testing/mixed-fixture.mjs';

const [major, minor] = process.versions.node.split('.').map(Number);
const supportsSqlite = major > 22 || major === 22 && minor >= 16;

test('P2/P3 designated fresh capture is traced through actual core recall and pack',
  { skip: !supportsSqlite && 'node:sqlite requires Node >=22.16' }, async t => {
  const { openMemoryCore } = await import('../../../core/contract.mjs');
  const workspace = createTestWorkspace(t, { prefix: 'cairn-mixed-observation-' });
  const row = sourceRow();
  const plan = prepareMixedSourceCase(row, 'indexed-evidence-v1');
  const probe = { batchIndex: 0, windowIndex: 0, routingCue: 'Synthetic memory fact.' };
  let actualRankRequest;
  const original = {
    contextWindow: 8192, countTokens: () => 1,
    extract: ({ input }) => ({ items: [{ content: 'Generic generated interpretation',
      kind: 'context', confidence: 0.8, sourceIndices: [0] }] }),
    classify: ({ input }) => ({ items: input.memories.map(memory =>
      ({ memoryId: memory.id, parentIds: [] })) }),
    select: async ({ input }) => ({ refs: input.maps.flatMap(map => map.items.flatMap(item =>
      item.type === 'unfiled' ? [{ namespaceIndex: map.namespaceIndex, ...item.ref }] : [])) }),
    rank: async (request) => {
      actualRankRequest = request;
      return { refs: request.input.candidates.map(candidate => ({
        namespaceIndex: candidate.namespaceIndex, memoryId: candidate.memory.id,
        revision: candidate.memory.revision })) };
    },
  };
  const observed = observedMixedCairnModel(original);
  const core = openMemoryCore({ path: join(workspace.path, 'store.sqlite'),
    model: observed.model, captureSourcePolicy: 'indexed-evidence-v1',
    sourceCandidatePolicy: 'bounded-keyset-v1' });
  workspace.defer(() => core.close());
  const ingested = await ingestIndexedEvidenceLongMemEvalCase({ history: plan.renderedHistory,
    namespace: row.namespace, capture: input => core.capture(input) });
  assert.equal(ingested.outcomes[0].status, 'completed');
  let addedReads = 0;
  const reader = { get(input) { addedReads++; return core.get(input); } };
  const located = locateMixedSource({ core: reader, namespace: row.namespace,
    plan, ingested, probe });
  assert.ok(located.trace);
  assert.equal(addedReads, 1);
  const recalled = await observed.recall(located.trace, core, { readSet: [row.namespace],
    query: probe.routingCue, limit: 6, contextMode: 'source-evidence',
    selectionMode: 'bounded-source-scan' });
  assert.equal(recalled.ok, true, recalled.error?.code);
  const window = plan.cairnPlan.batches[0].indexedWindows[0];
  assert.ok(recalled.value.memories.some(item => item.receipts.some(receipt =>
    receipt.excerpt === window.content)));
  const packed = packMixedAnswer({ question: { text: row.question.text,
    date: plan.canonicalQuestionDate }, units: recalled.value.memories.map(item =>
    ({ text: item.receipts.map(receipt => receipt.excerpt).join('\n') })),
  countTokens: () => 1 });
  const report = located.trace.finish({ recall: recalled, packed,
    after: reader.get({ namespace: row.namespace, memoryId: located.memoryId,
      receiptLimit: 100 }) });
  assert.equal(addedReads, 2);
  assert.equal(report.status, 'observed');
  assert.equal(report.source.currentSourceBinding, 'yes');
  assert.equal(report.rank.inputSourceBinding, 'yes');
  assert.equal(report.answer.textPresent, 'yes');
  assert.equal(report.firstObservedGap, null);
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes(window.content), false);
  assert.equal(serialized.includes(located.memoryId), false);
  assert.ok(actualRankRequest?.signal instanceof AbortSignal);

  const wires = [];
  for (const enabled of [false, true]) {
    const wire = [];
    const fake = fakeMixedHttp((_url, _body, options) => {
      wire.push({ path: new URL(_url).pathname, method: options.method, body: options.body });
      return undefined;
    }, { cairnMemory: true });
    const fixture = syntheticMixedFixture(t, { artifact: { sourceTreeSha256: '1'.repeat(64),
      dependencyLockSha256: '2'.repeat(64) },
    configuration: { configurationSha256: '3'.repeat(64), configuration: {} },
    sourceCases: [sourceRow()], armOrders: [['cairn', 'mem0']],
    comparisonProfile: 'indexed-evidence-v1', fetchImpl: fake.fetchImpl });
    try {
      const identity = { phase: 'generation', caseId: fixture.prepared.roster[0].arms
        .find(arm => arm.name === 'cairn').scopeId };
      const result = await fixture.guard.withCaseScope(identity, async () => {
        const transport = trackedTransport();
        try {
          const adapter = createOpenAIModel({ apiKey: 'synthetic-only',
            fetchImpl: transport.track(fixture.guard.cairnFetch) });
          if (!enabled) return adapter.rank(actualRankRequest);
          const parityLocation = locateMixedSource({ core, namespace: row.namespace,
            plan, ingested, probe });
          assert.ok(parityLocation.trace);
          const observation = observedMixedCairnModel(adapter);
          const output = await observation.recall(parityLocation.trace, { recall: () =>
            observation.model.rank(actualRankRequest) });
          const traceReport = parityLocation.trace.finish({ recall: recalled, packed,
            after: core.get({ namespace: row.namespace, memoryId: parityLocation.memoryId,
              receiptLimit: 100 }) });
          assert.equal(traceReport.status, 'observed');
          assert.equal(traceReport.counts.rankCalls, 1);
          assert.equal(traceReport.rank.inputSourceBinding, 'yes');
          assert.equal(traceReport.rank.proposal, 'yes');
          return output;
        } finally { await transport.drain(); }
      });
      assert.equal(result.status, 'completed');
      wires.push({ wire, output: result.value, attempts: fixture.guard.attempts().map(item =>
        [item.stage, item.outcome, item.reservedMicroUsd, item.actualMicroUsd]) });
    } finally { fixture.guard.close(); }
  }
  assert.deepEqual(wires[1], wires[0],
    'the same real-core rank request must produce byte-identical guarded adapter calls');

  const missing = locateMixedSource({ core: { get(input) {
    const result = core.get(input);
    const copy = structuredClone(result);
    copy.value.receipts = copy.value.receipts.map(receipt => ({ ...receipt,
      excerpt: 'Different canonical excerpt' }));
    return copy;
  } }, namespace: row.namespace, plan, ingested, probe });
  assert.equal(missing.report.reason, 'not_observed_in_batch');
  const incomplete = locateMixedSource({ core: { get(input) {
    return core.get({ ...input, receiptLimit: 0 });
  } }, namespace: row.namespace, plan, ingested, probe });
  assert.equal(incomplete.report.status, 'unavailable');
  assert.equal(incomplete.report.firstObservedGap, 'unavailable');
  const oldAdmission = structuredClone(ingested);
  oldAdmission.outcomes[0].result.admission.memories[0].revision += 1;
  assert.ok(locateMixedSource({ core, namespace: row.namespace,
    plan, ingested: oldAdmission, probe }).trace,
  'current public revision, not the original admission revision, binds the trace');
  const foreign = locateMixedSource({ core: { get(input) {
    const result = structuredClone(core.get(input));
    result.value.memory.namespace.ownerId = 'foreign-synthetic';
    return result;
  } }, namespace: row.namespace, plan, ingested, probe });
  assert.equal(foreign.report.status, 'unavailable');

  const multiple = structuredClone(ingested);
  const secondId = 'synthetic-second-id';
  multiple.outcomes[0].result.admission.memories.push({ id: secondId, revision: 1 });
  let memberReads = 0;
  const secondMember = (input, incompleteSecond = false) => {
    memberReads++;
    const result = structuredClone(core.get({ namespace: row.namespace,
      memoryId: located.memoryId, receiptLimit: 100 }));
    if (input.memoryId === secondId) {
      result.value.memory.id = secondId;
      for (const receipt of result.value.receipts) receipt.id += '-other';
      if (incompleteSecond) result.value.exhausted = false;
    }
    return result;
  };
  const ambiguous = locateMixedSource({ core: { get: secondMember },
    namespace: row.namespace, plan, ingested: multiple, probe });
  assert.equal(memberReads, 2);
  assert.equal(ambiguous.report.reason, 'ambiguous_source');
  memberReads = 0;
  const nonmatchingIncomplete = locateMixedSource({ core: { get: input => {
    const result = secondMember(input, true);
    if (input.memoryId === secondId) {
      result.value.receipts[0].excerpt = 'Different canonical excerpt';
    }
    return result;
  } }, namespace: row.namespace, plan, ingested: multiple, probe });
  assert.equal(memberReads, 2);
  assert.equal(nonmatchingIncomplete.report.status, 'unavailable',
    'a matching first member cannot excuse an incomplete unrelated member');

  // Locator denial/finite-read controls use synthetic public-read projections;
  // they do not claim new product retention or broader store coverage.
  const five = structuredClone(ingested);
  const extraIds = Array.from({ length: 4 }, (_, index) => `synthetic-member-${index}`);
  five.outcomes[0].result.admission.memories.push(...extraIds.map(id => ({ id, revision: 1 })));
  let boundedReads = 0;
  const fiveMemberReader = { get(input) {
    boundedReads++;
    assert.equal(input.receiptLimit, 100);
    assert.equal(Object.hasOwn(input, 'receiptCursor'), false);
    const result = structuredClone(core.get({ namespace: row.namespace,
      memoryId: located.memoryId, receiptLimit: 100 }));
    if (input.memoryId !== located.memoryId) {
      result.value.memory.id = input.memoryId;
      for (const receipt of result.value.receipts) {
        receipt.id += `-${input.memoryId}`;
        receipt.excerpt = 'Unrelated complete synthetic receipt';
      }
    }
    return result;
  } };
  const exactlyFive = locateMixedSource({ core: fiveMemberReader,
    namespace: row.namespace, plan, ingested: five, probe });
  assert.equal(boundedReads, 5);
  assert.ok(exactlyFive.trace, 'five complete members with one exact match remain observable');
  const fiveReport = exactlyFive.trace.finish({ recall: recalled, packed,
    after: core.get({ namespace: row.namespace, memoryId: exactlyFive.memoryId,
      receiptLimit: 100 }) });
  assert.equal(fiveReport.status, 'observed');

  const six = structuredClone(five);
  six.outcomes[0].result.admission.memories.push({ id: 'synthetic-member-five', revision: 1 });
  boundedReads = 0;
  const overMembers = locateMixedSource({ core: fiveMemberReader,
    namespace: row.namespace, plan, ingested: six, probe });
  assert.equal(overMembers.report.status, 'unavailable');
  assert.equal(boundedReads, 0, 'an oversized batch cannot trigger even one get');

  for (const alteration of ['receipt-count-101', 'incomplete-page', 'duplicate-receipt-id']) {
    let reads = 0;
    const denied = locateMixedSource({ core: { get(input) {
      reads++;
      assert.equal(input.receiptLimit, 100);
      assert.equal(Object.hasOwn(input, 'receiptCursor'), false);
      const result = structuredClone(core.get(input));
      if (alteration === 'receipt-count-101') result.value.memory.receiptCount = 101;
      if (alteration === 'incomplete-page') {
        result.value.exhausted = false;
        result.value.nextReceiptCursor = 'synthetic-cursor';
      }
      if (alteration === 'duplicate-receipt-id') {
        result.value.receipts.push({ ...result.value.receipts[0] });
        result.value.memory.receiptCount = 2;
      }
      return result;
    } }, namespace: row.namespace, plan, ingested, probe });
    assert.equal(reads, 1);
    assert.equal(denied.report.status, 'unavailable', alteration);
    assert.equal(denied.report.firstObservedGap, 'unavailable', alteration);
  }
});

test('P4 trusted adapter facade forwards identity and avoids arbitrary thenable traps', async () => {
  const request = Object.freeze({ input: { query: 'synthetic' }, signal: new AbortController().signal });
  const output = { refs: [] };
  const promise = Promise.resolve(output);
  const error = new Error('synthetic rejection');
  const rejected = Promise.reject(error);
  let trapCalls = 0, receivers = [], args = [];
  const thenable = { get then() { trapCalls++; throw new Error('extra then trap'); } };
  const forgedPromise = Object.create(Promise.prototype);
  const ownConstructor = Promise.resolve(output);
  Object.defineProperty(ownConstructor, 'constructor', { get() {
    trapCalls++; throw new Error('extra constructor trap');
  } });
  let selectResult = promise, rankResult = rejected;
  const original = { contextWindow: 8192,
    select(...input) { receivers.push(this); args.push(input); return selectResult; },
    rank(...input) { receivers.push(this); args.push(input); return rankResult; } };
  const observed = observedMixedCairnModel(original);
  let selected = null, settled = null;
  let rankEntries = 0;
  const trace = { beginSelect(input) { selected = input; return outputValue => { settled = outputValue; }; },
    beginRank() { rankEntries++; return () => assert.fail('rejected/hostile output cannot settle'); } };
  const selectedPromise = observed.recall(trace, { recall: () => observed.model.select(request) });
  assert.strictEqual(selectedPromise, promise);
  assert.strictEqual(await selectedPromise, output);
  assert.strictEqual(selected, request);
  assert.strictEqual(settled, output);
  assert.strictEqual(observed.recall(trace, { recall: () => observed.model.rank(request) }), rejected);
  await assert.rejects(rejected, failure => failure === error);
  selectResult = thenable;
  assert.strictEqual(observed.recall(trace, { recall: () => observed.model.select(request) }), thenable);
  selectResult = forgedPromise;
  assert.strictEqual(observed.recall(trace, { recall: () => observed.model.select(request) }), forgedPromise);
  rankResult = ownConstructor;
  assert.strictEqual(observed.recall(trace, { recall: () => observed.model.rank(request) }), ownConstructor);
  assert.equal(rankEntries, 2);
  assert.equal(trapCalls, 0);
  assert.deepEqual(receivers, [original, original, original, original, original]);
  for (const input of args) assert.strictEqual(input[0], request);
});
