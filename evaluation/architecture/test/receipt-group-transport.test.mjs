import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { RECEIPT_GROUP_RANK_INSTRUCTION, prepareReceiptGroupPlan, compileReceiptGroupPlan,
  createReceiptGroupInvocation, assembleReceiptGroupPlan, packReceiptGroupAnswer } from '../receipt-group-plan.mjs';
import { prepareCardPlanRankRequest } from '../card-plan-rank.mjs';
import { createReceiptGroupPlanRankTransport, createCardPlanRankTransport,
  createSourceBundlePlanRankTransport } from '../source-bundle-plan-rank-transport.mjs';

const MODEL = 'gpt-4.1-mini-2025-04-14', VERSION = 'receipt-group-plan-rank-v1';
const KEY = 'synthetic_receipt_group_wire_key_123456';
const sha = text => createHash('sha256').update(text).digest('hex');
const cards = () => [
  { namespaceIndex: 0, memory: { id: 'fresh-wire-parcel-alder', revision: 2, currentness: 'current' },
    receipts: [{ id: 'fresh-wire-receipt-alder', role: 'user', excerpt: 'Parcel Alder uses route P at the east depot.' }],
    receiptCount: 1, interpretationStatus: 'omitted', sourceSelectionCoverage: 'unassessed' },
  { namespaceIndex: 0, memory: { id: 'fresh-wire-parcel-route', revision: 4, currentness: 'current' },
    receipts: [{ id: 'fresh-wire-receipt-route', role: 'assistant', excerpt: 'Proposal: route P could use bay violet; adoption is unstated.' }],
    receiptCount: 1, interpretationStatus: 'omitted', sourceSelectionCoverage: 'unassessed' },
];
const query = 'Which bay applies to Parcel Alder at the east depot?';
const proposal = { groups: [{ contextReceiptIds: ['fresh-wire-receipt-route'], terminalReceiptId: 'fresh-wire-receipt-alder' }] };
const reply = value => new Response(typeof value === 'string' ? value : JSON.stringify(value), { status: 200 });

// Independent literal schema and HTTP oracle; no production schema builder or
// prepared input supplies expected IDs, card fields, order or constraints.
function expectedWires(input = { query, limit: 6, cards: cards() }) {
  const receipt = { type: 'string', enum: input.cards.flatMap(card => card.receipts.map(receipt => receipt.id)) };
  const schema = { type: 'object', additionalProperties: false, required: ['groups'], properties: {
    groups: { type: 'array', maxItems: 6, items: { type: 'object', additionalProperties: false,
      required: ['contextReceiptIds', 'terminalReceiptId'], properties: {
        contextReceiptIds: { type: 'array', minItems: 0, maxItems: 5, items: receipt }, terminalReceiptId: receipt } } } } };
  const body = { model: MODEL, instructions: RECEIPT_GROUP_RANK_INSTRUCTION,
    input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(input) }] }],
    text: { format: { type: 'json_schema', name: 'cairn_receipt_group_plan_rank_v1', strict: true, schema } }, truncation: 'disabled' };
  return [JSON.stringify(body), JSON.stringify({ ...body, max_output_tokens: 1024, store: false, stream: false })];
}

test('RW1/2/4/5 prospective exact-ID factory sends literal receipt-group wires and returns actual groups', async t => {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (!(major > 22 || major === 22 && minor >= 16)) {
    if (process.env.CAIRN_CARD_PLAN_TRANSPORT_REQUIRED === '1') throw new Error('required_sqlite_unavailable');
    t.skip('Optional SQLite unavailable; required flag fails instead'); return;
  }
  let countTokens;
  try { ({ countOpenAITokens: countTokens } = await import('../../../adapters/openai/index.mjs')); }
  catch (error) {
    if (process.env.CAIRN_CARD_PLAN_TRANSPORT_REQUIRED !== '1' && error.code === 'ERR_MODULE_NOT_FOUND'
      && error.message.includes("Cannot find package 'tiktoken'")) { t.skip('Optional tokenizer unavailable'); return; }
    throw error;
  }
  const budget = await import('../../experiment-budget/index.mjs');
  const { DatabaseSync } = await import('node:sqlite');
  const workspace = createTestWorkspace(t, { prefix: 'cairn-new-receipt-group-wire-' }), handles = [];
  workspace.defer(() => { for (const handle of handles) handle.close(); });
  const nativeFetch = globalThis.fetch; let realNetwork = 0;
  globalThis.fetch = () => { realNetwork++; throw new Error('Real network forbidden in receipt-group wire control'); };
  t.after(() => { globalThis.fetch = nativeFetch; });
  const configuration = { directory: join(workspace.path, 'ledger'), runId: randomUUID(), limitMicroUsd: 400000000, requestCap: 20 };
  const original = budget.createExperimentBudget(configuration);
  try {
    const attemptId = randomUUID(); original.reserve({ attemptId, channel: 'host-completion', reservedMicroUsd: 30 });
    original.recordOutcome({ attemptId, outcome: 'unknown' });
  } finally { original.close(); }
  const rows = () => {
    const database = new DatabaseSync(join(configuration.directory, 'experiment-budget.sqlite'), { readOnly: true });
    try { return database.prepare('SELECT rowid, * FROM attempts ORDER BY rowid').all(); } finally { database.close(); }
  };
  const prefix = rows(), inspected = budget.inspectExperimentBudgetForEmbeddingUpgrade(configuration);
  const checkpoint = { requestCount: inspected.requestCount, reservedMicroUsd: inspected.reservedMicroUsd };
  budget.upgradeExperimentBudgetForEmbeddings({ ...configuration, expectedCheckpoint: checkpoint, expectedHistorySha256: inspected.historySha256 });
  const controller = new AbortController();
  const coreRequest = { system: 'Actual core rank envelope', input: { query, limit: 6, candidates: cards() },
    maxOutputTokens: 1024, signal: controller.signal };
  const prepared = prepareReceiptGroupPlan(coreRequest, countTokens);
  const derived = prepareCardPlanRankRequest(coreRequest, countTokens);
  assert.notEqual(prepared.requestSha256, derived.requestSha256, 'Manifest binds actual successor, not derived CP');
  assert.deepEqual(compileReceiptGroupPlan(prepared, proposal).refs.map(ref => ref.memoryId),
    ['fresh-wire-parcel-route', 'fresh-wire-parcel-alder'], 'Genuine lowering independently establishes this valid literal proposal');
  assert(expectedWires().every(body => countTokens(body) <= 6000), 'Complete independent HTTP bodies fit unchanged real-token budget');
  const raw = ' \n' + JSON.stringify(proposal) + '\n ', response = JSON.stringify({ id: 'resp_fresh_receipt_group', model: MODEL,
    status: 'completed', error: null, incomplete_details: null,
    output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: raw }] }],
    usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } });
  const calls = [], records = [];
  const transport = await createReceiptGroupPlanRankTransport({ configuration, checkpoint, historySha256: inspected.historySha256,
    manifest: { version: VERSION, slotId: 'new-receipt-group-slot', preparedRequestSha256: prepared.requestSha256,
      runDeadline: performance.now() + 10000, caseDeadline: performance.now() + 10000 }, apiKey: KEY,
    fetchImpl(url, init) { calls.push({ url, init }); return reply(calls.length === 1
      ? { object: 'response.input_tokens', input_tokens: 500 } : response); }, onRecord(record) { records.push(record); } });
  handles.push(transport);
  let returned;
  try {
    await assert.doesNotReject(async () => { returned = await transport.planRank({ ...prepared.request, signal: controller.signal }); },
      'Valid receipt-ID request must pass new reconstruction; old card instruction/index schema is not this wire');
    assert.deepEqual(returned, proposal, 'Only literal actual RG output is returned; derived CP is private');
    assert.deepEqual(calls.map(call => call.init.body), expectedWires());
    assert.deepEqual(calls.map(call => call.url), ['https://api.openai.com/v1/responses/input_tokens', 'https://api.openai.com/v1/responses']);
    assert.equal(records.length, 4);
    for (const [index, call] of calls.entries()) {
      assert.equal(call.init.method, 'POST'); assert.equal(call.init.redirect, 'error');
      assert.equal(records[index * 2].requestSha256, sha(expectedWires()[index]));
    }
    assert(Object.isFrozen(returned)); assert.deepEqual(Object.keys(returned), ['groups']);
    assert(records.every(Object.isFrozen)); assert(!JSON.stringify(records).includes(KEY));
    assert(records.every(record => record.version === VERSION && record.preparedRequestSha256 === prepared.requestSha256));
    assert.equal(records[3].responseSha256, sha(response));
    assert.equal(records[3].responseBody, response, 'Whitespace-bearing first response remains literal provenance');
    assert.notEqual(sha(raw), sha(JSON.stringify(returned)));
    assert.equal(transport.getState().requestCount, 3);
    assert.equal(transport.getState().reservedMicroUsd, 10030);
    assert.deepEqual(transport.getState().attempts.slice(1).map(row => [row.channel, row.outcome, row.actualMicroUsd]),
      [['cairn-count', 'succeeded', null], ['cairn-generation', 'succeeded', 72]]);
  } finally {
    assert.deepEqual(rows().slice(0, prefix.length), prefix, 'Original synthetic prefix is unchanged');
    assert.equal(realNetwork, 0);
    t.diagnostic(`physical fake HTTP=${calls.length}; real network=${realNetwork}; ledger count=${transport.getState().requestCount}`);
    await workspace.cleanup(); assert.equal(existsSync(workspace.path), false);
    t.diagnostic('Owned synthetic workspace cleanup confirmed');
  }
});

const code = expected => error => error?.code === expected;
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result.error)); return result.value; };
const literal = id => ({ contextReceiptIds: [], terminalReceiptId: id });
const envelope = (raw = JSON.stringify(proposal), patch = {}) => ({ id: 'resp_fresh_receipt_group', model: MODEL,
  status: 'completed', error: null, incomplete_details: null,
  output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: raw }] }],
  usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 }, ...patch });
function forbidNetwork(t) {
  const previous = globalThis.fetch; let calls = 0;
  globalThis.fetch = () => { calls++; throw new Error('Real network forbidden'); };
  // One guard per owning test, never per looped fixture; restore the exact binding.
  t.after(() => { globalThis.fetch = previous; assert.equal(calls, 0); });
}
const offline = (name, body) => test(name, async t => {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (!(major > 22 || major === 22 && minor >= 16)) {
    if (process.env.CAIRN_CARD_PLAN_TRANSPORT_REQUIRED === '1') throw new Error('required_sqlite_unavailable');
    t.skip('Optional SQLite unavailable; required flag fails instead'); return;
  }
  let counter;
  try { counter = (await import('../../../adapters/openai/index.mjs')).countOpenAITokens; }
  catch (error) {
    if (process.env.CAIRN_CARD_PLAN_TRANSPORT_REQUIRED !== '1' && error.code === 'ERR_MODULE_NOT_FOUND'
      && error.message.includes("Cannot find package 'tiktoken'")) { t.skip('Optional tokenizer unavailable'); return; }
    throw error;
  }
  forbidNetwork(t); await body(t, counter);
});
const coreRequest = (controller, candidates = cards(), limit = 6) => ({ system: 'Actual core rank envelope',
  input: { query, limit, candidates }, maxOutputTokens: 1024, signal: controller.signal });

async function fixture(t, counter, options = {}) {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-receipt-group-http-' }), handles = new Set();
  workspace.defer(() => { for (const handle of handles) handle.close(); });
  const budget = await import('../../experiment-budget/index.mjs'), { DatabaseSync } = await import('node:sqlite');
  const configuration = { directory: join(workspace.path, 'ledger'), runId: randomUUID(), limitMicroUsd: 400000000, requestCap: 20 };
  const old = budget.createExperimentBudget(configuration);
  try { const attemptId = randomUUID(); old.reserve({ attemptId, channel: 'host-completion', reservedMicroUsd: 30 });
    old.recordOutcome({ attemptId, outcome: 'unknown' }); } finally { old.close(); }
  const rows = () => {
    const db = new DatabaseSync(join(configuration.directory, 'experiment-budget.sqlite'), { readOnly: true });
    try { return db.prepare('SELECT rowid, * FROM attempts ORDER BY rowid').all(); } finally { db.close(); }
  };
  const prefix = rows(), inspection = budget.inspectExperimentBudgetForEmbeddingUpgrade(configuration);
  const checkpoint = { requestCount: inspection.requestCount, reservedMicroUsd: inspection.reservedMicroUsd };
  budget.upgradeExperimentBudgetForEmbeddings({ ...configuration, expectedCheckpoint: checkpoint, expectedHistorySha256: inspection.historySha256 });
  const controller = options.controller ?? new AbortController();
  const prepared = options.prepared ?? prepareReceiptGroupPlan(coreRequest(controller, options.cards), counter);
  const calls = [], records = [], rawResponse = JSON.stringify(envelope(options.raw, options.patch));
  const args = { configuration, checkpoint, historySha256: inspection.historySha256,
    manifest: { version: VERSION, slotId: 'receipt-group-offline-slot', preparedRequestSha256: prepared.requestSha256,
      runDeadline: performance.now() + 10000, caseDeadline: performance.now() + 10000, ...options.manifest }, apiKey: KEY,
    fetchImpl(url, init) { calls.push({ url, init }); return options.fetch ? options.fetch(url, init, calls.length)
      : reply(calls.length === 1 ? { object: 'response.input_tokens', input_tokens: 500 } : rawResponse); },
    onRecord(record) { records.push(record); return options.observe?.(record, controller); } };
  const transport = await createReceiptGroupPlanRankTransport(args); handles.add(transport);
  return { workspace, handles, controller, prepared, args, calls, records, transport, rawResponse,
    request: { ...prepared.request, signal: controller.signal },
    checkPrefix() { assert.deepEqual(rows().slice(0, prefix.length), prefix); },
    async cleanup() { await workspace.cleanup(); assert.equal(existsSync(workspace.path), false); } };
}

offline('RW2/3 empty cards and foreign versions/hashes reject locally; empty groups remain literal', async (t, counter) => {
  const empty = await fixture(t, counter, { cards: [] });
  await assert.rejects(empty.transport.planRank(empty.request), code('invalid_request'));
  assert.equal(empty.calls.length, 0); assert.equal(empty.transport.getState().requestCount, 1); empty.checkPrefix();
  await assert.rejects(empty.transport.planRank(empty.request), code('slot_consumed'));
  const f = await fixture(t, counter, { raw: ' \n{"groups":[]}\n ' });
  assert.deepEqual(await f.transport.planRank(f.request), { groups: [] });
  assert.deepEqual(f.calls.map(call => call.init.body), expectedWires()); f.checkPrefix();
  const wrong = await fixture(t, counter, { manifest: { preparedRequestSha256: '0'.repeat(64) } });
  await assert.rejects(wrong.transport.planRank(wrong.request), code('invalid_request'));
  assert.equal(wrong.calls.length, 0); assert.equal(wrong.transport.getState().requestCount, 1);
  const oldWire = await fixture(t, counter);
  const oldPrepared = prepareCardPlanRankRequest(coreRequest(oldWire.controller), counter);
  await assert.rejects(oldWire.transport.planRank({ ...oldPrepared.request, signal: oldWire.controller.signal }), code('invalid_request'));
  assert.equal(oldWire.calls.length, 0); assert.equal(oldWire.transport.getState().requestCount, 1); oldWire.checkPrefix();
  f.transport.close();
  for (const version of ['source-bundle-plan-rank-v1', 'card-budgeted-plan-rank-v1', 'receipt-group-plan-rank-v2']) {
    await assert.rejects(createReceiptGroupPlanRankTransport({ ...f.args, manifest: { ...f.args.manifest, version } }), code('invalid_configuration'));
  }
  await assert.rejects(createSourceBundlePlanRankTransport(f.args), code('invalid_configuration'));
  await assert.rejects(createCardPlanRankTransport(f.args), code('invalid_configuration'));
  for (const extra of ['profile', 'instruction', 'schema', 'compiler', 'policy']) {
    await assert.rejects(createReceiptGroupPlanRankTransport({ ...f.args, [extra]: {} }), code('invalid_configuration'));
  }
});

offline('RW2 exact instruction/schema/source/order/descriptor drift never dispatches or executes hooks', async (t, counter) => {
  let hooks = 0; const trap = () => { hooks++; throw new Error(KEY); };
  for (const mode of ['instruction', 'schema', 'query', 'order', 'receipt-order', 'role', 'excerpt', 'namespace', 'revision',
    'index', 'limit', 'signal', 'getter', 'proxy', 'sparse', 'toJSON', 'outer-proxy']) {
    const candidates = cards();
    if (mode === 'receipt-order') {
      candidates[0].receipts.push({ id: 'fresh-wire-second-alder', role: 'assistant', excerpt: 'An inert second source.' });
      candidates[0].receiptCount++;
    }
    const f = await fixture(t, counter, { cards: candidates }); f.request = { ...structuredClone(f.prepared.request), signal: f.controller.signal };
    const input = f.request.input, card = input.cards[0];
    if (mode === 'instruction') f.request.system += ' Changed';
    if (mode === 'schema') f.request.outputSchema.properties.groups.maxItems = 7;
    if (mode === 'query') input.query += ' Changed';
    if (mode === 'order') input.cards.reverse();
    if (mode === 'receipt-order') card.receipts.reverse();
    if (mode === 'role') card.receipts[0].role = 'assistant';
    if (mode === 'excerpt') card.receipts[0].excerpt += ' Changed';
    if (mode === 'namespace') card.namespaceIndex = 1;
    if (mode === 'revision') card.memory.revision++;
    if (mode === 'index') card.candidateIndex = 0;
    if (mode === 'limit') f.request.maxOutputTokens = 1025;
    if (mode === 'signal') Object.defineProperty(f.request.signal, 'aborted', { get: trap });
    if (mode === 'getter') Object.defineProperty(card, 'receipts', { enumerable: true, get: trap });
    if (mode === 'proxy') input.cards[0] = new Proxy(card, { ownKeys: trap });
    if (mode === 'sparse') delete input.cards[0];
    if (mode === 'toJSON') card.toJSON = trap;
    if (mode === 'outer-proxy') f.request = new Proxy(f.request, { ownKeys: trap });
    await assert.rejects(f.transport.planRank(f.request), code('invalid_request'));
    assert.equal(f.calls.length, 0); assert.equal(hooks, 0); assert.equal(f.transport.getState().requestCount, 1); f.checkPrefix();
  }
  const f = await fixture(t, counter); f.transport.close();
  await assert.rejects(createReceiptGroupPlanRankTransport(new Proxy(f.args, { ownKeys: trap })), code('invalid_configuration'));
  await assert.rejects(createReceiptGroupPlanRankTransport({ ...f.args,
    configuration: new Proxy(f.args.configuration, { ownKeys: trap }) }), code('invalid_configuration'));
  assert.equal(hooks, 0);
});

offline('RW2 native signal mutation stays fatal before further dispatch without executing hooks', async (t, counter) => {
  const failures = [];
  const modes = ['aborted-accessor', 'prototype', 'cleanup-getter', 'throwing-cleanup-getter'];
  const boundaries = ['count', 'generation', 'pre-count-record', 'post-count-record', 'post-generation-record'];
  for (const mode of modes) for (const boundary of boundaries) {
    let hooks = 0, mutations = 0, f;
    const mutate = () => {
      mutations++;
      const signal = f.controller.signal;
      if (mode === 'prototype') Object.setPrototypeOf(signal, Object.create(AbortSignal.prototype));
      else Object.defineProperty(signal, mode === 'aborted-accessor' ? 'aborted' : 'removeEventListener',
        { configurable: true, get() { hooks++; if (mode === 'throwing-cleanup-getter') throw new Error('Cleanup hook must never execute');
          return mode === 'aborted-accessor' ? false
          : AbortSignal.prototype.removeEventListener.bind(signal); } });
    };
    f = await fixture(t, counter, {
      fetch(_, __, n) {
        if (boundary === (n === 1 ? 'count' : 'generation')) mutate();
        return reply(n === 1 ? { object: 'response.input_tokens', input_tokens: 500 } : envelope());
      },
      observe(record) {
        if (boundary === `${record.phase}-${record.kind}-record`) mutate();
      },
    });
    let failure, retry;
    try { await f.transport.planRank(f.request); } catch (error) { failure = error.code; }
    try { await f.transport.planRank(f.request); } catch (error) { retry = error.code; }
    const expectedCalls = boundary === 'pre-count-record' ? 0 : boundary.includes('generation') ? 2 : 1;
    const state = f.transport.getState(), settlements = state.attempts.slice(1);
    const observations = { mode, boundary, mutations, hooks, failure, retry, calls: f.calls.length,
      health: f.transport.health(), settlements: settlements.map(row => [row.channel, row.outcome, row.actualMicroUsd]) };
    t.diagnostic(JSON.stringify(observations));
    for (const [field, actual, expected] of [['mutations', mutations, 1], ['hooks', hooks, 0],
      ['failure', failure, 'request_mutated'], ['fatalCode', f.transport.health().fatalCode, 'request_mutated'],
      ['state', f.transport.health().state, 'consumed'], ['retry', retry, 'slot_consumed'],
      ['calls', f.calls.length, expectedCalls], ['settlements', settlements.length, Math.max(1, expectedCalls)]]) {
      if (actual !== expected) failures.push({ mode, boundary, field, actual, expected });
    }
    const expectedRows = boundary === 'post-count-record' ? [['cairn-count', 'succeeded', null]]
      : boundary === 'post-generation-record' ? [['cairn-count', 'succeeded', null], ['cairn-generation', 'succeeded', 72]]
      : expectedCalls === 2 ? [['cairn-count', 'succeeded', null], ['cairn-generation', 'failed', 72]]
      : [['cairn-count', 'failed', null]];
    if (JSON.stringify(observations.settlements) !== JSON.stringify(expectedRows))
      failures.push({ mode, boundary, field: 'settlement disposition', actual: observations.settlements, expected: expectedRows });
    assert.equal(state.reservedMicroUsd, 30 + settlements.length * 5000);
    assert.equal(f.records.length, settlements.length * 2, 'Every reservation retains exactly one pre/post pair');
    assert.equal(new Set(f.records.filter(record => record.phase === 'post').map(record => record.attemptId)).size, settlements.length);
    f.checkPrefix(); await f.cleanup();
  }
  assert.deepEqual(failures, [], 'Signal mutation must be fatal, hook-free, consumed and correctly settled');
});

offline('RW2 genuine signal uses captured listener operations rather than input methods', async (t, counter) => {
  const f = await fixture(t, counter); let hooks = 0;
  for (const method of ['addEventListener', 'removeEventListener']) Object.defineProperty(f.controller.signal, method,
    { configurable: true, value() { hooks++; throw new Error('Input signal function must never execute'); } });
  assert.deepEqual(await f.transport.planRank(f.request), proposal);
  assert.equal(hooks, 0); assert.equal(f.calls.length, 2); assert.equal(f.transport.health().state, 'consumed');
  assert.equal(f.records.length, 4); f.checkPrefix(); await f.cleanup();
});

offline('RW2 mixed failed terminal paths retain ordinary errors but mutation cannot leave nonfatal health', async (t, counter) => {
  const scenarios = [
    { name: 'incomplete-generation', phase: 2, kind: 'incomplete', error: 'invalid_model_output', outcome: 'failed', price: 72 },
    { name: 'malformed-proposal', phase: 2, kind: 'proposal', error: 'invalid_model_output', outcome: 'failed', price: 72 },
    { name: 'invalid-count', phase: 1, kind: 'count', error: 'invalid_response', outcome: 'failed', price: null },
    { name: 'rejected-count', phase: 1, kind: 'reject', error: 'provider_failed', outcome: 'unknown', price: null },
    { name: 'rejected-generation', phase: 2, kind: 'reject', error: 'provider_failed', outcome: 'unknown', price: null },
    { name: 'post-record-incomplete', phase: 2, kind: 'incomplete', boundary: 'post', error: 'invalid_model_output', outcome: 'failed', price: 72 },
    { name: 'post-record-rejected-count', phase: 1, kind: 'reject', boundary: 'post', error: 'provider_failed', outcome: 'unknown', price: null },
    { name: 'cancelled-generation', phase: 2, kind: 'cancel', error: 'cancelled', outcome: 'unknown', price: null },
    { name: 'pre-record-cancel', phase: 1, kind: 'cancel', boundary: 'pre', error: 'cancelled', outcome: 'failed', price: null },
    { name: 'post-record-cancel', phase: 2, kind: 'cancel', boundary: 'post', error: 'cancelled', outcome: 'succeeded', price: 72 },
    { name: 'invalid-usage', phase: 2, kind: 'usage', error: 'invalid_usage', fatal: 'invalid_usage', outcome: 'failed', price: null },
    { name: 'authentication', phase: 2, kind: 'auth', error: 'authentication_failed', fatal: 'authentication_failed', outcome: 'failed', price: 72 },
    { name: 'redirect', phase: 2, kind: 'redirect', error: 'redirect_rejected', fatal: 'redirect_rejected', outcome: 'failed', price: 72 },
    { name: 'credential', phase: 2, kind: 'credential', error: 'credential_echo', fatal: 'credential_echo', outcome: 'failed', price: 72 },
    { name: 'record-persistence', phase: 2, kind: 'persist', boundary: 'post', error: 'record_persistence_failed', fatal: 'record_persistence_failed', outcome: 'succeeded', price: 72 },
  ];
  const failures = [];
  for (const scenario of scenarios) for (const mutation of ['none', 'signal', 'request-data']) {
    let f, hooks = 0, mutations = 0;
    const mutate = () => {
      if (mutation === 'signal') { mutations++; Object.defineProperty(f.controller.signal, 'aborted',
        { configurable: true, get() { hooks++; throw new Error('Signal hook forbidden'); } }); }
      if (mutation === 'request-data') { mutations++; f.request.input.cards[0].receipts[0].excerpt += ' Mutated after dispatch'; }
    };
    f = await fixture(t, counter, {
      fetch(_, __, n) {
        if (n === scenario.phase && !scenario.boundary) { mutate(); if (scenario.kind === 'cancel') f.controller.abort(); }
        if (n === scenario.phase && scenario.kind === 'reject') return Promise.reject(new Error('Synthetic failed dispatch'));
        const response = n === 1 ? { object: 'response.input_tokens', input_tokens: 500 } : envelope();
        if (n === scenario.phase) {
          if (scenario.kind === 'incomplete') response.status = 'incomplete';
          if (scenario.kind === 'proposal') response.output[0].content[0].text = '{not-json';
          if (scenario.kind === 'count') response.input_tokens = 'invalid';
          if (scenario.kind === 'usage') response.usage.total_tokens = 999;
          if (scenario.kind === 'credential') response.output[0].content[0].text = KEY;
        }
        return new Response(JSON.stringify(response), { status: n === scenario.phase && scenario.kind === 'auth' ? 401
          : n === scenario.phase && scenario.kind === 'redirect' ? 302 : 200 });
      },
      observe(record) {
        if (record.phase === scenario.boundary && record.kind === (scenario.phase === 1 ? 'count' : 'generation')) {
          mutate(); if (scenario.kind === 'cancel') f.controller.abort();
          if (scenario.kind === 'persist') throw new Error('Synthetic persistence failure');
        }
      },
    });
    f.request = { ...structuredClone(f.prepared.request), signal: f.controller.signal };
    let error, reuse;
    try { await f.transport.planRank(f.request); } catch (failure) { error = failure.code; }
    try { await f.transport.planRank(f.request); } catch (failure) { reuse = failure.code; }
    const state = f.transport.getState(), health = f.transport.health(), rows = state.attempts.slice(1);
    const expectedFatal = scenario.fatal ?? (mutation === 'none' ? null : 'request_mutated');
    const expectedCalls = scenario.boundary === 'pre' ? 0 : scenario.phase;
    t.diagnostic(JSON.stringify({ case: scenario.name, mutation, error, health, hooks, calls: f.calls.length,
      settlements: rows.map(row => [row.channel, row.outcome, row.actualMicroUsd]), cleanupPath: f.workspace.path }));
    for (const [field, actual, expected] of [['fatalCode', health.fatalCode, expectedFatal], ['error', error, scenario.error],
      ['hooks', hooks, 0], ['mutations', mutations, Number(mutation !== 'none')], ['calls', f.calls.length, expectedCalls],
      ['state', health.state, 'consumed'], ['reuse', reuse, 'slot_consumed'], ['rows', rows.length, scenario.phase]]) {
      if (actual !== expected) failures.push({ case: scenario.name, mutation, field, actual, expected });
    }
    assert.equal(rows.at(-1).outcome, scenario.outcome); assert.equal(rows.at(-1).actualMicroUsd, scenario.price);
    if (rows.length === 2) assert.deepEqual([rows[0].channel, rows[0].outcome, rows[0].actualMicroUsd], ['cairn-count', 'succeeded', null]);
    assert.equal(state.reservedMicroUsd, 30 + rows.length * 5000, 'Unknown dispatch stays fully reserved');
    assert.equal(f.records.length, rows.length * 2); assert.equal(new Set(rows.map(row => row.attemptId)).size, rows.length);
    assert.equal(new Set(f.records.filter(record => record.phase === 'post').map(record => record.attemptId)).size, rows.length);
    f.checkPrefix(); await f.cleanup(); assert.equal(existsSync(f.workspace.path), false);
  }
  assert.deepEqual(failures, [], 'Ordinary failures/cancellation must not bypass complete RG integrity or safety precedence');
});

offline('RW4/5 invalid literal groups/raw duplicate keys/usage/refusal settle once without repair', async (t, counter) => {
  const tooMany = { groups: Array.from({ length: 7 }, () => literal('fresh-wire-receipt-alder')) };
  const bad = [
    [JSON.stringify({ groups: [literal('unknown')] }), {}, 'invalid_model_output', 72],
    [JSON.stringify({ groups: [{ contextReceiptIds: ['fresh-wire-receipt-alder'], terminalReceiptId: 'fresh-wire-receipt-alder' }] }), {}, 'invalid_model_output', 72],
    [JSON.stringify({ groups: [{ contextReceiptIds: ['fresh-wire-receipt-route', 'fresh-wire-receipt-route'], terminalReceiptId: 'fresh-wire-receipt-alder' }] }), {}, 'invalid_model_output', 72],
    [JSON.stringify({ ...proposal, selectedCards: [0] }), {}, 'invalid_model_output', 72],
    [JSON.stringify(tooMany), {}, 'invalid_model_output', 72],
    ['{"groups":[],"groups":[]}', {}, 'invalid_model_output', 72],
    [' \n'.repeat(2200) + '{"groups":[]}', {}, 'invalid_model_output', 72],
    [' '.repeat(40001), {}, 'invalid_model_output', 72],
    [undefined, { status: 'incomplete' }, 'invalid_model_output', 72],
    [undefined, { output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'refusal', refusal: 'inert refusal' }] }] }, 'invalid_model_output', 72],
    [undefined, { usage: { input_tokens: 100, output_tokens: '20', total_tokens: 120 } }, 'invalid_usage', null],
    [undefined, { model: 'unapproved-model' }, 'model_mismatch', 72],
    [undefined, { usage: { input_tokens: 100, output_tokens: 1025, total_tokens: 1125 } }, 'usage_overrun', 1680],
  ];
  assert(counter(bad[6][0]) > 1024, 'Raw whitespace itself exceeds unchanged output-token bound');
  for (const [raw, patch, expected, price] of bad) {
    const f = await fixture(t, counter, { raw, patch });
    await assert.rejects(f.transport.planRank(f.request), code(expected)); assert.equal(f.calls.length, 2);
    assert.equal(f.transport.getState().attempts.at(-1).actualMicroUsd, price);
    assert.equal(f.transport.getState().attempts.at(-1).outcome, 'failed'); f.checkPrefix();
    await assert.rejects(f.transport.planRank(f.request), code('slot_consumed'));
  }
  for (const raw of ['{"usage":null,"usage":{}}', JSON.stringify(envelope()).replace('"status":"completed"', '"status":"completed","status":"completed"')]) {
    const f = await fixture(t, counter, { fetch: (_, __, n) => reply(n === 1 ? { object: 'response.input_tokens', input_tokens: 500 } : raw) });
    await assert.rejects(f.transport.planRank(f.request), code('invalid_usage'));
    assert.equal(f.calls.length, 2); assert.equal(f.transport.getState().attempts.at(-1).actualMicroUsd, null);
  }
  const candidates = Array.from({ length: 7 }, (_, i) => ({ ...cards()[0], memory: { id: `bound-card-${i}`, revision: 1, currentness: 'current' },
    receipts: [{ id: `bound-receipt-${i}`, role: 'user', excerpt: `Inert bound source ${i}` }] }));
  for (const raw of [
    { groups: [{ contextReceiptIds: [0, 1, 2].map(i => `bound-receipt-${i}`), terminalReceiptId: 'bound-receipt-3' }] },
    { groups: Array.from({ length: 6 }, (_, i) => ({ contextReceiptIds: [`bound-receipt-${i}`], terminalReceiptId: `bound-receipt-${i + 1}` })) },
    { groups: [{ contextReceiptIds: Array.from({ length: 6 }, (_, i) => `bound-receipt-${i}`), terminalReceiptId: 'bound-receipt-6' }] },
    { groups: [{ ...literal('bound-receipt-0'), reason: 'unstated inference' }] },
  ]) {
    const f = await fixture(t, counter, { cards: candidates, raw: JSON.stringify(raw) });
    await assert.rejects(f.transport.planRank(f.request), code('invalid_model_output'));
    assert.equal(f.calls.length, 2); assert.equal(f.transport.getState().attempts.at(-1).actualMicroUsd, 72); f.checkPrefix();
  }
});

offline('RW2/4/5 in-flight mutation, record failure, redaction and safety statuses preserve accounting', async (t, counter) => {
  for (const mode of ['throw', 'promise', 'mutation', 'nested-proxy', 'abort', 'post-generation']) {
    let hooks = 0;
    const f = await fixture(t, counter, { observe(record, controller) {
      if (mode === 'post-generation') { if (record.phase === 'post' && record.kind === 'generation') throw new Error(KEY); return; }
      if (record.phase !== 'pre') return;
      if (mode === 'throw') throw new Error(KEY);
      if (mode === 'promise') return Promise.resolve();
      if (mode === 'mutation') f.request.input.cards[0].receipts[0].excerpt += ' Changed';
      if (mode === 'nested-proxy') f.request.input.cards[0].receipts[0] = new Proxy({}, { ownKeys() { hooks++; throw new Error(KEY); } });
      if (mode === 'abort') controller.abort();
    } });
    f.request = { ...structuredClone(f.prepared.request), signal: f.controller.signal };
    await assert.rejects(f.transport.planRank(f.request), code(['mutation', 'nested-proxy'].includes(mode) ? 'request_mutated'
      : mode === 'abort' ? 'cancelled' : 'record_persistence_failed'));
    assert.equal(hooks, 0); assert.equal(f.calls.length, mode === 'post-generation' ? 2 : 0);
    assert.equal(f.transport.getState().attempts.at(-1).outcome, mode === 'post-generation' ? 'succeeded' : 'failed');
    assert(!JSON.stringify(f.records).includes(KEY)); f.checkPrefix();
  }
  for (const during of [1, 2]) {
    const f = await fixture(t, counter, { fetch: (_, __, n) => {
      if (n === during) f.request.input.cards[0].receipts[0].excerpt += ' Mutated during fake HTTP';
      return reply(n === 1 ? { object: 'response.input_tokens', input_tokens: 500 } : envelope());
    } });
    f.request = { ...structuredClone(f.prepared.request), signal: f.controller.signal };
    await assert.rejects(f.transport.planRank(f.request), code('request_mutated'));
    assert.equal(f.calls.length, during); assert.equal(f.transport.getState().requestCount, during + 1);
    assert.equal(f.transport.getState().attempts.at(-1).outcome, 'failed');
    assert.equal(f.transport.getState().attempts.at(-1).actualMicroUsd, during === 2 ? 72 : null);
    assert.equal(f.transport.health().fatalCode, 'request_mutated'); f.checkPrefix();
    await assert.rejects(f.transport.planRank(f.request), code('slot_consumed'));
  }
  for (const mode of ['credential', 'authentication', 'redirect']) {
    const raw = JSON.stringify(envelope(undefined, mode === 'credential' ? { id: KEY } : {}));
    const f = await fixture(t, counter, { fetch: (_, __, n) => n === 1 ? reply({ object: 'response.input_tokens', input_tokens: 500 })
      : new Response(raw, { status: mode === 'authentication' ? 401 : mode === 'redirect' ? 302 : 200 }) });
    await assert.rejects(f.transport.planRank(f.request), code(mode === 'credential' ? 'credential_echo'
      : mode === 'authentication' ? 'authentication_failed' : 'redirect_rejected'));
    assert.equal(f.calls.length, 2); assert.equal(f.transport.getState().attempts.at(-1).actualMicroUsd, 72);
    assert(!JSON.stringify(f.records).includes(KEY));
    if (mode === 'credential') { assert.equal(f.records.at(-1).responseBody, null); assert.equal(f.records.at(-1).responseSha256, null); }
    f.checkPrefix();
  }
});

offline('RW3/5 native cancellation/deadline and concurrent slot retain unknown reservation', async (t, counter) => {
  for (const mode of ['abort', 'expired']) {
    const f = await fixture(t, counter, mode === 'expired' ? { manifest: { caseDeadline: performance.now() - 1 } } : {});
    if (mode === 'abort') f.controller.abort();
    await assert.rejects(f.transport.planRank(f.request), code(mode === 'abort' ? 'cancelled' : 'deadline_exceeded'));
    assert.equal(f.calls.length, 0); assert.equal(f.transport.getState().requestCount, 1);
  }
  const f = await fixture(t, counter, { manifest: { caseDeadline: performance.now() + 3000 }, fetch: (_, init) => {
    assert.equal(init.signal.aborted, false); return new Promise(() => {});
  } });
  const running = f.transport.planRank(f.request);
  assert.throws(() => f.transport.close(), code('transport_busy'));
  await assert.rejects(f.transport.planRank(f.request), code('transport_busy'));
  await assert.rejects(running, code('deadline_exceeded'));
  assert.equal(f.calls.length, 1); assert.equal(f.transport.getState().requestCount, 2);
  assert.equal(f.transport.getState().attempts.at(-1).outcome, 'unknown');
  assert.equal(f.transport.getState().attempts.at(-1).reservedMicroUsd, 5000); f.checkPrefix();
});

offline('RW3 entire serialized HTTP pressure and documented enum boundaries reject before reservation', async (t, counter) => {
  const controller = new AbortController(); let pressure;
  for (let size = 80; size <= 900; size += 2) {
    const candidates = Array.from({ length: 18 }, (_, i) => ({ ...cards()[0],
      memory: { id: `wire-pressure-card-${i}`, revision: 1, currentness: 'current' },
      receipts: [{ id: `wire-pressure-receipt-${i}`, role: 'user', excerpt: `${i} ` + 'ab_cd '.repeat(160).slice(0, size) }] }));
    const input = { query, limit: 6, cards: candidates };
    try {
      const prepared = prepareReceiptGroupPlan(coreRequest(controller, candidates), counter);
      if (expectedWires(input).some(body => counter(body) > 6000)) { pressure = { prepared, input }; break; }
    } catch (error) { if (error.code !== 'context_budget_exceeded') throw error; }
  }
  assert(pressure, 'Real-token request fits while the complete actual HTTP envelope exceeds 6000');
  const f = await fixture(t, counter, { prepared: pressure.prepared, controller });
  await assert.rejects(f.transport.planRank(f.request), code('context_budget_exceeded'));
  assert.equal(f.calls.length, 0); assert.equal(f.transport.getState().requestCount, 1); f.checkPrefix();
  t.diagnostic(`RW3 full-body tokens ${JSON.stringify({ actual: counter(JSON.stringify(pressure.prepared.request)),
    count: counter(expectedWires(pressure.input)[0]), generation: counter(expectedWires(pressure.input)[1]) })}`);

  for (const [label, ids] of [
    ['501-distinct', Array.from({ length: 501 }, (_, i) => `r${i}`)],
    ['251-long', Array.from({ length: 251 }, (_, i) => `r${i}-${'a'.repeat(61)}`)],
  ]) {
    const candidates = Array.from({ length: Math.ceil(ids.length / 100) }, (_, i) => ({ ...cards()[0],
      memory: { id: `enum-card-${i}`, revision: 1, currentness: 'current' }, receiptCount: ids.slice(i * 100, (i + 1) * 100).length,
      receipts: ids.slice(i * 100, (i + 1) * 100).map(id => ({ id, role: 'user', excerpt: 'inert' })) }));
    const input = { query, limit: 6, cards: candidates };
    const actual = { system: RECEIPT_GROUP_RANK_INSTRUCTION, input,
      outputSchema: JSON.parse(expectedWires(input)[0]).text.format.schema, maxOutputTokens: 1024 };
    let earlier = false;
    try { prepareReceiptGroupPlan(coreRequest(controller, candidates), counter); }
    catch (error) { assert.equal(error.code, 'context_budget_exceeded'); earlier = true; }
    const bounded = await fixture(t, counter, { controller, prepared: { request: actual, requestSha256: sha(JSON.stringify(actual)) } });
    await assert.rejects(bounded.transport.planRank(bounded.request), code(earlier ? 'context_budget_exceeded' : 'invalid_request'));
    assert.equal(bounded.calls.length, 0); assert.equal(bounded.transport.getState().requestCount, 1); bounded.checkPrefix();
    t.diagnostic(`RW3 enum ${label}: ${JSON.stringify({ ids: ids.length, summedIdLength: ids.reduce((n, id) => n + id.length, 0),
      actualTokens: counter(JSON.stringify(actual)), observation: earlier ? 'earlier genuine input-budget rejection; enum branch not reached' : 'documented enum guard reached' })}`);
  }
});

const sourceGroups = Array.from({ length: 6 }, (_, i) => [
  ['user', `At the east depot Parcel Alder has recorded route P in inert note ${i}.`],
  ['assistant', `Proposal ${i}: route P could use bay violet; adoption is unstated.`],
]);
const sourceId = (kind, text) => `lme-${kind}-${sha(`fresh-receipt-group-wire/${text}`)}`;
async function capturedFixture(t, counter, { failSetup = false } = {}) {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-receipt-group-wire-core-' }), handles = new Set();
  workspace.defer(() => { for (const handle of handles) handle.close(); });
  const { openMemoryCore } = await import('../../../core/contract.mjs');
  const { prepareMixedSourceCase } = await import('../../longmemeval/mixed-source.mjs');
  const namespace = { ownerId: 'fresh-receipt-group-http', scope: 'project', projectId: sourceId('case', 'core') };
  const plan = prepareMixedSourceCase({ namespace, history: { question_id: namespace.projectId,
    sessions: sourceGroups.map((sources, i) => ({ session_index: i, session_id: sourceId('session', `${i}`),
      date: '2026/10/12 (Mon) 12:00', turns: sources.map(([role, content], j) => ({ turn_id: sourceId('turn', `${i}/${j}`), role, content })) })) },
  question: { question_id: namespace.projectId, text: query, date: '2026/10/13 (Tue) 12:00' } }, 'indexed-evidence-v1');
  const path = join(workspace.path, 'memory.sqlite'), oracle = new Map(); let captured = 0;
  const base = { contextWindow: 8192, countTokens: counter,
    extract({ input }) { return { items: [{ content: `Fresh inert HTTP card ${++captured}`, kind: 'context', confidence: 1,
      sourceIndices: input.messages.map(source => source.index) }] }; },
    classify({ input }) { return { items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) }; } };
  const capture = openMemoryCore({ path, model: base, captureSourcePolicy: 'indexed-evidence-v1' }); handles.add(capture);
  for (const [i, batch] of plan.cairnPlan.batches.entries()) {
    const admitted = ok(await capture.capture(batch.captureInput)).admission.memories;
    assert.equal(admitted.length, 1); const detail = ok(capture.get({ namespace, memoryId: admitted[0].id, receiptLimit: 100 }));
    assert.equal(detail.receipts.length, 2); assert.equal(new Set(detail.receipts.map(receipt => receipt.id)).size, 2);
    // Independent source-normalization oracle starts from raw literals, not indexedWindows.
    assert.deepEqual(detail.receipts.map(receipt => [receipt.role, receipt.excerpt]).sort(), sourceGroups[i].map(([role, text]) =>
      [role, `[session-date: 2026-10-12 12:00; clock: dataset-local] source{${text} }`]).sort());
    oracle.set(detail.memory.id, { memoryId: detail.memory.id, revision: detail.memory.revision,
      sources: detail.receipts.map(receipt => ({ receiptId: receipt.id, recordedRole: receipt.role, text: receipt.excerpt })) });
    if (failSetup) throw new Error('Deliberate receipt-group-wire setup failure after capture');
  }
  capture.close(); handles.delete(capture);
  return { workspace, handles, path, oracle, namespace, plan, base, openMemoryCore,
    question: { text: plan.originalQuestion.text, date: plan.canonicalQuestionDate } };
}
async function runCaptured(t, counter, f) {
  let ranks = 0, callbacks = 0, selects = 0, wire, transportFixture, raw;
  const invocation = createReceiptGroupInvocation({ ...f.base,
    select() { selects++; assert.fail('No select in bounded source scan'); }, rank() { assert.fail('No base rank fallback'); } },
  { async planRank(actual) {
    callbacks++; wire = actual; const supplied = actual.input.cards;
    assert.equal(supplied.length, 6);
    const oracleInput = { query: f.plan.mem0Input.query, limit: 6, cards: supplied.map(card => {
      const expected = f.oracle.get(card.memory.id);
      return { namespaceIndex: 0, memory: { id: expected.memoryId, revision: expected.revision, currentness: 'current' },
        receipts: expected.sources.map(source => ({ id: source.receiptId, role: source.recordedRole, excerpt: source.text })),
        receiptCount: 2, interpretationStatus: 'omitted', sourceSelectionCoverage: 'unassessed' };
    }) };
    assert.deepEqual(actual.input, oracleInput, 'Whole source cards retain authoritative IDs/roles/text/order');
    raw = { groups: [
      { contextReceiptIds: [supplied[5].receipts[1].id, supplied[1].receipts[0].id], terminalReceiptId: supplied[0].receipts[1].id },
      { contextReceiptIds: [supplied[5].receipts[1].id, supplied[0].receipts[0].id], terminalReceiptId: supplied[5].receipts[0].id },
    ] };
    const prepared = prepareReceiptGroupPlan({ system: 'Actual core envelope', input: { query: actual.input.query, limit: 6, candidates: supplied },
      maxOutputTokens: 1024, signal: actual.signal }, counter);
    transportFixture = await fixture(t, counter, { prepared, controller: { signal: actual.signal }, raw: ' \n' + JSON.stringify(raw) + '\n ' });
    const returned = await transportFixture.transport.planRank(actual);
    assert.deepEqual(transportFixture.calls.map(call => call.init.body), expectedWires(oracleInput));
    assert.deepEqual(returned, raw); transportFixture.checkPrefix();
    return returned;
  } });
  const core = f.openMemoryCore({ path: f.path, sourceCandidatePolicy: 'bounded-keyset-v1',
    model: { ...invocation.model, rank(request) { ranks++; return invocation.model.rank(request); } } }); f.handles.add(core);
  const recall = await core.recall({ readSet: [f.namespace], query: f.plan.mem0Input.query, limit: 6,
    contextMode: 'source-evidence', selectionMode: 'bounded-source-scan' });
  ok(recall); assert.equal(ranks, 1); assert.equal(callbacks, 1); assert.equal(selects, 0);
  assert.equal(transportFixture.calls.length, 2);
  const compiled = invocation.takePlan();
  assert.deepEqual(compiled.refs.map(ref => ref.memoryId), [5, 1, 0].map(index => wire.input.cards[index].memory.id));
  const derived = prepareCardPlanRankRequest({ system: 'Actual core rank envelope',
    input: { query: wire.input.query, limit: wire.input.limit, candidates: wire.input.cards }, maxOutputTokens: 1024, signal: wire.signal }, counter);
  assert.equal(compiled.derivedAssemblyRequestSha256, derived.requestSha256);
  const metrics = { actualRequest: counter(JSON.stringify(compiled.request)), actualProposal: counter(JSON.stringify(raw)),
    derivedCPRequest: counter(JSON.stringify(derived.request)),
    derivedCPProposal: counter(JSON.stringify(compiled.diagnostics.derivedAssemblyProposal)), refs: counter(JSON.stringify({ refs: compiled.refs })),
    countHTTP: counter(transportFixture.calls[0].init.body), generationHTTP: counter(transportFixture.calls[1].init.body) };
  t.diagnostic(`RW6 actual captured-ID tokens ${JSON.stringify(metrics)}`);
  assert.equal(compiled.requestSha256, sha(JSON.stringify(compiled.request)));
  assert.equal(compiled.proposalSha256, sha(JSON.stringify(raw)));
  assert.notEqual(compiled.requestSha256, compiled.derivedAssemblyRequestSha256);
  assert.equal(transportFixture.records[3].responseSha256, sha(transportFixture.rawResponse));
  assert.equal(transportFixture.records[3].responseBody, transportFixture.rawResponse);
  return { compiled, recall, core, plan: f.plan, namespace: f.namespace, question: f.question,
    invocation, transportFixture, wire, raw };
}
const assemble = run => assembleReceiptGroupPlan(Object.fromEntries(['compiled', 'recall', 'core', 'plan', 'namespace', 'question'].map(key => [key, run[key]])));
const flatCards = packed => JSON.parse(packed.request.messages[1].content).evidence.map(unit => {
  const value = JSON.parse(unit.text); assert.deepEqual(Object.keys(value), ['format', 'memoryId', 'revision', 'sources']);
  assert.equal(value.format, 'card-plan-flat-source-evidence-v1'); const { format, ...card } = value; return card;
});

offline('RW6 actual cold core -> one RG callback/two fake HTTP -> authoritative complete flat packing', async (t, counter) => {
  const f = await capturedFixture(t, counter), run = await runCaptured(t, counter, f);
  const evidence = assemble(run), packed = packReceiptGroupAnswer({ evidence, countTokens: counter });
  assert.deepEqual(flatCards(packed), [5, 1, 0].map(i => f.oracle.get(run.wire.input.cards[i].memory.id)));
  assert.equal(flatCards(packed).length, 3); assert(flatCards(packed).every(card => card.sources.length === 2));
  assert.deepEqual(packed.omittedIndices, []); assert.deepEqual(packed.duplicateIndices, []);
  assert.equal(packed.inputTokens, counter(JSON.stringify(packed.request))); assert(packed.inputTokens <= 6000);
  assert.deepEqual(evidence.receiptGroupProposal, run.raw);
  assert.equal(evidence.provenance.actualRequestSha256, run.compiled.requestSha256);
  assert.equal(evidence.provenance.derivedAssemblyRequestSha256, run.compiled.derivedAssemblyRequestSha256);
  assert.throws(run.invocation.takePlan, code('invalid_receipt_group_plan'));
  assert.throws(() => assemble(run), code('invalid_receipt_group_plan'));
  await f.workspace.cleanup(); assert.equal(existsSync(f.workspace.path), false); await run.transportFixture.cleanup();
});

offline('RW3 genuine empty core never invokes rank or receipt-group HTTP', async (t, counter) => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-receipt-group-empty-' });
  const { openMemoryCore } = await import('../../../core/contract.mjs'); let ranks = 0, callbacks = 0, selects = 0;
  const invocation = createReceiptGroupInvocation({ contextWindow: 8192, countTokens: counter,
    select() { selects++; assert.fail('Empty bounded source scan must not select'); } },
    { planRank() { callbacks++; assert.fail('Empty core must not dispatch receipt-group transport'); } });
  const core = openMemoryCore({ path: join(workspace.path, 'empty.sqlite'), sourceCandidatePolicy: 'bounded-keyset-v1',
    model: { ...invocation.model, rank(request) { ranks++; return invocation.model.rank(request); } } });
  workspace.defer(() => core.close());
  const recall = ok(await core.recall({ readSet: [{ ownerId: 'empty-receipt-group', scope: 'personal', projectId: null }], query,
    limit: 6, contextMode: 'source-evidence', selectionMode: 'bounded-source-scan' }));
  assert.deepEqual(recall.memories, []); assert.equal(ranks, 0); assert.equal(callbacks, 0); assert.equal(selects, 0);
  assert.throws(invocation.takePlan, code('invalid_receipt_group_plan'));
  await workspace.cleanup(); assert.equal(existsSync(workspace.path), false);
});

offline('RW6 stale/deleted/source-drift/foreign-query assembly fails and consumes after real wire recall', async (t, counter) => {
  for (const mode of ['stale', 'deleted', 'source-drift', 'foreign-query']) {
    const f = await capturedFixture(t, counter), run = await runCaptured(t, counter, f);
    const ref = run.compiled.refs[0], input = { namespace: run.namespace, memoryId: ref.memoryId, expectedRevision: ref.revision };
    if (mode === 'deleted') ok(run.core.forget(input));
    if (mode === 'stale') ok(run.core.correct({ ...input, content: 'Changed inert card', kind: 'context',
      receipt: { client: 'fresh-http-test', sessionId: 'changed', eventId: 'changed', role: 'user', excerpt: 'Changed inert card' } }));
    if (mode === 'source-drift') { run.recall = structuredClone(run.recall); run.recall.value.memories[0].receipts[0].excerpt += ' Changed'; }
    if (mode === 'foreign-query') run.question = { ...run.question, text: 'A different fresh synthetic question?' };
    assert.throws(() => assemble(run));
    assert.throws(() => assemble(run), code('invalid_receipt_group_plan'));
    assert.throws(run.invocation.takePlan, code('invalid_receipt_group_plan'));
  }
});

offline('RW6 owned setup/assertion child failures leave no new scratch', async (t, counter) => {
  const parent = createTestWorkspace(t, { prefix: 'cairn-receipt-group-wire-parent-' });
  for (const mode of ['setup', 'assertion']) {
    const result = spawnSync(process.execPath, ['tools/testing/run.mjs', '--test-name-pattern=RW6 deliberate owned wire child failure',
      'evaluation/architecture/test/receipt-group-transport.test.mjs'], { encoding: 'utf8', env: { ...process.env,
        TMPDIR: parent.path, TMP: parent.path, TEMP: parent.path, NODE_DISABLE_COMPILE_CACHE: '1', CAIRN_RECEIPT_GROUP_WIRE_FAILURE_CHILD: mode } });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, mode === 'setup' ? /Deliberate receipt-group-wire setup failure after capture/
      : /Deliberate receipt-group-wire assertion after HTTP recall/);
    assert.deepEqual(readdirSync(parent.path), [], `${mode} owned runner scratch removed`);
  }
  await parent.cleanup(); assert.equal(existsSync(parent.path), false);
});
if (process.env.CAIRN_RECEIPT_GROUP_WIRE_FAILURE_CHILD) offline('RW6 deliberate owned wire child failure', async (t, counter) => {
  const f = await capturedFixture(t, counter, { failSetup: process.env.CAIRN_RECEIPT_GROUP_WIRE_FAILURE_CHILD === 'setup' });
  await runCaptured(t, counter, f);
  assert.fail('Deliberate receipt-group-wire assertion after HTTP recall');
});
