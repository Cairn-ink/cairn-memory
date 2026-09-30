// Explicit installed-native diagnostic: synthetic HTTP only; prerequisites fail, never skip.
import assert from 'node:assert/strict';
import test from 'node:test';

import { inspectMem0NativeArtifact } from '../../experiment-budget/mem0-native-artifact.mjs';
import { mem0NativeConfiguration } from '../../experiment-budget/mem0-native-gateway.mjs';
import { runMixedGeneration } from '../mixed-generation.mjs';
import { fakeMixedHttp, sourceRow, syntheticMixedFixture } from './mixed-fixture.mjs';

test('D1–D4 installed native embedding failure accounting and provenance gap', async t => {
  const artifact = inspectMem0NativeArtifact({
    venvRoot: process.env.CAIRN_MEM0_NATIVE_VENV_ROOT,
    pythonRoot: process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT });
  // X owns the real deadline; the fake transport only waits for its abort signal.
  const httpTimeoutMs = 1_000;
  const configuration = mem0NativeConfiguration({ topK: 6, threshold: 0,
    childTimeoutMs: 3_600_000, httpTimeoutMs });
  const requireClassification = process.env.CAIRN_NATIVE_FAILURE_REQUIRE_CLASSIFICATION === '1';
  const variants = requireClassification ? ['transport-throw', 'malformed-embedding']
    : ['transport-throw', 'malformed-embedding', 'deadline', 'definite-503'];
  const observations = [];
  for (const variant of variants) {
    let injected = 0, physicalPending = 0, deadlineAborted = false, fixture;
    const fake = fakeMixedHttp((url, _body, options) => {
      if (!url.endsWith('/embeddings') || fixture.guard.caseScopeSnapshot()?.ordinal !== 0)
        return undefined;
      injected++;
      if (variant === 'transport-throw') throw Error('SYNTHETIC_TRANSPORT_SENTINEL');
      if (variant === 'malformed-embedding') return new Response('{}');
      if (variant === 'definite-503') return new Response('{}', { status: 503 });
      assert.equal(options.signal.aborted, false, 'deadline must not be injected already aborted');
      physicalPending++;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          deadlineAborted = true;
          physicalPending--;
          reject(Error('SYNTHETIC_ABORT_SENTINEL'));
        }, { once: true });
      });
    });
    fixture = syntheticMixedFixture(t, { artifact, configuration, httpTimeoutMs,
      sourceCases: [sourceRow('diagnostic_first'), sourceRow('diagnostic_later')],
      armOrders: [['mem0', 'cairn'], ['cairn', 'mem0']], fetchImpl: fake.fetchImpl });
    const start = performance.now();
    try {
      const report = await runMixedGeneration({ prepared: fixture.prepared, guard: fixture.guard,
        apiKey: 'synthetic-only', cairnStoreRoot: fixture.root });
      const attempts = fixture.guard.attempts();
      const ledger = fixture.guard.getState();
      const first = report.cases[0].arms.find(arm => arm.name === 'mem0');
      const later = [report.cases[0].arms.find(arm => arm.name === 'cairn'),
        ...report.cases[1].arms];
      const embedding = attempts.find(attempt => attempt.stage === 'mem0-embedding');
      assert.ok(injected > 0, 'real installed Mem0 must reach the injected embedding route');
      assert.ok(embedding);
      const expectedTermination = { 'transport-throw': 'transport_failure',
        'malformed-embedding': 'invalid_response', deadline: 'deadline',
        'definite-503': 'http_failure' }[variant];
      assert.equal(embedding.transportTermination, expectedTermination);
      assert.equal(first.diagnostics.attempts.stages[0].transportTermination, expectedTermination);
      assert.equal(first.diagnostics.attempts.terminationCounts[expectedTermination], 1);
      assert.equal(first.diagnostics.attempts.terminationUnavailableCount, 0);
      assert.equal(attempts.filter(attempt => attempt.outcome === null).length, 0);
      assert.equal(ledger.attempts.filter(attempt => attempt.outcome === null).length, 0);
      assert.equal(physicalPending, 0, 'fake physical transport must settle before handoff');
      assert.ok(embedding.reservedMicroUsd > 0);
      assert.equal(embedding.actualMicroUsd, null);
      const durable = ledger.attempts.find(attempt => attempt.attemptId === embedding.attemptId);
      assert.equal(durable.outcome, embedding.outcome);
      assert.equal(durable.reservedMicroUsd, embedding.reservedMicroUsd,
        'unknown or failed embedding retains the entire original reservation');
      assert.equal(durable.actualMicroUsd, null);
      if (['transport-throw', 'malformed-embedding'].includes(variant)) {
        assert.equal(injected, 1, 'minimal global trigger is one physical embedding request');
        assert.equal(embedding.outcome, 'unknown');
        assert.equal(report.halted, true);
        assert.equal(report.haltReason, 'scope_execution_failed');
        assert.equal(fixture.guard.isHalted(), true);
        assert.equal(first.status, 'failed');
        assert.ok(later.every(arm => arm.status === 'blocked'
          && arm.reason === 'scope_execution_failed'));
        assert.equal(attempts.some(attempt => attempt.ordinal > 0), false);
      } else {
        assert.equal(report.halted, false);
        assert.equal(fixture.guard.isHalted(), false);
        assert.equal(first.status, 'failed');
        assert.ok(later.every(arm => arm.status === 'completed'), 'later arm and case must execute');
        assert.equal(first.scope.reason, variant === 'deadline'
          ? 'deadline' : 'embedding_singleton_failed');
        assert.equal(embedding.outcome, variant === 'deadline' ? 'unknown' : 'failed');
        assert.equal(deadlineAborted, variant === 'deadline');
      }
      // Compare only retained, content-free runtime provenance. Injection labels,
      // elapsed times, identifiers, request/response bodies and error text cannot
      // manufacture distinction between two otherwise identical failure records.
      const provenance = { halted: report.halted, haltReason: report.haltReason,
        armReason: first.reason, scope: first.scope, diagnostics: first.diagnostics,
        guardHalted: fixture.guard.isHalted(),
        scopeOutcomes: fixture.guard.caseOutcomes().scopes,
        stages: attempts.filter(attempt => attempt.ordinal === 0).map(attempt => ({
          stage: attempt.stage, outcome: attempt.outcome,
          reservedMicroUsd: attempt.reservedMicroUsd, actualMicroUsd: attempt.actualMicroUsd,
          transportTermination: attempt.transportTermination,
          settlementFailure: attempt.settlementFailure ?? null })) };
      assert.equal(JSON.stringify(provenance).includes('SENTINEL'), false);
      observations.push({ variant, provenance });
      t.diagnostic(JSON.stringify({ variant, durationMs: Math.round(performance.now() - start),
        injected, pending: 0, physicalPending, deadlineAborted, ...provenance,
        laterStatuses: later.map(arm => arm.status) }));
    } finally { fixture.guard.close(); }
  }
  const compared = observations.filter(row => row.variant !== 'definite-503');
  const distinct = new Set(compared.map(row => JSON.stringify(row.provenance))).size;
  t.diagnostic(`provenance classes retained=${distinct}/${compared.length}`);
  assert.equal(distinct, compared.length,
    'provenance gap: transport throw and malformed embedding must be safely distinguishable');
});
