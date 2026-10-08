import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { mem0NativeConfiguration } from '../../experiment-budget/mem0-native-gateway.mjs';
import { prepareMixedComparison, runMixedGeneration } from '../mixed-generation.mjs';
import { createMixedResultJournal, inspectMixedResultJournal } from '../mixed-result-journal.mjs';
import { scoreMixedGeneration } from '../mixed-scoring.mjs';
import { evaluatorRow, fakeMixedHttp, sourceRow, syntheticMixedFixture } from '../testing/mixed-fixture.mjs';
import { syntheticNativeDescriptors } from '../testing/result-journal-fixture.mjs';

const preparation = () => ({ sourceCases: [sourceRow('timeout')], armOrders: [['cairn', 'mem0']],
  nativeArtifact: { sourceTreeSha256: '1'.repeat(64), dependencyLockSha256: '2'.repeat(64) },
  nativeConfiguration: mem0NativeConfiguration({ topK: 6, threshold: 0,
    childTimeoutMs: 3_600_000, httpTimeoutMs: 10_000 }), cairnRuntimeArtifactSha256: '5'.repeat(64) });

// Clock control is isolated from other tests. We observe the actual timers
// scheduled by core and HTTP guard, and invoke their real callback; this is
// deterministic cooperative-timeout behavior, not a latency measurement.
async function childScenario(mode, parent) {
  const workspace = createTestWorkspace(null, { prefix: 'cairn-timeout-child-', parent });
  const set = globalThis.setTimeout, clear = globalThis.clearTimeout;
  const timers = [], timedOut = ['core-abort', 'http-abort'].includes(mode);
  let late, signal, output, intentionalFailure = false;
  try {
    let inheritedReads = 0;
    Object.defineProperty(Object.prototype, 'modelCallTimeoutMs', {
      configurable: true, get() { inheritedReads++; return 120_000; } });
    try {
      assert.throws(() => prepareMixedComparison(preparation()), { code: 'invalid_mixed_preparation' });
      assert.equal(inheritedReads, 0);
    } finally { delete Object.prototype.modelCallTimeoutMs; }
    const descriptors = syntheticNativeDescriptors(workspace.path);
    const normal = fakeMixedHttp(undefined, { cairnMemory: true });
    const fake = fakeMixedHttp((url, body, options) => {
      if (timedOut && url.endsWith('/responses') && body.text.format.name === 'cairn_extract') {
        signal = options.signal;
        const delay = mode === 'core-abort' ? 120_000 : 60_000;
        const timer = timers.findLast(value => value.active && value.delay === delay);
        assert.ok(timer, 'actual configured core/unchanged HTTP timer is scheduled');
        // Count has already completed on the same core clock. Only generation
        // remains pending; physical HTTP deliberately ignores the abort.
        queueMicrotask(() => { clear(timer.handle); timer.callback(); });
        return new Promise(resolve => { late = () => normal.fetchImpl(url, options).then(resolve); });
      }
    }, { cairnMemory: true });
    const fixture = syntheticMixedFixture(null, { ...descriptors,
      sourceCases: [sourceRow('timeout')], armOrders: [['cairn', 'mem0']],
      fetchImpl: fake.fetchImpl, workspace,
      ...(mode === 'qualified' ? {} : { comparisonProfile: 'indexed-evidence-v1' }),
      ...(mode === 'default' ? {} : { modelCallTimeoutMs: 120_000 }) });
    const nativeScope = fixture.prepared.roster[0].arms.find(arm => arm.name === 'mem0').scopeId;
    const guard = { ...fixture.guard, withCaseScope(identity, operation) {
      return fixture.guard.withCaseScope(identity, identity.caseId === nativeScope
        ? handle => { handle.revoke(); return operation(handle); } : operation);
    } };
    const before = fixture.guard.getState();
    const drift = structuredClone(fixture.capability);
    drift.manifest.cairn.modelCallTimeoutMs = 1;
    // Even refused run attempts consume their preparation identity. Use a
    // separate authentic preparation for this denial, not a retry of it.
    const driftPrepared = prepareMixedComparison({ sourceCases: [sourceRow('timeout')],
      armOrders: [['cairn', 'mem0']], nativeArtifact: descriptors.artifact,
      nativeConfiguration: descriptors.configuration, cairnRuntimeArtifactSha256: '5'.repeat(64),
      ...(mode === 'qualified' ? {} : { comparisonProfile: 'indexed-evidence-v1' }),
      ...(mode === 'default' ? {} : { modelCallTimeoutMs: 120_000 }) });
    await assert.rejects(runMixedGeneration({ prepared: driftPrepared,
      guard: { ...guard, mixedSourcePairCapability: drift }, apiKey: 'synthetic-only',
      cairnStoreRoot: fixture.root }), { code: 'mixed_guard_mismatch' });
    await assert.rejects(runMixedGeneration({ prepared: fixture.prepared, guard,
      apiKey: 'synthetic-only', cairnStoreRoot: fixture.root, modelCallTimeoutMs: 1 }),
    { code: 'invalid_mixed_generation' });
    assert.deepEqual(fixture.guard.getState(), before);
    assert.equal(fake.calls.length, 0);
    const directory = join(workspace.path, 'journal');
    const resultJournal = createMixedResultJournal({ directory, prepared: fixture.prepared });
    globalThis.setTimeout = (callback, delay, ...args) => {
      const handle = set(callback, delay, ...args);
      timers.push({ callback, delay, handle, active: true });
      return handle;
    };
    globalThis.clearTimeout = handle => {
      const timer = timers.find(value => value.handle === handle);
      if (timer) timer.active = false;
      return clear(handle);
    };
    const report = await runMixedGeneration({ prepared: fixture.prepared, guard,
      apiKey: 'PRIVATE_N33_KEY_CANARY', cairnStoreRoot: fixture.root, resultJournal,
      recallWitness: 'bounded-lineage-v2' });
    globalThis.setTimeout = set;
    globalThis.clearTimeout = clear;
    const arm = report.cases[0].arms[0];
    const retained = inspectMixedResultJournal({ directory });
    assert.equal(retained.identity.manifest.cairn.modelCallTimeoutMs,
      mode === 'default' ? undefined : 120_000);
    assert.equal(arm.diagnostics.recallWitness.disposed, true);
    assert.equal(arm.diagnostics.recallWitness.lineage.version, 2);
    assert.deepEqual(retained.phases.generation.arms[0].result.diagnostics.recallWitness,
      arm.diagnostics.recallWitness);
    const expectedCore = mode === 'default' ? 30_000 : 120_000;
    const coreTimers = timers.filter(timer => timer.delay === expectedCore);
    assert.ok(coreTimers.length > 0, 'actual constructor value reaches callModel scheduling');
    assert.equal(timers.some(timer => timer.delay === 60_000), true, 'HTTP cap unchanged');
    if (mode !== 'default') assert.equal(timers.some(timer => timer.delay === 30_000), false);
    if (timedOut) {
      assert.equal(coreTimers.length, 1, 'count + generation share one core clock');
      assert.equal(signal.aborted, true);
      assert.notEqual(arm.status, 'completed');
      const count = fake.calls.length, settled = fixture.guard.getState();
      assert.equal(count, 2, 'one count and one generation, no retry');
      assert.equal(settled.attempts.filter(attempt => attempt.outcome === null).length, 0);
      assert.equal(settled.attempts.at(-1).outcome, 'unknown');
      if (mode === 'core-abort') {
        assert.ok(arm.diagnostics.modelDiagnostics.events.some(event =>
          event.stage === 'extract' && event.layer === 'core_call' && event.reason === 'model_timeout'));
      }
      await late();
      await new Promise(resolve => set(resolve, 0));
      assert.equal(fake.calls.length, count);
      assert.deepEqual(fixture.guard.getState(), settled, 'late output cannot settle twice');
      const folder = readdirSync(workspace.path).find(name => name.startsWith('mixed-cairn-'));
      const db = new DatabaseSync(join(workspace.path, folder, 'store.db'), { readOnly: true });
      workspace.defer(() => db.close());
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM memories').get().n, 0,
        'late extraction cannot admit memory');
    } else {
      assert.equal(arm.status, 'completed');
      assert.equal(arm.answer.text, 'Synthetic memory fact.');
      assert.equal(arm.diagnostics.recallWitness.lineage.status, 'available');
    }
    const scored = await scoreMixedGeneration({ generationReport: report,
      evaluatorRows: [evaluatorRow('timeout')], referenceRenderings: undefined,
      guard, apiKey: 'synthetic-only', resultJournal });
    assert.equal(scored.summary.fixedN, 1);
    assert.equal(scored.summary.perArm.cairn[timedOut ? 'unresolved' : 'correct'], 1);
    assert.equal(scored.summary.perArm.mem0.unresolved, 1);
    assert.ok(inspectMixedResultJournal({ directory }).phases.scoring.completion);
    output = { routes: fake.calls.map(call => call.route), coreTimers: coreTimers.length,
      httpTimers: timers.filter(timer => timer.delay === 60_000).length,
      cairnStatus: arm.status, fixedN: scored.summary.fixedN,
      extractionWireDigests: fake.calls.slice(0, 2).map(call =>
        createHash('sha256').update(call.bytes).digest('hex')) };
    if (mode === 'assertion-failure') { intentionalFailure = true; assert.fail('owned control'); }
  } catch (error) {
    if (!intentionalFailure) throw error;
    process.exitCode = 1;
  } finally {
    globalThis.setTimeout = set;
    globalThis.clearTimeout = clear;
    await workspace.cleanup();
  }
  assert.equal(existsSync(workspace.path), false);
  console.log(JSON.stringify({ ...output, intentionalFailure,
    remainingOwnedEntries: readdirSync(parent).length }));
}

if (process.argv[2] === '--n33-child') {
  await childScenario(process.argv[3], process.argv[4]);
} else {
test('T1 omitted preparation retains exact legacy protocol/configuration digests', () => {
  const { manifest } = prepareMixedComparison(preparation());
  assert.equal(Object.hasOwn(manifest.cairn, 'modelCallTimeoutMs'), false);
  assert.equal(manifest.contextProtocolSha256, '5e78df32e8179e3cd7bcb3cc011492ceebf2c9bcfc4a4976bb30763647e88966');
  assert.equal(manifest.cairn.adapterConfigurationSha256, '429095f37fadb7d7b606da51f8180dbc89959e2930633702c7e7846e77abcf6a');
  assert.equal(manifest.answerProtocolSha256, '689c2a63996ff766e5476cf5e4ec0918847b6355575597efec7abb29897f3b93');
  assert.equal(manifest.scorerProtocolSha256, '03752c34f7c97022d013748188b6ffeddf08135af6ec1ae0a046ed1256ed87ec');
});

test('T1/T2 explicit timeout is immutable and binds context, adapter and case protocols only', () => {
  const legacy = prepareMixedComparison(preparation());
  const options = { ...preparation(), modelCallTimeoutMs: 120_000 };
  const prepared = prepareMixedComparison(options);
  options.modelCallTimeoutMs = 1;
  assert.equal(prepared.manifest.cairn.modelCallTimeoutMs, 120_000);
  assert.equal(Object.isFrozen(prepared.manifest.cairn), true);
  assert.notEqual(prepared.manifest.contextProtocolSha256, legacy.manifest.contextProtocolSha256);
  assert.notEqual(prepared.manifest.cairn.adapterConfigurationSha256, legacy.manifest.cairn.adapterConfigurationSha256);
  assert.notEqual(prepared.roster[0].protocolDigest, legacy.roster[0].protocolDigest);
  for (const key of ['sourceProtocolSha256', 'answerProtocolSha256', 'scorerProtocolSha256', 'mem0']) {
    assert.deepEqual(prepared.manifest[key], legacy.manifest[key]);
  }
  for (const value of [1, 30_000, 120_000]) {
    assert.equal(prepareMixedComparison({ ...preparation(), modelCallTimeoutMs: value })
      .manifest.cairn.modelCallTimeoutMs, value);
  }
});

test('T1 malformed, hidden, accessor, inherited and unknown options reject without getters', () => {
  let reads = 0;
  const bad = [undefined, null, 0, -1, 120_001, 1.5, NaN, Infinity, '120000',
    { valueOf() { reads++; return 120_000; } }];
  for (const modelCallTimeoutMs of bad) {
    assert.throws(() => prepareMixedComparison({ ...preparation(), modelCallTimeoutMs }),
      { code: 'invalid_mixed_preparation' });
  }
  for (const descriptor of [{ get() { reads++; return 120_000; }, enumerable: true },
    { value: 120_000, enumerable: false }]) {
    const options = preparation();
    Object.defineProperty(options, 'modelCallTimeoutMs', descriptor);
    assert.throws(() => prepareMixedComparison(options), { code: 'invalid_mixed_preparation' });
  }
  const inherited = Object.assign(Object.create({ get modelCallTimeoutMs() {
    reads++; return 120_000;
  } }), preparation());
  assert.throws(() => prepareMixedComparison(inherited), { code: 'invalid_mixed_preparation' });
  assert.throws(() => prepareMixedComparison({ ...preparation(), timeoutMs: 120_000 }),
    { code: 'invalid_mixed_preparation' });
  assert.equal(reads, 0);
});

test('T2 journal rejects malformed timeout before publication without invoking accessors', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-timeout-journal-invalid-' });
  let reads = 0;
  for (const value of [undefined, 0, 120_001, '120000']) {
    const prepared = structuredClone(prepareMixedComparison(preparation()));
    prepared.manifest.cairn.modelCallTimeoutMs = value;
    assert.throws(() => createMixedResultJournal({ directory: join(workspace.path, 'journal'), prepared }),
      { code: 'invalid_mixed_result_journal' });
    assert.deepEqual(readdirSync(workspace.path), []);
  }
  const prepared = structuredClone(prepareMixedComparison(preparation()));
  Object.defineProperty(prepared.manifest.cairn, 'modelCallTimeoutMs', {
    enumerable: true, get() { reads++; return 120_000; } });
  assert.throws(() => createMixedResultJournal({ directory: join(workspace.path, 'journal'), prepared }));
  assert.equal(reads, 0);
  await workspace.cleanup();
  assert.equal(existsSync(workspace.path), false);
});

test('T2–T5 real mixed core/adapter/guard timers, late fence, lineage and journal/scoring compose', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-mixed-timeout-subprocess-' });
  const observations = [];
  for (const mode of ['default', 'configured', 'qualified', 'core-abort', 'http-abort', 'assertion-failure']) {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--n33-child', mode,
      workspace.path], { env: { PATH: '/usr/bin:/bin', TMPDIR: workspace.path,
        NODE_DISABLE_COMPILE_CACHE: '1' }, encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024 });
    assert.equal(child.error, undefined);
    assert.equal(child.signal, null);
    assert.equal(child.status, mode === 'assertion-failure' ? 1 : 0, `${mode}: ${child.stdout} ${child.stderr}`);
    const result = JSON.parse(child.stdout.trim());
    assert.equal(result.remainingOwnedEntries, 0);
    assert.deepEqual(readdirSync(workspace.path), []);
    assert.equal(result.intentionalFailure, mode === 'assertion-failure');
    observations.push(result);
  }
  assert.deepEqual(observations[0].routes, observations[1].routes,
    'explicit timeout adds no pass or request and preserves provider order');
  assert.deepEqual(observations[0].extractionWireDigests, observations[1].extractionWireDigests,
    'timeout configuration does not rewrite counted or generated extraction payload');
  await workspace.cleanup();
  assert.equal(existsSync(workspace.path), false);
});
}
