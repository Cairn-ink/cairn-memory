import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import { createOpenAIModel } from '../../../adapters/openai/index.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { packMixedAnswer } from '../mixed-answer.mjs';
import { ingestIndexedEvidenceLongMemEvalCase } from '../ingestion.mjs';
import { prepareMixedSourceCase } from '../mixed-source.mjs';
import { locateMixedSource, locateMixedSourceFamily,
  observedMixedCairnModel } from '../mixed-source-observation.mjs';
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

test('S5 actual capture retains one indexed window on two distinct cards; v1 is ambiguous',
  { skip: !supportsSqlite && 'node:sqlite requires Node >=22.16' }, async t => {
  const { openMemoryCore } = await import('../../../core/contract.mjs');
  const workspace = createTestWorkspace(t, { prefix: 'cairn-shared-source-' });
  const row = sourceRow('shared-source-real-capture');
  const plan = prepareMixedSourceCase(row, 'indexed-evidence-v1');
  let actualRankRequest;
  const original = { contextWindow: 8192, countTokens: () => 1,
    extract: () => ({ items: [
      { content: 'First distinct interpretation', kind: 'context',
        confidence: 0.8, sourceIndices: [0] },
      { content: 'Second distinct interpretation', kind: 'context',
        confidence: 0.8, sourceIndices: [0] },
    ] }),
    classify: ({ input }) => ({ items: input.memories.map(memory =>
      ({ memoryId: memory.id, parentIds: [] })) }),
    select: async () => ({ refs: [] }),
    rank: async (request) => { actualRankRequest = request; return { refs:
      request.input.candidates.slice(0, 1).map(candidate => ({
      namespaceIndex: candidate.namespaceIndex, memoryId: candidate.memory.id,
      revision: candidate.memory.revision })) }; } };
  const observed = observedMixedCairnModel(original);
  const core = openMemoryCore({ path: join(workspace.path, 'store.sqlite'), model: observed.model,
    captureSourcePolicy: 'indexed-evidence-v1', sourceCandidatePolicy: 'bounded-keyset-v1' });
  workspace.defer(() => core.close());
  const ingested = await ingestIndexedEvidenceLongMemEvalCase({ history: plan.renderedHistory,
    namespace: row.namespace, capture: input => core.capture(input) });
  const admitted = ingested.outcomes[0].result.admission.memories;
  assert.equal(ingested.outcomes[0].status, 'completed');
  assert.equal(admitted.length, 2);
  assert.equal(new Set(admitted.map(item => item.id)).size, 2);
  const window = plan.cairnPlan.batches[0].indexedWindows[0];
  for (const member of admitted) {
    const read = core.get({ namespace: row.namespace, memoryId: member.id, receiptLimit: 100 });
    assert.equal(read.ok, true);
    assert.ok(read.value.receipts.some(receipt => receipt.eventId === window.id
      && receipt.excerpt === window.content));
  }
  const located = locateMixedSource({ core, namespace: row.namespace, plan, ingested,
    probe: { batchIndex: 0, windowIndex: 0, routingCue: 'Synthetic memory fact.' } });
  assert.equal(located.report.reason, 'ambiguous_source');
  let reads = 0;
  const reader = { get(input) { reads++; assert.equal(input.receiptLimit, 100);
    assert.equal(Object.hasOwn(input, 'receiptCursor'), false); return core.get(input); } };
  const family = locateMixedSourceFamily({ core: reader, namespace: row.namespace, plan, ingested,
    probe: { batchIndex: 0, windowIndex: 0, routingCue: 'Synthetic memory fact.' } });
  assert.ok(family.trace);
  assert.equal(reads, 2);
  const recalled = await observed.recall(family.trace, core, { readSet: [row.namespace],
    query: 'Synthetic memory fact.', limit: 6, contextMode: 'source-evidence',
    selectionMode: 'bounded-source-scan' });
  assert.equal(recalled.ok, true, recalled.error?.code);
  const packed = packMixedAnswer({ question: { text: row.question.text,
    date: plan.canonicalQuestionDate }, units: recalled.value.memories.map(item =>
    ({ text: item.receipts.map(receipt => receipt.excerpt).join('\n') })),
  countTokens: () => 1 });
  const report = family.finish({ recall: recalled, packed });
  assert.equal(reads, 4);
  assert.equal(report.status, 'observed');
  assert.deepEqual(report.counts, { batchMembers: 2, carriers: 2,
    observed: 2, unavailable: 0, beforeReads: 2, afterReads: 2 });
  assert.deepEqual(report.carriers.map(item => item.localOrdinal), [0, 1]);
  assert.deepEqual(report.carriers.map(item => item.trace.final.ref).sort(), ['no', 'yes']);
  assert.equal(report.anyCompleteCarrierPath, 'yes');
  const publicText = JSON.stringify(report);
  assert.ok(Buffer.byteLength(publicText) <= 32 * 1024);
  for (const member of admitted) assert.equal(publicText.includes(member.id), false);
  assert.equal(publicText.includes(window.content), false);
  assert.ok(actualRankRequest?.signal instanceof AbortSignal);

  const guarded = [];
  for (const enabled of [false, true]) {
    const wire = [];
    const fake = fakeMixedHttp((url, _body, options) => {
      wire.push({ path: new URL(url).pathname, method: options.method,
        body: options.body });
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
          const parityFamily = locateMixedSourceFamily({ core, namespace: row.namespace,
            plan, ingested, probe: { batchIndex: 0, windowIndex: 0,
              routingCue: 'Synthetic memory fact.' } });
          assert.ok(parityFamily.trace);
          const observer = observedMixedCairnModel(adapter);
          const output = await observer.recall(parityFamily.trace, { recall: () =>
            observer.model.rank(actualRankRequest) });
          const traceReport = parityFamily.finish({ recall: recalled, packed });
          assert.equal(traceReport.status, 'observed');
          assert.deepEqual(traceReport.carriers.map(item => item.trace.counts.rankCalls), [1, 1]);
          return output;
        } finally { await transport.drain(); }
      });
      assert.equal(result.status, 'completed');
      guarded.push({ wire, output: result.value, attempts: fixture.guard.attempts().map(item =>
        [item.stage, item.outcome, item.reservedMicroUsd, item.actualMicroUsd]) });
    } finally { fixture.guard.close(); }
  }
  assert.deepEqual(guarded[1], guarded[0],
    'v2 must preserve exact guarded provider bytes, result and accounting');

  const repeated = locateMixedSourceFamily({ core, namespace: row.namespace, plan, ingested,
    probe: { batchIndex: 0, windowIndex: 0, routingCue: 'Synthetic memory fact.' } });
  const repeatedSettle = repeated.trace.beginRank(actualRankRequest);
  const rankOutput = { refs: actualRankRequest.input.candidates.slice(0, 1)
    .map(candidate => ({ namespaceIndex: candidate.namespaceIndex,
      memoryId: candidate.memory.id, revision: candidate.memory.revision })) };
  repeatedSettle(rankOutput);
  repeatedSettle(rankOutput);
  const repeatedReport = repeated.finish({ recall: recalled, packed });
  assert.equal(repeatedReport.status, 'unavailable');
  assert.equal(repeatedReport.anyCompleteCarrierPath, 'unavailable');
  const lateSettle = repeated.trace.beginRank(actualRankRequest);
  lateSettle(rankOutput);
  assert.equal(repeated.finish({ recall: recalled, packed }).reason, 'already_finished');

  const three = structuredClone(ingested);
  const thirdId = 'synthetic-unrelated-admission';
  three.outcomes[0].result.admission.memories.push({ id: thirdId, revision: 1 });
  for (const change of ['none', 'nonmatch-incomplete-after', 'foreign-before',
    'receipt-drift-after', 'revision-drift-after', 'over-limit-before']) {
    let memberReads = 0;
    const withNonmatch = locateMixedSourceFamily({ core: { get(input) {
      memberReads++;
      const result = structuredClone(core.get({ namespace: row.namespace,
        memoryId: input.memoryId === thirdId ? admitted[0].id : input.memoryId,
        receiptLimit: 100 }));
      if (input.memoryId === thirdId) {
        result.value.memory.id = thirdId;
        for (const receipt of result.value.receipts) {
          receipt.id += '-unrelated';
          receipt.excerpt = 'Unrelated complete synthetic receipt';
        }
      }
      if (change === 'nonmatch-incomplete-after' && memberReads === 6) {
        result.value.exhausted = false;
      }
      if (change === 'foreign-before' && memberReads === 3) {
        result.value.memory.namespace.ownerId = 'foreign-owner';
      }
      if (change === 'receipt-drift-after' && memberReads === 6) {
        result.value.receipts[0].excerpt = 'Changed unrelated receipt';
      }
      if (change === 'revision-drift-after' && memberReads === 6) {
        result.value.memory.revision++;
      }
      if (change === 'over-limit-before' && memberReads === 3) {
        result.value.memory.receiptCount = 101;
      }
      return result;
    } }, namespace: row.namespace, plan, ingested: three,
    probe: { batchIndex: 0, windowIndex: 0, routingCue: 'Synthetic memory fact.' } });
    assert.equal(memberReads, 3, change);
    const withNonmatchReport = withNonmatch.finish({ recall: recalled, packed });
    assert.equal(memberReads, 6, change);
    assert.equal(withNonmatchReport.counts.batchMembers, 3);
    assert.equal(withNonmatchReport.counts.beforeReads, 3);
    assert.equal(withNonmatchReport.counts.afterReads, 3);
    if (change === 'none') {
      assert.equal(withNonmatchReport.status, 'observed');
      assert.equal(withNonmatchReport.counts.carriers, 2);
      assert.equal(withNonmatchReport.anyCompleteCarrierPath, 'unavailable',
        'missing callbacks remain unknown even when final evidence includes one carrier');
    } else {
      assert.equal(withNonmatchReport.status, 'unavailable', change);
      assert.equal(withNonmatchReport.anyCompleteCarrierPath, 'unavailable', change);
    }
  }

  const six = structuredClone(three);
  six.outcomes[0].result.admission.memories.push(...[3, 4, 5].map(index =>
    ({ id: `extra-member-${index}`, revision: 1 })));
  let overReads = 0;
  const oversized = locateMixedSourceFamily({ core: { get() { overReads++;
    assert.fail('oversized admission must not read'); } }, namespace: row.namespace,
  plan, ingested: six,
  probe: { batchIndex: 0, windowIndex: 0, routingCue: 'Synthetic memory fact.' } });
  assert.equal(overReads, 0);
  assert.equal(oversized.report.status, 'unavailable');
  const five = structuredClone(six);
  five.outcomes[0].result.admission.memories.pop();
  let fiveReads = 0;
  const boundedFive = locateMixedSourceFamily({ core: { get(input) {
    fiveReads++;
    assert.equal(input.receiptLimit, 100);
    assert.equal(Object.hasOwn(input, 'receiptCursor'), false);
    const result = structuredClone(core.get({ namespace: row.namespace,
      memoryId: admitted.some(item => item.id === input.memoryId)
        ? input.memoryId : admitted[0].id, receiptLimit: 100 }));
    if (!admitted.some(item => item.id === input.memoryId)) {
      result.value.memory.id = input.memoryId;
      for (const receipt of result.value.receipts) {
        receipt.id += `-${input.memoryId}`;
        receipt.excerpt = 'Unrelated bounded member';
      }
    }
    return result;
  } }, namespace: row.namespace, plan, ingested: five,
  probe: { batchIndex: 0, windowIndex: 0, routingCue: 'Synthetic memory fact.' } });
  assert.equal(fiveReads, 5);
  const fiveReport = boundedFive.finish({ recall: recalled, packed });
  assert.equal(fiveReads, 10);
  assert.equal(fiveReport.counts.batchMembers, 5);
  assert.equal(fiveReport.counts.carriers, 2);
  const allFive = locateMixedSourceFamily({ core: { get(input) {
    const result = structuredClone(core.get({ namespace: row.namespace,
      memoryId: admitted.some(item => item.id === input.memoryId)
        ? input.memoryId : admitted[0].id, receiptLimit: 100 }));
    if (!admitted.some(item => item.id === input.memoryId)) {
      result.value.memory.id = input.memoryId;
      for (const receipt of result.value.receipts) receipt.id += `-${input.memoryId}`;
    }
    return result;
  } }, namespace: row.namespace, plan, ingested: five,
  probe: { batchIndex: 0, windowIndex: 0, routingCue: 'Synthetic memory fact.' } });
  const allFiveReport = allFive.finish({ recall: recalled, packed });
  assert.equal(allFiveReport.counts.carriers, 5);
  assert.deepEqual(allFiveReport.carriers.map(item => item.localOrdinal), [0, 1, 2, 3, 4]);
  assert.ok(Buffer.byteLength(JSON.stringify(allFiveReport)) <= 32 * 1024);

  const hostile = structuredClone(ingested);
  const hostileMembers = hostile.outcomes[0].result.admission.memories;
  let traps = 0;
  Object.defineProperty(hostileMembers, 'map', { get() { traps++; throw new Error('map trap'); } });
  Object.defineProperty(hostileMembers, Symbol.iterator, {
    get() { traps++; throw new Error('iterator trap'); } });
  const safe = locateMixedSourceFamily({ core: reader, namespace: row.namespace,
    plan, ingested: hostile,
    probe: { batchIndex: 0, windowIndex: 0, routingCue: 'Synthetic memory fact.' } });
  assert.ok(safe.trace);
  assert.equal(traps, 0);
  safe.finish({ recall: recalled, packed });
  Object.defineProperty(hostileMembers, '0', { get() {
    traps++; throw new Error('index trap');
  }, configurable: true, enumerable: true });
  const denied = locateMixedSourceFamily({ core: reader, namespace: row.namespace,
    plan, ingested: hostile,
    probe: { batchIndex: 0, windowIndex: 0, routingCue: 'Synthetic memory fact.' } });
  assert.equal(denied.report.status, 'unavailable');
  assert.equal(traps, 0);

  let mixedReads = 0;
  const mixed = locateMixedSourceFamily({ core: { get(input) {
    mixedReads++;
    const result = structuredClone(core.get(input));
    if (input.memoryId === admitted[1].id) result.value.exhausted = false;
    return result;
  } }, namespace: row.namespace, plan, ingested,
  probe: { batchIndex: 0, windowIndex: 0, routingCue: 'Synthetic memory fact.' } });
  assert.equal(mixedReads, 2, 'a bad second member does not stop finite family reads');
  assert.equal(mixed.trace, null);
  assert.equal(mixed.report, null);
  const mixedReport = mixed.finish({ recall: recalled, packed });
  assert.equal(mixedReads, 4);
  assert.equal(mixedReport.status, 'unavailable');
  assert.equal(mixedReport.counts.carriers, null,
    'an invalid member must not prove that only zero carriers exist');
  assert.equal(mixedReport.anyCompleteCarrierPath, 'unavailable');

  const duplicate = locateMixedSourceFamily({ core: { get(input) {
    const result = structuredClone(core.get(input));
    if (input.memoryId === admitted[0].id) {
      result.value.receipts.push({ ...result.value.receipts[0], id: 'distinct-receipt-id' });
      result.value.memory.receiptCount++;
    }
    return result;
  } }, namespace: row.namespace, plan, ingested,
  probe: { batchIndex: 0, windowIndex: 0, routingCue: 'Synthetic memory fact.' } });
  assert.equal(duplicate.finish({ recall: recalled, packed }).status, 'unavailable');

  const wrongIdentity = locateMixedSourceFamily({ core: { get(input) {
    const result = structuredClone(core.get(input));
    for (const receipt of result.value.receipts) receipt.eventId = 'different-event';
    return result;
  } }, namespace: row.namespace, plan, ingested,
  probe: { batchIndex: 0, windowIndex: 0, routingCue: 'Synthetic memory fact.' } });
  const wrongReport = wrongIdentity.finish({ recall: recalled, packed });
  assert.equal(wrongReport.reason, 'not_observed_in_batch',
    'same excerpt with a different event is no carrier');
  assert.equal(wrongReport.counts.carriers, 0,
    'complete family with no exact binding establishes zero carriers');
});

test('S5 shared-source traces use actual model-selected callbacks without joining carriers',
  { skip: !supportsSqlite && 'node:sqlite requires Node >=22.16' }, async t => {
  const { openMemoryCore } = await import('../../../core/contract.mjs');
  const workspace = createTestWorkspace(t, { prefix: 'cairn-shared-select-' });
  const row = sourceRow('shared-source-model-selected');
  for (let index = 1; index <= 13; index++) row.history.sessions.push({
    session_index: index, session_id: `lme-session-${String(index).padStart(64, 'd')}`,
    date: `2024/01/01 (Mon) 09:${String(index).padStart(2, '0')}`,
    turns: [{ turn_id: `lme-turn-${String(index).padStart(64, 'e')}`,
      role: 'user', content: `Distractor source ${index}.` }],
  });
  const plan = prepareMixedSourceCase(row, 'indexed-evidence-v1');
  let extracts = 0, selectCalls = 0, selectedFromVisible = null, selectLimit = 1;
  const original = { contextWindow: 8192, countTokens: () => 1,
    extract: () => ({ items: (extracts++ === 0
      ? ['Shared card A', 'Shared card B'] : ['Unrelated card']).map((content, index) => ({
        content: `${content} ${extracts} ${index}`, kind: 'context',
        confidence: 0.8, sourceIndices: [0] })) }),
    classify: ({ input }) => ({ items: input.memories.map(memory =>
      ({ memoryId: memory.id, parentIds: [] })) }),
    select: async ({ input }) => { selectCalls++;
      const visible = input.maps.flatMap(map => map.items.flatMap(item => {
        const ref = item.type === 'unfiled' ? item.ref : item.type === 'ref'
          && item.ref.childType === 'memory' ? { memoryId: item.ref.childId,
            revision: item.ref.childRevision } : null;
        return ref && item.label.includes('Synthetic memory fact.')
          ? [{ namespaceIndex: map.namespaceIndex,
          ...ref }] : [];
      })).slice(0, selectLimit);
      if (visible.length) selectedFromVisible = visible[0].memoryId;
      return { refs: visible }; },
    rank: async ({ input }) => ({ refs: input.candidates.map(candidate => ({
      namespaceIndex: candidate.namespaceIndex, memoryId: candidate.memory.id,
      revision: candidate.memory.revision })) }) };
  const observed = observedMixedCairnModel(original);
  const core = openMemoryCore({ path: join(workspace.path, 'store.sqlite'), model: observed.model,
    captureSourcePolicy: 'indexed-evidence-v1', sourceCandidatePolicy: 'bounded-keyset-v1' });
  workspace.defer(() => core.close());
  const ingested = await ingestIndexedEvidenceLongMemEvalCase({ history: plan.renderedHistory,
    namespace: row.namespace, capture: input => core.capture(input) });
  assert.ok(ingested.outcomes.every(outcome => outcome.status === 'completed'));
  assert.equal(ingested.outcomes[0].result.admission.memories.length, 2);
  assert.ok(ingested.outcomes.reduce((sum, outcome) => sum
    + outcome.result.admission.memories.length, 0) > 12);
  const family = locateMixedSourceFamily({ core, namespace: row.namespace, plan, ingested,
    probe: { batchIndex: 0, windowIndex: 0, routingCue: 'Synthetic memory fact.' } });
  const recalled = await observed.recall(family.trace, core, { readSet: [row.namespace],
    query: 'Synthetic memory fact.', limit: 6, contextMode: 'source-evidence',
    selectionMode: 'bounded-source-scan' });
  assert.equal(recalled.ok, true, recalled.error?.code);
  const packed = packMixedAnswer({ question: { text: row.question.text,
    date: plan.canonicalQuestionDate }, units: recalled.value.memories.map(item =>
    ({ text: item.receipts.map(receipt => receipt.excerpt).join('\n') })),
  countTokens: () => 1 });
  const report = family.finish({ recall: recalled, packed });
  assert.ok(selectCalls > 0);
  assert.ok(ingested.outcomes[0].result.admission.memories.some(item =>
    item.id === selectedFromVisible));
  assert.equal(recalled.value.selection.strategy, 'model-selected');
  const selectedOrdinal = ingested.outcomes[0].result.admission.memories.findIndex(item =>
    item.id === selectedFromVisible);
  assert.deepEqual(report.carriers.map(item => item.trace.selection.accepted),
    [0, 1].map(index => index === selectedOrdinal ? 'yes' : 'no'));
  assert.deepEqual(report.carriers.map(item => item.trace.final.ref),
    [0, 1].map(index => index === selectedOrdinal ? 'yes' : 'no'));
  assert.equal(report.anyCompleteCarrierPath, 'yes');
  for (const [count, expected] of [[2, 'yes'], [0, 'no']]) {
    selectLimit = count;
    const next = locateMixedSourceFamily({ core, namespace: row.namespace, plan, ingested,
      probe: { batchIndex: 0, windowIndex: 0, routingCue: 'Synthetic memory fact.' } });
    const nextRecall = await observed.recall(next.trace, core, { readSet: [row.namespace],
      query: 'Synthetic memory fact.', limit: 6, contextMode: 'source-evidence',
      selectionMode: 'bounded-source-scan' });
    assert.equal(nextRecall.ok, true, nextRecall.error?.code);
    const nextPack = packMixedAnswer({ question: { text: row.question.text,
      date: plan.canonicalQuestionDate }, units: nextRecall.value.memories.map(item =>
      ({ text: item.receipts.map(receipt => receipt.excerpt).join('\n') })),
    countTokens: () => 1 });
    const nextReport = next.finish({ recall: nextRecall, packed: nextPack });
    assert.equal(nextRecall.value.selection.strategy, 'model-selected');
    assert.deepEqual(nextReport.carriers.map(item => item.trace.final.ref).sort(),
      [count ? 'yes' : 'no', count === 2 ? 'yes' : 'no'].sort());
    assert.equal(nextReport.anyCompleteCarrierPath, expected);
  }
  selectLimit = 1;
  const unknown = locateMixedSourceFamily({ core, namespace: row.namespace, plan, ingested,
    probe: { batchIndex: 0, windowIndex: 0, routingCue: 'Synthetic memory fact.' } });
  const unknownRecall = await observed.recall(unknown.trace, core, { readSet: [row.namespace],
    query: 'Synthetic memory fact.', limit: 6, contextMode: 'source-evidence',
    selectionMode: 'bounded-source-scan' });
  assert.equal(unknownRecall.ok, true);
  const unknownReport = unknown.finish({ recall: unknownRecall, packed: null });
  assert.equal(unknownReport.status, 'observed');
  assert.deepEqual(unknownReport.carriers.map(item => item.trace.firstObservedGap).sort(),
    ['selected', 'unavailable']);
  assert.equal(unknownReport.anyCompleteCarrierPath, 'unavailable',
    'one concrete gap and one missing answer pack do not establish no complete path');
});

test('S2 current public revisions distinguish correction, historical retirement and forgetting',
  { skip: !supportsSqlite && 'node:sqlite requires Node >=22.16' }, async t => {
  const { openMemoryCore } = await import('../../../core/contract.mjs');
  for (const action of ['correct', 'historical', 'forget']) {
    const workspace = createTestWorkspace(t, { prefix: `cairn-shared-${action}-` });
    const row = sourceRow(`shared-${action}`);
    const plan = prepareMixedSourceCase(row, 'indexed-evidence-v1');
    const model = { contextWindow: 8192, countTokens: () => 1,
      extract: () => ({ items: ['First card', 'Second card'].map(content => ({
        content, kind: 'context', confidence: 0.8, sourceIndices: [0] })) }),
      classify: ({ input }) => ({ items: input.memories.map(memory =>
        ({ memoryId: memory.id, parentIds: [] })) }),
      select: async () => ({ refs: [] }), rank: async () => ({ refs: [] }) };
    const core = openMemoryCore({ path: join(workspace.path, 'store.sqlite'), model,
      captureSourcePolicy: 'indexed-evidence-v1', sourceCandidatePolicy: 'bounded-keyset-v1' });
    workspace.defer(() => core.close());
    const ingested = await ingestIndexedEvidenceLongMemEvalCase({ history: plan.renderedHistory,
      namespace: row.namespace, capture: input => core.capture(input) });
    const member = ingested.outcomes[0].result.admission.memories[0];
    const before = core.get({ namespace: row.namespace, memoryId: member.id,
      receiptLimit: 100 });
    assert.equal(before.ok, true);
    assert.equal(before.value.memory.state, 'active');
    const family = locateMixedSourceFamily({ core, namespace: row.namespace, plan, ingested,
      probe: { batchIndex: 0, windowIndex: 0, routingCue: 'Synthetic memory fact.' } });
    assert.ok(family.trace);
    const operation = { namespace: row.namespace, memoryId: member.id,
      expectedRevision: before.value.memory.revision };
    const receipt = { client: 'synthetic', sessionId: 'synthetic-session',
      eventId: `event-${action}`, role: 'user', excerpt: `Evidence ${action}` };
    const changed = action === 'correct'
      ? core.correct({ ...operation, content: 'Corrected card', kind: 'fact', receipt })
      : action === 'historical'
        ? core.supersede({ ...operation, replacement: { content: 'Replacement card',
          kind: 'fact' }, receipts: [receipt] })
        : core.forget(operation);
    assert.equal(changed.ok, true, JSON.stringify(changed));
    const later = core.get({ namespace: row.namespace, memoryId: member.id,
      receiptLimit: 100 });
    if (action === 'historical') {
      assert.equal(later.ok, true);
      assert.equal(later.value.memory.state, 'historical');
    } else if (action === 'forget') {
      assert.equal(later.ok, false);
      assert.equal(later.error.code, 'memory_not_found');
    } else {
      assert.equal(later.ok, true);
      assert.ok(later.value.memory.revision > before.value.memory.revision);
    }
    const report = family.finish({ recall: null, packed: null });
    assert.equal(report.status, 'unavailable', action);
    assert.equal(report.anyCompleteCarrierPath, 'unavailable', action);
    assert.equal(report.counts.beforeReads, 2, action);
    assert.equal(report.counts.afterReads, 2, action);
  }
});
