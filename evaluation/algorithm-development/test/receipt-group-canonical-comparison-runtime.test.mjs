import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';

const MODEL = 'gpt-4.1-mini-2025-04-14', KEY = 'synthetic_new_canonical_comparison_key';
const source = () => JSON.parse(readFileSync(new URL('../receipt-group-canonical-comparison-cases.json', import.meta.url)));
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result.error)); return result.value; };
const normalize = text => text.normalize('NFKC').replace(/\s+/gu, ' ').trim();
const wrap = (session, turn) => `[session-date: ${session.date.slice(0, 10).replaceAll('/', '-')} ${session.date.slice(-5)}; clock: dataset-local] source{${normalize(turn.content)} }`;
const envelope = value => ({ id: 'resp_new_comparison', object: 'response', model: MODEL, status: 'completed', error: null, incomplete_details: null,
  output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
  usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } });
const answer = () => ({ object: 'chat.completion', model: MODEL, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Synthetic plumbing response, not a judged answer.' } }],
  usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } });
async function dependencies() {
  return { ...(await import('../receipt-group-canonical-comparison-store.mjs')), ...(await import('../receipt-group-canonical-comparison-runner.mjs')),
    ...(await import('../../../core/contract.mjs')), counter: (await import('../../../adapters/openai/index.mjs')).countOpenAITokens,
    budget: await import('../../experiment-budget/index.mjs') };
}
const offline = (name, body) => test(name, async t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch'); let network = 0;
  Object.defineProperty(globalThis, 'fetch', { ...descriptor, value() { network++; throw Error('No real network'); } });
  t.after(() => { Object.defineProperty(globalThis, 'fetch', descriptor); assert.equal(network, 0); });
  await body(t, await dependencies());
});
async function fixture(t, api, config = {}) {
  const w = createTestWorkspace(null, { prefix: 'cairn-canonical-qa24-' });
  t.after(async () => { await w.cleanup(); assert.equal(existsSync(w.path), false); t.diagnostic(`Owned comparison workspace absent ${w.path}`); });
  const preparation = await api.prepareCanonicalReceiptGroupComparison({ outputRoot: join(w.path, 'prepared') });
  const raw = source(), oracles = [];
  // Independent public reads correlate runtime IDs with literal roles/wrappers;
  // neither the compiler nor the prepared indexed windows supplies expected IDs.
  for (const [index, row] of raw.cases.entries()) {
    const observed = preparation.observation.cases[index];
    const core = api.openMemoryCore({ path: observed.path, model: { countTokens: api.counter } });
    try {
      const map = ok(core.map({ namespace: row.namespace, purpose: 'recall', tokenBudget: 4000 }));
      assert.equal(map.exhausted, true); assert.equal(map.nextCursor, null);
      const details = map.items.map(item => ok(core.get({ namespace: row.namespace, memoryId: item.ref.memoryId, receiptLimit: 100 })));
      assert.equal(details.length, [6, 8, 10, 12][index % 4]);
      const receiptByLabel = new Map();
      for (const session of row.history.sessions) for (const turn of session.turns) {
        const matches = details.flatMap(detail => detail.receipts).filter(r => r.role === turn.role && r.excerpt === wrap(session, turn));
        assert.equal(matches.length, 1); receiptByLabel.set(turn.sourceLabel, matches[0]);
      }
      assert.equal(receiptByLabel.size, details.length + 1);
      assert(details.every(d => d.exhausted && d.nextReceiptCursor === null));
      oracles.push({ details, receiptByLabel });
    } finally { core.close(); }
  }
  const configuration = { directory: join(w.path, 'ledger'), runId: randomUUID(), limitMicroUsd: 400000000, requestCap: 2200, ...config };
  const ledger = api.budget.createExperimentBudget(configuration); ledger.close();
  const old = api.budget.inspectExperimentBudgetForEmbeddingUpgrade(configuration), checkpoint = { requestCount: old.requestCount, reservedMicroUsd: old.reservedMicroUsd };
  api.budget.upgradeExperimentBudgetForEmbeddings({ ...configuration, expectedCheckpoint: checkpoint, expectedHistorySha256: old.historySha256 });
  const initial = api.budget.inspectEmbeddingExperimentBudgetSnapshot(configuration);
  const calls = [], records = [], transitions = [], controller = new AbortController(); let active;
  const options = { preparation, manifest: api.createCanonicalReceiptGroupComparisonManifest(preparation.observation), configuration, checkpoint,
    historySha256: initial.historySha256, apiKey: KEY, signal: controller.signal,
    onRecord(row) { active = row; records.push(row); }, onCheckpoint(row) { transitions.push(row); },
    fetchImpl(url, init) {
      const body = JSON.parse(init.body); calls.push({ url, body: init.body, active });
      if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 500 });
      if (url.endsWith('/chat/completions')) return Response.json(answer());
      const input = JSON.parse(body.input[0].content[0].text), cards = input.candidates ?? input.cards;
      const value = input.candidates ? { refs: cards.slice(0, 2).map(card => ({ namespaceIndex: card.namespaceIndex, memoryId: card.memory.id, revision: card.memory.revision })) }
        : { groups: [{ contextReceiptIds: [cards[0].receipts[0].id, cards[0].receipts[0].id, cards[1].receipts[0].id], terminalReceiptId: cards[1].receipts[0].id }] };
      return Response.json(envelope(value));
    } };
  return { w, preparation, raw, oracles, initial, calls, records, transitions, controller, options,
    snapshot: () => api.budget.inspectEmbeddingExperimentBudgetSnapshot(configuration) };
}
function accounting(h, report) {
  assert.equal(report.denominator, 24); assert.deepEqual(report.cases.map(c => c.id), Array.from({ length: 24 }, (_, n) => `RQ${String(n + 1).padStart(2, '0')}`));
  const state = h.snapshot(), delta = state.attempts.slice(h.initial.attempts.length);
  assert.deepEqual(state.attempts.slice(0, h.initial.attempts.length), h.initial.attempts);
  assert(delta.every(r => r.outcome !== null)); assert.equal(delta.length, report.resources.reservedIntents);
  assert.equal(h.calls.length, report.resources.physicalCalls); assert(delta.length <= 144);
  assert.equal(state.reservedMicroUsd - h.initial.reservedMicroUsd, delta.length * 5000);
  assert.equal(report.ledgerReconciliation.pendingIntents, 0);
  return delta;
}

offline('Q1-Q5 full fresh24 genuine capture, two decoded selector wires and whole-card flat sent answers', async (t, api) => {
  const h = await fixture(t, api), original = h.options.fetchImpl;
  h.options.fetchImpl = (url, init) => Promise.resolve(original(url, init));
  const report = await api.runCanonicalReceiptGroupComparison(h.options);
  assert.equal(report.status, 'completed', JSON.stringify(report.failure));
  assert(report.cases.every(c => ['A', 'B'].every(arm => c.selections[arm].status === 'completed' && c.answers[arm].status === 'completed')),
    JSON.stringify(report.cases.map(c => ({ id: c.id, selections: c.selections.A.failure ?? c.selections.B.failure, answers: c.answers.A.failure ?? c.answers.B.failure }))));
  t.diagnostic('Actual fresh24 token/byte-fit witnesses: ' + JSON.stringify(h.preparation.observation.cases.map(c => ({ id: c.id,
    tokens: Object.fromEntries(Object.entries(c.tokenWitnesses).map(([name, witness]) => [name, witness.tokens])), answerUpperBytes: c.answerFit.upperUtf8Bytes }))));
  assert.equal(h.preparation.observation.cardCount, 216); assert.equal(h.preparation.observation.receiptCount, 240);
  assert.equal(accounting(h, report).length, 144); assert.equal(report.resources.generations, 96);
  assert.equal(h.transitions.length, 96);
  for (const [index, row] of report.cases.entries()) {
    assert.deepEqual(row.selectionOrder, index % 2 ? ['B', 'A'] : ['A', 'B']);
    assert.deepEqual(row.answerOrder, [['B', 'A'], ['A', 'B'], ['A', 'B'], ['B', 'A']][index % 4]);
    const selectors = h.calls.filter(call => call.active.id === row.id && call.active.phase === 'selection');
    const a = JSON.parse(JSON.parse(selectors.find(call => call.active.arm === 'A').body).input[0].content[0].text);
    const b = JSON.parse(JSON.parse(selectors.find(call => call.active.arm === 'B').body).input[0].content[0].text);
    for (const selectedArm of ['A', 'B']) {
      const pair = selectors.filter(call => call.active.arm === selectedArm);
      assert.equal(pair.length, 2); assert(pair[0].url.endsWith('/input_tokens')); assert(pair[1].url.endsWith('/responses'));
      assert.deepEqual(JSON.parse(JSON.parse(pair[0].body).input[0].content[0].text), JSON.parse(JSON.parse(pair[1].body).input[0].content[0].text));
      assert.equal(pair[0].body, h.preparation.observation.cases[index].wires[selectedArm].count);
      assert.equal(pair[1].body, h.preparation.observation.cases[index].wires[selectedArm].generation);
    }
    assert.deepEqual(a, { query: b.query, limit: b.limit, candidates: b.cards });
    assert.deepEqual(a, h.preparation.observation.cases[index].rankRequest.input);
    assert.deepEqual(row.selections.A.coreRankRequest, row.selections.B.coreRankRequest);
    assert.deepEqual(row.selections.A.coreRankRequest, h.preparation.observation.cases[index].rankRequest);
    assert.equal(a.candidates.length, [6, 8, 10, 12][index % 4]);
    for (const card of a.candidates) {
      assert.deepEqual(Object.keys(card).sort(), ['interpretationStatus', 'memory', 'namespaceIndex', 'receiptCount', 'receipts', 'sourceSelectionCoverage'].sort());
      assert.equal(card.memory.currentness, 'current'); assert.equal(card.interpretationStatus, 'omitted'); assert.equal(card.sourceSelectionCoverage, 'unassessed');
      const expected = h.oracles[index].details.find(d => d.memory.id === card.memory.id);
      assert.deepEqual(card.receipts, expected.receipts.map(r => ({ id: r.id, role: r.role, excerpt: r.excerpt })));
    }
    assert.equal(row.selections.B.canonicalization.removedContextOccurrences, 2);
    assert.notDeepEqual(row.selections.B.proposal, row.selections.B.canonicalProposal);
    for (const arm of ['A', 'B']) {
      assert.equal(row.selections[arm].status, 'completed'); assert.equal(row.answers[arm].status, 'completed');
      const actual = h.calls.find(call => call.active.id === row.id && call.active.arm === arm && call.active.phase === 'answer').body;
      assert.equal(actual, row.answers[arm].requestBody);
      const sent = JSON.parse(JSON.parse(actual).messages[1].content).evidence.map(unit => JSON.parse(unit.text));
      assert.deepEqual(sent.map(card => card.memoryId), row.selections[arm].refs.map(ref => ref.memoryId));
      for (const card of sent) {
        const expected = h.oracles[index].details.find(d => d.memory.id === card.memoryId);
        assert.deepEqual(card.sources, expected.receipts.map(r => ({ receiptId: r.id, recordedRole: r.role, text: r.excerpt })));
      }
      assert.equal(new Set(sent.flatMap(card => card.sources.map(r => r.receiptId))).size, sent.flatMap(card => card.sources).length);
    }
    assert(h.preparation.observation.cases[index].answerFit.upperUtf8Bytes <= 6000);
  }
  const evaluator = await import('../receipt-group-canonical-comparison-evaluation.mjs');
  const rawArtifacts = report.attempts.flatMap(a => [a.requestArtifact, a.responseArtifact].filter(Boolean)).map(a => ({ path: a.path, body: readFileSync(a.path, 'utf8') }));
  const path = join(h.preparation.observation.outputRoot, 'returned-report.json'), body = readFileSync(path, 'utf8'); rawArtifacts.push({ path, body });
  const evaluation = evaluator.prepareCanonicalReceiptGroupComparisonEvaluation({ sourceRaw: readFileSync(new URL('../receipt-group-canonical-comparison-cases.json', import.meta.url), 'utf8'),
    rubricRaw: readFileSync(new URL('../receipt-group-canonical-comparison-rubric.json', import.meta.url), 'utf8'), preparation: h.preparation.observation, result: report,
    rawArtifacts, judgeSeed: 19282, execution: { sourceFileSha256: h.preparation.observation.sourceFileSha256, preparationSha256: api.comparisonSha(JSON.stringify(h.preparation.observation)),
      acceptedAccounting: report.ledgerReconciliation.accepted, authorIds: ['runtime-author', 'corpus-author'], reportArtifact: { path, bytes: Buffer.byteLength(body), sha256: api.comparisonSha(body) } } });
  assert.equal(evaluation.diagnostics.length, 62, 'All 31 frozen anchors retained for both arms');
  assert.equal(evaluation.packets[0].payload.items.length, 48);
  await assert.rejects(api.runCanonicalReceiptGroupComparison(h.options), e => e.code === 'invalid_comparison_preparation');
});

offline('Q4 empty selection is valid and answers with no evidence', async (t, api) => {
  const h = await fixture(t, api), original = h.options.fetchImpl;
  h.options.fetchImpl = (url, init) => {
    if (url.endsWith('/responses')) return Response.json(envelope(JSON.parse(init.body).text.format.name === 'cairn_rank' ? { refs: [] } : { groups: [] }));
    return original(url, init);
  };
  const report = await api.runCanonicalReceiptGroupComparison(h.options);
  assert.equal(report.status, 'completed', JSON.stringify(report.failure));
  // The fake delegate records count/answer; all intents still reconcile.
  assert.equal(report.resources.reservedIntents, 144);
  for (const c of report.cases) for (const arm of ['A', 'B']) {
    assert.deepEqual(c.selections[arm].refs, []); assert.equal(c.answers[arm].status, 'completed');
    assert.deepEqual(JSON.parse(JSON.parse(c.answers[arm].requestBody).messages[1].content).evidence, []);
  }
});

offline('Q6 malformed six-card group remains failed, dependent answer absent, next case continues', async (t, api) => {
  const h = await fixture(t, api), original = h.options.fetchImpl;
  h.options.fetchImpl = (url, init) => {
    const body = JSON.parse(init.body);
    if (url.endsWith('/responses') && body.text.format.name === 'cairn_receipt_group_canonical_plan_rank_v1') {
      const cards = JSON.parse(body.input[0].content[0].text).cards;
      h.calls.push({ url, body: init.body });
      return Response.json(envelope({ groups: [{ contextReceiptIds: cards.slice(0, 5).map(c => c.receipts[0].id), terminalReceiptId: cards[5].receipts[0].id }] }));
    }
    return original(url, init);
  };
  const report = await api.runCanonicalReceiptGroupComparison(h.options);
  assert.equal(report.status, 'completed'); accounting(h, report);
  assert.equal(report.resources.reservedIntents, 120); assert.equal(report.resources.generations, 72);
  assert(report.cases.every(c => c.selections.B.status === 'failed' && c.selections.B.failure.code === 'invalid_model_output'
    && c.answers.B.status === 'unanswered' && c.answers.A.status === 'completed'));
  assert.equal(report.cases[23].selections.A.status, 'completed');
});

offline('Q6 cloned capability and insufficient unchanged generic opening floor dispatch nothing', async (t, api) => {
  const h = await fixture(t, api, { requestCap: 2110 });
  await assert.rejects(api.runCanonicalReceiptGroupComparison({ ...h.options, preparation: structuredClone(h.preparation) }), e => e.code === 'invalid_comparison_preparation');
  const report = await api.runCanonicalReceiptGroupComparison(h.options);
  assert.equal(report.status, 'failed'); assert.equal(report.failure.code, 'budget_blocked'); assert.equal(h.calls.length, 0);
  assert(report.cases.every(c => c.answers.A.status === 'not-run' && c.answers.B.status === 'not-run'));
});

offline('Q6 public coordinator context cannot reset private one-use authority', async (t, api) => {
  const h = await fixture(t, api), context = api.consumeCanonicalComparisonPreparation(h.options);
  assert(Object.isFrozen(context)); assert.equal(Object.hasOwn(context, 'consumed'), false);
  assert.throws(() => { context.consumed = false; }, TypeError);
  assert.throws(() => api.verifyCanonicalComparisonPreparation({ ...context }), e => e.code === 'invalid_comparison_preparation');
  assert.throws(() => api.comparisonArtifact(structuredClone(h.preparation.observation), 'not-authorized.txt', 'inert'), e => e.code === 'invalid_comparison_preparation');
  await assert.rejects(api.runCanonicalReceiptGroupComparison(h.options), e => e.code === 'invalid_comparison_preparation');
  assert.throws(() => api.consumeCanonicalComparisonPreparation({ preparation: structuredClone(h.preparation) }), e => e.code === 'invalid_comparison_preparation');
  assert.equal(h.calls.length, 0);
});

offline('Q6 artifact drift before dispatch stops full denominator', async (t, api) => {
  const h = await fixture(t, api);
  writeFileSync(h.preparation.observation.sourceArtifact.path, 'altered source', { mode: 0o600 });
  const report = await api.runCanonicalReceiptGroupComparison(h.options);
  assert.equal(report.status, 'failed'); assert.equal(report.failure.code, 'comparison_artifact_drift'); assert.equal(h.calls.length, 0);
});

offline('Q6 hostile option accessor and proxy execute zero hooks', async (t, api) => {
  const h = await fixture(t, api); let hooks = 0;
  const hostile = { ...h.options }; Object.defineProperty(hostile, 'manifest', { enumerable: true, get() { hooks++; return h.options.manifest; } });
  const report = await api.runCanonicalReceiptGroupComparison(hostile);
  assert.equal(report.status, 'failed'); assert.equal(hooks, 0); assert.equal(h.calls.length, 0);
  await assert.rejects(api.runCanonicalReceiptGroupComparison(new Proxy(h.options, { get() { hooks++; } })), e => e.code === 'invalid_comparison_preparation');
  assert.equal(hooks, 0);
});

offline('Q6 after-failure genuine store mutation stops despite settled ordinary model error', async (t, api) => {
  const h = await fixture(t, api), original = h.options.fetchImpl; let mutated = false;
  h.options.fetchImpl = (url, init) => {
    const body = JSON.parse(init.body);
    if (url.endsWith('/responses') && body.text.format.name === 'cairn_receipt_group_canonical_plan_rank_v1') {
      h.calls.push({ url, body: init.body }); const cards = JSON.parse(body.input[0].content[0].text).cards;
      return Response.json(envelope({ groups: [{ contextReceiptIds: cards.slice(0, 5).map(c => c.receipts[0].id), terminalReceiptId: cards[5].receipts[0].id }] }));
    }
    return original(url, init);
  };
  h.options.onCheckpoint = row => { if (row.id === 'RQ01' && row.arm === 'B') {
    assert.equal(h.calls.length, 4); const prepared = h.preparation.observation.cases[0], core = api.openMemoryCore({ path: prepared.path });
    try { const memory = h.oracles[0].details[0].memory; ok(core.forget({ namespace: prepared.namespace, memoryId: memory.id, expectedRevision: memory.revision })); mutated = true; } finally { core.close(); }
  } };
  const report = await api.runCanonicalReceiptGroupComparison(h.options); accounting(h, report);
  assert(mutated); assert.equal(report.status, 'failed'); assert.equal(report.failure.code, 'comparison_store_drift');
  assert.equal(report.cases[0].selections.B.failure.code, 'invalid_model_output'); assert.equal(report.cases[0].selections.B.transportHealth.fatalCode, null);
  assert.equal(report.cases[1].selections.A.status, 'not-run'); assert.equal(h.calls.length, 4);
});

offline('Q6 fetch thenable hooks never execute and unknown dispatch keeps full reservation', async (t, api) => {
  const h = await fixture(t, api); let hooks = 0;
  h.options.fetchImpl = (url, init) => { h.calls.push({ url, body: init.body }); return { get then() { hooks++; throw Error('Hostile then hook'); } }; };
  const report = await api.runCanonicalReceiptGroupComparison(h.options); const delta = accounting(h, report);
  assert.equal(hooks, 0); assert.equal(report.failure.code, 'comparison_invalid_port'); assert.equal(h.calls.length, 1);
  assert.equal(delta[0].outcome, 'unknown'); assert.equal(delta[0].actualMicroUsd, null); assert.equal(delta[0].reservedMicroUsd, 5000);
});

offline('Q6 native Promise caller-controlled constructor/species is rejected with zero hooks', async (t, api) => {
  const h = await fixture(t, api); let hooks = 0;
  h.options.fetchImpl = (url, init) => {
    h.calls.push({ url, body: init.body }); const value = Promise.resolve(Response.json({ object: 'response.input_tokens', input_tokens: 500 }));
    const constructor = {}; Object.defineProperty(constructor, Symbol.species, { get() { hooks++; throw Error('No caller species hook'); } });
    Object.defineProperty(value, 'constructor', { value: constructor }); return value;
  };
  const report = await api.runCanonicalReceiptGroupComparison(h.options); accounting(h, report);
  assert.equal(hooks, 0); assert.equal(report.failure.code, 'comparison_invalid_port'); assert.equal(h.calls.length, 1);
});

offline('Q6 in-flight genuine cancellation settles unknown before return and stops future dispatch', async (t, api) => {
  const h = await fixture(t, api); let settled = false;
  h.options.fetchImpl = (url, init) => { h.calls.push({ url, body: init.body }); const pending = new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => { settled = true; reject(Error('Owned native abort settlement')); }, { once: true }); h.controller.abort();
  });
    const descriptors = Object.getOwnPropertyDescriptors(pending);
    t.diagnostic('Native Promise own descriptor key kinds: ' + JSON.stringify(Reflect.ownKeys(descriptors).map(key => ({ kind: typeof key, data: Object.hasOwn(descriptors[key], 'value') }))));
    return pending;
  };
  const report = await api.runCanonicalReceiptGroupComparison(h.options); const delta = accounting(h, report);
  assert(settled); assert.equal(report.status, 'failed'); assert.equal(report.failure.code, 'cancelled'); assert.equal(h.calls.length, 1);
  assert.equal(delta[0].outcome, 'unknown'); assert.equal(report.cases[1].selections.B.status, 'not-run');
});

offline('Q6 actual internal canonical signal mutation plus ordinary failure is fatal with zero hooks', async (t, api) => {
  const h = await fixture(t, api), original = h.options.fetchImpl;
  const instruction = (await import('../../architecture/receipt-group-canonical-plan.mjs')).CANONICAL_RECEIPT_GROUP_RANK_INSTRUCTION;
  const signalDescriptor = Object.getOwnPropertyDescriptor(AbortController.prototype, 'signal'), descriptors = Object.getOwnPropertyDescriptor(Object, 'getOwnPropertyDescriptors');
  let portSignal, portRequest, hooks = 0;
  try {
    Object.defineProperty(AbortController.prototype, 'signal', { ...signalDescriptor, get() {
      const signal = signalDescriptor.get.call(this); if (new Error().stack.split('\n')[2]?.includes('/core/model-call.mjs')) portSignal = signal; return signal;
    } });
    Object.defineProperty(Object, 'getOwnPropertyDescriptors', { ...descriptors, value(value) {
      const d = descriptors.value(value); if (d.system?.value === instruction && d.signal?.value === portSignal && d.input?.value?.cards) portRequest = value; return d;
    } });
    h.options.fetchImpl = (url, init) => {
      const response = original(url, init), body = JSON.parse(init.body);
      if (!url.endsWith('/responses') || body.text.format.name !== 'cairn_receipt_group_canonical_plan_rank_v1') return response;
      assert.equal(h.calls.length, 4); assert(portSignal && portRequest); assert.equal(portRequest.signal, portSignal);
      assert(Object.isFrozen(portRequest)); assert(Object.isFrozen(portRequest.input)); assert.notEqual(portSignal, init.signal); assert.notEqual(portSignal, h.controller.signal);
      Object.defineProperty(portSignal, 'removeEventListener', { get() { hooks++; throw Error('No cleanup getter'); } });
      return Response.json({ ...envelope({}), status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] });
    };
    const report = await api.runCanonicalReceiptGroupComparison(h.options); accounting(h, report);
    assert.equal(hooks, 0); assert.equal(h.calls.length, 4); assert.equal(report.failure.code, 'request_mutated');
    assert.equal(report.cases[0].selections.B.failure.code, 'invalid_model_output'); assert.equal(report.cases[0].selections.B.transportHealth.fatalCode, 'request_mutated');
    assert.equal(report.cases[0].selections.B.transportHealth.state, 'consumed'); assert.equal(report.cases[1].selections.A.status, 'not-run');
    assert.equal(report.cases[0].answers.B.status, 'unanswered', 'Failed selection explicitly determines its own dependent answer even on fatal stop');
    assert.equal(report.cases[0].answers.B.accepted, false); assert.equal(report.cases[1].answers.B.status, 'not-run');
  } finally { Object.defineProperty(Object, 'getOwnPropertyDescriptors', descriptors); Object.defineProperty(AbortController.prototype, 'signal', signalDescriptor); }
});

offline('Q5 independent escaping/CJK/astral subset-order enumeration proves the sufficient byte certificate', async (t, api) => {
  const { packMixedAnswer } = await import('../../longmemeval/mixed-answer.mjs');
  const cards = ['a"\\\n', '中文😀', '𝄞\t', 'tail'].map((text, i) => ({ memory: { id: `new-fit-card-${i}`, revision: 1 }, receipts: [{ id: `new-fit-receipt-${i}`, role: i % 2 ? 'assistant' : 'user', excerpt: text }] }));
  const question = { text: 'Fresh sufficient-fit control?', date: '2026-10-13 20:00' }, certificate = api.certifyComparisonAnswerFit(question, cards, packMixedAnswer, api.counter);
  let checked = 0;
  const visit = selected => {
    const request = packMixedAnswer({ question, units: selected.map(api.comparisonUnit), countTokens: api.counter }).request, bytes = Buffer.byteLength(JSON.stringify(request));
    assert(bytes <= certificate.upperUtf8Bytes); assert(api.counter(JSON.stringify(request)) <= bytes); checked++;
    for (const card of cards) if (!selected.includes(card)) visit([...selected, card]);
  };
  visit([]); assert.equal(checked, 65);
  assert.throws(() => api.certifyComparisonAnswerFit(question, cards.map(c => ({ ...c, receipts: [{ ...c.receipts[0], excerpt: 'large'.repeat(2000) }] })), packMixedAnswer, api.counter), e => e.code === 'comparison_answer_fit_unproven');
});

offline('Q8 literal negative ref/source/role/revision controls and native expiry preserve old boundaries', async (t, api) => {
  const h = await fixture(t, api), c = h.preparation.observation.cases[0];
  const { compileOrdinaryCardSelection } = await import('../../architecture/card-plan-projection.mjs');
  const { prepareCanonicalReceiptGroupPlan, compileCanonicalReceiptGroupPlan } = await import('../../architecture/receipt-group-canonical-plan.mjs');
  const request = { ...c.rankRequest, signal: new AbortController().signal }, card = request.input.candidates[0];
  for (const ref of [{ namespaceIndex: 1, memoryId: card.memory.id, revision: card.memory.revision }, { namespaceIndex: 0, memoryId: 'new-foreign-card', revision: 1 },
    { namespaceIndex: 0, memoryId: card.memory.id, revision: card.memory.revision + 1 }]) assert.throws(() => compileOrdinaryCardSelection(request, { refs: [ref] }, api.counter), e => e.code === 'invalid_model_output');
  for (const mutate of [v => { v.input.candidates[0].receipts[0].role = 'system'; }, v => { v.input.candidates[0].receiptCount++; }, v => { v.input.candidates[0].memory.currentness = 'superseded'; }]) {
    const value = structuredClone(c.rankRequest); mutate(value); assert.throws(() => prepareCanonicalReceiptGroupPlan({ ...value, signal: new AbortController().signal }, api.counter));
  }
  const prepared = prepareCanonicalReceiptGroupPlan(request, api.counter);
  assert.throws(() => compileCanonicalReceiptGroupPlan(prepared, { groups: [{ contextReceiptIds: ['new-missing-context'], terminalReceiptId: card.receipts[0].id }] }), e => e.code === 'invalid_model_output');
  const core = api.openMemoryCore({ path: c.path, model: { countTokens: api.counter } });
  try { const foreign = { ...c.namespace, projectId: 'new-foreign-project' };
    assert.equal(ok(core.map({ namespace: foreign, purpose: 'recall', tokenBudget: 4000 })).items.length, 0);
    assert.equal(core.get({ namespace: foreign, memoryId: card.memory.id, receiptLimit: 100 }).ok, false);
  } finally { core.close(); }
  const { createCanonicalReceiptGroupPlanRankTransport } = await import('../../architecture/source-bundle-plan-rank-transport.mjs');
  const transport = await createCanonicalReceiptGroupPlanRankTransport({ configuration: h.options.configuration, checkpoint: h.options.checkpoint, historySha256: h.options.historySha256,
    manifest: { version: 'receipt-group-canonical-plan-rank-v1', slotId: 'fresh-expiry-control', preparedRequestSha256: c.canonicalRequestSha256,
      runDeadline: performance.now() + 1000, caseDeadline: performance.now() - 1 }, apiKey: KEY, fetchImpl: () => assert.fail('Expired slot dispatch'), onRecord: () => {} });
  try { await assert.rejects(transport.planRank({ ...c.canonicalRequest, signal: new AbortController().signal }), e => e.code === 'deadline_exceeded');
    assert.equal(transport.health().state, 'consumed'); assert.equal(h.snapshot().requestCount, 0);
  } finally { transport.close(); }
});

offline('Q8 genuine ordinary assembly rejects altered authoritative role/source/revision or missing receipts', async (t, api) => {
  const h = await fixture(t, api), c = h.preparation.observation.cases[0];
  const { compileOrdinaryCardSelection } = await import('../../architecture/card-plan-projection.mjs');
  const { assembleCardPlanEvidence } = await import('../../architecture/card-plan-evidence.mjs');
  for (const mode of ['role', 'source', 'revision', 'missing']) {
    let request, result;
    const core = api.openMemoryCore({ path: c.path, sourceCandidatePolicy: 'bounded-keyset-v1', model: { contextWindow: 8192, countTokens: api.counter,
      select() { assert.fail('No select'); }, rank(r) { request = r; result = { refs: r.input.candidates.slice(0, 2).map(card => ({ namespaceIndex: 0, memoryId: card.memory.id, revision: card.memory.revision })) }; return result; } } });
    try {
      const recall = await core.recall({ readSet: [c.namespace], query: c.query, limit: 6, contextMode: 'source-evidence', selectionMode: 'bounded-source-scan' }); ok(recall);
      const projected = compileOrdinaryCardSelection(request, result, api.counter);
      const altered = { get(input) { const detail = structuredClone(core.get(input));
        assert.equal(detail.ok, true);
        if (mode === 'role') detail.value.receipts[0].role = detail.value.receipts[0].role === 'user' ? 'assistant' : 'user';
        if (mode === 'source') detail.value.receipts[0].excerpt = 'Fresh but not the authoritative submitted source';
        if (mode === 'revision') detail.value.memory.revision++;
        if (mode === 'missing') detail.value.receipts.pop();
        return detail;
      } };
      assert.throws(() => assembleCardPlanEvidence({ compiled: projected.compiled, recall, core: altered, plan: c.sourcePlan, namespace: c.namespace, question: c.question }), e => e.code === 'invalid_recall_provenance');
    } finally { core.close(); }
  }
});

test('Q8 owned child setup/assertion failures and success have actual exits and empty owned parent', async t => {
  const parent = createTestWorkspace(null, { prefix: 'cairn-qa24-child-parent-' });
  t.after(async () => { await parent.cleanup(); assert.equal(existsSync(parent.path), false); });
  for (const mode of ['success', 'setup', 'assertion']) {
    const child = spawnSync(process.execPath, ['tools/testing/run.mjs', '--test-name-pattern=Q8 dedicated owned comparison child',
      'evaluation/algorithm-development/test/receipt-group-canonical-comparison-runtime.test.mjs'], { timeout: 30000, encoding: 'utf8',
      env: { PATH: process.env.PATH, TMPDIR: parent.path, TMP: parent.path, TEMP: parent.path, NODE_DISABLE_COMPILE_CACHE: '1', CAIRN_QA24_CHILD: mode } });
    assert.equal(child.status, mode === 'success' ? 0 : 1, child.stdout + child.stderr); assert.equal(child.signal, null);
    assert.deepEqual(readdirSync(parent.path), []); t.diagnostic(`Owned child ${mode}: actual exit ${child.status}, parent empty`);
  }
});

offline('Q6 real logical timeout waits for owned native port settlement and retains unknown reservation', async (t, api) => {
  const h = await fixture(t, api); let settled = false;
  h.options.fetchImpl = (url, init) => {
    h.calls.push({ url, body: init.body });
    return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => { settled = true; reject(Error('Native logical timeout settled')); }, { once: true }));
  };
  const began = performance.now(), report = await api.runCanonicalReceiptGroupComparison(h.options), elapsed = performance.now() - began;
  assert(settled); assert(elapsed >= 29000 && elapsed < 75000, `Actual logical timeout elapsed ${elapsed}`);
  const delta = accounting(h, report); assert.equal(delta.length, 1); assert.equal(delta[0].outcome, 'unknown');
  assert.equal(report.failure.code, 'usage_unknown'); assert.equal(report.cases[0].selections.A.failure.code, 'model_timeout');
  assert.equal(report.cases[0].selections.A.terminalChecks.pendingPortSettled, true);
  assert.equal(report.cases[0].selections.A.terminalChecks.ledgerReconciled, true);
  assert.equal(report.cases[1].selections.A.status, 'not-run');
});

offline('Q3 durable full roster precedes deliberate setup failure and all native resources close', async (t, api) => {
  const w = createTestWorkspace(null, { prefix: 'cairn-qa24-setup-failure-' });
  t.after(async () => { await w.cleanup(); assert.equal(existsSync(w.path), false); });
  const root = join(w.path, 'prepared'), pending = api.prepareCanonicalReceiptGroupComparison({ outputRoot: root });
  const roster = JSON.parse(readFileSync(join(root, 'planned-roster.json'), 'utf8'));
  assert.equal(roster.cases.length, 24); assert.equal(Object.keys(roster.sourceLiteralHashes).length, 240);
  writeFileSync(join(root, 'RQ01.sqlite'), 'Owned preexisting setup blocker, no insertion SQL', { flag: 'wx', mode: 0o600 });
  await assert.rejects(pending);
  const failure = JSON.parse(readFileSync(join(root, 'preparation-failed.json'), 'utf8'));
  assert.equal(failure.cases.length, 24); assert.equal(failure.cases[0].status, 'failed'); assert(failure.cases.slice(1).every(c => c.status === 'not-prepared'));
});
if (process.env.CAIRN_QA24_CHILD) test('Q8 dedicated owned comparison child', async t => {
  const w = createTestWorkspace(null, { prefix: 'cairn-qa24-deliberate-child-' });
  t.after(async () => { await w.cleanup(); assert.equal(existsSync(w.path), false); });
  if (process.env.CAIRN_QA24_CHILD === 'setup') throw Error('Deliberate comparison setup failure');
  writeFileSync(join(w.path, 'inert-owned-control.txt'), 'Not runtime preparation', { mode: 0o600 });
  if (process.env.CAIRN_QA24_CHILD === 'assertion') assert.fail('Deliberate comparison assertion failure');
});

offline('Q6 genuine cancellation consumes authority without dispatch or pending ledger', async (t, api) => {
  const h = await fixture(t, api); h.controller.abort();
  const report = await api.runCanonicalReceiptGroupComparison(h.options);
  assert.equal(report.status, 'failed'); assert.equal(report.failure.code, 'cancelled'); assert.equal(h.calls.length, 0);
  await assert.rejects(api.runCanonicalReceiptGroupComparison(h.options), e => e.code === 'invalid_comparison_preparation');
});

offline('Q6 persistence failure is fatal with settled full reservation and future slots not-run', async (t, api) => {
  const h = await fixture(t, api); h.options.onRecord = () => { throw Error('synthetic persistence failure'); };
  const report = await api.runCanonicalReceiptGroupComparison(h.options);
  assert.equal(report.status, 'failed'); assert.equal(report.failure.code, 'record_persistence_failed');
  assert.equal(h.calls.length, 0); assert(report.resources.reservedIntents <= 1);
  assert(h.snapshot().attempts.every(row => row.outcome !== null)); assert.equal(report.cases[23].selections.B.status, 'not-run');
});

// The controlled clock is installed in a fresh child BEFORE product imports.
// Its descriptor remains stable: these controls exercise elapsed time, not
// clock mutation or timer delivery. Each child owns genuine fixed24 capture.
if (!process.env.CAIRN_QA24_TERMINAL_CHILD) {
  for (const mode of ['case', 'run', 'integrity', 'phase-write', 'report-write', 'prior-fatal']) test(`Q6 terminal ${mode} expiry vetoes genuine checkpoint success`, t => {
    const w = createTestWorkspace(t, { prefix: 'cairn-qa24-terminal-parent-' });
    const result = spawnSync(process.execPath, ['tools/testing/run.mjs', '--test-name-pattern=^Q6 dedicated terminal expiry child$', import.meta.filename],
      { cwd: process.cwd(), timeout: 1200000, maxBuffer: 16 * 1024 * 1024,
        env: { PATH: process.env.PATH, LANG: 'C.UTF-8', NODE_DISABLE_COMPILE_CACHE: '1', TMPDIR: w.path, TMP: w.path, TEMP: w.path,
          CAIRN_CARD_PLAN_TOKENIZER_REQUIRED: '1', CAIRN_CARD_PLAN_TRANSPORT_REQUIRED: '1', CAIRN_BUNDLE_TOKENIZER_REQUIRED: '1',
          CAIRN_BUNDLE_TRANSPORT_REQUIRED: '1', CAIRN_QA24_TERMINAL_CHILD: mode }, encoding: 'utf8' });
    t.diagnostic(result.stdout + result.stderr); assert.equal(result.error, undefined); assert.equal(result.signal, null);
    assert.deepEqual(readdirSync(w.path), []); assert.equal(result.status, 0);
  });
} else test('Q6 dedicated terminal expiry child', async t => {
  const mode = process.env.CAIRN_QA24_TERMINAL_CHILD;
  assert(['case', 'run', 'integrity', 'phase-write', 'report-write', 'prior-fatal'].includes(mode));
  const clock = performance;
  let clockOwner = clock;
  while (clockOwner && !Object.getOwnPropertyDescriptor(clockOwner, 'now')) clockOwner = Object.getPrototypeOf(clockOwner);
  assert(clockOwner);
  const descriptor = Object.getOwnPropertyDescriptor(clockOwner, 'now'), nativeNow = descriptor.value;
  const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  const fsDescriptors = Object.fromEntries(['readFileSync', 'openSync', 'fsyncSync'].map(key => [key, Object.getOwnPropertyDescriptor(fs, key)]));
  let offset = 0, changes = 0, network = 0, target, report, h, literal, returnedLiteral, armed = false, targetFd, boundaryHits = 0;
  const final = ['case', 'run', 'report-write'].includes(mode), sequence = final ? 96 : 1;
  const advance = () => { assert.equal(changes, 0); offset = ['run', 'report-write'].includes(mode) ? 28800001 : 1200001; changes++; };
  const controlled = { ...descriptor, value() { return nativeNow.call(clock) + offset; } };
  try {
    Object.defineProperty(clockOwner, 'now', controlled);
    Object.defineProperty(globalThis, 'fetch', { ...fetchDescriptor, value() { network++; throw Error('No real HTTP'); } });
    const api = await dependencies(); h = await fixture(t, api);
    if (mode === 'integrity') Object.defineProperty(fs, 'readFileSync', { ...fsDescriptors.readFileSync, value(path, ...args) {
      const value = fsDescriptors.readFileSync.value(path, ...args);
      if (armed && !changes && path === join(h.preparation.observation.outputRoot, 'checkpoint-001.json')) { boundaryHits++; advance(); }
      return value;
    } });
    if (['phase-write', 'report-write'].includes(mode)) {
      const targetPath = join(h.preparation.observation.outputRoot, mode === 'phase-write' ? 'RQ01-A-selection.json' : 'returned-report.json');
      Object.defineProperty(fs, 'openSync', { ...fsDescriptors.openSync, value(path, ...args) {
        const fd = fsDescriptors.openSync.value(path, ...args); if (armed && path === targetPath) targetFd = fd; return fd;
      } });
      Object.defineProperty(fs, 'fsyncSync', { ...fsDescriptors.fsyncSync, value(fd) {
        const value = fsDescriptors.fsyncSync.value(fd);
        if (armed && !changes && fd === targetFd) { boundaryHits++; advance(); } return value;
      } });
    }
    syncBuiltinESMExports();
    const fetch = h.options.fetchImpl;
    h.options.fetchImpl = (url, init) => { assert.equal(changes, 0, 'No dispatch after final expiry'); return fetch(url, init); };
    h.options.onCheckpoint = row => {
      h.transitions.push(row);
      if (row.sequence !== sequence) return;
      assert.equal(row.id, final ? 'RQ24' : 'RQ01'); assert.equal(row.arm, 'A'); assert.equal(row.phase, final ? 'answer' : 'selection');
      assert.equal(h.calls.length, final ? 144 : 2); assert.equal(h.records.filter(r => r.stage === 'post').length, final ? 144 : 2);
      assert(h.snapshot().attempts.every(a => a.outcome === 'succeeded'));
      assert.deepEqual(Object.getOwnPropertyDescriptor(clockOwner, 'now'), controlled);
      target = { sequence: row.sequence, id: row.id, arm: row.arm, phase: row.phase };
      armed = true;
      if (['case', 'run', 'prior-fatal'].includes(mode)) advance();
      if (mode === 'prior-fatal') throw Error('Synthetic first persistence fatal precedes elapsed-time audit');
    };
    report = await api.runCanonicalReceiptGroupComparison(h.options);
    literal = JSON.parse(readFileSync((final ? report.cases[23].answers.A : report.cases[0].selections.A).artifact.path, 'utf8'));
    returnedLiteral = JSON.parse(readFileSync(join(h.preparation.observation.outputRoot, 'returned-report.json'), 'utf8'));
    assert.deepEqual(Object.getOwnPropertyDescriptor(clockOwner, 'now'), controlled);
  } finally {
    for (const [key, original] of Object.entries(fsDescriptors)) Object.defineProperty(fs, key, original);
    syncBuiltinESMExports();
    Object.defineProperty(clockOwner, 'now', descriptor); Object.defineProperty(globalThis, 'fetch', fetchDescriptor);
    assert.deepEqual(Object.getOwnPropertyDescriptor(clockOwner, 'now'), descriptor);
    assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, 'fetch'), fetchDescriptor);
    for (const [key, original] of Object.entries(fsDescriptors)) assert.deepEqual(Object.getOwnPropertyDescriptor(fs, key), original);
  }
  t.diagnostic('Actual terminal expiry ' + JSON.stringify({ mode, target, changes, calls: h.calls.length,
    checkpoints: h.transitions.length, resources: report.resources, status: report.status, failure: report.failure,
    accepted: report.ledgerReconciliation.accepted, literalChecks: literal.terminalChecks,
    returnedChecks: (final ? report.cases[23].answers.A : report.cases[0].selections.A).terminalChecks,
    returnedLiteralStatus: returnedLiteral.status, boundaryHits, clockRestored: performance.now === nativeNow, network }));
  assert(target); assert.equal(changes, 1); assert.equal(network, 0); assert.equal(h.transitions.length, sequence);
  assert.equal(boundaryHits, ['integrity', 'phase-write', 'report-write'].includes(mode) ? 1 : 0);
  assert.equal(accounting(h, report).length, final ? 144 : 2); assert.equal(report.resources.generations, final ? 96 : 1);
  assert.equal(report.resources.unknownIntents, 0); assert.equal(report.resources.reservedMicroUsd, final ? 720000 : 10000);
  assert.equal(literal.terminalChecks.pendingPortSettled, true);
  assert.equal(literal.terminalChecks.absoluteDeadlineActive, !['case', 'run', 'integrity', 'prior-fatal'].includes(mode));
  assert.equal(report.status, 'failed'); assert.equal(report.failure.code, mode === 'prior-fatal' ? 'record_persistence_failed' : 'comparison_absolute_deadline');
  assert.equal(report.ledgerReconciliation.accepted, false);
  assert.equal((final ? report.cases[23].answers.A : report.cases[0].selections.A).terminalChecks.absoluteDeadlineActive, mode === 'report-write');
  if (mode === 'report-write') {
    assert.equal(returnedLiteral.status, 'completed'); assert.equal(returnedLiteral.ledgerReconciliation.accepted, true);
    assert.notDeepEqual(returnedLiteral, report, 'Retain the original literal; never repair a failed post-write gate');
  } else assert.deepEqual(returnedLiteral, report);
  if (final) assert(report.cases.slice(0, 23).every(c => ['A', 'B'].every(a => c.selections[a].terminalChecks.absoluteDeadlineActive && c.answers[a].terminalChecks.absoluteDeadlineActive)),
    'Later expiry cannot retroactively expire already-ended phases');
});
