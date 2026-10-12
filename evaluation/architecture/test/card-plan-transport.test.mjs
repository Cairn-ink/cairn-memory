import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { CARD_PLAN_RANK_INSTRUCTION, prepareCardPlanRankRequest } from '../card-plan-rank.mjs';
import { assembleCardPlanEvidence, packCardPlanAnswer } from '../card-plan-evidence.mjs';
import * as transports from '../source-bundle-plan-rank-transport.mjs';

const MODEL = 'gpt-4.1-mini-2025-04-14', VERSION = 'card-budgeted-plan-rank-v1', KEY = 'synthetic_card_wire_key_123456';
const sha = text => createHash('sha256').update(text).digest('hex');
const id = text => `lme-turn-${sha(`new-card-wire/${text}`)}`;
const code = expected => error => error?.code === expected;
const singleton = selectedCards => ({ selectedCards, chains: selectedCards.map((_, slot) => ({
  members: [slot], sources: [{ member: 0, receipt: 0 }], terminal: 0 })) });
const reply = (value, status = 200) => new Response(typeof value === 'string' ? value : JSON.stringify(value), { status });
const envelope = (proposal = singleton([1, 0]), patch = {}) => ({ id: 'resp_new_inert', model: MODEL,
  status: 'completed', error: null, incomplete_details: null,
  output: [{ type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: typeof proposal === 'string' ? proposal : JSON.stringify(proposal) }] }],
  usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 }, ...patch });
const [major, minor] = process.versions.node.split('.').map(Number);
const supported = major > 22 || major === 22 && minor >= 16;
async function prerequisite() {
  if (!supported) {
    if (process.env.CAIRN_CARD_PLAN_TRANSPORT_REQUIRED === '1') throw new Error('required_sqlite_unavailable');
    return null;
  }
  try { return (await import('../../../adapters/openai/index.mjs')).countOpenAITokens; }
  catch (error) {
    if (process.env.CAIRN_CARD_PLAN_TRANSPORT_REQUIRED !== '1' && error.code === 'ERR_MODULE_NOT_FOUND'
      && error.message.includes("Cannot find package 'tiktoken'")) return null;
    throw error;
  }
}
const offline = (name, body) => test(name, async t => {
  assert.equal(typeof transports.createCardPlanRankTransport, 'function', 'New closed card wire factory must exist');
  const countTokens = await prerequisite();
  if (!countTokens) { t.skip('Optional SQLite/tiktoken absent; required flag fails instead'); return; }
  await body(t, countTokens);
});
const candidates = (texts = ['Courier Juniper has route M at the north site.', 'Proposal: route M might use shelf silver.']) =>
  texts.map((excerpt, index) => ({ namespaceIndex: 0, memory: { id: id(`memory/${index}`), revision: 1, currentness: 'current' },
    receipts: [{ id: id(`receipt/${index}`), role: index % 2 ? 'assistant' : 'user', excerpt }], receiptCount: 1,
    interpretationStatus: 'omitted', sourceSelectionCoverage: 'unassessed' }));
const coreRequest = (controller, cards = candidates()) => ({ system: 'Actual core rank instruction',
  input: { query: 'Which shelf applies to Juniper at the north site?', limit: 6, candidates: cards },
  maxOutputTokens: 1024, signal: controller.signal });

// Independent literal schema/wire oracle. No production schema builder is called.
function wires(input) {
  const index = maximum => ({ type: 'integer', minimum: 0, maximum });
  const schema = { type: 'object', additionalProperties: false, required: ['selectedCards', 'chains'], properties: {
    selectedCards: { type: 'array', maxItems: input.limit, items: index(Math.max(0, input.cards.length - 1)) },
    chains: { type: 'array', maxItems: 6, items: { type: 'object', additionalProperties: false,
      required: ['members', 'sources', 'terminal'], properties: {
        members: { type: 'array', minItems: 1, maxItems: 3, items: index(input.limit - 1) },
        sources: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'object', additionalProperties: false,
          required: ['member', 'receipt'], properties: { member: index(2), receipt: index(99) } } },
        terminal: index(5) } } } } };
  const count = { model: MODEL, instructions: CARD_PLAN_RANK_INSTRUCTION,
    input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(input) }] }],
    text: { format: { type: 'json_schema', name: 'cairn_card_budgeted_plan_rank_v1', strict: true, schema } }, truncation: 'disabled' };
  return [JSON.stringify(count), JSON.stringify({ ...count, max_output_tokens: 1024, store: false, stream: false })];
}

async function fixture(t, countTokens, options = {}) {
  const budget = await import('../../experiment-budget/index.mjs');
  const { DatabaseSync } = await import('node:sqlite');
  const workspace = createTestWorkspace(t, { prefix: 'cairn-new-card-wire-' }), handles = [];
  workspace.defer(() => { for (const handle of handles) handle.close(); });
  const configuration = { directory: join(workspace.path, 'ledger'), runId: randomUUID(), limitMicroUsd: 400000000, requestCap: 20 };
  const old = budget.createExperimentBudget(configuration), prefixId = randomUUID();
  try { old.reserve({ attemptId: prefixId, channel: 'host-completion', reservedMicroUsd: 30 });
    old.recordOutcome({ attemptId: prefixId, outcome: 'unknown' }); } finally { old.close(); }
  const rows = () => {
    const database = new DatabaseSync(join(configuration.directory, 'experiment-budget.sqlite'), { readOnly: true });
    try { return database.prepare('SELECT rowid, * FROM attempts ORDER BY rowid').all(); } finally { database.close(); }
  };
  const prefix = rows();
  const inspected = budget.inspectExperimentBudgetForEmbeddingUpgrade(configuration);
  const checkpoint = { requestCount: inspected.requestCount, reservedMicroUsd: inspected.reservedMicroUsd };
  budget.upgradeExperimentBudgetForEmbeddings({ ...configuration, expectedCheckpoint: checkpoint, expectedHistorySha256: inspected.historySha256 });
  const controller = new AbortController(), prepared = prepareCardPlanRankRequest(coreRequest(controller, options.cards), countTokens);
  const calls = [], records = [];
  const args = { configuration, checkpoint, historySha256: inspected.historySha256,
    manifest: { version: VERSION, slotId: 'new-inert-slot', preparedRequestSha256: prepared.requestSha256,
      runDeadline: performance.now() + 10000, caseDeadline: performance.now() + 10000, ...options.manifest },
    apiKey: KEY, fetchImpl(url, init) { calls.push({ url, init }); return options.fetch ? options.fetch(url, init, calls.length)
      : reply(calls.length === 1 ? { object: 'response.input_tokens', input_tokens: 500 } : envelope()); },
    onRecord(record) { records.push(record); return options.observe?.(record, controller); } };
  const transport = await transports.createCardPlanRankTransport(args); handles.push(transport);
  return { workspace, controller, prepared, calls, records, args, transport, handles,
    request: { ...prepared.request, signal: controller.signal }, prefix,
    checkPrefix() { assert.deepEqual(rows().slice(0, prefix.length), prefix); } };
}

offline('CW3/4 literal wires preserve card identities/receipts/order and settle exactly two synthetic calls', async (t, counter) => {
  const f = await fixture(t, counter); assert.deepEqual(await f.transport.planRank(f.request), singleton([1, 0]));
  const input = { query: 'Which shelf applies to Juniper at the north site?', limit: 6,
    cards: candidates().map((card, candidateIndex) => ({ candidateIndex, ...card })) };
  assert.deepEqual(f.calls.map(call => call.init.body), wires(input));
  assert.deepEqual(f.calls.map(call => call.url), ['https://api.openai.com/v1/responses/input_tokens', 'https://api.openai.com/v1/responses']);
  for (const [index, call] of f.calls.entries()) {
    assert.equal(call.init.method, 'POST'); assert.equal(call.init.redirect, 'error');
    assert(counter(call.init.body) <= 6000); assert.equal(f.records[index * 2].requestSha256, sha(wires(input)[index]));
  }
  assert.equal(f.records.length, 4); assert(f.records.every(record => record.version === VERSION && Object.isFrozen(record)));
  assert(!JSON.stringify(f.records).includes(KEY));
  const state = f.transport.getState(); assert.equal(state.requestCount, 3); assert.equal(state.reservedMicroUsd, 10030);
  assert.deepEqual(state.attempts.slice(1).map(row => [row.channel, row.reservedMicroUsd, row.outcome, row.actualMicroUsd]),
    [['cairn-count', 5000, 'succeeded', null], ['cairn-generation', 5000, 'succeeded', 72]]);
  f.checkPrefix(); await assert.rejects(f.transport.planRank(f.request), code('slot_consumed'));
  await f.workspace.cleanup(); assert.equal(existsSync(f.workspace.path), false);
});

offline('CW3 schema/instruction/order/index/hash drift and foreign v1 manifests dispatch nothing', async (t, counter) => {
  for (const mode of ['schema', 'instruction', 'order', 'index', 'hash', 'getter', 'proxy', 'limit']) {
    const f = await fixture(t, counter); f.request = { ...structuredClone(f.prepared.request), signal: f.controller.signal };
    let hooks = 0; const trap = () => { hooks++; throw new Error(KEY); };
    if (mode === 'schema') f.request.outputSchema.properties.selectedCards.maxItems = 7;
    if (mode === 'instruction') f.request.system += ' Changed';
    if (mode === 'order') f.request.input.cards.reverse();
    if (mode === 'index') f.request.input.cards[0].candidateIndex = 1;
    if (mode === 'hash') f.request.input.query += ' Changed';
    if (mode === 'getter') Object.defineProperty(f.request.input.cards[0], 'receipts', { enumerable: true, get: trap });
    if (mode === 'proxy') f.request.input.cards[0] = new Proxy(f.request.input.cards[0], { ownKeys: trap });
    if (mode === 'limit') f.request.maxOutputTokens = 1025;
    await assert.rejects(f.transport.planRank(f.request), code('invalid_request'));
    assert.equal(hooks, 0); assert.equal(f.calls.length, 0); assert.equal(f.transport.getState().requestCount, 1); f.checkPrefix();
  }
  const f = await fixture(t, counter); f.transport.close();
  await assert.rejects(transports.createCardPlanRankTransport({ ...f.args, manifest: { ...f.args.manifest, version: 'source-bundle-plan-rank-v1' } }), code('invalid_configuration'));
  await assert.rejects(transports.createSourceBundlePlanRankTransport(f.args), code('invalid_configuration'));
  await assert.rejects(transports.createCardPlanRankTransport({ ...f.args, policy: {} }), code('invalid_configuration'));
  let hooks = 0; const trap = () => { hooks++; throw new Error(KEY); };
  await assert.rejects(transports.createCardPlanRankTransport(new Proxy(f.args, { ownKeys: trap })), code('invalid_configuration'));
  await assert.rejects(transports.createCardPlanRankTransport({ ...f.args, configuration: new Proxy(f.args.configuration, { ownKeys: trap }) }), code('invalid_configuration'));
  assert.equal(hooks, 0);
  assert.equal(f.calls.length, 0);
});

offline('CW5 structural budgets, incomplete envelopes, duplicate keys and malformed usage never repair/retry', async (t, counter) => {
  const four = { selectedCards: [0, 1, 2, 3], chains: [{ members: [0, 1, 2, 3],
    sources: [0, 1, 2, 3].map(member => ({ member, receipt: 0 })), terminal: 3 }] };
  const seven = singleton([0, 1, 2, 3, 4, 5, 6]);
  const whitespace = ' \n'.repeat(2200) + '{"selectedCards":[],"chains":[]}'; assert(counter(whitespace) > 1024);
  const variants = [
    [envelope(four), 'invalid_model_output', 72], [envelope(seven), 'invalid_model_output', 72],
    [envelope('{"selectedCards":[],"selectedCards":[],"chains":[]}'), 'invalid_model_output', 72],
    [envelope(whitespace), 'invalid_model_output', 72], [envelope(' '.repeat(40001)), 'invalid_model_output', 72],
    [envelope(undefined, { status: 'incomplete' }), 'invalid_model_output', 72],
    [envelope(undefined, { usage: { input_tokens: 100, output_tokens: '20', total_tokens: 120 } }), 'invalid_usage', null],
    ['{"usage":{"input_tokens":100},"usage":null}', 'invalid_usage', null],
    [envelope(undefined, { model: 'unapproved-model' }), 'model_mismatch', 72],
    [envelope(undefined, { usage: { input_tokens: 100, output_tokens: 1025, total_tokens: 1125 } }), 'usage_overrun', 1680],
  ];
  for (const [value, expected, price] of variants) {
    const f = await fixture(t, counter, { cards: candidates(Array.from({ length: 7 }, (_, i) => `Inert distinct card ${i}`)),
      fetch: (_, __, n) => reply(n === 1 ? { object: 'response.input_tokens', input_tokens: 500 } : value) });
    await assert.rejects(f.transport.planRank(f.request), code(expected)); assert.equal(f.calls.length, 2);
    assert.equal(f.transport.getState().attempts.at(-1).actualMicroUsd, price);
    assert.equal(f.transport.getState().attempts.at(-1).outcome, 'failed'); f.checkPrefix();
    await assert.rejects(f.transport.planRank(f.request), code('slot_consumed'));
  }
});

offline('CW4/5 callback failure, request mutation, cancellation/deadline and concurrent calls keep exact boundaries', async (t, counter) => {
  for (const mode of ['throw', 'promise', 'mutation', 'abort', 'post-generation']) {
    const f = await fixture(t, counter, { observe(record, controller) {
      if (mode === 'post-generation') { if (record.phase === 'post' && record.kind === 'generation') throw new Error(KEY); return; }
      if (record.phase !== 'pre') return;
      if (mode === 'throw') throw new Error(KEY);
      if (mode === 'promise') return Promise.resolve();
      if (mode === 'mutation') f.request.input.query = 'Changed';
      if (mode === 'abort') controller.abort();
    } });
    f.request = { ...structuredClone(f.prepared.request), signal: f.controller.signal };
    await assert.rejects(f.transport.planRank(f.request), code(mode === 'mutation' ? 'request_mutated'
      : mode === 'abort' ? 'cancelled' : 'record_persistence_failed'));
    assert.equal(f.calls.length, mode === 'post-generation' ? 2 : 0);
    assert.equal(f.transport.getState().attempts.at(-1).outcome, mode === 'post-generation' ? 'succeeded' : 'failed');
    assert(!JSON.stringify(f.records).includes(KEY)); f.checkPrefix();
  }
  for (const expired of [false, true]) {
    const f = await fixture(t, counter, expired ? { manifest: { caseDeadline: performance.now() - 1 } } : {});
    if (!expired) f.controller.abort();
    await assert.rejects(f.transport.planRank(f.request), code(expired ? 'deadline_exceeded' : 'cancelled'));
    assert.equal(f.calls.length, 0); assert.equal(f.transport.getState().requestCount, 1);
  }
  // Allow real-tokenizer preparation under concurrent CI load before isolating
  // timeout of an actually dispatched, never-resolving fake fetch.
  const f = await fixture(t, counter, { manifest: { caseDeadline: performance.now() + 3000 }, fetch: (_, init) => {
    assert(performance.now() < f.args.manifest.caseDeadline, 'First stalled dispatch must precede its manifest deadline');
    assert.equal(init.signal.aborted, false); return new Promise(() => {});
  } });
  const running = f.transport.planRank(f.request);
  assert.throws(() => f.transport.close(), code('transport_busy'));
  await assert.rejects(f.transport.planRank(f.request), code('transport_busy'));
  await assert.rejects(running, code('deadline_exceeded')); assert.equal(f.calls.length, 1);
  assert.equal(f.transport.getState().attempts.at(-1).outcome, 'unknown'); f.checkPrefix();
});

offline('CW3 complete serialized envelope boundary uses the real tokenizer before reservation', async (t, counter) => {
  const f = await fixture(t, counter); let boundary;
  for (let size = 80; size <= 800; size += 2) {
    try {
      const prepared = prepareCardPlanRankRequest(coreRequest(f.controller,
        candidates(Array.from({ length: 18 }, (_, i) => `${i} ` + 'ab_cd '.repeat(134).slice(0, size - 3)))), counter);
      if (counter(JSON.stringify(prepared.request)) <= 6000 && wires(prepared.request.input).some(wire => counter(wire) > 6000)) { boundary = prepared; break; }
    } catch (error) { if (error.code !== 'context_budget_exceeded') throw error; }
  }
  assert(boundary, 'Fresh shape-valid request must isolate full serialized HTTP body pressure');
  f.transport.close();
  const transport = await transports.createCardPlanRankTransport({ ...f.args,
    manifest: { ...f.args.manifest, preparedRequestSha256: boundary.requestSha256 } }); f.handles.push(transport);
  await assert.rejects(transport.planRank({ ...boundary.request, signal: f.controller.signal }), code('context_budget_exceeded'));
  assert.equal(f.calls.length, 0); assert.equal(transport.getState().requestCount, 1);
});

async function captureFixture(t, counter) {
  const { openMemoryCore } = await import('../../../core/contract.mjs');
  const { prepareMixedSourceCase } = await import('../../longmemeval/mixed-source.mjs');
  const workspace = createTestWorkspace(t, { prefix: 'cairn-new-card-core-' }), handles = [];
  workspace.defer(() => { for (const handle of handles) handle.close(); });
  const groups = [
    [['user', 'Courier Juniper is assigned route M at the north site.'], ['assistant', 'Quotation: route M could use shelf silver; adoption is unstated.']],
    [['user', 'The north-site shelf mapping is missing from this record.']],
    [['user', 'The shared prerequisite is the recorded route assignment.']],
    [['assistant', 'Proposal: route M could use shelf silver.']],
    [['assistant', 'Proposal: route M could use shelf silver.']],
    [['user', 'At the south site route M used shelf copper on September 1.']],
  ];
  const namespace = { ownerId: 'new-card-wire-inert', scope: 'project', projectId: `lme-case-${sha('fresh-card-wire-case')}` };
  const plan = prepareMixedSourceCase({ namespace, history: { question_id: namespace.projectId, sessions: groups.map((sources, i) => ({
    session_index: i, session_id: `lme-session-${sha(`fresh-card-wire-session/${i}`)}`, date: '2026/10/12 (Mon) 12:00',
    turns: sources.map(([role, content], j) => ({ turn_id: id(`turn/${i}/${j}`), role, content })) })) },
  question: { question_id: namespace.projectId, text: 'Which shelf applies to Juniper at the north site?', date: '2026/10/13 (Tue) 12:00' } }, 'indexed-evidence-v1');
  const path = join(workspace.path, 'memory.sqlite'), oracle = new Map(), equalTextOracle = []; let captured = 0;
  const base = { countTokens: counter, contextWindow: 8192,
    extract({ input }) { return { items: [{ content: `Fresh inert card ${++captured}`, kind: 'context', confidence: 1,
      sourceIndices: input.messages.map(source => source.index) }] }; },
    classify({ input }) { return { items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) }; },
    select() { assert.fail('Bounded-source-scan must not select'); }, rank() { assert.fail('Invocation must replace rank'); } };
  const capture = openMemoryCore({ path, model: base, captureSourcePolicy: 'indexed-evidence-v1' }); handles.push(capture);
  for (const batch of plan.cairnPlan.batches) {
    const outcome = await capture.capture(batch.captureInput); assert.equal(outcome.ok, true);
    const memory = outcome.value.admission.memories[0], detail = capture.get({ namespace, memoryId: memory.id, receiptLimit: 100 });
    assert.equal(detail.ok, true);
    assert.deepEqual(detail.value.receipts.map(receipt => [receipt.role, receipt.excerpt]).sort(),
      batch.indexedWindows.map(window => [window.role, window.content]).sort(), 'Literal original role/text oracle');
    oracle.set(memory.id, { memoryId: memory.id, revision: detail.value.memory.revision,
      sources: detail.value.receipts.map(receipt => ({ receiptId: receipt.id, recordedRole: receipt.role, text: receipt.excerpt })) });
    if (batch.indexedWindows.length === 1 && batch.indexedWindows[0].content.includes('Proposal: route M could use shelf silver.')) {
      equalTextOracle.push({ memoryId: memory.id, text: batch.indexedWindows[0].content });
    }
  }
  assert.equal(equalTextOracle.length, 2); assert.equal(equalTextOracle[0].text, equalTextOracle[1].text);
  assert.notEqual(equalTextOracle[0].memoryId, equalTextOracle[1].memoryId);
  capture.close();
  return { workspace, handles, path, plan, namespace, oracle, equalTextOracle, base,
    question: { text: plan.originalQuestion.text, date: plan.canonicalQuestionDate }, openMemoryCore };
}

offline('CW5 actual cold SQLite capture -> bounded scan -> invocation/fake HTTP -> authoritative read -> flat answer', async (t, counter) => {
  const { createCardPlanRankInvocation } = await import('../card-plan-invocation.mjs');
  const f = await captureFixture(t, counter); let ranks = 0, wireInput, transportFixture;
  const proposal = { selectedCards: [5, 2, 0, 3, 4, 1], chains: [
    ...[1, 2].map(slot => ({ members: [0, slot], sources: [{ member: 0, receipt: 0 }, { member: 1, receipt: 0 }], terminal: 1 })),
    ...[3, 4, 5].map(slot => ({ members: [slot], sources: [{ member: 0, receipt: 0 }], terminal: 0 })),
  ] };
  const invocation = createCardPlanRankInvocation(f.base, { async planRank(request) {
    ranks++; wireInput = request.input;
    transportFixture = await fixture(t, counter, {
      manifest: { preparedRequestSha256: sha(JSON.stringify({ system: request.system,
        input: request.input, outputSchema: request.outputSchema, maxOutputTokens: request.maxOutputTokens })) },
      fetch: (_, __, n) => reply(n === 1 ? { object: 'response.input_tokens', input_tokens: 500 } : envelope(proposal)) });
    return transportFixture.transport.planRank(request);
  } });
  const core = f.openMemoryCore({ path: f.path, model: invocation.model, sourceCandidatePolicy: 'bounded-keyset-v1' }); f.handles.push(core);
  assert.throws(invocation.takePlan, code('invalid_card_plan'));
  const recall = await core.recall({ readSet: [f.namespace], query: f.plan.mem0Input.query,
    limit: 6, contextMode: 'source-evidence', selectionMode: 'bounded-source-scan' });
  assert.equal(recall.ok, true, JSON.stringify(recall.error)); assert.equal(ranks, 1);
  const compiled = invocation.takePlan(); assert.deepEqual(compiled.refs.map(ref => ref.memoryId), proposal.selectedCards.map(i => wireInput.cards[i].memory.id));
  assert.deepEqual(transportFixture.calls.map(call => call.init.body), wires(wireInput));
  assert.deepEqual(wireInput.cards.map(card => ({ memoryId: card.memory.id, revision: card.memory.revision,
    sources: card.receipts.map(receipt => ({ receiptId: receipt.id, recordedRole: receipt.role, text: receipt.excerpt })) })),
  wireInput.cards.map(card => f.oracle.get(card.memory.id)), 'Actual planner input retains every original receipt in order');
  const evidence = assembleCardPlanEvidence({ compiled, recall, core, plan: f.plan, namespace: f.namespace, question: f.question });
  const packed = packCardPlanAnswer({ evidence, countTokens: counter });
  const cards = JSON.parse(packed.request.messages[1].content).evidence.map(unit => {
    const parsed = JSON.parse(unit.text); assert.deepEqual(Object.keys(parsed), ['format', 'memoryId', 'revision', 'sources']);
    assert.equal(parsed.format, 'card-plan-flat-source-evidence-v1'); const { format, ...card } = parsed; return card;
  });
  assert.deepEqual(cards, compiled.refs.map(ref => f.oracle.get(ref.memoryId)));
  assert.equal(cards.length, 6); assert.equal(new Set(cards.map(card => card.memoryId)).size, 6);
  assert.deepEqual(cards.filter(card => f.equalTextOracle.some(row => row.memoryId === card.memoryId))
    .map(card => ({ memoryId: card.memoryId, text: card.sources[0].text })).sort((a, b) => a.memoryId.localeCompare(b.memoryId)),
  [...f.equalTextOracle].sort((a, b) => a.memoryId.localeCompare(b.memoryId)), 'Independent full indexed-window oracle retains both equal-text identities');
  assert(cards.some(card => card.sources.length === 2), 'Whole cards keep receipts not selected as chain endpoints');
  assert.equal(evidence.semanticSufficiency, 'unassessed'); assert(packed.inputTokens <= 6000);
  assert.deepEqual(packed.omittedIndices, []); assert.deepEqual(packed.duplicateIndices, []);
  assert.equal(transportFixture.calls.length, 2); transportFixture.checkPrefix();
  assert.equal(transportFixture.transport.getState().requestCount, 3);
  assert(transportFixture.transport.getState().attempts.every(attempt => attempt.outcome !== null));
  assert.throws(invocation.takePlan, code('invalid_card_plan'));
  await f.workspace.cleanup(); await transportFixture.workspace.cleanup();
  assert.equal(existsSync(f.workspace.path), false); assert.equal(existsSync(transportFixture.workspace.path), false);
});

offline('CW2/5 new invocation never turns failed final recall or later source drift into answer evidence', async (t, counter) => {
  const { createCardPlanRankInvocation } = await import('../card-plan-invocation.mjs');
  for (const mode of ['planner-failure', 'final-read-drift', 'after-recall-drift']) {
    const f = await captureFixture(t, counter); let core, selected, refCounts = 0, calls = 0;
    const model = { ...f.base, countTokens(text) {
      if (text.startsWith('{"refs":') && ++refCounts === 2 && mode === 'final-read-drift') change();
      return counter(text);
    } };
    function change() {
      const changed = core.correct({ namespace: f.namespace, memoryId: selected.memoryId, expectedRevision: selected.revision,
        content: 'Changed inert source card', kind: 'context', receipt: { client: 'fresh-wire-test', sessionId: 'changed-session',
          eventId: 'changed-event', role: 'user', excerpt: 'Changed inert source card' } });
      assert.equal(changed.ok, true, JSON.stringify(changed.error));
    }
    const invocation = createCardPlanRankInvocation(model, { planRank(request) {
      calls++; const card = request.input.cards[0]; selected = { memoryId: card.memory.id, revision: card.memory.revision };
      if (mode === 'planner-failure') throw new Error('fresh synthetic planner failure');
      return singleton([0]);
    } });
    core = f.openMemoryCore({ path: f.path, model: invocation.model, sourceCandidatePolicy: 'bounded-keyset-v1' }); f.handles.push(core);
    const recall = await core.recall({ readSet: [f.namespace], query: f.plan.mem0Input.query,
      limit: 6, contextMode: 'source-evidence', selectionMode: 'bounded-source-scan' });
    assert.equal(calls, 1);
    if (mode === 'planner-failure') {
      assert.equal(recall.ok, false); assert.equal(recall.error.code, 'recall_failed');
      assert.throws(invocation.takePlan, code('invalid_card_plan'));
    } else {
      if (mode === 'final-read-drift') { assert.equal(recall.ok, false); assert.equal(recall.error.code, 'revision_conflict'); }
      else { assert.equal(recall.ok, true); change(); }
      // The factory knows rank completion, not core final-read success. An
      // incorrectly taken returned plan still cannot pass the accepted assembler.
      const compiled = invocation.takePlan();
      assert.throws(() => assembleCardPlanEvidence({ compiled, recall, core, plan: f.plan,
        namespace: f.namespace, question: f.question }), code(mode === 'final-read-drift' ? 'invalid_card_plan_evidence' : 'invalid_recall_provenance'));
      assert.throws(() => assembleCardPlanEvidence({ compiled, recall, core, plan: f.plan,
        namespace: f.namespace, question: f.question }), code('invalid_card_plan'));
      assert.throws(invocation.takePlan, code('invalid_card_plan'));
    }
    await assert.rejects(invocation.model.rank(coreRequest(new AbortController())), code('card_invocation_conflict'));
    await f.workspace.cleanup(); assert.equal(existsSync(f.workspace.path), false);
  }
});

offline('CW6 runner removes actual captured workspace after deliberate assertion failure', async (t, counter) => {
  const parent = createTestWorkspace(t, { prefix: 'cairn-new-card-runner-' });
  const child = spawnSync(process.execPath, ['tools/testing/run.mjs', '--test-name-pattern=CW6 deliberate fresh capture failure',
    'evaluation/architecture/test/card-plan-transport.test.mjs'], { encoding: 'utf8', env: { ...process.env,
      TMPDIR: parent.path, TMP: parent.path, TEMP: parent.path, NODE_DISABLE_COMPILE_CACHE: '1', CAIRN_CARD_WIRE_FAILURE_CHILD: '1' } });
  assert.equal(child.status, 1, child.stdout + child.stderr); assert.match(child.stdout, /Deliberate failure after fresh actual capture/);
  assert.deepEqual(readdirSync(parent.path), []);
  await parent.cleanup(); assert.equal(existsSync(parent.path), false);
});
if (process.env.CAIRN_CARD_WIRE_FAILURE_CHILD === '1') offline('CW6 deliberate fresh capture failure', async (t, counter) => {
  await captureFixture(t, counter); assert.fail('Deliberate failure after fresh actual capture');
});
