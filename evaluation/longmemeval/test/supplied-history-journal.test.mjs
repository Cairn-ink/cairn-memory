import assert from 'node:assert/strict';
import fs, { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';

import { runMixedGeneration } from '../mixed-generation.mjs';
import { scoreMixedGeneration } from '../mixed-scoring.mjs';
import { completeMixedJournalPhase, createMixedResultJournal, enterMixedJournalArm,
  inspectMixedResultJournal, recordMixedJournalArm, startMixedJournalPhase } from '../mixed-result-journal.mjs';
import { mixedSourcePolicy, suppliedHistoryPolicy } from '../mixed-source.mjs';
import { freeze, hash, reportSnapshot, sha256 } from '../mixed-validation.mjs';
import { sourceHistoryFamily, sourceProtocolIdentity } from '../mixed-source-policy.mjs';
import { evaluatorRow, fakeMixedHttp, sourceRow, syntheticMixedFixture } from '../testing/mixed-fixture.mjs';
import { interruption, syntheticNativeDescriptors, syntheticScoringGeneration } from '../testing/result-journal-fixture.mjs';

// The RED is deliberately at phase completion: actual preparation and X scopes
// must already have published the identity, phase start and both terminals.
// No synthetic phase publisher or installed native process stands in for them.
for (const comparisonProfile of [undefined, 'indexed-evidence-v1']) {
  for (const order of [['cairn', 'mem0'], ['mem0', 'cairn']]) {
    for (const supplied of [false, true]) {
      test(`SJ5 ${supplied ? 'supplied completion' : 'authentic legacy positive'} ${comparisonProfile ?? 'qualified'} ${order.join('/')}`,
        async t => {
          const workspace = createTestWorkspace(t, { prefix: 'cairn-supplied-journal-' });
          const descriptors = syntheticNativeDescriptors(workspace.path);
          const row = sourceRow();
          row.history.sessions[0].turns = Array.from({ length: 5 }, (_, index) => ({
            turn_id: `lme-turn-${String(index + 1).repeat(64)}`, role: 'user',
            content: '漢'.repeat(3000) }));
          const fake = fakeMixedHttp();
          const fixture = syntheticMixedFixture(null, { ...descriptors, sourceCases: [row],
            armOrders: [order], comparisonProfile, workspace, fetchImpl: fake.fetchImpl,
            ...(supplied ? { sourceHistoryPolicy: 'supplied-history-v1' } : {}) });
          assert.equal(fixture.root, workspace.path, 'one caller-owned fixture workspace');
          assert.equal(fixture.prepared.manifest.sourceProtocolSha256,
            (supplied ? suppliedHistoryPolicy : mixedSourcePolicy)().digest);
          assert.deepEqual(fixture.prepared.preflight.map(({ status, reason, caseDigest }) =>
            ({ status, reason, caseDigest })), [{ status: 'failed',
            reason: 'native_static_input_exceeded', caseDigest: null }]);
          const directory = join(workspace.path, 'journal');
          const resultJournal = createMixedResultJournal({ directory, prepared: fixture.prepared });
          let generation, failure;
          try {
            generation = await runMixedGeneration({ prepared: fixture.prepared, guard: fixture.guard,
              apiKey: 'SYNTHETIC_JOURNAL_ONLY', cairnStoreRoot: fixture.root, resultJournal,
              phaseTiming: 'bounded-tail-v1', recallWitness: 'bounded-v1' });
          } catch (error) { failure = error; }

          // These assertions run before the expected-return assertion, including
          // on the unchanged journal. A setup/import/selector failure is not RED.
          const observed = inspectMixedResultJournal({ directory });
          assert.deepEqual(reportSnapshot(observed.identity.manifest),
            reportSnapshot(fixture.prepared.manifest));
          assert.equal(observed.phases.generation.started, true);
          assert.deepEqual(observed.phases.generation.arms.map(arm => [arm.name, arm.state]),
            order.map(name => [name, 'terminal']));
          for (const arm of observed.phases.generation.arms) {
            assert.equal(arm.result.status, 'failed');
            assert.equal(arm.result.reason, 'native_static_input_exceeded');
            assert.equal(arm.result.answer, null);
            assert.equal(arm.result.diagnostics.stage, 'preflight');
          }
          const records = readdirSync(directory).filter(name => /^\d{6}\.json$/u.test(name))
            .sort().map(name => JSON.parse(readFileSync(join(directory, name), 'utf8')));
          assert.deepEqual(records.slice(0, 6).map(record => record.type),
            ['identity', 'phase_start', 'arm_enter', 'arm_terminal', 'arm_enter', 'arm_terminal']);
          assert.deepEqual(records.filter(record => record.type === 'arm_terminal')
            .map(record => [record.data.ordinal, record.data.result.name]),
          order.map((name, ordinal) => [ordinal, name]));
          assert.equal(fixture.guard.caseOutcomes().scopes.length, 2);
          assert.equal(fixture.guard.attempts().length, 0);
          assert.equal(fake.calls.length, 0, 'authentic native static refusal must make zero HTTP calls');
          if (failure) {
            assert.equal(supplied, true, 'the authentic legacy positive must complete');
            assert.equal(failure.code, 'mixed_result_journal_failed');
            assert.equal(records.length, 6, 'only completion publication is missing');
            assert.equal(observed.phases.generation.completion, null);
            t.diagnostic('SJ5 RED preconditions: actual supplied preparation; native_static_input_exceeded; identity + phase_start + 2 durable terminals; 2 X scopes; 0 attempts/HTTP; completion rejected');
          }
          assert.ifError(failure);
          assert.equal(generation.schemaVersion, supplied
            ? 'cairn-lme-supplied-history-mixed-generation-v1' : 'cairn-lme-mixed-generation-v1');
          assert.deepEqual(generation.cases[0].arms.map(arm => arm.name), ['cairn', 'mem0']);
          assert.deepEqual(reportSnapshot(observed.phases.generation.completion.report),
            reportSnapshot(generation));
          assert.equal(records.length, 7);
          const scoring = await scoreMixedGeneration({ generationReport: generation,
            evaluatorRows: [evaluatorRow()], referenceRenderings: undefined,
            guard: fixture.guard, apiKey: 'SYNTHETIC_JOURNAL_ONLY', resultJournal });
          const completed = inspectMixedResultJournal({ directory });
          assert.equal(JSON.stringify(completed.phases.scoring.completion.report), JSON.stringify(scoring));
          assert.equal(scoring.schemaVersion, supplied ? 'cairn-lme-supplied-history-mixed-scoring-v1'
            : 'cairn-lme-mixed-scoring-v1');
          assert.equal(scoring.generationDigest, hash(supplied
            ? 'cairn.lme.supplied-history-mixed.generation-report.v1'
            : 'cairn.lme.mixed.generation-report.v1', generation));
          assert.deepEqual(completed.phases.scoring.arms.map(arm => arm.name), order);
          assert.equal(fixture.guard.caseOutcomes().scopes.length, 4);
          assert.equal(fixture.guard.attempts().length, 0); assert.equal(fake.calls.length, 0);
          await workspace.cleanup();
          assert.equal(existsSync(workspace.path), false);
        });
    }
  }
}

function writeRecords(directory, records) {
  fs.mkdirSync(directory, { mode: 0o700 });
  for (const [index, bytes] of records.entries()) fs.writeFileSync(
    join(directory, `${String(index).padStart(6, '0')}.json`),
    typeof bytes === 'string' ? bytes : JSON.stringify(bytes) + '\n', { mode: 0o600, flag: 'wx' });
}
function rechain(records, generationDomain) {
  const identity = records[0].data;
  identity.manifestDigest = hash('cairn.lme.mixed.manifest.v1', identity.manifest);
  identity.rosterDigest = hash('cairn.lme.mixed-source-pair.roster.v1', identity.roster);
  const generation = records.find(record => record.type === 'phase_complete' && record.data.phase === 'generation');
  if (generation) {
    generation.data.report.manifestDigest = identity.manifestDigest;
    generation.data.report.rosterDigest = identity.rosterDigest;
  }
  for (const [index, record] of records.entries()) {
    if (record.data.phase === 'scoring' && ['phase_start', 'phase_complete'].includes(record.type)
      && generationDomain) {
      const digest = hash(generationDomain, generation.data.report);
      if (record.type === 'phase_start') record.data.generationDigest = digest;
      else record.data.report.generationDigest = digest;
    }
    if (record.type === 'phase_complete') record.data.reportDigest =
      hash('cairn.lme.mixed.result-journal-report.v1', record.data.report);
    record.seq = index; record.previous = index ? records[index - 1].digest : null;
    const { digest: _digest, ...body } = record;
    record.digest = hash('cairn.lme.mixed.result-journal-record.v1', body);
  }
  return records;
}

test('SJ4 fresh builtins-only minimal tree inspects both families/profiles/orders and refuses coherent transplants', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'sj-cold-tree-' }), root = workspace.path;
  const items = [];
  const modules = ['mixed-result-journal.mjs', 'mixed-source-policy.mjs', 'mixed-protocol-data.mjs',
    'mixed-validation.mjs', 'mixed-native-failure-shape.mjs'];
  for (const name of modules) fs.copyFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), join(root, name));
  for (const name of ['supplied-journal-loader.mjs', 'supplied-journal-cold.mjs'])
    fs.copyFileSync(fileURLToPath(new URL(`../testing/${name}`, import.meta.url)), join(root, name));
  for (const name of readdirSync(root)) fs.chmodSync(join(root, name), 0o600);
  for (const supplied of [false, true]) for (const comparisonProfile of [undefined, 'indexed-evidence-v1']) {
    for (const order of [['cairn', 'mem0'], ['mem0', 'cairn']]) {
      const fixture = fixtureFor(t, { supplied, comparisonProfile, order });
      const handle = createMixedResultJournal({ directory: fixture.directory, prepared: fixture.prepared });
      const generation = await generate(fixture, handle), scoring = await score(fixture, generation, handle);
      const records = rawRecords(fixture.directory).map(row => row.bytes);
      assert.equal(records.length, 13); assert.equal(fixture.fake.calls.length, 0);
      for (const count of [1, 3, 4, 6, 7, 9, 10, 12, 13]) {
        const directory = `valid-${items.length}`;
        writeRecords(join(root, directory), records.slice(0, count));
        const view = inspectMixedResultJournal({ directory: join(root, directory) });
        assert.equal(Object.hasOwn(view, 'family'), false);
        assert.equal(Object.hasOwn(view.identity, 'family'), false);
        assert.equal(Object.hasOwn(view.identity, 'preparationVersion'), false);
        if (count < 7) assert.equal(view.phases.generation.completion, null);
        else assert.equal(JSON.stringify(view.phases.generation.completion.report), JSON.stringify(generation));
        if (count < 13) assert.equal(view.phases.scoring.completion, null);
        else assert.equal(JSON.stringify(view.phases.scoring.completion.report), JSON.stringify(scoring));
        items.push({ directory, inspectionJson: JSON.stringify(view) });
      }
      const ownDomain = supplied ? 'cairn.lme.supplied-history-mixed.generation-report.v1'
        : 'cairn.lme.mixed.generation-report.v1';
      const faults = [
        ['unknown-source', values => { values[0].data.manifest.sourceProtocolSha256 = 'a'.repeat(64); }],
        ['context', values => { values[0].data.manifest.contextProtocolSha256 = 'a'.repeat(64); }],
        ['scorer', values => { values[0].data.manifest.scorerProtocolSha256 = 'a'.repeat(64); }],
        ['profile', values => { values[0].data.manifest.cairn.comparisonProfile =
          comparisonProfile ? 'unsupported' : 'indexed-evidence-v1'; }],
        ['wire', values => { values[0].data.manifest.mem0.wireProfile.chat.maxInputTokens++; }],
        ['generation-version', values => { values[6].data.report.schemaVersion = 'unsupported'; }],
        ['scoring-version', values => { values[12].data.report.schemaVersion = 'unsupported'; }],
        ['order', values => { values[2].data.ordinal = 1; }],
        ['aggregate', values => { values[12].data.report.summary.perArm.cairn.correct = 99; }],
        ['entered-completion', values => { values.splice(5, 1); }],
        ['family-pair', values => {
          const manifest = values[0].data.manifest;
          Object.assign(manifest, sourceProtocolIdentity(sourceHistoryFamily(supplied ? undefined : 'supplied-history-v1'),
            { nativeConfigurationSha256: manifest.mem0.configurationSha256, comparisonProfile }));
        }],
        ['generation-domain', () => {}],
      ];
      for (const [fault, mutate] of faults) {
        const values = records.map(bytes => JSON.parse(bytes)); mutate(values);
        const complete = values.find(record => record.type === 'phase_complete' && record.data.phase === 'generation');
        complete.data.report.manifest = structuredClone(values[0].data.manifest);
        const domain = fault === 'generation-domain' ? supplied
          ? 'cairn.lme.mixed.generation-report.v1' : 'cairn.lme.supplied-history-mixed.generation-report.v1'
          : fault === 'family-pair' ? supplied
            ? 'cairn.lme.mixed.generation-report.v1' : 'cairn.lme.supplied-history-mixed.generation-report.v1'
            : ownDomain;
        rechain(values, domain);
        const directory = `reject-${items.length}`; writeRecords(join(root, directory), values);
        assert.throws(() => inspectMixedResultJournal({ directory: join(root, directory) }),
          { code: 'invalid_mixed_result_journal' }, fault);
        items.push({ directory, reject: true, fault });
      }
      await fixture.workspace.cleanup(); assert.equal(existsSync(fixture.root), false);
    }
  }
  const expectedAccepted = items.filter(item => !item.reject).length,
    expectedRejected = items.filter(item => item.reject).length;
  assert.equal(expectedAccepted, 72); assert.equal(expectedRejected, 96);
  fs.writeFileSync(join(root, 'requests.json'), JSON.stringify({ items, expectedAccepted, expectedRejected,
    outsideModule: fileURLToPath(new URL('../mixed-source-policy.mjs', import.meta.url)) }), { mode: 0o600, flag: 'wx' });
  const child = spawn(process.execPath, ['--experimental-loader', join(root, 'supplied-journal-loader.mjs'),
    join(root, 'supplied-journal-cold.mjs')], { cwd: root,
    env: { PATH: '/usr/bin:/bin', NODE_DISABLE_COMPILE_CACHE: '1', TMPDIR: root, TMP: root, TEMP: root },
    stdio: ['ignore', 'pipe', 'pipe'] });
  let spawnError, output = '';
  const closed = new Promise(resolve => {
    child.once('error', error => { spawnError = error; });
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
  workspace.defer(async () => { child.kill('SIGTERM'); await closed; });
  const result = await closed;
  assert.ifError(spawnError); assert.deepEqual(result, { code: 0, signal: null }, output);
  const lines = output.split('\n').filter(line => line.startsWith('{"kind":"SJ_COLD_MINIMAL_TREE"'));
  assert.equal(lines.length, 1, output);
  assert.deepEqual(JSON.parse(lines[0]), { kind: 'SJ_COLD_MINIMAL_TREE', accepted: 72, rejected: 96,
    deniedSqlite: true, deniedOutside: true });
  await workspace.cleanup(); assert.equal(existsSync(root), false);
});

const legacyBytes = JSON.parse(readFileSync(new URL('../testing/supplied-journal-legacy.json', import.meta.url)));
const rawRecords = directory => readdirSync(directory).filter(name => /^\d{6}\.json$/u.test(name))
  .sort().map(name => ({ name, bytes: readFileSync(join(directory, name), 'utf8') }));

for (const row of legacyBytes.cases) {
  test(`SJ2 exact old legacy writer/inspector bytes ${row.profile} ${row.order.join('/')}`, async t => {
    const workspace = createTestWorkspace(t, { prefix: 'sj-legacy-byte-' }), directory = join(workspace.path, 'journal');
    const prepared = freeze(JSON.parse(row.preparedJson)), generation = freeze(JSON.parse(row.generationJson));
    const scoring = freeze(JSON.parse(row.scoringJson));
    const handle = createMixedResultJournal({ directory, prepared });
    let checkpoint = 0;
    const comparePrefix = () => {
      const expected = row.checkpoints[checkpoint++];
      assert.deepEqual(rawRecords(directory), row.records.slice(0, expected.recordCount));
      assert.equal(sha256(JSON.stringify(inspectMixedResultJournal({ directory }))), expected.inspectionSha256);
    };
    comparePrefix();
    for (const phase of ['generation', 'scoring']) {
      const report = phase === 'generation' ? generation : scoring;
      startMixedJournalPhase(handle, phase, phase === 'generation' ? prepared : generation);
      for (const [ordinal, name] of row.order.entries()) {
        enterMixedJournalArm(handle, phase, ordinal); comparePrefix();
        recordMixedJournalArm(handle, phase, ordinal, report.cases[0],
          report.cases[0].arms.find(arm => arm.name === name)); comparePrefix();
      }
      completeMixedJournalPhase(handle, phase, report);
      if (phase === 'generation') comparePrefix();
    }
    assert.equal(checkpoint, row.checkpoints.length);
    assert.deepEqual(rawRecords(directory), row.records);
    assert.equal(JSON.stringify(inspectMixedResultJournal({ directory })), row.inspectionJson);
    await workspace.cleanup(); assert.equal(existsSync(workspace.path), false);
  });
}

function fixtureFor(t, { supplied = true, comparisonProfile, order = ['cairn', 'mem0'], preflight = true,
  override } = {}) {
  const workspace = createTestWorkspace(t, { prefix: 'sj-integration-' });
  const descriptors = syntheticNativeDescriptors(workspace.path), row = sourceRow(), fake = fakeMixedHttp(override);
  if (preflight) row.history.sessions[0].turns = Array.from({ length: 5 }, (_, index) => ({
    turn_id: `lme-turn-${String(index + 1).repeat(64)}`, role: 'user', content: '漢'.repeat(3000) }));
  const fixture = syntheticMixedFixture(null, { ...descriptors, workspace, sourceCases: [row],
    armOrders: [order], comparisonProfile, fetchImpl: fake.fetchImpl,
    ...(supplied ? { sourceHistoryPolicy: 'supplied-history-v1' } : {}) });
  return { ...fixture, workspace, fake, directory: join(workspace.path, 'journal') };
}
const generate = (fixture, resultJournal, prepared = fixture.prepared) => runMixedGeneration({
  prepared, guard: fixture.guard, apiKey: 'SYNTHETIC_JOURNAL_ONLY', cairnStoreRoot: fixture.root, resultJournal });
const score = (fixture, generationReport, resultJournal) => scoreMixedGeneration({
  generationReport, evaluatorRows: [evaluatorRow()], referenceRenderings: undefined,
  guard: fixture.guard, apiKey: 'SYNTHETIC_JOURNAL_ONLY', resultJournal });

test('SJ2 writer-only preparation schema and complete family/wire identities reject before publication', t => {
  const fixture = fixtureFor(t);
  const faults = [
    value => { value.schemaVersion = 'cairn-lme-mixed-preparation-v1'; },
    value => { value.manifest.sourceProtocolSha256 = 'a'.repeat(64); },
    value => { value.manifest.contextProtocolSha256 = 'a'.repeat(64); },
    value => { value.manifest.scorerProtocolSha256 = 'a'.repeat(64); },
    value => { value.manifest.cairn.comparisonProfile = undefined; },
    value => { value.manifest.cairn.comparisonProfile = 'indexed-evidence-v1'; },
    value => { value.manifest.mem0.wireProfile.chat.reservedMicroUsd++; },
    value => { value.manifest.mem0.wireProfile.embedding.inputPrice.tokenDenominator++; },
  ];
  for (const [index, mutate] of faults.entries()) {
    const prepared = structuredClone(fixture.prepared); mutate(prepared); freeze(prepared);
    const directory = join(fixture.root, `rejected-${index}`);
    assert.throws(() => createMixedResultJournal({ directory, prepared }),
      { code: 'invalid_mixed_result_journal' });
    assert.equal(existsSync(directory), false);
  }
  assert.equal(fixture.guard.caseOutcomes().scopes.length, 0); assert.equal(fixture.fake.calls.length, 0);
});

test('SJ3 same-value preparation/report clones and cross-preparation handles stop before new work', async t => {
  for (const fault of ['prepared-clone', 'other-handle', 'generation-clone']) {
    const fixture = fixtureFor(t), handle = createMixedResultJournal({
      directory: fixture.directory, prepared: fixture.prepared });
    if (fault === 'prepared-clone') {
      await assert.rejects(generate(fixture, handle, freeze(structuredClone(fixture.prepared))),
        { code: 'prepared_identity_required' });
    } else if (fault === 'other-handle') {
      const other = fixtureFor(t), otherHandle = createMixedResultJournal({
        directory: other.directory, prepared: other.prepared });
      await assert.rejects(generate(fixture, otherHandle), { code: 'invalid_mixed_result_journal' });
      assert.equal(other.guard.caseOutcomes().scopes.length, 0);
    } else {
      const generation = await generate(fixture, handle), before = fixture.guard.caseOutcomes().scopes.length;
      await assert.rejects(score(fixture, freeze(structuredClone(generation)), handle),
        { code: 'invalid_mixed_result_journal' });
      assert.equal(fixture.guard.caseOutcomes().scopes.length, before);
    }
    assert.equal(fixture.fake.calls.length, 0); assert.equal(fixture.guard.attempts().length, 0);
    if (fault !== 'generation-clone') assert.equal(fixture.guard.caseOutcomes().scopes.length, 0);
  }
});

test('SJ3 supplied terminal persistence failure poisons before second scope', async t => {
  const fixture = fixtureFor(t), handle = createMixedResultJournal({
    directory: fixture.directory, prepared: fixture.prepared });
  const original = fs.fsyncSync;
  t.mock.method(fs, 'fsyncSync', fd => {
    if (fixture.guard.caseOutcomes().scopes.length === 1) throw new Error('SJ_SYNTHETIC_FSYNC_REFUSAL');
    return original(fd);
  });
  await assert.rejects(generate(fixture, handle), { code: 'mixed_result_journal_failed' });
  assert.equal(fixture.guard.caseOutcomes().scopes.length, 1); assert.equal(fixture.fake.calls.length, 0);
  const view = inspectMixedResultJournal({ directory: fixture.directory }).phases.generation;
  assert.deepEqual(view.arms.map(arm => arm.state), ['entered', 'unobserved']);
  assert.equal(view.completion, null);
  assert.throws(() => enterMixedJournalArm(handle, 'generation', 1), { code: 'mixed_result_journal_failed' });
});

test('SJ3 supplied scoring persistence failure stops before second scope and aggregate', async t => {
  const fixture = fixtureFor(t), handle = createMixedResultJournal({
    directory: fixture.directory, prepared: fixture.prepared });
  const generation = await generate(fixture, handle), original = fs.fsyncSync;
  t.mock.method(fs, 'fsyncSync', fd => {
    if (fixture.guard.caseOutcomes().scopes.length === 3) throw new Error('SJ_SYNTHETIC_SCORE_FSYNC_REFUSAL');
    return original(fd);
  });
  await assert.rejects(score(fixture, generation, handle), { code: 'mixed_result_journal_failed' });
  assert.equal(fixture.guard.caseOutcomes().scopes.length, 3); assert.equal(fixture.fake.calls.length, 0);
  const view = inspectMixedResultJournal({ directory: fixture.directory }).phases.scoring;
  assert.deepEqual(view.arms.map(arm => arm.state), ['entered', 'unobserved']);
  assert.equal(view.completion, null);
});

test('SJ2 scorer refuses coherent family/schema and unsupported wire transplants before judge scopes', async t => {
  for (const fault of ['family', 'schema', 'wire']) {
    const fixture = fixtureFor(t), handle = createMixedResultJournal({
      directory: fixture.directory, prepared: fixture.prepared });
    const generation = await generate(fixture, handle), changed = structuredClone(generation);
    if (fault === 'family') {
      Object.assign(changed.manifest, sourceProtocolIdentity(sourceHistoryFamily(), {
        nativeConfigurationSha256: changed.manifest.mem0.configurationSha256 }));
      changed.schemaVersion = 'cairn-lme-mixed-generation-v1';
    } else if (fault === 'schema') changed.schemaVersion = 'cairn-lme-mixed-generation-v1';
    else changed.manifest.mem0.wireProfile.embedding.dimensions++;
    changed.manifestDigest = hash('cairn.lme.mixed.manifest.v1', changed.manifest); freeze(changed);
    await assert.rejects(score(fixture, changed, handle), { code: 'invalid_mixed_report' });
    assert.equal(fixture.guard.caseOutcomes().scopes.length, 2);
    assert.equal(fixture.guard.attempts().length, 0); assert.equal(fixture.fake.calls.length, 0);
    assert.equal(inspectMixedResultJournal({ directory: fixture.directory }).phases.scoring.started, false);
  }
});

for (const comparisonProfile of [undefined, 'indexed-evidence-v1']) {
  test(`SJ3 supplied halted generation retains unresolved unobserved suffix ${comparisonProfile ?? 'qualified'}`, async t => {
    const fixture = fixtureFor(t, { comparisonProfile, preflight: false,
      override: (url, body) => url.endsWith('/chat/completions') && !body.response_format
        ? Response.json({ choices: [] }) : undefined });
    const handle = createMixedResultJournal({ directory: fixture.directory, prepared: fixture.prepared });
    const generation = await generate(fixture, handle), view =
      inspectMixedResultJournal({ directory: fixture.directory }).phases.generation;
    assert.equal(generation.halted, true); assert.equal(generation.cases.length, 1);
    assert.deepEqual(view.arms.map(arm => arm.state), ['terminal', 'unobserved']);
    assert.equal(view.completion.report.halted, true);
    assert.equal(view.completion.report.cases[0].arms[1].status, 'blocked');
    assert.equal(view.completion.report.cases[0].arms[1].scope, null);
    assert.equal(fixture.fake.calls.some(call => call.route === '/v1/embeddings'), false);
  });
  for (const order of [['cairn', 'mem0'], ['mem0', 'cairn']]) {
    test(`SJ3 supplied final-arm halt keeps fixed-N all-terminal scoring ${comparisonProfile ?? 'qualified'} ${order.join('/')}`, async t => {
      let judges = 0;
      const fixture = fixtureFor(t, { comparisonProfile, order, preflight: false,
        override: (_url, body) => body.model === 'gpt-4o-2024-08-06' && ++judges === 2
          ? Response.json({ choices: [] }) : undefined });
      const handle = createMixedResultJournal({ directory: fixture.directory, prepared: fixture.prepared });
      const generation = await syntheticScoringGeneration(fixture, fixture.guard, handle);
      const scoring = await score(fixture, generation, handle), view =
        inspectMixedResultJournal({ directory: fixture.directory }).phases.scoring;
      assert.equal(scoring.halted, true); assert.equal(scoring.cases.length, 1);
      assert.equal(scoring.summary.fixedN, 1);
      assert.deepEqual(view.arms.map(arm => arm.state), ['terminal', 'terminal']);
      assert.equal(view.completion.report.summary.commonResolvedN, 0);
      assert.equal(view.completion.report.summary.perArm[order[1]].unresolved, 1);
      assert.equal(fixture.fake.calls.filter(call => call.body.model === 'gpt-4o-2024-08-06').length, 2);
    });
  }
}

for (const comparisonProfile of [undefined, 'indexed-evidence-v1']) {
  for (const phase of ['generation', 'scoring']) {
    test(`SJ3 supplied genuine ${phase} interruption ${comparisonProfile ?? 'qualified'}`, t =>
      interruption(t, phase, false, phase === 'generation',
        { sourceHistoryPolicy: 'supplied-history-v1', comparisonProfile }));
  }
}

test('SJ3 ordinary scoring observations reject before workspace creation or child spawn', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-journal-observation-prerequisite-' });
  const unavailableParent = join(workspace.path, 'must-not-create');
  const previousTmpdir = process.env.TMPDIR;
  // If interruption reaches workspace creation first, this owned nonexistent
  // parent fails with ENOENT; no workspace or child can be created by the test.
  process.env.TMPDIR = unavailableParent;
  try {
    await assert.rejects(interruption(t, 'scoring', false, true,
      { sourceHistoryPolicy: 'supplied-history-v1' }),
    { message: 'scoring_interruption_observations_require_actual_native' });
    assert.equal(existsSync(unavailableParent), false);
  } finally {
    if (previousTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTmpdir;
  }
});
