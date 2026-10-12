import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { prepareCardPlanRankRequest, consumeCardPlan } from '../card-plan-rank.mjs';
import { prepareReceiptGroupPlan, compileReceiptGroupPlan,
  createReceiptGroupInvocation, assembleReceiptGroupPlan,
  RECEIPT_GROUP_RANK_INSTRUCTION } from '../receipt-group-plan.mjs';

const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const counter = text => Math.ceil(text.length / 4);
const card = (id, count = 2) => ({ namespaceIndex: 0,
  memory: { id: `parcel-${id}`, revision: 3, currentness: 'current' },
  receipts: Array.from({ length: count }, (_, i) => ({ id: `receipt-${id}-${i}`,
    role: i % 2 ? 'assistant' : 'user', excerpt: `Exact inert passage ${id}/${i}` })),
  receiptCount: count, interpretationStatus: 'omitted', sourceSelectionCoverage: 'unassessed' });
const request = (cards = Array.from({ length: 7 }, (_, i) => card(i)), limit = 6) => ({
  system: 'Actual source-evidence core rank envelope',
  input: { query: 'Which parcel source applies to the north depot?', limit, candidates: cards },
  maxOutputTokens: 1024, signal: new AbortController().signal });
// Literal oracle deliberately uses IDs and expected identities, not a copy of
// the compiler's index derivation. Terminal is on a card already in context.
const proposal = { groups: [
  { contextReceiptIds: ['receipt-5-1', 'receipt-1-0', 'receipt-5-0'], terminalReceiptId: 'receipt-0-1' },
  { contextReceiptIds: ['receipt-5-1', 'receipt-0-0'], terminalReceiptId: 'receipt-5-0' },
] };
const expectedRefs = [5, 1, 0].map(i => ({ namespaceIndex: 0, memoryId: `parcel-${i}`, revision: 3 }));
const code = expected => error => error?.code === expected;
const singleton = id => ({ contextReceiptIds: [], terminalReceiptId: id });

test('RG1 prospective wire preserves exact cards and supplies only receipt-ID group fields', () => {
  const input = request(), prepared = prepareReceiptGroupPlan(input, counter);
  assert.deepEqual(prepared.request.input, { query: input.input.query, limit: 6, cards: input.input.candidates },
    'No generated candidate/member/source-slot indices may enter the actual successor request');
  const schema = prepared.request.outputSchema;
  assert.deepEqual(schema.required, ['groups']); assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.groups.maxItems, 6);
  assert.deepEqual(schema.properties.groups.items.required, ['contextReceiptIds', 'terminalReceiptId']);
  assert.equal(schema.properties.groups.items.additionalProperties, false);
  const shape = schema.properties.groups.items.properties;
  assert.deepEqual(Object.keys(shape.contextReceiptIds), ['type', 'minItems', 'maxItems', 'items'],
    'Model-facing array constraints stay within the documented Structured Outputs subset');
  assert.equal(shape.contextReceiptIds.maxItems, 5);
  assert.deepEqual(shape.contextReceiptIds.items.enum,
    input.input.candidates.flatMap(candidate => candidate.receipts.map(receipt => receipt.id)));
  assert.deepEqual(shape.terminalReceiptId.enum, shape.contextReceiptIds.items.enum);
  assert.equal(prepared.requestSha256, sha(prepared.request));
  assert.equal(prepared.request.system, RECEIPT_GROUP_RANK_INSTRUCTION);
  for (const term of ['UNVERIFIED', 'prerequisite', 'adoption', 'identity', 'currentness', 'truth',
    'subject', 'scope', 'time', 'proposal', 'quotation', 'uncertainty', 'untrusted', 'execution authority']) {
    assert(prepared.request.system.includes(term), term);
  }
});

test('RG2/3 prospective valid receipt groups lower by first occurrence independently of candidate order', () => {
  for (const cards of [Array.from({ length: 7 }, (_, i) => card(i)),
    [2, 0, 6, 1, 4, 5, 3].map(i => card(i)), Array.from({ length: 7 }, (_, i) => card(6 - i))]) {
    const input = request(cards), prepared = prepareReceiptGroupPlan(input, counter); let compiled;
    assert.doesNotThrow(() => { compiled = compileReceiptGroupPlan(prepared, structuredClone(proposal)); },
      'Valid exact supplied receipt-ID groups must compile at the actual successor seam');
    assert.deepEqual(compiled.refs, expectedRefs, 'Context then terminal, group order, first card occurrence');
    assert.deepEqual(compiled.proposal, proposal, 'Literal model output is preserved, never replaced by indices');
    assert.equal(compiled.origin, 'receipt-group-derived-card-assembly-v1');
    assert.equal(compiled.requestSha256, sha(prepared.request));
    assert.equal(compiled.proposalSha256, sha(proposal));
    assert.equal(compiled.derivedAssemblyRequestSha256,
      sha(prepareCardPlanRankRequest(input, counter).request), 'Independent old CP request is explicitly derived');
    assert.deepEqual(compiled.diagnostics.derivedAssemblyProposal, {
      selectedCards: [5, 1, 0].map(id => cards.findIndex(candidate => candidate.memory.id === `parcel-${id}`)),
      chains: [
        { members: [0, 1, 2], sources: [{ member: 0, receipt: 1 }, { member: 1, receipt: 0 },
          { member: 0, receipt: 0 }, { member: 2, receipt: 1 }], terminal: 3 },
        { members: [0, 2], sources: [{ member: 0, receipt: 1 }, { member: 1, receipt: 0 },
          { member: 0, receipt: 0 }], terminal: 2 },
      ],
    }, 'Literal independent member/receipt/terminal oracle; hashes do not confer capability');
  }
});

test('RG5 prospective callback sees successor wire once and returned refs retain receipt firstness', async () => {
  let calls = 0, wire;
  const invocation = createReceiptGroupInvocation({ contextWindow: 8192, countTokens: counter,
    select() { assert.fail('No select'); }, rank() { assert.fail('No base rank'); } },
  { planRank(actual) { calls++; wire = actual; return structuredClone(proposal); } });
  const input = request();
  const returned = await invocation.model.rank(input);
  assert.equal(calls, 1); assert.equal(wire.signal, input.signal);
  assert.deepEqual(wire.input, { query: input.input.query, limit: 6, cards: input.input.candidates });
  assert.deepEqual(returned.refs, expectedRefs);
  assert.deepEqual(invocation.takePlan().proposal, proposal);
  assert.throws(invocation.takePlan, code('invalid_receipt_group_plan'));
  await assert.rejects(invocation.model.rank(request()), code('receipt_group_invocation_conflict')); assert.equal(calls, 1);
});

test('RG2/7 limits 1..6, six singletons, one-card six endpoints, empty and equal-text distinct cards', () => {
  for (let limit = 1; limit <= 6; limit++) {
    const prepared = prepareReceiptGroupPlan(request(undefined, limit), counter);
    const raw = { groups: Array.from({ length: limit }, (_, i) => singleton(`receipt-${limit - i - 1}-0`)) };
    assert.deepEqual(compileReceiptGroupPlan(prepared, raw).refs.map(ref => ref.memoryId),
      Array.from({ length: limit }, (_, i) => `parcel-${limit - i - 1}`));
    assert.throws(() => compileReceiptGroupPlan(prepared, { groups: Array.from({ length: limit + 1 },
      (_, i) => singleton(`receipt-${i}-0`)) }), code('invalid_model_output'));
  }
  const prepared = prepareReceiptGroupPlan(request([card('six', 6)]), counter);
  const raw = { groups: [{ contextReceiptIds: [4, 0, 3, 1, 5].map(i => `receipt-six-${i}`), terminalReceiptId: 'receipt-six-2' }] };
  const six = compileReceiptGroupPlan(prepared, raw);
  assert.deepEqual(six.diagnostics.derivedAssemblyProposal, { selectedCards: [0], chains: [{ members: [0],
    sources: [4, 0, 3, 1, 5, 2].map(receipt => ({ member: 0, receipt })), terminal: 5 }] });
  assert.deepEqual(compileReceiptGroupPlan(prepared, { groups: [] }).refs, []);
  assert.deepEqual(compileReceiptGroupPlan(prepareReceiptGroupPlan(request([]), counter), { groups: [] }).refs, []);
  const twins = [card('cedar', 1), card('birch', 1)];
  twins.forEach(candidate => { candidate.receipts[0].excerpt = 'The very same literal source bytes.'; });
  const copies = compileReceiptGroupPlan(prepareReceiptGroupPlan(request(twins), counter),
    { groups: [singleton('receipt-birch-0'), singleton('receipt-cedar-0')] });
  assert.deepEqual(copies.refs.map(ref => ref.memoryId), ['parcel-birch', 'parcel-cedar']);
});

test('RG2/7 invalid output rejects exact IDs, duplicates, budgets and extra fields without repair', () => {
  const prepared = prepareReceiptGroupPlan(request(), counter);
  const bad = [null, [], {}, { groups: {} }, { groups: [], extra: true },
    { groups: [singleton('unknown')] }, { groups: [singleton(' receipt-0-0')] },
    { groups: [singleton('RECEIPT-0-0')] }, { groups: [singleton(0)] }, { groups: [singleton(null)] },
    { groups: [{ contextReceiptIds: ['receipt-0-0', 'receipt-0-0'], terminalReceiptId: 'receipt-1-0' }] },
    { groups: [{ contextReceiptIds: ['receipt-0-0'], terminalReceiptId: 'receipt-0-0' }] },
    { groups: [{ contextReceiptIds: [0], terminalReceiptId: 'receipt-1-0' }] },
    { groups: [{ contextReceiptIds: 'receipt-0-0', terminalReceiptId: 'receipt-1-0' }] },
    { groups: [{ contextReceiptIds: [], terminalReceiptId: 'receipt-0-0', reason: 'inferred' }] },
    { groups: [{ terminalReceiptId: 'receipt-0-0' }] }, { groups: [{ contextReceiptIds: [] }] },
    { groups: Array.from({ length: 7 }, (_, i) => singleton(`receipt-${i}-0`)) },
    { groups: [{ contextReceiptIds: [0, 1, 2].map(i => `receipt-${i}-0`), terminalReceiptId: 'receipt-3-0' }] },
    { groups: [{ contextReceiptIds: [0, 1, 2, 3, 4, 5].map(i => `receipt-${i}-0`), terminalReceiptId: 'receipt-6-0' }] },
    { groups: new Array(1) }, { groups: [{ contextReceiptIds: new Array(1), terminalReceiptId: 'receipt-0-0' }] },
  ];
  for (const raw of bad) assert.throws(() => compileReceiptGroupPlan(prepared, raw), code('invalid_model_output'));
});

test('RG1/4 hostile descriptors and cloned/forged ownership cannot execute hooks or expose CP authority', () => {
  let hooks = 0;
  const trap = () => { hooks++; throw new Error('Untrusted hook'); };
  const actual = request(), prepared = prepareReceiptGroupPlan(actual, counter), raw = structuredClone(proposal);
  const compiled = compileReceiptGroupPlan(prepared, raw);
  actual.input.candidates[5].receipts[1].excerpt = 'Mutated caller bytes'; raw.groups[0].contextReceiptIds.reverse();
  assert.deepEqual(compiled.proposal, proposal);
  assert.equal(compiled.originalInput.candidates[5].receipts[1].excerpt, 'Exact inert passage 5/1');
  assert(Object.isFrozen(compiled)); assert(Object.isFrozen(compiled.proposal.groups[0].contextReceiptIds));
  assert(Object.isFrozen(compiled.diagnostics.derivedAssemblyProposal.chains[0].sources[0]));
  assert.equal(Object.hasOwn(compiled, 'internal'), false);
  assert.throws(() => consumeCardPlan(compiled), code('invalid_card_plan'));
  assert.throws(() => consumeCardPlan(compiled.diagnostics.derivedAssemblyProposal), code('invalid_card_plan'));
  assert.throws(() => { compiled.proposal.groups[0].contextReceiptIds.push('receipt-2-0'); }, TypeError);
  assert.throws(() => compileReceiptGroupPlan(structuredClone(prepared), proposal), code('invalid_input'));
  assert.throws(() => compileReceiptGroupPlan(new Proxy(prepared, { get: trap }), proposal), code('invalid_input'));
  const options = value => ({ compiled: value, recall: {}, core: {}, plan: {}, namespace: {}, question: {} });
  for (const fake of [structuredClone(compiled), { ...compiled }, new Proxy(compiled, { get: trap })]) {
    assert.throws(() => assembleReceiptGroupPlan(options(fake)), code('invalid_receipt_group_plan'));
  }
  const getter = Object.defineProperty({}, 'groups', { enumerable: true, get: trap });
  const nested = { groups: [Object.defineProperty({}, 'contextReceiptIds', { enumerable: true, get: trap })] };
  for (const bad of [getter, nested, new Proxy(proposal, { ownKeys: trap }),
    { groups: [new Proxy(proposal.groups[0], { getPrototypeOf: trap })] },
    { ...proposal, toJSON: trap }, Object.assign(Object.create({ toJSON: trap }), proposal)]) {
    assert.throws(() => compileReceiptGroupPlan(prepared, bad), code('invalid_model_output'));
  }
  for (const bad of [new Proxy(request(), { ownKeys: trap }),
    Object.assign(Object.create({ inherited: true }), request())]) {
    assert.throws(() => prepareReceiptGroupPlan(bad, counter), code('invalid_input'));
  }
  for (const mode of ['candidate-proxy', 'receipt-getter', 'signal-getter', 'sparse', 'duplicate-card', 'duplicate-receipt']) {
    const input = request();
    if (mode === 'candidate-proxy') input.input.candidates[0] = new Proxy(card(0), { ownKeys: trap });
    if (mode === 'receipt-getter') Object.defineProperty(input.input.candidates[0], 'receipts', { enumerable: true, get: trap });
    if (mode === 'signal-getter') Object.defineProperty(input.signal, 'aborted', { get: trap });
    if (mode === 'sparse') delete input.input.candidates[0];
    if (mode === 'duplicate-card') input.input.candidates[1].memory.id = input.input.candidates[0].memory.id;
    if (mode === 'duplicate-receipt') input.input.candidates[1].receipts[0].id = input.input.candidates[0].receipts[0].id;
    assert.throws(() => prepareReceiptGroupPlan(input, counter), code('invalid_input'));
  }
  assert.equal(hooks, 0);
  assert.throws(() => assembleReceiptGroupPlan(options(compiled)), code('invalid_card_plan_evidence'));
  assert.throws(() => assembleReceiptGroupPlan(options(compiled)), code('invalid_receipt_group_plan'),
    'Downstream failed assembly consumes the genuine wrapper');
});

test('RG1/3 actual and derived request/output/ref counts enforce independent unchanged caps', () => {
  const input = request(), measured = [];
  const prepared = prepareReceiptGroupPlan(input, text => { measured.push(JSON.parse(text)); return 1; });
  assert.equal(measured.length, 2);
  assert.deepEqual(measured[0], prepareCardPlanRankRequest(input, counter).request);
  assert.deepEqual(measured[1], prepared.request);
  compileReceiptGroupPlan(prepared, proposal);
  assert.deepEqual(measured.slice(2).map(value => Object.keys(value)), [['groups'], ['selectedCards', 'chains'], ['refs']]);
  for (const wire of ['old', 'successor']) {
    assert.throws(() => prepareReceiptGroupPlan(input, text => {
      const schema = JSON.parse(text).outputSchema;
      return schema?.properties[wire === 'old' ? 'selectedCards' : 'groups'] ? 6001 : 1;
    }), code('context_budget_exceeded'));
  }
  for (const wire of ['groups', 'selectedCards', 'refs']) {
    const bounded = prepareReceiptGroupPlan(input, text => {
      const value = JSON.parse(text);
      return Object.hasOwn(value, wire) && !Object.hasOwn(value, 'outputSchema') ? 1025 : 1;
    });
    assert.throws(() => compileReceiptGroupPlan(bounded, proposal), code('invalid_model_output'));
  }
  assert.throws(() => prepareReceiptGroupPlan(input, () => NaN), code('token_count_unavailable'));
  assert.throws(() => prepareReceiptGroupPlan(request(Array.from({ length: 37 }, (_, i) => card(i))), counter), code('invalid_input'));
  assert.throws(() => prepareReceiptGroupPlan(request([card('too-many', 101)]), counter), code('invalid_input'));
  // Existing identifiers cap each ID at 200 characters, so valid bounded
  // groups cannot reach 40000 characters. Keep escaped exact bytes intact;
  // the separately controlled actual-output counter above tests token overflow.
  const long = request([card('long', 6)]);
  long.input.candidates[0].receipts.forEach((receipt, i) => { receipt.id = `${i}-${'\\'.repeat(198)}`; });
  const ids = long.input.candidates[0].receipts.map(receipt => receipt.id);
  const large = prepareReceiptGroupPlan(long, () => 1);
  const literal = { groups: Array.from({ length: 6 }, () => ({ contextReceiptIds: ids.slice(0, 5), terminalReceiptId: ids[5] })) };
  assert(JSON.stringify(literal).length > 6000);
  assert.deepEqual(compileReceiptGroupPlan(large, literal).proposal, literal);
  long.input.candidates[0].receipts[0].id += 'x';
  assert.throws(() => prepareReceiptGroupPlan(long, () => 1), code('invalid_identifier'));
});

test('RG4/5 cancellation at every count and generation phase exhausts one invocation', async () => {
  for (const phase of ['before', 'old-request', 'successor-request', 'after-model', 'groups', 'selectedCards', 'refs']) {
    const controller = new AbortController(); let calls = 0;
    const input = request(); input.signal = controller.signal;
    if (phase === 'before') controller.abort();
    const invocation = createReceiptGroupInvocation({ contextWindow: 8192, countTokens(text) {
      const value = JSON.parse(text);
      if (phase === 'old-request' && value.outputSchema?.properties.selectedCards
        || phase === 'successor-request' && value.outputSchema?.properties.groups
        || ['groups', 'selectedCards', 'refs'].includes(phase) && Object.hasOwn(value, phase)) controller.abort();
      return 1;
    } }, { planRank() { calls++; if (phase === 'after-model') controller.abort(); return structuredClone(proposal); } });
    await assert.rejects(invocation.model.rank(input), { name: 'AbortError' });
    assert.equal(calls, ['before', 'old-request', 'successor-request'].includes(phase) ? 0 : 1);
    assert.throws(invocation.takePlan, code('invalid_receipt_group_plan'));
    await assert.rejects(invocation.model.rank(request()), code('receipt_group_invocation_conflict'));
  }
  const controller = new AbortController(), input = request(); input.signal = controller.signal;
  const prepared = prepareReceiptGroupPlan(input, counter); controller.abort();
  assert.throws(() => compileReceiptGroupPlan(prepared, proposal), { name: 'AbortError' });
  // Counting may mutate the caller's envelope. The validated original signal
  // stays bound to the successor, rather than rereading a swapped signal.
  const swapped = request(), original = new AbortController(); swapped.signal = original.signal;
  assert.throws(() => prepareReceiptGroupPlan(swapped, text => {
    if (JSON.parse(text).outputSchema.properties.groups) original.abort();
    swapped.signal = new AbortController().signal; return 1;
  }), { name: 'AbortError' });
  const cancelledInput = request(), cancelledController = new AbortController(); cancelledInput.signal = cancelledController.signal;
  const cancelled = compileReceiptGroupPlan(prepareReceiptGroupPlan(cancelledInput, counter), proposal); cancelledController.abort();
  const options = { compiled: cancelled, recall: {}, core: {}, plan: {}, namespace: {}, question: {} };
  assert.throws(() => assembleReceiptGroupPlan(options), { name: 'AbortError' });
  assert.throws(() => assembleReceiptGroupPlan(options), code('invalid_receipt_group_plan'));
});

test('RG5 concurrent generation, callback failures, options and configured-model controls', async () => {
  let release, calls = 0;
  const base = { contextWindow: 8192, countTokens: counter, marker: 'bound', extract() { return this.marker; } };
  const invocation = createReceiptGroupInvocation(base, { planRank() { calls++; return new Promise(resolve => { release = resolve; }); } });
  assert(Object.isFrozen(invocation)); assert(Object.isFrozen(invocation.model));
  assert.equal(invocation.model.extract(), 'bound');
  assert.throws(invocation.takePlan, code('invalid_receipt_group_plan'));
  const first = invocation.model.rank(request());
  assert.throws(invocation.takePlan, code('invalid_receipt_group_plan'));
  await assert.rejects(invocation.model.rank(request()), code('receipt_group_invocation_conflict'));
  release(structuredClone(proposal)); assert.deepEqual((await first).refs, expectedRefs); assert.equal(calls, 1);
  for (const raw of [() => { throw new Error('Inert generation failure'); }, () => ({ groups: [singleton('unknown')] })]) {
    const failed = createReceiptGroupInvocation(base, { planRank: raw });
    await assert.rejects(failed.model.rank(request()));
    assert.throws(failed.takePlan, code('invalid_receipt_group_plan'));
    await assert.rejects(failed.model.rank(request()), code('receipt_group_invocation_conflict'));
  }
  assert.throws(() => createReceiptGroupInvocation({ contextWindow: 8192 }, { planRank() {} }), code('token_count_unavailable'));
  assert.throws(() => createReceiptGroupInvocation({ ...base, contextWindow: 8191 }, { planRank() {} }), code('context_budget_exceeded'));
  assert.throws(() => createReceiptGroupInvocation(base, { planRank() {}, onPlan() {} }), code('invalid_input'));
  let hooks = 0; const trap = () => { hooks++; throw new Error('Untrusted model hook'); };
  assert.throws(() => createReceiptGroupInvocation(new Proxy(base, { ownKeys: trap }), { planRank() {} }), code('model_not_configured'));
  assert.throws(() => createReceiptGroupInvocation(base, Object.defineProperty({}, 'planRank', { enumerable: true, get: trap })), code('invalid_input'));
  assert.equal(hooks, 0);
});
