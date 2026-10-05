import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareSourcePartition } from '../offline.mjs';
import { executeSourcePartition } from '../execution.mjs';
import { allReceipts, admitSynthetic, boundaryStatements, bundleExtraction, coldThrowingModel,
  createPartitionFixture, listAll, memoryDetails, namespace, requireOk, sixFacts, sourceInput, windowMessages } from '../fixtures.mjs';

const tuples = receipts => receipts.map(({ client, sessionId, eventId, role, excerpt }) =>
  JSON.stringify([client, sessionId, eventId, role, excerpt])).sort();
const expectedReceipts = (plan, count) => plan.origins.slice(0, count).map(origin => ({
  client: plan.input.client, sessionId: origin.sessionId, eventId: origin.messageId,
  role: origin.role, excerpt: origin.excerpt,
}));
const prepare = (f, input) => prepareSourcePartition({ core: f.core, input, countTokens: f.countTokens });
const run = (f, input, plan, arm) => executeSourcePartition({ core: f.core, input, plan,
  countTokens: f.countTokens, ...(arm ? { arm } : {}) });

test('SP3 actual 21-window single batch loses one source; 20+1 retains six cards and 21 cold receipts', async t => {
  const input = sourceInput(windowMessages(21, 'synthetic-conservation', { repeatEnds: true }));
  const summaries = [];
  for (const [arm, expectedCards, expectedSources] of [['unchanged', 5, 20], ['partition', 6, 21]]) {
    const f = createPartitionFixture(t), plan = prepare(f, input);
    assert.deepEqual(plan.originalBatches.map(part => part.windowCount), [21]);
    assert.equal(plan.originalBatches[0].extractionFits, true);
    assert.ok(plan.originalBatches[0].extractionTokens <= 6000);
    assert.deepEqual(plan.partitions.map(part => part.windowCount), [20, 1]);
    assert.ok(input.sources[0].messages.every(message => message.content.length === 800));
    const result = await run(f, input, plan, arm);
    assert.equal(result.stopped, false);
    assert.equal(result.semanticCoverage, 'unassessed');
    assert.deepEqual(result.outcomes.map(outcome => outcome.status),
      Array(arm === 'partition' ? 2 : 1).fill('completed'));
    assert.deepEqual(f.calls.map(call => call.method), arm === 'partition'
      ? ['extract', 'classify', 'extract', 'classify'] : ['extract', 'classify']);
    const extracts = f.calls.filter(call => call.method === 'extract');
    assert.deepEqual(extracts.flatMap(call => call.input.messages.map(message => message.content)),
      input.sources[0].messages.map(message => message.content));
    assert.deepEqual(extracts.flatMap(call => call.input.messages.map(message => message.role)),
      input.sources[0].messages.map(message => message.role));
    f.close();
    const cold = f.open(coldThrowingModel(f.countTokens));
    const memories = listAll(cold.core), receipts = memories.flatMap(memory => allReceipts(cold.core, memory.id));
    assert.equal(memories.length, expectedCards);
    assert.equal(receipts.length, expectedSources);
    assert.deepEqual(tuples(receipts), tuples(expectedReceipts(plan, expectedSources)));
    assert.ok(memories.every(memory => requireOk(cold.core.get({ namespace, memoryId: memory.id })).placements.length > 0));
    assert.ok(receipts.every(receipt => !Object.hasOwn(receipt, 'date') && !Object.hasOwn(receipt, 'originalMessageIndex')));
    summaries.push(memoryDetails(cold.core).map(memory => memory.content).sort());
    cold.close();
  }
  assert.ok(summaries[0].every(summary => summaries[1].includes(summary)));
  assert.equal(new Set(summaries[1]).size, 6); // Exact source-member summaries, not synthetic bundle indices.
});

test('SP3 dense six-fact source remains fully evidenced although five scripted cards omit fact six', async t => {
  const input = sourceInput([{ id: 'synthetic-dense', role: 'user', content: sixFacts.join(' ') }]);
  const f = createPartitionFixture(t, { extract: () => ({ items: sixFacts.slice(0, 5).map(content => ({
    content, kind: 'fact', confidence: 0.8, sourceIndices: [0],
  })) }) });
  const plan = prepare(f, input);
  assert.equal(plan.origins.length, 1);
  assert.equal((await run(f, input, plan)).stopped, false);
  f.close();
  const cold = f.open(coldThrowingModel(f.countTokens)), memories = memoryDetails(cold.core);
  assert.equal(memories.length, 5);
  assert.ok(memories.every(memory => !memory.content.includes(sixFacts[5])));
  assert.ok(memories.every(memory => allReceipts(cold.core, memory.id)[0].excerpt === sixFacts.join(' ')));
  // Structured-card coverage is not receipt coverage or measured answer utility.
});

test('SP3 illustrative boundary extractor can lose joint negation while exact input order survives', async t => {
  const messages = windowMessages(21, 'synthetic-boundary');
  for (const [index, statement] of [[19, boundaryStatements[0]], [20, boundaryStatements[1]]]) {
    const head = statement + ' | synthetic filler ';
    messages[index].content = head + 'x'.repeat(800 - head.length);
  }
  const input = sourceInput(messages), f = createPartitionFixture(t, { extract: request => {
    const boundary = request.input.messages.find(message => message.content.startsWith('SYNTHETIC proposal:'));
    return boundary ? { items: [{ content: 'SYNTHETIC illustrative mistake: adopted blue tray.',
      kind: 'context', confidence: 0.8, sourceIndices: [boundary.index] }] } : bundleExtraction(request);
  } });
  const plan = prepare(f, input);
  assert.equal(plan.partitions[0].origins.at(-1).originalMessageIndex, 19);
  assert.equal(plan.partitions[1].origins[0].originalMessageIndex, 20);
  await run(f, input, plan);
  assert.deepEqual(f.calls.filter(call => call.method === 'extract').flatMap(call => call.input.messages.map(message => message.content)),
    messages.map(message => message.content));
  assert.ok(memoryDetails(f.core).some(memory => memory.content.includes('illustrative mistake')));
  // Scripted counterexample only: no LM result, adoption inference, or semantic score.
});

test('SP4 whole-plan late tampering/getter/sparse/event/date/coordinate denials precede all capture', async t => {
  const f = createPartitionFixture(t), input = sourceInput(windowMessages(21)), plan = prepare(f, input);
  const seed = admitSynthetic(f.core, 'SYNTHETIC untouched seed.'), before = listAll(f.core);
  let getterReads = 0;
  const edits = [
    value => { value.partitions[1].messages[0].content = 'SYNTHETIC changed.'; },
    value => { value.partitions[1].messages[0].id = 'synthetic-other'; },
    value => { value.partitions[1].messages[0].role = 'assistant'; },
    value => { value.partitions[1].eventId = value.partitions[0].eventId; },
    value => { value.partitions[1].origins[0].date = '2026-10-05'; },
    value => { value.partitions[1].origins[0].originalMessageIndex = 0; },
    value => { value.partitions.reverse(); },
    value => { value.partitions.pop(); },
    value => { delete value.partitions[1]; value.partitions.extra = value.partitions[0]; },
    value => { Object.defineProperty(value.partitions[1].messages[0], 'content', { enumerable: true,
      get() { getterReads++; return 'SYNTHETIC getter'; } }); },
  ];
  for (const [index, edit] of edits.entries()) {
    const changed = structuredClone(plan); edit(changed);
    await assert.rejects(run(f, input, changed), error => error.code ===
      (index >= 8 ? 'diagnostic_input_invalid' : 'diagnostic_plan_invalid'));
    assert.equal(f.calls.length, 0);
  }
  assert.equal(getterReads, 0);
  f.close();
  const cold = f.open(coldThrowingModel(f.countTokens));
  assert.deepEqual(listAll(cold.core), before);
  assert.equal(allReceipts(cold.core, seed.id).length, 1);
});

test('SP4 first await cannot expose caller mutation to a later partition', async t => {
  const input = sourceInput(windowMessages(21)), original = structuredClone(input);
  let suppliedPlan, extraction = 0;
  const f = createPartitionFixture(t, { extract: request => {
    if (++extraction === 1) {
      input.sources[0].messages[20].content = 'SYNTHETIC caller mutation.';
      input.sources[0].date = '2026-10-09';
      suppliedPlan.partitions[1].messages[0].role = 'assistant';
      suppliedPlan.partitions[1].eventId = 'synthetic-mutated-event';
    }
    return bundleExtraction(request);
  } });
  suppliedPlan = structuredClone(prepare(f, input));
  const expectedEvent = suppliedPlan.partitions[1].eventId;
  const result = await run(f, input, suppliedPlan);
  assert.equal(result.stopped, false);
  assert.equal(result.outcomes[1].eventId, expectedEvent);
  assert.deepEqual(f.calls.filter(call => call.method === 'extract').flatMap(call => call.input.messages.map(message => ({
    role: message.role, content: message.content,
  }))), original.sources[0].messages.map(({ role, content }) => ({ role, content })));
  assert.deepEqual(f.calls.map(call => call.method), ['extract', 'classify', 'extract', 'classify']);
});
