import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { readFileSync, chmodSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { createExperimentBudget, inspectExperimentBudgetForEmbeddingUpgrade,
  upgradeExperimentBudgetForEmbeddings, inspectEmbeddingExperimentBudgetSnapshot } from '../../experiment-budget/index.mjs';
import { cardPlanQaRoster } from '../card-plan-profile.mjs';
import { prepareCardPlanComparison } from '../card-plan-store.mjs';
import { createCardPlanComparisonManifest, runCardPlanComparison } from '../card-plan-runner.mjs';
import { createSourceBundleGuard, deliverSourceBundleObservation } from '../source-bundle-runner.mjs';
import { packCardPlanAnswer } from '../../architecture/card-plan-evidence.mjs';
import { countOpenAITokens } from '../../../adapters/openai/index.mjs';

const orders = ['ABC', 'ACB', 'BAC', 'BCA', 'CAB', 'CBA'];
const model = 'gpt-4.1-mini-2025-04-14';
const response = proposed => Response.json({ object: 'response', model, status: 'completed',
  error: null, incomplete_details: null, output: [{ type: 'message', role: 'assistant',
    status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(proposed) }] }],
  usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } });

test('RR1–RR5: actual imports execute 48 selections before each case answers, fixed 72 first answers and 168 ledger intents', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'card-plan-runner-red-' });
  const preparation = await prepareCardPlanComparison({ outputRoot: join(workspace.path, 'prepared') });
  const manifest = createCardPlanComparisonManifest(preparation.observation);
  const configuration = { directory: join(workspace.path, 'ledger'), runId: randomUUID(),
    limitMicroUsd: 400_000_000, requestCap: 100_000 };
  createExperimentBudget(configuration).close();
  const old = inspectExperimentBudgetForEmbeddingUpgrade(configuration);
  upgradeExperimentBudgetForEmbeddings({ ...configuration, expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 },
    expectedHistorySha256: old.historySha256 });
  const initial = inspectEmbeddingExperimentBudgetSnapshot(configuration), calls = [], records = [], checkpoints = [];
  const report = await runCardPlanComparison({ preparation, manifest, configuration,
    checkpoint: { requestCount: 0, reservedMicroUsd: 0 }, historySha256: initial.historySha256,
    apiKey: 'synthetic_card_runtime_secret', onRecord: row => { records.push(row); },
    onCheckpoint: row => { checkpoints.push(row); }, signal: new AbortController().signal,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body); calls.push({ url, text: options.body, body });
      assert.equal(options.redirect, 'error');
      if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
      if (url.endsWith('/chat/completions')) return Response.json({ object: 'chat.completion', model,
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: `Plumbing answer ${calls.length}.` } }],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } });
      const input = JSON.parse(body.input[0].content[0].text);
      if (body.text.format.name === 'cairn_rank') return response({ refs: input.candidates.slice(0, 6).map(card =>
        ({ namespaceIndex: card.namespaceIndex, memoryId: card.memory.id, revision: card.memory.revision })) });
      assert.equal(body.text.format.name, 'cairn_card_budgeted_plan_rank_v1');
      return response({ selectedCards: [0, 1, 2, 3, 4, 5], chains: [0, 1, 2, 3, 4, 5].map(slot =>
        ({ members: [slot], sources: [{ member: 0, receipt: 0 }], terminal: 0 })) });
    } });
  assert.equal(report.version, 'card-plan-first-answer-comparison-v1');
  assert.equal(report.status, 'completed'); assert.equal(report.failure, null);
  assert.deepEqual(report.cases.map(c => c.id), cardPlanQaRoster); assert.equal(calls.length, 168);
  for (const [index, c] of report.cases.entries()) {
    assert.equal(c.selections.length, 2); assert.equal(c.answers.length, 3);
    assert.deepEqual(c.selectionOrder, index % 2 ? ['B', 'A'] : ['A', 'B']);
    assert.deepEqual(c.answerOrder, [...orders[index % 6]]);
    assert(c.selections.every(selection => selection.status === 'completed'));
    assert(c.answers.every(answer => answer.status === 'completed'));
    assert.equal(new Set([...c.selections, ...c.answers].map(slot => slot.slotId)).size, 5);
    const actual = calls.slice(index * 7, (index + 1) * 7);
    assert(actual.slice(0, 4).every(row => !row.url.endsWith('/chat/completions')));
    assert(actual.slice(4).every(row => row.url.endsWith('/chat/completions')));
    for (const answer of c.answers) assert(actual.some(row => row.text === answer.requestBody));
    assert.equal(c.answers.find(answer => answer.arm === 'C').selectionSlotId,
      c.answers.find(answer => answer.arm === 'B').selectionSlotId);
  }
  const final = inspectEmbeddingExperimentBudgetSnapshot(configuration);
  assert.equal(final.requestCount, 168); assert.equal(final.reservedMicroUsd, 840_000);
  assert(final.attempts.every(row => row.outcome !== null));
  assert(records.length >= 336); assert(checkpoints.length >= 1);
  assert.equal(report.resources.physicalCalls, 168); assert.equal(report.resources.reservedIntents, 168);
  assert.equal(report.resources.missingFinalCalls, 0);
  verifyBoundReport(preparation, report, records);
});

test('RR1/RS4: cloned or absent preparation is no authority and rejected before fake HTTP', async () => {
  let calls = 0;
  await assert.rejects(runCardPlanComparison({ preparation: {}, manifest: {}, configuration: {}, checkpoint: {},
    historySha256: '0'.repeat(64), apiKey: 'synthetic_card_runtime_secret',
    fetchImpl: () => { calls++; }, onRecord() {}, onCheckpoint() {}, signal: new AbortController().signal }),
  { code: 'invalid_card_plan_preparation' });
  assert.equal(calls, 0);
});

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function boundFile(binding) {
  assert(binding && typeof binding.path === 'string');
  const bytes = readFileSync(binding.path);
  assert.equal(bytes.length, binding.bytes); assert.equal(hash(bytes), binding.sha256); return bytes;
}
function verifyBoundReport(preparation, report, records) {
  const disk = JSON.parse(readFileSync(join(preparation.observation.outputRoot, 'comparison-report.json'), 'utf8'));
  assert.equal(disk.representation, 'slot-artifacts-v1'); assert.equal(disk.status, report.status);
  assert.equal(disk.cases.length, 24); assert.equal(disk.resources.reservedIntents, report.resources.reservedIntents);
  for (const c of disk.cases) for (const slot of [...c.selections, ...c.answers]) {
    if (!slot.artifact) { assert.equal(slot.status, 'not-run'); continue; }
    const full = JSON.parse(boundFile(slot.artifact)); assert.equal(full.slotId, slot.slotId);
    assert.equal(full.status, slot.status);
  }
  for (const attempt of disk.attempts) {
    if (attempt.requestArtifact) boundFile(attempt.requestArtifact);
    if (attempt.post?.responseArtifact) {
      const bytes = boundFile(attempt.post.responseArtifact);
      assert.equal(hash(bytes), attempt.post.responseArtifact.sha256);
    }
    const pre = records.findIndex(row => row.attemptId === attempt.attemptId && row.phase === 'pre');
    const post = records.findIndex(row => row.attemptId === attempt.attemptId && row.phase === 'post');
    if (pre >= 0 && post >= 0) assert(pre < post);
  }
  if (report.originalHistory) {
    const initial = JSON.parse(boundFile(report.originalHistory));
    assert.equal(initial.runId, report.ledgerReconciliation.runId);
    assert.equal(initial.requestCount, report.resources.initialRequestCount);
    assert.equal(report.ledgerReconciliation.prefixUnchanged, true);
  }
}
async function harness(t, prefix = 'card-plan-runner-control-') {
  const workspace = createTestWorkspace(t, { prefix });
  const preparation = await prepareCardPlanComparison({ outputRoot: join(workspace.path, 'prepared') });
  const configuration = { directory: join(workspace.path, 'ledger'), runId: randomUUID(),
    limitMicroUsd: 400_000_000, requestCap: 100_000 };
  createExperimentBudget(configuration).close();
  const old = inspectExperimentBudgetForEmbeddingUpgrade(configuration);
  upgradeExperimentBudgetForEmbeddings({ ...configuration, expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 },
    expectedHistorySha256: old.historySha256 });
  const records = [], checkpoints = [], calls = [], controller = new AbortController(); let active;
  const initial = inspectEmbeddingExperimentBudgetSnapshot(configuration);
  const options = { preparation, manifest: createCardPlanComparisonManifest(preparation.observation), configuration,
    checkpoint: { requestCount: initial.requestCount, reservedMicroUsd: initial.reservedMicroUsd },
    historySha256: initial.historySha256, apiKey: 'synthetic_card_runtime_secret', signal: controller.signal,
    onRecord(row) { active = row; records.push(row); }, onCheckpoint(row) { checkpoints.push(row); },
    async fetchImpl(url, init) {
      calls.push({ url, body: init.body, slotId: active.slotId }); return defaultResponse(url, init);
    } };
  return { workspace, preparation, configuration, records, checkpoints, calls, controller, options,
    get active() { return active; } };
}
function defaultResponse(url, init) {
  if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
  if (url.endsWith('/chat/completions')) return Response.json({ object: 'chat.completion', model,
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Synthetic plumbing answer.' } }],
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } });
  const body = JSON.parse(init.body), input = JSON.parse(body.input[0].content[0].text);
  return body.text.format.name === 'cairn_rank'
    ? response({ refs: input.candidates.slice(0, 6).map(card => ({ namespaceIndex: card.namespaceIndex,
      memoryId: card.memory.id, revision: card.memory.revision })) })
    : response({ selectedCards: [0, 1, 2, 3, 4, 5], chains: [0, 1, 2, 3, 4, 5].map(slot =>
      ({ members: [slot], sources: [{ member: 0, receipt: 0 }], terminal: 0 })) });
}
const denominators = report => {
  assert.equal(report.cases.length, 24); assert.equal(report.cases.flatMap(c => c.selections).length, 48);
  assert.equal(report.cases.flatMap(c => c.answers).length, 72);
};

test('RT1/RT2: literal selection failures, one answer failure, hostile signal own hooks and final large body retain every slot', async t => {
  const h = await harness(t); let hooks = 0, answerFailures = 0, largeBody = null;
  for (const name of ['aborted', 'addEventListener', 'removeEventListener']) Object.defineProperty(h.controller.signal, name,
    { get() { hooks++; throw Error('hostile-own-signal-hook'); } });
  h.options.fetchImpl = async (url, init) => {
    const slot = h.active.slotId; h.calls.push({ url, body: init.body, slotId: slot });
    const first = h.preparation.observation.cases[0].id, second = h.preparation.observation.cases[1].id;
    const third = h.preparation.observation.cases[2].id, last = h.preparation.observation.cases.at(-1).id;
    if (slot === first + '-selection-A' && url.endsWith('/responses')) return response({ refs: [
      { namespaceIndex: 999, memoryId: 'invalid-ref', revision: 1 }] });
    if (slot === second + '-selection-B' && url.endsWith('/responses')) return response({ selectedCards: [12], chains: [] });
    if (slot === third + '-answer-A') { answerFailures++; return Response.json({ object: 'chat.completion', model,
      choices: [{ finish_reason: 'length', message: { role: 'assistant', content: 'Invalid first answer.' } }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } }); }
    if (slot === last + '-answer-A') {
      const body = await defaultResponse(url, init).json(); body.unusedPadding = 'x'.repeat(245000);
      largeBody = JSON.stringify(body); return new Response(largeBody, { headers: { 'Content-Type': 'application/json' } });
    }
    return defaultResponse(url, init);
  };
  const report = await runCardPlanComparison(h.options); denominators(report);
  assert.equal(report.status, 'completed'); assert.equal(hooks, 0); assert.equal(answerFailures, 1);
  assert.equal(report.cases[0].selections[0].failure.code, 'invalid_model_output');
  assert.equal(report.cases[0].answers[0].disposition, 'unanswered-selection-failed');
  assert(report.cases[0].answers.slice(1).every(slot => slot.status === 'completed'));
  assert.equal(report.cases[1].selections[1].failure.code, 'invalid_model_output');
  assert.equal(report.cases[1].answers[0].status, 'completed');
  assert(report.cases[1].answers.slice(1).every(slot => slot.disposition === 'unanswered-selection-failed'));
  assert.equal(report.cases[2].answers[0].failure.code, 'invalid_answer_response');
  assert(report.cases[2].answers.slice(1).every(slot => slot.status === 'completed'));
  assert.equal(h.calls.length, 165); assert.equal(report.resources.reservedIntents, 165);
  assert.equal(report.resources.missingFinalCalls, 0);
  const last = report.cases.at(-1).answers[0], attempt = report.attempts.find(row => row.slotId === last.slotId);
  assert.equal(boundFile(attempt.post.responseArtifact).toString('utf8'), largeBody);
  assert.equal(last.status, 'completed'); verifyBoundReport(h.preparation, report, h.records);
  assert.throws(() => packCardPlanAnswer({ evidence: structuredClone(report.cases[0].selections[1].evidence),
    countTokens: countOpenAITokens }), { code: 'invalid_card_plan_evidence' });
});

test('RT1: cancellation, absolute expiry, auth, provenance/state drift and persistence failure halt honest denominators', async t => {
  for (const mode of ['cancel', 'expiry', 'auth', 'provenance', 'record', 'missing-final', 'checkpoint', 'wire']) await t.test(mode, async st => {
    const h = await harness(st); const baselineFetch = h.options.fetchImpl;
    if (mode === 'expiry') {
      const originalNow = performance.now.bind(performance); let advanced = 0;
      st.mock.method(performance, 'now', () => originalNow() + advanced);
      h.options.fetchImpl = async (url, init) => { advanced = 1_200_001; return baselineFetch(url, init); };
    } else if (mode === 'cancel') h.options.fetchImpl = async (url, init) => {
      h.controller.abort(); return baselineFetch(url, init);
    };
    else if (mode === 'auth') h.options.fetchImpl = async () => Response.json({ error: 'synthetic-auth' }, { status: 401 });
    else if (mode === 'provenance') h.options.fetchImpl = async (url, init) => {
      const result = await baselineFetch(url, init);
      if (url.endsWith('/responses')) {
        const c = h.preparation.observation.cases[0];
        const literal = JSON.parse((await result.clone().json()).output[0].content[0].text);
        const chosen = c.captures.find(capture => capture.memory.id === literal.refs[0].memoryId);
        const db = new DatabaseSync(c.path);
        try { db.prepare('UPDATE receipts SET excerpt = ? WHERE id = ?').run('synthetic-drift', chosen.receipts[0].id); }
        finally { db.close(); }
      }
      return result;
    };
    else if (mode === 'record') h.options.onRecord = row => { h.records.push(row); throw Error('synthetic-record-failure'); };
    else if (mode === 'missing-final') h.options.onRecord = row => {
      h.records.push(row); chmodSync(h.preparation.observation.outputRoot, 0o755);
      queueMicrotask(() => chmodSync(h.preparation.observation.outputRoot, 0o700));
      throw Error('synthetic-post-record-interruption');
    };
    else if (mode === 'checkpoint') h.options.onCheckpoint = () => { throw Error('synthetic-checkpoint-failure'); };
    else if (mode === 'wire') {
      const stringify = JSON.stringify;
      st.mock.method(JSON, 'stringify', (value, ...args) => {
        if (value?.model === model && value?.text?.format?.name === 'cairn_rank')
          return stringify({ ...value, syntheticDrift: true }, ...args);
        return stringify(value, ...args);
      });
    }
    const report = await runCardPlanComparison(h.options); denominators(report); assert.equal(report.status, 'halted');
    const expected = { cancel: 'card_plan_cancelled', expiry: 'card_plan_absolute_deadline', auth: 'authentication_failed',
      provenance: 'card_plan_store_drift', record: 'card_plan_persistence_failure', 'missing-final': 'card_plan_persistence_failure',
      checkpoint: 'card_plan_persistence_failure', wire: 'card_plan_wire_drift' };
    assert.equal(report.failure.code, expected[mode]);
    assert(report.cases.slice(1).every(c => [...c.selections, ...c.answers].every(slot => slot.status === 'not-run')));
    const ledger = inspectEmbeddingExperimentBudgetSnapshot(h.configuration);
    assert(ledger.attempts.every(row => row.outcome !== null));
    assert.equal(report.resources.reservedIntents, ledger.requestCount);
    if (['record', 'missing-final', 'wire'].includes(mode)) assert.equal(report.resources.physicalCalls, 0);
    if (mode === 'missing-final') {
      assert.equal(report.resources.reservedIntents, 1); assert.equal(report.resources.missingFinalCalls, 1);
      assert.equal(report.resources.unknownCostCalls, 1); assert.equal(report.attempts[0].post, null);
    }
    if (mode === 'provenance') {
      assert.equal(report.cases[0].selections[0].recall.ok, false);
      assert.equal(report.cases[0].selections[0].failure.code, 'storage_error');
      assert.equal(report.cases[0].selections[0].stateFailure.code, 'card_plan_store_drift');
    }
    verifyBoundReport(h.preparation, report, h.records);
    await assert.rejects(runCardPlanComparison(h.options), { code: 'card_plan_preparation_consumed' });
  });
});

test('RT1/RT2: rejected key/setup and concurrent first use consume exact capability; hostile descriptors never execute', async t => {
  for (const mode of ['key', 'setup', 'concurrent']) await t.test(mode, async st => {
    const h = await harness(st); let hooks = 0;
    const malicious = Object.defineProperty({}, 'signal', { enumerable: true, get() { hooks++; throw Error('hostile'); } });
    await assert.rejects(runCardPlanComparison(malicious), { code: 'invalid_card_plan_configuration' });
    await assert.rejects(runCardPlanComparison(new Proxy({}, { ownKeys() { hooks++; throw Error('hostile'); } })),
      { code: 'invalid_card_plan_configuration' });
    await assert.rejects(runCardPlanComparison({ ...h.options, preparation: { ...h.preparation } }),
      { code: 'invalid_card_plan_preparation' }); assert.equal(hooks, 0);
    if (mode === 'key') h.options.apiKey = '';
    else if (mode === 'setup') h.options.configuration = { ...h.configuration, directory: join(h.workspace.path, 'absent-ledger') };
    else h.controller.abort();
    const first = runCardPlanComparison(h.options);
    await assert.rejects(runCardPlanComparison(h.options), { code: 'card_plan_preparation_consumed' });
    const report = await first; assert.equal(report.status, 'halted'); denominators(report);
    assert.equal(h.calls.length, 0); assert.equal(report.resources.reservedIntents, 0);
    await assert.rejects(runCardPlanComparison(h.options), { code: 'card_plan_preparation_consumed' });
  });
});

test('RT1/RT2: real core logical timeout waits for settled owner; physical answer timeout proceeds only while absolute/caller deadlines live', async t => {
  for (const mode of ['ordinary-logical', 'card-logical', 'answer-physical']) await t.test(mode, async st => {
    const h = await harness(st); st.mock.timers.enable({ apis: ['setTimeout'] });
    let stalled = false, interrupted = null, nextOwnerObservation = null;
    h.options.fetchImpl = async (url, init) => {
      const slot = h.active.slotId;
      const target = mode === 'ordinary-logical' ? slot.endsWith('-selection-A')
        : mode === 'card-logical' ? slot.endsWith('-selection-B') : slot.endsWith('-answer-A');
      if (target && !stalled) {
        stalled = true; interrupted = slot;
        setImmediate(() => st.mock.timers.tick(mode === 'answer-physical' ? 200_001 : 30_001));
        return new Promise(() => {});
      }
      if (interrupted && slot !== interrupted && !nextOwnerObservation) {
        const ledger = inspectEmbeddingExperimentBudgetSnapshot(h.configuration);
        const prior = h.records.filter(row => row.slotId === interrupted && row.phase === 'post');
        nextOwnerObservation = { priorPosts: prior.length,
          priorSettled: ledger.attempts.filter(row => row.attemptId !== h.active.attemptId).every(row => row.outcome !== null),
          currentPending: ledger.attempts.find(row => row.attemptId === h.active.attemptId)?.outcome === null };
      }
      return defaultResponse(url, init);
    };
    const report = await runCardPlanComparison(h.options); assert.equal(report.status, 'completed'); denominators(report);
    assert(stalled && nextOwnerObservation);
    assert(nextOwnerObservation.priorPosts > 0); assert.equal(nextOwnerObservation.priorSettled, true);
    assert.equal(nextOwnerObservation.currentPending, true);
    const slot = report.cases.flatMap(c => [...c.selections, ...c.answers]).find(row => row.slotId === interrupted);
    assert.equal(slot.status, 'failed'); assert.equal(slot.failure.code, 'model_timeout');
    assert.equal(slot.failureEvidence.normalization, 'healthy-settled-per-call-timeout');
    assert.equal(slot.failureEvidence.settled, true); assert.equal(slot.failureEvidence.callerAborted, false);
    assert.equal(slot.failureEvidence.absoluteDeadlineLive, true);
    assert.equal(report.resources.missingFinalCalls, 0); assert(report.resources.unknownCostCalls > 0);
    assert(report.cases.slice(1).every(c => c.selections.every(row => row.status === 'completed')
      && c.answers.every(row => row.status === 'completed')));
    verifyBoundReport(h.preparation, report, h.records);
  });
});

test('RT2: large fresh synthetic ledger retains exact original prefix and checkpoint identity', async t => {
  const h = await harness(t); const initial = inspectEmbeddingExperimentBudgetSnapshot(h.configuration);
  const db = new DatabaseSync(join(h.configuration.directory, 'experiment-budget.sqlite'));
  try {
    db.exec('BEGIN IMMEDIATE');
    const insert = db.prepare('INSERT INTO attempts(attempt_id,channel,reserved_micro_usd,outcome,actual_micro_usd) VALUES(?, ?, 1, ?, NULL)');
    for (let index = 0; index < 60000; index++) {
      insert.run(randomUUID(), 'host-completion', 'unknown');
    }
    db.exec('UPDATE run_config SET request_count = 60000, reserved_micro_usd = 60000; COMMIT');
  } finally { db.close(); }
  const before = inspectEmbeddingExperimentBudgetSnapshot(h.configuration);
  assert.equal(initial.requestCount, 0); assert.equal(before.requestCount, 60000);
  h.options.checkpoint = { requestCount: before.requestCount, reservedMicroUsd: before.reservedMicroUsd };
  h.options.historySha256 = before.historySha256;
  h.options.onCheckpoint = row => { h.checkpoints.push(row); if (h.checkpoints.length === 5) h.controller.abort(); };
  const report = await runCardPlanComparison(h.options); assert.equal(report.status, 'halted');
  assert.equal(report.failure.code, 'card_plan_cancelled'); assert.equal(report.resources.answersCompleted, 3);
  assert(report.originalHistory.bytes > 8 * 1024 * 1024 && report.originalHistory.bytes < 128 * 1024 * 1024);
  const retained = JSON.parse(boundFile(report.originalHistory)); assert.deepEqual(retained, before);
  const after = inspectEmbeddingExperimentBudgetSnapshot(h.configuration);
  assert.deepEqual(after.attempts.slice(0, before.requestCount), before.attempts);
  assert.equal(after.requestCount, 60007); assert.equal(report.resources.initialRequestCount, 60000);
  assert(report.checkpoints.every(row => row.before.requestCount >= 60000 && row.deltas.every(attempt => attempt.outcome !== null)));
  verifyBoundReport(h.preparation, report, h.records);
});

test('RT2: accepted guard rejects native redirect and hostile responses without executing proxy hooks', async () => {
  let hooks = 0; const fatal = [], controller = new AbortController();
  const guard = createSourceBundleGuard({ signal: controller.signal, deadline: performance.now() + 1000,
    onFatal(code) { fatal.push(code); }, onDispatch() {},
    fetchImpl: async () => new Proxy({}, { getPrototypeOf() { hooks++; throw Error('hostile'); } }) });
  try { await assert.rejects(guard.fetch('https://synthetic.invalid', { signal: new AbortController().signal }),
    { code: 'invalid_response' }); assert.equal(hooks, 0); }
  finally { guard.close(); }
  const redirected = createSourceBundleGuard({ signal: controller.signal, deadline: performance.now() + 1000,
    onFatal(code) { fatal.push(code); }, onDispatch() {}, fetchImpl: async () => {
      throw new TypeError('fetch failed', { cause: new Error('unexpected redirect') });
    } });
  try { await assert.rejects(redirected.fetch('https://synthetic.invalid', { signal: new AbortController().signal }),
    { code: 'redirect_rejected' }); assert.deepEqual(fatal, ['redirect_rejected']); }
  finally { redirected.close(); }
});

test('RT2: manifest and accepted callback delivery reject hostile descriptors, proxies and promise hooks', () => {
  let hooks = 0;
  const descriptor = Object.defineProperty({}, 'version', { enumerable: true,
    get() { hooks++; throw Error('hostile-manifest-getter'); } });
  assert.throws(() => createCardPlanComparisonManifest(descriptor), { code: 'invalid_card_plan_manifest' });
  assert.throws(() => createCardPlanComparisonManifest(new Proxy({}, { ownKeys() { hooks++; throw Error('hostile-manifest-proxy'); } })),
    { code: 'invalid_card_plan_manifest' });
  const promise = Promise.resolve();
  Object.defineProperty(promise, 'catch', { get() { hooks++; throw Error('hostile-promise-hook'); } });
  assert.throws(() => deliverSourceBundleObservation(() => promise, { type: 'synthetic' }),
    { code: 'record_persistence_failed' });
  assert.equal(hooks, 0);
});
