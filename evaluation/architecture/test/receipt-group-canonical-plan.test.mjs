import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { prepareCanonicalReceiptGroupPlan, compileCanonicalReceiptGroupPlan,
  createCanonicalReceiptGroupInvocation, assembleCanonicalReceiptGroupPlan,
  packCanonicalReceiptGroupAnswer, CANONICAL_RECEIPT_GROUP_POLICY,
  CANONICAL_RECEIPT_GROUP_RANK_INSTRUCTION } from '../receipt-group-canonical-plan.mjs';
import { prepareReceiptGroupPlan, compileReceiptGroupPlan } from '../receipt-group-plan.mjs';

const counter = text => Math.ceil(text.length / 4);
const card = id => ({ namespaceIndex: 0,
  memory: { id: `canonical-parcel-${id}`, revision: 2, currentness: 'current' },
  receipts: [{ id: `canonical-receipt-${id}`, role: id === 'birch' ? 'assistant' : 'user', excerpt: `Literal parcel ${id}.` }],
  receiptCount: 1, interpretationStatus: 'omitted', sourceSelectionCoverage: 'unassessed' });
const request = (limit = 3) => ({ system: 'Actual core envelope',
  input: { query: 'Which passage describes the parcel?', limit, candidates: ['alder', 'birch', 'cedar', 'elm'].map(card) },
  maxOutputTokens: 1024, signal: new AbortController().signal });
const raw = { groups: [{ contextReceiptIds: ['canonical-receipt-alder', 'canonical-receipt-birch',
  'canonical-receipt-birch', 'canonical-receipt-alder'], terminalReceiptId: 'canonical-receipt-alder' }] };
const code = expected => error => error?.code === expected;
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const group = (contextReceiptIds, terminalReceiptId = 'canonical-receipt-alder') => ({ contextReceiptIds, terminalReceiptId });

test('C3 fresh exact overlap compiles and orders surviving context before unchanged focus', () => {
  const prepared = prepareCanonicalReceiptGroupPlan(request(), counter);
  let compiled;
  assert.doesNotThrow(() => { compiled = compileCanonicalReceiptGroupPlan(prepared, raw); },
    'Exact repeated membership is accepted at the successor seam');
  assert.deepEqual(compiled.refs.map(ref => ref.memoryId), ['canonical-parcel-birch', 'canonical-parcel-alder']);
  assert.deepEqual(compiled.proposal, raw);
  assert.deepEqual(compiled.canonicalProposal, { groups: [{ contextReceiptIds: ['canonical-receipt-birch'],
    terminalReceiptId: 'canonical-receipt-alder' }] });
});

test('C1/C3/C4 immutable raw provenance, canonical idempotence and cross-group sharing', () => {
  const input = request(), prepared = prepareCanonicalReceiptGroupPlan(input, counter);
  const proposal = structuredClone({ groups: [...raw.groups, group(['canonical-receipt-birch', 'canonical-receipt-cedar',
    'canonical-receipt-birch'], 'canonical-receipt-cedar'), ...raw.groups] });
  const compiled = compileCanonicalReceiptGroupPlan(prepared, proposal);
  const expected = { groups: [group(['canonical-receipt-birch']), group(['canonical-receipt-birch'], 'canonical-receipt-cedar'),
    group(['canonical-receipt-birch'])] };
  assert.deepEqual(compiled.canonicalProposal, expected);
  assert.deepEqual(compiled.refs.map(ref => ref.memoryId), ['canonical-parcel-birch', 'canonical-parcel-alder', 'canonical-parcel-cedar']);
  assert.deepEqual(compiled.canonicalization, { policy: CANONICAL_RECEIPT_GROUP_POLICY, version: 1,
    repeatedContextOccurrencesRemoved: 5, terminalContextMembershipsRemoved: 3, removedContextOccurrences: 8 });
  assert.equal(compiled.proposalSha256, sha(proposal)); assert.equal(compiled.canonicalProposalSha256, sha(expected));
  assert.notEqual(compiled.proposalSha256, compiled.canonicalProposalSha256);
  assert.equal(compiled.derivedReceiptGroupProposalSha256, compiled.canonicalProposalSha256);
  assert.notEqual(compiled.requestSha256, compiled.derivedReceiptGroupRequestSha256);
  const twice = compileCanonicalReceiptGroupPlan(prepared, compiled.canonicalProposal);
  assert.deepEqual(twice.canonicalProposal, expected);
  assert.equal(twice.canonicalization.removedContextOccurrences, 0);
  proposal.groups[0].contextReceiptIds[0] = 'canonical-receipt-elm'; input.input.candidates[0].receipts[0].excerpt = 'changed';
  assert.deepEqual(compiled.proposal, { groups: [...raw.groups, group(['canonical-receipt-birch', 'canonical-receipt-cedar',
    'canonical-receipt-birch'], 'canonical-receipt-cedar'), ...raw.groups] });
  assert(Object.isFrozen(compiled.proposal.groups[0].contextReceiptIds));
  assert.equal(compiled.originalInput.candidates[0].receipts[0].excerpt, 'Literal parcel alder.');
});

test('C2 raw caps and every literal occurrence reject before reduction', () => {
  const prepared = prepareCanonicalReceiptGroupPlan(request(), counter);
  const bad = [null, [], {}, { groups: [], extra: true }, { groups: new Array(1) },
    { groups: [group(new Array(1))] }, { groups: [group(['unknown', 'unknown'])] },
    { groups: [group([' canonical-receipt-alder'])] }, { groups: [group(['CANONICAL-RECEIPT-ALDER'])] },
    { groups: [group([null])] }, { groups: [group([0])] }, { groups: [group([], 'unknown')] },
    { groups: [group(Array(6).fill('canonical-receipt-alder'))] },
    { groups: Array(7).fill(group([])) },
    { groups: [group(['canonical-receipt-birch', 'canonical-receipt-cedar', 'canonical-receipt-elm'])] },
    { groups: [{ ...group([]), adopted: true }] }, { groups: [{ contextReceiptIds: [] }] },
    { groups: [group('canonical-receipt-alder')] }];
  for (const proposal of bad) assert.throws(() => compileCanonicalReceiptGroupPlan(prepared, proposal), code('invalid_model_output'));
  assert.throws(() => compileCanonicalReceiptGroupPlan(prepareCanonicalReceiptGroupPlan(request(1), counter), raw), code('invalid_model_output'));
  const tokens = text => text.includes('"groups"') && !text.includes('"outputSchema"') ? 1025 : counter(text);
  assert.throws(() => compileCanonicalReceiptGroupPlan(prepareCanonicalReceiptGroupPlan(request(), tokens), raw), code('invalid_model_output'));
  assert.throws(() => prepareCanonicalReceiptGroupPlan(request(), () => 6001), code('context_budget_exceeded'));
  assert.throws(() => prepareCanonicalReceiptGroupPlan(request(), text => text.includes(CANONICAL_RECEIPT_GROUP_RANK_INSTRUCTION)
    ? 6001 : counter(text)), code('context_budget_exceeded'), 'Actual successor request cap applies after unchanged v1 preparation');
  const refCounter = text => text.startsWith('{"refs":') ? 1025 : counter(text);
  assert.throws(() => compileCanonicalReceiptGroupPlan(prepareCanonicalReceiptGroupPlan(request(), refCounter), raw), code('invalid_model_output'));
  assert.deepEqual(compileCanonicalReceiptGroupPlan(prepared, { groups: Array(6).fill(group(Array(5).fill('canonical-receipt-alder'))) }).refs,
    [{ namespaceIndex: 0, memoryId: 'canonical-parcel-alder', revision: 2 }]);
});

test('C1/C2 literal guards and genuine ownership never execute forged hooks', () => {
  let hooks = 0; const trap = () => { hooks++; throw new Error('hook'); };
  const prepared = prepareCanonicalReceiptGroupPlan(request(), counter), compiled = compileCanonicalReceiptGroupPlan(prepared, raw);
  for (const proposal of [new Proxy(raw, { ownKeys: trap }), { groups: [new Proxy(raw.groups[0], { ownKeys: trap })] },
    Object.defineProperty({}, 'groups', { enumerable: true, get: trap }), { ...raw, toJSON: trap },
    Object.assign(Object.create({ toJSON: trap }), raw), { groups: Object.assign([], { hidden: true }) },
    Object.defineProperty({ ...raw }, 'invisible', { value: 'hidden' })]) {
    assert.throws(() => compileCanonicalReceiptGroupPlan(prepared, proposal), code('invalid_model_output'));
  }
  assert.throws(() => compileCanonicalReceiptGroupPlan(structuredClone(prepared), raw), code('invalid_input'));
  for (const fake of [structuredClone(compiled), { ...compiled }, new Proxy(compiled, { get: trap })]) {
    assert.throws(() => assembleCanonicalReceiptGroupPlan({ compiled: fake, recall: {}, core: {}, plan: {}, namespace: {}, question: {} }),
      code('invalid_canonical_receipt_group_plan'));
  }
  assert.throws(() => packCanonicalReceiptGroupAnswer({ evidence: {}, countTokens: counter }), code('invalid_card_plan_evidence'));
  assert.equal(hooks, 0);
  assert.throws(() => createCanonicalReceiptGroupInvocation({ contextWindow: 8192, countTokens: counter, [Symbol('hidden')]: trap },
    { planRank: trap }), code('model_not_configured'));
  assert.equal(hooks, 0);
});

test('C3 every accepted v1 proposal remains identical with unchanged v1 request bytes', () => {
  const input = request(), old = prepareReceiptGroupPlan(input, counter), prepared = prepareCanonicalReceiptGroupPlan(input, counter);
  const oldBytes = JSON.stringify(old.request);
  for (const proposal of [{ groups: [] }, { groups: [group([])] }, { groups: [group(['canonical-receipt-birch'])] },
    { groups: [group(['canonical-receipt-birch'], 'canonical-receipt-cedar'), group(['canonical-receipt-birch'])] }]) {
    const v1 = compileReceiptGroupPlan(old, proposal), successor = compileCanonicalReceiptGroupPlan(prepared, proposal);
    assert.deepEqual(successor.canonicalProposal, proposal); assert.deepEqual(successor.refs, v1.refs);
    assert.deepEqual(successor.diagnostics, v1.diagnostics);
  }
  assert.equal(JSON.stringify(prepareReceiptGroupPlan(input, counter).request), oldBytes);
  assert.throws(() => compileReceiptGroupPlan(old, raw), code('invalid_model_output'));
});

test('C5 invocation one generation/take, failed/cancelled exhaustion and native signal tamper', async () => {
  const base = { contextWindow: 8192, countTokens: counter }; let calls = 0, release;
  const invocation = createCanonicalReceiptGroupInvocation(base, { planRank() { calls++; return new Promise(resolve => { release = resolve; }); } });
  const pending = invocation.model.rank(request());
  assert.throws(invocation.takePlan, code('invalid_canonical_receipt_group_plan'));
  await assert.rejects(invocation.model.rank(request()), code('canonical_receipt_group_invocation_conflict'));
  release(raw); await pending; assert.deepEqual(invocation.takePlan().proposal, raw);
  assert.throws(invocation.takePlan, code('invalid_canonical_receipt_group_plan')); assert.equal(calls, 1);
  for (const mode of ['invalid', 'throw', 'cancel', 'accessor', 'prototype']) {
    const input = request(), controller = new AbortController(); input.signal = controller.signal; let hooks = 0;
    const failed = createCanonicalReceiptGroupInvocation(base, { planRank() {
      if (mode === 'throw') throw new Error('fake failure');
      if (mode === 'cancel') controller.abort();
      if (mode === 'accessor') Object.defineProperty(input.signal, 'aborted', { get() { hooks++; return false; } });
      if (mode === 'prototype') Object.setPrototypeOf(input.signal, Object.create(AbortSignal.prototype));
      return mode === 'invalid' ? { groups: [group(['unknown'])] } : raw;
    } });
    await assert.rejects(failed.model.rank(input));
    assert.throws(failed.takePlan, code('invalid_canonical_receipt_group_plan'));
    await assert.rejects(failed.model.rank(request()), code('canonical_receipt_group_invocation_conflict')); assert.equal(hooks, 0);
  }
  const input = request();
  const prepared = prepareCanonicalReceiptGroupPlan(input, text => {
    if (text.includes('"groups"') && !text.includes('"outputSchema"')) Object.defineProperty(input.signal, 'aborted', { get() { assert.fail('No getter'); } });
    return counter(text);
  });
  assert.throws(() => compileCanonicalReceiptGroupPlan(prepared, raw), code('invalid_input'));
  const cancelledController = new AbortController(), cancelledInput = request(); cancelledInput.signal = cancelledController.signal;
  const cancelled = compileCanonicalReceiptGroupPlan(prepareCanonicalReceiptGroupPlan(cancelledInput, counter), raw);
  cancelledController.abort();
  const assemblyOptions = { compiled: cancelled, recall: {}, core: {}, plan: {}, namespace: {}, question: {} };
  assert.throws(() => assembleCanonicalReceiptGroupPlan(assemblyOptions), { name: 'AbortError' });
  assert.throws(() => assembleCanonicalReceiptGroupPlan(assemblyOptions), code('invalid_canonical_receipt_group_plan'));
});
