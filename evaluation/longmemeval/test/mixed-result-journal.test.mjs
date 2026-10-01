import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import test from 'node:test';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';

import { prepareMixedComparison, runMixedGeneration } from '../mixed-generation.mjs';
import { scoreMixedGeneration } from '../mixed-scoring.mjs';
import { createMixedResultJournal, inspectMixedResultJournal, startMixedJournalPhase,
  enterMixedJournalArm } from '../mixed-result-journal.mjs';
import { canonical, freeze, hash } from '../mixed-validation.mjs';
import { evaluatorRow, fakeMixedHttp, sourceRow, syntheticMixedFixture } from '../testing/mixed-fixture.mjs';
import { interruption, syntheticNativeDescriptors,
  syntheticScoringGeneration } from '../testing/result-journal-fixture.mjs';

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
