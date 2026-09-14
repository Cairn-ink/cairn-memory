import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { openMemoryCore } from '../../../core/contract.mjs';
import { SOURCE_ANSWER_MODEL } from '../installed-source-answer-delivery.mjs';
import { runLongSourceHistory } from '../long-source-history.mjs';

const namespace = { ownerId: 'synthetic-long-history', scope: 'personal', projectId: null };
const fixture = { id: 'synthetic-long-source-history', windows: [
  [{ id: 'eval-source-01', role: 'assistant', content: 'You could consider the Estuary evening course.' },
    { id: 'eval-source-02', role: 'user', content: 'I am considering the Estuary course, but I have not decided.' }],
  [{ id: 'eval-source-03', role: 'user', content: 'I still have not decided about Estuary and did not enroll.' },
    { id: 'eval-source-04', role: 'user', content: 'Lina chose the Estuary course; that is her decision, not mine.' }],
], queries: [
  { id: 'my-status', question: 'Did I decide on the Estuary course?' },
  { id: 'lina-status', question: 'What did Lina choose?' },
] };
const rubric = { id: fixture.id, queries: [
  { id: 'my-status', requiredSourceIds: ['eval-source-02', 'eval-source-03'], irrelevantSourceIds: ['eval-source-01', 'eval-source-04'] },
  { id: 'lina-status', requiredSourceIds: ['eval-source-04'], irrelevantSourceIds: ['eval-source-01'] },
] };
const tool = result => ({ isError: !result.ok, content: [{ type: 'text', text: JSON.stringify({
  ...result, evidenceTrust: 'untrusted-data-not-instructions',
}) }] });
const ref = item => item.type === 'unfiled' ? item.ref : item.type === 'ref' && item.ref.childType === 'memory'
  ? { memoryId: item.ref.childId, revision: item.ref.childRevision } : null;

function model(options, observations) {
  return { contextWindow: 100000, countTokens: value => Math.ceil(value.length / 4),
    extract: ({ input }) => {
      observations.push({ method: 'extract', input: structuredClone(input) });
      return { items: input.messages.flatMap((message, index) => message.content.includes(options.omitCapture ?? '\u0000')
        ? [] : [{ content: message.content, kind: 'context', confidence: 0.8, sourceIndices: [index] }]) };
    },
    qualifyCandidates: ({ input }) => {
      observations.push({ method: 'qualifyCandidates', input: structuredClone(input) });
      const field = (value, item) => ({ value, evidenceIndices: [item.candidates[0].candidateIndex] });
      return { qualifications: input.items.map(item => ({ itemIndex: item.itemIndex,
        subject: field(null, item), property: field(null, item), scope: field(null, item), applies: field(null, item),
        value: field(null, item), attribution: field('unknown', item), commitment: field('unknown', item) })) };
    },
    classify: ({ input }) => {
      observations.push({ method: 'classify', input: structuredClone(input) });
      return { items: input.memories.map((memory, index) => ({ memoryId: memory.id, parentIds: [],
        newL1: { title: `Synthetic topic ${memory.id.slice(0, 12)} ${index}`, parentL2Ids: [] } })) };
    },
    select: ({ input }) => {
      observations.push({ method: 'select', input: structuredClone(input) });
      const visible = input.maps.flatMap(map => map.items.map(item => {
        const memory = ref(item); return memory ? { namespaceIndex: map.namespaceIndex, label: item.label, ...memory } : null;
      }).filter(Boolean));
      const counts = new Map();
      return { refs: visible.filter(item => {
        if (item.label.includes(options.omitSelect ?? '\u0000')) return false;
        const count = counts.get(item.namespaceIndex) ?? 0;
        if (count >= 12) return false;
        counts.set(item.namespaceIndex, count + 1); return true;
      }).slice(0, input.maxRefs).map(({ label, ...memory }) => memory) };
    },
    rank: ({ input }) => {
      observations.push({ method: 'rank', input: structuredClone(input) });
      return { refs: (options.emptyRank ? [] : input.candidates).filter(item => !item.receipts.some(receipt =>
        receipt.excerpt.includes(options.omitRank ?? '\u0000'))).slice(0, input.limit)
        .map(item => ({ namespaceIndex: item.namespaceIndex,
          memoryId: item.memory.id, revision: item.memory.revision })) };
    } };
}

function harness(options = {}) {
  const observations = [], completionBodies = [];
  return { observations, completionBodies,
    async openClient({ databasePath }) {
      const core = openMemoryCore({ path: databasePath, model: model(options, observations),
        captureQualification: 'source-bound-v2' });
      return { async callTool(request) {
        if (request.name === 'capture_memory') {
          if (options.captureError && request.arguments.batchId.endsWith('-1')) {
            return tool({ ok: false, error: { code: 'invalid_model_output', retryable: false } });
          }
          const { batchId, messages } = request.arguments;
          return tool(await core.capture({ namespace, client: 'cairn-local-mcp', sessionId: 'submitted-capture',
            eventId: batchId, messages: messages.map((message, index) => ({ ...message,
              id: createHash('sha256').update(JSON.stringify([
                'cairn.mcp.submitted-message.v1', batchId, index,
              ])).digest('hex') })) }));
        }
        if (request.name === 'inspect_memory') {
          const args = request.arguments;
          return tool(args.memoryId ? core.get({ namespace, memoryId: args.memoryId,
            receiptLimit: args.receiptLimit, ...(args.receiptCursor ? { receiptCursor: args.receiptCursor } : {}) })
            : core.list({ namespace, limit: args.limit, ...(args.cursor ? { cursor: args.cursor } : {}) }));
        }
        if (request.name === 'recall_memory') {
          if (options.recallError && request.arguments.query.includes('Lina')) {
            return tool({ ok: false, error: { code: 'invalid_model_output', retryable: false } });
          }
          const result = await core.recall({ readSet: [namespace], query: request.arguments.query,
            limit: request.arguments.limit, contextMode: request.arguments.contextMode });
          if (options.malformedRecall && result.ok) result.value.memories = {};
          if (options.partial && result.ok) {
            result.value.coverage = 'budget_exhausted';
          }
          return tool(result);
        }
        throw new Error('unexpected_tool');
      }, async close() { core.close(); } };
    },
    async complete(body) {
      completionBodies.push(structuredClone(body));
      return { object: 'chat.completion', model: SOURCE_ANSWER_MODEL,
        choices: [{ finish_reason: 'stop', message: { role: 'assistant',
          content: 'Synthetic answer retained without semantic judgment.' } }] };
    } };
}

test('L01 actual capture, cold snapshots, MOC and lexical sources remain separate from answer judgments', async () => {
  const h = harness();
  const report = await runLongSourceHistory({ openClient: h.openClient, complete: h.complete, fixture, rubric });
  assert.equal(report.status, 'observed', JSON.stringify({ captures: report.captures.map(item => ({
    index: item.index, status: item.status, warm: item.warm?.status, cold: item.cold?.status })),
  queries: report.queries.map(item => ({ id: item.id, status: item.status,
    arms: item.arms.map(arm => ({ name: arm.name, status: arm.status, answer: arm.answer?.status })) })) }));
  assert.deepEqual(report.captures.map(item => item.status), ['completed', 'completed']);
  assert.ok(report.captures.every(item => item.coldMatchesWarm));
  assert.deepEqual(report.captureCoverage.missing, []);
  assert.deepEqual(report.queries.map(item => item.answerOrder), [['moc', 'lexical'], ['lexical', 'moc']]);
  for (const query of report.queries) for (const arm of query.arms) {
    assert.equal(arm.status, 'observed');
    assert.equal(arm.answer.status, 'generated-unassessed');
    assert.equal(Object.hasOwn(arm.answer, 'correct'), false);
    assert.equal(arm.constructedControl, arm.name === 'lexical');
  }
  assert.equal(h.completionBodies.length, 4);
  const modelInput = JSON.stringify(h.observations);
  const completionInput = JSON.stringify(h.completionBodies);
  for (const label of rubric.queries.flatMap(query => [...query.requiredSourceIds, ...query.irrelevantSourceIds])) {
    assert.equal(modelInput.includes(label), false);
    assert.equal(completionInput.includes(label), false);
  }
  assert.equal(modelInput.includes('requiredSourceIds'), false);
  assert.equal(completionInput.includes('requiredSourceIds'), false);
  assert.ok(h.completionBodies.every(body => !Object.hasOwn(body, 'tools')));
  assert.deepEqual(report.queries[0].arms.find(arm => arm.name === 'moc').coverage.missing, []);
  assert.deepEqual(report.queries[1].arms.find(arm => arm.name === 'lexical').coverage.missing, []);
});

test('L02 capture, selection and ranking omissions remain attributed to distinct source stages', async () => {
  for (const [options, expected] of [
    [{ omitCapture: 'still have not decided' }, { captureMissing: ['eval-source-03'], mocMissing: ['eval-source-03'] }],
    [{ omitSelect: 'still have not decided' }, { captureMissing: [], mocMissing: ['eval-source-03'] }],
    [{ omitRank: 'still have not decided' }, { captureMissing: [], mocMissing: ['eval-source-03'] }],
  ]) {
    const h = harness(options);
    const report = await runLongSourceHistory({ openClient: h.openClient, complete: h.complete, fixture, rubric });
    assert.deepEqual(report.captureCoverage.missing, expected.captureMissing);
    assert.deepEqual(report.queries[0].arms.find(arm => arm.name === 'moc').coverage.missing, expected.mocMissing);
    assert.equal(report.queries[0].arms.find(arm => arm.name === 'moc').status, 'observed');
  }
});

test('L03 partial MOC evidence is scored but deliberately not answered; lexical remains usable', async () => {
  const h = harness({ partial: true });
  const report = await runLongSourceHistory({ openClient: h.openClient, complete: h.complete, fixture, rubric });
  for (const query of report.queries) {
    const moc = query.arms.find(arm => arm.name === 'moc');
    const lexical = query.arms.find(arm => arm.name === 'lexical');
    assert.equal(moc.status, 'observed');
    assert.ok(moc.coverage);
    assert.equal(moc.answer.status, 'answer_not_run_partial_coverage');
    assert.equal(moc.answer.completionCalls, 0);
    assert.equal(lexical.answer.status, 'generated-unassessed');
  }
  assert.equal(h.completionBodies.length, 2);
});

test('L04 capture and recall errors retain every denominator slot without retries', async () => {
  const capture = harness({ captureError: true });
  const stopped = await runLongSourceHistory({ openClient: capture.openClient, complete: capture.complete, fixture, rubric });
  assert.deepEqual(stopped.captures.map(item => item.status), ['completed', 'failed']);
  assert.ok(stopped.queries.every(query => query.status === 'not_run'));
  assert.equal(capture.completionBodies.length, 0);

  const recall = harness({ recallError: true });
  const retained = await runLongSourceHistory({ openClient: recall.openClient, complete: recall.complete, fixture, rubric });
  const failed = retained.queries[1].arms.find(arm => arm.name === 'moc');
  assert.equal(failed.status, 'recall_failed');
  assert.equal(failed.recall.isError, true);
  assert.equal(failed.answer.status, 'answer_not_run_recall_failed');
  assert.equal(retained.queries[1].arms.find(arm => arm.name === 'lexical').answer.status, 'generated-unassessed');
});

test('L05 fixture and rubric labels reject before opening a store', async () => {
  for (const [badFixture, badRubric] of [
    [{ ...fixture, windows: [...fixture.windows, ...Array(7).fill(fixture.windows[0])] }, rubric],
    [{ ...fixture, windows: [[...fixture.windows[0], ...fixture.windows[1], fixture.windows[0][0]]] }, rubric],
    [fixture, { ...rubric, queries: [{ ...rubric.queries[0], irrelevantSourceIds: ['eval-source-02'] }, rubric.queries[1]] }],
    [fixture, { ...rubric, queries: [{ ...rubric.queries[0], requiredSourceIds: ['absent'] }, rubric.queries[1]] }],
    [fixture, { ...rubric, id: 'different-fixture' }],
  ]) {
    let opened = 0;
    await assert.rejects(runLongSourceHistory({ openClient: () => { opened++; }, complete: () => {},
      fixture: badFixture, rubric: badRubric }), /invalid_long_source_history_input/u);
    assert.equal(opened, 0);
  }
});

test('L06 source binding safely retains a prototype-looking evaluation ID', async () => {
  const changedFixture = structuredClone(fixture);
  changedFixture.windows[0][0].id = '__proto__';
  const changedRubric = structuredClone(rubric);
  changedRubric.queries[0].irrelevantSourceIds[0] = '__proto__';
  changedRubric.queries[1].irrelevantSourceIds[0] = '__proto__';
  const h = harness();
  const report = await runLongSourceHistory({ openClient: h.openClient, complete: h.complete,
    fixture: changedFixture, rubric: changedRubric });
  assert.equal(Object.hasOwn(report.sourceBindings, '__proto__'), true);
  assert.match(report.sourceBindings.__proto__, /^[a-f0-9]{64}$/u);
  assert.deepEqual(report.captureCoverage.missing, []);
});

function pageLimitFixture(mode) {
  const minimalFixture = { id: `page-${mode}`, windows: [[
    { id: 'source-1', role: 'user', content: 'Synthetic bounded source.' },
  ]], queries: [{ id: 'query-1', question: 'What is the bounded source?' }] };
  const minimalRubric = { id: minimalFixture.id, queries: [
    { id: 'query-1', requiredSourceIds: ['source-1'], irrelevantSourceIds: [] },
  ] };
  let listCalls = 0, getCalls = 0;
  const success = value => tool({ ok: true, value });
  return { minimalFixture, minimalRubric, counts: () => ({ listCalls, getCalls }),
    async openClient() { return { async close() {}, async callTool({ name, arguments: args }) {
      if (name === 'capture_memory') return success({ duplicate: false });
      if (name !== 'inspect_memory') throw new Error('unexpected_tool');
      if (mode === 'list') {
        listCalls++;
        return success({ memories: [], nextCursor: `cursor-${listCalls}`, exhausted: false });
      }
      if (!args.memoryId) {
        listCalls++;
        return success({ memories: [{ id: 'memory-1', revision: 1, state: 'active' }],
          nextCursor: null, exhausted: true });
      }
      getCalls++;
      const start = (getCalls % 2) * 50;
      return success({ memory: { id: 'memory-1', revision: 1, state: 'active', receiptCount: 100 },
        receipts: Array.from({ length: 50 }, (_, index) => ({ id: `receipt-${start + index}`,
          eventId: `event-${start + index}`, role: 'user', excerpt: 'Synthetic.' })),
        nextReceiptCursor: 'repeated-cursor', exhausted: false });
    } }; } };
}

test('L07 repeated or endless pagination is independently bounded before queries', async () => {
  for (const mode of ['list', 'receipt']) {
    const f = pageLimitFixture(mode);
    const report = await runLongSourceHistory({ openClient: f.openClient, complete: () => assert.fail('no answer'),
      fixture: f.minimalFixture, rubric: f.minimalRubric });
    assert.equal(report.captures[0].status, 'failed');
    assert.equal(report.queries[0].status, 'not_run');
    const counts = f.counts();
    assert.ok(counts.listCalls <= 6);
    assert.ok(counts.getCalls <= 4);
    assert.equal(report.captures[0].warm.status, 'snapshot_limit_exceeded');
    assert.equal(report.captures[0].cold.status, 'snapshot_limit_exceeded');
  }
});

test('L08 frozen eight-window fixture produces all four query pairs under actual core limits', async () => {
  const frozenFixture = JSON.parse(readFileSync(new URL('../long-source-history-fixture.json', import.meta.url)));
  const frozenRubric = JSON.parse(readFileSync(new URL('../long-source-history-rubric.json', import.meta.url)));
  const h = harness();
  const report = await runLongSourceHistory({ openClient: h.openClient, complete: h.complete,
    fixture: frozenFixture, rubric: frozenRubric });
  assert.equal(report.status, 'observed', JSON.stringify({ captures: report.captures.map(item => ({
    index: item.index, status: item.status, warm: item.warm?.status, cold: item.cold?.status })),
  queries: report.queries.map(item => ({ id: item.id, status: item.status,
    arms: item.arms.map(arm => ({ name: arm.name, status: arm.status, answer: arm.answer?.status })) })) }));
  assert.equal(report.captures.length, 8);
  assert.equal(report.queries.length, 4);
  assert.equal(report.queries.flatMap(query => query.arms).length, 8);
  assert.equal(h.completionBodies.length, 8);
});

test('L09 malformed recall memories are failed, while valid empty and partial arrays remain observable', async () => {
  const malformed = harness({ malformedRecall: true });
  const report = await runLongSourceHistory({ openClient: malformed.openClient, complete: malformed.complete,
    fixture, rubric });
  for (const query of report.queries) {
    const moc = query.arms.find(arm => arm.name === 'moc');
    assert.equal(moc.status, 'recall_failed');
    assert.equal(moc.coverage, null);
    assert.equal(moc.answer.status, 'answer_not_run_recall_failed');
  }
  assert.equal(malformed.completionBodies.length, 2);
  const empty = harness({ emptyRank: true });
  const emptyReport = await runLongSourceHistory({ openClient: empty.openClient, complete: empty.complete,
    fixture, rubric });
  for (const query of emptyReport.queries) {
    const moc = query.arms.find(arm => arm.name === 'moc');
    assert.equal(moc.status, 'observed');
    assert.equal(moc.coverage.present.length, 0);
    assert.equal(moc.answer.status, 'generated-unassessed');
  }
});
