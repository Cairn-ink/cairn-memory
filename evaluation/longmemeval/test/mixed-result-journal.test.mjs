import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import test from 'node:test';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';

import { prepareMixedComparison, runMixedGeneration } from '../mixed-generation.mjs';
import { scoreMixedGeneration } from '../mixed-scoring.mjs';
import { createMixedResultJournal, inspectMixedResultJournal, startMixedJournalPhase,
  enterMixedJournalArm, recordMixedJournalArm } from '../mixed-result-journal.mjs';
import { isMixedNativeFailure } from '../mixed-native-failure-shape.mjs';
import { canonical, freeze, hash, reportSnapshot } from '../mixed-validation.mjs';
import { evaluatorRow, fakeMixedHttp, sourceRow, syntheticMixedFixture } from '../testing/mixed-fixture.mjs';
import { interruption, syntheticNativeDescriptors,
  syntheticScoringGeneration } from '../testing/result-journal-fixture.mjs';
import { syntheticHttpClientFailure } from '../testing/native-http-client-error-fixture.mjs';
import { nativeClientErrorProbe } from '../../experiment-budget/testing/native-http-client-error-fixture.mjs';
import { projectMixedNativeFailure } from '../mixed-native-failure.mjs';

test('RD7 generation interruption retains first real completed answer', t => interruption(t, 'generation'));
test('RD8 scoring interruption retains first real settled judgment', t => interruption(t, 'scoring'));
test('JO2/JO3 ordinary interruption retains both generation observations',
  t => interruption(t, 'generation', false, true));

function fixtureFor(t, { order = ['cairn', 'mem0'], preflight = false, override, comparisonProfile } = {}) {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-result-journal-' });
  const descriptors = syntheticNativeDescriptors(workspace.path);
  const row = sourceRow();
  if (preflight) row.history.sessions[0].turns = Array.from({ length: 5 }, (_, index) => ({
    turn_id: `lme-turn-${String(index + 1).repeat(64)}`, role: 'user', content: '漢'.repeat(3000) }));
  const fake = fakeMixedHttp(override);
  const fixture = syntheticMixedFixture(null, { ...descriptors, sourceCases: [row],
    armOrders: [order], fetchImpl: fake.fetchImpl, comparisonProfile, workspace });
  const directory = join(workspace.path, 'journal');
  return { ...fixture, descriptors, row, workspace, fake, directory,
    journal: () => createMixedResultJournal({ directory, prepared: fixture.prepared }) };
}
const generate = (fixture, journal, guard = fixture.guard) => runMixedGeneration({
  prepared: fixture.prepared, guard, apiKey: 'JOURNAL_KEY_CANARY', cairnStoreRoot: fixture.root,
  ...(journal === undefined ? {} : { resultJournal: journal }) });
const score = (fixture, report, journal) => scoreMixedGeneration({ generationReport: report,
  evaluatorRows: [evaluatorRow()], referenceRenderings: undefined, guard: fixture.guard,
  apiKey: 'JOURNAL_KEY_CANARY', ...(journal === undefined ? {} : { resultJournal: journal }) });

const nativeFailure = { version: 1, layer: 'runtime', reason: 'native_gateway_failed' };
const malformedNativeFailures = [null, [], 'native_gateway_failed',
  { ...nativeFailure, version: 2 }, { ...nativeFailure, version: '1' },
  { ...nativeFailure, layer: 'native' }, { ...nativeFailure, reason: 'unreviewed' },
  { ...nativeFailure, reason: false }, { ...nativeFailure, reason: 'invalid_native_input' },
  { ...nativeFailure, layer: 'gateway' }, { ...nativeFailure, extra: 'PRIVATE_CANARY' },
  { version: 1, layer: 'runtime' }];

test('IC3 shared finite native shape rejects hostile descriptors without observation', () => {
  for (const value of malformedNativeFailures) assert.equal(isMixedNativeFailure(value), false);
  assert.equal(isMixedNativeFailure(nativeFailure), true);
  assert.equal(isMixedNativeFailure({ version: 1, layer: 'gateway', reason: 'invalid_native_input' }), true);
  let invoked = 0;
  const accessor = { version: 1, layer: 'runtime' };
  Object.defineProperty(accessor, 'reason', { get() { invoked++; return nativeFailure.reason; } });
  const proxy = new Proxy(nativeFailure, { ownKeys() { invoked++; throw Error('PRIVATE_CANARY'); } });
  const revoked = Proxy.revocable(nativeFailure, {}); revoked.revoke();
  for (const value of [accessor, proxy, revoked.proxy,
    { ...nativeFailure, [Symbol('extra')]: true }, Object.create(nativeFailure)]) {
    assert.equal(isMixedNativeFailure(value), false);
  }
  assert.equal(invoked, 0);
});

test('IC3/IC5 native failure write schema and old failed-arm compatibility', async t => {
  const cases = [
    ...malformedNativeFailures.map(value => ({ value })),
    { value: nativeFailure, name: 'cairn' },
    { value: nativeFailure, stage: 'answer' },
    { value: nativeFailure, completed: true },
    { value: nativeFailure, accepted: true },
    { value: syntheticHttpClientFailure(), accepted: true },
    { omitted: true, accepted: true },
  ];
  for (const item of cases) {
    const name = item.name ?? 'mem0';
    const fixture = fixtureFor(t, { order: [name, name === 'mem0' ? 'cairn' : 'mem0'] });
    const generation = await syntheticScoringGeneration(fixture, fixture.guard);
    const result = structuredClone(generation.cases[0].arms.find(arm => arm.name === name));
    if (!item.completed) Object.assign(result, { status: 'failed', reason: 'arm_failed', answer: null });
    result.diagnostics = { stage: item.stage ?? 'execution',
      ...(item.omitted ? {} : { nativeFailure: item.value }) };
    const journal = fixture.journal();
    startMixedJournalPhase(journal, 'generation', fixture.prepared);
    enterMixedJournalArm(journal, 'generation', 0);
    const record = () => recordMixedJournalArm(journal, 'generation', 0, generation.cases[0], result);
    if (item.accepted) {
      record();
      const observed = inspectMixedResultJournal({ directory: fixture.directory });
      assert.deepEqual(observed.phases.generation.arms[0].result, reportSnapshot(result));
      assert.equal(Object.hasOwn(observed.phases.generation.arms[0].result.diagnostics,
        'nativeFailure'), !item.omitted);
    } else {
      assert.throws(record, { code: 'mixed_result_journal_failed' });
      assert.deepEqual(inspectMixedResultJournal({ directory: fixture.directory })
        .phases.generation.arms.map(arm => arm.state), ['entered', 'unobserved']);
      assert.throws(record, { code: 'mixed_result_journal_failed' }, 'rejected writer stays poisoned');
    }
  }
});

test('NHC3 genuine kernel provenance survives private journal and scorer input roundtrip', async t => {
  const observed = await nativeClientErrorProbe(t, 'bad-header');
  const nativeFailure = projectMixedNativeFailure(observed.innerError);
  const fixture = fixtureFor(t);
  const generation = structuredClone(await syntheticScoringGeneration(fixture, fixture.guard));
  const native = generation.cases[0].arms.find(arm => arm.name === 'mem0');
  Object.assign(native, { status: 'failed', reason: 'arm_failed', answer: null,
    diagnostics: { stage: 'execution', nativeFailure } });
  const report = freeze(reportSnapshot(generation));
  const journal = fixture.journal();
  startMixedJournalPhase(journal, 'generation', fixture.prepared);
  for (const [ordinal, name] of report.roster[0].armOrder.entries()) {
    enterMixedJournalArm(journal, 'generation', ordinal);
    recordMixedJournalArm(journal, 'generation', ordinal, report.cases[0],
      report.cases[0].arms.find(arm => arm.name === name));
  }
  const retained = inspectMixedResultJournal({ directory: fixture.directory })
    .phases.generation.arms.find(arm => arm.name === 'mem0').result.diagnostics.nativeFailure;
  assert.deepEqual(retained, reportSnapshot(nativeFailure));
  const scored = await score(fixture, report);
  assert.equal(scored.summary.fixedN, 1);
  assert.equal(scored.summary.perArm.mem0.unresolved, 1);
  assert.equal(scored.summary.perArm.cairn.correct, 1);
  assert.equal(scored.cases[0].arms.find(arm => arm.name === 'mem0').judgment.attempted, false);
});

test('NHC3 journal and scorer reject hostile nested metadata before traps or provider entry', async t => {
  let invoked = 0;
  for (const corrupt of [
    row => { row.httpClientError = new Proxy(row.httpClientError, {
      ownKeys() { invoked++; throw Error('PRIVATE_CANARY'); },
      getPrototypeOf() { invoked++; throw Error('PRIVATE_CANARY'); },
    }); },
    row => { Object.defineProperty(row.httpClientError, 'code', {
      enumerable: true, get() { invoked++; return 'ECONNRESET'; } }); },
    row => { Object.defineProperty(row.httpClientError, 'code', { enumerable: false }); },
    row => { Object.defineProperty(row, 'httpClientError', { enumerable: false }); },
    row => { row.httpClientError.code = 'PRIVATE_UNKNOWN_CODE'; },
    row => { row.httpClientError.connectionAgeMs = 2_147_483_648; },
  ]) {
    const fixture = fixtureFor(t);
    const generation = structuredClone(await syntheticScoringGeneration(fixture, fixture.guard));
    const value = syntheticHttpClientFailure(); corrupt(value);
    const native = generation.cases[0].arms.find(arm => arm.name === 'mem0');
    Object.assign(native, { status: 'failed', reason: 'arm_failed', answer: null,
      diagnostics: { stage: 'execution', nativeFailure: value } });
    // Freeze the report root without traversing hostile nested data in the fixture.
    Object.freeze(generation);
    const calls = fixture.fake.calls.length;
    await assert.rejects(score(fixture, generation), { code: 'invalid_mixed_report' });
    assert.equal(fixture.fake.calls.length, calls);
    const journal = fixture.journal();
    startMixedJournalPhase(journal, 'generation', fixture.prepared);
    enterMixedJournalArm(journal, 'generation', 0);
    recordMixedJournalArm(journal, 'generation', 0, generation.cases[0], generation.cases[0].arms[0]);
    enterMixedJournalArm(journal, 'generation', 1);
    assert.throws(() => recordMixedJournalArm(journal, 'generation', 1, generation.cases[0], native),
      { code: 'mixed_result_journal_failed' });
    assert.equal(fixture.fake.calls.length, calls);
  }
  assert.equal(invoked, 0);
});

test('IC3/IC5 coherently rehashed native failure offline reads refuse malformed and wrong contexts', async t => {
  const cases = [...malformedNativeFailures.map(value => ({ value })),
    { value: nativeFailure, name: 'cairn' }, { value: nativeFailure, stage: 'preflight' }];
  for (const item of cases) {
    const name = item.name ?? 'mem0';
    const fixture = fixtureFor(t, { preflight: true, order: [name, name === 'mem0' ? 'cairn' : 'mem0'] });
    await generate(fixture, fixture.journal());
    const file = join(fixture.directory, '000003.json');
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    record.data.result.diagnostics = { stage: item.stage ?? 'execution', nativeFailure: item.value };
    const { digest: _digest, ...body } = record;
    record.digest = hash('cairn.lme.mixed.result-journal-record.v1', body);
    fs.writeFileSync(file, JSON.stringify(record));
    // A coherently hashed prefix isolates shape/context rejection from later links.
    for (const filename of fs.readdirSync(fixture.directory)) {
      if (/^\d{6}\.json$/u.test(filename) && filename > '000003.json') fs.unlinkSync(join(fixture.directory, filename));
    }
    assert.throws(() => inspectMixedResultJournal({ directory: fixture.directory }),
      { code: 'invalid_mixed_result_journal' });
  }
});

for (const order of [['cairn', 'mem0'], ['mem0', 'cairn']]) {
  test(`RD1/RD2/RD5 preflight failure completes privately in ${order.join('/')} order`, async t => {
    const fixture = fixtureFor(t, { order, preflight: true });
    const journal = fixture.journal();
    const generation = await generate(fixture, journal);
    assert.deepEqual(generation.cases[0].arms.map(arm => arm.status), ['failed', 'failed']);
    assert.equal(fixture.fake.calls.length, 0);
    const scored = await score(fixture, generation, journal);
    const observed = inspectMixedResultJournal({ directory: fixture.directory });
    for (const phase of ['generation', 'scoring']) {
      const view = observed.phases[phase];
      assert.deepEqual(view.arms.map(arm => arm.name), order);
      assert.ok(view.arms.every(arm => arm.state === 'terminal'));
      assert.deepEqual(view.completion.report, phase === 'generation' ? generation : scored);
    }
    assert.equal(scored.summary.fixedN, 1);
    assert.equal(scored.summary.perArm.cairn.unresolved, 1);
    await fixture.workspace.cleanup();
    assert.equal(fs.existsSync(fixture.root), false);
  });
  test(`RD5/RD8 real scoring complete and judge failure in ${order.join('/')} order`, async t => {
    const fixture = fixtureFor(t, { order, override: (_url, body) => body.model === 'gpt-4o-2024-08-06'
      ? Response.json({ object: 'chat.completion', model: body.model,
        choices: [{ index: 1, finish_reason: 'stop', message: { role: 'assistant', content: 'yes' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }) : undefined });
    const journal = fixture.journal();
    const generation = await syntheticScoringGeneration(fixture, fixture.guard, journal);
    const evaluators = [evaluatorRow()];
    evaluators[0].reference_answer = 'EVALUATOR_REFERENCE_CANARY';
    const scored = await scoreMixedGeneration({ generationReport: generation,
      evaluatorRows: evaluators, referenceRenderings: undefined, guard: fixture.guard,
      apiKey: 'JOURNAL_KEY_CANARY', resultJournal: journal });
    const observed = inspectMixedResultJournal({ directory: fixture.directory });
    assert.deepEqual(observed.phases.scoring.completion.report, scored);
    assert.ok(observed.phases.scoring.arms.every(arm => arm.result.judgment.status === 'unresolved'));
    assert.equal(scored.summary.fixedN, 1);
    const files = fs.readdirSync(fixture.directory).map(name => {
      assert.equal(fs.lstatSync(join(fixture.directory, name)).mode & 0o777, 0o600);
      return fs.readFileSync(join(fixture.directory, name), 'utf8');
    }).join('\n');
    assert.equal(fs.lstatSync(fixture.directory).mode & 0o777, 0o700);
    assert.equal(files.includes('JOURNAL_KEY_CANARY'), false);
    assert.equal(files.includes('EVALUATOR_REFERENCE_CANARY'), false);
    assert.equal(files.includes('reference_answer'), false);
    const attempts = fixture.guard.attempts().length;
    await assert.rejects(score(fixture, generation, journal), { code: 'invalid_mixed_report' });
    assert.throws(() => startMixedJournalPhase(journal, 'scoring', generation),
      { code: 'mixed_result_journal_failed' });
    assert.equal(fixture.guard.attempts().length, attempts);
  });
}

test('RD1 invalid option, mismatched process identity and reused storage reject before dispatch', async t => {
  const fixture = fixtureFor(t, { preflight: true });
  for (const directory of ['relative', fixture.root, join(fixture.root, 'missing', 'journal')]) {
    assert.throws(() => createMixedResultJournal({ directory, prepared: fixture.prepared }),
      { code: 'invalid_mixed_result_journal' });
  }
  fs.mkdirSync(join(fixture.root, 'public'), { mode: 0o755 });
  assert.throws(() => createMixedResultJournal({ directory: join(fixture.root, 'public', 'journal'),
    prepared: fixture.prepared }), { code: 'invalid_mixed_result_journal' });
  fs.symlinkSync(fixture.root, join(fixture.root, 'link'));
  assert.throws(() => createMixedResultJournal({ directory: join(fixture.root, 'link', 'journal'),
    prepared: fixture.prepared }), { code: 'invalid_mixed_result_journal' });
  const journal = fixture.journal();
  assert.throws(() => fixture.journal(), { code: 'invalid_mixed_result_journal' });
  const other = prepareMixedComparison({ sourceCases: [fixture.row], armOrders: [['cairn', 'mem0']],
    nativeArtifact: fixture.descriptors.artifact, nativeConfiguration: fixture.descriptors.configuration,
    cairnRuntimeArtifactSha256: '5'.repeat(64) });
  await assert.rejects(runMixedGeneration({ prepared: other, guard: fixture.guard,
    apiKey: 'JOURNAL_KEY_CANARY', cairnStoreRoot: fixture.root, resultJournal: journal }),
  { code: 'invalid_mixed_result_journal' });
  assert.equal(fixture.fake.calls.length, 0);
  assert.equal(fixture.guard.caseOutcomes().scopes.length, 0);
  await assert.rejects(generate(fixture, journal), { code: 'invalid_mixed_result_journal' });
  assert.equal(fixture.guard.caseOutcomes().scopes.length, 0);
  const invalid = fixtureFor(t, { preflight: true });
  await assert.rejects(runMixedGeneration({ prepared: invalid.prepared, guard: invalid.guard,
    apiKey: 'JOURNAL_KEY_CANARY', cairnStoreRoot: invalid.root, resultJournal: undefined }),
  { code: 'invalid_mixed_result_journal' });
  assert.equal(invalid.guard.caseOutcomes().scopes.length, 0);
});

test('RD3 failed terminal fsync barrier stops before any second scope or dispatch', async t => {
  const fixture = fixtureFor(t);
  const journal = fixture.journal();
  const original = fs.fsyncSync;
  let failure = false;
  t.mock.method(fs, 'fsyncSync', fd => {
    if (fixture.guard.caseOutcomes().scopes.length === 1) {
      failure = true; throw new Error('ARBITRARY_ERROR_CANARY');
    }
    return original(fd);
  });
  await assert.rejects(generate(fixture, journal), { code: 'mixed_result_journal_failed' });
  assert.equal(failure, true);
  assert.equal(fixture.guard.caseOutcomes().scopes.length, 1);
  assert.equal(fixture.fake.calls.filter(call => call.body.messages?.[0]?.role === 'system').length, 1);
  assert.equal(fixture.fake.calls.some(call => call.route === '/v1/embeddings'), false);
  const observed = inspectMixedResultJournal({ directory: fixture.directory });
  assert.deepEqual(observed.phases.generation.arms.map(arm => arm.state), ['entered', 'unobserved']);
  assert.equal(observed.phases.generation.completion, null);
  assert.equal(fs.readdirSync(fixture.directory).some(name => name === '000003.json'), false);
});

test('RD3 atomic publication never overwrites an existing committed record', t => {
  const fixture = fixtureFor(t);
  const journal = fixture.journal();
  const file = join(fixture.directory, '000001.json');
  fs.writeFileSync(file, 'earlier-owner-record', { mode: 0o600, flag: 'wx' });
  assert.throws(() => startMixedJournalPhase(journal, 'generation', fixture.prepared),
    { code: 'mixed_result_journal_failed' });
  assert.equal(fs.readFileSync(file, 'utf8'), 'earlier-owner-record');
  assert.equal(fixture.fake.calls.length, 0);
});

test('RD4 interrupted observation distinguishes entered and unobserved without authority', t => {
  const fixture = fixtureFor(t);
  const journal = fixture.journal();
  startMixedJournalPhase(journal, 'generation', fixture.prepared);
  enterMixedJournalArm(journal, 'generation', 0);
  const observed = inspectMixedResultJournal({ directory: fixture.directory });
  assert.deepEqual(observed.phases.generation.arms.map(arm => arm.state), ['entered', 'unobserved']);
  assert.equal(observed.phases.generation.completion, null);
  assert.equal(observed.phases.scoring.started, false);
  assert.equal(fixture.guard.attempts().length, 0);
  assert.equal(Object.hasOwn(observed, 'summary'), false);
});

test('RD4 malformed, truncated, reordered and forged observations refuse', async t => {
  for (const fault of ['truncated', 'digest', 'order', 'forged', 'mode', 'symlink', 'reason']) {
    const fixture = fixtureFor(t, { preflight: true });
    await generate(fixture, fixture.journal());
    const file = join(fixture.directory, '000003.json');
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (fault === 'truncated') fs.writeFileSync(file, '{');
    if (fault === 'digest') { record.data.result.reason = 'forged'; fs.writeFileSync(file, JSON.stringify(record)); }
    if (['order', 'forged', 'reason'].includes(fault)) {
      if (fault === 'order') record.data.ordinal = 1;
      if (fault === 'reason') record.data.result.reason = false;
      if (fault === 'forged') record.data.result.answer = { text: 'forged', usage: { inputTokens: 1,
        outputTokens: 1, costMicroUsd: 1 } };
      const { digest: _digest, ...body } = record;
      record.digest = hash('cairn.lme.mixed.result-journal-record.v1', body);
      fs.writeFileSync(file, JSON.stringify(record));
      // Keep the coherently hashed prefix so rejection proves the schema/order
      // invariant itself, rather than a downstream previous-digest mismatch.
      for (const name of fs.readdirSync(fixture.directory)) {
        if (/^\d{6}\.json$/u.test(name) && name > '000003.json') fs.unlinkSync(join(fixture.directory, name));
      }
    }
    if (fault === 'mode') fs.chmodSync(file, 0o644);
    if (fault === 'symlink') { fs.renameSync(file, file + '.target'); fs.symlinkSync(file + '.target', file); }
    assert.throws(() => inspectMixedResultJournal({ directory: fixture.directory }),
      { code: 'invalid_mixed_result_journal' }, fault);
  }
});

test('RD1/RD5 scoring report validation and journal identity remain separate gates', async t => {
  const fixture = fixtureFor(t);
  const journal = fixture.journal();
  const report = await syntheticScoringGeneration(fixture, fixture.guard, journal);
  const changed = structuredClone(report);
  changed.cases[0].arms[0].scope.ordinal = 99;
  await assert.rejects(score(fixture, freeze(changed), journal), { code: 'invalid_mixed_report' });
  await assert.rejects(score(fixture, freeze(structuredClone(report)), journal),
    { code: 'invalid_mixed_result_journal' });
  assert.equal(fixture.fake.calls.filter(call => call.body.model === 'gpt-4o-2024-08-06').length, 0);
});

test('RD1/RD8 unjournaled generation and scoring retain existing schemas and behavior', async t => {
  const fixture = fixtureFor(t, { preflight: true });
  const generation = await generate(fixture);
  const scored = await score(fixture, generation);
  assert.equal(generation.schemaVersion, 'cairn-lme-mixed-generation-v1');
  assert.equal(scored.schemaVersion, 'cairn-lme-mixed-scoring-v1');
  assert.equal(fs.existsSync(fixture.directory), false);
  assert.equal(scored.summary.perArm.mem0.unresolved, 1);
});

test('RD2/RD5 halted observation completion retains unresolved and unobserved, never success', async t => {
  const fixture = fixtureFor(t, { override: (_url, body) => body.model === 'gpt-4o-2024-08-06'
    ? Response.json({ choices: [] }) : undefined });
  const journal = fixture.journal();
  const generation = await syntheticScoringGeneration(fixture, fixture.guard, journal);
  const scored = await score(fixture, generation, journal);
  assert.equal(scored.halted, true);
  const view = inspectMixedResultJournal({ directory: fixture.directory }).phases.scoring;
  assert.deepEqual(view.arms.map(arm => arm.state), ['terminal', 'unobserved']);
  assert.equal(view.arms[0].result.judgment.status, 'unresolved');
  assert.equal(view.completion.report.halted, true);
  assert.equal(view.completion.report.summary.perArm.mem0.unresolved, 1);
});

test('RD3 replaced journal directory stops before generation dispatch', async t => {
  const fixture = fixtureFor(t);
  const journal = fixture.journal();
  fs.renameSync(fixture.directory, fixture.directory + '.retained');
  fs.mkdirSync(fixture.directory, { mode: 0o700 });
  await assert.rejects(generate(fixture, journal), { code: 'mixed_result_journal_failed' });
  assert.equal(fixture.guard.caseOutcomes().scopes.length, 0);
  assert.equal(fixture.fake.calls.length, 0);
});

test('RD3 failed directory fsync barrier prevents the next scope after publication', async t => {
  const fixture = fixtureFor(t);
  const journal = fixture.journal();
  const original = fs.fsyncSync;
  t.mock.method(fs, 'fsyncSync', fd => {
    if (fixture.guard.caseOutcomes().scopes.length === 1 && fs.fstatSync(fd).isDirectory()) {
      throw new Error('DIRECTORY_FSYNC_CANARY');
    }
    return original(fd);
  });
  await assert.rejects(generate(fixture, journal), { code: 'mixed_result_journal_failed' });
  assert.equal(fixture.guard.caseOutcomes().scopes.length, 1);
  assert.equal(fixture.fake.calls.some(call => call.route === '/v1/embeddings'), false);
  assert.equal(fs.existsSync(join(fixture.directory, '000004.json')), false);
});

test('RD4 oversized committed files reject before loading their content', t => {
  const fixture = fixtureFor(t);
  fixture.journal();
  fs.truncateSync(join(fixture.directory, '000000.json'), 40 * 1024 * 1024 + 1);
  assert.throws(() => inspectMixedResultJournal({ directory: fixture.directory }),
    { code: 'invalid_mixed_result_journal' });
});

test('RD1 own accessor options reject without invoking them', async t => {
  const fixture = fixtureFor(t, { preflight: true });
  let invoked = false;
  const options = { directory: fixture.directory };
  Object.defineProperty(options, 'prepared', { enumerable: true, get() { invoked = true; return fixture.prepared; } });
  assert.throws(() => createMixedResultJournal(options), { code: 'invalid_mixed_result_journal' });
  const generationOptions = { prepared: fixture.prepared, guard: fixture.guard,
    apiKey: 'JOURNAL_KEY_CANARY', cairnStoreRoot: fixture.root };
  Object.defineProperty(generationOptions, 'resultJournal', { enumerable: true,
    get() { invoked = true; return fixture.journal(); } });
  await assert.rejects(runMixedGeneration(generationOptions), { code: 'invalid_mixed_generation' });
  assert.equal(invoked, false);
  assert.equal(fixture.guard.caseOutcomes().scopes.length, 0);
});

test('RD9 owned runner cleans the exact RED assertion failure without residual fixtures', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-journal-failure-parent-' });
  const child = spawn(process.execPath, ['tools/testing/run.mjs',
    '--test-name-pattern=RD7 generation interruption', 'evaluation/longmemeval/test/mixed-result-journal.test.mjs'],
  { env: { ...process.env, CAIRN_MIXED_JOURNAL_BASELINE: '1', NODE_DISABLE_COMPILE_CACHE: '1',
    TMPDIR: workspace.path, TMP: workspace.path, TEMP: workspace.path, NODE_TEST_CONTEXT: '' },
  stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const exited = new Promise(resolve => child.once('close', code => resolve(code)));
  workspace.defer(async () => { child.kill('SIGTERM'); await exited; });
  assert.equal(await exited, 1, output);
  assert.ok(output.includes('first actual completed arm must survive SIGKILL'), output);
  assert.ok(output.includes("Synthetic memory fact."), output);
  assert.deepEqual(fs.readdirSync(workspace.path), []);
});

test('RD3 failed scoring persistence barrier prevents the second judge dispatch', async t => {
  const fixture = fixtureFor(t);
  const journal = fixture.journal();
  const generation = await syntheticScoringGeneration(fixture, fixture.guard, journal);
  const original = fs.fsyncSync;
  t.mock.method(fs, 'fsyncSync', fd => {
    if (fixture.guard.caseOutcomes().scopes.length === 3) throw new Error('SCORING_FSYNC_CANARY');
    return original(fd);
  });
  await assert.rejects(score(fixture, generation, journal), { code: 'mixed_result_journal_failed' });
  assert.equal(fixture.guard.caseOutcomes().scopes.length, 3);
  assert.equal(fixture.fake.calls.filter(call => call.body.model === 'gpt-4o-2024-08-06').length, 1);
  const observed = inspectMixedResultJournal({ directory: fixture.directory });
  assert.deepEqual(observed.phases.scoring.arms.map(arm => arm.state), ['entered', 'unobserved']);
});

test('RD4 coherently hashed forged summary and extra identity fields reject', async t => {
  const fixture = fixtureFor(t);
  const journal = fixture.journal();
  const generation = await syntheticScoringGeneration(fixture, fixture.guard, journal);
  await score(fixture, generation, journal);
  const names = fs.readdirSync(fixture.directory).sort();
  const file = join(fixture.directory, names.at(-1));
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  record.data.report.summary.perArm.cairn.correct = 99;
  record.data.reportDigest = hash('cairn.lme.mixed.result-journal-report.v1', record.data.report);
  const { digest: _digest, ...body } = record;
  record.digest = hash('cairn.lme.mixed.result-journal-record.v1', body);
  fs.writeFileSync(file, JSON.stringify(record));
  assert.throws(() => inspectMixedResultJournal({ directory: fixture.directory }),
    { code: 'invalid_mixed_result_journal' });
  const prepared = structuredClone(fixture.prepared);
  prepared.manifest.apiKey = 'FORGED_KEY_CANARY';
  freeze(prepared);
  const directory = join(fixture.root, 'forged');
  assert.throws(() => createMixedResultJournal({ directory, prepared }),
    { code: 'invalid_mixed_result_journal' });
  assert.equal(fs.existsSync(directory), false);
});

test('RD4/RD5 a coherently hashed halted report cannot promote an unobserved arm', async t => {
  const fixture = fixtureFor(t, { override: (url, body) => url.endsWith('/chat/completions')
    && !body.response_format ? Response.json({ choices: [] }) : undefined });
  const generation = await generate(fixture, fixture.journal());
  assert.equal(generation.halted, true);
  const observed = inspectMixedResultJournal({ directory: fixture.directory });
  assert.deepEqual(observed.phases.generation.arms.map(arm => arm.state), ['terminal', 'unobserved']);
  const file = join(fixture.directory, fs.readdirSync(fixture.directory).sort().at(-1));
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  Object.assign(record.data.report.cases[0].arms[1], { status: 'completed', reason: null,
    answer: { text: 'forged', usage: { inputTokens: 1, outputTokens: 1, costMicroUsd: 1 } },
    scope: { ordinal: 1, status: 'completed', reason: null } });
  record.data.reportDigest = hash('cairn.lme.mixed.result-journal-report.v1', record.data.report);
  const { digest: _digest, ...body } = record;
  record.digest = hash('cairn.lme.mixed.result-journal-record.v1', body);
  fs.writeFileSync(file, JSON.stringify(record));
  assert.throws(() => inspectMixedResultJournal({ directory: fixture.directory }),
    { code: 'invalid_mixed_result_journal' });
});

test('RD1/RD5 existing indexed-evidence profile round-trips both journaled phases unchanged', async t => {
  const fixture = fixtureFor(t, { preflight: true, comparisonProfile: 'indexed-evidence-v1' });
  const manifest = fixture.prepared.manifest;
  const journal = fixture.journal();
  const generation = await generate(fixture, journal);
  const scored = await score(fixture, generation, journal);
  const observed = inspectMixedResultJournal({ directory: fixture.directory });
  assert.equal(canonical(generation.manifest), canonical(manifest));
  assert.equal(canonical(observed.identity.manifest), canonical(manifest));
  assert.equal(manifest.cairn.comparisonProfile, 'indexed-evidence-v1');
  assert.equal(manifest.cairn.qualificationInputProfile, 'not-requested');
  assert.equal(manifest.cairn.captureSourcePolicy, 'indexed-evidence-v1');
  assert.deepEqual(observed.phases.generation.completion.report, generation);
  assert.deepEqual(observed.phases.scoring.completion.report, scored);
  assert.equal(scored.summary.fixedN, 1);
  assert.equal(scored.summary.commonResolvedN, 0);
  assert.equal(fixture.fake.calls.length, 0);
});

test('JO2/JO3 journaled generation and scoring accept both observations with original report identity', async t => {
  const fixture = fixtureFor(t);
  const resultJournal = fixture.journal();
  const generation = await runMixedGeneration({ prepared: fixture.prepared, guard: fixture.guard,
    apiKey: 'JOURNAL_KEY_CANARY', cairnStoreRoot: fixture.root, resultJournal,
    phaseTiming: 'bounded-tail-v1', recallWitness: 'bounded-v1' });
  const cairn = generation.cases[0].arms.find(arm => arm.name === 'cairn');
  assert.equal(cairn.status, 'completed');
  assert.ok(cairn.diagnostics.adapterPhaseTiming);
  assert.equal(cairn.diagnostics.recallWitness.closed, true);
  assert.equal(cairn.diagnostics.recallWitness.disposed, true);
  const scored = await score(fixture, generation, resultJournal);
  const observed = inspectMixedResultJournal({ directory: fixture.directory });
  assert.deepEqual(observed.phases.generation.completion.report, generation);
  assert.deepEqual(observed.phases.scoring.completion.report, scored);
  assert.deepEqual(observed.phases.generation.arms[0].result.diagnostics, cairn.diagnostics);
});
