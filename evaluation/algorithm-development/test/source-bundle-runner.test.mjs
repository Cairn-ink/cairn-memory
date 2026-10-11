import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { chmod, mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { assertSourceBundleStoreUnchanged, consumeSourceBundlePreparation,
  prepareSourceBundleComparison } from '../source-bundle-store.mjs';
import { createSourceBundleGuard, createSourceBundleComparisonManifest,
  deliverSourceBundleObservation, runSourceBundleComparison, sourceBundleFailureCode } from '../source-bundle-runner.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const sourceUrl = new URL('../source-bundle-cases.json', import.meta.url);
const sources = JSON.parse(readFileSync(sourceUrl, 'utf8'));
const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const keys = value => Object.keys(value).sort();
const supported = Number(process.versions.node.split('.')[0]) >= 22;
const MODEL = 'gpt-4.1-mini-2025-04-14';
const quote = value => `"${value.replaceAll('"', '""')}"`;
const KEY = 'synthetic_offline_comparison_key';

async function ledgerFixture(workspace, historyRows = 0, overrides = {}) {
  const budget = await import('../../experiment-budget/index.mjs');
  const configuration = { directory: join(workspace.path, `budget-${randomUUID()}`), runId: randomUUID(),
    limitMicroUsd: 400000000, requestCap: 100000, ...overrides };
  budget.createExperimentBudget(configuration).close();
  if (historyRows) {
    // Owned, initialized ledger only. Never insert memory/card rows directly.
    const { DatabaseSync } = await import('node:sqlite');
    const database = new DatabaseSync(join(configuration.directory, 'experiment-budget.sqlite'));
    try {
      database.exec('BEGIN IMMEDIATE');
      const insert = database.prepare('INSERT INTO attempts(attempt_id,channel,reserved_micro_usd,outcome,actual_micro_usd) VALUES(?,\'host-completion\',1,\'unknown\',NULL)');
      for (let index = 0; index < historyRows; index++) insert.run(randomUUID());
      database.prepare('UPDATE run_config SET request_count=?,reserved_micro_usd=? WHERE singleton=1').run(historyRows, historyRows);
      database.exec('COMMIT');
    } finally { database.close(); }
  }
  const initial = budget.inspectExperimentBudgetForEmbeddingUpgrade(configuration);
  budget.upgradeExperimentBudgetForEmbeddings({ ...configuration,
    expectedCheckpoint: { requestCount: initial.requestCount, reservedMicroUsd: initial.reservedMicroUsd },
    expectedHistorySha256: initial.historySha256 });
  return { configuration, checkpoint: { requestCount: initial.requestCount, reservedMicroUsd: initial.reservedMicroUsd }, historySha256: initial.historySha256 };
}
function fakeProvider(url, init) {
  const body = JSON.parse(init.body);
  if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 500 });
  if (url.endsWith('/chat/completions')) return Response.json({ object: 'chat.completion', model: MODEL,
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Offline plumbing control.' } }],
    usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } });
  const input = JSON.parse(body.input[0].content[0].text), format = body.text.format.name;
  let proposal;
  if (format === 'cairn_source_bundle_plan_rank_v1') proposal = { bundles: [{ sourceIndices: [0, 1], terminalSourceIndex: 1 }] };
  else if (format === 'cairn_rank') proposal = { refs: input.candidates.slice(0, 2).map(candidate => ({
    namespaceIndex: candidate.namespaceIndex, memoryId: candidate.memory.id, revision: candidate.memory.revision })) };
  else proposal = { refs: input.maps[0].items.slice(0, 3).map(item => ({ namespaceIndex: input.maps[0].namespaceIndex, ...item.ref })) };
  return Response.json({ object: 'response', id: 'resp_offline', model: MODEL, status: 'completed', error: null, incomplete_details: null,
    output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(proposal) }] }],
    usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } });
}

test('concrete guard bounds HTTP and body, sanitizes hostile errors and stops caller cancellation', async () => {
  for (const mode of ['never-http', 'never-body', 'late-http', 'late-body', 'sync-throw', 'caller-abort', 'method-abort']) {
    const controller = new AbortController(), method = new AbortController(), fatal = [], calls = [];
    let touched = false;
    const hostile = Object.defineProperty(new Error('opaque'), 'code', { get() { touched = true; throw new Error(KEY); } });
    const guard = createSourceBundleGuard({ signal: controller.signal, deadline: performance.now() + 40,
      onFatal: code => fatal.push(code), onDispatch: () => calls.push('dispatch'),
      fetchImpl() {
        if (mode === 'sync-throw') throw hostile;
        if (mode === 'never-body') return new Response(new ReadableStream({ pull() { return new Promise(() => {}); } }));
        if (mode === 'late-body') return new Response(new ReadableStream({ async pull(output) {
          await new Promise(resolve => setTimeout(resolve, 80)); try { output.close(); } catch { /* already cancelled */ } } }));
        if (mode === 'late-http') return new Promise(resolve => setTimeout(() => resolve(Response.json({ late: true })), 80));
        if (mode === 'caller-abort') setTimeout(() => controller.abort(), 5);
        if (mode === 'method-abort') setTimeout(() => method.abort(), 5);
        return new Promise(() => {});
      } });
    await assert.rejects(async () => { const response = await guard.fetch('https://offline.invalid', { signal: method.signal });
      await response.text(); }, error => sourceBundleFailureCode(error) === (mode === 'sync-throw' ? 'provider_failed'
      : mode === 'caller-abort' ? 'cancelled' : mode === 'method-abort' ? 'model_timeout' : 'deadline_exceeded'));
    guard.close(); assert.equal(touched, false); assert.equal(calls.length, 1);
    assert.deepEqual(fatal, ['sync-throw', 'method-abort'].includes(mode) ? [] : [mode === 'caller-abort' ? 'cancelled' : 'deadline_exceeded']);
  }
});

test('runtime observation boundary rejects throwing, promise and accessor callbacks without secret coercion', async () => {
  const observation = { observed: true };
  for (const callback of [() => 1, () => Promise.reject(new Error(KEY)), () => { throw new Error(KEY); }])
    assert.throws(() => deliverSourceBundleObservation(callback, observation), error => sourceBundleFailureCode(error) === 'record_persistence_failed');
  let touched = false;
  const poisoned = Object.defineProperty({}, 'observed', { enumerable: true, get() { touched = true; return KEY; } });
  assert.throws(() => deliverSourceBundleObservation(() => {}, poisoned), /record_persistence_failed/);
  assert.equal(touched, false); await new Promise(resolve => setImmediate(resolve));
});

test('actual ordinary headroom and guarded answer HTTP/body deadlines settle without cap renewal', { skip: !supported }, async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-bundle-boundary-' });
  const { createAlgorithmDevelopmentTransport } = await import('../transport.mjs');
  const budget = await import('../../experiment-budget/index.mjs');
  for (const overrides of [{ requestCap: 1967 }, { limitMicroUsd: 39999999 }]) {
    const ledger = await ledgerFixture(workspace, 0, overrides);
    assert.throws(() => createAlgorithmDevelopmentTransport({ ...ledger, apiKey: KEY,
      fetchImpl() { assert.fail('no dispatch before inherited headroom'); }, onRecord() {} }),
    // The existing bound-ledger authorization boundary projects the ordinary
    // constructor's affordability rejection to ledger_failed. Do not rewrite it.
    error => sourceBundleFailureCode(error) === 'ledger_failed');
    assert.equal(budget.inspectEmbeddingExperimentBudgetSnapshot(ledger.configuration).requestCount, 0);
  }
  for (const mode of ['http', 'body', 'late-http', 'late-body']) {
    const ledger = await ledgerFixture(workspace), controller = new AbortController(), fatal = [], records = [];
    const guard = createSourceBundleGuard({ signal: controller.signal, deadline: performance.now() + 40,
      onFatal: code => fatal.push(code), onDispatch() {}, fetchImpl() {
        if (mode === 'late-http') return new Promise(resolve => setTimeout(() => resolve(Response.json({ late: true })), 80));
        if (mode === 'http') return new Promise(() => {});
        return new Response(new ReadableStream({ async pull(output) {
          if (mode === 'body') return new Promise(() => {});
          await new Promise(resolve => setTimeout(resolve, 80)); try { output.close(); } catch { /* cancelled */ }
        } }));
      } });
    const transport = createAlgorithmDevelopmentTransport({ ...ledger, apiKey: KEY,
      fetchImpl: guard.fetch, onRecord: record => { records.push(record); } });
    workspace.defer(() => { transport.close(); guard.close(); });
    transport.beginCase({ id: `offline-${mode}`, ordinal: 1 }); transport.beginArm('baseline');
    await assert.rejects(transport.answer({ question: { text: 'Offline timeout control', date: '2026-10-12 23:59' },
      units: [] }));
    transport.close(); guard.close();
    const final = budget.inspectEmbeddingExperimentBudgetSnapshot(ledger.configuration);
    assert.equal(final.requestCount, 1); assert.equal(final.reservedMicroUsd, 5000);
    assert.equal(final.attempts[0].outcome, 'unknown'); assert.equal(final.attempts[0].actualMicroUsd, null);
    assert.equal(records.length, 2); assert.equal(records[0].attemptId, records[1].attemptId);
    assert.deepEqual(fatal, ['deadline_exceeded']);
  }
  await workspace.cleanup(); assert.equal(existsSync(workspace.path), false);
});

test('native loopback redirect rejection is fatal without following or reading hostile errors', async t => {
  let followed = 0;
  const server = createServer((request, response) => {
    if (request.url === '/followed') followed++;
    response.writeHead(302, { Location: '/followed' }); response.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const caller = new AbortController(), method = new AbortController(), fatal = [];
  const guard = createSourceBundleGuard({ fetchImpl: globalThis.fetch, signal: caller.signal,
    deadline: performance.now() + 5000, onFatal: code => fatal.push(code), onDispatch() {} });
  await assert.rejects(guard.fetch(`http://127.0.0.1:${server.address().port}/start`, {
    redirect: 'error', signal: method.signal }), error => sourceBundleFailureCode(error) === 'redirect_rejected');
  guard.close(); assert.deepEqual(fatal, ['redirect_rejected']); assert.equal(followed, 0);
});

test('57,655 historical attempts retain one exact base across real ordinary and planner transitions', { skip: !supported }, async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-bundle-history-' });
  const preparation = await prepareSourceBundleComparison({ outputRoot: workspace.path });
  const ledger = await ledgerFixture(workspace, 57655), controller = new AbortController(), checkpoints = [];
  const budget = await import('../../experiment-budget/index.mjs');
  const initial = budget.inspectEmbeddingExperimentBudgetSnapshot(ledger.configuration);
  const result = await runSourceBundleComparison({ preparation,
    manifest: createSourceBundleComparisonManifest(preparation.observation), ...ledger,
    apiKey: KEY, signal: controller.signal, fetchImpl: fakeProvider, onRecord() {},
    onCheckpoint(checkpoint) { checkpoints.push(checkpoint); if (checkpoints.length === 4) controller.abort(); } });
  assert.equal(result.status, 'stopped'); assert.equal(result.stopReason, 'cancelled');
  assert.equal(result.cases.length, 24); assert.equal(result.history.base.rows, 57655);
  assert.equal(result.resources.physicalIntents, 6); assert.equal(result.transitions.length, 4);
  assert.deepEqual(result.transitions.map(transition => transition.kind), ['ordinary', 'ordinary', 'planner', 'ordinary']);
  const text = await readFile(join(workspace.path, 'comparison', result.history.base.filename), 'utf8');
  assert.equal(digest(text), result.history.base.sha256);
  const base = JSON.parse(text); assert.deepEqual(base.attempts, initial.attempts);
  assert.equal(base.header.historySha256, initial.historySha256);
  const reconstructed = [...base.attempts];
  for (const checkpoint of checkpoints) {
    assert.equal(checkpoint.state.deltaStart, reconstructed.length);
    assert.ok(checkpoint.state.appendedAttempts.length <= 2);
    reconstructed.push(...checkpoint.state.appendedAttempts);
    assert.ok(Buffer.byteLength(JSON.stringify(checkpoint)) < 5000);
  }
  const final = budget.inspectEmbeddingExperimentBudgetSnapshot(ledger.configuration);
  assert.deepEqual(final.attempts, reconstructed);
  assert.deepEqual(final.attempts.slice(0, 57655), initial.attempts);
  assert.equal(result.finalState.header.historySha256, final.historySha256);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 2 * 1024 * 1024);
  for (const c of result.cases.slice(1)) for (const slot of [...Object.values(c.answers), c.probe]) {
    assert.equal(slot.execution, 'not-run'); assert.equal(slot.failure, 'cancelled');
  }
  await assert.rejects(runSourceBundleComparison({ preparation }), /invalid_source_bundle_preparation/);
  await workspace.cleanup(); assert.equal(existsSync(workspace.path), false);
});

for (const boundary of ['rank', 'select']) test(`provider count overflow at BQ01 ordinary ${boundary} stops the entire fixed schedule`,
  { skip: !supported }, async t => {
    const workspace = createTestWorkspace(t, { prefix: `cairn-bundle-count-overflow-${boundary}-` });
    try {
      const preparation = await prepareSourceBundleComparison({ outputRoot: workspace.path });
      assert.equal(preparation.observation.cases.length, 24);
      const ledger = await ledgerFixture(workspace), controller = new AbortController(), calls = [];
      const manifest = createSourceBundleComparisonManifest(preparation.observation);
      let current;
      const result = await runSourceBundleComparison({ preparation, manifest, ...ledger,
        apiKey: KEY, signal: controller.signal, onCheckpoint() {},
        onRecord(record) { if (record.normalized?.phase === 'pre') current = record; },
        fetchImpl(url, init) {
          const designated = current.caseId === 'BQ01' && current.ownerKind === 'ordinary' && current.phase === boundary;
          calls.push({ caseId: current.caseId, arm: current.arm, method: current.phase, url, designated });
          if (designated && url.endsWith('/input_tokens'))
            return Response.json({ object: 'response.input_tokens', input_tokens: 7025 });
          return fakeProvider(url, init);
        } });
      const budget = await import('../../experiment-budget/index.mjs');
      const final = budget.inspectEmbeddingExperimentBudgetSnapshot(ledger.configuration);
      const failedSlot = boundary === 'rank' ? result.cases[0].answers.ordinary : result.cases[0].probe;
      const boundaryIntents = result.intents.filter(intent => intent.caseId === 'BQ01' && intent.method === boundary);
      const designatedCalls = calls.filter(call => call.designated);
      console.log(JSON.stringify({ countOverflowBoundary: { boundary, status: result.status, stopReason: result.stopReason,
        slotFailure: failedSlot.failure, calls: calls.length, designatedCalls: designatedCalls.length,
        owners: result.transitions.length, intents: result.resources.physicalIntents,
        rawFailures: boundaryIntents.map(intent => ({ failure: intent.final?.failure,
          providerInputTokens: intent.final?.providerInputTokens, outcome: intent.final?.outcome })),
        qaSlots: result.cases.flatMap(c => Object.values(c.answers)).length, probeSlots: result.cases.length } }));
      assert.equal(result.resources.missingFinalRecords, 0);
      assert.equal(final.attempts.every(attempt => attempt.outcome !== null), true);
      assert.equal(boundaryIntents.length, 1);
      const failedIntent = boundaryIntents[0];
      assert.equal(failedIntent.dispatched, true); assert.equal(failedIntent.final.failure, 'context_budget_exceeded');
      assert.equal(failedIntent.final.providerInputTokens, 7025); assert.equal(failedIntent.final.reservedMicroUsd, 5000);
      assert.equal(failedIntent.final.actualMicroUsd, null); assert.equal(failedIntent.final.outcome, 'unknown');
      const settled = final.attempts.find(attempt => attempt.attemptId === failedIntent.attemptId);
      assert.equal(settled.reservedMicroUsd, 5000); assert.equal(settled.outcome, 'unknown'); assert.equal(settled.actualMicroUsd, null);
      assert.equal(designatedCalls.length, 1); assert.ok(designatedCalls[0].url.endsWith('/input_tokens'));
      assert.equal(result.cases.length, 24); assert.equal(result.cases.flatMap(c => Object.values(c.answers)).length, 48);
      assert.equal(result.cases.map(c => c.probe).length, 24);
      assert.equal(result.status, 'stopped'); assert.equal(result.stopReason, 'context_budget_exceeded');
      assert.equal(failedSlot.failure, 'context_budget_exceeded'); assert.equal(failedSlot.execution, 'failed');
      const expectedIntents = boundary === 'rank' ? 1 : 7, expectedOwners = boundary === 'rank' ? 1 : 5;
      assert.equal(calls.length, expectedIntents); assert.equal(result.intents.length, expectedIntents);
      assert.equal(result.transitions.length, expectedOwners);
      assert.ok(result.transitions.every(transition => transition.closed && transition.healthy));
      assert.equal(final.requestCount, expectedIntents); assert.equal(final.reservedMicroUsd, expectedIntents * 5000);
      assert.equal(result.finalState.header.requestCount, expectedIntents);
      if (boundary === 'rank') {
        assert.equal(failedSlot.answerInvoked, false); assert.equal(failedSlot.artifacts.rankFailure.code, 'context_budget_exceeded');
        for (const slot of [result.cases[0].answers['source-bundle'], result.cases[0].probe]) {
          assert.equal(slot.execution, 'not-run'); assert.equal(slot.failure, 'context_budget_exceeded');
        }
      } else {
        for (const slot of Object.values(result.cases[0].answers)) {
          assert.equal(slot.status, 'answered'); assert.equal(slot.execution, 'completed');
          assert.equal(slot.answer, 'Offline plumbing control.'); assert.equal(slot.answerInvoked, true);
        }
        assert.equal(failedSlot.artifacts.recall.ok, false);
        assert.equal(failedSlot.artifacts.selectCalls, 1); assert.equal(failedSlot.artifacts.rankCalls, 0);
      }
      for (const c of result.cases.slice(1)) for (const slot of [...Object.values(c.answers), c.probe]) {
        assert.equal(slot.execution, 'not-run'); assert.equal(slot.failure, 'context_budget_exceeded');
      }
      await assert.rejects(runSourceBundleComparison({ preparation }), /invalid_source_bundle_preparation/);
    } finally { await workspace.cleanup(); assert.equal(existsSync(workspace.path), false); }
  });

test('healthy malformed, provider and logical-timeout slots consume once and preserve the remaining schedule', { skip: !supported }, async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-bundle-consumed-' });
  const preparation = await prepareSourceBundleComparison({ outputRoot: workspace.path }), ledger = await ledgerFixture(workspace);
  const controller = new AbortController(); let current, touched = false;
  const hostile = Object.defineProperty(new Error(KEY), 'code', { get() { touched = true; throw new Error(KEY); } });
  const result = await runSourceBundleComparison({ preparation, manifest: createSourceBundleComparisonManifest(preparation.observation),
    ...ledger, apiKey: KEY, signal: controller.signal, onCheckpoint() {},
    onRecord(record) { if (record.normalized?.phase === 'pre') current = record; },
    async fetchImpl(url, init) {
      if (current.caseId === 'BQ01' && current.arm === 'ordinary' && current.phase === 'rank')
        return Response.json({ error: 'offline_provider_failure' }, { status: 503 });
      if (current.caseId === 'BQ04' && current.arm === 'ordinary' && current.phase === 'rank') throw hostile;
      if (current.caseId === 'BQ05' && current.arm === 'ordinary' && current.phase === 'rank') return new Promise(() => {});
      if (current.caseId === 'BQ06' && current.arm === 'source-bundle' && current.phase === 'plan') return new Promise(() => {});
      const response = fakeProvider(url, init);
      if (current.caseId === 'BQ02' && current.arm === 'source-bundle' && current.phase === 'plan' && url.endsWith('/responses')) {
        const body = await response.json(); body.output[0].content[0].text = JSON.stringify({ bundles: [{ sourceIndices: [0], terminalSourceIndex: 1 }] });
        return Response.json(body);
      }
      if (current.caseId === 'BQ03' && current.arm === 'ordinary' && current.phase === 'answer') {
        const body = await response.json(); delete body.object; return Response.json(body);
      }
      return response;
    } });
  const plannerTimeout = result.cases[5].answers['source-bundle'];
  console.log(JSON.stringify({ timeoutBoundary: { stop: result.stopReason,
    ordinaryFailure: result.cases[4].answers.ordinary.failure, plannerFailure: plannerTimeout.failure,
    rawQt: result.intents.filter(intent => intent.caseId === 'BQ06' && intent.ownerKind === 'planner').map(intent => ({
      slotId: intent.slotId, phaseId: intent.phaseId, failureCode: intent.final?.failureCode,
      settlementPersisted: intent.final?.settlementPersisted })),
    completedProbes: result.cases.filter(c => c.probe.execution === 'completed').length } }));
  assert.equal(result.status, 'accounted', JSON.stringify({ stop: result.stopReason, first: result.cases[0] }));
  assert.equal(result.cases.length, 24); assert.equal(result.cases.flatMap(c => Object.values(c.answers)).length, 48);
  assert.equal(result.cases.map(c => c.probe).length, 24); assert.equal(touched, false);
  assert.equal(result.cases[0].answers.ordinary.failure, 'provider_failed');
  assert.equal(result.cases[1].answers['source-bundle'].failure, 'invalid_model_output');
  assert.equal(result.cases[2].answers.ordinary.failure, 'invalid_answer_response');
  assert.equal(result.cases[3].answers.ordinary.failure, 'provider_failed');
  assert.equal(result.cases[4].answers.ordinary.failure, 'model_timeout');
  assert.equal(result.cases[5].answers['source-bundle'].failure, 'model_timeout');
  assert.equal(plannerTimeout.artifacts.plannerFailure.normalizedCode, 'model_timeout');
  assert.equal(plannerTimeout.artifacts.plannerFailure.normalization, 'healthy-settled-per-call-timeout');
  assert.equal(plannerTimeout.artifacts.plannerFailure.health.state, 'consumed');
  assert.ok(['cancelled', 'deadline_exceeded'].includes(plannerTimeout.artifacts.plannerFailure.rawCode));
  for (const index of [0, 3, 4]) {
    const slot = result.cases[index].answers.ordinary;
    assert.equal(slot.status, 'unresolved'); assert.equal(slot.answerInvoked, false);
    assert.equal(slot.artifacts.recall.ok, false); assert.equal(slot.artifacts.evidence, null);
  }
  assert.equal(result.cases[2].answers.ordinary.answerInvoked, true);
  assert.equal(result.cases[23].answers['source-bundle'].status, 'answered');
  assert.equal(result.cases[23].probe.execution, 'completed');
  assert.ok(result.transitions.every(transition => transition.healthy === true && transition.closed === true));
  assert.equal(result.resources.missingFinalRecords, 0); assert.ok(result.resources.unknownUsageIntents > 0);
  assert.equal(result.resources.knownMicroUsdCoverage, 'partial-known-only');
  await workspace.cleanup(); assert.equal(existsSync(workspace.path), false);
});

test('fatal callback, foreign append, store drift and answer cancellation stop all remaining slots without a new owner',
  { skip: !supported }, async t => {
    for (const mode of ['callback', 'persistence', 'foreign', 'drift', 'answer-cancel', 'collision']) await t.test(mode, async context => {
      const workspace = createTestWorkspace(context, { prefix: `cairn-bundle-fatal-${mode}-` });
      const preparation = await prepareSourceBundleComparison({ outputRoot: workspace.path }), ledger = await ledgerFixture(workspace);
      const controller = new AbortController(), budget = await import('../../experiment-budget/index.mjs');
      const { openMemoryCore } = await import('../../../core/contract.mjs');
      let calls = 0, checkpoints = 0, changed = false;
      if (mode === 'collision') {
        await mkdir(join(workspace.path, 'comparison'), { mode: 0o700 });
        await writeFile(join(workspace.path, 'comparison', 'sentinel'), 'preserved', { flag: 'wx', mode: 0o600 });
      }
      const result = await runSourceBundleComparison({ preparation,
        manifest: createSourceBundleComparisonManifest(preparation.observation), ...ledger,
        apiKey: KEY, signal: controller.signal,
        onRecord(record) { if (mode === 'callback' && record.normalized?.phase === 'pre') throw new Error(KEY); },
        onCheckpoint() {
          checkpoints++;
          if (checkpoints !== 1 || changed) return; changed = true;
          if (mode === 'persistence') writeFileSync(join(workspace.path, 'comparison', '000006-event.json'), 'preserved', { flag: 'wx', mode: 0o600 });
          if (mode === 'foreign') {
            const foreign = budget.reopenEmbeddingExperimentBudget(ledger.configuration), id = randomUUID();
            try { foreign.reserve({ attemptId: id, channel: 'cairn-count', reservedMicroUsd: 1 });
              foreign.recordOutcome({ attemptId: id, outcome: 'unknown' }); } finally { foreign.close(); }
          }
          if (mode === 'drift') {
            const c = preparation.observation.cases[0], mapping = c.mapping[0];
            // Genuine core correction, never direct card SQL.
            const core = openMemoryCore({ path: c.storePath });
            try { assert.equal(core.correct({ namespace: c.namespace, memoryId: mapping.memoryId,
              expectedRevision: mapping.revision, content: `${mapping.window} Offline integrity change.`, kind: 'context',
              receipt: { client: 'offline', sessionId: 'offline-change', eventId: 'changed', role: 'user', excerpt: 'Offline integrity change.' } }).ok, true); }
            finally { core.close(); }
          }
        }, async fetchImpl(url, init) {
          calls++;
          if (mode === 'answer-cancel' && url.endsWith('/chat/completions')) {
            setTimeout(() => controller.abort(), 5); return new Promise(() => {});
          }
          return fakeProvider(url, init);
        } });
      assert.equal(result.status, 'stopped');
      assert.equal(result.stopReason, { callback: 'record_persistence_failed', persistence: 'record_persistence_failed', foreign: 'ledger_failed',
        drift: 'store_drift', 'answer-cancel': 'cancelled', collision: 'record_persistence_failed' }[mode]);
      assert.equal(result.cases.length, 24); assert.equal(result.cases.flatMap(c => Object.values(c.answers)).length, 48);
      assert.equal(result.cases.map(c => c.probe).length, 24);
      for (const c of result.cases.slice(1)) for (const slot of [...Object.values(c.answers), c.probe]) {
        assert.equal(slot.execution, 'not-run'); assert.equal(slot.failure, result.stopReason);
      }
      assert.equal(calls, { callback: 0, persistence: 2, foreign: 2, drift: 2, 'answer-cancel': 3, collision: 0 }[mode]);
      assert.ok(result.transitions.length <= (['answer-cancel', 'persistence'].includes(mode) ? 2 : 1));
      const final = budget.inspectEmbeddingExperimentBudgetSnapshot(ledger.configuration);
      assert.equal(final.requestCount, { callback: 1, persistence: 3, foreign: 3, drift: 2, 'answer-cancel': 3, collision: 0 }[mode]);
      assert.equal(final.attempts.every(attempt => attempt.outcome !== null), true);
      if (mode === 'foreign') assert.equal(result.finalState.diagnostic, true);
      if (mode === 'persistence') assert.equal(readFileSync(join(workspace.path, 'comparison', '000006-event.json'), 'utf8'), 'preserved');
      if (mode === 'collision') {
        assert.deepEqual(await readdir(join(workspace.path, 'comparison')), ['sentinel']);
        assert.equal(await readFile(join(workspace.path, 'comparison', 'sentinel'), 'utf8'), 'preserved');
      }
      await assert.rejects(runSourceBundleComparison({ preparation }), /invalid_source_bundle_preparation/);
      await workspace.cleanup(); assert.equal(existsSync(workspace.path), false);
    });
  });

test('actual ordinary transport consumes corrected fake envelopes through the concrete guard', { skip: !supported }, async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-bundle-consumer-' });
  const { createAlgorithmDevelopmentTransport } = await import('../transport.mjs');
  const ledger = await ledgerFixture(workspace), controller = new AbortController(), records = [], fatal = [];
  const guard = createSourceBundleGuard({ signal: controller.signal, deadline: performance.now() + 10000,
    fetchImpl: fakeProvider, onFatal: code => fatal.push(code), onDispatch() {} });
  const transport = createAlgorithmDevelopmentTransport({ ...ledger, apiKey: KEY, fetchImpl: guard.fetch,
    onRecord: record => { records.push(record); } });
  workspace.defer(() => { transport.close(); guard.close(); });
  transport.beginCase({ id: 'offline-consumer', ordinal: 1 }); transport.beginArm('baseline');
  const candidates = [0, 1].map(index => ({ namespaceIndex: 0, memory: {
    id: `lme-turn-${digest(`memory-${index}`)}`, revision: 1, currentness: 'current' },
    receipts: [{ id: `lme-turn-${digest(`receipt-${index}`)}`, role: 'user', excerpt: `Literal offline source ${index}.` }],
    receiptCount: 1, interpretationStatus: 'omitted', sourceSelectionCoverage: 'unassessed' }));
  const output = await transport.model.rank({
    system: readFileSync(new URL('../../../core/prompts/recall-rank-source-evidence.md', import.meta.url), 'utf8'),
    input: { query: 'Offline consumer control', limit: 6, candidates }, maxOutputTokens: 1024, signal: controller.signal });
  assert.equal(output.refs.length, 2);
  const answer = await transport.answer({ question: { text: 'Offline consumer control', date: '2026-10-12 23:59' },
    units: [{ text: 'Literal source control.' }] });
  assert.equal(answer.answer, 'Offline plumbing control.'); assert.deepEqual(fatal, []);
  const selected = await transport.model.select({
    system: readFileSync(new URL('../../../core/prompts/recall-select.md', import.meta.url), 'utf8'),
    input: { query: 'Offline consumer control', maxRefs: 24, maps: [{ namespaceIndex: 0,
      exhausted: true, items: candidates.map(candidate => ({ type: 'unfiled', ref: {
        memoryId: candidate.memory.id, revision: candidate.memory.revision }, label: 'Offline card' })) }] },
    maxOutputTokens: 1024, signal: controller.signal });
  assert.equal(selected.refs.length, 2);
  assert.equal(transport.state().requestCount, 5); assert.equal(records.length, 10);
  const oldLedger = await ledgerFixture(workspace);
  const oldTransport = createAlgorithmDevelopmentTransport({ ...oldLedger, apiKey: KEY,
    fetchImpl: async (url, init) => { const response = fakeProvider(url, init);
      if (url.endsWith('/input_tokens')) return response;
      const body = await response.json(); delete body.object; return Response.json(body); }, onRecord() {} });
  workspace.defer(() => oldTransport.close());
  oldTransport.beginCase({ id: 'old-envelope', ordinal: 1 }); oldTransport.beginArm('baseline');
  await assert.rejects(oldTransport.model.rank({
    system: readFileSync(new URL('../../../core/prompts/recall-rank-source-evidence.md', import.meta.url), 'utf8'),
    input: { query: 'Offline consumer control', limit: 6, candidates }, maxOutputTokens: 1024, signal: controller.signal }),
  error => sourceBundleFailureCode(error) === 'invalid_model_output');
  await assert.rejects(oldTransport.answer({ question: { text: 'Offline consumer control', date: '2026-10-12 23:59' },
    units: [{ text: 'Literal source control.' }] }), error => sourceBundleFailureCode(error) === 'invalid_answer_response');
  oldTransport.assertHealthy(); assert.equal(oldTransport.state().requestCount, 3); oldTransport.close();
  transport.close(); guard.close(); await workspace.cleanup(); assert.equal(existsSync(workspace.path), false);
});

// An independent SQL reader, not the preparation's snapshot implementation.
async function readAllTables(path) {
  const { DatabaseSync } = await import('node:sqlite');
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const schema = database.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all();
    const tables = [];
    for (const { name } of schema.filter(row => row.type === 'table')) {
      const columns = database.prepare(`PRAGMA table_info(${quote(name)})`).all().map(column => column.name);
      tables.push({ name, columns,
        rows: database.prepare(`SELECT * FROM ${quote(name)} ORDER BY ${columns.map(quote).join(',')}`).all() });
    }
    return JSON.parse(JSON.stringify({ applicationId: database.prepare('PRAGMA application_id').get().application_id,
      userVersion: database.prepare('PRAGMA user_version').get().user_version, schema, tables }));
  } finally { database.close(); }
}

function expectedBundleSchema(count) {
  const index = { type: 'integer', minimum: 0, maximum: count - 1 };
  return { type: 'object', additionalProperties: false, required: ['bundles'], properties: {
    bundles: { type: 'array', maxItems: 6, items: { type: 'object', additionalProperties: false,
      required: ['sourceIndices', 'terminalSourceIndex'], properties: {
        sourceIndices: { type: 'array', minItems: 1, maxItems: 6, items: index }, terminalSourceIndex: index } } } } };
}

function assertWire(c, counter) {
  const catalog = c.rankRequest.input.candidates.map((candidate, sourceIndex) => ({ sourceIndex,
    namespaceIndex: candidate.namespaceIndex, memoryId: candidate.memory.id, revision: candidate.memory.revision,
    receiptId: candidate.receipts[0].id, recordedRole: candidate.receipts[0].role, excerpt: candidate.receipts[0].excerpt }));
  assert.deepEqual(c.bundlePrepared.request.input, { query: c.rankRequest.input.query, limit: 6, catalog });
  assert.deepEqual(c.bundlePrepared.request.outputSchema, expectedBundleSchema(12));
  const request = c.bundlePrepared.request;
  const expected = { model: MODEL, instructions: request.system,
    input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify({ query: c.rankRequest.input.query,
      limit: 6, catalog }) }] }], text: { format: { type: 'json_schema', name: 'cairn_source_bundle_plan_rank_v1',
      strict: true, schema: expectedBundleSchema(12) } }, truncation: 'disabled' };
  assert.equal(c.bundleWire.countBody, JSON.stringify(expected));
  assert.equal(c.bundleWire.generationBody, JSON.stringify({ ...expected, max_output_tokens: 1024,
    store: false, stream: false }));
  const ordinary = JSON.parse(c.ordinaryWire.countBody), generation = JSON.parse(c.ordinaryWire.generationBody);
  assert.deepEqual(keys(ordinary), ['input', 'instructions', 'model', 'text', 'truncation']);
  assert.equal(ordinary.model, MODEL);
  assert.equal(ordinary.instructions, c.rankRequest.system);
  assert.deepEqual(ordinary.input, [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(c.rankRequest.input) }] }]);
  assert.equal(ordinary.text.format.name, 'cairn_rank');
  assert.equal(ordinary.text.format.type, 'json_schema');
  assert.equal(ordinary.text.format.strict, true);
  assert.equal(ordinary.truncation, 'disabled');
  assert.deepEqual(generation, { ...ordinary, max_output_tokens: 1024, store: false, stream: false });
  const measured = { ordinaryPrepared: counter(JSON.stringify(c.rankRequest)),
    bundlePrepared: counter(JSON.stringify(request)), ordinaryCount: counter(c.ordinaryWire.countBody),
    ordinaryGeneration: counter(c.ordinaryWire.generationBody), bundleCount: counter(c.bundleWire.countBody),
    bundleGeneration: counter(c.bundleWire.generationBody) };
  assert.deepEqual(c.tokenCounts, measured);
  assert.ok(Object.values(measured).every(count => Number.isSafeInteger(count) && count > 0 && count <= 6000));
  for (const [name, wire] of [['ordinaryCount', c.ordinaryWire.countBody], ['ordinaryGeneration', c.ordinaryWire.generationBody],
    ['bundleCount', c.bundleWire.countBody], ['bundleGeneration', c.bundleWire.generationBody]])
    assert.equal(c.hashes[`${name}Sha256`], digest(wire));
}

test('preparation accepts only an explicit fresh private directory and never overwrites collisions', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-bundle-options-' });
  for (const options of [undefined, null, {}, { outputRoot: workspace.path, extra: true }, { outputRoot: '' },
    { outputRoot: ` ${workspace.path}` }, { outputRoot: `${workspace.path}\0` }])
    await assert.rejects(prepareSourceBundleComparison(options), /invalid_source_bundle_options/);
  let touched = false;
  const accessor = Object.defineProperty({}, 'outputRoot', { enumerable: true, get() { touched = true; return workspace.path; } });
  await assert.rejects(prepareSourceBundleComparison(accessor), /invalid_source_bundle_options/);
  assert.equal(touched, false);
  const hook = { outputRoot: workspace.path, toJSON() { touched = true; return {}; } };
  await assert.rejects(prepareSourceBundleComparison(hook), /invalid_source_bundle_options/);
  assert.equal(touched, false);
  const publicDirectory = join(workspace.path, 'public');
  await mkdir(publicDirectory, { mode: 0o755 }); await chmod(publicDirectory, 0o755);
  await assert.rejects(prepareSourceBundleComparison({ outputRoot: publicDirectory }), /invalid_source_bundle_output/);
  const alias = join(workspace.path, 'alias'); await symlink(publicDirectory, alias);
  await assert.rejects(prepareSourceBundleComparison({ outputRoot: alias }), /invalid_source_bundle_output/);
  const occupied = join(workspace.path, 'occupied'); await mkdir(occupied, { mode: 0o700 });
  await writeFile(join(occupied, 'sentinel'), 'preserve', { flag: 'wx', mode: 0o600 });
  await assert.rejects(prepareSourceBundleComparison({ outputRoot: occupied }), /source_bundle_output_not_fresh/);
  assert.equal(await readFile(join(occupied, 'sentinel'), 'utf8'), 'preserve');
  assert.deepEqual(await readdir(occupied), ['sentinel']);
  for (const fake of [{}, Object.freeze({ observation: {} }), JSON.parse('{"observation":{"eligible":true}}')])
    await assert.rejects(consumeSourceBundlePreparation(fake), /invalid_source_bundle_preparation/);
  await assert.rejects(assertSourceBundleStoreUnchanged({}), /invalid_source_bundle_preparation/);
});

test('all 24 actual stores cold-reopen with exact full source scans and bounded ordinary/bundle wire',
  { skip: !supported }, async t => {
    const workspace = createTestWorkspace(t, { prefix: 'cairn-bundle-preflight-' });
    const { countOpenAITokens } = await import('../../../adapters/openai/index.mjs');
    const capability = await prepareSourceBundleComparison({ outputRoot: workspace.path });
    const observation = capability.observation;
    assert.equal(observation.eligible, true);
    assert.equal(observation.cases.length, 24);
    assert.deepEqual(observation.cases.map(c => c.id), sources.map(c => c.id));
    assert.equal(observation.manifest.sourceSha256, digest(sources));
    assert.equal(observation.manifestSha256, digest(observation.manifest));
    assert.equal(observation.manifest.model, MODEL);
    assert.deepEqual(observation.manifest.limits, { inputTokens: 6000, rankOutputTokens: 1024,
      contextWindow: 8192, mapTokens: 4000, cases: 24, cardsPerCase: 12 });
    assert.equal(observation.manifest.resources.cards, 288);
    assert.equal(observation.manifest.resources.receipts, 288);
    assert.equal(observation.manifest.qtWireContractSha256,
      'f4f9a3b02fc87cae2c8306a51b31f3f1d6d5ee287b44d91580a65f15df91ebbc');
    assert.deepEqual(observation.manifest.orders, [['ordinary', 'source-bundle'], ['source-bundle', 'ordinary']]);
    for (const [ordinal, c] of observation.cases.entries()) {
      const source = sources[ordinal];
      assert.ok(Object.isFrozen(c) && Object.isFrozen(c.mapping));
      assert.deepEqual(keys(c.source), ['id', 'question', 'sessions']);
      assert.deepEqual(c.question, { text: source.question.text, date: '2026-10-12 23:59' });
      assert.equal(c.rankRequest.input.query, JSON.stringify({ question: source.question.text, date: '2026-10-12 23:59' }));
      assert.equal(c.rankRequest.input.limit, 6);
      assert.equal(c.mapping.length, 12); assert.equal(c.outcomes.length, 12);
      assert.equal(c.extractionInputs.length, 12); assert.equal(c.classificationInputs.length, 12);
      assert.equal(new Set(c.mapping.map(m => m.memoryId)).size, 12);
      assert.equal(new Set(c.mapping.map(m => m.receipt.id)).size, 12);
      for (const [index, mapping] of c.mapping.entries()) {
        const session = source.sessions[index], message = session.messages[0];
        const time = session.eventTime.slice(0, 16).replace('T', ' ');
        const window = `[session-date: ${time}; clock: dataset-local] source{${message.content} }`;
        assert.equal(mapping.originalSessionId, session.id);
        assert.equal(mapping.eventTime, session.eventTime);
        assert.equal(mapping.originalMessageIndex, 0);
        assert.equal(mapping.originalContent, message.content);
        assert.equal(mapping.role, message.role); assert.equal(mapping.window, window);
        assert.equal(mapping.receipt.excerpt, window); assert.equal(mapping.receipt.role, message.role);
        assert.equal(mapping.receipt.sessionId, mapping.captureInput.sessionId);
        assert.equal(mapping.receipt.eventId, mapping.captureInput.messages[0].id);
        assert.deepEqual(c.extractionInputs[index].messages.map(w => ({ index: w.index, role: w.role, content: w.content })),
          [{ index: mapping.sourceIndex, role: message.role, content: window }]);
        assert.equal(c.outcomes[index].classification.status, 'applied');
      }
      assert.ok(!JSON.stringify(c.extractionInputs).includes('"family":'));
      assert.ok(!JSON.stringify(c.rankRequest).includes('"expectedProposition":'));
      const independent = await readAllTables(c.storePath);
      assert.deepEqual(c.state.snapshot, independent);
      assert.equal(digest(independent), c.state.sha256);
      assert.equal(c.postPreflightStateSha256, c.state.sha256);
      assert.ok(c.state.fileBytes > 0);
      const memories = independent.tables.find(table => table.name === 'memories').rows;
      const receipts = independent.tables.find(table => table.name === 'receipts').rows;
      assert.equal(memories.length, 12); assert.equal(receipts.length, 12);
      for (const mapping of c.mapping) {
        const memory = memories.find(row => row.id === mapping.memoryId), receipt = receipts.find(row => row.id === mapping.receipt.id);
        assert.equal(memory.content, mapping.window); assert.equal(memory.deleted, 0);
        assert.equal(memory.filing_status, 'unfiled'); assert.equal(memory.currentness, 'current');
        assert.equal(memory.owner_id, c.namespace.ownerId); assert.equal(memory.scope, c.namespace.scope);
        assert.equal(memory.project_id, c.namespace.projectId);
        assert.equal(receipt.memory_id, memory.id); assert.equal(receipt.excerpt, mapping.window);
        assert.equal(receipt.role, mapping.role);
      }
      for (const map of [c.publicMap, c.recallMap]) {
        assert.equal(map.items.length, 12); assert.equal(map.exhausted, true);
        assert.equal(map.nextCursor, null); assert.deepEqual(map.invalidRefs, []);
        assert.ok(map.items.every(item => item.type === 'unfiled'));
      }
      assert.deepEqual(c.omissionCounters, { navigationItemsOmitted: 0, candidatesOmitted: 0,
        candidatesShortened: 0, receiptListsCapped: 0 });
      assert.equal(c.omissionCounterBasis, 'core-recall-zero-suppressed-field-plus-exact-source-attestation');
      assert.equal(c.recall.recallTruncated, undefined);
      assert.equal(c.recall.coverage, 'complete'); assert.equal(c.recall.selection.strategy, 'complete-map');
      assert.deepEqual(c.recall.memories, []);
      assert.deepEqual(c.rankRequest.input.candidates.map(candidate => candidate.memory.id), c.recallMap.items.map(item => item.ref.memoryId));
      for (const candidate of c.rankRequest.input.candidates) {
        const mapping = c.mapping.find(m => m.memoryId === candidate.memory.id);
        assert.equal(candidate.memory.revision, mapping.revision);
        assert.equal(candidate.namespaceIndex, 0); assert.equal(candidate.receiptCount, 1);
        assert.deepEqual(candidate.receipts, [{ id: mapping.receipt.id, role: mapping.role, excerpt: mapping.window }]);
      }
      assertWire(c, countOpenAITokens);
      const unchanged = await assertSourceBundleStoreUnchanged(c);
      assert.equal(unchanged.sha256, c.state.sha256);
      assert.ok(Number.isSafeInteger(unchanged.fileBytes) && unchanged.fileBytes > 0);
      assert.equal(c.hashes.sourceSha256, digest(source)); assert.equal(c.hashes.planSha256, digest(c.plan));
      assert.equal(c.hashes.mappingSha256, digest(c.mapping)); assert.equal(c.hashes.rankRequestSha256, digest(c.rankRequest));
      const stored = JSON.parse(await readFile(join(c.directory, 'preflight.json'), 'utf8'));
      assert.deepEqual(stored, c);
      const capture = JSON.parse(await readFile(join(c.directory, 'capture.json'), 'utf8'));
      assert.equal(capture.complete, true); assert.deepEqual(capture.mapping, c.mapping);
      assert.deepEqual(capture.outcomes, c.outcomes);
    }
    await assert.rejects(consumeSourceBundlePreparation(JSON.parse(JSON.stringify(capability))), /invalid_source_bundle_preparation/);
    const ledger = await ledgerFixture(workspace), controller = new AbortController(), wire = [], observed = [], checkpoints = [];
    const manifest = createSourceBundleComparisonManifest(observation);
    const comparison = await runSourceBundleComparison({ preparation: capability, manifest, ...ledger,
      apiKey: KEY, signal: controller.signal, onRecord: record => { observed.push(record); },
      onCheckpoint: checkpoint => { checkpoints.push(checkpoint); },
      fetchImpl: async (url, init) => { wire.push({ url, body: init.body }); return fakeProvider(url, init); } });
    assert.equal(comparison.status, 'accounted', JSON.stringify({ stop: comparison.stopReason,
      first: comparison.cases[0], resources: comparison.resources }));
    console.log(JSON.stringify({ comparisonStages: comparison.cases.map(c => ({ id: c.id,
      ordinary: c.answers.ordinary.failure, bundle: c.answers['source-bundle'].failure, probe: c.probe.failure })) }));
    assert.equal(comparison.cases.length, 24); assert.equal(comparison.resources.physicalIntents, 192);
    assert.equal(comparison.resources.reservedMicroUsd, 960000); assert.equal(wire.length, 192);
    assert.equal(checkpoints.length, 120); assert.equal(comparison.transitions.length, 120);
    assert.equal(observed.filter(event => event.normalized?.phase === 'pre').length, 192);
    assert.equal(observed.filter(event => event.normalized?.phase === 'post').length, 192);
    assert.equal(comparison.history.base.rows, 0);
    const historyPath = join(workspace.path, 'comparison', comparison.history.base.filename);
    assert.equal(digest(await readFile(historyPath, 'utf8')), comparison.history.base.sha256);
    const reconstructed = [];
    for (const transition of comparison.transitions) {
      assert.equal(transition.closed, true); assert.equal(transition.healthy, true);
      assert.equal(transition.state.representation, 'base-plus-ordered-delta-v1');
      assert.equal(transition.state.deltaStart, reconstructed.length);
      reconstructed.push(...transition.state.appendedAttempts);
      assert.equal(transition.state.header.requestCount, reconstructed.length);
    }
    assert.equal(reconstructed.length, 192);
    for (const [index, c] of comparison.cases.entries()) {
      assert.deepEqual(c.armOrder, index % 2 ? ['source-bundle', 'ordinary'] : ['ordinary', 'source-bundle']);
      for (const arm of ['ordinary', 'source-bundle']) {
        const slot = c.answers[arm];
        assert.equal(slot.status, 'answered'); assert.equal(slot.execution, 'completed');
        assert.equal(slot.answerInvoked, true); assert.equal(slot.answer, 'Offline plumbing control.');
        assert.deepEqual(slot.artifacts.rankRequest, observation.cases[index].rankRequest);
        assert.equal(slot.artifacts.recall.ok, true); assert.ok(slot.artifacts.authoritativeReads.length > 0);
        assert.deepEqual(JSON.parse(slot.artifacts.packed.request.messages[1].content).currentQuestion, c.question);
        assert.equal(slot.artifacts.packed.inputTokens <= 6000, true);
        assert.deepEqual(slot.artifacts.packed.omittedIndices, []);
        assert.equal(slot.artifacts.afterStore.sha256, observation.cases[index].state.sha256);
        const answerIntent = comparison.intents.filter(intent => intent.caseId === c.id && intent.method === 'answer'
          && intent.slotId === manifest.schedule[index].slots[arm]);
        assert.equal(answerIntent.length, 1);
        assert.equal(answerIntent[0].final.requestBody, JSON.stringify(slot.artifacts.packed.request));
        assert.deepEqual(JSON.parse(slot.artifacts.packed.request.messages[1].content).evidence, slot.artifacts.evidence.units);
        if (arm === 'source-bundle') {
          const bundle = JSON.parse(slot.artifacts.evidence.units[0].text);
          assert.equal(bundle.format, 'query-local-source-bundle-evidence-v1'); assert.equal(bundle.cards.length, 2);
          assert.deepEqual(bundle.cards.map(card => card.memoryId), slot.artifacts.rankRequest.input.candidates.slice(0, 2).map(candidate => candidate.memory.id));
          for (const card of bundle.cards) {
            const mapping = observation.cases[index].mapping.find(mapping => mapping.memoryId === card.memoryId);
            assert.deepEqual(card.sources, [{ receiptId: mapping.receipt.id, recordedRole: mapping.role, text: mapping.window }]);
          }
        }
      }
      assert.equal(c.probe.execution, 'completed'); assert.equal(c.probe.artifacts.selectCalls, 1);
      assert.equal(c.probe.artifacts.rankCalls, 1); assert.deepEqual(c.probe.artifacts.recall.value.memories, []);
      const methods = comparison.transitions.filter(transition => transition.caseId === c.id).map(transition => `${transition.arm}/${transition.method}`);
      assert.deepEqual(methods, [...c.armOrder.flatMap(arm => [`${arm}/${arm === 'ordinary' ? 'rank' : 'plan'}`, `${arm}/answer`]), 'probe/select']);
    }
    assert.ok(observed.filter(event => event.raw && event.ownerKind === 'ordinary').every(event => event.raw.ordinal === 1));
    assert.ok(observed.filter(event => event.raw).every(event => event.slotId === manifest.schedule[event.caseOrdinal - 1].slots[event.arm]));
    const final = (await import('../../experiment-budget/index.mjs')).inspectEmbeddingExperimentBudgetSnapshot(ledger.configuration);
    assert.deepEqual(final.attempts, reconstructed); assert.equal(final.historySha256, comparison.finalState.header.historySha256);
    await assert.rejects(consumeSourceBundlePreparation(capability), /invalid_source_bundle_preparation/);
    assert.deepEqual(JSON.parse(await readFile(join(workspace.path, 'preparation.json'), 'utf8')), observation);
    console.log(JSON.stringify({ sourceBundlePreflight: { cases: 24, cards: 288, receipts: 288,
      maxTokenCounts: Object.fromEntries(keys(observation.cases[0].tokenCounts).map(key => [key,
        Math.max(...observation.cases.map(c => c.tokenCounts[key]))])) } }));
    await workspace.cleanup(); assert.equal(existsSync(workspace.path), false);
  });

test('a changed actual store makes the whole preparation ineligible and consumes its first use',
  { skip: !supported }, async t => {
    const workspace = createTestWorkspace(t, { prefix: 'cairn-bundle-drift-' });
    const capability = await prepareSourceBundleComparison({ outputRoot: workspace.path });
    const c = capability.observation.cases[0], mapping = c.mapping[0];
    const { openMemoryCore } = await import('../../../core/contract.mjs');
    const core = openMemoryCore({ path: c.storePath });
    try {
      const changed = core.correct({ namespace: c.namespace, memoryId: mapping.memoryId,
        expectedRevision: mapping.revision, content: `${mapping.window} Offline integrity-test correction.`, kind: 'context',
        receipt: { client: 'offline-test', sessionId: 'integrity-test', eventId: 'correction', role: 'user', excerpt: 'Offline integrity-test correction.' } });
      assert.equal(changed.ok, true);
    } finally { core.close(); }
    await assert.rejects(assertSourceBundleStoreUnchanged(c), /source_bundle_store_drift/);
    await assert.rejects(consumeSourceBundlePreparation(capability), /source_bundle_store_drift/);
    await assert.rejects(consumeSourceBundlePreparation(capability), /invalid_source_bundle_preparation/);
    assert.equal(capability.observation.cases.length, 24);
    assert.equal(capability.observation.manifest.cases.length, 24);
    await workspace.cleanup(); assert.equal(existsSync(workspace.path), false);
  });

test('owned actual SQLite resources clean up after success, assertion and setup failure', { skip: !supported }, async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-bundle-cleanup-' });
  for (const mode of ['success', 'assertion', 'setup']) {
    const fixture = join(workspace.path, `${mode}.test.mjs`);
    const code = `import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { createTestWorkspace } from ${JSON.stringify(new URL('../../../tools/testing/workspace.mjs', import.meta.url).href)};
import { openMemoryCore } from ${JSON.stringify(new URL('../../../core/contract.mjs', import.meta.url).href)};
test('owned lifecycle', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-bundle-child-' });
  console.log('OWNED_SCRATCH=' + workspace.path);
  const core = openMemoryCore({ path: join(workspace.path, 'memory.sqlite'), model: {
    contextWindow: 8192, countTokens: text => Math.ceil(Buffer.byteLength(text) / 4) } });
  workspace.defer(() => core.close());
  if (${JSON.stringify(mode)} === 'setup') throw new Error('deliberate_setup_failure');
  if (${JSON.stringify(mode)} === 'assertion') assert.fail('deliberate_assertion_failure');
  assert.equal(core.map({ namespace: { ownerId: 'test', scope: 'personal', projectId: null }, purpose: 'recall', limit: 100 }).ok, true);
});`;
    await writeFile(fixture, code, { flag: 'wx', mode: 0o600 });
    const result = spawnSync(process.execPath, [join(root, 'tools/testing/run.mjs'), fixture],
      { cwd: root, encoding: 'utf8', timeout: 30000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, mode === 'success' ? 0 : 1, result.stdout + result.stderr);
    const scratch = result.stdout.match(/OWNED_SCRATCH=(\/[^\s]+)/)?.[1];
    assert.ok(scratch, result.stdout + result.stderr);
    assert.equal(existsSync(scratch), false);
  }
});
