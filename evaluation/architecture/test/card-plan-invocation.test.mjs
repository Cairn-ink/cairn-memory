import assert from 'node:assert/strict';
import test from 'node:test';
import { consumeCardPlan } from '../card-plan-rank.mjs';

const module = await import('../card-plan-invocation.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.message.includes('/card-plan-invocation.mjs')) return {};
  throw error;
});
const code = expected => error => error?.code === expected;
const singletons = selectedCards => ({ selectedCards, chains: selectedCards.map((_, slot) => ({
  members: [slot], sources: [{ member: 0, receipt: 0 }], terminal: 0 })) });
const request = (controller = new AbortController()) => ({ system: 'Actual core instruction',
  input: { query: 'Which shelf applies to courier Juniper?', limit: 6,
    candidates: Array.from({ length: 7 }, (_, i) => ({ namespaceIndex: 0,
      memory: { id: `card-${i}`, revision: 1, currentness: 'current' },
      receipts: [{ id: `receipt-${i}`, role: i % 2 ? 'assistant' : 'user', excerpt: `Exact inert source ${i}` }],
      receiptCount: 1, interpretationStatus: 'omitted', sourceSelectionCoverage: 'unassessed' })) },
  maxOutputTokens: 1024, signal: controller.signal });
const base = counter => ({ contextWindow: 8192, countTokens: counter ?? (() => 1),
  select() { assert.fail('No select permitted'); }, rank() { assert.fail('No base rank permitted'); },
  marker: 'bound-base', extract() { return this.marker; } });

test('CW1 invocation exposes the frozen one-shot model/takePlan interface', async () => {
  assert.equal(typeof module.createCardPlanRankInvocation, 'function', 'New invocation factory must exist');
  const input = request(), raw = singletons([4, 0, 2]); let calls = 0, wire;
  const invocation = module.createCardPlanRankInvocation(base(), { planRank(actual) { calls++; wire = actual; return raw; } });
  assert.deepEqual(Object.keys(invocation), ['model', 'takePlan']); assert(Object.isFrozen(invocation));
  assert(Object.isFrozen(invocation.model)); assert.equal(invocation.model.extract(), 'bound-base');
  assert.throws(invocation.takePlan, code('invalid_card_plan'));
  const returned = await invocation.model.rank(input);
  assert.equal(calls, 1); assert.equal(wire.signal, input.signal);
  assert.deepEqual(wire.input.cards.map(card => card.candidateIndex), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(returned.refs.map(ref => ref.memoryId), ['card-4', 'card-0', 'card-2']);
  raw.selectedCards[0] = 6; input.input.candidates[0].receipts[0].excerpt = 'Changed outside';
  const compiled = invocation.takePlan(); assert.deepEqual(compiled.proposal.selectedCards, [4, 0, 2]);
  assert.equal(compiled.originalInput.candidates[0].receipts[0].excerpt, 'Exact inert source 0');
  assert.equal(consumeCardPlan(compiled), compiled, 'Take returns genuine compiler ownership, not a clone');
  assert.throws(() => consumeCardPlan(compiled), code('invalid_card_plan'));
  assert.throws(invocation.takePlan, code('invalid_card_plan'));
  await assert.rejects(invocation.model.rank(request()), code('card_invocation_conflict'));
});

test('CW2 concurrent rank, planning take, failure and cancellation permanently deny reuse', async () => {
  assert.equal(typeof module.createCardPlanRankInvocation, 'function');
  let release, calls = 0;
  const invocation = module.createCardPlanRankInvocation(base(), { planRank() { calls++; return new Promise(resolve => { release = resolve; }); } });
  const running = invocation.model.rank(request()); assert.throws(invocation.takePlan, code('invalid_card_plan'));
  await assert.rejects(invocation.model.rank(request()), code('card_invocation_conflict'));
  release(singletons([0])); await running; assert.equal(calls, 1); invocation.takePlan();
  for (const mode of ['planner', 'before', 'after', 'output-count']) {
    const controller = new AbortController(); let planned = 0;
    if (mode === 'before') controller.abort();
    const failed = module.createCardPlanRankInvocation(base(text => {
      if (mode === 'output-count' && text.startsWith('{"refs":')) controller.abort(); return 1;
    }), { planRank() { planned++; if (mode === 'planner') throw new Error('inert planner failure');
      if (mode === 'after') controller.abort(); return singletons([0]); } });
    await assert.rejects(failed.model.rank(request(controller)), mode === 'planner' ? /inert planner failure/ : { name: 'AbortError' });
    assert.equal(planned, mode === 'before' ? 0 : 1); assert.throws(failed.takePlan, code('invalid_card_plan'));
    await assert.rejects(failed.model.rank(request()), code('card_invocation_conflict'));
  }
});

test('CW1/2 configured counter/context, descriptors, closed options and output limits fail at their boundaries', async () => {
  assert.equal(typeof module.createCardPlanRankInvocation, 'function');
  const factory = module.createCardPlanRankInvocation;
  assert.throws(() => factory({ contextWindow: 8192 }, { planRank() {} }), code('token_count_unavailable'));
  assert.throws(() => factory(base(), { planRank() {}, onPlan() {} }), code('invalid_input'));
  assert.throws(() => factory({ ...base(), contextWindow: 8191 }, { planRank() {} }), code('context_budget_exceeded'));
  let hooks = 0; const trap = () => { hooks++; throw new Error('untrusted hook'); };
  const getter = Object.defineProperty({}, 'planRank', { enumerable: true, get: trap });
  assert.throws(() => factory(base(), getter), code('invalid_input'));
  assert.throws(() => factory(new Proxy(base(), { ownKeys: trap }), { planRank() {} }), code('model_not_configured'));
  for (const mutation of ['proxy', 'getter', 'sparse']) {
    const actual = request();
    if (mutation === 'proxy') actual.input.candidates[0] = new Proxy(actual.input.candidates[0], { ownKeys: trap });
    if (mutation === 'getter') Object.defineProperty(actual.input.candidates[0], 'receipts', { enumerable: true, get: trap });
    if (mutation === 'sparse') delete actual.input.candidates[0];
    const f = factory(base(), { planRank() { assert.fail('Invalid input precedes planner'); } });
    await assert.rejects(f.model.rank(actual), code('invalid_input')); assert.throws(f.takePlan, code('invalid_card_plan'));
  }
  assert.equal(hooks, 0);
  for (const bad of [singletons([0, 1, 2, 3, 4, 5, 6]),
    { selectedCards: [0, 1, 2, 3], chains: [{ members: [0, 1, 2, 3],
      sources: [0, 1, 2, 3].map(member => ({ member, receipt: 0 })), terminal: 3 }] },
    { bundles: [] }, new Proxy(singletons([0]), { ownKeys: trap })]) {
    const f = factory(base(), { planRank: () => bad });
    await assert.rejects(f.model.rank(request()), code('invalid_model_output')); assert.throws(f.takePlan, code('invalid_card_plan'));
  }
  for (const count of [() => 6001, text => text.startsWith('{"refs":') ? 1025 : 1]) {
    const f = factory(base(count), { planRank: () => singletons([0]) });
    await assert.rejects(f.model.rank(request()), code(count('') === 6001 ? 'context_budget_exceeded' : 'invalid_model_output'));
    assert.throws(f.takePlan, code('invalid_card_plan'));
  }
  assert.equal(hooks, 0);
});
