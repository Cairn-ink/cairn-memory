import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runDecisionEvolutionCore, encodeDecisionEvent, mapDecisionArmEvidence } from '../../evaluation/decision-evolution/core-runner.mjs';
import { boundedText } from '../validation.mjs';

const fixture = JSON.parse(readFileSync(new URL('../../evaluation/decision-evolution/fixture.json', import.meta.url)));
const refs = input => input.maps.flatMap(map => map.items.filter(item => item.type === 'unfiled' ||
  (item.type === 'ref' && item.ref.childType === 'memory')).map(item => ({ namespaceIndex: map.namespaceIndex,
  ...(item.type === 'unfiled' ? item.ref : { memoryId: item.ref.childId, revision: item.ref.childRevision }),
  label: item.label })));
function model({ selectedMemoryId = null, failText = null, calls = [] } = {}) {
  return { contextWindow: 8192, countTokens: () => 1,
    extract({ input }) { calls.push({ stage: 'extract', input: structuredClone(input) });
      if (failText && input.messages[0].content.includes(failText)) throw new Error('scripted failure');
      return { items: input.messages.map(message => ({ content: message.content.slice(0, 200), kind: 'decision',
        confidence: 0.8, sourceIndices: [message.index] })) }; },
    classify({ input }) { calls.push({ stage: 'classify', input: structuredClone(input) });
      return { items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [],
        newL1: { title: `Synthetic ${memory.id.slice(0, 8)}`, parentL2Ids: [] } })) }; },
    select({ input }) { calls.push({ stage: 'select', input: structuredClone(input) });
      const visible = refs(input);
      const chosen = selectedMemoryId ? visible.filter(item => item.memoryId === selectedMemoryId()) : visible;
      return { refs: chosen.map(({ label, ...ref }) => ref) }; },
    rank({ input }) { calls.push({ stage: 'rank', input: structuredClone(input) });
      return { refs: input.candidates.slice(0, input.limit).map(candidate => ({ namespaceIndex: candidate.namespaceIndex,
        memoryId: candidate.memory.id, revision: candidate.memory.revision })) }; },
  };
}
const run = (source = fixture, options = {}) => runDecisionEvolutionCore({ fixture: source,
  modelFactory: () => model(options), ...options });
const only = id => ({ ...fixture, cases: [structuredClone(fixture.cases.find(item => item.id === id))] });

test('all eight source-only cases traverse actual capture, stored receipts and three read surfaces', async () => {
  const result = await run(fixture, { includeRationale: true });
  assert.equal(result.cases.length, 8);
  for (const item of result.cases) {
    assert.equal(item.captures.length, item.sourceCount);
    assert.equal(item.incompleteCapture, false, JSON.stringify(item));
    assert.equal(item.capturedSourceIds.length, item.sourceCount);
    assert.ok(item.captures.every(capture => capture.classification.status === 'applied'),
      JSON.stringify(item.captures.map(capture => capture.classification)));
    for (const question of item.questions) {
      for (const arm of ['source-evidence', 'rationale-evidence', 'sourceSnapshot']) {
        assert.equal(question.arms[arm].status, 'ok', JSON.stringify(question.arms[arm]));
        assert.equal(question.arms[arm].absentReceipts.length, 0);
      }
      assert.deepEqual(new Set(question.arms.sourceSnapshot.sourceIds), new Set(item.capturedSourceIds));
      assert.equal(question.arms['rationale-evidence'].relationshipStatus, 'unassessed-not-linked');
    }
  }
});

test('receipt-derived old-root fault injection loses the update while complete-source read retains it', async () => {
  let oldMemoryId;
  const calls = [];
  const item = (await runDecisionEvolutionCore({ fixture: only('dev-vendor-transition-en'),
    modelFactory: () => model({ selectedMemoryId: () => oldMemoryId, calls }),
    beforeRead({ sourceReceipts }) {
      oldMemoryId = sourceReceipts.find(receipt => receipt.sourceId === 'd1').memoryId;
    } })).cases[0];
  assert.ok(calls.some(call => call.stage === 'select' && call.input.maps.some(map => map.items.some(entry =>
    (entry.type === 'unfiled' ? entry.ref.memoryId : entry.ref.childId) === oldMemoryId))));
  const arms = item.questions[0].arms;
  assert.deepEqual(arms['source-evidence'].sourceIds, ['d1']);
  assert.deepEqual(new Set(arms.sourceSnapshot.sourceIds), new Set(['d1', 'd2', 'd3', 'd4']));
  assert.equal(arms.sourceSnapshot.coverage, 'complete-current-admitted');
});

test('scripted nested rationale DTO maps linked receipts but does not infer semantic quality', () => {
  const root = { memory: { id: 'root' }, receipts: [{ id: 'r1', excerpt: 'old' }] };
  const linked = { memory: { id: 'linked' }, receipts: [{ id: 'r2', excerpt: 'update' }] };
  root.rationale = { sources: [root, linked], edges: [{ from: 'linked', to: 'root', relation: 'supports-decision' }] };
  const mapped = mapDecisionArmEvidence([root], 'rationale-evidence', new Map([['old', 'd1'], ['update', 'd4']]));
  assert.deepEqual(mapped.sourceIds, ['d1', 'd4']);
  assert.deepEqual(mapped.selectedSourceIds, ['d1']);
  assert.equal(mapped.relationshipStatus, 'model-proposed');
  assert.equal(mapped.evidence.length, 2);
  assert.deepEqual(mapped.absentReceipts, []);
});

test('capture carries event chronology as untrusted source text and tentative wording survives receipt', async () => {
  const item = (await run(only('dev-tentative-zh'))).cases[0];
  const tentative = item.sourceReceipts.find(receipt => receipt.sourceId === 'd6');
  assert.ok(tentative.excerpt.includes('暫時比較想選 B'));
  assert.ok(tentative.excerpt.includes('還沒正式改決定'));
  assert.equal(tentative.excerpt, boundedText(encodeDecisionEvent(fixture.cases[1].events[1]), 800, true));
  const late = (await run(only('heldout-late-older-en'))).cases[0];
  assert.equal(late.captures[2].sourceId, 'h3');
  assert.equal(late.captures[2].occurredAt, '2026-05-10');
  assert.equal(late.captures[2].ingestedAt, '2026-05-25');
  assert.ok(late.sourceReceipts.find(receipt => receipt.sourceId === 'h3').excerpt.includes('Minutes from May 10'));
});

test('failed capture remains counted, does not retry, and exposes missing source coverage', async () => {
  const calls = [];
  const item = (await runDecisionEvolutionCore({ fixture: only('dev-vendor-transition-en'),
    modelFactory: () => model({ failText: 'Approval is complete', calls }) })).cases[0];
  assert.equal(item.captures[3].status, 'failed');
  assert.equal(item.captures[3].error, 'extraction_failed');
  assert.deepEqual(item.absentSourceIds, ['d4']);
  assert.equal(item.incompleteCapture, true);
  assert.equal(calls.filter(call => call.stage === 'extract' && call.input.messages[0].content.includes('Approval is complete')).length, 1);
  assert.equal(item.questions[0].arms.sourceSnapshot.sourceIds.includes('d4'), false);
});

test('mapped but clipped receipt is explicitly incomplete, never full-source coverage', async () => {
  const longFixture = only('dev-vendor-transition-en');
  longFixture.cases[0].events[0].text += ` ${'long tail '.repeat(100)}`;
  const item = (await run(longFixture)).cases[0];
  assert.deepEqual(item.truncatedSourceIds, ['d1']);
  assert.ok(item.capturedSourceIds.includes('d1'));
  assert.equal(item.incompleteCapture, true);
  assert.ok(item.sourceReceipts.find(receipt => receipt.sourceId === 'd1').excerpt.length <= 800);
});

test('invalid oversized encoded source is rejected before model or database work', async () => {
  const oversized = only('dev-tentative-zh');
  oversized.cases[0].events[0].text = 'x'.repeat(4100);
  let called = false;
  await assert.rejects(runDecisionEvolutionCore({ fixture: oversized, modelFactory: () => {
    called = true; return model();
  } }), /invalid encoded source: dev-tentative-zh\/d5/);
  assert.equal(called, false);
});

test('cold reopen preserves receipts; forgetting removes evidence from later reads', async () => {
  const item = (await runDecisionEvolutionCore({ fixture: only('dev-tentative-zh'), coldReopen: true,
    modelFactory: () => model(), beforeRead({ core, namespace, captures }) {
      const captured = captures.find(entry => entry.sourceId === 'd6');
      const filed = captured.classification.memoryRevisions[0];
      assert.equal(core.forget({ namespace, memoryId: filed.memoryId, expectedRevision: filed.revision }).ok, true);
    } })).cases[0];
  assert.ok(item.trace.some(entry => entry.stage === 'cold-reopen'));
  assert.deepEqual(item.capturedSourceIds, ['d5', 'd6']);
  for (const arm of ['source-evidence', 'sourceSnapshot']) {
    assert.equal(item.questions[0].arms[arm].sourceIds.includes('d6'), false);
  }
});

test('fresh namespace and database per case exclude foreign case evidence', async () => {
  const result = await runDecisionEvolutionCore({ fixture: { ...fixture, cases: fixture.cases.slice(0, 2) },
    modelFactory: () => model(), async beforeRead({ core, namespace }) {
      const foreign = { ...namespace, ownerId: `${namespace.ownerId}-foreign` };
      const event = fixture.cases[7].events[0];
      const captured = await core.capture({ namespace: foreign, client: 'dei-offline', sessionId: 'foreign',
        eventId: event.id, messages: [{ id: event.id, role: 'user', content: encodeDecisionEvent(event) }] });
      assert.equal(captured.ok, true);
      assert.equal(core.sourceSnapshot({ readSet: [foreign], limit: 12 }).value.memories.length, 1);
    } });
  assert.notEqual(result.cases[0].namespace.ownerId, result.cases[1].namespace.ownerId);
  for (const item of result.cases) {
    const own = new Set(item.captures.map(capture => capture.sourceId));
    assert.ok(item.questions[0].arms.sourceSnapshot.sourceIds.every(id => own.has(id)));
    assert.equal(item.questions[0].arms.sourceSnapshot.sourceIds.includes('h9'), false);
  }
});
