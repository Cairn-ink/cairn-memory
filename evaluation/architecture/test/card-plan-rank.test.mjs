import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { prepareCardPlanRankRequest, compileCardPlan, consumeCardPlan,
  CARD_PLAN_RANK_INSTRUCTION } from '../card-plan-rank.mjs';

const counter = text => Math.ceil(text.length / 4);
const denied = expected => error => error.code === expected;
const candidate = (index, receipts = 1) => ({ namespaceIndex: 0,
  memory: { id: `card-${index}`, revision: 1, currentness: 'current' },
  receipts: Array.from({ length: receipts }, (_, receipt) => ({ id: `source-${index}-${receipt}`,
    role: receipt % 2 ? 'assistant' : 'user', excerpt: `Exact inert source ${index}/${receipt}` })),
  receiptCount: receipts, interpretationStatus: 'omitted', sourceSelectionCoverage: 'unassessed' });
const request = (limit = 6, candidates = Array.from({ length: 7 }, (_, i) => candidate(i))) => ({
  system: 'Actual core source ranking instruction', input: { query: 'Which source applies?', limit, candidates },
  maxOutputTokens: 1024, signal: new AbortController().signal });
const singletons = selectedCards => ({ selectedCards, chains: selectedCards.map((_, slot) => ({
  members: [slot], sources: [{ member: 0, receipt: 0 }], terminal: 0 })) });

test('CP1/2 source-only schema bounds encode card and chain budgets directly at every limit', () => {
  for (let limit = 1; limit <= 6; limit++) {
    const actual = request(limit), prepared = prepareCardPlanRankRequest(actual, counter);
    const schema = prepared.request.outputSchema;
    assert.deepEqual(schema.required, ['selectedCards', 'chains']);
    assert.equal(schema.additionalProperties, false);
    assert.equal(schema.properties.selectedCards.maxItems, limit);
    assert.equal(schema.properties.selectedCards.items.maximum, 6);
    assert.equal(schema.properties.chains.maxItems, 6);
    const shape = schema.properties.chains.items.properties;
    assert.equal(shape.members.maxItems, 3); assert.equal(shape.members.minItems, 1);
    assert.equal(shape.sources.maxItems, 6); assert.equal(shape.sources.minItems, 1);
    assert.equal(shape.terminal.maximum, 5);
    assert.equal(shape.sources.items.properties.member.maximum, 2);
    assert.equal(shape.sources.items.properties.receipt.maximum, 99);
    assert.equal(prepared.request.system, CARD_PLAN_RANK_INSTRUCTION);
    assert.deepEqual(prepared.request.input, { query: actual.input.query, limit,
      cards: actual.input.candidates.map((card, candidateIndex) => ({ candidateIndex, ...card })) });
    assert.equal(prepared.requestSha256, createHash('sha256').update(JSON.stringify(prepared.request)).digest('hex'));
    const raw = singletons(Array.from({ length: limit }, (_, i) => limit - i - 1));
    const compiled = compileCardPlan(prepared, raw);
    assert.deepEqual(compiled.proposal, raw);
    assert.deepEqual(compiled.refs.map(ref => ref.memoryId), raw.selectedCards.map(i => `card-${i}`));
    assert(Object.isFrozen(compiled.proposal.chains[0].sources[0]));
  }
});

test('CP2 six singleton chains, disjoint pairs, six receipts and shared prerequisite are expressible', () => {
  const prepared = prepareCardPlanRankRequest(request(6, Array.from({ length: 6 }, (_, i) => candidate(i, 6))), counter);
  for (const proposal of [singletons([0, 1, 2, 3, 4, 5]),
    { selectedCards: [5, 4, 3, 2, 1, 0], chains: [0, 2, 4].map(i => ({ members: [i, i + 1],
      sources: [{ member: 0, receipt: 0 }, { member: 1, receipt: 1 }], terminal: 1 })) },
    { selectedCards: [0], chains: [{ members: [0], sources: Array.from({ length: 6 }, (_, receipt) => ({ member: 0, receipt })), terminal: 5 }] },
    { selectedCards: [0, 1, 2], chains: [1, 2].map(i => ({ members: [0, i],
      sources: [{ member: 0, receipt: 2 }, { member: 1, receipt: 4 }], terminal: 1 })) },
    { selectedCards: [], chains: [] }]) assert.deepEqual(compileCardPlan(prepared, proposal).proposal, proposal);
});

test('CP2/6 invalid old four-card/seven-total shapes and malformed indices fail without repair', () => {
  const prepared = prepareCardPlanRankRequest(request(), counter);
  const bad = [
    { bundles: [{ sourceIndices: [0, 1, 2, 3], terminalSourceIndex: 3 }] },
    singletons([0, 1, 2, 3, 4, 5, 6]),
    { selectedCards: [0, 1, 2, 3], chains: [{ members: [0, 1, 2, 3], sources: [0, 1, 2, 3].map(member => ({ member, receipt: 0 })), terminal: 3 }] },
    singletons([0, 0]), singletons([7]), singletons([-1]), singletons([-0]), singletons([1.1]), singletons(['0']),
    { selectedCards: [], chains: singletons([0]).chains }, { selectedCards: [0], chains: [] },
    { selectedCards: [0, 1], chains: singletons([0]).chains },
  ];
  for (const path of ['members', 'sources', 'terminal', 'receipt', 'member']) {
    const proposal = singletons([0]);
    if (path === 'members') proposal.chains[0].members = [0, 0];
    if (path === 'sources') proposal.chains[0].sources.push({ member: 0, receipt: 0 });
    if (path === 'terminal') proposal.chains[0].terminal = 1;
    if (path === 'receipt') proposal.chains[0].sources[0].receipt = 1;
    if (path === 'member') proposal.chains[0].sources[0].member = 1;
    bad.push(proposal);
  }
  for (const value of [-0, -1, 0.5, '0', null, 99]) for (const field of ['terminal', 'member', 'receipt']) {
    const proposal = singletons([0]);
    if (field === 'terminal') proposal.chains[0].terminal = value;
    else proposal.chains[0].sources[0][field] = value;
    bad.push(proposal);
  }
  const sevenSources = singletons([0]);
  sevenSources.chains[0].sources = Array.from({ length: 7 }, (_, receipt) => ({ member: 0, receipt }));
  bad.push(sevenSources, { selectedCards: [0], chains: Array.from({ length: 7 }, () => singletons([0]).chains[0]) });
  for (const raw of bad) assert.throws(() => compileCardPlan(prepared, raw), denied('invalid_model_output'));
  const unused = { selectedCards: [0, 1], chains: [{ members: [0, 1], sources: [{ member: 0, receipt: 0 }], terminal: 0 }] };
  assert.throws(() => compileCardPlan(prepared, unused), denied('invalid_model_output'));
  assert.throws(() => compileCardPlan(prepareCardPlanRankRequest(request(1), counter), singletons([0, 1])), denied('invalid_model_output'));
});

test('CP3 ownership, detached mutation, no executing proxy/getter/toJSON, sparse/inherited and cancellation', () => {
  const actual = request(), prepared = prepareCardPlanRankRequest(actual, counter), raw = singletons([0]);
  actual.input.candidates[0].receipts[0].excerpt = 'Mutated';
  const compiled = compileCardPlan(prepared, raw); raw.selectedCards[0] = 1;
  assert.equal(compiled.originalInput.candidates[0].receipts[0].excerpt, 'Exact inert source 0/0');
  assert.deepEqual(compiled.proposal.selectedCards, [0]);
  assert.throws(() => compileCardPlan(structuredClone(prepared), singletons([0])), denied('invalid_input'));
  assert.throws(() => consumeCardPlan(structuredClone(compiled)), denied('invalid_card_plan'));
  assert.equal(consumeCardPlan(compiled), compiled);
  assert.throws(() => consumeCardPlan(compiled), denied('invalid_card_plan'));
  let executed = 0;
  const trap = () => { executed++; throw new Error('Executed untrusted code'); };
  const accessor = {}; Object.defineProperty(accessor, 'selectedCards', { enumerable: true, get: trap });
  const proxy = new Proxy(singletons([0]), { ownKeys: trap, getPrototypeOf: trap, get: trap });
  for (const bad of [accessor, proxy, { ...singletons([0]), toJSON: trap },
    Object.assign(Object.create({ inherited: true }), singletons([0])),
    { selectedCards: new Array(1), chains: [] }]) assert.throws(() => compileCardPlan(prepared, bad), denied('invalid_model_output'));
  assert.throws(() => prepareCardPlanRankRequest(new Proxy(request(), { ownKeys: trap }), counter), denied('invalid_input'));
  const proxied = request(); proxied.input.candidates[0] = new Proxy(candidate(0), { ownKeys: trap });
  assert.throws(() => prepareCardPlanRankRequest(proxied, counter), denied('invalid_input'));
  const accessorSignal = request();
  Object.defineProperty(accessorSignal.signal, 'aborted', { get: trap });
  assert.throws(() => prepareCardPlanRankRequest(accessorSignal, counter), denied('invalid_input'));
  assert.equal(executed, 0);
  const controller = new AbortController(), pending = request(); pending.signal = controller.signal;
  const cancelled = prepareCardPlanRankRequest(pending, counter); controller.abort();
  assert.throws(() => compileCardPlan(cancelled, singletons([0])), { name: 'AbortError' });
  assert.throws(() => prepareCardPlanRankRequest(pending, counter), { name: 'AbortError' });
});

test('CP1/3 actual full request and raw-output budgets fail visibly without retry or clipping', () => {
  let measured;
  const actual = request();
  prepareCardPlanRankRequest(actual, text => { measured = text; return 6000; });
  assert.equal(JSON.parse(measured).outputSchema.properties.selectedCards.maxItems, 6);
  assert.throws(() => prepareCardPlanRankRequest(actual, () => 6001), denied('context_budget_exceeded'));
  const prepared = prepareCardPlanRankRequest(actual, text => text.includes('selectedCards') && !text.includes('outputSchema') ? 1025 : 1);
  assert.throws(() => compileCardPlan(prepared, singletons([0])), denied('invalid_model_output'));
  assert.throws(() => prepareCardPlanRankRequest(request(6, Array.from({ length: 37 }, (_, i) => candidate(i))), counter), denied('invalid_input'));
  assert.throws(() => prepareCardPlanRankRequest(request(6, [candidate(0, 101)]), counter), denied('invalid_input'));
  const duplicate = request(6, [candidate(0), candidate(0)]);
  assert.throws(() => prepareCardPlanRankRequest(duplicate, counter), denied('invalid_input'));
  const empty = prepareCardPlanRankRequest(request(6, []), counter);
  assert.deepEqual(compileCardPlan(empty, { selectedCards: [], chains: [] }).refs, []);
  const controller = new AbortController(), aborting = request(); aborting.signal = controller.signal;
  assert.throws(() => prepareCardPlanRankRequest(aborting, () => { controller.abort(); return 1; }), { name: 'AbortError' });
});
