// Synthetic-only preparation/authority/core navigation and durable identity.
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { authorizeMixedSourcePairCapability, createMixedSourcePairExperimentRequestGuard }
  from '../../experiment-budget/request-guard.mjs';
import { disconnectChild } from '../../experiment-budget/testing/native-settled-disconnect-fixture.mjs';
import { experimentPolicy } from '../../live/session.mjs';
import { benchmarkStagePolicy } from '../../live/public-pilot.mjs';
import { mem0WireProfile } from '../../experiment-budget/mem0-wire.mjs';
import { prepareMixedComparison, runMixedGeneration } from '../mixed-generation.mjs';
import { NATIVE_PROFILE, projectMixedResources } from '../mixed-resource.mjs';
import { createMixedResultJournal, inspectMixedResultJournal, startMixedJournalPhase } from '../mixed-result-journal.mjs';
import { canonical, hash } from '../mixed-validation.mjs';
import { fakeMixedHttp, sourceRow, syntheticMixedFixture } from '../testing/mixed-fixture.mjs';
import { syntheticNativeDescriptors } from '../testing/result-journal-fixture.mjs';

const navigationLabelPolicy = 'rare-query-window-v1';
const comparisonProfile = 'indexed-evidence-v1';
const descriptors = { nativeArtifact: { sourceTreeSha256: '1'.repeat(64), dependencyLockSha256: '2'.repeat(64) },
  nativeConfiguration: { configurationSha256: '3'.repeat(64), configuration: {} },
  cairnRuntimeArtifactSha256: '4'.repeat(64) };
const prepareOptions = () => ({ sourceCases: [sourceRow()], armOrders: [['cairn', 'mem0']], ...descriptors });
const resourceOptions = () => ({ batchCounts: [1, 2, 0], policy: experimentPolicy(), stages: benchmarkStagePolicy(),
  wireProfile: mem0WireProfile(), nativeProfile: NATIVE_PROFILE, remainingMicroUsd: 76_204_507, protectedMicroUsd: 0 });
const sha = value => createHash('sha256').update(canonical(value)).digest('hex');
const response = (body, output) => Response.json({ object: 'response', model: body.model,
  status: 'completed', error: null, incomplete_details: null,
  output: [{ type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
  usage: { input_tokens: 100, output_tokens: 5, total_tokens: 105 } });
const ref = item => item.type === 'unfiled' ? item.ref
  : { memoryId: item.ref.childId, revision: item.ref.childRevision };

test('P2 pre-edit legacy and indexed omitted projection goldens', () => {
  const values = [undefined, comparisonProfile].map(profile => {
    const options = profile ? { comparisonProfile: profile } : {};
    const prepared = prepareMixedComparison({ ...prepareOptions(), ...options });
    const resource = projectMixedResources({ ...resourceOptions(), ...options });
    assert.equal(Object.hasOwn(prepared.manifest.cairn, 'navigationLabelPolicy'), false);
    assert.equal(Object.hasOwn(resource, 'navigationLabelPolicy'), false);
    return { preparation: sha(prepared), resource: sha(resource), manifest: sha(prepared.manifest) };
  });
  // Literal canonical SHA256 receipts from unchanged base, not post-edit calls.
  assert.deepEqual(values, [
    { preparation: '79a8a61e6fae4fb836bc07e5ad333888c5c01a0e8481d79d40002f4788fffb22',
      resource: '0e833baca300fed842dfb247f0cea7ac9ce975ecec1d64f91561f1de084dc9c5',
      manifest: '9140cece8e2b656ea14c5239a02f2ece40bd6d6a06ec4892c19b8730011d3f31' },
    { preparation: '51837f6f3dde5350c43a25194a5bf122f4ed00b39376bce8d9b12e7d12f18d80',
      resource: 'cadc46858a2d52474ea9d8ffa07f7dfc81ba491700629e80361a3dd1b54781a1',
      manifest: '57a1ed8d717fd51c73863d01f6c91115269b5b7f2fedf78c8ff47e0cd7f98aca' },
  ]);
});

function syntheticGrant(t, workspace, native, row, fake, policy) {
  const old = syntheticMixedFixture(null, { ...native, sourceCases: [row], armOrders: [['cairn', 'mem0']],
    comparisonProfile, fetchImpl: fake.fetchImpl, workspace });
  if (!policy) return old;
  old.guard.close();
  const prepared = prepareMixedComparison({ sourceCases: [row], armOrders: [['cairn', 'mem0']],
    nativeArtifact: native.artifact, nativeConfiguration: native.configuration,
    cairnRuntimeArtifactSha256: '5'.repeat(64), comparisonProfile, navigationLabelPolicy: policy });
  assert.deepEqual(prepared.manifest.mem0, old.prepared.manifest.mem0);
  assert.deepEqual(prepared.counts, old.prepared.counts);
  const prior = old.capability;
  const config = { ledger: prior.ledger, policy: prior.policy, benchmarkExtension: prior.benchmarkExtension,
    checkpoint: prior.checkpoint, manifest: prepared.manifest, roster: prepared.roster, limits: prior.limits };
  const capability = authorizeMixedSourcePairCapability({ ...config,
    authorizationId: 'synthetic-navigation-authorization', executionId: 'synthetic-navigation-execution' });
  for (const key of ['limits', 'policy', 'benchmarkExtension', 'checkpoint', 'schedule'])
    assert.deepEqual(capability[key], prior[key], `${key} unchanged by label policy`);
  const guard = createMixedSourcePairExperimentRequestGuard({ ledger: config.ledger, policy: config.policy,
    benchmarkExtension: config.benchmarkExtension, mixedSourcePairCapability: capability, fetchImpl: fake.fetchImpl });
  workspace.defer(() => guard.close());
  return { ...old, prepared, capability, guard };
}

async function actualNavigation(t, policy) {
  const workspace = createTestWorkspace(null, { prefix: 'cairn-mixed-navigation-' });
  const resources = [], children = [], roots = [], selectInputs = [];
  let launchMock, killMock;
  try {
    const native = syntheticNativeDescriptors(workspace.path);
    const row = sourceRow();
    const common = 'what when how did the does a before after', anchor = 'Kivu tomorrow';
    row.question.text = `${common} ${anchor}`;
    const excerpts = [common, `${'what when how '.repeat(25)}${'padding '.repeat(20)}${anchor}`];
    // >12 candidates avoids the existing complete-map shortcut and really selects.
    row.history.sessions = Array.from({ length: 3 }, (_, sessionIndex) => ({
      session_index: sessionIndex, session_id: `lme-session-${String(sessionIndex + 1).repeat(64)}`,
      date: '2024/01/01 (Mon) 09:00', turns: excerpts.map((content, index) => ({
        turn_id: `lme-turn-${(sessionIndex * 2 + index).toString(16).padStart(64, '0')}`, role: 'user', content })) }));
    let extraction = 0;
    const fake = fakeMixedHttp((url, body) => {
      if (!url.endsWith('/responses')) return;
      const kind = body.text?.format.name, input = JSON.parse(body.input[0].content[0].text);
      if (kind === 'cairn_extract') {
        const batch = extraction++;
        return response(body, { items: [
          ...(batch === 0 ? [{ content: 'Kivu interpretation', kind: 'context', confidence: 0.9, sourceIndices: [0, 1] }] : []),
          ...Array.from({ length: batch === 0 ? 4 : 5 }, (_, index) => ({ content: `${common} distractor ${batch}-${index}`,
            kind: 'context', confidence: 0.9, sourceIndices: [0] }))] });
      }
      if (kind === 'cairn_select') {
        selectInputs.push(input);
        return response(body, { refs: input.maps.flatMap(page => page.items
          .filter(item => item.label.includes(anchor)).slice(0, 1)
          .map(item => ({ namespaceIndex: page.namespaceIndex, ...ref(item) }))) });
      }
    }, { cairnMemory: true });
    const fixture = syntheticGrant(t, workspace, native, row, fake, policy);
    const originalSpawn = childProcess.spawn, originalKill = process.kill;
    launchMock = t.mock.method(childProcess, 'spawn', function(command, args, options) {
      if (command !== 'bwrap') return originalSpawn.call(this, command, args, options);
      const socket = args[args.indexOf('/case/gateway.sock') - 1];
      roots.push(join(socket, '..'));
      const child = disconnectChild(socket, { mode: 'healthy', resources }); children.push(child); return child;
    });
    killMock = t.mock.method(process, 'kill', function(pid, signal) {
      if (pid !== -987654) return originalKill.call(this, pid, signal);
      if (signal === 0) { const error = new Error('synthetic group absent'); error.code = 'ESRCH'; throw error; }
      children.at(-1).stop(); return true;
    });
    syncBuiltinESMExports();
    const directory = join(workspace.path, 'journal');
    const journal = createMixedResultJournal({ directory, prepared: fixture.prepared });
    const report = await runMixedGeneration({ prepared: fixture.prepared, guard: fixture.guard,
      apiKey: 'synthetic-only', cairnStoreRoot: fixture.root, resultJournal: journal });
    assert.equal(report.halted, false);
    assert.ok(report.cases[0].arms.every(arm => arm.status === 'completed'));
    assert.ok(selectInputs.length > 0, 'actual adapter select request reached fake HTTP');
    const labels = selectInputs.flatMap(input => input.maps.flatMap(page => page.items.map(item => item.label)));
    assert.equal(labels.some(label => label.includes(anchor)), Boolean(policy), 'manifest-authorized policy reaches actual core select labels');
    assert.ok(labels.every(label => [...label].length <= 120));
    assert.equal(fake.calls.some(call => call.body.text?.format?.name === 'cairn_qualifyCandidates'), false);
    assert.ok(fixture.guard.attempts().every(attempt => attempt.outcome === 'succeeded'));
    assert.ok(roots.every(root => !fs.existsSync(root)));
    assert.ok(children.every(child => child.stdout.readableEnded));
    assert.deepEqual(inspectMixedResultJournal({ directory }).phases.generation.completion.report, report);
    return { selectInputs, manifest: fixture.prepared.manifest, capability: fixture.capability };
  } finally {
    for (const resource of resources) resource.destroy();
    await Promise.allSettled(children.map(child => child.operation));
    launchMock?.mock.restore(); killMock?.mock.restore(); syncBuiltinESMExports();
    await workspace.cleanup(); assert.equal(fs.existsSync(workspace.path), false);
  }
}

test('P1 explicit mixed policy reaches actual core labels through grant and fake HTTP', async t => {
  const baseline = await actualNavigation(t);
  const experiment = await actualNavigation(t, navigationLabelPolicy);
  assert.equal(baseline.capability.methodProfile, 'cairn-mem0-indexed-evidence-source-pair-v1');
  assert.notEqual(experiment.capability.methodProfile, baseline.capability.methodProfile);
});

test('P3 strict preparation/resource values and getter rejection before source work', () => {
  let reads = 0;
  for (const value of [undefined, null, false, 'other']) {
    assert.throws(() => prepareMixedComparison({ ...prepareOptions(), comparisonProfile,
      navigationLabelPolicy: value }), { code: 'invalid_mixed_preparation' });
    assert.throws(() => projectMixedResources({ ...resourceOptions(), comparisonProfile,
      navigationLabelPolicy: value }), value === undefined
      ? { code: 'invalid_resource_options' } : { code: 'unsupported_resource_profile' });
  }
  assert.throws(() => prepareMixedComparison({ ...prepareOptions(), navigationLabelPolicy }),
    { code: 'invalid_mixed_preparation' });
  assert.throws(() => projectMixedResources({ ...resourceOptions(), navigationLabelPolicy }),
    { code: 'unsupported_resource_profile' });
  for (const [call, options, code] of [
    [prepareMixedComparison, { ...prepareOptions(), comparisonProfile }, 'invalid_mixed_preparation'],
    [projectMixedResources, { ...resourceOptions(), comparisonProfile }, 'invalid_resource_options'],
  ]) {
    Object.defineProperty(options, 'navigationLabelPolicy', { enumerable: true,
      get() { reads++; throw Error('synthetic getter forbidden'); } });
    assert.throws(() => call(options), { code });
  }
  assert.equal(reads, 0);
});

test('P2/P3 omission ignores inherited policy without changing baseline hashes or core path', async t => {
  const prior = Object.getOwnPropertyDescriptor(Object.prototype, 'navigationLabelPolicy');
  let reads = 0;
  try {
    Object.defineProperty(Object.prototype, 'navigationLabelPolicy', { configurable: true,
      get() { reads++; throw Error('synthetic inherited getter forbidden'); } });
    const prepared = prepareMixedComparison({ ...prepareOptions(), comparisonProfile });
    assert.equal(sha(prepared), '51837f6f3dde5350c43a25194a5bf122f4ed00b39376bce8d9b12e7d12f18d80');
    const result = await actualNavigation(t);
    assert.equal(Object.hasOwn(result.manifest.cairn, 'navigationLabelPolicy'), false);
    assert.equal(reads, 0);
  } finally {
    if (prior) Object.defineProperty(Object.prototype, 'navigationLabelPolicy', prior);
    else delete Object.prototype.navigationLabelPolicy;
  }
});

test('P4 new context/roster/resource identity preserves source/native/adapter and every ceiling', () => {
  const old = prepareMixedComparison({ ...prepareOptions(), comparisonProfile });
  const newer = prepareMixedComparison({ ...prepareOptions(), comparisonProfile, navigationLabelPolicy });
  assert.deepEqual(newer.counts, old.counts);
  assert.deepEqual(newer.preflight, old.preflight);
  assert.deepEqual(newer.manifest.mem0, old.manifest.mem0);
  for (const key of ['sourceProtocolSha256', 'answerProtocolSha256', 'scorerProtocolSha256'])
    assert.equal(newer.manifest[key], old.manifest[key]);
  assert.equal(newer.manifest.cairn.adapterConfigurationSha256, old.manifest.cairn.adapterConfigurationSha256);
  assert.notEqual(newer.manifest.contextProtocolSha256, old.manifest.contextProtocolSha256);
  assert.notEqual(newer.roster[0].protocolDigest, old.roster[0].protocolDigest);
  assert.deepEqual(newer.roster[0].arms, old.roster[0].arms);
  assert.deepEqual(newer.roster[0].armOrder, old.roster[0].armOrder);
  const oldResource = projectMixedResources({ ...resourceOptions(), comparisonProfile });
  const newerResource = projectMixedResources({ ...resourceOptions(), comparisonProfile, navigationLabelPolicy });
  assert.equal(newerResource.version, 'mixed-indexed-evidence-rare-query-navigation-resource-projection-v1');
  assert.equal(newerResource.navigationLabelPolicy, navigationLabelPolicy);
  const { version: _version, navigationLabelPolicy: _navigation, ...rest } = newerResource;
  const { version: _oldVersion, ...oldRest } = oldResource;
  assert.deepEqual(rest, oldRest);
});

test('P3 policy cross-preparation and forged authority reject before requests/store entry', async t => {
  const workspace = createTestWorkspace(null, { prefix: 'cairn-mixed-navigation-denied-' });
  try {
    const row = sourceRow(), fake = fakeMixedHttp(() => assert.fail('denied transport must not dispatch'));
    const old = syntheticMixedFixture(null, { artifact: descriptors.nativeArtifact,
      configuration: descriptors.nativeConfiguration, sourceCases: [row], armOrders: [['cairn', 'mem0']],
      comparisonProfile, fetchImpl: fake.fetchImpl, workspace });
    const prepared = prepareMixedComparison({ ...prepareOptions(), comparisonProfile, navigationLabelPolicy });
    await assert.rejects(runMixedGeneration({ prepared, guard: old.guard,
      apiKey: 'synthetic-only', cairnStoreRoot: old.root }), { code: 'mixed_guard_mismatch' });
    const config = { ledger: old.capability.ledger, policy: old.capability.policy,
      benchmarkExtension: old.capability.benchmarkExtension };
    const newManifest = structuredClone(old.capability.manifest);
    newManifest.cairn.navigationLabelPolicy = navigationLabelPolicy;
    for (const [index, cairn] of [
      { ...newManifest.cairn, navigationLabelPolicy: 'other' },
      { ...newManifest.cairn, captureSourcePolicy: 'indexed-windows-v1' },
      (() => { const value = { ...newManifest.cairn }; delete value.comparisonProfile; return value; })(),
    ].entries()) {
      assert.throws(() => authorizeMixedSourcePairCapability({ ...config,
        authorizationId: `denied-navigation-${index}`, executionId: `denied-navigation-${index}`,
        checkpoint: old.capability.checkpoint, manifest: { ...newManifest, cairn },
        roster: old.capability.roster, limits: old.capability.limits }), { code: 'invalid_capability' });
    }
    let getterReads = 0;
    const accessor = { ...newManifest.cairn };
    Object.defineProperty(accessor, 'navigationLabelPolicy', { enumerable: true,
      get() { getterReads++; throw Error('synthetic getter forbidden'); } });
    assert.throws(() => authorizeMixedSourcePairCapability({ ...config,
      authorizationId: 'denied-navigation-getter', executionId: 'denied-navigation-getter',
      checkpoint: old.capability.checkpoint, manifest: { ...newManifest, cairn: accessor },
      roster: old.capability.roster, limits: old.capability.limits }), { code: 'invalid_options' });
    assert.equal(getterReads, 0);
    for (const mutate of [
      value => { value.manifest.cairn.navigationLabelPolicy = navigationLabelPolicy; },
      value => { value.methodProfile = 'cairn-mem0-indexed-evidence-rare-query-navigation-source-pair-v1'; },
      value => { value.manifest.contextProtocolSha256 = 'f'.repeat(64); },
    ]) {
      const capability = structuredClone(old.capability); mutate(capability);
      assert.throws(() => createMixedSourcePairExperimentRequestGuard({ ...config,
        mixedSourcePairCapability: capability, fetchImpl: fake.fetchImpl }), { code: 'invalid_capability' });
    }
    assert.equal(old.guard.attempts().length, 0);
    assert.equal(old.guard.caseOutcomes().scopes.length, 0);
    assert.equal(fs.readdirSync(old.root).some(name => name.startsWith('mixed-cairn-')), false);
    old.guard.close();
    const newer = authorizeMixedSourcePairCapability({ ...config,
      authorizationId: 'synthetic-navigation-negative', executionId: 'synthetic-navigation-negative',
      checkpoint: old.capability.checkpoint, manifest: newManifest,
      roster: old.capability.roster, limits: old.capability.limits });
    for (const mutate of [
      value => { delete value.manifest.cairn.navigationLabelPolicy; },
      value => { value.methodProfile = old.capability.methodProfile; },
      value => { value.roster[0].protocolDigest = 'e'.repeat(64); },
    ]) {
      const capability = structuredClone(newer); mutate(capability);
      assert.throws(() => createMixedSourcePairExperimentRequestGuard({ ...config,
        mixedSourcePairCapability: capability, fetchImpl: fake.fetchImpl }), { code: 'invalid_capability' });
    }
  } finally { await workspace.cleanup(); assert.equal(fs.existsSync(workspace.path), false); }
});

test('P2/P3 journal historical identity opens, cross-policy phase and rehashed tamper reject', t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-mixed-navigation-journal-' });
  const options = { ...prepareOptions(), comparisonProfile };
  const legacy = prepareMixedComparison(prepareOptions());
  const old = prepareMixedComparison(options), newer = prepareMixedComparison({ ...options, navigationLabelPolicy });
  for (const [index, prepared] of [legacy, old, newer].entries()) {
    const directory = join(workspace.path, `journal-${index}`);
    const handle = createMixedResultJournal({ directory, prepared });
    const observed = inspectMixedResultJournal({ directory });
    assert.equal(sha(observed.identity.manifest), [
      '9140cece8e2b656ea14c5239a02f2ece40bd6d6a06ec4892c19b8730011d3f31',
      '57a1ed8d717fd51c73863d01f6c91115269b5b7f2fedf78c8ff47e0cd7f98aca', sha(newer.manifest),
    ][index]);
    assert.throws(() => startMixedJournalPhase(handle, 'generation', index === 2 ? old : newer),
      { code: 'invalid_mixed_result_journal' });
    assert.deepEqual(fs.readdirSync(directory), ['000000.json']);
    const file = join(directory, '000000.json'), record = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (index === 2) delete record.data.manifest.cairn.navigationLabelPolicy;
    else record.data.manifest.cairn.navigationLabelPolicy = navigationLabelPolicy;
    // Rehash outer record: stale authoritative manifestDigest must still reject.
    const { digest: _digest, ...body } = record;
    record.digest = hash('cairn.lme.mixed.result-journal-record.v1', body);
    fs.writeFileSync(file, JSON.stringify(record) + '\n', { mode: 0o600 });
    assert.throws(() => inspectMixedResultJournal({ directory }), { code: 'invalid_mixed_result_journal' });
  }
});
