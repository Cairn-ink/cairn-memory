import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareSourcePartition } from '../offline.mjs';
import { executeSourcePartition } from '../execution.mjs';
import { admitSynthetic, allReceipts, bundleExtraction, coldThrowingModel, createPartitionFixture,
  fileVisible, listAll, namespace, placeSynthetic, requireOk, stoppingInput } from '../fixtures.mjs';

function prepare(f, input) {
  const plan = prepareSourcePartition({ core: f.core, input, countTokens: f.countTokens });
  assert.deepEqual(input.sources.map(source => source.messages.length), [24, 24, 17]);
  assert.deepEqual(plan.partitions.map(part => [part.groupIndex, part.windowCount]), [[0, 20], [0, 4], [1, 20], [1, 4], [2, 17]]);
  assert.ok(plan.partitions.every(part => part.extractionFits && part.extractionTokens <= 6000));
  return plan;
}
const run = (f, input, plan) => executeSourcePartition({ core: f.core, input, plan, countTokens: f.countTokens });
function coldCounts(f, seedIds, cards, receipts) {
  f.close();
  const cold = f.open(coldThrowingModel(f.countTokens));
  const memories = listAll(cold.core).filter(memory => !seedIds.includes(memory.id));
  assert.equal(memories.length, cards);
  const sources = memories.flatMap(memory => allReceipts(cold.core, memory.id));
  assert.equal(sources.length, receipts);
  assert.equal(new Set(sources.map(source => source.eventId)).size, receipts);
  return { cold, memories, sources };
}

test('SP5 extraction refusal stops normative [20,4,20,4,17] before third admission and untouched suffix', async t => {
  let extracts = 0;
  const f = createPartitionFixture(t, { extract: request => {
    if (++extracts === 3) throw new Error('SYNTHETIC refusal, not a provider failure');
    return bundleExtraction(request);
  } });
  const input = stoppingInput(), plan = prepare(f, input), result = await run(f, input, plan);
  assert.equal(result.stopped, true);
  assert.deepEqual(result.outcomes.map(outcome => outcome.status), ['completed', 'completed', 'capture_failed']);
  assert.deepEqual(result.outcomes.map(outcome => outcome.attemptedStages),
    [['capture', 'initial-classification'], ['capture', 'initial-classification'], ['capture']]);
  assert.equal(result.outcomes[2].result.ok, false);
  assert.deepEqual(result.outcomes[2].result.error, { code: 'extraction_failed', retryable: false });
  assert.deepEqual(f.diagnostics, [{ version: 1, stage: 'extract', layer: 'core_call', reason: 'provider_failure' }]);
  assert.deepEqual(result.untouchedSuffix.map(part => part.partitionIndex), [3, 4]);
  assert.deepEqual(f.calls.map(call => call.method), ['extract', 'classify', 'extract', 'classify', 'extract']);
  const { sources } = coldCounts(f, [], 6, 24);
  assert.ok(sources.every(source => source.sessionId === input.sources[0].sessionId));
});

const reasons = [
  'classification_duplicate_targets', 'classification_duplicate_l1_parents',
  'classification_duplicate_l2_parents', 'classification_l1_title', 'classification_l2_title',
  'classification_target_mismatch', 'classification_parent_visibility', 'classification_create_policy',
];
function rejection(input, reason) {
  const leaf = input.map.find(item => item.type === 'moc' && item.moc.level === 'L1');
  const root = input.map.find(item => item.type === 'moc' && item.moc.level === 'L2');
  assert.ok(leaf, 'Rejections use a genuinely visible seeded L1');
  const proposal = fileVisible({ input });
  const first = proposal.items[0];
  switch (reason) {
    case 'classification_duplicate_targets': proposal.items[1].memoryId = first.memoryId; break;
    case 'classification_duplicate_l1_parents': first.parentIds = [leaf.moc.id, leaf.moc.id]; break;
    case 'classification_duplicate_l2_parents':
      assert.ok(root); first.parentIds = []; first.newL1 = { title: 'Synthetic new leaf', parentL2Ids: [root.moc.id, root.moc.id] }; break;
    case 'classification_l1_title': first.newL1 = { title: 'x'.repeat(121), parentL2Ids: [] }; break;
    case 'classification_l2_title': first.newL1 = { title: 'Synthetic new leaf', parentL2Ids: [], newL2Title: 'x'.repeat(121) }; break;
    case 'classification_target_mismatch': proposal.items.pop(); break;
    case 'classification_parent_visibility': assert.ok(root); first.parentIds = [root.moc.id]; break;
    case 'classification_create_policy':
      assert.equal(input.mapExhausted, false);
      assert.equal(input.map.length, 100); // Actual private catalog page, not fabricated map metadata.
      assert.ok(input.map.every(item => item.type === 'moc' && item.moc.level === 'L1' && item.moc.title !== null));
      assert.equal(new Set(input.map.map(item => item.moc.id)).size, 100);
      first.newL1 = { title: 'Synthetic forbidden new leaf', parentL2Ids: [] }; break;
    default: assert.fail('Unknown finite reason');
  }
  return proposal;
}

for (const reason of reasons) test('SP5 post-admission ' + reason + ' retains receipts and never calls final two partitions', async t => {
  let classifications = 0;
  const createPolicy = reason === 'classification_create_policy';
  const f = createPartitionFixture(t, { ...(createPolicy ? { countTokens: () => 1 } : {}),
    classify: ({ input }) => ++classifications === 3 ? rejection(input, reason) : fileVisible({ input }) });
  const seedIds = [];
  for (let index = 0; index < (createPolicy ? 101 : 1); index++) {
    const seed = admitSynthetic(f.core, 'SYNTHETIC catalog seed ' + index + '.'); seedIds.push(seed.id);
    placeSynthetic(f.core, seed.id, { parentIds: [], newL1: { title: 'Synthetic seeded leaf ' + index,
      parentL2Ids: [], ...(createPolicy ? {} : { newL2Title: 'Synthetic seeded root' }) } });
  }
  assert.equal(listAll(f.core).length, seedIds.length);
  const initialCatalog = requireOk(f.core.map({ namespace, purpose: 'classification', limit: 100 }));
  assert.equal(initialCatalog.exhausted, !createPolicy);
  if (createPolicy) {
    // Public map is a UNION of topics and memory refs, not the private
    // classifier's catalogOnly view. Prove the full seed set by public paging.
    assert.equal(initialCatalog.items.length, 100);
    assert.equal(initialCatalog.items.filter(item => item.type === 'moc').length, 50);
    assert.equal(initialCatalog.items.filter(item => item.type === 'ref' && item.ref.childType === 'memory').length, 50);
    assert.equal(initialCatalog.truncatedBy, 'page_limit');
    const items = [...initialCatalog.items]; let cursor = initialCatalog.nextCursor;
    assert.ok(cursor);
    while (cursor) {
      const page = requireOk(f.core.map({ namespace, purpose: 'classification', limit: 100, cursor }));
      assert.equal(page.exhausted, page.nextCursor === null);
      items.push(...page.items); cursor = page.nextCursor;
    }
    const topics = items.filter(item => item.type === 'moc'),
      refs = items.filter(item => item.type === 'ref' && item.ref.childType === 'memory');
    assert.equal(items.length, 202);
    assert.equal(topics.length, 101); assert.equal(refs.length, 101);
    assert.equal(new Set(topics.map(item => item.moc.id)).size, 101);
    assert.equal(new Set(refs.map(item => item.ref.childId)).size, 101);
    assert.deepEqual(refs.map(item => item.ref.childId).sort(), seedIds.toSorted());
    for (const item of topics) {
      assert.equal(item.moc.level, 'L1'); assert.notEqual(item.moc.title, null);
      const bound = refs.filter(ref => ref.ref.parentId === item.moc.id);
      assert.equal(bound.length, 1);
      const detail = requireOk(f.core.get({ namespace, memoryId: bound[0].ref.childId }));
      assert.ok(detail.placements.some(placement => placement.mocId === item.moc.id));
      assert.equal(allReceipts(f.core, detail.memory.id).length, 1);
    }
  } else assert.equal(initialCatalog.items.filter(item => item.type === 'moc').length, 2);
  const input = stoppingInput(), plan = prepare(f, input), result = await run(f, input, plan);
  assert.equal(result.stopped, true);
  assert.deepEqual(result.outcomes.map(outcome => outcome.status), ['completed', 'completed', 'classification_failed']);
  assert.deepEqual(result.untouchedSuffix.map(part => [part.partitionIndex, part.groupIndex]), [[3, 1], [4, 2]]);
  assert.ok(result.outcomes.every(outcome => outcome.result.ok && outcome.attemptedStages.length === 2));
  const failed = result.outcomes[2].result.value;
  assert.equal(failed.classification.status, 'failed');
  assert.deepEqual(failed.classification.error, { code: 'invalid_model_output', retryable: false });
  assert.equal(failed.admission.memories.length, 5);
  assert.deepEqual(f.calls.map(call => call.method), ['extract', 'classify', 'extract', 'classify', 'extract', 'classify']);
  assert.deepEqual(f.diagnostics, [{ version: 1, stage: 'classify', layer: 'core_validation', reason }]);
  const calls = f.calls.length;
  const replay = requireOk(await f.core.capture(plan.partitions[2] && {
    namespace: plan.partitions[2].namespace, client: plan.partitions[2].client,
    sessionId: plan.partitions[2].sessionId, eventId: plan.partitions[2].eventId,
    messages: plan.partitions[2].messages,
  }));
  assert.equal(replay.duplicate, true);
  assert.equal(f.calls.length, calls);
  const { cold, memories, sources } = coldCounts(f, seedIds, 11, 44);
  assert.equal(sources.filter(source => source.sessionId === input.sources[0].sessionId).length, 24);
  assert.equal(sources.filter(source => source.sessionId === input.sources[1].sessionId).length, 20);
  assert.ok(sources.every(source => source.sessionId !== input.sources[2].sessionId));
  const failedIds = failed.admission.memories.map(memory => memory.id);
  assert.equal(memories.filter(memory => failedIds.includes(memory.id)).length, 5);
  for (const memoryId of failedIds) {
    assert.equal(requireOk(cold.core.get({ namespace, memoryId })).placements.length, 0);
    assert.equal(allReceipts(cold.core, memoryId).length, 4);
  }
});
