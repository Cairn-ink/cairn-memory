// Stage D synthetic diagnostic only. No historical data, credentials or live transport.
// This is the ordinary v1/case-deadline guard, not bound-v2/mixed-v3. Private
// credential parent, v3 operator, native arm, mixed runner and scoring are absent;
// guard observations do not expose adapter internals or prove a historical cause.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { createOpenAIModel } from '../../../adapters/openai/index.mjs';
import { DEFAULT_MODEL } from '../../../adapters/openai/profiles.mjs';
import { openMemoryCore } from '../../../core/contract.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { experimentPolicy } from '../../live/session.mjs';
import { createExperimentBudget, inspectExperimentBudgetSnapshot } from '../index.mjs';
import { authorizeBenchmarkExtension, authorizeCaseDeadlineCapability,
  createExperimentRequestGuard, createCaseDeadlineExperimentRequestGuard } from '../request-guard.mjs';

export const HISTORY_SIZES = Object.freeze([16, 4096]);
export const CARDINALITY_HISTORY_SIZE = 35_812;
const namespace = { ownerId: 'synthetic-write-diagnostic', scope: 'personal', projectId: null };
const source = ordinal => `Synthetic preference ${ordinal}: use numbered examples.`;
const captureInput = ordinal => ({ namespace, client: 'synthetic', sessionId: 'synthetic-session',
  eventId: `synthetic-event-${ordinal}`, messages: [{ id: `synthetic-message-${ordinal}`,
    role: 'user', content: source(ordinal) }] });
const response = (payload, output) => Response.json({ id: 'resp_synthetic', object: 'response',
  model: payload.model, status: 'completed', error: null, incomplete_details: null,
  output: [{ id: 'msg_synthetic', type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: JSON.stringify(output), annotations: [] }] }],
  usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } });
const stage = model => ({ ...experimentPolicy().hostCompletion, model });
const measurements = () => ({ fullValidationQueries: 0, validatedAttemptRows: 0, quickChecks: 0 });

// Observe the exact existing readValidatedState full-history SQL. Count actual
// rows returned, not a guessed multiplier; quick_check work is counted separately
// because SQLite does not expose the pages/rows it examines. This test-only shim
// forwards each statement unchanged and is restored on every exit.
function observeValidation() {
  const prepare = DatabaseSync.prototype.prepare;
  let work = measurements();
  DatabaseSync.prototype.prepare = function(sql) {
    const statement = prepare.call(this, sql);
    const normalized = sql.replace(/\s+/gu, ' ').trim();
    const history = /^SELECT (?:rowid, )?attempt_id, channel, reserved_micro_usd, outcome, actual_micro_usd FROM attempts ORDER BY rowid$/u.test(normalized);
    if (history || normalized === 'PRAGMA quick_check') {
      const all = statement.all;
      statement.all = function(...args) {
        const rows = all.apply(this, args);
        if (history) { work.fullValidationQueries += 1; work.validatedAttemptRows += rows.length; }
        else work.quickChecks += 1;
        return rows;
      };
    }
    return statement;
  };
  return { snapshot: () => ({ ...work }), reset: () => { work = measurements(); },
    close: () => { DatabaseSync.prototype.prepare = prepare; } };
}

function seedOwnedLedger(workspace, historySize, requestSlots, policy, limitMicroUsd = 1_000_000) {
  const ledger = { directory: join(workspace.path, 'ledger'), runId: randomUUID(),
    limitMicroUsd, requestCap: historySize + requestSlots };
  const created = createExperimentBudget(ledger);
  workspace.defer(() => created.close());
  created.close();
  const validatedEmpty = inspectExperimentBudgetSnapshot(ledger);
  assert.equal(validatedEmpty.requestCount, 0);
  // Baseline policy must bind an unused validated book. History-dependent
  // benchmark/case bindings occur only after the bulk seed is fully validated.
  const baseline = createExperimentRequestGuard({ ledger, policy,
    fetchImpl: () => assert.fail('fixture setup cannot send') });
  workspace.defer(() => baseline.close());
  baseline.close();
  // Linear fixture setup in a brand-new invocation-owned book only. Production
  // APIs validate the completed schema/counters/history before any policy binding.
  const db = new DatabaseSync(join(ledger.directory, 'experiment-budget.sqlite'));
  let seedOpen = true;
  const closeSeed = () => { if (seedOpen) { db.close(); seedOpen = false; } };
  workspace.defer(closeSeed);
  try {
    db.exec('BEGIN IMMEDIATE');
    const insert = db.prepare('INSERT INTO attempts (attempt_id, channel, reserved_micro_usd, outcome, actual_micro_usd) VALUES (?, ?, 1, ?, ?)');
    for (let i = 0; i < historySize; i++) insert.run(randomUUID(), 'cairn-count',
      i === 0 ? 'unknown' : 'succeeded', null);
    db.prepare('UPDATE run_config SET reserved_micro_usd = ?, request_count = ? WHERE singleton = 1')
      .run(historySize, historySize);
    db.exec('COMMIT');
  } finally { closeSeed(); }
  const prefix = inspectExperimentBudgetSnapshot(ledger);
  assert.equal(prefix.requestCount, historySize);
  assert.equal(prefix.reservedMicroUsd, historySize);
  assert.equal(prefix.attempts[0].outcome, 'unknown');
  assert.equal(prefix.attempts.every(attempt => attempt.actualMicroUsd === null), true);
  return { ledger, prefix };
}

const attemptsProjection = attempts => attempts.map(attempt => ({ outcome: attempt.outcome,
  reservedMicroUsd: attempt.reservedMicroUsd, actualMicroUsd: attempt.actualMicroUsd,
  termination: attempt.termination }));

export function assertHealthy(report) {
  assert.equal(report.completedBatches, report.plannedBatches, 'all planned captures must complete');
  assert.equal(report.retainedCount, report.plannedBatches, 'all planned source memories must survive cold reopen');
  assert.equal(report.sourceIntegrity, true, 'source receipts must stay exact');
}

export async function runWriteDiagnostic({ guarded = true, historySize = 16,
  injection = 'none', batches = 3, advanceTimers } = {}) {
  assert.ok(['none', 'count-rejection', 'generation-rejection', 'later-generation-rejection', 'classification-rejection',
    'core-timeout', 'transport-timeout', 'external-abort', 'prefix-tamper', 'request-cap', 'monetary-cap'].includes(injection));
  assert.ok(HISTORY_SIZES.includes(historySize) || historySize === CARDINALITY_HISTORY_SIZE);
  assert.ok(Number.isInteger(batches) && batches >= 1 && batches <= 3);
  const workspace = createTestWorkspace(null, { prefix: 'cairn-write-diagnostic-' });
  const validation = observeValidation();
  workspace.defer(() => validation.close());
  const report = { version: 'cairn-synthetic-write-diagnostic-v1', guarded, historySize: guarded ? historySize : 0,
    injection, model: DEFAULT_MODEL, fakeTransportDelayMs: 0,
    timingScope: 'partial-local-core-and-accounting',
    configuredPolicy: null,
    plannedBatches: batches, completedBatches: 0, retainedCount: 0, sourceIntegrity: true,
    physicalRequests: 0, sourceOutcomes: [], modelEvents: [], modelEventsDropped: 0,
    timers: { coreModelTimeoutMs: 30_000, guardCountTimeoutMs: guarded ? injection === 'transport-timeout' ? 10 : 60_000 : null,
      testOnlyGuardAcceleration: injection === 'transport-timeout' },
    setupMs: null, captureMs: null, setupWork: null, captureWork: null, cleanupRemoved: false };
  const ids = [];
  const external = new AbortController();
  let guard;
  let core;
  let prefix;
  let ledger;
  let lastRequest;
  let reportReady = false;
  const setupStart = performance.now();
  try {
    // No transport path is discovered. Any accidental use of global fetch fails.
    const nativeFetch = globalThis.fetch;
    globalThis.fetch = () => { throw new Error('synthetic_network_denied'); };
    workspace.defer(() => { globalThis.fetch = nativeFetch; });
    const fakeFetch = async (url, options) => {
      assert.ok(['https://api.openai.com/v1/responses/input_tokens',
        'https://api.openai.com/v1/responses'].includes(url));
      report.physicalRequests += 1;
      const payload = JSON.parse(options.body);
      const count = url.endsWith('/input_tokens');
      const method = payload.text.format.name;
      if ((injection === 'count-rejection' && report.physicalRequests === 1)
        || (injection === 'generation-rejection' && report.physicalRequests === 2)
        || (injection === 'later-generation-rejection' && report.physicalRequests === 6)
        || (injection === 'classification-rejection' && method === 'cairn_classify')) {
        throw new Error('synthetic_injected_transport_failure');
      }
      if (['core-timeout', 'transport-timeout', 'external-abort'].includes(injection)
        && report.physicalRequests === 1) {
        if (injection === 'external-abort') external.abort();
        else {
          assert.equal(typeof advanceTimers, 'function', 'accelerated clock is test-only');
          // Core keeps its real 30s timer. The transport-only control explicitly
          // accelerates the guard count deadline to 10ms so core does not win.
          advanceTimers(injection === 'core-timeout' ? 30_000 : 10);
        }
        return new Promise(resolve => {
          const lateResponse = () => resolve(Response.json({ object: 'response.input_tokens', input_tokens: 100 }));
          if (options.signal.aborted) lateResponse();
          else options.signal.addEventListener('abort', lateResponse, { once: true });
        });
      }
      // Exactly the same no-delay one-attempt transport/output at both sizes.
      if (count) return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
      const input = JSON.parse(payload.input[0].content[0].text);
      return response(payload, method === 'cairn_extract'
        ? { items: [{ content: input.messages[0].content, kind: 'preference', confidence: 0.9, sourceIndices: [0] }] }
        : { items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) });
    };
    if (guarded) {
      const policy = experimentPolicy();
      if (injection === 'transport-timeout') policy.cairnCount.timeoutMs = 10;
      report.configuredPolicy = structuredClone(policy);
      ({ ledger, prefix } = seedOwnedLedger(workspace, historySize,
        injection === 'request-cap' ? 2 : 32, policy,
        injection === 'monetary-cap' ? historySize + 10_000 : 1_000_000));
      const benchmarkExtension = authorizeBenchmarkExtension({ ledger, policy,
        authorizationId: 'synthetic-write-benchmark', stages: {
          answer: stage(DEFAULT_MODEL), judge: stage('gpt-4o-2024-08-06') } });
      const caseDeadlineCapability = authorizeCaseDeadlineCapability({ ledger, policy, benchmarkExtension,
        authorizationId: 'synthetic-write-capability', executionId: 'synthetic-write-execution',
        checkpoint: { requestCount: prefix.requestCount, reservedMicroUsd: prefix.reservedMicroUsd },
        schedule: [{ phase: 'generation', caseId: 'synthetic-write' },
          { phase: 'scoring', caseId: 'synthetic-write' }] });
      guard = createCaseDeadlineExperimentRequestGuard({ ledger, policy, benchmarkExtension,
        caseDeadlineCapability, transportDiagnostics: 'bounded-v1', fetchImpl: fakeFetch });
      workspace.defer(() => guard.close());
    }
    const model = createOpenAIModel({ apiKey: 'synthetic-no-live-key',
      fetchImpl: (url, options) => { lastRequest = [url, options]; return guarded ? guard.cairnFetch(url, options) : fakeFetch(url, options); },
      onDiagnostic: event => {
        if (report.modelEvents.length < 64) report.modelEvents.push({ version: event.version,
          stage: event.stage, layer: event.layer, reason: event.reason });
        else report.modelEventsDropped += 1;
      } });
    const effectiveModel = injection === 'external-abort'
      ? { ...model, extract: args => model.extract({ ...args, signal: external.signal }) } : model;
    core = openMemoryCore({ path: join(workspace.path, 'memory.sqlite'), model: effectiveModel });
    workspace.defer(() => core.close());
    report.setupMs = performance.now() - setupStart;
    report.setupWork = validation.snapshot();
    validation.reset();
    const captureStart = performance.now();
    const capture = async () => {
      if (injection === 'prefix-tamper') {
        const db = new DatabaseSync(join(ledger.directory, 'experiment-budget.sqlite'));
        try { db.prepare("UPDATE attempts SET outcome = 'failed' WHERE rowid = 1").run(); }
        finally { db.close(); }
      }
      for (let ordinal = 0; ordinal < batches; ordinal++) {
        const result = await core.capture(captureInput(ordinal));
        const admitted = result.ok ? result.value.admission.memories : [];
        ids.push(...admitted.map(memory => memory.id));
        const classification = result.ok ? result.value.classification.status : 'unavailable';
        report.sourceOutcomes.push({ ordinal, ok: result.ok,
          code: result.ok ? 'completed' : result.error.code, admittedCount: admitted.length, classification });
        if (result.ok && classification === 'applied' && admitted.length === 1) report.completedBatches += 1;
        if (!result.ok || classification !== 'applied') break;
      }
      if (guard && guard.isHalted() && lastRequest) {
        const before = report.physicalRequests;
        await assert.rejects(guard.cairnFetch(...lastRequest), { code: 'paid_work_halted' });
        assert.equal(report.physicalRequests, before, 'global halt must fence every later physical request');
      }
    };
    if (guard) {
      // A prefix mismatch may throw at the final scope boundary as well as being
      // projected by core. Record only the known closed code, never an exception.
      try { await guard.withCaseScope({ phase: 'generation', caseId: 'synthetic-write' }, capture); }
      catch (error) {
        assert.equal(injection, 'prefix-tamper');
        assert.equal(error.code, 'policy_mismatch');
        report.scopeFailure = 'policy_mismatch';
      }
    } else await capture();
    report.captureMs = performance.now() - captureStart;
    report.captureWork = validation.snapshot();
    if (guard) {
      const state = guard.getState();
      if (injection !== 'prefix-tamper') assert.deepEqual(state.attempts.slice(0, historySize), prefix.attempts);
      assert.ok(state.requestCount <= state.requestCap);
      assert.ok(state.reservedMicroUsd <= state.limitMicroUsd);
      assert.equal(state.attempts.some(attempt => attempt.outcome === null), false, 'no owned request may remain pending');
      const owned = state.attempts.slice(historySize);
      assert.equal(owned.length, report.physicalRequests);
      for (const attempt of owned) if (attempt.outcome === 'unknown') {
        assert.equal(attempt.reservedMicroUsd, 5000);
        assert.equal(attempt.actualMicroUsd, null);
      }
      report.accounting = { requestCount: state.requestCount, reservedMicroUsd: state.reservedMicroUsd,
        halted: guard.isHalted(), pendingCount: owned.filter(attempt => attempt.outcome === null).length,
        attempts: attemptsProjection(guard.attempts()) };
      report.transport = guard.transportDiagnostics();
    }
    core.close();
    const reopened = openMemoryCore({ path: join(workspace.path, 'memory.sqlite') });
    workspace.defer(() => reopened.close());
    for (let ordinal = 0; ordinal < ids.length; ordinal++) {
      const detail = reopened.get({ namespace, memoryId: ids[ordinal] });
      assert.equal(detail.ok, true);
      report.sourceIntegrity &&= detail.value.memory.content === source(ordinal)
        && detail.value.receipts.length === 1 && detail.value.receipts[0].excerpt === source(ordinal)
        && detail.value.receipts[0].role === 'user';
      report.retainedCount += 1;
    }
    reportReady = true;
  } finally {
    await workspace.cleanup();
    report.cleanupRemoved = !existsSync(workspace.path);
    assert.equal(report.cleanupRemoved, true, 'every outcome must remove its owned fixture');
  }
  assert.equal(reportReady, true);
  const projected = JSON.stringify(report);
  for (const forbidden of ['synthetic-no-live-key', 'synthetic_injected_transport_failure',
    ...Array.from({ length: batches }, (_, ordinal) => source(ordinal))]) {
    assert.equal(projected.includes(forbidden), false, 'finite report must exclude source, key and raw exception markers');
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  assert.ok(args.every(arg => ['--expect-healthy', '--injection=none', '--injection=count-rejection'].includes(arg)));
  const injection = args.find(arg => arg.startsWith('--injection='))?.slice('--injection='.length) ?? 'none';
  const report = await runWriteDiagnostic({ injection, batches: 1 });
  console.log(JSON.stringify(report));
  // Identical health assertion/fixture/input; only the transport injection changes.
  if (args.includes('--expect-healthy')) assertHealthy(report);
}
