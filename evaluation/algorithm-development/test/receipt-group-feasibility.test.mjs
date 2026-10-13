import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { RECEIPT_GROUP_RANK_INSTRUCTION } from '../../architecture/receipt-group-plan.mjs';

const FIXTURE = new URL('../receipt-group-feasibility-cases.json', import.meta.url);
const FIXTURE_SHA = '176fba365369bc36e85b371aa209ae1ed32e864b3e14b0bb7fbecbf3b70d5a8d';
const MODEL = 'gpt-4.1-mini-2025-04-14', KEY = 'synthetic_fresh_six_receipt_feasibility_key';
const VERSION = 'receipt-group-first-response-feasibility-v1';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const source = () => JSON.parse(readFileSync(FIXTURE, 'utf8'));
const ids = ['rgf-fresh-01', 'rgf-fresh-02', 'rgf-fresh-03', 'rgf-fresh-04', 'rgf-fresh-05', 'rgf-fresh-06'];
const cardCounts = [1, 6, 1, 3, 1, 12], receiptCounts = [1, 6, 3, 3, 6, 12];
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result.error)); return result.value; };
const code = expected => error => error?.code === expected;
const wrap = raw => `[session-date: 2026-10-09 14:00; clock: dataset-local] source{${raw} }`;
const query = raw => JSON.stringify({ question: raw, date: '2026-10-13 18:00' });
const envelope = (text, patch = {}) => ({ id: 'resp_fresh_six', model: MODEL, status: 'completed',
  error: null, incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text }] }], usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 }, ...patch });

// No module scaffold is imported before tests exist. Missing implementation is
// not a behavioral RED; the first authorized native run requires the real seam.
async function dependencies() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  assert(major > 22 || major === 22 && minor >= 16, 'Required genuine SQLite needs pinned Node >=22.16');
  const api = await import('../receipt-group-feasibility.mjs');
  const { countOpenAITokens: counter } = await import('../../../adapters/openai/index.mjs');
  const { openMemoryCore } = await import('../../../core/contract.mjs');
  const budget = await import('../../experiment-budget/index.mjs');
  return { ...api, counter, openMemoryCore, budget };
}
function forbidNetwork(t) {
  const previous = globalThis.fetch; let calls = 0;
  globalThis.fetch = () => { calls++; throw Error('Real network forbidden in fresh-six controls'); };
  t.after(() => { globalThis.fetch = previous; assert.equal(calls, 0); });
}
const offline = (name, body, options = {}) => test(name, options, async t => {
  forbidNetwork(t); await body(t, await dependencies());
});

// Expected endpoints are fixed *test plumbing*, not model answers or scoring.
// Resolve dataset labels solely by matching raw role + independent wrapper in
// public core reads. No compiler or preparation inventory supplies expected IDs.
function proposal(ordinal, receipts) {
  const ref = n => receipts.get(`f${String(ordinal).padStart(2, '0')}.source${String(n).padStart(2, '0')}`).id;
  const group = (context, terminal) => ({ contextReceiptIds: context.map(ref), terminalReceiptId: ref(terminal) });
  const build = [null, () => [group([], 1)], () => [group([1], 2)], () => [group([1, 3], 2)],
    () => [group([1], 2), group([1], 3)], () => [group([1, 2, 3, 4, 5], 6)],
    () => [group([], 2), group([], 7), group([], 11)]][ordinal];
  return { groups: build() };
}
function expectedBodies(input) {
  const endpoint = { type: 'string', enum: input.cards.flatMap(card => card.receipts.map(receipt => receipt.id)) };
  const schema = { type: 'object', additionalProperties: false, required: ['groups'], properties: {
    groups: { type: 'array', maxItems: 6, items: { type: 'object', additionalProperties: false,
      required: ['contextReceiptIds', 'terminalReceiptId'], properties: {
        contextReceiptIds: { type: 'array', minItems: 0, maxItems: 5, items: endpoint }, terminalReceiptId: endpoint } } } } };
  const body = { model: MODEL, instructions: RECEIPT_GROUP_RANK_INSTRUCTION,
    input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(input) }] }],
    text: { format: { type: 'json_schema', name: 'cairn_receipt_group_plan_rank_v1', strict: true, schema } }, truncation: 'disabled' };
  return [JSON.stringify(body), JSON.stringify({ ...body, max_output_tokens: 1024, store: false, stream: false })];
}
function literalOracle(api, prepared, raw) {
  const core = api.openMemoryCore({ path: prepared.path, model: { countTokens: api.counter } });
  try {
    const map = ok(core.map({ namespace: raw.namespace, purpose: 'recall', tokenBudget: 4000 }));
    assert.equal(map.exhausted, true); assert.equal(map.nextCursor, null);
    assert.equal(map.items.length, raw.scriptedExtraction.cards.length);
    const cards = new Map(), receipts = new Map();
    for (const item of map.items) {
      const detail = ok(core.get({ namespace: raw.namespace, memoryId: item.ref.memoryId, receiptLimit: 100 }));
      assert.equal(detail.exhausted, true); assert.equal(detail.nextReceiptCursor, null);
      const declaration = raw.scriptedExtraction.cards.find(card => card.content === detail.memory.content);
      assert(declaration, 'Actual card content belongs to a frozen literal extraction declaration');
      assert.equal(detail.receipts.length, declaration.sourcePartitions.flat().length);
      cards.set(detail.memory.id, detail);
      for (const receipt of detail.receipts) {
        const matches = raw.history.sessions.flatMap(session => session.turns).filter(turn =>
          turn.role === receipt.role && wrap(turn.content) === receipt.excerpt);
        assert.equal(matches.length, 1, 'Literal source correlation must be unique and complete');
        assert(declaration.sourcePartitions.flat().includes(matches[0].sourceLabel));
        assert.match(receipt.id, /^[a-f0-9-]{36}$/u); assert(!receipts.has(matches[0].sourceLabel));
        receipts.set(matches[0].sourceLabel, receipt);
      }
    }
    assert.equal(receipts.size, raw.history.sessions.flatMap(session => session.turns).length);
    return { cards, receipts };
  } finally { core.close(); }
}
async function fixture(t, api, { prefixReserved = 30, requestCap = 20 } = {}) {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-receipt-feasibility-' });
  t.after(() => { t.diagnostic(`Owned feasibility workspace ${workspace.path}`); });
  const preparation = await api.prepareReceiptGroupFeasibility({ outputRoot: join(workspace.path, 'prepared') });
  const raw = source().cases;
  const oracles = preparation.observation.cases.map((prepared, index) => literalOracle(api, prepared, raw[index]));
  const configuration = { directory: join(workspace.path, 'ledger'), runId: randomUUID(), limitMicroUsd: 400000000, requestCap };
  const ledger = api.budget.createExperimentBudget(configuration);
  try { const attemptId = randomUUID(); ledger.reserve({ attemptId, channel: 'host-completion', reservedMicroUsd: prefixReserved });
    ledger.recordOutcome({ attemptId, outcome: 'unknown' }); } finally { ledger.close(); }
  const old = api.budget.inspectExperimentBudgetForEmbeddingUpgrade(configuration);
  const checkpoint = { requestCount: old.requestCount, reservedMicroUsd: old.reservedMicroUsd };
  api.budget.upgradeExperimentBudgetForEmbeddings({ ...configuration, expectedCheckpoint: checkpoint, expectedHistorySha256: old.historySha256 });
  const initial = api.budget.inspectEmbeddingExperimentBudgetSnapshot(configuration);
  const calls = [], records = [], checkpoints = [], controller = new AbortController();
  let active;
  const options = { preparation, manifest: api.createReceiptGroupFeasibilityManifest(preparation.observation),
    configuration, checkpoint, historySha256: initial.historySha256, apiKey: KEY, signal: controller.signal,
    onRecord(record) { active = record; records.push(record); }, onCheckpoint(row) { checkpoints.push(row); },
    fetchImpl(url, init) {
      const ordinal = ids.findIndex(id => active.slotId === `${id}-receipt-group`) + 1;
      assert(ordinal > 0, 'Transport slot maps to the exact frozen roster');
      calls.push({ url, body: init.body, signal: init.signal, ordinal });
      if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 500 });
      return Response.json(envelope(' \n' + JSON.stringify(proposal(ordinal, oracles[ordinal - 1].receipts)) + '\n '));
    } };
  return { workspace, preparation, oracles, configuration, initial, calls, records, checkpoints, controller, options,
    get active() { return active; }, snapshot: () => api.budget.inspectEmbeddingExperimentBudgetSnapshot(configuration) };
}
function denominator(report) {
  assert.equal(report.version, VERSION); assert.equal(report.denominator, 6);
  assert.deepEqual(report.cases.map(row => row.id), ids);
  assert(report.cases.every(row => ['completed', 'failed', 'not-run'].includes(row.status)));
}
function terminalLedger(h, report) {
  denominator(report); const final = h.snapshot();
  assert.deepEqual(final.attempts.slice(0, h.initial.attempts.length), h.initial.attempts, 'Original ledger prefix unchanged');
  const attempts = final.attempts.slice(h.initial.attempts.length);
  assert(attempts.every(row => row.outcome !== null), 'No pending reservation on return');
  assert.equal(report.resources.reservedIntents, attempts.length);
  assert.equal(report.resources.physicalCalls, h.calls.length);
  assert(report.resources.reservedIntents <= 12); assert(report.resources.physicalCalls <= 12);
  assert(final.reservedMicroUsd - h.initial.reservedMicroUsd <= 60000);
  for (const attempt of attempts) {
    const matching = h.records.filter(row => row.attemptId === attempt.attemptId);
    assert.equal(matching.filter(row => row.phase === 'post').length, 1, 'Exactly one settled record');
    assert.equal(matching.filter(row => row.phase === 'pre').length, 1);
  }
  assert(!JSON.stringify(report).includes(KEY)); return final;
}
function boundFile(binding) {
  const bytes = readFileSync(binding.path); assert.equal(bytes.length, binding.bytes); assert.equal(sha(bytes), binding.sha256);
  return bytes;
}

test('F1 frozen six-source-only fixtures preserve literal hashes, fixed shapes and no gold answer fields', () => {
  const bytes = readFileSync(FIXTURE), data = source(); assert.equal(sha(bytes), FIXTURE_SHA);
  assert.deepEqual(data.caseOrder, ids); assert.deepEqual(data.cases.map(row => row.id), ids);
  assert.deepEqual(data.cases.map(row => row.scriptedExtraction.cards.length), cardCounts);
  assert.deepEqual(data.cases.map(row => row.history.sessions.flatMap(session => session.turns).length), receiptCounts);
  let count = 0;
  for (const row of data.cases) {
    assert.equal(row.namespace.scope, 'personal'); assert.equal(row.namespace.projectId, null);
    for (const turn of row.history.sessions.flatMap(session => session.turns)) {
      assert(turn.content.length <= 800); assert.equal(sha(turn.content), data.diagnosticsNotForWire.sourceLiteralHashes[turn.sourceLabel]); count++;
    }
    for (const card of row.scriptedExtraction.cards) assert(card.sourcePartitions.every(part => part.length <= 4));
  }
  assert.equal(count, 31);
  const walk = value => { if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
    assert(!/^(answer|goldAnswer|gold_answer|judge|rubric)$/u.test(key)); walk(item);
  } }; walk(data);
});

offline('F1–F5 six normal cold captures send independent literal wires and retain raw/actual/derived provenance', async (t, api) => {
  const h = await fixture(t, api), observed = h.preparation.observation;
  assert(Object.isFrozen(h.preparation)); assert(Object.isFrozen(observed));
  assert.equal(observed.sourceFileSha256, FIXTURE_SHA); assert.equal(observed.cardCount, 24); assert.equal(observed.receiptCount, 31);
  assert.deepEqual(observed.cases.map(row => row.id), ids);
  assert.equal(h.oracles[4].cards.size, 1); assert.equal(h.oracles[4].receipts.size, 6);
  assert.equal(new Set(h.oracles.flatMap(oracle => [...oracle.receipts.values()].map(receipt => receipt.id))).size, 31);
  const manifest = h.options.manifest; assert(Object.isFrozen(manifest));
  assert.equal(manifest.version, VERSION); assert.deepEqual(manifest.caseOrder, ids);
  const report = await api.runReceiptGroupFeasibility(h.options); terminalLedger(h, report);
  assert.equal(report.status, 'completed'); assert.equal(report.failure, null); assert.equal(h.calls.length, 12);
  assert.equal(h.records.length, 24); assert.equal(h.snapshot().reservedMicroUsd, 60030);
  assert.equal(report.structuralGate.compiledNonempty, 6); assert.equal(report.structuralGate.passed, true);
  for (const [index, result] of report.cases.entries()) {
    const oracle = h.oracles[index], raw = source().cases[index], request = observed.cases[index].request;
    assert.equal(result.status, 'completed'); assert.equal(result.compiled, true); assert.equal(result.transportHealth.fatalCode, null);
    assert.equal(result.transportHealth.state, 'consumed');
    assert.equal(request.input.query, query(raw.query.text)); assert.equal(request.input.limit, 6);
    assert.equal(request.input.cards.length, cardCounts[index]);
    const expectedCards = request.input.cards.map(card => {
      const detail = oracle.cards.get(card.memory.id); assert(detail, 'Genuine scan IDs correlate with public authoritative reads');
      assert.equal(card.memory.revision, detail.memory.revision);
      return { namespaceIndex: 0, memory: { id: detail.memory.id, revision: detail.memory.revision, currentness: 'current' },
        receipts: detail.receipts.map(receipt => ({ id: receipt.id, role: receipt.role, excerpt: receipt.excerpt })),
        receiptCount: detail.receipts.length, interpretationStatus: 'omitted', sourceSelectionCoverage: 'unassessed' };
    });
    const bodies = expectedBodies({ query: query(raw.query.text), limit: 6, cards: expectedCards });
    const actual = h.calls.filter(call => call.ordinal === index + 1);
    assert.deepEqual(actual.map(call => call.body), bodies);
    assert.deepEqual(actual.map(call => call.url), ['https://api.openai.com/v1/responses/input_tokens', 'https://api.openai.com/v1/responses']);
    assert(!bodies.join('').includes('sourceLabel')); assert(!bodies.join('').includes('expectedSourceAnchors'));
    for (const turn of raw.history.sessions.flatMap(session => session.turns)) assert(!bodies.join('').includes(turn.sourceLabel));
    assert.deepEqual(result.proposal, proposal(index + 1, oracle.receipts));
    assert.equal(result.actualProposalSha256, sha(JSON.stringify(result.proposal)));
    assert.equal(result.actualRequestSha256, sha(JSON.stringify(request)));
    assert.notEqual(result.derivedAssemblyRequestSha256, result.actualRequestSha256);
    assert.equal(result.derivedAssemblyProposalSha256, sha(JSON.stringify(result.derivedAssemblyProposal)));
    assert.equal(result.refsSha256, sha(JSON.stringify({ refs: result.refs })));
    const post = h.records.find(row => row.slotId === `${raw.id}-receipt-group` && row.phase === 'post' && row.kind === 'generation');
    assert.equal(post.responseSha256, sha(post.responseBody));
    assert.equal(result.rawResponseSha256, post.responseSha256);
    assert.notEqual(sha(JSON.parse(post.responseBody).output[0].content[0].text), result.actualProposalSha256);
    for (const [name, text] of [['actualRequest', JSON.stringify(request)], ['count', bodies[0]], ['generation', bodies[1]]]) {
      const witness = observed.cases[index].tokenWitnesses[name];
      assert.equal(witness.tokens, api.counter(text)); assert.equal(witness.sha256, sha(text)); assert(witness.tokens <= 6000);
    }
    const endpoints = new Set(result.proposal.groups.flatMap(group => [...group.contextReceiptIds, group.terminalReceiptId]));
    assert.deepEqual([...result.selectedReceiptIds].sort(), [...endpoints].sort());
    const chosen = new Set(result.refs.map(ref => ref.memoryId));
    const availability = [...chosen].flatMap(id => oracle.cards.get(id).receipts.map(receipt => receipt.id));
    assert.deepEqual([...result.chosenCardSourceAvailability.receiptIds].sort(), availability.sort());
    assert.equal(result.chosenCardSourceAvailability.deliveredAnswerContext, false);
    boundFile(result.artifact);
    t.diagnostic(`Frozen real-token witness ${raw.id}: ${JSON.stringify(observed.cases[index].tokenWitnesses)}; proposal=${api.counter(JSON.stringify(result.proposal))}; derived=${api.counter(JSON.stringify(result.derivedAssemblyProposal))}; refs=${api.counter(JSON.stringify({ refs: result.refs }))}`);
  }
  assert(observed.cases[5].tokenWitnesses.generation.tokens > Math.max(...observed.cases.slice(0, 5).map(row => row.tokenWitnesses.generation.tokens)));
  const shared = report.cases[3].proposal.groups;
  assert.equal(shared[0].contextReceiptIds[0], shared[1].contextReceiptIds[0]);
  assert.equal(report.cases[4].refs.length, 1); assert.equal(report.cases[4].selectedReceiptIds.length, 6);
  const single = report.cases[2]; assert(single.chosenCardSourceAvailability.receiptIds.length >= single.selectedReceiptIds.length);
  await h.workspace.cleanup(); assert.equal(existsSync(h.workspace.path), false); t.diagnostic('Owned full roundtrip cleanup confirmed');
});

offline('F5 empty groups compile but do not pass the nonempty structural gate', async (t, api) => {
  const h = await fixture(t, api), original = h.options.fetchImpl;
  h.options.fetchImpl = (url, init) => { const response = original(url, init);
    return url.endsWith('/responses') ? Response.json(envelope('{"groups":[]}')) : response; };
  const report = await api.runReceiptGroupFeasibility(h.options); terminalLedger(h, report);
  assert.equal(h.calls.length, 12); assert(report.cases.every(row => row.compiled && row.refs.length === 0));
  assert.equal(report.structuralGate.compiledNonempty, 0); assert.equal(report.structuralGate.passed, false);
  assert(report.cases.every(row => row.structuralExercise.elicited === false));
});

offline('F4 one ordinary first-generation failure is retained and remaining frozen cases continue once', async (t, api) => {
  const h = await fixture(t, api), original = h.options.fetchImpl;
  h.options.fetchImpl = (url, init) => { const response = original(url, init);
    return h.active.slotId === `${ids[1]}-receipt-group` && url.endsWith('/responses')
      ? Response.json(envelope('', { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] })) : response; };
  const report = await api.runReceiptGroupFeasibility(h.options); terminalLedger(h, report);
  assert.equal(h.calls.length, 12); assert.deepEqual(report.cases.map(row => row.status), ['completed', 'failed', 'completed', 'completed', 'completed', 'completed']);
  assert.equal(report.cases[1].transportHealth.fatalCode, null); assert.equal(report.cases[1].transportHealth.state, 'consumed');
  assert.equal(report.structuralGate.compiledNonempty, 5); assert.equal(report.structuralGate.passed, true);
});

offline('F4 fatal health, caller integrity and genuine cancellation retain six dispositions without further dispatch', async (t, api) => {
  for (const mode of ['invalid_usage', 'authentication', 'credential', 'caller-accessor', 'cancelled']) {
    const h = await fixture(t, api), original = h.options.fetchImpl; let hooks = 0;
    h.options.fetchImpl = (url, init) => {
      const response = original(url, init); if (!url.endsWith('/responses')) return response;
      if (mode === 'authentication') return new Response('{}', { status: 401 });
      if (mode === 'credential') return Response.json(envelope(KEY));
      if (mode === 'invalid_usage') return Response.json(envelope('{"groups":[]}', { usage: { input_tokens: -1, output_tokens: 20, total_tokens: 19 } }));
      if (mode === 'caller-accessor') Object.defineProperty(h.controller.signal, 'aborted', { get() { hooks++; throw Error('Caller hook forbidden'); } });
      if (mode === 'cancelled') h.controller.abort();
      return Response.json(envelope('', { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] }));
    };
    const report = await api.runReceiptGroupFeasibility(h.options); terminalLedger(h, report);
    assert.equal(report.status, 'failed'); assert.equal(h.calls.length, 2); assert.equal(hooks, 0);
    assert.deepEqual(report.cases.map(row => row.status), ['failed', 'not-run', 'not-run', 'not-run', 'not-run', 'not-run']);
    if (mode === 'invalid_usage') assert.equal(report.cases[0].transportHealth.fatalCode, 'invalid_usage');
    assert.equal(report.cases[0].transportHealth.state, 'consumed');
    await assert.rejects(api.runReceiptGroupFeasibility(h.options), code('invalid_receipt_group_preparation'));
  }
});

offline('F4 actual internal RG port mutation plus ordinary failure retains public error but fatal health stops the cohort', async (t, api) => {
  for (const mode of ['native-signal']) {
    const h = await fixture(t, api), original = h.options.fetchImpl;
    const signalDescriptor = Object.getOwnPropertyDescriptor(AbortController.prototype, 'signal');
    const descriptors = Object.getOwnPropertyDescriptor(Object, 'getOwnPropertyDescriptors');
    let portSignal, portRequest, hooks = 0, observedCorePort = false;
    try {
      Object.defineProperty(AbortController.prototype, 'signal', { ...signalDescriptor, get() {
        const signal = signalDescriptor.get.call(this);
        if (new Error().stack.split('\n')[2]?.includes('/core/model-call.mjs')) { portSignal = signal; observedCorePort = true; }
        return signal;
      } });
      Object.defineProperty(Object, 'getOwnPropertyDescriptors', { ...descriptors, value(value) {
        const result = descriptors.value(value);
        if (result.system?.value === RECEIPT_GROUP_RANK_INSTRUCTION && result.signal?.value === portSignal
          && result.input?.value?.cards) portRequest = value;
        return result;
      } });
      h.options.fetchImpl = (url, init) => {
        const response = original(url, init); if (!url.endsWith('/responses')) return response;
        t.diagnostic(`Internal port precondition: coreObserved=${observedCorePort}; exactRequestSignal=${portRequest?.signal === portSignal}; distinctCaller=${portSignal !== h.controller.signal}; distinctGuard=${portSignal !== init.signal}; frozenRequest=${Object.isFrozen(portRequest)}; fakeCalls=${h.calls.length}`);
        assert.equal(h.calls.length, 2, 'Count and generation reach fake HTTP before mutation');
        assert.equal(observedCorePort, true); assert(portSignal); assert(portRequest);
        assert.notEqual(portSignal, h.controller.signal); assert.notEqual(portSignal, init.signal);
        assert.equal(portRequest.signal, portSignal, 'Interception is the actual core model-call RG request signal');
        assert(Object.isFrozen(portRequest)); assert(Object.isFrozen(portRequest.input));
        Object.defineProperty(portSignal, 'removeEventListener', {
          get() { hooks++; throw Error('Internal port hook must not run'); } });
        return Response.json(envelope('', { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] }));
      };
      const report = await api.runReceiptGroupFeasibility(h.options); terminalLedger(h, report);
      assert.equal(hooks, 0); assert.equal(h.calls.length, 2); assert.equal(report.status, 'failed');
      assert.equal(report.cases[0].failure.code, 'invalid_model_output', 'Original ordinary public error is not relabelled');
      assert.equal(report.cases[0].transportHealth.fatalCode, 'request_mutated');
      assert.equal(report.cases[0].transportHealth.state, 'consumed');
      assert.deepEqual(report.cases.map(row => row.status), ['failed', 'not-run', 'not-run', 'not-run', 'not-run', 'not-run']);
      await assert.rejects(api.runReceiptGroupFeasibility(h.options), code('invalid_receipt_group_preparation'));
    } finally {
      Object.defineProperty(Object, 'getOwnPropertyDescriptors', descriptors);
      Object.defineProperty(AbortController.prototype, 'signal', signalDescriptor);
    }
    assert.deepEqual(Object.getOwnPropertyDescriptor(AbortController.prototype, 'signal'), signalDescriptor);
    assert.deepEqual(Object.getOwnPropertyDescriptor(Object, 'getOwnPropertyDescriptors'), descriptors);
  }
});

offline('F2 preparation clone, reuse and concurrent invocation are no authority; public data remains immutable', async (t, api) => {
  const h = await fixture(t, api);
  await assert.rejects(api.runReceiptGroupFeasibility({ ...h.options, preparation: structuredClone(h.preparation) }), code('invalid_receipt_group_preparation'));
  assert.equal(h.calls.length, 0);
  assert.throws(() => { h.preparation.observation.cases[0].request.input.query = 'Unfrozen query'; }, TypeError);
  assert.throws(() => { h.options.manifest.caseOrder.push('extra'); }, TypeError);
  const running = api.runReceiptGroupFeasibility(h.options);
  await assert.rejects(api.runReceiptGroupFeasibility(h.options), code('invalid_receipt_group_preparation'));
  const report = await running; terminalLedger(h, report); assert.equal(h.calls.length, 12);
  await assert.rejects(api.runReceiptGroupFeasibility(h.options), code('invalid_receipt_group_preparation'));
});

offline('F2/F4 frozen request/source artifacts and real store drift stop before any reservation', async (t, api) => {
  for (const mode of ['request-artifact', 'source-artifact', 'store']) {
    const h = await fixture(t, api);
    if (mode === 'store') {
      const first = h.preparation.observation.cases[0], memory = [...h.oracles[0].cards.values()][0].memory;
      const core = api.openMemoryCore({ path: first.path });
      try { ok(core.forget({ namespace: source().cases[0].namespace, memoryId: memory.id, expectedRevision: memory.revision })); } finally { core.close(); }
    } else {
      const artifact = mode === 'request-artifact' ? h.preparation.observation.cases[0].artifact : h.preparation.observation.sourceArtifact;
      writeFileSync(artifact.path, readFileSync(artifact.path, 'utf8') + ' ', { mode: 0o600 });
    }
    const report = await api.runReceiptGroupFeasibility(h.options); terminalLedger(h, report);
    assert.equal(report.status, 'failed'); assert.equal(h.calls.length, 0); assert.equal(h.snapshot().requestCount, h.initial.requestCount);
    assert(report.cases.every(row => row.status === 'not-run'));
  }
});

offline('F3 whole-run protected money and intent headroom reject before first reservation', async (t, api) => {
  for (const limits of [{ prefixReserved: 369950001 }, { requestCap: 12 }]) {
    const h = await fixture(t, api, limits), report = await api.runReceiptGroupFeasibility(h.options); terminalLedger(h, report);
    assert.equal(report.status, 'failed'); assert.equal(report.failure.code, 'budget_blocked'); assert.equal(h.calls.length, 0);
    assert.equal(h.snapshot().requestCount, h.initial.requestCount); assert(report.cases.every(row => row.status === 'not-run'));
  }
});

offline('F4 record/checkpoint persistence failure stops and settles once, including no-dispatch pre failure', async (t, api) => {
  for (const mode of ['pre-throw', 'post-promise', 'checkpoint-throw']) {
    const h = await fixture(t, api), original = h.options.onRecord;
    if (mode === 'checkpoint-throw') h.options.onCheckpoint = () => { throw Error('Synthetic checkpoint persistence failure'); };
    else h.options.onRecord = row => { original(row);
      if (mode === 'pre-throw' && row.phase === 'pre') throw Error('Synthetic record persistence failure');
      if (mode === 'post-promise' && row.phase === 'post') return Promise.resolve();
    };
    const report = await api.runReceiptGroupFeasibility(h.options); denominator(report);
    assert.equal(report.status, 'failed'); assert(h.calls.length <= (mode === 'checkpoint-throw' ? 2 : 1));
    const final = h.snapshot(); assert.deepEqual(final.attempts.slice(0, 1), h.initial.attempts);
    assert(final.attempts.every(row => row.outcome !== null));
    assert(report.cases.slice(1).every(row => row.status === 'not-run'));
  }
});

offline('F4 dispatched unknown remains fully reserved, never invented usage or no-request', async (t, api) => {
  const h = await fixture(t, api), original = h.options.fetchImpl;
  h.options.fetchImpl = (url, init) => { const response = original(url, init);
    if (h.active.slotId === `${ids[0]}-receipt-group` && url.endsWith('/responses')) throw Error('Synthetic dispatch rejection'); return response; };
  const report = await api.runReceiptGroupFeasibility(h.options), final = terminalLedger(h, report);
  assert.equal(report.cases[0].status, 'failed'); assert.equal(report.cases[0].transportHealth.fatalCode, null);
  assert(report.cases.slice(1).every(row => row.status === 'completed'));
  const attempt = final.attempts.slice(1).find(row => row.channel === 'cairn-generation');
  assert.equal(attempt.outcome, 'unknown'); assert.equal(attempt.actualMicroUsd, null); assert.equal(attempt.reservedMicroUsd, 5000);
  assert.equal(h.calls.length, 12); assert.equal(report.resources.unknownIntents, 1);
});

offline('F4 local native timeout continuation waits for settled port and retains reconciliation controls', async (t, api) => {
  const h = await fixture(t, api), original = h.options.fetchImpl; let settled = false;
  h.options.fetchImpl = (url, init) => {
    const response = original(url, init);
    if (h.active.slotId !== `${ids[0]}-receipt-group`) { assert(settled, 'No next-case dispatch while prior native port pending'); return response; }
    return new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => { settled = true; reject(Object.assign(Error('Synthetic abort settlement'), { name: 'AbortError' })); }, { once: true });
    });
  };
  const report = await api.runReceiptGroupFeasibility(h.options); terminalLedger(h, report);
  assert.equal(settled, true); assert.equal(report.cases[0].status, 'failed'); assert.equal(h.calls.length, 11);
  assert(report.cases.slice(1).every(row => row.status === 'completed'));
  assert.deepEqual(report.cases[0].continuationChecks, { pendingPortSettled: true, callerActive: true,
    globalDeadlineActive: true, ledgerReconciled: true, consumed: true, nonfatalHealth: true, persistenceIntegrity: true });
}, { timeout: 80000 });

offline('F2 preparation setup failure retains the entire previously persisted roster', async (t, api) => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-receipt-feasibility-setup-' });
  const root = join(workspace.path, 'prepared'), pending = api.prepareReceiptGroupFeasibility({ outputRoot: root });
  const roster = JSON.parse(readFileSync(join(root, 'planned-roster.json'), 'utf8'));
  assert.deepEqual(roster.cases.map(row => row.id), ids); assert.equal(Object.keys(roster.sourceLiteralHashes).length, 31);
  writeFileSync(join(root, `${ids[0]}.sqlite`), 'Owned blocking fixture; not a SQLite insertion.', { flag: 'wx', mode: 0o600 });
  await assert.rejects(pending);
  const failure = JSON.parse(readFileSync(join(root, 'preparation-failed.json'), 'utf8'));
  assert.deepEqual(failure.cases.map(row => row.id), ids); assert.equal(failure.cases[0].status, 'failed');
  assert(failure.cases.slice(1).every(row => row.status === 'not-prepared'));
  assert.equal(sha(readFileSync(join(root, 'planned-roster.json'))), sha(JSON.stringify(roster) + '\n'));
});

offline('F6 owned setup/assertion child failures remove only their new workspaces', async (t, api) => {
  const parent = createTestWorkspace(t, { prefix: 'cairn-receipt-feasibility-parent-' });
  for (const mode of ['setup', 'assertion']) {
    const result = spawnSync(process.execPath, ['tools/testing/run.mjs', '--test-name-pattern=F6 deliberate owned feasibility child failure',
      'evaluation/algorithm-development/test/receipt-group-feasibility.test.mjs'], { encoding: 'utf8', timeout: 120000,
      env: { ...process.env, TMPDIR: parent.path, TMP: parent.path, TEMP: parent.path,
        NODE_DISABLE_COMPILE_CACHE: '1', CAIRN_RECEIPT_FEASIBILITY_FAILURE_CHILD: mode } });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, mode === 'setup' ? /Deliberate feasibility setup failure/ : /Deliberate feasibility assertion failure/);
    assert.deepEqual(readdirSync(parent.path), [], 'Owned runner and fixture scratch both removed');
  }
  await parent.cleanup(); assert.equal(existsSync(parent.path), false);
});
if (process.env.CAIRN_RECEIPT_FEASIBILITY_FAILURE_CHILD) offline('F6 deliberate owned feasibility child failure', async (t, api) => {
  const h = await fixture(t, api);
  if (process.env.CAIRN_RECEIPT_FEASIBILITY_FAILURE_CHILD === 'setup') throw Error('Deliberate feasibility setup failure');
  await api.runReceiptGroupFeasibility(h.options); assert.fail('Deliberate feasibility assertion failure');
});
