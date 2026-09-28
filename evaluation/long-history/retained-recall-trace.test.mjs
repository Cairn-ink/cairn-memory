import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { join } from 'node:path';
import test from 'node:test';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const [major, minor] = process.versions.node.split('.').map(Number);
const supportsSqlite = major > 22 || (major === 22 && minor >= 16);
const namespace = { ownerId: 'long-history-gate', scope: 'personal', projectId: null };
const source = index => `ARCHIVE marker${index} records a blue lantern at dusk.`;
const traceScope = new AsyncLocalStorage();
const value = result => {
  assert.equal(result.ok, true, result.error?.code);
  return result.value;
};
const mapRef = (item, namespaceIndex) => item.type === 'unfiled'
  ? { namespaceIndex, ...item.ref }
  : item.type === 'ref' && item.ref.childType === 'memory'
    ? { namespaceIndex, memoryId: item.ref.childId, revision: item.ref.childRevision } : null;

async function coldCase(t, distractorCount) {
  const { openMemoryCore } = await import('../../core/contract.mjs');
  const { packMixedAnswer } = await import('../longmemeval/mixed-answer.mjs');
  const { createRetainedRecallTrace } = await import('./recall-observation.mjs');
  const workspace = createTestWorkspace(t, { prefix: 'cairn-retained-recall-' });
  const path = join(workspace.path, 'memory.sqlite');
  const frames = { select: [], rank: [], gate: [] };
  const methodCalls = { select: 0, rank: 0 };
  let selectOverride = null;
  let pendingRankOutput = null;
  const model = {
    contextWindow: 8192,
    countTokens() {
      if (pendingRankOutput) {
        pendingRankOutput.refs = [];
        pendingRankOutput = null;
      }
      return 1;
    },
    extract({ input }) {
      return { items: [{ content: input.messages[0].content.startsWith('ARCHIVE')
        ? 'Generic archive interpretation' : input.messages[0].content,
      kind: 'context', confidence: 0.8, sourceIndices: [0] }] };
    },
    classify({ input }) {
      return { items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) };
    },
    select(request) {
      assert.equal(this, model);
      methodCalls.select++;
      if (selectOverride === 'throw') throw new Error('scripted-select-failure');
      const input = request.input;
      frames.select.push(structuredClone(input));
      const query = input.query.toLowerCase();
      const refs = input.maps.flatMap(map => map.items
        .filter(item => item.label?.toLowerCase().includes(query))
        .map(item => mapRef(item, map.namespaceIndex)).filter(Boolean)).slice(0, input.maxRefs);
      const other = input.maps.flatMap(map => map.items
        .filter(item => !item.label?.toLowerCase().includes(query))
        .map(item => mapRef(item, map.namespaceIndex)).filter(Boolean))[0];
      const output = { refs: selectOverride === 'invalid-revision' && refs.length
        ? [{ ...refs[0], revision: refs[0].revision + 1 }]
        : selectOverride === 'foreign-namespace' && refs.length
          ? [{ ...refs[0], namespaceIndex: 1 }]
        : selectOverride === 'unrelated-ranked' && other ? [other] : refs };
      frames.gate.push({ method: 'select', input: structuredClone(input),
        output: structuredClone(output) });
      traceScope.getStore()?.recordSelect(request, output);
      return output;
    },
    rank(request) {
      assert.equal(this, model);
      methodCalls.rank++;
      const input = request.input;
      frames.rank.push(structuredClone(input));
      const query = input.query.toLowerCase();
      const output = { refs: input.candidates.filter(candidate => selectOverride === 'unrelated-ranked'
        || candidate.receipts
        .some(receipt => receipt.excerpt.toLowerCase().includes(query)))
        .slice(0, input.limit).map(candidate => ({ namespaceIndex: candidate.namespaceIndex,
          memoryId: candidate.memory.id, revision: candidate.memory.revision })) };
      frames.gate.push({ method: 'rank', input: structuredClone(input),
        output: structuredClone(output) });
      traceScope.getStore()?.recordRank(request, output);
      if (selectOverride === 'mutate-rank-after-observe') pendingRankOutput = output;
      return output;
    },
  };
  let core = openMemoryCore({ path, model, captureSourcePolicy: 'indexed-evidence-v1',
    sourceCandidatePolicy: 'bounded-keyset-v1' });
  workspace.defer(() => core?.close());
  const capture = async (content, index) => value(await core.capture({ namespace,
    client: 'synthetic', sessionId: 'cold-case', eventId: `event-${index}`,
    messages: [{ id: `message-${index}`, role: 'user', content }] }));
  let target;
  for (let index = 0; index < 5; index++) {
    target = (await capture(source(index), index)).admission.memories[0];
  }
  for (let index = 0; index < distractorCount; index++) {
    await capture(`Unrelated synthetic item ${index}.`, index + 5);
  }
  core.close();
  core = openMemoryCore({ path, model, captureSourcePolicy: 'indexed-evidence-v1',
    sourceCandidatePolicy: 'bounded-keyset-v1' });
  const detail = value(core.get({ namespace, memoryId: target.id }));
  assert.equal(detail.receipts.length, 5);
  // Candidate preview uses receipt-ID order. Choose its fifth receipt through
  // the public read so the probe is stable across random receipt IDs.
  const lastReceipt = detail.receipts.reduce((latest, receipt) =>
    receipt.id > latest.id ? receipt : latest);
  const firstReceipt = detail.receipts.reduce((first, receipt) =>
    receipt.id < first.id ? receipt : first);
  const runFor = async (receipt, { selectionMode = 'bounded-source-scan',
    override = null } = {}) => {
    const marker = receipt.excerpt.match(/marker\d+/u)?.[0];
    assert.ok(marker);
    assert.equal(receipt.role, 'user');
    assert.equal(receipt.excerpt, source(Number(marker.slice('marker'.length))));
    assert.equal(receipt.eventId, `message-${marker.slice('marker'.length)}`);
    for (const list of Object.values(frames)) list.length = 0;
    selectOverride = override;
    const readSet = [namespace];
    const read = () => core.get({ namespace, memoryId: target.id, receiptLimit: 100 });
    const before = read();
    assert.equal(before.ok, true);
    assert.ok(before.value.receipts.some(row => row.client === 'synthetic' &&
      row.sessionId === 'cold-case' && row.eventId === receipt.eventId &&
      row.role === receipt.role && row.excerpt === receipt.excerpt),
    JSON.stringify(before.value.receipts));
    const trace = createRetainedRecallTrace({ sourceProbe: { namespace,
      memoryId: target.id, client: 'synthetic', sessionId: 'cold-case',
      eventId: receipt.eventId, role: receipt.role, excerpt: receipt.excerpt,
      routingCue: marker }, before, readSet });
    let response;
    try {
      response = await traceScope.run(trace, () => core.recall({ readSet, query: marker,
        contextMode: 'source-evidence', limit: 6,
        ...(selectionMode ? { selectionMode } : {}) }));
    } finally { selectOverride = null; pendingRankOutput = null; }
    let packed = null, evidence = null;
    if (response.ok) {
      const units = response.value.memories.map(item => ({ text: item.receipts
        .map(row => row.excerpt).join('\n') }));
      packed = packMixedAnswer({ question: { text: `What did ${marker} record?`, date: '2026-09-29' },
        units, countTokens: () => 1 });
      evidence = JSON.parse(packed.request.messages[1].content).evidence;
    }
    const traceReport = trace.finish({ recall: response, packed, after: read() });
    return { receipt, marker, response, recalled: response.ok ? response.value : null,
      packed, evidence, traceReport, frames: structuredClone(frames) };
  };
  const initial = await runFor(lastReceipt);
  assert.equal(initial.response.ok, true, initial.response.error?.code);
  return { core, target, detail, lastReceipt, firstReceipt, runFor, methodCalls, ...initial };
}

test('complete-map cold recall reaches source and answer pack without a select callback',
  { skip: !supportsSqlite && 'node:sqlite requires Node >=22.16' }, async t => {
  const { observePassage } = await import('./gate.mjs');
  const result = await coldCase(t, 11);
  assert.equal(result.traceReport.status, 'observed', JSON.stringify(result.traceReport));
  assert.equal(result.recalled.selection.strategy, 'complete-map');
  assert.equal(result.frames.select.length, 0);
  assert.equal(result.frames.rank.length, 1);
  assert.ok(result.recalled.memories.some(item => item.receipts
    .some(receipt => receipt.excerpt === result.lastReceipt.excerpt)));
  assert.ok(result.evidence.some(unit => unit.text.includes(result.lastReceipt.excerpt)));
  const stages = observePassage({ trace: result.traceReport,
    packedTokens: result.packed.totalEstimatedTokens });
  assert.equal(stages.stages.retained, true);
  assert.equal(stages.stages.finalReturned, true);
  assert.equal(stages.stages.answerContextPresent, true);
  assert.equal(stages.firstDeliveryFailure, null,
    'the gate misattributes a delivered complete-map source to reference visibility');
  assert.equal(stages.deliverySucceeded, true);
});

test('retained fifth source is absent from actual answer context on the model-selected route',
  { skip: !supportsSqlite && 'node:sqlite requires Node >=22.16' }, async t => {
  const result = await coldCase(t, 12);
  assert.equal(result.recalled.selection.strategy, 'model-selected');
  assert.equal(result.frames.select.length, 1);
  assert.ok(result.frames.select[0].maps.flatMap(map => map.items)
    .some(item => mapRef(item, 0)?.memoryId === result.target.id));
  assert.ok(result.frames.select[0].maps.flatMap(map => map.items)
    .every(item => !item.label?.includes(result.marker)));
  assert.equal(result.frames.rank.length, 0);
  assert.equal(result.recalled.memories.length, 0);
  assert.equal(result.packed.selectedIndices.length, 0);
  assert.equal(result.evidence.some(unit => unit.text.includes(result.lastReceipt.excerpt)), false);
});

test('H1: only changing selection mode adds the select frame for one visible source',
  { skip: !supportsSqlite && 'node:sqlite requires Node >=22.16' }, async t => {
  const { observePassage } = await import('./gate.mjs');
  const fixture = await coldCase(t, 11);
  const complete = await fixture.runFor(fixture.firstReceipt);
  const selected = await fixture.runFor(fixture.firstReceipt, { selectionMode: null });
  assert.equal(complete.recalled.selection.strategy, 'complete-map');
  assert.equal(complete.frames.select.length, 0);
  assert.equal(selected.frames.select.length, 1);
  assert.ok(complete.evidence.some(unit => unit.text.includes(fixture.firstReceipt.excerpt)));
  assert.ok(selected.evidence.some(unit => unit.text.includes(fixture.firstReceipt.excerpt)));
  const observed = observePassage({ trace: selected.traceReport,
    packedTokens: selected.packed.totalEstimatedTokens });
  assert.equal(observed.firstDeliveryFailure, null);
  assert.equal(observed.deliverySucceeded, true);
});

test('H2/H4: the visible receipt reaches rank and pack on the same thirteen-card store',
  { skip: !supportsSqlite && 'node:sqlite requires Node >=22.16' }, async t => {
  const fixture = await coldCase(t, 12);
  assert.equal(fixture.recalled.memories.length, 0);
  const visible = await fixture.runFor(fixture.firstReceipt);
  assert.equal(visible.recalled.selection.strategy, 'model-selected');
  assert.equal(visible.frames.select.length, 1);
  assert.equal(visible.frames.rank.length, 1);
  assert.ok(visible.frames.select[0].maps.flatMap(map => map.items)
    .some(item => item.label?.includes(visible.marker)));
  assert.ok(visible.frames.rank[0].candidates.some(candidate => candidate.receipts
    .some(receipt => receipt.excerpt === fixture.firstReceipt.excerpt)));
  assert.ok(visible.recalled.memories.some(item => item.receipts
    .some(receipt => receipt.excerpt === fixture.firstReceipt.excerpt)));
  assert.ok(visible.evidence.some(unit => unit.text.includes(fixture.firstReceipt.excerpt)));
});

test('H3: a non-visible model proposal is not a validated core selection',
  { skip: !supportsSqlite && 'node:sqlite requires Node >=22.16' }, async t => {
  const { observePassage } = await import('./gate.mjs');
  const fixture = await coldCase(t, 12);
  const valid = await fixture.runFor(fixture.firstReceipt);
  assert.equal(valid.response.ok, true);
  const invalid = await fixture.runFor(fixture.firstReceipt, { override: 'invalid-revision' });
  assert.equal(invalid.response.ok, false);
  assert.equal(invalid.response.error.code, 'invalid_model_output');
  assert.equal(invalid.frames.select.length, 1);
  assert.equal(invalid.frames.rank.length, 0);
  const observed = observePassage({ trace: invalid.traceReport });
  assert.equal(observed.stages.retained, true);
  assert.equal(invalid.traceReport.selection.wrongRevisionProposal, 'yes');
  assert.equal(invalid.traceReport.selection.accepted, 'unavailable');
  assert.equal(observed.stages.selected, 'not-run');
  const foreign = await fixture.runFor(fixture.firstReceipt,
    { override: 'foreign-namespace' });
  assert.equal(foreign.response.ok, false);
  assert.equal(foreign.response.error.code, 'invalid_model_output');
  assert.equal(foreign.traceReport.selection.wrongRevisionProposal, 'no');
  assert.equal(foreign.traceReport.selection.accepted, 'unavailable');
});

test('late scripted output stays in its original gate call context',
  { skip: !supportsSqlite && 'node:sqlite requires Node >=22.16' }, async t => {
  const { createRetainedRecallTrace } = await import('./recall-observation.mjs');
  const { withRecallTrace, recordScriptedRecallStage, scriptedModel } = await import('./gate.mjs');
  const fixture = await coldCase(t, 12);
  const visible = await fixture.runFor(fixture.firstReceipt, { selectionMode: null });
  const receipt = fixture.firstReceipt;
  const read = () => fixture.core.get({ namespace, memoryId: fixture.target.id,
    receiptLimit: 100 });
  const probe = { namespace, memoryId: fixture.target.id, client: 'synthetic',
    sessionId: 'cold-case', eventId: receipt.eventId, role: receipt.role,
    excerpt: receipt.excerpt, routingCue: visible.marker };
  const traceA = createRetainedRecallTrace({ sourceProbe: probe, before: read(),
    readSet: [namespace] });
  const traceB = createRetainedRecallTrace({ sourceProbe: probe, before: read(),
    readSet: [namespace] });
  const metrics = { calls: { extract: 0, classify: 0, select: 0, rank: 0 },
    inputTokens: 0, outputTokens: 0, tokenizerCalls: 0, tokenizerTokens: 0 };
  const model = scriptedModel(metrics);
  const request = { system: 'Synthetic gate call', input: visible.frames.select[0] };
  let releaseA;
  const pendingA = withRecallTrace(traceA, () => new Promise(resolve => {
    releaseA = resolve;
  }).then(() => model.select(request)));
  const outputB = withRecallTrace(traceB, () => {
    const output = model.select(request);
    const endedA = traceA.finish({ recall: visible.response, packed: visible.packed,
      after: read() });
    assert.equal(endedA.status, 'observed');
    releaseA();
    return output;
  });
  const outputA = await pendingA;
  assert.deepEqual(outputA, outputB);
  assert.equal(metrics.calls.select, 2);
  const reportB = traceB.finish({ recall: visible.response, packed: visible.packed,
    after: read() });
  assert.equal(reportB.status, 'observed');
  assert.equal(reportB.counts.selectCalls, 1);
  assert.equal(traceA.finish({ recall: visible.response,
    packed: visible.packed, after: read() }).reason, 'already_finished');
  const returned = { refs: [] };
  assert.strictEqual(recordScriptedRecallStage('select', request, returned), returned);
  assert.equal(metrics.calls.select, 2);
  const sentinel = new Error('synthetic call error');
  assert.throws(() => withRecallTrace(traceB, () => { throw sentinel; }),
    error => error === sentinel);
});

test('target omission is observed even when a different candidate reaches rank',
  { skip: !supportsSqlite && 'node:sqlite requires Node >=22.16' }, async t => {
  const fixture = await coldCase(t, 12);
  const other = await fixture.runFor(fixture.firstReceipt,
    { selectionMode: null, override: 'unrelated-ranked' });
  assert.equal(other.response.ok, true);
  assert.equal(other.frames.select.length, 1);
  assert.equal(other.frames.rank.length, 1);
  assert.ok(other.recalled.memories.length > 0);
  assert.equal(other.traceReport.selection.referenceVisible, 'yes');
  assert.equal(other.traceReport.selection.proposal, 'no');
  assert.equal(other.traceReport.selection.accepted, 'no');
  assert.equal(other.traceReport.firstObservedGap, 'selected');
});

test('counter mutation after rank observation cannot fabricate accepted ranking',
  { skip: !supportsSqlite && 'node:sqlite requires Node >=22.16' }, async t => {
  const fixture = await coldCase(t, 12);
  const selected = await fixture.runFor(fixture.firstReceipt,
    { selectionMode: null, override: 'mutate-rank-after-observe' });
  assert.equal(selected.response.ok, true);
  assert.equal(selected.frames.rank.length, 1);
  assert.equal(selected.frames.rank[0].candidates.length, 1);
  assert.equal(selected.frames.gate.find(frame => frame.method === 'rank').output.refs.length, 1);
  assert.equal(selected.recalled.memories.length, 0);
  assert.equal(selected.traceReport.rank.proposal, 'yes');
  assert.equal(selected.traceReport.rank.accepted, 'unavailable');
  assert.equal(selected.traceReport.final.ref, 'no');
  assert.equal(selected.traceReport.firstObservedGap, 'unavailable');
});

test('actual model throw preserves receiver, public error and call counts',
  { skip: !supportsSqlite && 'node:sqlite requires Node >=22.16' }, async t => {
  const fixture = await coldCase(t, 12);
  const selectBefore = fixture.methodCalls.select;
  const rankBefore = fixture.methodCalls.rank;
  const failed = await fixture.runFor(fixture.firstReceipt,
    { selectionMode: null, override: 'throw' });
  assert.equal(failed.response.ok, false);
  assert.equal(failed.response.error.code, 'recall_failed');
  assert.equal(fixture.methodCalls.select, selectBefore + 1);
  assert.equal(fixture.methodCalls.rank, rankBefore);
  assert.equal(failed.frames.select.length, 0);
  assert.equal(failed.frames.rank.length, 0);
  assert.equal(failed.traceReport.selection.accepted, 'unavailable');
  assert.equal(failed.traceReport.final.status, 'failed');
  assert.equal(JSON.stringify(failed.traceReport).includes('scripted-select-failure'), false);
});

test('source role and final namespace remain distinct from matching text and memory ID',
  { skip: !supportsSqlite && 'node:sqlite requires Node >=22.16' }, async t => {
  const { createRetainedRecallTrace } = await import('./recall-observation.mjs');
  const fixture = await coldCase(t, 11);
  const receipt = fixture.firstReceipt;
  const before = fixture.core.get({ namespace, memoryId: fixture.target.id, receiptLimit: 100 });
  const probe = { namespace, memoryId: fixture.target.id, client: 'synthetic',
    sessionId: 'cold-case', eventId: receipt.eventId, role: receipt.role,
    excerpt: receipt.excerpt, routingCue: receipt.excerpt.match(/marker\d+/u)[0] };
  const wrongRole = createRetainedRecallTrace({ sourceProbe: { ...probe, role: 'assistant' },
    before, readSet: [namespace] });
  const roleReport = wrongRole.finish({ recall: fixture.response,
    packed: fixture.packed, after: before });
  assert.equal(roleReport.status, 'unavailable');
  assert.equal(roleReport.reason, 'source_binding_missing');
  const malformedRead = structuredClone(before);
  const malformedReceipt = malformedRead.value.receipts.find(row =>
    row.client === probe.client && row.sessionId === probe.sessionId &&
    row.eventId === probe.eventId && row.role === probe.role && row.excerpt === probe.excerpt);
  assert.ok(malformedReceipt);
  malformedReceipt.id = 'x'.repeat(201);
  const malformedTrace = createRetainedRecallTrace({ sourceProbe: probe,
    before: malformedRead, readSet: [namespace] });
  const malformedReport = malformedTrace.finish({ recall: fixture.response,
    packed: fixture.packed, after: malformedRead });
  assert.equal(malformedReport.status, 'unavailable',
    'a matching receipt ID outside the core identifier bound must not bind a trace');
  const trace = createRetainedRecallTrace({ sourceProbe: probe, before, readSet: [namespace] });
  const wrongNamespace = structuredClone(fixture.response);
  wrongNamespace.value.namespaces[0].namespace = { ownerId: 'foreign-synthetic',
    scope: 'personal', projectId: null };
  const report = trace.finish({ recall: wrongNamespace, packed: fixture.packed, after: before });
  assert.equal(report.status, 'observed');
  assert.equal(report.final.status, 'unavailable');
  assert.equal(report.final.ref, 'unavailable');
  assert.equal(report.firstObservedGap, 'unavailable');
});

test('correction, forget and foreign namespace invalidate current source binding',
  { skip: !supportsSqlite && 'node:sqlite requires Node >=22.16' }, async t => {
  const { createRetainedRecallTrace } = await import('./recall-observation.mjs');
  const fixture = await coldCase(t, 11);
  const before = fixture.core.get({ namespace, memoryId: fixture.target.id, receiptLimit: 100 });
  const original = fixture.firstReceipt;
  const probe = { namespace, memoryId: fixture.target.id, client: 'synthetic',
    sessionId: 'cold-case', eventId: original.eventId, role: original.role,
    excerpt: original.excerpt, routingCue: original.excerpt.match(/marker\d+/u)[0] };
  const correctionTrace = createRetainedRecallTrace({ sourceProbe: probe, before,
    readSet: [namespace] });
  const correction = value(fixture.core.correct({ namespace, memoryId: fixture.target.id,
    expectedRevision: before.value.memory.revision, content: 'Corrected synthetic memory',
    kind: 'context', receipt: { client: 'synthetic', sessionId: 'cold-case',
      eventId: 'correction-source', role: 'user', excerpt: 'Corrected synthetic source' } }));
  const corrected = fixture.core.get({ namespace, memoryId: fixture.target.id, receiptLimit: 100 });
  const correctionReport = correctionTrace.finish({ recall: fixture.response,
    packed: fixture.packed, after: corrected });
  assert.equal(correctionReport.status, 'unavailable');
  assert.equal(correctionReport.reason, 'stale');
  const correctedProbe = { ...probe, eventId: 'correction-source',
    excerpt: 'Corrected synthetic source', routingCue: 'Corrected' };
  const forgetTrace = createRetainedRecallTrace({ sourceProbe: correctedProbe,
    before: corrected, readSet: [namespace] });
  value(fixture.core.forget({ namespace, memoryId: fixture.target.id,
    expectedRevision: correction.memory.revision }));
  const forgotten = fixture.core.get({ namespace, memoryId: fixture.target.id, receiptLimit: 100 });
  const forgetReport = forgetTrace.finish({ recall: fixture.response,
    packed: fixture.packed, after: forgotten });
  assert.equal(forgetReport.status, 'unavailable');
  assert.equal(forgetReport.reason, 'read_failed');
  const foreign = { ownerId: 'foreign-synthetic', scope: 'personal', projectId: null };
  const foreignTrace = createRetainedRecallTrace({ sourceProbe: { ...probe, namespace: foreign },
    before: fixture.core.get({ namespace: foreign, memoryId: fixture.target.id }),
    readSet: [foreign] });
  assert.equal(foreignTrace.finish({ recall: fixture.response,
    packed: fixture.packed, after: forgotten }).status, 'unavailable');
});

test('hostile observations and late or repeated records cannot rebind a closed trace',
  { skip: !supportsSqlite && 'node:sqlite requires Node >=22.16' }, async t => {
  const { createRetainedRecallTrace } = await import('./recall-observation.mjs');
  const fixture = await coldCase(t, 11);
  const receipt = fixture.firstReceipt;
  const before = fixture.core.get({ namespace, memoryId: fixture.target.id, receiptLimit: 100 });
  const probe = { namespace, memoryId: fixture.target.id, client: 'synthetic',
    sessionId: 'cold-case', eventId: receipt.eventId, role: receipt.role,
    excerpt: receipt.excerpt, routingCue: receipt.excerpt.match(/marker\d+/u)[0] };
  let getterCalls = 0, proxyCalls = 0;
  const getterOptions = Object.defineProperty({}, 'sourceProbe', { get() {
    getterCalls++; throw new Error('observer must not call this getter');
  } });
  const malformed = createRetainedRecallTrace(getterOptions);
  assert.equal(getterCalls, 0);
  assert.equal(malformed.finish({ recall: fixture.response,
    packed: fixture.packed, after: before }).status, 'unavailable');
  const proxy = new Proxy({}, { getOwnPropertyDescriptor() { proxyCalls++; throw new Error('proxy trap'); } });
  const trace = createRetainedRecallTrace({ sourceProbe: probe, before, readSet: [namespace] });
  trace.recordSelect(proxy, proxy);
  assert.equal(proxyCalls, 0);
  const report = trace.finish({ recall: fixture.response, packed: fixture.packed, after: before });
  assert.equal(report.status, 'observed');
  assert.equal(report.selection.referenceVisible, 'unavailable');
  trace.recordRank(proxy, proxy);
  trace.recordSelect(proxy, proxy);
  assert.equal(proxyCalls, 0);
  assert.equal(trace.finish({ recall: fixture.response,
    packed: fixture.packed, after: before }).reason, 'already_finished');
});

test('one-source trace bounds calls, public reads, answer observation and report disclosure',
  { skip: !supportsSqlite && 'node:sqlite requires Node >=22.16' }, async t => {
  const { createRetainedRecallTrace } = await import('./recall-observation.mjs');
  const { packMixedAnswer } = await import('../longmemeval/mixed-answer.mjs');
  const fixture = await coldCase(t, 12);
  const visible = await fixture.runFor(fixture.firstReceipt, { selectionMode: null });
  assert.equal(visible.response.ok, true);
  assert.equal(visible.frames.select.length, 1);
  assert.equal(visible.frames.rank.length, 1);
  const receipt = fixture.firstReceipt;
  const probe = { namespace, memoryId: fixture.target.id, client: 'synthetic',
    sessionId: 'cold-case', eventId: receipt.eventId, role: receipt.role,
    excerpt: receipt.excerpt, routingCue: visible.marker };
  const read = receiptLimit => fixture.core.get({ namespace, memoryId: fixture.target.id,
    receiptLimit });
  const before = read(100);
  const newTrace = initial => createRetainedRecallTrace({ sourceProbe: probe,
    before: initial, readSet: [namespace] });
  const select = visible.frames.gate.find(frame => frame.method === 'select');
  const rank = visible.frames.gate.find(frame => frame.method === 'rank');
  assert.ok(select && rank);
  const finish = (trace, packed = visible.packed) => trace.finish({ recall: visible.response,
    packed, after: read(100) });

  const tooManySelects = newTrace(before);
  for (let index = 0; index < 3; index++) {
    tooManySelects.recordSelect({ input: select.input }, select.output);
  }
  const selectOverflow = finish(tooManySelects);
  assert.equal(selectOverflow.status, 'unavailable');
  assert.equal(selectOverflow.reason, 'truncated');

  const tooManyRanks = newTrace(before);
  for (let index = 0; index < 2; index++) {
    tooManyRanks.recordRank({ input: rank.input }, rank.output);
  }
  const rankOverflow = finish(tooManyRanks);
  assert.equal(rankOverflow.status, 'unavailable');
  assert.equal(rankOverflow.reason, 'truncated');

  const incomplete = read(1);
  assert.equal(incomplete.ok, true);
  assert.equal(incomplete.value.exhausted, false);
  assert.equal(incomplete.value.receipts.length, 1);
  const incompleteReport = finish(newTrace(incomplete));
  assert.equal(incompleteReport.status, 'unavailable');
  assert.equal(incompleteReport.firstObservedGap, 'unavailable');

  const largePack = packMixedAnswer({ question: { text: 'Synthetic bound check',
    date: '2026-09-29' }, units: [{ text: `${receipt.excerpt}\n${'z'.repeat(70 * 1024)}` }],
  countTokens: () => 1 });
  assert.ok(Buffer.byteLength(largePack.request.messages[1].content, 'utf8') > 64 * 1024);
  const bounded = newTrace(before);
  bounded.recordSelect({ input: select.input }, select.output);
  bounded.recordRank({ input: rank.input }, rank.output);
  const boundedReport = finish(bounded, largePack);
  assert.equal(boundedReport.status, 'observed');
  assert.equal(boundedReport.answer.status, 'unavailable');
  assert.equal(boundedReport.answer.textPresent, 'unavailable');
  assert.equal(boundedReport.firstObservedGap, 'unavailable',
    'a diagnostic answer-size bound is not a core retrieval loss');

  const observed = newTrace(before);
  observed.recordSelect({ input: select.input }, select.output);
  observed.recordRank({ input: rank.input }, rank.output);
  const report = finish(observed);
  assert.equal(report.status, 'observed');
  const serialized = JSON.stringify(report);
  assert.ok(Buffer.byteLength(serialized, 'utf8') <= 32 * 1024);
  for (const secret of [namespace.ownerId, fixture.target.id, receipt.id,
    probe.client, probe.sessionId, probe.eventId, probe.excerpt, visible.marker]) {
    assert.equal(serialized.includes(secret), false, `report disclosed ${secret}`);
  }
});

test('a select request is projected at call entry before later mutation',
  { skip: !supportsSqlite && 'node:sqlite requires Node >=22.16' }, async t => {
  const { createRetainedRecallTrace } = await import('./recall-observation.mjs');
  const fixture = await coldCase(t, 12);
  const visible = await fixture.runFor(fixture.firstReceipt, { selectionMode: null });
  const receipt = fixture.firstReceipt;
  const read = () => fixture.core.get({ namespace, memoryId: fixture.target.id,
    receiptLimit: 100 });
  const trace = createRetainedRecallTrace({ sourceProbe: { namespace,
    memoryId: fixture.target.id, client: 'synthetic', sessionId: 'cold-case',
    eventId: receipt.eventId, role: receipt.role, excerpt: receipt.excerpt,
    routingCue: visible.marker }, before: read(), readSet: [namespace] });
  const select = visible.frames.gate.find(frame => frame.method === 'select');
  const rank = visible.frames.gate.find(frame => frame.method === 'rank');
  assert.ok(select && rank);
  const request = { input: structuredClone(select.input) };
  assert.ok(request.input.maps.flatMap(map => map.items)
    .some(item => item.label?.includes(visible.marker)));
  const settleSelect = trace.beginSelect(request);
  // The adapter can mutate its request while an asynchronous response is pending.
  // The report must describe the request at method entry, not at settlement.
  for (const item of request.input.maps.flatMap(map => map.items)) {
    if (item.label?.includes(visible.marker)) item.label = 'unrelated';
  }
  settleSelect(select.output);
  const rankRequest = { input: structuredClone(rank.input) };
  assert.ok(rankRequest.input.candidates.some(candidate => candidate.receipts
    .some(row => row.excerpt.includes(visible.marker))));
  const settleRank = trace.beginRank(rankRequest);
  for (const candidate of rankRequest.input.candidates) {
    for (const row of candidate.receipts) row.excerpt = 'unrelated';
  }
  settleRank(rank.output);
  const report = trace.finish({ recall: visible.response, packed: visible.packed,
    after: read() });
  assert.equal(report.selection.routingTextVisible, 'yes');
  assert.equal(report.rank.inputText, 'yes');
  const duplicate = createRetainedRecallTrace({ sourceProbe: { namespace,
    memoryId: fixture.target.id, client: 'synthetic', sessionId: 'cold-case',
    eventId: receipt.eventId, role: receipt.role, excerpt: receipt.excerpt,
    routingCue: visible.marker }, before: read(), readSet: [namespace] });
  const settleTwice = duplicate.beginRank({ input: rank.input });
  settleTwice(rank.output);
  settleTwice(rank.output);
  const duplicateReport = duplicate.finish({ recall: visible.response,
    packed: visible.packed, after: read() });
  assert.equal(duplicateReport.status, 'unavailable');
  assert.equal(duplicateReport.reason, 'observation_failed');
  const sourceProbe = { namespace, memoryId: fixture.target.id, client: 'synthetic',
    sessionId: 'cold-case', eventId: receipt.eventId, role: receipt.role,
    excerpt: receipt.excerpt, routingCue: visible.marker };
  const pending = createRetainedRecallTrace({ sourceProbe, before: read(),
    readSet: [namespace] });
  pending.beginSelect({ input: select.input });
  const pendingReport = pending.finish({ recall: visible.response,
    packed: visible.packed, after: read() });
  assert.equal(pendingReport.selection.accepted, 'unavailable');
  assert.equal(pendingReport.firstObservedGap, 'unavailable');
  const late = createRetainedRecallTrace({ sourceProbe, before: read(),
    readSet: [namespace] });
  const settleAfterClose = late.beginRank({ input: rank.input });
  const closed = late.finish({ recall: visible.response,
    packed: visible.packed, after: read() });
  settleAfterClose(rank.output);
  assert.equal(closed.rank.accepted, 'yes',
    'the actual final ref proves ranking, but the late proposal is not observed');
  assert.equal(closed.rank.proposal, 'unavailable');
  assert.equal(late.finish({ recall: visible.response,
    packed: visible.packed, after: read() }).reason, 'already_finished');
});
