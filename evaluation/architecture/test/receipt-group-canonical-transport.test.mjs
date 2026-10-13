import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { prepareCanonicalReceiptGroupPlan, compileCanonicalReceiptGroupPlan,
  CANONICAL_RECEIPT_GROUP_RANK_INSTRUCTION } from '../receipt-group-canonical-plan.mjs';
import { createCanonicalReceiptGroupPlanRankTransport } from '../source-bundle-plan-rank-transport.mjs';

const VERSION = 'receipt-group-canonical-plan-rank-v1', MODEL = 'gpt-4.1-mini-2025-04-14';
const KEY = 'synthetic_canonical_wire_key_123456';
const sha = text => createHash('sha256').update(text).digest('hex');
const code = expected => error => error?.code === expected;
const cards = ['alder', 'birch'].map((id, i) => ({ namespaceIndex: 0,
  memory: { id: `canonical-wire-parcel-${id}`, revision: i + 1, currentness: 'current' },
  receipts: [{ id: `canonical-wire-receipt-${id}`, role: i ? 'assistant' : 'user', excerpt: `Inert wire passage ${id}.` }],
  receiptCount: 1, interpretationStatus: 'omitted', sourceSelectionCoverage: 'unassessed' }));
const raw = { groups: [{ contextReceiptIds: ['canonical-wire-receipt-alder', 'canonical-wire-receipt-birch',
  'canonical-wire-receipt-birch'], terminalReceiptId: 'canonical-wire-receipt-alder' }] };
const envelope = text => JSON.stringify({ id: 'resp_canonical_fresh', model: MODEL, status: 'completed', error: null,
  incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text }] }], usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } });
const offline = (name, body) => test(name, async t => {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (!(major > 22 || major === 22 && minor >= 16)) {
    if (process.env.CAIRN_CARD_PLAN_TRANSPORT_REQUIRED === '1') throw new Error('required_sqlite_unavailable');
    t.skip('Optional native SQLite unavailable'); return;
  }
  let counter;
  try { counter = (await import('../../../adapters/openai/index.mjs')).countOpenAITokens; }
  catch (error) {
    if (process.env.CAIRN_CARD_PLAN_TRANSPORT_REQUIRED !== '1' && error.code === 'ERR_MODULE_NOT_FOUND'
      && error.message.includes("Cannot find package 'tiktoken'")) { t.skip('Optional tokenizer unavailable'); return; }
    throw error;
  }
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { assert.fail('Unexpected network'); };
  t.after(() => { globalThis.fetch = originalFetch; });
  await body(t, counter);
});
async function fixture(t, counter, { text = ' \n' + JSON.stringify(raw) + '\n ', observe } = {}) {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-canonical-wire-' });
  const handles = []; workspace.defer(() => { for (const handle of handles) handle.close(); });
  const budget = await import('../../experiment-budget/index.mjs');
  const configuration = { directory: join(workspace.path, 'ledger'), runId: randomUUID(), limitMicroUsd: 400000000, requestCap: 20 };
  const initial = budget.createExperimentBudget(configuration); initial.close();
  const inspected = budget.inspectExperimentBudgetForEmbeddingUpgrade(configuration);
  const checkpoint = { requestCount: inspected.requestCount, reservedMicroUsd: inspected.reservedMicroUsd };
  budget.upgradeExperimentBudgetForEmbeddings({ ...configuration, expectedCheckpoint: checkpoint, expectedHistorySha256: inspected.historySha256 });
  const controller = new AbortController(), input = { query: 'Which fresh wire passage applies?', limit: 2, cards };
  const prepared = prepareCanonicalReceiptGroupPlan({ system: 'Core envelope',
    input: { query: input.query, limit: input.limit, candidates: cards }, maxOutputTokens: 1024, signal: controller.signal }, counter);
  const response = envelope(text), calls = [], records = [];
  const args = { configuration, checkpoint, historySha256: inspected.historySha256,
    manifest: { version: VERSION, slotId: 'canonical-fresh-slot', preparedRequestSha256: prepared.requestSha256,
      runDeadline: performance.now() + 10000, caseDeadline: performance.now() + 10000 }, apiKey: KEY,
    fetchImpl(url, init) { calls.push({ url, init }); return new Response(calls.length === 1
      ? JSON.stringify({ object: 'response.input_tokens', input_tokens: 500 }) : response); },
    onRecord(record) { records.push(record); observe?.(record, controller); } };
  const transport = await createCanonicalReceiptGroupPlanRankTransport(args); handles.push(transport);
  return { transport, args, controller, prepared, request: { ...prepared.request, signal: controller.signal }, response, calls, records, input,
    async cleanup() { await workspace.cleanup(); assert.equal(existsSync(workspace.path), false); } };
}

offline('C1/C4/C5 exact successor factory returns immutable raw proposal and literal first-response provenance', async (t, counter) => {
  const f = await fixture(t, counter), returned = await f.transport.planRank(f.request);
  assert.deepEqual(returned, raw); assert(Object.isFrozen(returned.groups[0].contextReceiptIds));
  const compiled = compileCanonicalReceiptGroupPlan(f.prepared, returned);
  assert.deepEqual(compiled.canonicalProposal, { groups: [{ contextReceiptIds: ['canonical-wire-receipt-birch'], terminalReceiptId: 'canonical-wire-receipt-alder' }] });
  assert.deepEqual(compiled.refs.map(ref => ref.memoryId), ['canonical-wire-parcel-birch', 'canonical-wire-parcel-alder']);
  const receipt = { type: 'string', enum: ['canonical-wire-receipt-alder', 'canonical-wire-receipt-birch'] };
  const schema = { type: 'object', additionalProperties: false, required: ['groups'], properties: {
    groups: { type: 'array', maxItems: 6, items: { type: 'object', additionalProperties: false,
      required: ['contextReceiptIds', 'terminalReceiptId'], properties: {
        contextReceiptIds: { type: 'array', minItems: 0, maxItems: 5, items: receipt }, terminalReceiptId: receipt } } } } };
  const body = { model: MODEL, instructions: CANONICAL_RECEIPT_GROUP_RANK_INSTRUCTION,
    input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(f.input) }] }],
    text: { format: { type: 'json_schema', name: 'cairn_receipt_group_canonical_plan_rank_v1', strict: true, schema } }, truncation: 'disabled' };
  const expected = [JSON.stringify(body), JSON.stringify({ ...body, max_output_tokens: 1024, store: false, stream: false })];
  assert.deepEqual(f.calls.map(call => call.init.body), expected);
  assert.deepEqual(f.calls.map(call => call.url), ['https://api.openai.com/v1/responses/input_tokens', 'https://api.openai.com/v1/responses']);
  assert(expected.every(text => counter(text) <= 6000));
  assert.equal(f.records.length, 4); assert(f.records.every(record => record.version === VERSION));
  assert.equal(f.records[3].responseBody, f.response); assert.equal(f.records[3].responseSha256, sha(f.response));
  assert.equal(f.records[3].inputTokens, 100); assert.equal(f.records[3].outputTokens, 20);
  assert.deepEqual(f.records.filter(record => record.phase === 'pre').map(record => record.requestSha256), expected.map(sha));
  assert.equal(f.transport.getState().requestCount, 2);
  await assert.rejects(f.transport.planRank(f.request), code('slot_consumed')); await f.cleanup();
});

offline('C2/C5 parser/raw-bound negatives exhaust without repair, retry or scratch', async (t, counter) => {
  const malformed = [
    '{"groups":[],"groups":[]}',
    '{"groups":[{"contextReceiptIds":[],"terminalReceiptId":"canonical-wire-receipt-alder","terminalReceiptId":"canonical-wire-receipt-birch"}]}',
    JSON.stringify({ groups: [{ contextReceiptIds: Array(6).fill('canonical-wire-receipt-alder'), terminalReceiptId: 'canonical-wire-receipt-alder' }] }),
    JSON.stringify({ groups: Array(7).fill({ contextReceiptIds: [], terminalReceiptId: 'canonical-wire-receipt-alder' }) }),
    JSON.stringify({ groups: [{ contextReceiptIds: ['unknown', 'unknown'], terminalReceiptId: 'canonical-wire-receipt-alder' }] }),
    JSON.stringify({ groups: [{ ...raw.groups[0], adopted: true }] }),
    ' '.repeat(41000) + JSON.stringify(raw),
  ];
  for (const text of malformed) {
    const f = await fixture(t, counter, { text });
    await assert.rejects(f.transport.planRank(f.request), code('invalid_model_output'));
    assert.equal(f.calls.length, 2); assert.equal(f.records[3].responseBody, f.response);
    await assert.rejects(f.transport.planRank(f.request), code('slot_consumed')); await f.cleanup();
  }
});

offline('C5 closed profile, abstention and native tamper/cancellation boundaries', async (t, counter) => {
  const f = await fixture(t, counter, { text: '{"groups":[]}' });
  for (const version of ['receipt-group-plan-rank-v1', 'card-budgeted-plan-rank-v1', 'source-bundle-plan-rank-v1']) {
    await assert.rejects(createCanonicalReceiptGroupPlanRankTransport({ ...f.args, manifest: { ...f.args.manifest, version } }), code('invalid_configuration'));
  }
  await assert.rejects(createCanonicalReceiptGroupPlanRankTransport({ ...f.args, profile: {} }), code('invalid_configuration'));
  assert.deepEqual(await f.transport.planRank(f.request), { groups: [] }); await f.cleanup();
  for (const mode of ['cancel', 'accessor', 'prototype', 'swap']) {
    let hooks = 0;
    const g = await fixture(t, counter, { observe(record, controller) {
      if (record.phase !== 'post' || record.kind !== 'count') return;
      if (mode === 'cancel') controller.abort();
      if (mode === 'accessor') Object.defineProperty(controller.signal, 'aborted', { get() { hooks++; return false; } });
      if (mode === 'prototype') Object.setPrototypeOf(controller.signal, Object.create(AbortSignal.prototype));
      if (mode === 'swap') g.request.signal = new AbortController().signal;
    } });
    await assert.rejects(g.transport.planRank(g.request), code(mode === 'cancel' ? 'cancelled' : 'request_mutated'));
    assert.equal(g.calls.length, 1); assert.equal(hooks, 0);
    if (mode !== 'cancel') assert.equal(g.transport.health().fatalCode, 'request_mutated');
    await assert.rejects(g.transport.planRank(g.request), code('slot_consumed')); await g.cleanup();
  }
});
