import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { createOwnedGitFixture } from '../../../tools/testing/owned-git-fixture.mjs';
import { createExperimentBudget, inspectExperimentBudgetForEmbeddingUpgrade, upgradeExperimentBudgetForEmbeddings,
  inspectEmbeddingExperimentBudgetSnapshot, reopenEmbeddingExperimentBudget } from '../../experiment-budget/index.mjs';
import { RELATION_BINDING_INSTRUCTION, packMixedAnswer } from '../../longmemeval/mixed-answer.mjs';
import { RELATION_BINDING_VERSION, loadRelationBindingInputs, validateRelationBindingInputs, relationBindingLimits } from '../relation-binding-profile.mjs';
import { planRelationBindingAnswers } from '../relation-binding-probe.mjs';
import { aggregateRelationBindingJudgments, buildBlindRelationBindingPacket, freezeRelationBindingRubric, freezeRelationBindingSources,
  loadRelationBindingRubric, loadRelationBindingSources, unblindRelationBindingJudgments } from '../relation-binding-evaluator.mjs';
import { sha256 } from '../../longmemeval/mixed-validation.mjs';
import { createRelationBindingTransport } from '../transport.mjs';

// Tiny plumbing data, not a second authored relation-quality corpus.
const sources = () => ({ schemaVersion: RELATION_BINDING_VERSION, cases: Array.from({ length: 12 }, (_, i) => ({
  id: `R${String(i + 1).padStart(2, '0')}`, family: 'synthetic-plumbing',
  question: { text: `Where is synthetic item ${i + 1}?`, date: '2026-08-12' },
  sourceUnits: [{ recordedRole: 'user', eventAt: '2026-08-01T09:00:00.000Z', text: 'Synthetic item uses component C.' },
    { recordedRole: 'assistant', eventAt: '2026-08-02T09:00:00Z', text: 'Component C was recorded in bay A.' }] })) });
const rubric = () => ({ schemaVersion: `${RELATION_BINDING_VERSION}-rubric`, cases: Object.fromEntries(sources().cases.map((row, i) => [row.id, {
  answerability: i < 6 ? 'known' : 'uncertain', requiredPropositions: ['Synthetic required relation.'],
  acceptableQualifications: [], unsupportedClaims: ['Synthetic wrong join.'], staleUseCriteria: [], severeErrors: ['Synthetic severe join.'],
}])) });
const rubricFreeze = () => freezeRelationBindingRubric(JSON.stringify(rubric()));
const sourceFreeze = () => freezeRelationBindingSources(JSON.stringify(sources()));
const response = body => Response.json({ object: 'chat.completion', model: body.model,
  choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Synthetic answer.' } }],
  usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 } });
function ledger(workspace, overrides = {}) {
  const configuration = { directory: join(workspace.path, `ledger-${randomUUID()}`), runId: randomUUID(),
    limitMicroUsd: 400_000_000, requestCap: 100_000, ...overrides };
  createExperimentBudget(configuration).close(); const old = inspectExperimentBudgetForEmbeddingUpgrade(configuration);
  upgradeExperimentBudgetForEmbeddings({ ...configuration, expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 }, expectedHistorySha256: old.historySha256 });
  return configuration;
}
const review = manifest => ({ manifestSha256: manifest.sha256,
  standards: { reviewerId: 'synthetic-standards', decision: 'approved' }, spec: { reviewerId: 'synthetic-spec', decision: 'approved' } });
async function fixture(t) {
  const workspace = createTestWorkspace(t, { prefix: 'relation-binding-probe-' });
  const root = fileURLToPath(new URL('../../../', import.meta.url)), owned = createOwnedGitFixture(workspace), checkout = owned.path;
  const archive = execFileSync('/usr/bin/git', ['archive', 'HEAD'], { cwd: root, maxBuffer: 128 * 1024 * 1024 });
  execFileSync('/usr/bin/tar', ['-x', '-C', checkout], { input: archive });
  for (const directory of ['evaluation/algorithm-development', 'evaluation/longmemeval'])
    cpSync(join(root, directory), join(checkout, directory), { recursive: true });
  cpSync(join(root, 'adapters/openai/node_modules'), join(checkout, 'adapters/openai/node_modules'), { recursive: true });
  cpSync(join(root, 'docs/plans/relation-binding-probe.md'), join(checkout, 'docs/plans/relation-binding-probe.md'));
  const sourcePath = join(checkout, 'evaluation/algorithm-development/relation-binding-cases.json');
  writeFileSync(sourcePath, JSON.stringify(sources()));
  writeFileSync(join(checkout, 'evaluation/algorithm-development/relation-binding-rubric.json'), JSON.stringify(rubric()));
  owned.commit('Owned synthetic relation-binding fixture');
  const module = await import(pathToFileURL(join(checkout, 'evaluation/algorithm-development/relation-binding-probe.mjs')));
  const configuration = ledger(workspace), outputDirectory = join(workspace.path, 'output'); mkdirSync(outputDirectory, { mode: 0o700 });
  const manifest = module.prepareRelationBindingProbe({ configuration, outputDirectory });
  return { workspace, checkout, owned, module, configuration, outputDirectory, manifest, sourcePath };
}
test('RB1 independent corpus fits the integrated source-only profile and all 24 final requests', () => {
  const source = loadRelationBindingInputs(), rules = loadRelationBindingRubric(), planned = planRelationBindingAnswers(source);
  assert.equal(source.cases.length, 12); assert.equal(planned.length, 24);
  assert.equal(Object.values(rules.rubric.cases).filter(rule => rule.answerability === 'known').length, 6);
  assert.equal(Object.values(rules.rubric.cases).filter(rule => rule.answerability === 'uncertain').length, 6);
  assert.ok(planned.every(cell => cell.inputTokens <= 6000));
  for (const cell of planned) {
    const request = JSON.parse(cell.requestBody), data = JSON.parse(request.messages[1].content);
    assert.deepEqual(Object.keys(data), ['evidence', 'currentQuestion']);
    assert.deepEqual(Object.keys(data.currentQuestion), ['text', 'date']);
    assert.equal(data.evidence.length, source.cases[cell.ordinal - 1].sourceUnits.length);
    assert.equal(data.evidence.some(unit => JSON.parse(unit.text).sources.some(row => Object.hasOwn(row, 'answerability'))), false);
  }
});
test('RB1/RB4 source-only closed roster, UTC normalization, gold exclusion and exact pair planning', () => {
  const source = sources(), planned = planRelationBindingAnswers(source);
  assert.equal(planned.length, 24);
  assert.equal(planned.filter((row, i) => i % 2 === 0 && row.arm === 'baseline').length, 6);
  for (let i = 0; i < 24; i += 2) {
    const first = JSON.parse(planned[i].requestBody), second = JSON.parse(planned[i + 1].requestBody);
    assert.notEqual(first.messages[0].content, second.messages[0].content);
    second.messages[0].content = first.messages[0].content; assert.deepEqual(second, first);
    for (const cell of planned.slice(i, i + 2)) {
      assert.ok(cell.inputTokens < 6000); const text = cell.requestBody;
      assert.equal(text.includes('synthetic-plumbing'), false); assert.equal(/R0[1-9]|R1[0-2]/u.test(text), false);
      const rendered = JSON.parse(JSON.parse(text).messages[1].content).evidence.map(unit => JSON.parse(unit.text).sources[0]);
      assert.equal(rendered[0].recordedRole, 'user'); assert.ok(rendered[0].text.includes(source.cases[i / 2].sourceUnits[0].text));
      assert.ok(rendered[0].text.includes('2026-08-01T09:00:00.000Z'));
    }
  }
  for (const mutate of [value => value.cases[0].gold = 'leak', value => value.cases[0].sourceUnits[0].eventAt = '2026-02-30T09:00:00.000Z',
    value => value.cases[0].sourceUnits[0].text = 'x'.repeat(4001), value => value.cases[0].sourceUnits[0].recordedRole = 'system']) {
    const changed = sources(); mutate(changed); assert.throws(() => validateRelationBindingInputs(changed));
  }
  const unicode = sources(); unicode.cases[0].sourceUnits[0].text = '🌱'.repeat(3990);
  unicode.cases[0].sourceUnits[1].text = 'C'; assert.doesNotThrow(() => validateRelationBindingInputs(unicode));
  assert.throws(() => planRelationBindingAnswers(unicode), { code: 'relation_binding_context_exceeded' });
  const module = readFileSync(new URL('../relation-binding-profile.mjs', import.meta.url), 'utf8');
  assert.equal(/readFileSync\([^\n]*rubric|from.*evaluator/u.test(module), false);
});
test('RB3/RB5 closed guarded transport sends one exact answer per arm, rejects core and retains old affordability', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'relation-binding-transport-' }), configuration = ledger(workspace);
  const initial = inspectEmbeddingExperimentBudgetSnapshot(configuration), calls = [];
  const transport = createRelationBindingTransport({ configuration, checkpoint: { requestCount: 0, reservedMicroUsd: 0 },
    historySha256: initial.historySha256, apiKey: 'synthetic-secret', fetchImpl: async (url, options) => {
      calls.push({ url, body: options.body }); return response(JSON.parse(options.body));
    } }); workspace.defer(() => transport.close());
  const planned = planRelationBindingAnswers(sources());
  for (let i = 0; i < 24; i++) {
    const cell = planned[i]; if (!(i % 2)) transport.beginCase({ id: cell.id, ordinal: cell.ordinal });
    transport.beginArm(cell.arm); const result = await transport.answer({ question: cell.question, units: cell.units });
    assert.equal(calls[i].body, cell.requestBody); assert.equal(JSON.stringify(result.packed.request), cell.requestBody);
    if (i % 2) transport.endCase();
  }
  assert.equal(calls.length, 24); assert.ok(calls.every(row => row.url.endsWith('/chat/completions')));
  const state = inspectEmbeddingExperimentBudgetSnapshot(configuration); assert.equal(state.requestCount, 24); assert.equal(state.reservedMicroUsd, 120_000);
  assert.equal(relationBindingLimits.reservedMicroUsd, 24 * 5000);
  assert.throws(() => transport.beginCase({ id: 'R13', ordinal: 13 }), { code: 'algorithm_lifecycle' });
  const small = ledger(workspace, { requestCap: 24 }), before = inspectEmbeddingExperimentBudgetSnapshot(small);
  assert.throws(() => createRelationBindingTransport({ configuration: small, checkpoint: { requestCount: 0, reservedMicroUsd: 0 },
    historySha256: before.historySha256, apiKey: 'synthetic-secret' }));
  assert.deepEqual(inspectEmbeddingExperimentBudgetSnapshot(small), before);
  const anotherConfig = ledger(workspace), anotherState = inspectEmbeddingExperimentBudgetSnapshot(anotherConfig);
  const another = createRelationBindingTransport({ configuration: anotherConfig, checkpoint: { requestCount: 0, reservedMicroUsd: 0 },
    historySha256: anotherState.historySha256, apiKey: 'synthetic-secret', fetchImpl: () => assert.fail('no core HTTP') });
  workspace.defer(() => another.close());
  await assert.rejects(another.model.extract({}), { code: 'algorithm_method_denied' });
});
test('RB5 prepare is readonly and 24 fake answers close once with exact snapshot/token/accounting manifest', async t => {
  const f = await fixture(t), before = inspectEmbeddingExperimentBudgetSnapshot(f.configuration); let calls = 0, keys = 0;
  assert.equal(f.manifest.planned.length, 24); assert.equal(f.manifest.limits.httpRequests, 24);
  assert.equal(f.manifest.affordabilityLimits.reservedMicroUsd, 10_000_000);
  assert.ok(f.manifest.artifactHashes['evaluation/algorithm-development/relation-binding-rubric.json']);
  assert.equal(existsSync(join(f.outputDirectory, 'started.json')), false);
  assert.deepEqual(f.module.prepareRelationBindingProbe({ configuration: f.configuration, outputDirectory: f.outputDirectory }), f.manifest);
  assert.deepEqual(inspectEmbeddingExperimentBudgetSnapshot(f.configuration), before);
  const options = { ...f, reviewReceipt: review(f.manifest), keyProvider: async () => {
    keys++; assert.equal(existsSync(join(f.outputDirectory, 'started.json')), true); return 'synthetic-key';
  }, fetchImpl: async (url, options) => { assert.equal(options.body, f.manifest.planned[calls++].requestBody); return response(JSON.parse(options.body)); } };
  const report = await f.module.executeRelationBindingProbe(options);
  assert.equal(report.denominator, 24); assert.equal(report.completed, 24); assert.equal(report.fatal, null);
  assert.equal(report.attempted, 24); assert.equal(report.dispatched, 24); assert.equal(calls, 24); assert.equal(keys, 1);
  assert.equal(report.records.length, 24); assert.deepEqual(report.sourceSnapshot, sources());
  assert.equal(report.resources.baseline.attemptedRequests, 12); assert.equal(report.resources.relation.attemptedRequests, 12);
  assert.ok(report.resources.relation.finalRequestLocalInputTokens > report.resources.baseline.finalRequestLocalInputTokens);
  assert.equal(report.resources.baseline.usageUnknownRequests, 0); assert.equal(report.resources.relation.reservedMicroUsd, 60_000);
  const closure = JSON.parse(readFileSync(join(f.outputDirectory, 'closure.json')));
  assert.equal(closure.reportAvailable, true); assert.equal(closure.requestSnapshots, 48);
  assert.equal(closure.finalBudget.reservedMicroUsd, 120_000);
  await assert.rejects(f.module.executeRelationBindingProbe(options), { code: 'output_already_used' }); assert.equal(keys, 1);
});
test('RB5 source/manifest/review tamper rejects before key, and post-key source mutation retains all slots', async t => {
  const f = await fixture(t); let keys = 0, http = 0;
  const options = { ...f, reviewReceipt: review(f.manifest), keyProvider: () => { keys++; return 'synthetic-key'; }, fetchImpl: () => { http++; assert.fail('no HTTP'); } };
  for (const mutate of [m => m.limits.httpRequests++, m => m.nodeSha256 = '0'.repeat(64), m => m.planned[0].requestBody += ' ',
    m => m.checkpoint.requestCount++, m => m.outputIdentity.ino++]) {
    const manifest = structuredClone(f.manifest); mutate(manifest);
    await assert.rejects(f.module.executeRelationBindingProbe({ ...options, manifest }), { code: 'manifest_mismatch' });
  }
  await assert.rejects(f.module.executeRelationBindingProbe({ ...options, reviewReceipt: { ...review(f.manifest), manifestSha256: '0'.repeat(64) } }), { code: 'relation_binding_review_missing' });
  assert.equal(keys, 0); assert.equal(existsSync(join(f.outputDirectory, 'started.json')), false);
  const original = readFileSync(f.sourcePath), before = inspectEmbeddingExperimentBudgetSnapshot(f.configuration);
  const report = await f.module.executeRelationBindingProbe({ ...options, keyProvider: () => {
    keys++; writeFileSync(f.sourcePath, '{'); return 'synthetic-key';
  } });
  assert.equal(report.fatal, 'runtime_not_clean'); assert.equal(report.completed, 0); assert.equal(report.cells.length, 24);
  assert.deepEqual(report.sourceSnapshot, JSON.parse(original)); assert.equal(http, 0);
  assert.deepEqual(inspectEmbeddingExperimentBudgetSnapshot(f.configuration), before);
});

test('RB5 credential rejection diagnostics never retain external secret codes', async t => {
  const f = await fixture(t);
  for (const asynchronous of [false, true]) {
    const configuration = ledger(f.workspace), before = inspectEmbeddingExperimentBudgetSnapshot(configuration);
    const ledgerBytes = readFileSync(join(configuration.directory, 'experiment-budget.sqlite'));
    const outputDirectory = join(f.workspace.path, `key-code-${asynchronous}`); mkdirSync(outputDirectory, { mode: 0o700 });
    const manifest = f.module.prepareRelationBindingProbe({ configuration, outputDirectory });
    const sensitive = 'synthetic-sensitive-key-code-not-a-returned-credential'; let calls = 0, keys = 0;
    const reject = () => { keys++; throw Object.assign(new Error('synthetic-private-message'), { code: sensitive }); };
    const report = await f.module.executeRelationBindingProbe({ configuration, outputDirectory, manifest,
      reviewReceipt: review(manifest), keyProvider: asynchronous ? async () => reject() : reject,
      fetchImpl: () => { calls++; assert.fail('credential failure must not dispatch'); } });
    assert.equal(report.fatal, 'relation_binding_credential_lookup_failure');
    assert.equal(report.denominator, 24); assert.equal(report.completed, 0); assert.equal(report.attempted, 0);
    assert.equal(report.dispatched, 0); assert.equal(calls, 0); assert.equal(keys, 1);
    assert.equal(report.cells.length, 24); assert.ok(report.cells.every(row => row.status === 'unresolved'));
    assert.deepEqual(inspectEmbeddingExperimentBudgetSnapshot(configuration), before);
    assert.deepEqual(readFileSync(join(configuration.directory, 'experiment-budget.sqlite')), ledgerBytes);
    for (const file of readdirSync(outputDirectory)) {
      const bytes = readFileSync(join(outputDirectory, file), 'utf8');
      assert.equal(bytes.includes(sensitive), false); assert.equal(bytes.includes('synthetic-private-message'), false);
    }
    const closure = JSON.parse(readFileSync(join(outputDirectory, 'closure.json')));
    assert.equal(closure.fatal, 'relation_binding_credential_lookup_failure'); assert.equal(closure.reportAvailable, true);
  }
});

test('RB5 fetch and response-body failures project the same nonsecret diagnostic in every record', async t => {
  const f = await fixture(t);
  for (const variant of ['fetch', 'body']) {
    const configuration = ledger(f.workspace), outputDirectory = join(f.workspace.path, `external-code-${variant}`);
    mkdirSync(outputDirectory, { mode: 0o700 }); const manifest = f.module.prepareRelationBindingProbe({ configuration, outputDirectory });
    const sensitive = `synthetic-private-${variant}-error-code`; let calls = 0;
    const error = Object.assign(new Error('synthetic-private-external-message'), { code: sensitive });
    const report = await f.module.executeRelationBindingProbe({ configuration, outputDirectory, manifest,
      reviewReceipt: review(manifest), keyProvider: () => 'synthetic-key', fetchImpl: async () => {
        calls++; if (variant === 'fetch') throw error;
        return new Response(new ReadableStream({ start(controller) { controller.error(error); } }));
      } });
    assert.equal(calls, 1); assert.equal(report.attempted, 1); assert.equal(report.dispatched, 1);
    assert.equal(report.denominator, 24); assert.equal(report.completed, 0);
    assert.ok(report.cells.every(row => row.status === 'unresolved')); assert.equal(report.fatal, 'relation_binding_failure');
    assert.equal(report.records[0].failure, 'relation_binding_failure');
    assert.deepEqual(JSON.parse(readFileSync(join(outputDirectory, 'request-002.json'))), report.records[0]);
    const state = inspectEmbeddingExperimentBudgetSnapshot(configuration);
    assert.equal(state.requestCount, 1); assert.equal(state.reservedMicroUsd, 5000); assert.equal(state.attempts[0].outcome, 'unknown');
    for (const file of readdirSync(outputDirectory)) {
      const bytes = readFileSync(join(outputDirectory, file), 'utf8');
      assert.equal(bytes.includes(sensitive), false); assert.equal(bytes.includes('synthetic-private-external-message'), false);
    }
  }
});

test('RB5 malformed/auth/usage/network/echo/key/persistence failures stop once and retain fixed denominators', async t => {
  const f = await fixture(t);
  for (const variant of ['malformed', 'auth', 'usage', 'network', 'echo', 'key', 'record-persistence', 'foreign-ledger', 'report-collision']) {
    const configuration = ledger(f.workspace), outputDirectory = join(f.workspace.path, variant); mkdirSync(outputDirectory, { mode: 0o700 });
    const manifest = f.module.prepareRelationBindingProbe({ configuration, outputDirectory }); let keys = 0, calls = 0;
    const options = { configuration, outputDirectory, manifest, reviewReceipt: review(manifest), keyProvider: () => {
      keys++;
      if (variant === 'key') throw new Error('private-key-provider-message');
      if (variant === 'foreign-ledger') {
        const other = reopenEmbeddingExperimentBudget(configuration), attemptId = randomUUID();
        other.reserve({ attemptId, channel: 'host-completion', reservedMicroUsd: 5000 });
        other.recordOutcome({ attemptId, outcome: 'unknown' }); other.close();
      }
      if (variant === 'report-collision') writeFileSync(join(outputDirectory, 'report.json'), 'retained collision');
      return 'synthetic-key';
    }, fetchImpl: async (_url, options) => {
      calls++;
      if (variant === 'network') throw new Error('synthetic-key connection error');
      if (variant === 'auth') return Response.json({ error: 'denied' }, { status: 401 });
      if (variant === 'malformed') return new Response('{');
      if (variant === 'echo') return Response.json({ error: 'synthetic-key' });
      if (variant === 'usage') return Response.json({ usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 9 } });
      if (variant === 'record-persistence') writeFileSync(join(outputDirectory, 'request-002.json'), 'retained record collision');
      return response(JSON.parse(options.body));
    } };
    let report;
    if (variant === 'report-collision') {
      await assert.rejects(f.module.executeRelationBindingProbe(options), { code: 'relation_binding_persistence_failure' });
      assert.equal(readFileSync(join(outputDirectory, 'report.json'), 'utf8'), 'retained collision');
      const closure = JSON.parse(readFileSync(join(outputDirectory, 'closure.json')));
      assert.equal(closure.reportAvailable, false); assert.equal(calls, 0);
    } else {
      report = await f.module.executeRelationBindingProbe(options);
      assert.equal(report.cells.length, 24); assert.equal(report.denominator, 24); assert.equal(report.completed, 0);
      assert.equal(report.attempted, ['key', 'foreign-ledger'].includes(variant) ? 0 : 1);
      assert.ok(report.fatal); assert.ok(report.cells.every(row => row.status === 'unresolved'));
      assert.equal(calls, ['key', 'foreign-ledger'].includes(variant) ? 0 : 1);
      assert.equal(JSON.stringify(report).includes('synthetic-key'), false);
      assert.equal(JSON.stringify(report).includes('private-key-provider-message'), false);
      if (variant === 'foreign-ledger') assert.equal(report.accountingFailure, 'relation_binding_accounting_drift');
      const state = inspectEmbeddingExperimentBudgetSnapshot(configuration);
      assert.equal(state.reservedMicroUsd, variant === 'key' ? 0 : 5000);
      assert.ok(state.attempts.every(row => row.outcome !== null));
    }
    await assert.rejects(f.module.executeRelationBindingProbe(options), { code: 'output_already_used' }); assert.equal(keys, 1);
  }
});

function syntheticReport() {
  const planned = planRelationBindingAnswers(sources());
  return { schemaVersion: `${RELATION_BINDING_VERSION}-result`, denominator: 24, sourceDenominator: 12,
    sourceSha256: sha256(JSON.stringify(sources())), rubricSha256: rubricFreeze().sha256,
    sourceSnapshot: sources(), completed: 24, fatal: null, accountingFailure: null,
    cells: planned.map(cell => ({ cellId: cell.cellId, id: cell.id, arm: cell.arm, status: 'completed', answer: 'Synthetic.', failure: null })) };
}
function judgePair(report) {
  const first = { reviewerId: 'first-independent', judgments: report.cells.map(cell => ({ cellId: cell.cellId,
    verdict: 'correct', unsupported: 'clean', stale: 'clean', severeError: false, bindingError: false, abstained: Number(cell.id.slice(1)) > 6 })) };
  for (const id of ['R01', 'R07']) {
    const row = first.judgments.find(row => row.cellId === `${id}-baseline`);
    Object.assign(row, { verdict: 'incorrect', unsupported: 'positive', bindingError: true, abstained: false });
  }
  return [first, { ...structuredClone(first), reviewerId: 'second-independent' }];
}
test('RB6 blind and aggregate reject a source snapshot not bound to exact frozen bytes', () => {
  const report = syntheticReport(), [judgmentsA, judgmentsB] = judgePair(report);
  for (const mutate of [value => value.cases[0].sourceUnits[0].text += ' altered',
    value => value.cases[0].question.text += ' altered', value => value.cases[0].question.date = '2026-08-13',
    value => value.cases[0].sourceUnits[0].recordedRole = 'assistant',
    value => value.cases[0].sourceUnits[0].eventAt = '2026-08-03T09:00:00.000Z']) {
    const changed = structuredClone(report); mutate(changed.sourceSnapshot);
    assert.throws(() => buildBlindRelationBindingPacket(changed, rubricFreeze(), sourceFreeze()), { code: 'relation_binding_source_mismatch' });
    assert.throws(() => aggregateRelationBindingJudgments({ report: changed, rubric: rubricFreeze(), sources: sourceFreeze(),
      judgmentsA, judgmentsB, resourcesWithinLimits: true }), { code: 'relation_binding_source_mismatch' });
  }
  const frozen = sourceFreeze();
  for (const value of [undefined, {}, { ...frozen, bytes: '{' }, { ...frozen, sources: null }]) {
    assert.throws(() => buildBlindRelationBindingPacket(report, rubricFreeze(), value));
    assert.throws(() => aggregateRelationBindingJudgments({ report, rubric: rubricFreeze(), sources: value,
      judgmentsA, judgmentsB, resourcesWithinLimits: true }));
  }
  const bytesOnly = freezeRelationBindingSources(`${frozen.bytes}\n`);
  const parsedOnly = structuredClone(frozen); parsedOnly.sources.cases[0].sourceUnits[0].text += ' changed';
  for (const value of [bytesOnly, parsedOnly, { ...frozen, sha256: '0'.repeat(64) }]) {
    assert.throws(() => buildBlindRelationBindingPacket(report, rubricFreeze(), value), { code: 'relation_binding_source_mismatch' });
    assert.throws(() => aggregateRelationBindingJudgments({ report, rubric: rubricFreeze(), sources: value,
      judgmentsA, judgmentsB, resourcesWithinLimits: true }), { code: 'relation_binding_source_mismatch' });
  }
  const real = loadRelationBindingSources(); assert.deepEqual(real.sources, loadRelationBindingInputs());
  assert.equal(real.sha256, sha256(real.bytes));
  assert.equal(buildBlindRelationBindingPacket(report, rubricFreeze(), frozen).packet.items.length, 24);
});
test('RB6/RB7 distinct binding-error opportunities and positive requested relation gain only justify pipeline followup', () => {
  const report = syntheticReport(), [a, b] = judgePair(report);
  const aggregate = (judgmentsA = a, judgmentsB = b, extra = {}) => aggregateRelationBindingJudgments({
    report, rubric: rubricFreeze(), sources: sourceFreeze(), judgmentsA, judgmentsB, resourcesWithinLimits: true, ...extra });
  const positive = aggregate(); assert.equal(positive.positiveSignal, true); assert.equal(positive.netCorrect, 2);
  assert.equal(positive.arms.baseline.targetedBindingErrors, 2); assert.equal(positive.decision, 'fresh-full-pipeline-validation-only');
  assert.equal(positive.advances, false); assert.equal(positive.paired.length, 12);
  assert.equal(positive.arms.relation.knownCorrect, 6); assert.equal(positive.arms.relation.uncertainCorrect, 6);
  const both = mutate => { const x = structuredClone(a), y = structuredClone(b); for (const data of [x, y]) mutate(data.judgments); return aggregate(x, y); };
  const noOpportunity = both(rows => rows.forEach(row => { if (row.cellId.endsWith('baseline')) row.bindingError = false; }));
  assert.equal(noOpportunity.positiveSignal, false); assert.equal(noOpportunity.decision, 'inconclusive-stop');
  // Optional unsupported background must not manufacture targeted relation opportunities.
  const optional = both(rows => { rows.find(row => row.cellId === 'R07-baseline').bindingError = false; });
  assert.equal(optional.arms.baseline.targetedBindingErrors, 1); assert.equal(optional.positiveSignal, false);
  const noGain = both(rows => rows.filter(row => row.cellId.endsWith('relation')).forEach(row => {
    const control = rows.find(other => other.cellId === row.cellId.replace('relation', 'baseline'));
    Object.assign(row, { ...control, cellId: row.cellId });
  })); assert.equal(noGain.netCorrect, 0); assert.equal(noGain.positiveSignal, false); assert.equal(noGain.decision, 'inconclusive-stop');
  const alwaysAbstain = both(rows => rows.filter(row => row.cellId.endsWith('relation')).forEach(row => {
    row.abstained = true; row.verdict = Number(row.cellId.slice(1, 3)) <= 6 ? 'incorrect' : 'correct';
  })); assert.equal(alwaysAbstain.positiveSignal, false); assert.equal(alwaysAbstain.gates.knownUseful, false);
  const knownLoss = both(rows => { rows.find(row => row.cellId === 'R02-relation').verdict = 'incorrect'; });
  assert.equal(knownLoss.netCorrect, 1); assert.equal(knownLoss.gates.knownNoRegression, false); assert.equal(knownLoss.positiveSignal, false);
  const wrongJoin = both(rows => Object.assign(rows.find(row => row.cellId === 'R02-relation'),
    { verdict: 'incorrect', bindingError: true, unsupported: 'positive', severeError: true }));
  assert.equal(wrongJoin.positiveSignal, false); assert.equal(wrongJoin.gates.noNewHarm, false);
  const equalQASevere = both(rows => {
    for (const id of ['R02', 'R03']) rows.find(row => row.cellId === `${id}-relation`).verdict = 'incorrect';
    rows.find(row => row.cellId === 'R02-relation').severeError = true;
  });
  assert.equal(equalQASevere.netCorrect, 0); assert.equal(equalQASevere.decision, 'reject-stop');
  const disagreement = structuredClone(b); disagreement.judgments[0].bindingError = null;
  assert.equal(aggregate(a, disagreement).positiveSignal, false); assert.equal(aggregate(a, disagreement).gates.safetyKnown, false);
  const missing = structuredClone(b); missing.judgments.pop(); assert.equal(aggregate(a, missing).arms.relation.unresolved + aggregate(a, missing).arms.baseline.unresolved, 1);
  assert.equal(aggregate(a, b, { resourcesWithinLimits: false }).positiveSignal, false);
  const ceiling = both(rows => rows.forEach(row => Object.assign(row, { verdict: 'correct', unsupported: 'clean', bindingError: false })));
  assert.equal(ceiling.decision, 'inconclusive-stop'); assert.equal(ceiling.positiveSignal, false);
  const ceilingKnownLoss = both(rows => {
    rows.forEach(row => Object.assign(row, { verdict: 'correct', unsupported: 'clean', bindingError: false }));
    rows.find(row => row.cellId === 'R02-relation').verdict = 'incorrect';
  });
  assert.equal(ceilingKnownLoss.arms.baseline.targetedBindingErrors, 0); assert.equal(ceilingKnownLoss.decision, 'reject-stop');
  const uncertainLoss = both(rows => {
    rows.forEach(row => Object.assign(row, { verdict: 'correct', unsupported: 'clean', bindingError: false }));
    rows.find(row => row.cellId === 'R08-relation').verdict = 'incorrect';
  });
  assert.equal(uncertainLoss.netCorrect, -1); assert.equal(uncertainLoss.gates.knownNoRegression, true);
  assert.equal(uncertainLoss.arms.baseline.targetedBindingErrors, 0); assert.equal(uncertainLoss.decision, 'reject-stop');
  const blind = buildBlindRelationBindingPacket(report, rubricFreeze(), sourceFreeze()); assert.equal(blind.packet.items.length, 24);
  assert.ok(blind.packet.items.every(row => !Object.hasOwn(row, 'arm') && !Object.hasOwn(row, 'id')));
  const privateByCell = new Map(a.judgments.map(row => [row.cellId, row]));
  const blinded = { reviewerId: a.reviewerId, judgments: blind.mapping.map(row => {
    const { cellId, ...fields } = privateByCell.get(row.cellId); return { label: row.label, ...fields };
  }) };
  assert.deepEqual(unblindRelationBindingJudgments(blinded, blind.mapping).judgments, a.judgments);
  const forged = structuredClone(blinded); forged.judgments[0].cellId = 'R12-relation';
  assert.throws(() => unblindRelationBindingJudgments(forged, blind.mapping), { code: 'invalid_relation_binding_judgment' });
  const changedRubric = structuredClone(rubricFreeze()); changedRubric.rubric.cases.R01.requiredPropositions = ['changed'];
  assert.throws(() => aggregate(a, b, { rubric: changedRubric }), { code: 'relation_binding_rubric_mismatch' });
  const changedBytes = freezeRelationBindingRubric(`${rubricFreeze().bytes}\n`);
  assert.throws(() => buildBlindRelationBindingPacket(report, changedBytes, sourceFreeze()), { code: 'relation_binding_rubric_mismatch' });
});
