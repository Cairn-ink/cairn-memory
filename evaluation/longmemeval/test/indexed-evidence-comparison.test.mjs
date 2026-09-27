import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { captureSnapshot } from '../../../core/capture-input.mjs';
import { openMemoryCore } from '../../../core/contract.mjs';
import { createOpenAIModel } from '../../../adapters/openai/index.mjs';
import { experimentPolicy } from '../../live/session.mjs';
import { benchmarkStagePolicy } from '../../live/public-pilot.mjs';
import { mem0WireProfile } from '../../experiment-budget/mem0-wire.mjs';
import { authorizeMixedSourcePairCapability } from '../../experiment-budget/request-guard.mjs';
import { prepareMixedComparison, runMixedGeneration } from '../mixed-generation.mjs';
import { prepareMixedSourceCase } from '../mixed-source.mjs';
import { verifyMixedCapturePlan } from '../mixed-plan.mjs';
import { NATIVE_PROFILE, projectMixedResources } from '../mixed-resource.mjs';
import { ingestIndexedEvidenceLongMemEvalCase, ingestIndexedWindowLongMemEvalCase,
  planIndexedEvidenceLongMemEvalCase } from '../ingestion.mjs';
import { fakeMixedHttp, sourceRow, syntheticMixedFixture } from '../testing/mixed-fixture.mjs';

const comparisonProfile = 'indexed-evidence-v1';
const descriptors = { nativeArtifact: { sourceTreeSha256: '1'.repeat(64), dependencyLockSha256: '2'.repeat(64) },
  nativeConfiguration: { configurationSha256: '3'.repeat(64), configuration: {} },
  cairnRuntimeArtifactSha256: '4'.repeat(64) };

test('C1/C2 explicit profile binds new identities while source/comparator and omitted profile stay fixed', () => {
  const row = sourceRow();
  const options = { sourceCases: [row], armOrders: [['cairn', 'mem0']], ...descriptors };
  const old = prepareMixedComparison(options);
  const newer = prepareMixedComparison({ ...options, comparisonProfile });
  assert.equal(newer.schemaVersion, 'cairn-lme-mixed-indexed-evidence-preparation-v1');
  assert.equal(Object.hasOwn(old.manifest.cairn, 'comparisonProfile'), false);
  assert.equal(newer.manifest.cairn.qualificationInputProfile, 'not-requested');
  for (const key of ['contextProtocolSha256']) assert.notEqual(newer.manifest[key], old.manifest[key]);
  assert.notEqual(newer.manifest.cairn.adapterConfigurationSha256, old.manifest.cairn.adapterConfigurationSha256);
  assert.notEqual(newer.roster[0].protocolDigest, old.roster[0].protocolDigest);
  assert.deepEqual(newer.manifest.mem0, old.manifest.mem0);
  for (const key of ['sourceProtocolSha256', 'answerProtocolSha256', 'scorerProtocolSha256'])
    assert.equal(newer.manifest[key], old.manifest[key]);
  const oldPlan = prepareMixedSourceCase(row), newPlan = prepareMixedSourceCase(row, comparisonProfile);
  assert.deepEqual(newPlan.mem0Input, oldPlan.mem0Input);
  assert.deepEqual(newPlan.originMap, oldPlan.originMap);
  assert.deepEqual(newPlan.cairnPlan.batches[0].sourceMap, oldPlan.cairnPlan.batches[0].sourceMap);
  assert.equal(newPlan.caseDigest, oldPlan.caseDigest);
  assert.equal(newPlan.cairnPlan.batches[0].normalizedCapture.payloadDigest,
    captureSnapshot(newPlan.cairnPlan.batches[0].captureInput, undefined, comparisonProfile).payloadDigest);
  assert.throws(() => verifyMixedCapturePlan({ history: newPlan.renderedHistory, namespace: row.namespace,
    expectedPlan: oldPlan.cairnPlan, comparisonProfile }), { code: 'planner_mismatch' });
  for (const value of [undefined, null, 'indexed-windows-v1', 'qualified', 'indexed-evidence-v2'])
    assert.throws(() => prepareMixedComparison({ ...options, comparisonProfile: value }),
      { code: 'invalid_mixed_preparation' });
  const getter = { ...options };
  Object.defineProperty(getter, 'comparisonProfile', { enumerable: true, get() { assert.fail('getter'); } });
  assert.throws(() => prepareMixedComparison(getter), { code: 'invalid_mixed_preparation' });
});

test('C6 new resource ceiling removes qualifier work and retains all native fallback/old v3 arithmetic', () => {
  const options = { batchCounts: [1, 2, 0], policy: experimentPolicy(), stages: benchmarkStagePolicy(),
    wireProfile: mem0WireProfile(), nativeProfile: NATIVE_PROFILE,
    remainingMicroUsd: 76_204_507, protectedMicroUsd: 0 };
  const old = projectMixedResources(options), newer = projectMixedResources({ ...options, comparisonProfile });
  assert.equal(old.version, 'mixed-resource-projection-v3');
  assert.equal(newer.version, 'mixed-indexed-evidence-resource-projection-v1');
  assert.deepEqual(newer.conditionalCeilings.arms.mem0, old.conditionalCeilings.arms.mem0);
  const oldStages = old.conditionalCeilings.arms.cairn.stages;
  const newStages = newer.conditionalCeilings.arms.cairn.stages;
  assert.equal(Object.hasOwn(newStages, 'qualificationCount'), false);
  assert.equal(Object.hasOwn(newStages, 'qualificationGeneration'), false);
  for (const [name, value] of Object.entries(newStages)) assert.deepEqual(value, oldStages[name]);
  const removed = oldStages.qualificationCount.reservedMicroUsd + oldStages.qualificationGeneration.reservedMicroUsd;
  assert.equal(old.conditionalCeilings.joint.reservedMicroUsd - newer.conditionalCeilings.joint.reservedMicroUsd, removed);
  assert.throws(() => projectMixedResources({ ...options, comparisonProfile: undefined }),
    { code: 'invalid_resource_options' });
});

test('C1 new preparation cannot consume an old-profile guard or create a case store', async t => {
  const fixture = syntheticMixedFixture(t, { artifact: descriptors.nativeArtifact,
    configuration: descriptors.nativeConfiguration, sourceCases: [sourceRow()],
    armOrders: [['cairn', 'mem0']], fetchImpl: () => assert.fail('no HTTP') });
  try {
    const prepared = prepareMixedComparison({ sourceCases: [sourceRow()],
      armOrders: [['cairn', 'mem0']], ...descriptors, comparisonProfile });
    await assert.rejects(runMixedGeneration({ prepared, guard: fixture.guard,
      apiKey: 'synthetic-only', cairnStoreRoot: fixture.root }), { code: 'mixed_guard_mismatch' });
    assert.equal(fixture.guard.caseOutcomes().scopes.length, 0);
    assert.equal(fixture.guard.attempts().length, 0);
    assert.deepEqual(readdirSync(fixture.root), ['ledger']);
  } finally { fixture.guard.close(); }
});

test('C1/C3 mixed authorization rejects null, missing, unknown and cross-profile identities before claim', t => {
  const fixture = syntheticMixedFixture(t, { artifact: descriptors.nativeArtifact,
    configuration: descriptors.nativeConfiguration, sourceCases: [sourceRow()],
    armOrders: [['cairn', 'mem0']], comparisonProfile, fetchImpl: () => assert.fail('no HTTP') });
  try {
    const capability = fixture.capability;
    const configurations = [null, { ...capability.manifest.cairn, comparisonProfile: 'unknown' },
      { ...capability.manifest.cairn, qualificationInputProfile: 'adaptive-text-catalog-v1' },
      { ...capability.manifest.cairn, captureSourcePolicy: 'indexed-windows-v1' }];
    const missing = { ...capability.manifest.cairn }; delete missing.comparisonProfile;
    configurations.push(missing);
    for (const [index, cairn] of configurations.entries()) {
      assert.throws(() => authorizeMixedSourcePairCapability({ ledger: capability.ledger,
        policy: capability.policy, benchmarkExtension: capability.benchmarkExtension,
        authorizationId: `invalid-profile-${index}`, executionId: `invalid-profile-${index}`,
        checkpoint: capability.checkpoint, manifest: { ...capability.manifest, cairn },
        roster: capability.roster, limits: capability.limits }), { code: 'invalid_capability' });
    }
    assert.equal(fixture.guard.attempts().length, 0);
    assert.equal(fixture.guard.caseOutcomes().scopes.length, 0);
  } finally { fixture.guard.close(); }
});

test('C3 new authentic X profile denies qualifier count/generation before reservation or transport', async t => {
  const root = mkdtempSync(join(tmpdir(), 'cairn-indexed-route-control-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const fake = fakeMixedHttp(() => undefined, { cairnMemory: true });
  const row = sourceRow();
  const plan = prepareMixedSourceCase(row);
  const control = openMemoryCore({ path: join(root, 'control.db'),
    captureQualification: 'source-bound-v2', captureSourcePolicy: 'indexed-windows-v1',
    model: createOpenAIModel({ apiKey: 'synthetic-only', fetchImpl: fake.fetchImpl,
      qualificationInputMode: 'adaptive-text-catalog-v1' }) });
  try { assert.equal((await control.capture(plan.cairnPlan.batches[0].captureInput)).ok, true); }
  finally { control.close(); }
  for (const count of [true, false]) {
    const fixture = syntheticMixedFixture(t, { artifact: descriptors.nativeArtifact,
      configuration: descriptors.nativeConfiguration, sourceCases: [sourceRow()],
      armOrders: [['cairn', 'mem0']], comparisonProfile,
      fetchImpl: () => assert.fail('forbidden physical request') });
    try {
      assert.equal(fixture.capability.methodProfile, 'cairn-mem0-indexed-evidence-source-pair-v1');
      const body = fake.calls.find(call => call.route === (count ? '/v1/responses/input_tokens' : '/v1/responses')
        && call.body.text?.format.name === 'cairn_qualifyCandidates').body;
      await assert.rejects(fixture.guard.withCaseScope(fixture.capability.schedule[0], async () => {
        await assert.rejects(fixture.guard.cairnFetch(count ? experimentPolicy().cairnCount.endpoint
          : experimentPolicy().cairnGeneration.endpoint, { method: 'POST', redirect: 'error',
          headers: { 'content-type': 'application/json', authorization: 'Bearer synthetic-only' },
          body: JSON.stringify(body), signal: new AbortController().signal }), { code: 'unsupported_request' });
      }), { code: 'paid_work_halted' });
      assert.equal(fixture.guard.attempts().length, 0);
    } finally { fixture.guard.close(); }
  }
});

test('C2/C5 actual core ingestion requires exact evidence metadata; partial persists and blocks next batch', async t => {
  const root = mkdtempSync(join(tmpdir(), 'cairn-indexed-comparison-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const row = sourceRow();
  row.history.sessions[0].turns = Array.from({ length: 25 }, (_, index) => ({
    turn_id: `lme-turn-${index.toString(16).padStart(64, '0')}`, role: 'user', content: `Fact ${index}` }));
  const plan = planIndexedEvidenceLongMemEvalCase({ history: row.history, namespace: row.namespace });
  assert.equal(plan.batches.length, 2);
  const fake = fakeMixedHttp((_url, body) => {
    if (!_url.endsWith('/responses')) return;
    if (body.text?.format.name === 'cairn_classify') return response(body, { items: [{ memoryId: 'forged', parentIds: [] }] });
  }, { cairnMemory: true });
  const core = openMemoryCore({ path: join(root, 'store.db'), captureSourcePolicy: comparisonProfile,
    model: createOpenAIModel({ apiKey: 'synthetic-only', fetchImpl: fake.fetchImpl }) });
  try {
    const ingested = await ingestIndexedEvidenceLongMemEvalCase({ history: row.history, namespace: row.namespace,
      capture: input => core.capture(input) });
    assert.deepEqual(ingested.outcomes.map(item => item.status), ['partial', 'not_run']);
    assert.equal(ingested.outcomes[0].qualificationStatus, 'not-requested');
    assert.equal(core.list({ namespace: row.namespace, limit: 10 }).value.memories.length, 1);
    assert.equal(fake.calls.filter(item => item.route === '/v1/responses'
      && item.body.text?.format.name === 'cairn_extract').length, 1);
  } finally { core.close(); }
  const empty = { duplicate: false, admission: { memories: [], suppressedCount: 0, indexRevision: 1 },
    classification: { status: 'skipped', reason: 'empty' }, sourceWindowCatalog: plan.batches[0].sourceWindowCatalog };
  for (const value of [empty, { ...empty, qualificationStatus: 'qualified' },
    { ...empty, qualificationStatus: 'not-requested', extra: true }]) {
    const result = await ingestIndexedEvidenceLongMemEvalCase({ history: row.history, namespace: row.namespace,
      capture: () => ({ ok: true, value }) });
    assert.deepEqual(result.outcomes.map(item => item.status), ['unknown', 'not_run']);
  }
  const old = await ingestIndexedWindowLongMemEvalCase({ history: row.history, namespace: row.namespace,
    capture: () => ({ ok: true, value: { ...empty, qualificationStatus: 'not-requested' } }) });
  assert.equal(old.outcomes[0].status, 'unknown');
});

function response(body, output) {
  return Response.json({ object: 'response', model: body.model, status: 'completed',
    error: null, incomplete_details: null, output: [{ type: 'message', role: 'assistant',
      status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
    usage: { input_tokens: 100, output_tokens: 5, total_tokens: 105 } });
}

test('C7 cold evidence reads preserve correction, forgetting and exact namespace isolation', async t => {
  const root = mkdtempSync(join(tmpdir(), 'cairn-indexed-cold-control-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const row = sourceRow();
  row.history.sessions[0].turns[0].content = 'x'.repeat(850) + ' TAIL ORIGINAL SOURCE';
  const fake = fakeMixedHttp((url, body) => {
    if (url.endsWith('/responses') && body.text?.format.name === 'cairn_extract')
      return response(body, { items: [{ content: 'MODEL INTERPRETATION', kind: 'context',
        confidence: 0.9, sourceIndices: [1] }] });
  }, { cairnMemory: true });
  const pathname = join(root, 'store.db');
  let core = openMemoryCore({ path: pathname, captureSourcePolicy: comparisonProfile,
    model: createOpenAIModel({ apiKey: 'synthetic-only', fetchImpl: fake.fetchImpl }) });
  const ingested = await ingestIndexedEvidenceLongMemEvalCase({ history: row.history,
    namespace: row.namespace, capture: input => core.capture(input) });
  assert.equal(ingested.outcomes[0].status, 'completed');
  const id = ingested.outcomes[0].result.admission.memories[0].id;
  core.close();
  core = openMemoryCore({ path: pathname, captureSourcePolicy: comparisonProfile,
    model: createOpenAIModel({ apiKey: 'synthetic-only', fetchImpl: fake.fetchImpl }) });
  try {
    const detail = core.get({ namespace: row.namespace, memoryId: id }).value;
    assert.ok(detail.receipts[0].excerpt.includes('TAIL ORIGINAL SOURCE'));
    assert.equal(core.get({ namespace: { ...row.namespace, ownerId: 'other-owner' }, memoryId: id }).ok, false);
    const corrected = core.correct({ namespace: row.namespace, memoryId: id,
      expectedRevision: detail.memory.revision, content: 'Manual correction', kind: 'context',
      receipt: { client: 'manual', sessionId: 'manual', eventId: 'manual', role: 'user', excerpt: 'Manual correction' } });
    assert.equal(corrected.ok, true);
    const before = fake.calls.length;
    const replay = await ingestIndexedEvidenceLongMemEvalCase({ history: row.history,
      namespace: row.namespace, capture: input => core.capture(input) });
    assert.equal(replay.outcomes[0].status, 'duplicate');
    assert.equal(fake.calls.length, before);
    assert.equal(core.get({ namespace: row.namespace, memoryId: id }).value.memory.content, 'Manual correction');
    assert.equal(core.forget({ namespace: row.namespace, memoryId: id,
      expectedRevision: corrected.value.memory.revision }).ok, true);
    const forgotten = await ingestIndexedEvidenceLongMemEvalCase({ history: row.history,
      namespace: row.namespace, capture: input => core.capture(input) });
    assert.equal(forgotten.outcomes[0].status, 'duplicate');
    assert.equal(core.get({ namespace: row.namespace, memoryId: id }).ok, false);
    assert.equal(fake.calls.length, before);
  } finally { core.close(); }
});

test('C7 fifty real-core batches complete sequentially and retain every selected source identity without qualification', async t => {
  const root = mkdtempSync(join(tmpdir(), 'cairn-indexed-fifty-batches-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const row = sourceRow();
  row.history.sessions = Array.from({ length: 50 }, (_, index) => ({ session_index: index,
    session_id: `lme-session-${index.toString(16).padStart(64, '0')}`, date: `synthetic date ${index}`,
    turns: [{ turn_id: `lme-turn-${index.toString(16).padStart(64, '0')}`, role: 'user',
      content: `Synthetic selected source ${index}.` }] }));
  const fake = fakeMixedHttp(() => undefined, { cairnMemory: true });
  const core = openMemoryCore({ path: join(root, 'store.db'), captureSourcePolicy: comparisonProfile,
    model: createOpenAIModel({ apiKey: 'synthetic-only', fetchImpl: fake.fetchImpl }) });
  try {
    const result = await ingestIndexedEvidenceLongMemEvalCase({ history: row.history, namespace: row.namespace,
      capture: input => core.capture(input) });
    assert.equal(result.outcomes.length, 50);
    assert.ok(result.outcomes.every(item => item.status === 'completed'));
    assert.equal(fake.calls.filter(call => call.route === '/v1/responses'
      && call.body.text?.format.name === 'cairn_extract').length, 50);
    assert.equal(fake.calls.some(call => call.body.text?.format.name === 'cairn_qualifyCandidates'), false);
    const ids = new Set(result.outcomes.flatMap(item => item.result.admission.memories.map(memory => memory.id)));
    const receipts = [...ids].flatMap(memoryId => core.get({ namespace: row.namespace,
      memoryId, receiptLimit: 100 }).value.receipts);
    assert.deepEqual(new Set(receipts.map(receipt => receipt.eventId)),
      new Set(result.plan.batches.flatMap(batch => batch.sourceMap.map(source => source.messageId))));
    assert.equal(receipts.length, 50);
    for (let index = 0; index < 50; index++) assert.ok(receipts.some(receipt =>
      receipt.excerpt === `Synthetic selected source ${index}.`));
  } finally { core.close(); }
});
