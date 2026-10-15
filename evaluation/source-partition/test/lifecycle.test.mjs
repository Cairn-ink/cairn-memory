import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareSourcePartition } from '../offline.mjs';
import { executeSourcePartition } from '../execution.mjs';
import { allReceipts, coldThrowingModel, createPartitionFixture, listAll, namespace, requireOk, sourceInput } from '../fixtures.mjs';

const summary = 'SYNTHETIC original green marker preference.';
const correctedSummary = 'SYNTHETIC corrected amber marker preference.';
const input = () => sourceInput([{ id: 'synthetic-source-identity', role: 'user', content: summary }]);
const prepare = (f, source) => prepareSourcePartition({ core: f.core, input: source, countTokens: f.countTokens });
const run = (f, source, plan = prepare(f, source)) => executeSourcePartition({ core: f.core,
  input: source, plan, countTokens: f.countTokens });
const newEvent = (source, suffix) => {
  const copy = structuredClone(source); copy.sources[0].baseEventId += '-' + suffix; return copy;
};
const snapshot = (f, id, ns = namespace) => requireOk(f.core.get({ namespace: ns, memoryId: id }));

test('SP4 exact replay, same-ID receipt dedup, different-ID identical excerpt, and paraphrase are distinct', async t => {
  let extractedSummary = summary;
  const f = createPartitionFixture(t, { extract: () => ({ items: [{ content: extractedSummary,
    kind: 'context', confidence: 0.8, sourceIndices: [0] }] }) });
  const source = input(), plan = prepare(f, source);
  const first = await run(f, source, plan), id = first.outcomes[0].result.value.admission.memories[0].id;
  const calls = f.calls.length;
  assert.equal((await run(f, source, plan)).outcomes[0].status, 'replayed');
  assert.equal(f.calls.length, calls);
  const same = await run(f, newEvent(source, 'same-source'));
  assert.equal(same.outcomes[0].result.value.admission.memories[0].id, id);
  assert.equal(allReceipts(f.core, id).length, 1); // Same client/session/event(message ID)/role/excerpt.
  const different = newEvent(source, 'different-id'); different.sources[0].messages[0].id += '-different';
  assert.equal((await run(f, different)).outcomes[0].result.value.admission.memories[0].id, id);
  assert.equal(allReceipts(f.core, id).length, 2);
  const changedRole = newEvent(source, 'different-role'); changedRole.sources[0].messages[0].role = 'assistant';
  await run(f, changedRole);
  assert.equal(allReceipts(f.core, id).length, 3);
  assert.deepEqual(new Set(allReceipts(f.core, id).map(receipt => receipt.eventId)),
    new Set(['synthetic-source-identity', 'synthetic-source-identity-different']));
  extractedSummary = 'SYNTHETIC paraphrase: marker preference is green.';
  await run(f, newEvent(source, 'paraphrase'));
  assert.equal(listAll(f.core).length, 2); // Fingerprint dedup is not semantic equivalence.
  f.close();
  const cold = f.open(coldThrowingModel(f.countTokens));
  assert.equal(allReceipts(cold.core, id).length, 3);
});

test('SP4 same capture event with changed payload conflicts before extraction, not a new-event conflict', async t => {
  const f = createPartitionFixture(t), source = input(), plan = prepare(f, source);
  await run(f, source, plan);
  const changed = structuredClone(source); changed.sources[0].messages[0].content += ' Changed payload.';
  const changedPlan = prepare(f, changed);
  assert.equal(changedPlan.partitions[0].eventId, plan.partitions[0].eventId);
  const calls = f.calls.length, result = await run(f, changed, changedPlan);
  assert.equal(result.stopped, true);
  assert.equal(result.outcomes[0].result.error.code, 'event_payload_conflict');
  assert.deepEqual(result.outcomes[0].attemptedStages, ['capture']);
  assert.equal(f.calls.length, calls);
  assert.equal(listAll(f.core).length, 1);
});

test('SP6 same-item identical windows with one source identity reject; distinct IDs keep two cold receipts', async t => {
  const head = 'SYNTHETIC repeated evidence ';
  const repeated = head + 'x'.repeat(800 - head.length);
  assert.equal(repeated.length, 800);
  for (const differentIds of [false, true]) {
    const f = createPartitionFixture(t, { extract: () => ({ items: [{ content: 'SYNTHETIC same-item source citation.',
      kind: 'context', confidence: 0.8, sourceIndices: [0, 1] }] }) });
    const source = sourceInput(differentIds ? [
      { id: 'synthetic-first-source', role: 'user', content: repeated },
      { id: 'synthetic-second-source', role: 'user', content: repeated },
    ] : [{ id: 'synthetic-one-source', role: 'user', content: repeated + repeated }]);
    const plan = prepare(f, source);
    assert.equal(plan.origins.length, 2);
    assert.deepEqual(plan.origins.map(origin => origin.excerpt), [repeated, repeated]);
    const result = await run(f, source, plan);
    if (differentIds) {
      assert.equal(result.stopped, false);
      assert.deepEqual(f.calls.map(call => call.method), ['extract', 'classify']);
      f.close();
      const cold = f.open(coldThrowingModel(f.countTokens)), memories = listAll(cold.core);
      assert.equal(memories.length, 1);
      const receipts = allReceipts(cold.core, memories[0].id);
      assert.equal(receipts.length, 2);
      assert.deepEqual(receipts.map(receipt => receipt.eventId).sort(), ['synthetic-first-source', 'synthetic-second-source']);
      assert.ok(receipts.every(receipt => receipt.role === 'user' && receipt.excerpt === repeated));
    } else {
      assert.deepEqual(plan.origins.map(origin => [origin.messageId, origin.startUtf16, origin.endUtf16]),
        [['synthetic-one-source', 0, 800], ['synthetic-one-source', 800, 1600]]);
      assert.equal(result.stopped, true);
      assert.equal(result.outcomes[0].result.error.code, 'invalid_model_output');
      assert.deepEqual(f.calls.map(call => call.method), ['extract']);
      assert.deepEqual(f.diagnostics, [{ version: 1, stage: 'extract', layer: 'core_validation',
        reason: 'invalid_extraction_source_duplicate' }]);
      f.close();
      const cold = f.open(coldThrowingModel(f.countTokens));
      assert.equal(listAll(cold.core).length, 0);
    }
  }
});

test('SP6 guarded correction replaces receipts; replay and new-event suppression cannot resurrect forgotten fingerprints', async t => {
  let extractedSummary = summary;
  const f = createPartitionFixture(t, { extract: () => ({ items: [{ content: extractedSummary,
    kind: 'context', confidence: 0.8, sourceIndices: [0] }] }) });
  const source = input(), plan = prepare(f, source);
  const first = await run(f, source, plan), id = first.outcomes[0].result.value.admission.memories[0].id;
  const originalRevision = snapshot(f, id).memory.revision;
  const receipt = { client: 'synthetic-correction', sessionId: 'synthetic-correction',
    eventId: 'synthetic-correction', role: 'user', excerpt: correctedSummary };
  const corrected = requireOk(f.core.correct({ namespace, memoryId: id, expectedRevision: originalRevision,
    content: correctedSummary, kind: 'context', receipt })).memory;
  assert.equal(corrected.content, correctedSummary);
  assert.deepEqual(allReceipts(f.core, id).map(({ client, sessionId, eventId, role, excerpt }) =>
    ({ client, sessionId, eventId, role, excerpt })), [receipt]);
  assert.equal(f.core.correct({ namespace, memoryId: id, expectedRevision: originalRevision,
    content: 'SYNTHETIC stale correction.', kind: 'context', receipt }).error.code, 'revision_conflict');
  assert.equal(f.core.forget({ namespace, memoryId: id, expectedRevision: originalRevision }).error.code, 'revision_conflict');
  const calls = f.calls.length;
  assert.equal((await run(f, source, plan)).outcomes[0].status, 'replayed');
  assert.equal(f.calls.length, calls);
  assert.equal(snapshot(f, id).memory.content, correctedSummary);
  const suppressedOld = await run(f, newEvent(source, 'old-after-correction'));
  assert.equal(suppressedOld.outcomes[0].result.value.admission.memories.length, 0);
  assert.equal(suppressedOld.outcomes[0].result.value.admission.suppressedCount, 1);
  requireOk(f.core.forget({ namespace, memoryId: id, expectedRevision: snapshot(f, id).memory.revision }));
  const afterForgetCalls = f.calls.length;
  assert.equal((await run(f, source, plan)).outcomes[0].status, 'replayed');
  assert.equal(f.calls.length, afterForgetCalls);
  extractedSummary = correctedSummary;
  const suppressedCurrent = await run(f, newEvent(source, 'corrected-after-forget'));
  assert.equal(suppressedCurrent.outcomes[0].result.value.admission.memories.length, 0);
  assert.equal(suppressedCurrent.outcomes[0].result.value.admission.suppressedCount, 1);
  assert.equal(listAll(f.core).length, 0);
  const isolated = newEvent(source, 'isolated'); isolated.namespace.projectId += '-isolated'; extractedSummary = summary;
  const isolatedResult = await run(f, isolated);
  const isolatedId = isolatedResult.outcomes[0].result.value.admission.memories[0].id;
  assert.equal(listAll(f.core, isolated.namespace).length, 1);
  assert.equal(f.core.get({ namespace, memoryId: isolatedId }).error.code, 'memory_not_found');
  f.close();
  const cold = f.open(coldThrowingModel(f.countTokens));
  assert.equal(listAll(cold.core).length, 0);
  assert.equal(listAll(cold.core, isolated.namespace).length, 1);
  assert.equal(allReceipts(cold.core, isolatedId, isolated.namespace).length, 1);
});
