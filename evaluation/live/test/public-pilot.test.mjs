import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, cp, lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setImmediate as immediate } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';

import { createExperimentBudget, reopenExperimentBudget } from '../../experiment-budget/index.mjs';
import { authorizeBenchmarkBudgetExtension, authorizeBenchmarkExtension, authorizeBenchmarkRequestAllowance,
  authorizeCaseDeadlineCapability, createExperimentRequestGuard } from '../../experiment-budget/request-guard.mjs';
import { INGESTION_CLIENT, planLongMemEvalCase } from '../../longmemeval/ingestion.mjs';
import { opaqueQuestionId, prepareLongMemEval } from '../../longmemeval/prepare.mjs';
import { OFFICIAL_SCORING_SCHEMA_VERSION_V2, scorePublicComparison } from '../../longmemeval/official-scoring.mjs';
import { PUBLIC_ANSWER_TEMPLATE_VERSION, PUBLIC_ANSWER_TEMPLATE_VERSION_V2,
  runPublicComparison } from '../../longmemeval/public-comparison.mjs';
import { canonicalStoredReceiptExcerpt } from '../../longmemeval/receipt-canonicalization.mjs';
import { loadReferenceRenderings } from '../../longmemeval/reference-rendering.mjs';
import { openMemoryCore } from '../../../core/contract.mjs';
import { loadPreparedPilot, pilotEvaluatorFor, PILOT_DEFAULT_MAX_CASES } from '../pilot.mjs';
import { main as cliMain, parseArguments, USAGE } from '../public-pilot-cli.mjs';
import { mergePublicPilotRuns } from '../public-pilot-merge.mjs';
import { createRecallStageCollector, RECALL_STAGE_OBSERVATION_VERSION } from '../recall-stage-observations.mjs';
import {
  benchmarkStagePolicy,
  CAPTURE_ADMISSION_OBSERVATION_VERSION,
  createCaptureAdmissionCollector,
  createBenchmarkLiveSession,
  createCaseDeadlineLiveSession,
  evidenceArmGuess,
  labelCapturedArms,
  OWNER_ID,
  PUBLIC_PILOT_LIMITS,
  projectCaptureAdmissionObservation,
  RECEIPT_EXCERPT_BOUND_UTF16,
  runPublicPilot,
} from '../public-pilot.mjs';
import { experimentPolicy } from '../session.mjs';

// Synthetic private ledgers and fake HTTP only: zero network, and no environment key is ever read.
const python = new URL('../../longmemeval/fixtures/render-reference-sidecar.py', import.meta.url).pathname;
const KEY = 'synthetic-public-pilot-key-never-expose';
const RAW_PHRASE = 'zqx-private-mascot-phrase-never-in-report';
const ANSWER_MODEL = 'gpt-4.1-mini-2025-04-14';
const JUDGE_MODEL = 'gpt-4o-2024-08-06';
const URLS = { count: '/v1/responses/input_tokens', generation: '/v1/responses', chat: '/v1/chat/completions' };
const FILLER = 'The long session discusses the weather at great length and in careful detail. '.repeat(14);
const digest = (value) => createHash('sha256').update(value).digest('hex');

const fixture = ({ id, answerTurn, answer = 'amber', type = 'single-session-user' }) => ({
  question_id: id,
  question_type: type,
  question: `What is the ${id.split('_')[0]} color?`,
  answer,
  question_date: 'Saturday',
  haystack_session_ids: [`${id}-first`, `${id}-second`],
  haystack_dates: ['Tuesday', 'Friday'],
  haystack_sessions: [
    [{ role: 'user', content: answerTurn, has_answer: true }],
    [{ role: 'assistant', content: `The unrelated ${id} mascot is ${RAW_PHRASE}.`, has_answer: false }],
  ],
  answer_session_ids: id.includes('_abs') ? [] : [`${id}-first`],
});
const sourceCases = () => [
  fixture({ id: 'plain', answerTurn: 'The plain color is amber.' }),
  fixture({ id: 'long', answerTurn: `${FILLER}The long color is amber.` }),
  fixture({ id: 'abstain_abs', answerTurn: 'The abstain session mentions nothing about colors.',
    answer: 'The color is never stated.' }),
  fixture({ id: 'numeric', answerTurn: 'The numeric count is 3.', answer: 3 }),
];
const expandedSourceCases = () => Array.from({ length: 8 }, (_, index) => fixture({
  id: `expanded-${index + 1}`,
  answerTurn: `The expanded-${index + 1} color is amber.`,
}));
const ids = Object.fromEntries(['plain', 'long', 'abstain_abs', 'numeric'].map((id) => [id, opaqueQuestionId(id)]));

const selectedRefs = (input) => input.maps.flatMap((page) => page.items.map((item) =>
  item.type === 'unfiled' ? item.ref
    : item.type === 'ref' && item.ref.childType === 'memory'
      ? { memoryId: item.ref.childId, revision: item.ref.childRevision } : null)
  .filter(Boolean).map((ref) => ({ namespaceIndex: page.namespaceIndex, ...ref })));
const scripted = {
  extract: (input) => ({ items: input.messages.flatMap((message, index) =>
    (/color is|count is|mentions/u.test(message.content)
      ? [{ content: `Fact from message ${index}.`, kind: 'fact', confidence: 0.9, sourceIndices: [index] }] : [])) }),
  classify: (input) => ({ items: input.memories.map((memory) => ({
    memoryId: memory.id, parentIds: [], newL1: { title: 'Color', parentL2Ids: [] } })) }),
  select: (input) => ({ refs: selectedRefs(input) }),
  rank: (input) => ({ refs: input.candidates.slice(0, input.limit).map((candidate) => ({
    namespaceIndex: candidate.namespaceIndex, memoryId: candidate.memory.id, revision: candidate.memory.revision })) }),
};
const responsesEnvelope = (model, output) => ({ id: 'resp_synthetic', object: 'response', model,
  status: 'completed', error: null, incomplete_details: null,
  output: [{ id: 'msg_synthetic', type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: JSON.stringify(output), annotations: [] }] }],
  usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } });
const chatEnvelope = (model, content) => ({ id: 'chatcmpl_synthetic', object: 'chat.completion', model,
  choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 50, completion_tokens: 1, total_tokens: 51 } });
const answerText = (body) => (JSON.stringify(JSON.parse(body.messages.at(-1).content).evidence).includes('amber')
  ? 'amber' : 'I do not know');
const judgeText = (body) => {
  const prompt = body.messages[0].content;
  const expected = prompt.startsWith('I will give you an unanswerable question') ? 'I do not know' : 'amber';
  return prompt.includes(`Model Response: ${expected}`) ? 'yes' : 'no';
};
const defaultChat = (body) => Response.json(chatEnvelope(body.model,
  body.model === JUDGE_MODEL ? judgeText(body) : answerText(body)));
const fakeUpstream = ({ calls, chat = defaultChat, count = null, generation = null }) => async (url, options) => {
  const body = JSON.parse(options.body);
  assert.equal(new URL(url).origin, 'https://api.openai.com');
  const record = { url: `${url}`, pathname: new URL(url).pathname, body, rawBody: options.body,
    headers: options.headers, model: body.model };
  calls.push(record);
  if (record.pathname === URLS.count) return count
    ? count(body, record)
    : Response.json({ object: 'response.input_tokens', input_tokens: 100 });
  if (record.pathname === URLS.generation) {
    const method = body.text.format.name.replace(/^cairn_/u, '');
    if (generation) return generation(body, record, method);
    return Response.json(responsesEnvelope(body.model, scripted[method](JSON.parse(body.input[0].content[0].text))));
  }
  if (record.pathname === URLS.chat) return chat(body, record);
  return assert.fail(`unexpected upstream url ${url}`);
};
const chatCalls = (calls) => calls.filter((call) => call.pathname === URLS.chat);

async function setup(t, { source = sourceCases(), limitMicroUsd = 50_000_000, requestCap = 5_000,
  maxCases = PILOT_DEFAULT_MAX_CASES } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'cairn-public-pilot-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const inputPath = path.join(root, 'source.json');
  const content = JSON.stringify(source);
  await writeFile(inputPath, content);
  const prepared = path.join(root, 'prepared');
  await prepareLongMemEval({ inputPath, expectedSha256: digest(content), datasetRevision: 'synthetic-public-pilot',
    datasetVariant: 's-cleaned', questionIds: source.map((item) => item.question_id), outputDirectory: prepared });
  const ledger = { directory: path.join(root, 'ledger'), runId: randomUUID(), limitMicroUsd, requestCap };
  createExperimentBudget(ledger).close();
  const policy = experimentPolicy();
  createExperimentRequestGuard({ ledger, policy, fetchImpl: () => assert.fail('no setup transport') }).close();
  const benchmarkExtension = authorizeBenchmarkExtension({ ledger, policy,
    authorizationId: 'synthetic-public-pilot', stages: benchmarkStagePolicy() });
  const pilot = await loadPreparedPilot({ directory: prepared, maxCases });
  const calls = [];
  const session = (chat, count, generation) => createBenchmarkLiveSession({ ledger, apiKey: KEY,
    fetchImpl: fakeUpstream({ calls, ...(chat ? { chat } : {}), ...(count ? { count } : {}),
      ...(generation ? { generation } : {}) }), benchmarkExtension });
  const caseCapability = (caseIds) => {
    const checkpoint = ledgerState(ledger);
    const schedule = [...caseIds.map((caseId) => ({ phase: 'generation', caseId })),
      ...caseIds.map((caseId) => ({ phase: 'scoring', caseId }))];
    return authorizeCaseDeadlineCapability({ ledger, policy, benchmarkExtension,
      authorizationId: 'synthetic-case-deadline', executionId: `execution-${randomUUID()}`,
      checkpoint: { requestCount: checkpoint.requestCount, reservedMicroUsd: checkpoint.reservedMicroUsd }, schedule });
  };
  const caseSession = (caseIds, chat, count, generation, capability = caseCapability(caseIds)) => {
    return createCaseDeadlineLiveSession({ ledger, apiKey: KEY, benchmarkExtension, caseDeadlineCapability: capability,
      fetchImpl: fakeUpstream({ calls, ...(chat ? { chat } : {}), ...(count ? { count } : {}),
        ...(generation ? { generation } : {}) }) });
  };
  return { root, inputPath, prepared, ledger, policy, benchmarkExtension, pilot, calls, session, caseCapability, caseSession,
    output: (name) => path.join(root, name) };
}
const readJson = async (...segments) => JSON.parse(await readFile(path.join(...segments), 'utf8'));
const ledgerState = (ledger) => {
  const handle = reopenExperimentBudget(ledger);
  try { return handle.getState(); } finally { handle.close(); }
};
async function walk(directory) {
  const entries = [];
  for (const name of await readdir(directory)) {
    const filename = path.join(directory, name);
    const entry = await lstat(filename);
    entries.push({ filename, entry });
    if (entry.isDirectory()) entries.push(...await walk(filename));
  }
  return entries;
}
async function fileSnapshot(directory) {
  const snapshot = {};
  for (const { filename, entry } of await walk(directory)) {
    if (entry.isFile()) snapshot[path.relative(directory, filename)] = digest(await readFile(filename));
  }
  return snapshot;
}

test('PP1-PP5/PP8: end-to-end through real runner, guard, adapter and core on prepared v2 synthetic data', async (t) => {
  const f = await setup(t);
  const session = f.session();
  const output = f.output('run-a');
  const progress = [];
  const report = await runPublicPilot({ pilot: f.pilot, session, directory: output,
    manifest: { exclusionRegistry: ['excluded-one'], runCommit: 'synthetic' },
    onCase: (item) => progress.push(structuredClone(item)) });
  session.close();
  assert.deepEqual(progress.map((item) => item.stage), ['generation', 'generation', 'generation', 'generation',
    'scoring', 'scoring', 'scoring', 'scoring']);
  assert.ok(progress.every((item) => Object.keys(item).sort().join(',') === 'caseCount,index,questionId,stage,status'));
  assert.equal(report.summary.fixedN, 4);
  assert.equal(report.summary.generated, 4);
  assert.equal(report.summary.scored, 4);
  assert.equal(report.summary.halted, false);
  assert.deepEqual(report.operator, { exclusionRegistry: ['excluded-one'], runCommit: 'synthetic' });
  assert.equal(report.receiptExcerptBoundUtf16, 800);
  assert.equal(RECEIPT_EXCERPT_BOUND_UTF16, 800);
  assert.ok(report.limitations.length >= 6);
  assert.deepEqual(report.limits, PUBLIC_PILOT_LIMITS);
  assert.deepEqual(report.models, { answer: ANSWER_MODEL, judge: JUDGE_MODEL });

  // Judgments: plain (cairn, full correct), long (truncated cairn misses), abstention (all correct), numeric unresolved.
  const judged = Object.fromEntries(report.cases.map((item) => [item.sourceQuestionId,
    item.arms.map((arm) => [arm.judgment.status, arm.judgment.correct])]));
  assert.deepEqual(judged.plain, [['resolved', true], ['resolved', true], ['resolved', false]]);
  assert.deepEqual(judged.long, [['resolved', false], ['resolved', true], ['resolved', false]]);
  assert.deepEqual(judged.abstain_abs, [['resolved', true], ['resolved', true], ['resolved', true]]);
  assert.deepEqual(judged.numeric.map(([status]) => status), ['unresolved', 'unresolved', 'unresolved']);
  assert.equal(report.cases.find((item) => item.sourceQuestionId === 'numeric').scoring.referenceSerialization,
    'unverified-non-string');

  // Common bucket in aggregate.json and report.json: only the three fully resolved cases.
  const aggregate = await readJson(output, 'aggregate.json');
  const { common } = aggregate.official;
  assert.equal(common.commonN, 3);
  assert.deepEqual(common.byArm, {
    cairn: { correct: 2, incorrect: 1, accuracy: 2 / 3 },
    'full-history': { correct: 3, incorrect: 0, accuracy: 1 },
    'no-memory': { correct: 1, incorrect: 2, accuracy: 1 / 3 },
  });
  assert.equal(common.byType['single-session-user'].commonN, 3);
  assert.equal(common.byType['multi-session'].commonN, 0);
  assert.equal(common.byType['multi-session'].byArm.cairn.accuracy, null);
  assert.deepEqual(common.abstentionOverlay.byArm['no-memory'], { correct: 1, incorrect: 0, accuracy: 1 });
  assert.deepEqual(report.official, aggregate.official);
  assert.equal(aggregate.official.arms.cairn.overall.fixedN, 4);
  assert.equal(aggregate.official.arms.cairn.overall.resolved, 3);

  // PP4 truncation accounting from the actual chunking and the stored packed evidence.
  const longTruncation = await readJson(output, 'cases', ids.long, 'truncation.json');
  assert.equal(longTruncation.receiptExcerptBoundUtf16, 800);
  assert.equal(longTruncation.capture.chunksOverBound, 1);
  assert.equal(longTruncation.capture.turnsOverBound, 1);
  assert.ok(longTruncation.capture.omittedUnits > 200);
  assert.ok(longTruncation.retrieval.candidateCount >= 1);
  assert.equal(longTruncation.packed.receiptsFromTruncatedChunks, 1);
  assert.equal(longTruncation.packed.omittedUnits, longTruncation.capture.omittedUnits);
  assert.equal(longTruncation.packed.unmatched, 0);
  assert.equal(longTruncation.armStatus.cairn.status, 'completed');
  const plainTruncation = await readJson(output, 'cases', ids.plain, 'truncation.json');
  assert.equal(plainTruncation.capture.chunksOverBound, 0);
  assert.equal(plainTruncation.packed.receiptsFromTruncatedChunks, 0);
  assert.equal(aggregate.truncation.chunksOverBound, 1);
  assert.equal(report.cases.find((item) => item.sourceQuestionId === 'long').truncation.packed.receiptsFromTruncatedChunks, 1);

  // PP3 stored request bodies equal what the fake upstream received, minus exactly store/stream.
  for (const questionId of Object.values(ids)) {
    const stored = await readJson(output, 'cases', questionId, 'answer-requests.json');
    assert.deepEqual(stored.requests.map((item) => item.armGuess), ['cairn', 'full-history', 'no-memory']);
    assert.ok(stored.requests.every((item) => item.armLabelMethod === 'run-arm-order'));
    for (const item of stored.requests) {
      const expected = JSON.stringify({ ...item.request, store: false, stream: false });
      assert.equal(f.calls.filter((call) => call.rawBody === expected).length, 1);
      assert.equal(item.status, 'returned');
      assert.ok(Number.isSafeInteger(item.elapsedMs));
    }
  }
  const cairnEvidence = JSON.parse((await readJson(output, 'cases', ids.plain, 'answer-requests.json'))
    .requests[0].request.messages[1].content).evidence;
  assert.ok(cairnEvidence.every((item) => Array.isArray(item.receipts)));
  assert.ok(f.calls.every((call) => Object.values(URLS).includes(call.pathname)));
  assert.ok(chatCalls(f.calls).every((call) => call.body.store === false && call.body.stream === false
    && new Headers(call.headers).get('authorization') === `Bearer ${KEY}`));
  assert.equal(chatCalls(f.calls).filter((call) => call.model === JUDGE_MODEL).length, 9);
  assert.equal(chatCalls(f.calls).filter((call) => call.model === ANSWER_MODEL).length, 12);

  // Accounting: per-stage attempts with reservations, ledger before/after, known cost.
  const accounting = await readJson(output, 'cases', ids.plain, 'accounting.json');
  assert.deepEqual(Object.keys(accounting.totals).sort(), ['answer', 'cairn-count', 'cairn-generation']);
  assert.equal(accounting.totals.answer.requests, 3);
  assert.equal(accounting.totals.answer.reservedMicroUsd, 3 * 50_820);
  assert.ok(accounting.ledgerAfter.reservedMicroUsd > accounting.ledgerBefore.reservedMicroUsd);
  assert.ok(accounting.attempts.every((attempt) => attempt.outcome === 'succeeded'));
  assert.ok(accounting.attempts.filter((attempt) => attempt.stage === 'cairn-count').every((attempt) =>
    JSON.stringify(attempt.countDiagnostic) === JSON.stringify({
      reason: 'within_limit', observedInputTokens: 100, configuredInputLimit: 7_024,
    })));
  const scoring = await readJson(output, 'cases', ids.plain, 'scoring.json');
  assert.equal(scoring.status, 'completed');
  assert.deepEqual(Object.keys(scoring.accounting.totals), ['judge']);
  assert.equal(scoring.accounting.totals.judge.requests, 3);
  assert.equal(aggregate.cost.requests, f.calls.length);
  assert.equal(aggregate.cost.unknownCostRequests, f.calls.filter((call) => call.pathname === URLS.count).length);
  assert.equal(aggregate.cost.reservedMicroUsd, ledgerState(f.ledger).reservedMicroUsd);
  const timings = await readJson(output, 'cases', ids.plain, 'timings.json');
  assert.deepEqual(timings.arms.map((arm) => arm.status), ['completed', 'completed', 'completed']);
  const checkpoint = await readJson(output, 'checkpoint.json');
  assert.ok(Object.values(checkpoint.cases).every((item) => item.stage === 'scored'));
  assert.equal(checkpoint.cases[ids.plain].attemptIds.length,
    accounting.attempts.length + scoring.accounting.attempts.length);
  assert.deepEqual(checkpoint.cases[ids.plain].attemptIds,
    [...accounting.attempts, ...scoring.accounting.attempts].map((attempt) => attempt.attemptId));

  // Permissions and redaction.
  const entries = await walk(output);
  assert.ok(entries.length > 20);
  for (const { filename, entry } of entries) {
    assert.equal(entry.isSymbolicLink(), false, filename);
    assert.equal(entry.mode & 0o777, entry.isDirectory() ? 0o700 : 0o600, filename);
  }
  assert.equal((await lstat(output)).mode & 0o777, 0o700);
  for (const { filename, entry } of entries) {
    if (!entry.isFile() || !filename.endsWith('.json')) continue;
    const text = await readFile(filename, 'utf8');
    assert.doesNotMatch(text, /Bearer/u, filename);
    assert.equal(text.includes(KEY), false, filename);
    if (path.basename(filename) !== 'answer-requests.json') assert.equal(text.includes(RAW_PHRASE), false, filename);
    else assert.equal(text.includes(RAW_PHRASE), true, filename);
  }
  const reportText = await readFile(path.join(output, 'report.json'), 'utf8');
  assert.doesNotMatch(reportText, /official benchmark score/iu);
  assert.equal(reportText.includes('amber'), false);
  assert.ok(reportText.includes('excluded-one'));
});

test('R1-R3: case-deadline session binds exact schedule, identity, scopes and one-shot run', async (t) => {
  const f = await setup(t, { source: sourceCases().slice(0, 1) });
  const caseIds = [ids.plain];
  const session = f.caseSession(caseIds);
  const output = f.output('case-deadline-run');
  const report = await runPublicPilot({ pilot: f.pilot, session, directory: output, caseIds });
  assert.equal(report.caseTimeoutIdentity.effectivePolicyVersion, 'case-deadline-v1');
  assert.equal(report.summary.generated, 1);
  assert.equal(report.summary.scored, 1);
  assert.equal(report.summary.generationTimeouts, 0);
  assert.equal(report.summary.scoringTimeouts, 0);
  for (const file of ['manifest.json', 'checkpoint.json', 'aggregate.json', 'report.json',
    path.join('cases', ids.plain, 'generation.json'), path.join('cases', ids.plain, 'scoring.json'),
    path.join('cases', ids.plain, 'accounting.json'), path.join('cases', ids.plain, 'diagnostics.json')]) {
    assert.deepEqual((await readJson(output, file)).caseTimeoutIdentity, report.caseTimeoutIdentity, file);
  }
  const calls = f.calls.length;
  await assert.rejects(runPublicPilot({ pilot: f.pilot, session, directory: f.output('second'), caseIds }),
    { code: 'case_session_consumed' });
  assert.equal(f.calls.length, calls);
  const stripped = f.output('stripped-upper-identity');
  await cp(output, stripped, { recursive: true });
  for (const name of ['manifest.json', 'checkpoint.json']) {
    const artifact = await readJson(stripped, name);
    delete artifact.caseTimeoutIdentity;
    await writeFile(path.join(stripped, name), JSON.stringify(artifact), { mode: 0o600 });
  }
  const legacy = f.session();
  await assert.rejects(runPublicPilot({ pilot: f.pilot, session: legacy, directory: stripped, caseIds }),
    { code: 'invalid_artifact' });
  assert.equal(f.calls.length, calls);
  legacy.close();

  const identityLayers = [
    ['manifest.json', []],
    ['checkpoint.json', []],
    ['aggregate.json', []],
    ['aggregate.json', ['official']],
    ['report.json', []],
    ['report.json', ['official']],
    ['report.json', ['cases', 0]],
    [path.join('cases', ids.plain, 'generation.json'), []],
    [path.join('cases', ids.plain, 'generation.json'), ['run']],
    [path.join('cases', ids.plain, 'scoring.json'), []],
    [path.join('cases', ids.plain, 'scoring.json'), ['score']],
    [path.join('cases', ids.plain, 'accounting.json'), []],
    [path.join('cases', ids.plain, 'diagnostics.json'), []],
    [path.join('cases', ids.plain, 'answer-requests.json'), []],
    [path.join('cases', ids.plain, 'truncation.json'), []],
    [path.join('cases', ids.plain, 'timings.json'), []],
  ];
  for (const [index, [relative, nested]] of identityLayers.entries()) {
    const tampered = f.output(`identity-layer-${index}`);
    await cp(output, tampered, { recursive: true });
    const filename = path.join(tampered, relative);
    const artifact = await readJson(filename);
    const target = nested.reduce((value, key) => value[key], artifact);
    assert.deepEqual(target.caseTimeoutIdentity, report.caseTimeoutIdentity);
    if (index % 4 === 0) delete target.caseTimeoutIdentity;
    else if (index % 4 === 1) target.caseTimeoutIdentity = null;
    else if (index % 4 === 2) target.caseTimeoutIdentity.executionId = 7;
    else target.caseTimeoutIdentity.capabilityDigest = '0'.repeat(64);
    await writeFile(filename, JSON.stringify(artifact), { mode: 0o600 });
    const mergedOutput = f.output(`identity-layer-${index}-merged`);
    await assert.rejects(mergePublicPilotRuns({ directories: [tampered], output: mergedOutput }),
      { code: 'invalid_artifact' });
    await assert.rejects(lstat(mergedOutput), { code: 'ENOENT' });
  }

  const companionOnly = f.output('companion-only-identity');
  await cp(output, companionOnly, { recursive: true });
  await rm(path.join(companionOnly, 'aggregate.json'));
  await rm(path.join(companionOnly, 'report.json'));
  await rm(path.join(companionOnly, 'cases', ids.plain, 'generation.json'));
  await rm(path.join(companionOnly, 'cases', ids.plain, 'scoring.json'));
  for (const name of ['manifest.json', 'checkpoint.json']) {
    const artifact = await readJson(companionOnly, name);
    delete artifact.caseTimeoutIdentity;
    if (name === 'checkpoint.json') artifact.cases[ids.plain] = { stage: 'pending', attemptIds: [] };
    await writeFile(path.join(companionOnly, name), JSON.stringify(artifact), { mode: 0o600 });
  }
  const beforeCompanionResume = { calls: f.calls.length, files: await fileSnapshot(companionOnly) };
  const companionLegacy = f.session();
  await assert.rejects(runPublicPilot({ pilot: f.pilot, session: companionLegacy,
    directory: companionOnly, caseIds }), { code: 'invalid_artifact' });
  companionLegacy.close();
  assert.equal(f.calls.length, beforeCompanionResume.calls);
  assert.deepEqual(await fileSnapshot(companionOnly), beforeCompanionResume.files);
  session.close();
});

test('R2/R4: answer-template v2 retains case identity through a normal run and offline merge', async (t) => {
  const f = await setup(t, { source: sourceCases().slice(0, 1) });
  const output = f.output('case-deadline-v2');
  const session = f.caseSession([ids.plain]);
  const report = await runPublicPilot({ pilot: f.pilot, session, directory: output, caseIds: [ids.plain],
    answerTemplateVersion: PUBLIC_ANSWER_TEMPLATE_VERSION_V2 });
  session.close();
  assert.equal(report.answerTemplateVersion, PUBLIC_ANSWER_TEMPLATE_VERSION_V2);
  const generation = await readJson(output, 'cases', ids.plain, 'generation.json');
  const scoring = await readJson(output, 'cases', ids.plain, 'scoring.json');
  assert.deepEqual(generation.caseTimeoutIdentity, report.caseTimeoutIdentity);
  assert.deepEqual(generation.run.caseTimeoutIdentity, report.caseTimeoutIdentity);
  assert.deepEqual(scoring.caseTimeoutIdentity, report.caseTimeoutIdentity);
  assert.deepEqual(scoring.score.caseTimeoutIdentity, report.caseTimeoutIdentity);
  assert.ok(f.calls.length > 0);
  const merged = await mergePublicPilotRuns({ directories: [output], output: f.output('case-deadline-v2-merged') });
  assert.equal(merged.answerTemplateVersion, PUBLIC_ANSWER_TEMPLATE_VERSION_V2);
  assert.equal(merged.effectivePolicyVersion, 'case-deadline-v1');
  assert.equal(merged.summary.scored, 1);
  assert.equal(merged.official.common.commonN, 1);
});

test('R2/R5: merge retains distinct opt execution identities and rejects report reason drift', async (t) => {
  const f = await setup(t, { source: sourceCases().slice(0, 2) });
  const firstOutput = f.output('case-deadline-batch-a');
  const firstSession = f.caseSession([ids.plain]);
  const first = await runPublicPilot({ pilot: f.pilot, session: firstSession,
    directory: firstOutput, caseIds: [ids.plain] });
  firstSession.close();
  const secondOutput = f.output('case-deadline-batch-b');
  const secondSession = f.caseSession([ids.long]);
  const second = await runPublicPilot({ pilot: f.pilot, session: secondSession,
    directory: secondOutput, caseIds: [ids.long] });
  secondSession.close();
  assert.notEqual(first.caseTimeoutIdentity.executionId, second.caseTimeoutIdentity.executionId);
  const merged = await mergePublicPilotRuns({ directories: [firstOutput, secondOutput],
    output: f.output('case-deadline-batches-merged') });
  assert.equal(merged.effectivePolicyVersion, 'case-deadline-v1');
  assert.equal(Object.hasOwn(merged, 'caseTimeoutIdentity'), false);
  assert.equal(Object.hasOwn(merged, 'executionId'), false);
  assert.deepEqual(merged.sources.map((source) => source.caseTimeoutIdentity),
    [first.caseTimeoutIdentity, second.caseTimeoutIdentity]);
  assert.equal(merged.summary.fixedN, 2);
  assert.equal(merged.summary.scored, 2);

  const reasonDrift = f.output('case-deadline-reason-drift');
  await cp(firstOutput, reasonDrift, { recursive: true });
  const report = await readJson(reasonDrift, 'report.json');
  report.cases[0].generation.reason = 'case_timeout';
  await writeFile(path.join(reasonDrift, 'report.json'), JSON.stringify(report), { mode: 0o600 });
  await assert.rejects(mergePublicPilotRuns({ directories: [reasonDrift],
    output: f.output('case-deadline-reason-drift-merged') }), { code: 'invalid_artifact' });
  await assert.rejects(lstat(f.output('case-deadline-reason-drift-merged')), { code: 'ENOENT' });
});

test('R1: schedule mismatch irrevocably consumes the trusted session before output or sends', async (t) => {
  const f = await setup(t, { source: sourceCases().slice(0, 2) });
  const capability = f.caseCapability([ids.plain]);
  const session = f.caseSession([ids.plain], null, null, null, capability);
  await assert.rejects(runPublicPilot({ pilot: f.pilot, session, directory: f.output('wrong-schedule'),
    caseIds: [ids.plain, ids.long] }), { code: 'case_schedule_mismatch' });
  await assert.rejects(runPublicPilot({ pilot: f.pilot, session, directory: f.output('corrected-schedule'),
    caseIds: [ids.plain] }), { code: 'case_session_consumed' });
  assert.equal(f.calls.length, 0);
  await assert.rejects(lstat(f.output('wrong-schedule')), { code: 'ENOENT' });
  await assert.rejects(lstat(f.output('corrected-schedule')), { code: 'ENOENT' });
  assert.throws(() => f.caseSession([ids.plain], null, null, null, capability), { code: 'capability_consumed' });
  assert.equal(f.calls.length, 0);
  session.close();
});

test('R1: an invalid opt runner invocation irrevocably consumes its process session', async (t) => {
  const invalidCases = [
    ['caps', { caps: { reservedMicroUsd: -1, requests: 1 } }, 'invalid_caps'],
    ['limits', { limits: { ...PUBLIC_PILOT_LIMITS, recallLimit: 0 } }, 'invalid_limits'],
    ['case-ids', { caseIds: [] }, 'invalid_case_selection'],
    ['manifest', { manifest: [] }, 'invalid_manifest'],
    ['reference-map', { referenceRenderings: {} }, 'invalid_options'],
    ['judge-timeout', { judgeTimeoutMs: 0 }, 'invalid_options'],
    ['answer-template', { answerTemplateVersion: 'untrusted-template' }, 'invalid_answer_template_version'],
  ];
  for (const [label, invalid, code] of invalidCases) {
    const f = await setup(t, { source: sourceCases().slice(0, 1) });
    const capability = f.caseCapability([ids.plain]);
    const session = f.caseSession([ids.plain], null, null, null, capability);
    const before = ledgerState(f.ledger);
    await assert.rejects(runPublicPilot({ pilot: f.pilot, session, directory: f.output(`invalid-opt-${label}`),
      caseIds: [ids.plain], ...invalid }), { code });
    await assert.rejects(runPublicPilot({ pilot: f.pilot, session,
      directory: f.output(`invalid-opt-${label}-corrected`), caseIds: [ids.plain] }),
    { code: 'case_session_consumed' });
    assert.throws(() => f.caseSession([ids.plain], null, null, null, capability),
      { code: 'capability_consumed' });
    assert.equal(f.calls.length, 0);
    assert.deepEqual(ledgerState(f.ledger), before);
    await assert.rejects(lstat(f.output(`invalid-opt-${label}`)), { code: 'ENOENT' });
    await assert.rejects(lstat(f.output(`invalid-opt-${label}-corrected`)), { code: 'ENOENT' });
    session.close();
  }

  const nonplain = await setup(t, { source: sourceCases().slice(0, 1) });
  const nonplainSession = nonplain.caseSession([ids.plain]);
  const arrayOptions = Object.assign([], { pilot: nonplain.pilot, session: nonplainSession,
    directory: nonplain.output('nonplain-invalid'), caseIds: [ids.plain] });
  await assert.rejects(runPublicPilot(arrayOptions), { code: 'invalid_options' });
  await assert.rejects(runPublicPilot({ pilot: nonplain.pilot, session: nonplainSession,
    directory: nonplain.output('nonplain-corrected'), caseIds: [ids.plain] }),
  { code: 'case_session_consumed' });
  assert.equal(nonplain.calls.length, 0);
  assert.equal(ledgerState(nonplain.ledger).requestCount, 0);
  await assert.rejects(lstat(nonplain.output('nonplain-invalid')), { code: 'ENOENT' });
  await assert.rejects(lstat(nonplain.output('nonplain-corrected')), { code: 'ENOENT' });
  nonplainSession.close();

  const accessor = await setup(t, { source: sourceCases().slice(0, 1) });
  const opt = accessor.caseSession([ids.plain]);
  const legacy = accessor.session();
  let reads = 0;
  const accessorOptions = { pilot: accessor.pilot, directory: accessor.output('accessor-invalid'),
    caseIds: [ids.plain], caps: { reservedMicroUsd: -1, requests: 1 } };
  Object.defineProperty(accessorOptions, 'session', { enumerable: true, configurable: true,
    get() { reads += 1; return reads === 1 ? opt : legacy; } });
  await assert.rejects(runPublicPilot(accessorOptions), { code: 'invalid_caps' });
  assert.equal(reads, 1);
  await assert.rejects(runPublicPilot({ pilot: accessor.pilot, session: opt,
    directory: accessor.output('accessor-corrected'), caseIds: [ids.plain] }),
  { code: 'case_session_consumed' });
  assert.equal(accessor.calls.length, 0);
  opt.close();
  legacy.close();

  const ordinary = await setup(t, { source: sourceCases().slice(0, 1) });
  const ordinarySession = ordinary.session();
  await assert.rejects(runPublicPilot({ pilot: ordinary.pilot, session: ordinarySession,
    directory: ordinary.output('legacy-invalid'), caps: { reservedMicroUsd: -1, requests: 1 } }),
  { code: 'invalid_caps' });
  const report = await runPublicPilot({ pilot: ordinary.pilot, session: ordinarySession,
    directory: ordinary.output('legacy-corrected'), caseIds: [ids.plain] });
  assert.equal(report.summary.scored, 1);
  assert.ok(ordinary.calls.length > 0);
  ordinarySession.close();
});

test('R2/R5: zero-score nested identity tampering and mixed-policy merges fail closed', async (t) => {
  const f = await setup(t);
  const numericOutput = f.output('case-deadline-zero-score');
  const deadline = f.caseSession([ids.numeric]);
  const zero = await runPublicPilot({ pilot: f.pilot, session: deadline, directory: numericOutput,
    caseIds: [ids.numeric] });
  deadline.close();
  assert.equal(zero.summary.scored, 1);
  assert.equal(zero.official.common.commonN, 0);
  assert.ok(zero.cases[0].arms.every((arm) => arm.judgment.status === 'unresolved'));

  const tampered = f.output('case-deadline-zero-score-tampered');
  await cp(numericOutput, tampered, { recursive: true });
  const scoring = await readJson(tampered, 'cases', ids.numeric, 'scoring.json');
  scoring.score.caseTimeoutIdentity.executionId = 'synthetic-tampered-execution';
  await writeFile(path.join(tampered, 'cases', ids.numeric, 'scoring.json'), JSON.stringify(scoring), { mode: 0o600 });
  await assert.rejects(mergePublicPilotRuns({ directories: [tampered], output: f.output('zero-score-tampered-merge') }),
    { code: 'invalid_artifact' });
  await assert.rejects(lstat(f.output('zero-score-tampered-merge')), { code: 'ENOENT' });

  const legacyOutput = f.output('legacy-mixed-policy');
  const legacy = f.session();
  await runPublicPilot({ pilot: f.pilot, session: legacy, directory: legacyOutput, caseIds: [ids.long] });
  legacy.close();
  await assert.rejects(mergePublicPilotRuns({ directories: [numericOutput, legacyOutput],
    output: f.output('mixed-policy-merge') }), { code: 'merge_mismatch' });
  await assert.rejects(lstat(f.output('mixed-policy-merge')), { code: 'ENOENT' });
});

test('R3-R5: genuine core deadline fails one generation and the next case completes and scores', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = await setup(t, { source: sourceCases().slice(0, 2) });
  const caseIds = [ids.plain, ids.long];
  let countCalls = 0;
  let generationCalls = 0;
  let notifyCount;
  let notifyGeneration;
  let notifyBCount;
  let releaseA;
  const countStarted = new Promise(resolve => { notifyCount = resolve; });
  const generationStarted = new Promise(resolve => { notifyGeneration = resolve; });
  const bCountStarted = new Promise(resolve => { notifyBCount = resolve; });
  const output = f.output('deadline-continuation');
  const session = f.caseSession(caseIds, null,
    () => {
      countCalls += 1;
      if (countCalls === 2) notifyBCount();
      if (countCalls !== 1) return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
      notifyCount();
      return new Promise(resolve => setTimeout(() => resolve(Response.json({ object: 'response.input_tokens',
        input_tokens: 100 })), 1_000));
    },
    (body, _record, method) => {
      if (++generationCalls === 1) {
        notifyGeneration();
        return new Promise(resolve => { releaseA = () => resolve(Response.json(responsesEnvelope(body.model,
          scripted[method](JSON.parse(body.input[0].content[0].text))))); });
      }
      return Response.json(responsesEnvelope(body.model,
        scripted[method](JSON.parse(body.input[0].content[0].text))));
    });
  const running = runPublicPilot({ pilot: f.pilot, session, directory: output, caseIds });
  await countStarted;
  t.mock.timers.tick(1_000);
  await generationStarted;
  t.mock.timers.tick(29_000);
  await bCountStarted;
  const caseAAttempts = structuredClone(session.attempts().slice(0, 2));
  releaseA();
  await immediate();
  const report = await running;
  assert.deepEqual(report.cases.map((item) => [item.generation.status, item.generation.reason,
    item.scoring.status, item.scoring.reason]), [
    ['failed', 'case_timeout', 'blocked', 'case_timeout'],
    ['completed', null, 'completed', null],
  ]);
  assert.equal(report.summary.generationTimeouts, 1);
  assert.equal(report.summary.scoringTimeouts, 0);
  assert.equal(report.summary.scored, 1);
  assert.equal(report.summary.halted, false);
  assert.equal(report.official.fixedCaseCount, 2);
  assert.equal(report.official.common.commonN, 1);
  assert.deepEqual(session.attempts().slice(0, 2), caseAAttempts);
  assert.equal((await readJson(output, 'cases', ids.plain,
    'generation.json')).termination, 'core_deadline');
  const counts = caseIds.map((caseId) => {
    const database = new DatabaseSync(path.join(output, 'cases', caseId, 'memory.sqlite'),
      { readOnly: true });
    try { return database.prepare('SELECT count(*) AS count FROM memories WHERE deleted = 0').get().count; }
    finally { database.close(); }
  });
  assert.deepEqual(counts, [0, 1]);
  assert.equal(chatCalls(f.calls).filter((call) => call.model === JUDGE_MODEL).length, 3);
  const checkpoint = await readJson(output, 'checkpoint.json');
  assert.equal(checkpoint.cases[ids.plain].stage, 'blocked');
  assert.equal(checkpoint.cases[ids.plain].phase, 'scoring');
  assert.equal(checkpoint.cases[ids.plain].reason, 'case_timeout');
  assert.equal(session.attempts().some((attempt) => attempt.phase === 'scoring'
    && attempt.caseId === ids.plain), false);

  const badRunDirectory = f.output('failed-nested-run-id');
  await cp(output, badRunDirectory, { recursive: true });
  const badGeneration = await readJson(badRunDirectory, 'cases', ids.plain, 'generation.json');
  assert.ok(badGeneration.run);
  badGeneration.run.questionId = ids.long;
  await writeFile(path.join(badRunDirectory, 'cases', ids.plain, 'generation.json'),
    JSON.stringify(badGeneration), { mode: 0o600 });
  await assert.rejects(mergePublicPilotRuns({ directories: [badRunDirectory],
    output: f.output('failed-nested-run-id-merge') }), { code: 'invalid_artifact' });
  await assert.rejects(lstat(f.output('failed-nested-run-id-merge')), { code: 'ENOENT' });

  const blockedScoreDirectory = f.output('blocked-fabricated-score');
  await cp(output, blockedScoreDirectory, { recursive: true });
  const blockedScoring = await readJson(blockedScoreDirectory, 'cases', ids.plain, 'scoring.json');
  const completedScoring = await readJson(blockedScoreDirectory, 'cases', ids.long, 'scoring.json');
  blockedScoring.score = { ...completedScoring.score, questionId: ids.plain };
  await writeFile(path.join(blockedScoreDirectory, 'cases', ids.plain, 'scoring.json'),
    JSON.stringify(blockedScoring), { mode: 0o600 });
  await assert.rejects(mergePublicPilotRuns({ directories: [blockedScoreDirectory],
    output: f.output('blocked-fabricated-score-merge') }), { code: 'invalid_artifact' });
  await assert.rejects(lstat(f.output('blocked-fabricated-score-merge')), { code: 'ENOENT' });
  session.close();
});

test('R3-R5: scoring deadline retains an earlier judgment and permits the next selected case', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = await setup(t, { source: sourceCases().slice(0, 2) });
  const caseIds = [ids.plain, ids.long];
  let judgeCalls = 0;
  let notifyStalled;
  const stalled = new Promise(resolve => { notifyStalled = resolve; });
  const session = f.caseSession(caseIds, body => {
    if (body.model !== JUDGE_MODEL) return defaultChat(body);
    judgeCalls += 1;
    if (judgeCalls === 2) { notifyStalled(); return new Promise(() => {}); }
    return defaultChat(body);
  });
  const running = runPublicPilot({ pilot: f.pilot, session, directory: f.output('scoring-deadline'), caseIds });
  await stalled;
  t.mock.timers.tick(60_000);
  await immediate();
  const report = await running;
  assert.equal(judgeCalls, 5);
  assert.equal(report.summary.scored, 1);
  assert.equal(report.summary.scoringTimeouts, 1);
  assert.equal(report.summary.partialScoreRecords, 1);
  assert.deepEqual(report.cases[0].arms.map((arm) => arm.judgment.reason),
    [null, 'judge_timeout', 'prior_judge_timeout']);
  assert.ok(report.cases[1].arms.every((arm) => arm.judgment.status === 'resolved'));
  const scoring = await readJson(f.output('scoring-deadline'), 'cases', ids.plain, 'scoring.json');
  assert.equal(scoring.status, 'failed');
  assert.equal(scoring.reason, 'case_timeout');
  assert.equal(scoring.termination, 'transport_deadline');
  const merged = await mergePublicPilotRuns({ directories: [f.output('scoring-deadline')],
    output: f.output('scoring-deadline-merged') });
  const originalOfficial = structuredClone(report.official);
  delete originalOfficial.caseTimeoutIdentity;
  assert.deepEqual(merged.official, originalOfficial);
  assert.equal(merged.summary.scored, 1);
  assert.equal(merged.official.common.commonN, 1);
  assert.equal(merged.official.arms.cairn.overall.resolved, 2);
  const tampered = f.output('scoring-deadline-tampered');
  await cp(f.output('scoring-deadline'), tampered, { recursive: true });
  const badScoring = await readJson(tampered, 'cases', ids.plain, 'scoring.json');
  badScoring.score.questionId = ids.long;
  await writeFile(path.join(tampered, 'cases', ids.plain, 'scoring.json'), JSON.stringify(badScoring), { mode: 0o600 });
  await assert.rejects(mergePublicPilotRuns({ directories: [tampered], output: f.output('tampered-merge') }),
    { code: 'invalid_artifact' });
  await assert.rejects(lstat(f.output('tampered-merge')), { code: 'ENOENT' });
  session.close();
});

test('R4: an all-unresolved scoring-timeout payload remains a partial score record', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = await setup(t, { source: sourceCases().slice(0, 1) });
  let notifyStalled;
  const stalled = new Promise(resolve => { notifyStalled = resolve; });
  const session = f.caseSession([ids.plain], body => {
    if (body.model === JUDGE_MODEL) { notifyStalled(); return new Promise(() => {}); }
    return defaultChat(body);
  });
  const output = f.output('all-unresolved-scoring-timeout');
  const running = runPublicPilot({ pilot: f.pilot, session, directory: output, caseIds: [ids.plain] });
  await stalled;
  t.mock.timers.tick(60_000);
  await immediate();
  const report = await running;
  assert.equal(report.summary.scored, 0);
  assert.equal(report.summary.scoringTimeouts, 1);
  assert.equal(report.summary.partialScoreRecords, 1);
  assert.equal(report.official.scoredRecordCount, 1);
  assert.equal(report.official.common.commonN, 0);
  assert.ok(report.cases[0].arms.every((arm) => arm.judgment.status === 'unresolved'));
  const merged = await mergePublicPilotRuns({ directories: [output],
    output: f.output('all-unresolved-scoring-timeout-merged') });
  assert.equal(merged.summary.partialScoreRecords, 1);
  assert.equal(merged.official.scoredRecordCount, 1);
  session.close();
});

test('R3: answer transport deadline isolates its case and allows the next generation', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = await setup(t, { source: sourceCases().slice(0, 2) });
  const caseIds = [ids.plain, ids.long];
  let answers = 0;
  let notifyStalled;
  const stalled = new Promise(resolve => { notifyStalled = resolve; });
  const session = f.caseSession(caseIds, body => {
    if (body.model === ANSWER_MODEL && ++answers === 1) {
      notifyStalled();
      return new Promise(() => {});
    }
    return defaultChat(body);
  });
  const running = runPublicPilot({ pilot: f.pilot, session, directory: f.output('answer-deadline'), caseIds });
  await stalled;
  t.mock.timers.tick(180_000);
  await immediate();
  const report = await running;
  assert.deepEqual(report.cases.map((item) => [item.generation.status, item.generation.reason]),
    [['failed', 'case_timeout'], ['completed', null]]);
  assert.equal((await readJson(f.output('answer-deadline'), 'cases', ids.plain,
    'generation.json')).termination, 'transport_deadline');
  assert.equal(report.summary.halted, false);
  session.close();
});

test('R3/R5: malformed non-timeout response globally halts and prevents the next case send', async (t) => {
  const f = await setup(t, { source: sourceCases().slice(0, 2) });
  const caseIds = [ids.plain, ids.long];
  let malformed = true;
  const session = f.caseSession(caseIds, body => {
    if (malformed && body.model === ANSWER_MODEL) { malformed = false; return new Response('{'); }
    return defaultChat(body);
  });
  const report = await runPublicPilot({ pilot: f.pilot, session, directory: f.output('global-malformed'), caseIds });
  assert.equal(report.summary.halted, true);
  assert.equal(report.cases[0].generation.status, 'completed');
  assert.equal(report.cases[0].generation.reason, null);
  assert.equal(report.cases[0].arms[0].generation.status, 'failed');
  assert.equal(report.cases[1].generation.status, 'blocked');
  assert.equal(report.cases[1].generation.reason, 'paid_work_halted');
  assert.equal(chatCalls(f.calls).filter((call) => call.model === ANSWER_MODEL).length, 1);
  assert.equal(report.summary.generationTimeouts, 0);
  session.close();
});

test('R5: a foreign unsettled ledger row stops the next case before provider work', async (t) => {
  const f = await setup(t, { source: sourceCases().slice(0, 2) });
  const caseIds = [ids.plain, ids.long];
  const session = f.caseSession(caseIds);
  let callsAfterA;
  await assert.rejects(runPublicPilot({ pilot: f.pilot, session, directory: f.output('foreign-row'), caseIds,
    onCase: ({ stage, index }) => {
      if (stage !== 'generation' || index !== 0) return;
      callsAfterA = f.calls.length;
      const foreign = reopenExperimentBudget(f.ledger);
      try { foreign.reserve({ attemptId: randomUUID(), channel: 'host-completion', reservedMicroUsd: 1 }); }
      finally { foreign.close(); }
    } }), { code: 'policy_mismatch' });
  assert.ok(callsAfterA > 0);
  assert.equal(f.calls.length, callsAfterA);
  assert.equal(session.isHalted(), true);
  assert.equal(session.attempts().some((attempt) => attempt.caseId === ids.long), false);
  await assert.rejects(lstat(path.join(f.output('foreign-row'), 'report.json')), { code: 'ENOENT' });
  session.close();
});

test('R3/R5: a post-spend artifact collision stops before the next case sends and cannot resume', async (t) => {
  const f = await setup(t, { source: sourceCases().slice(0, 2) });
  const caseIds = [ids.plain, ids.long];
  const output = f.output('boundary-collision');
  const collision = path.join(output, 'cases', ids.plain, 'diagnostics.json');
  let planted = false;
  const session = f.caseSession(caseIds, null, async () => {
    if (!planted) {
      planted = true;
      await writeFile(collision, '{"collision":true}', { mode: 0o600 });
    }
    return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
  });
  await assert.rejects(runPublicPilot({ pilot: f.pilot, session, directory: output, caseIds }),
    { code: 'output_exists' });
  assert.equal(planted, true);
  assert.ok(f.calls.length > 0);
  assert.ok(f.calls.every((call) => !call.rawBody.includes('The long color')));
  assert.deepEqual(await readJson(collision), { collision: true });
  await readJson(output, 'cases', ids.plain, 'generation.json');
  await readJson(output, 'cases', ids.plain, 'accounting.json');
  const retained = ledgerState(f.ledger);
  assert.equal(retained.requestCount, f.calls.length);
  assert.ok(retained.reservedMicroUsd > 0);
  await assert.rejects(lstat(path.join(output, 'report.json')), { code: 'ENOENT' });
  await assert.rejects(runPublicPilot({ pilot: f.pilot, session, directory: output, caseIds }),
    { code: 'case_session_consumed' });
  assert.deepEqual(ledgerState(f.ledger), retained);
  session.close();
});

test('PP6: projected caps and ledger allowance block cases before any paid call', async (t) => {
  const f = await setup(t);
  const session = f.session();
  const report = await runPublicPilot({ pilot: f.pilot, session, directory: f.output('capped'),
    caps: { reservedMicroUsd: 1, requests: 1 } });
  session.close();
  assert.equal(f.calls.length, 0);
  assert.ok(report.cases.every((item) => item.generation.status === 'blocked'
    && item.generation.reason === 'cap_exhausted_projected' && item.scoring.reason === 'cap_exhausted_projected'));
  assert.deepEqual(report.summary.blockedReasons, { cap_exhausted_projected: 4 });
  assert.equal(report.official.common.commonN, 0);
  assert.equal(report.official.common.byArm.cairn.accuracy, null);
  assert.equal(report.official.arms.cairn.overall.reasonCounts.missing_scoring_record, 4);
  const generation = await readJson(f.output('capped'), 'cases', ids.plain, 'generation.json');
  assert.equal(generation.status, 'blocked');
  assert.deepEqual(Object.keys(generation.projected).sort(), ['ingestionBatches', 'requests', 'reservedMicroUsd']);
  assert.equal(generation.projected.requests, generation.projected.ingestionBatches * 4 + 12);
  assert.equal(generation.projected.reservedMicroUsd,
    (generation.projected.ingestionBatches * 4 + 6) * 5_000 + 3 * 50_820 + 3 * 10_400);

  const small = await setup(t, { limitMicroUsd: 200_000, requestCap: 100 });
  const smallSession = small.session();
  const smallReport = await runPublicPilot({ pilot: small.pilot, session: smallSession, directory: small.output('small') });
  smallSession.close();
  assert.equal(small.calls.length, 0);
  assert.ok(smallReport.cases.every((item) => item.generation.reason === 'ledger_allowance_insufficient'));
  assert.equal(ledgerState(small.ledger).requestCount, 0);
});

test('PP9: oversized full history blocks every arm with zero paid calls', async (t) => {
  const f = await setup(t);
  const session = f.session();
  const report = await runPublicPilot({ pilot: f.pilot, session, directory: f.output('oversized'),
    caseIds: [ids.long], limits: { ...PUBLIC_PILOT_LIMITS, contextWindow: 200 } });
  session.close();
  assert.equal(f.calls.length, 0);
  assert.equal(report.summary.fixedN, 1);
  const [item] = report.cases;
  assert.equal(item.generation.status, 'completed');
  assert.deepEqual(item.arms.map((arm) => [arm.generation.status, arm.generation.reason]),
    Array(3).fill(['blocked', 'full_history_context_window_exceeded']));
  assert.ok(item.arms.every((arm) => arm.judgment.status === 'unresolved' && arm.judgment.stage === 'generation'));
  assert.equal(report.official.common.commonN, 0);
  assert.equal(report.official.common.byArm['full-history'].accuracy, null);
  const truncation = await readJson(f.output('oversized'), 'cases', ids.long, 'truncation.json');
  assert.equal(truncation.retrieval, null);
  assert.equal(truncation.packed, null);
  assert.equal(truncation.capture.chunksOverBound, 1);
  assert.equal(ledgerState(f.ledger).requestCount, 0);
});

test('PP9: numeric reference resolves only with the verified Python rendering sidecar', async (t) => {
  const f = await setup(t);
  const sidecarPath = f.output('reference-sidecar.json');
  const rendered = spawnSync('python3', [python, '--source', f.inputPath, '--prepared', f.prepared,
    '--output', sidecarPath], { encoding: 'utf8', timeout: 10_000 });
  if (rendered.error?.code === 'ENOENT') { t.skip('python3 unavailable'); return; }
  assert.equal(rendered.status, 0, rendered.stderr);
  const { sidecar_sha256: expectedSidecarSha256 } = JSON.parse(rendered.stdout);
  const referenceRenderings = await loadReferenceRenderings({ preparedDirectory: f.prepared, sidecarPath,
    expectedSidecarSha256 });
  const session = f.session();
  const report = await runPublicPilot({ pilot: f.pilot, session, directory: f.output('rendered'),
    caseIds: [ids.numeric], referenceRenderings });
  session.close();
  const [item] = report.cases;
  assert.equal(item.scoring.referenceSerialization, 'verified-python-rendered');
  assert.deepEqual(item.arms.map((arm) => arm.judgment.status), ['resolved', 'resolved', 'resolved']);
  assert.equal(report.official.common.commonN, 1);
  assert.equal(report.official.completeVerifiedOfficialStyle, true);
  assert.equal(pilotEvaluatorFor(f.pilot, ids.numeric).reference_answer, 3);
  assert.equal(pilotEvaluatorFor(f.pilot, 'unknown'), undefined);
});

test('PP6/PP7: an unknown outcome halts all further paid work and the halt is checkpointed', async (t) => {
  const f = await setup(t);
  let poisoned = false;
  const session = f.session((body) => {
    if (body.model === ANSWER_MODEL && !poisoned) {
      poisoned = true;
      return new Response('not json', { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return defaultChat(body);
  });
  const report = await runPublicPilot({ pilot: f.pilot, session, directory: f.output('halted'),
    caseIds: [ids.plain, ids.abstain_abs] });
  assert.equal(session.isHalted(), true);
  session.close();
  assert.equal(chatCalls(f.calls).length, 1);
  const callsAtHalt = f.calls.length;
  assert.equal(report.summary.halted, true);
  const [first, second] = report.cases;
  assert.equal(first.generation.status, 'completed');
  assert.deepEqual(first.arms.map((arm) => arm.generation.status), ['failed', 'failed', 'failed']);
  assert.equal(first.scoring.reason, 'paid_work_halted');
  assert.equal(second.generation.status, 'blocked');
  assert.equal(second.generation.reason, 'paid_work_halted');
  assert.equal(f.calls.length, callsAtHalt);
  const checkpoint = await readJson(f.output('halted'), 'checkpoint.json');
  assert.equal(checkpoint.halted, true);
  assert.equal(checkpoint.cases[ids.abstain_abs].stage, 'blocked');
  const accounting = await readJson(f.output('halted'), 'cases', ids.plain, 'accounting.json');
  assert.equal(accounting.attempts.filter((attempt) => attempt.outcome === 'unknown').length, 1);
  const stored = await readJson(f.output('halted'), 'cases', ids.plain, 'answer-requests.json');
  assert.deepEqual(stored.requests.map((item) => item.status), ['threw', 'threw', 'threw']);
  assert.deepEqual(stored.requests.slice(1).map((item) => item.error.code), ['paid_work_halted', 'paid_work_halted']);
});

test('PP4/PP6: private accounting preserves a validated over-limit count diagnostic without provider data', async (t) => {
  const f = await setup(t);
  const providerSecret = 'private-provider-count-header-never-retain';
  const session = f.session(undefined, () => new Response(JSON.stringify({
    object: 'response.input_tokens', input_tokens: 7_025,
  }), { status: 200, statusText: providerSecret,
    headers: { 'content-type': 'application/json', 'x-provider-secret': providerSecret } }));
  const output = f.output('count-over-limit');
  const report = await runPublicPilot({ pilot: f.pilot, session, directory: output, caseIds: [ids.plain] });
  assert.equal(session.isHalted(), true);
  session.close();
  assert.equal(f.calls.length, 1);
  assert.equal(report.summary.halted, true);
  const accounting = await readJson(output, 'cases', ids.plain, 'accounting.json');
  assert.equal(accounting.attempts.length, 1);
  assert.deepEqual(accounting.attempts[0].countDiagnostic, {
    reason: 'input_limit_exceeded', observedInputTokens: 7_025, configuredInputLimit: 7_024,
  });
  assert.equal(accounting.attempts[0].outcome, 'unknown');
  assert.equal(accounting.attempts[0].actualMicroUsd, null);
  const serialized = JSON.stringify(accounting);
  assert.equal(serialized.includes(providerSecret), false);
  assert.equal(serialized.includes('authorization'), false);
  assert.equal(serialized.includes(KEY), false);
  assert.equal(serialized.includes('response.input_tokens'), false);
});

test('PP7: resume skips finished cases, never re-sends, and never overwrites artifacts', async (t) => {
  const f = await setup(t);
  const output = f.output('resume');
  const first = f.session();
  const report = await runPublicPilot({ pilot: f.pilot, session: first, directory: output, caseIds: [ids.plain, ids.abstain_abs] });
  first.close();
  const callsAfterFirst = f.calls.length;
  const second = f.session();
  const again = await runPublicPilot({ pilot: f.pilot, session: second, directory: output, caseIds: [ids.plain, ids.abstain_abs] });
  second.close();
  assert.equal(f.calls.length, callsAfterFirst);
  assert.deepEqual(again, report);
  const other = f.session();
  await assert.rejects(runPublicPilot({ pilot: f.pilot, session: other, directory: output, caseIds: [ids.plain] }),
    { code: 'run_directory_mismatch' });
  await assert.rejects(runPublicPilot({ pilot: f.pilot, session: other, directory: output,
    caseIds: [ids.plain, ids.abstain_abs], caps: { reservedMicroUsd: 1_000_000, requests: 100 } }),
  { code: 'run_directory_mismatch' });
  await assert.rejects(runPublicPilot({ pilot: f.pilot, session: other, directory: output,
    caseIds: [ids.plain, ids.abstain_abs], limits: { ...PUBLIC_PILOT_LIMITS, recallLimit: 5 } }),
  { code: 'run_directory_mismatch' });
  await assert.rejects(runPublicPilot({ pilot: f.pilot, session: other, directory: output,
    caseIds: [ids.plain, ids.abstain_abs], judgeTimeoutMs: 1_000 }), { code: 'run_directory_mismatch' });
  other.close();
  assert.equal(f.calls.length, callsAfterFirst);

  // A directory left mid-generation: that case becomes blocked: interrupted without any request for it.
  const interrupted = f.output('interrupted');
  await mkdir(interrupted, { mode: 0o700 });
  const baseline = ledgerState(f.ledger);
  const checkpoint = { schemaVersion: 'cairn-longmemeval-public-pilot-v1', pilotManifestSha256: f.pilot.identity.manifestSha256,
    baseline: { limitMicroUsd: baseline.limitMicroUsd, requestCap: baseline.requestCap,
      reservedMicroUsd: baseline.reservedMicroUsd, requestCount: baseline.requestCount, state: baseline.state },
    caseIds: [ids.plain, ids.abstain_abs], halted: false, cases: { [ids.plain]: { stage: 'generating' } } };
  await writeFile(path.join(interrupted, 'checkpoint.json'), JSON.stringify(checkpoint), { mode: 0o600 });
  const manifest = { schemaVersion: 'cairn-longmemeval-public-pilot-v1', limits: PUBLIC_PILOT_LIMITS,
    judgeTimeoutMs: 90_000, caps: null, stages: f.benchmarkExtension.stages };
  await writeFile(path.join(interrupted, 'manifest.json'), JSON.stringify(manifest), { mode: 0o600 });
  const callsBefore = f.calls.length;
  const third = f.session();
  const resumed = await runPublicPilot({ pilot: f.pilot, session: third, directory: interrupted,
    caseIds: [ids.plain, ids.abstain_abs] });
  third.close();
  assert.equal(resumed.cases[0].generation.status, 'blocked');
  assert.equal(resumed.cases[0].generation.reason, 'interrupted');
  assert.equal(resumed.cases[0].scoring.reason, 'interrupted');
  assert.equal(resumed.cases[1].scoring.status, 'completed');
  assert.ok(f.calls.slice(callsBefore).every((call) => !call.rawBody.includes('The plain color')));
  const stored = await readJson(interrupted, 'checkpoint.json');
  assert.deepEqual(stored.cases[ids.plain], { stage: 'blocked', reason: 'interrupted', phase: 'generation', attemptIds: [] });
  assert.equal(stored.cases[ids.abstain_abs].stage, 'scored');

  // Existing artifacts are never overwritten; a non-empty directory without a checkpoint is refused.
  const occupied = f.output('occupied');
  await mkdir(occupied, { mode: 0o700 });
  await writeFile(path.join(occupied, 'stray.json'), '{}', { mode: 0o600 });
  const fourth = f.session();
  await assert.rejects(runPublicPilot({ pilot: f.pilot, session: fourth, directory: occupied }), { code: 'output_not_empty' });
  const collision = f.output('collision');
  await mkdir(collision, { mode: 0o700 });
  await writeFile(path.join(collision, 'checkpoint.json'), JSON.stringify({ ...checkpoint, cases: {} }), { mode: 0o600 });
  await writeFile(path.join(collision, 'manifest.json'), JSON.stringify(manifest), { mode: 0o600 });
  await mkdir(path.join(collision, 'cases', ids.plain), { recursive: true, mode: 0o700 });
  await writeFile(path.join(collision, 'cases', ids.plain, 'memory.sqlite'), '', { mode: 0o600 });
  const before = f.calls.length;
  await assert.rejects(runPublicPilot({ pilot: f.pilot, session: fourth, directory: collision, caseIds: [ids.plain, ids.abstain_abs] }),
    { code: 'output_exists' });
  fourth.close();
  assert.equal(f.calls.length, before);
});

test('AB4/AB5: v2 binds every pilot layer, resumes without work, and cannot cross versions', async (t) => {
  const f = await setup(t, { source: sourceCases().slice(0, 1) });
  const invalid = f.session();
  const callsBeforeInvalid = f.calls.length;
  await assert.rejects(runPublicPilot({ pilot: f.pilot, session: invalid, directory: f.output('invalid'),
    answerTemplateVersion: undefined }), { code: 'invalid_answer_template_version' });
  invalid.close();
  assert.equal(f.calls.length, callsBeforeInvalid);
  await assert.rejects(lstat(f.output('invalid')), { code: 'ENOENT' });
  const output = f.output('v2');
  const first = f.session();
  const report = await runPublicPilot({ pilot: f.pilot, session: first, directory: output,
    answerTemplateVersion: PUBLIC_ANSWER_TEMPLATE_VERSION_V2 });
  first.close();
  assert.equal(report.answerTemplateVersion, PUBLIC_ANSWER_TEMPLATE_VERSION_V2);
  for (const name of ['manifest', 'checkpoint', 'aggregate']) {
    assert.equal((await readJson(output, `${name}.json`)).answerTemplateVersion, PUBLIC_ANSWER_TEMPLATE_VERSION_V2);
  }
  const generation = await readJson(output, 'cases', ids.plain, 'generation.json');
  const scoring = await readJson(output, 'cases', ids.plain, 'scoring.json');
  assert.equal(generation.answerTemplateVersion, PUBLIC_ANSWER_TEMPLATE_VERSION_V2);
  assert.equal(generation.run.templateVersion, PUBLIC_ANSWER_TEMPLATE_VERSION_V2);
  assert.equal(scoring.answerTemplateVersion, PUBLIC_ANSWER_TEMPLATE_VERSION_V2);
  assert.equal(scoring.score.answerTemplateVersion, PUBLIC_ANSWER_TEMPLATE_VERSION_V2);
  assert.equal(scoring.score.schemaVersion, OFFICIAL_SCORING_SCHEMA_VERSION_V2);
  const answers = chatCalls(f.calls).filter((call) => call.model === ANSWER_MODEL);
  assert.equal(answers.length, 3);
  for (const call of answers) {
    assert.deepEqual(Object.keys(JSON.parse(call.body.messages[1].content)), ['evidence', 'currentQuestion']);
    assert.equal(call.rawBody.includes('reference_answer'), false);
  }
  const calls = f.calls.length;
  const second = f.session();
  assert.deepEqual(await runPublicPilot({ pilot: f.pilot, session: second, directory: output,
    answerTemplateVersion: PUBLIC_ANSWER_TEMPLATE_VERSION_V2 }), report);
  assert.equal(f.calls.length, calls);
  await assert.rejects(runPublicPilot({ pilot: f.pilot, session: second, directory: output }),
    { code: 'run_directory_mismatch' });
  const identityLayers = [
    ['manifest.json'], ['checkpoint.json'], ['aggregate.json'], ['report.json'],
    ['cases', ids.plain, 'generation.json'], ['cases', ids.plain, 'scoring.json'],
  ];
  for (const [index, segments] of identityLayers.entries()) {
    const altered = f.output(`v2-layer-${index}`);
    await cp(output, altered, { recursive: true });
    const filename = path.join(altered, ...segments);
    const artifact = await readJson(filename);
    delete artifact.answerTemplateVersion;
    await writeFile(filename, JSON.stringify(artifact), { mode: 0o600 });
    await assert.rejects(runPublicPilot({ pilot: f.pilot, session: second, directory: altered,
      answerTemplateVersion: PUBLIC_ANSWER_TEMPLATE_VERSION_V2 }),
    { code: index < 2 ? 'run_directory_mismatch' : 'invalid_artifact' });
    assert.equal(f.calls.length, calls);
  }
  await writeFile(path.join(output, 'report.json'), 'false', { mode: 0o600 });
  await assert.rejects(runPublicPilot({ pilot: f.pilot, session: second, directory: output,
    answerTemplateVersion: PUBLIC_ANSWER_TEMPLATE_VERSION_V2 }), { code: 'invalid_artifact' });
  assert.equal(f.calls.length, calls);
  second.close();

  const legacy = f.output('explicit-v1');
  const third = f.session();
  await runPublicPilot({ pilot: f.pilot, session: third, directory: legacy,
    answerTemplateVersion: PUBLIC_ANSWER_TEMPLATE_VERSION });
  third.close();
  for (const file of [await readJson(legacy, 'manifest.json'), await readJson(legacy, 'checkpoint.json'),
    await readJson(legacy, 'aggregate.json'), await readJson(legacy, 'report.json'),
    await readJson(legacy, 'cases', ids.plain, 'generation.json'),
    await readJson(legacy, 'cases', ids.plain, 'scoring.json')]) {
    assert.equal(Object.hasOwn(file, 'answerTemplateVersion'), false);
  }
});

test('AB4: resume preflights a later identity mismatch before an earlier pending case', async (t) => {
  const f = await setup(t, { source: sourceCases().slice(0, 3) });
  const output = f.output('preflight');
  const first = f.session();
  await runPublicPilot({ pilot: f.pilot, session: first, directory: output,
    caseIds: [ids.plain, ids.abstain_abs] });
  first.close();
  await rm(path.join(output, 'aggregate.json'));
  await rm(path.join(output, 'report.json'));
  await rm(path.join(output, 'cases', ids.plain), { recursive: true });
  const checkpoint = await readJson(output, 'checkpoint.json');
  checkpoint.cases[ids.plain] = { stage: 'pending', attemptIds: [] };
  const later = await readJson(output, 'cases', ids.abstain_abs, 'generation.json');
  later.answerTemplateVersion = PUBLIC_ANSWER_TEMPLATE_VERSION_V2;
  await writeFile(path.join(output, 'checkpoint.json'), JSON.stringify(checkpoint), { mode: 0o600 });
  await writeFile(path.join(output, 'cases', ids.abstain_abs, 'generation.json'), JSON.stringify(later), { mode: 0o600 });
  const before = { calls: f.calls.length, ledger: ledgerState(f.ledger), files: await fileSnapshot(output) };
  let progress = 0;
  const session = f.session();
  await assert.rejects(runPublicPilot({ pilot: f.pilot, session, directory: output,
    caseIds: [ids.plain, ids.abstain_abs], onCase: () => { progress += 1; } }), { code: 'invalid_artifact' });
  session.close();
  assert.equal(f.calls.length, before.calls);
  assert.equal(progress, 0);
  assert.deepEqual(ledgerState(f.ledger), before.ledger);
  assert.deepEqual(await fileSnapshot(output), before.files);
});

test('AB4: a durably failed generation and its blocked scoring wrapper resume without replay', async (t) => {
  const f = await setup(t, { source: sourceCases().slice(0, 1) });
  const live = f.session();
  const broken = Object.freeze({ ...live, memoryModel: { onDiagnostic: 1 } });
  for (const [label, answerTemplateVersion] of [
    ['v1', null], ['v2', PUBLIC_ANSWER_TEMPLATE_VERSION_V2],
  ]) {
    const output = f.output(`failed-generation-${label}`);
    const options = { pilot: f.pilot, session: broken, directory: output,
      ...(answerTemplateVersion ? { answerTemplateVersion } : {}) };
    const report = await runPublicPilot(options);
    assert.equal(report.cases[0].generation.status, 'failed');
    assert.equal(report.cases[0].scoring.status, 'blocked');
    assert.equal(f.calls.length, 0);
    assert.deepEqual(await runPublicPilot(options), report);
    assert.equal(f.calls.length, 0);
  }
  live.close();
});

test('PP1: session uses the key only in headers, pins stage models, and propagates guard refusals', async (t) => {
  const f = await setup(t);
  assert.throws(() => createBenchmarkLiveSession({ ledger: f.ledger, apiKey: '',
    fetchImpl: () => {}, benchmarkExtension: f.benchmarkExtension }), { code: 'invalid_benchmark_session' });
  assert.throws(() => createBenchmarkLiveSession({ ledger: f.ledger, apiKey: KEY, fetchImpl: () => {} }),
    { code: 'invalid_benchmark_session' });
  const session = f.session();
  assert.equal(Object.isFrozen(session), true);
  assert.deepEqual(session.stages, f.benchmarkExtension.stages);
  await assert.rejects(session.answer({ request: { model: JUDGE_MODEL, messages: [], temperature: 0, max_tokens: 5, n: 1 } }),
    { code: 'invalid_answer_request' });
  await assert.rejects(session.judge({ request: { model: ANSWER_MODEL, messages: [], temperature: 0, max_tokens: 5, n: 1 } }),
    { code: 'invalid_judge_request' });
  assert.equal(f.calls.length, 0);
  const request = { model: ANSWER_MODEL, messages: [{ role: 'system', content: 'Answer from evidence.' },
    { role: 'user', content: JSON.stringify({ question: { text: 'q', date: 'd' }, evidence: ['amber'] }) }],
    temperature: 0, max_tokens: 5, n: 1 };
  const answered = await session.answer({ request, signal: new AbortController().signal });
  assert.deepEqual(answered, { text: 'amber', usage: { inputTokens: 50, outputTokens: 1,
    costMicroUsd: Math.ceil((50 * 2) / 5) + Math.ceil((1 * 8) / 5) } });
  assert.equal(f.calls[0].rawBody, JSON.stringify({ ...request, store: false, stream: false }));
  await assert.rejects(session.answer({ request: { ...request, top_p: 1 } }), { code: 'unsupported_request' });
  const judged = await session.judge({ request: { model: JUDGE_MODEL,
    messages: [{ role: 'user', content: 'Question: q\n\nCorrect Answer: amber\n\nModel Response: amber' }],
    n: 1, temperature: 0, max_tokens: 10 } });
  assert.deepEqual(judged, { text: 'yes' });
  assert.equal(JSON.stringify(session.attempts()).includes(KEY), false);
  assert.deepEqual(session.attempts().map((attempt) => attempt.stage), ['answer', 'judge']);
  assert.equal(session.countTokens('amber') > 0, true);
  session.close();
  await assert.rejects(session.answer({ request }), { code: 'guard_closed' });
});

test('CLI: help, dry run without reservation, missing key, unknown flag, and a guarded run through main()', async (t) => {
  const f = await setup(t);
  const out = () => { const chunks = []; return { write: (text) => { chunks.push(text); return true; }, text: () => chunks.join('') }; };
  const stdout = out();
  const stderr = out();
  assert.equal(await cliMain(['--help'], { env: {}, stdout, stderr, fetchImpl: () => assert.fail('no transport') }), 0);
  assert.equal(stdout.text(), USAGE);
  assert.throws(() => parseArguments(['--bogus']), { code: 'unknown_flag' });
  assert.equal(await cliMain(['--bogus'], { env: {}, stdout: out(),
    stderr, fetchImpl: () => assert.fail('no transport') }), 1);
  assert.match(stderr.text(), /^unknown_flag\n/u);
  const invalidVersion = out();
  assert.equal(await cliMain(['--answer-template-version', 'cairn-longmemeval-public-answer-v3'],
    { env: {}, stdout: out(), stderr: invalidVersion, fetchImpl: () => assert.fail('no transport') }), 1);
  assert.equal(invalidVersion.text(), 'invalid_answer_template_version\n');

  const ledgerFile = f.output('ledger.json');
  await writeFile(ledgerFile, JSON.stringify(f.ledger), { mode: 0o600 });
  const exclusions = f.output('exclusions.json');
  await writeFile(exclusions, JSON.stringify(['excluded-one', 'excluded-two']));
  const base = ['--prepared', f.prepared, '--ledger', ledgerFile, '--authorization-id', 'synthetic-public-pilot',
    '--cases', 'plain,abstain_abs', '--batch-cap-micro-usd', '3000000', '--batch-request-cap', '600',
    '--run-commit', 'abcdef1', '--exclusions-file', exclusions];
  const dry = out();
  assert.equal(await cliMain([...base, '--dry-run'], { env: {}, stdout: dry, stderr: out(),
    fetchImpl: () => assert.fail('no transport') }), 0);
  const projection = JSON.parse(dry.text());
  assert.equal(projection.mode, 'dry-run');
  assert.equal(projection.maxPreparedCases, PILOT_DEFAULT_MAX_CASES);
  assert.deepEqual(projection.caseIds, [ids.plain, ids.abstain_abs]);
  assert.equal(projection.projections.length, 2);
  assert.deepEqual(projection.fits, { caps: true, ledger: true });
  assert.equal(projection.exclusionCount, 2);
  assert.equal(projection.ledger.requestCount, 0);
  assert.equal(dry.text().includes(KEY), false);
  assert.equal(ledgerState(f.ledger).requestCount, 0);
  const v2Dry = out();
  assert.equal(await cliMain([...base, '--answer-template-version', PUBLIC_ANSWER_TEMPLATE_VERSION_V2, '--dry-run'],
    { env: {}, stdout: v2Dry, stderr: out(), fetchImpl: () => assert.fail('no transport') }), 0);
  assert.equal(JSON.parse(v2Dry.text()).answerTemplateVersion, PUBLIC_ANSWER_TEMPLATE_VERSION_V2);

  await chmod(ledgerFile, 0o644);
  const loose = out();
  assert.equal(await cliMain([...base, '--dry-run'], { env: {}, stdout: out(), stderr: loose,
    fetchImpl: () => assert.fail('no transport') }), 1);
  assert.equal(loose.text(), 'input_permissions\n');
  await chmod(ledgerFile, 0o600);

  const missing = out();
  assert.equal(await cliMain([...base, '--output', f.output('cli-run')], { env: {}, stdout: out(), stderr: missing,
    fetchImpl: () => assert.fail('no transport') }), 2);
  assert.equal(missing.text(), 'missing_environment OPENAI_API_KEY\n');
  assert.equal(await cliMain([...base, '--output', f.output('cli-run'), '--cases', 'nope'], { env: {}, stdout: out(),
    stderr: out(), fetchImpl: () => assert.fail('no transport') }), 1);

  const run = out();
  const calls = [];
  const code = await cliMain([...base, '--output', f.output('cli-run')], { env: { OPENAI_API_KEY: KEY }, stdout: run,
    stderr: out(), fetchImpl: fakeUpstream({ calls }) });
  assert.equal(code, 0);
  const lines = run.text().trimEnd().split('\n').map((line) => JSON.parse(line));
  assert.equal(lines.filter((line) => line.progress).length, 4);
  const final = lines.at(-1);
  assert.equal(final.mode, 'run');
  assert.equal(final.summary.scored, 2);
  assert.equal(final.common.commonN, 2);
  assert.equal(run.text().includes(KEY), false);
  assert.equal(run.text().includes(RAW_PHRASE), false);
  assert.ok(calls.length > 0);
  const report = await readJson(f.output('cli-run'), 'report.json');
  assert.equal(report.operator.runCommit, 'abcdef1');
  assert.deepEqual(report.operator.exclusionRegistry, ['excluded-one', 'excluded-two']);
  assert.equal(report.operator.authorizationId, 'synthetic-public-pilot');
  assert.equal(report.operator.maxPreparedCases, PILOT_DEFAULT_MAX_CASES);
  assert.equal(ledgerState(f.ledger).requestCount, calls.length);
});

test('CLI: an eight-case prepared cohort requires explicit bounded keyless opt-in', async (t) => {
  const f = await setup(t, { source: expandedSourceCases(), maxCases: 8 });
  const ledgerFile = f.output('expanded-ledger.json');
  await writeFile(ledgerFile, JSON.stringify(f.ledger), { mode: 0o600 });
  const beforeState = ledgerState(f.ledger);
  const beforeFiles = await fileSnapshot(f.ledger.directory);
  const stream = () => { const chunks = []; return { write(value) { chunks.push(value); return true; },
    text() { return chunks.join(''); } }; };
  let keyReads = 0;
  const env = {};
  Object.defineProperty(env, 'OPENAI_API_KEY', { get() { keyReads += 1; return KEY; } });
  let transportCalls = 0;
  const noTransport = () => { transportCalls += 1; return assert.fail('no dry-run transport'); };
  const base = ['--prepared', f.prepared, '--ledger', ledgerFile,
    '--authorization-id', 'synthetic-public-pilot', '--dry-run'];

  for (const argv of [base, [...base, '--max-prepared-cases', '7']]) {
    const stdout = stream();
    const stderr = stream();
    assert.equal(await cliMain(argv, { env, stdout, stderr, fetchImpl: noTransport }), 1);
    assert.equal(stdout.text(), '');
    assert.equal(stderr.text(), 'invalid_manifest\n');
  }

  const stdout = stream();
  const stderr = stream();
  assert.equal(await cliMain([...base, '--max-prepared-cases', '8'], {
    env, stdout, stderr, fetchImpl: noTransport,
  }), 0);
  assert.equal(stderr.text(), '');
  const projection = JSON.parse(stdout.text());
  assert.equal(projection.mode, 'dry-run');
  assert.equal(projection.maxPreparedCases, 8);
  assert.equal(projection.pilot.count, 8);
  assert.equal(projection.caseIds.length, 8);
  assert.equal(projection.projections.length, 8);

  const launched = spawnSync(process.execPath,
    [new URL('../public-pilot-cli.mjs', import.meta.url).pathname,
      ...base, '--max-prepared-cases', '8'],
    { encoding: 'utf8', env: { NODE_NO_WARNINGS: '1' } });
  assert.equal(launched.status, 0, launched.stderr);
  assert.equal(launched.stderr, '');
  assert.equal(JSON.parse(launched.stdout).maxPreparedCases, 8);
  assert.equal(keyReads, 0);
  assert.equal(transportCalls, 0);
  assert.deepEqual(ledgerState(f.ledger), beforeState);
  assert.deepEqual(await fileSnapshot(f.ledger.directory), beforeFiles);
});

test('R1: complete case CLI dry-run is keyless, non-consuming and safely repeatable', async (t) => {
  const f = await setup(t, { source: sourceCases().slice(0, 1) });
  const ledgerFile = f.output('case-ledger.json');
  await writeFile(ledgerFile, JSON.stringify(f.ledger), { mode: 0o600 });
  const output = f.output('must-not-exist');
  const argv = ['--prepared', f.prepared, '--ledger', ledgerFile,
    '--authorization-id', 'synthetic-public-pilot', '--cases', 'plain', '--dry-run',
    '--case-timeout-policy', 'case-deadline-v1', '--case-authorization-id', 'synthetic-case-cli',
    '--execution-id', 'synthetic-cli-execution', '--expected-request-count', '0',
    '--expected-reserved-micro-usd', '0'];
  let keyReads = 0;
  const env = {};
  Object.defineProperty(env, 'OPENAI_API_KEY', { get() { keyReads += 1; return KEY; } });
  const outputStream = () => { const chunks = []; return { write(value) { chunks.push(value); return true; },
    text() { return chunks.join(''); } }; };
  for (let index = 0; index < 2; index += 1) {
    const stdout = outputStream();
    assert.equal(await cliMain(argv, { env, stdout, stderr: outputStream(),
      fetchImpl: () => assert.fail('no transport') }), 0);
    const result = JSON.parse(stdout.text());
    assert.equal(result.caseTimeoutIdentity.effectivePolicyVersion, 'case-deadline-v1');
    assert.match(result.caseTimeoutRestriction, /one-shot/u);
  }
  assert.equal(keyReads, 0);
  assert.equal(ledgerState(f.ledger).requestCount, 0);
  await assert.rejects(lstat(output), { code: 'ENOENT' });
  await assert.rejects(lstat(path.join(f.ledger.directory,
    'experiment-case-deadline-synthetic-cli-execution.claim.json')), { code: 'ENOENT' });
  const incomplete = outputStream();
  assert.equal(await cliMain([...argv.slice(0, -2)], { env, stdout: outputStream(), stderr: incomplete,
    fetchImpl: () => assert.fail('no transport') }), 1);
  assert.equal(incomplete.text(), 'case_flags_incomplete\n');
  assert.equal(keyReads, 0);
  const excessive = outputStream();
  const excessiveArgs = [...argv];
  excessiveArgs[excessiveArgs.indexOf('--expected-request-count') + 1] = '5001';
  assert.equal(await cliMain(excessiveArgs, { env, stdout: outputStream(), stderr: excessive,
    fetchImpl: () => assert.fail('no transport') }), 1);
  assert.equal(excessive.text(), 'invalid_case_checkpoint\n');
  const badSidecar = outputStream();
  assert.equal(await cliMain([...argv, '--sidecar', f.output('missing-sidecar.json'),
    '--sidecar-sha256', '0'.repeat(64)], { env, stdout: outputStream(), stderr: badSidecar,
    fetchImpl: () => assert.fail('no transport') }), 1);
  assert.equal(keyReads, 0);
  await assert.rejects(lstat(path.join(f.ledger.directory,
    'experiment-case-deadline-synthetic-cli-execution.claim.json')), { code: 'ENOENT' });

  const freshSidecarExecution = 'fresh-invalid-sidecar';
  const freshBadSidecarArgs = argv.map((value, index) => argv[index - 1] === '--execution-id'
    ? freshSidecarExecution : value);
  const ledgerBeforeFreshFailures = ledgerState(f.ledger);
  assert.equal(await cliMain([...freshBadSidecarArgs, '--sidecar', f.output('missing-fresh-sidecar.json'),
    '--sidecar-sha256', '0'.repeat(64)], { env, stdout: outputStream(), stderr: outputStream(),
    fetchImpl: () => assert.fail('no transport') }), 1);
  for (const suffix of ['.json', '.claim.json']) {
    await assert.rejects(lstat(path.join(f.ledger.directory,
      `experiment-case-deadline-${freshSidecarExecution}${suffix}`)), { code: 'ENOENT' });
  }
  const freshCheckpointExecution = 'fresh-invalid-checkpoint';
  const freshBadCheckpointArgs = argv.map((value, index) => {
    if (argv[index - 1] === '--execution-id') return freshCheckpointExecution;
    if (argv[index - 1] === '--expected-request-count') return '5001';
    return value;
  });
  assert.equal(await cliMain(freshBadCheckpointArgs, { env, stdout: outputStream(), stderr: outputStream(),
    fetchImpl: () => assert.fail('no transport') }), 1);
  for (const suffix of ['.json', '.claim.json']) {
    await assert.rejects(lstat(path.join(f.ledger.directory,
      `experiment-case-deadline-${freshCheckpointExecution}${suffix}`)), { code: 'ENOENT' });
  }
  assert.equal(keyReads, 0);
  assert.deepEqual(ledgerState(f.ledger), ledgerBeforeFreshFailures);
});

test('A5 derived allowance CLI is explicit, keyless in dry-run, and runs one fresh synthetic execution', async (t) => {
  const f = await setup(t, { source: sourceCases().slice(0, 1), requestCap: 5 });
  const oldLedger = { ...f.ledger };
  const allowance = authorizeBenchmarkRequestAllowance({ oldLedger, policy: f.policy,
    benchmarkExtension: f.benchmarkExtension, authorizationId: 'synthetic-cli-allowance',
    newRequestCap: 5_000, expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 } });
  f.ledger.requestCap = 5_000;
  const ledgerFile = f.output('allowance-ledger.json');
  await writeFile(ledgerFile, JSON.stringify(f.ledger), { mode: 0o600 });
  const executionId = 'synthetic-allowance-execution';
  const base = ['--prepared', f.prepared, '--ledger', ledgerFile,
    '--authorization-id', 'synthetic-public-pilot',
    '--request-allowance-authorization-id', 'synthetic-cli-allowance',
    '--cases', 'plain', '--case-timeout-policy', 'case-deadline-v1',
    '--case-authorization-id', 'synthetic-allowance-case', '--execution-id', executionId,
    '--expected-request-count', '0', '--expected-reserved-micro-usd', '0'];
  const stream = () => { const chunks = []; return { write(value) { chunks.push(value); return true; },
    text() { return chunks.join(''); } }; };
  const expectedAllowance = {
    version: 'benchmark-request-allowance-v1', authorizationId: 'synthetic-cli-allowance',
    priorRequestCap: 5, requestCap: 5_000, checkpoint: { requestCount: 0, reservedMicroUsd: 0 },
    historicalDigest: allowance.historicalDigest,
  };
  let keyReads = 0;
  const env = {};
  Object.defineProperty(env, 'OPENAI_API_KEY', { get() { keyReads += 1; return KEY; } });

  const keylessEnv = { ...process.env, NODE_NO_WARNINGS: '1' };
  delete keylessEnv.OPENAI_API_KEY;
  const processDry = spawnSync(process.execPath,
    [new URL('../public-pilot-cli.mjs', import.meta.url).pathname, ...base, '--dry-run'],
    { encoding: 'utf8', env: keylessEnv });
  assert.equal(processDry.status, 0, processDry.stderr);
  assert.equal(processDry.stderr, '');
  assert.deepEqual(JSON.parse(processDry.stdout).requestAllowance, expectedAllowance);
  assert.equal(ledgerState(f.ledger).requestCount, 0);
  await assert.rejects(lstat(path.join(f.ledger.directory,
    `experiment-case-deadline-${executionId}.claim.json`)), { code: 'ENOENT' });

  for (let index = 0; index < 2; index += 1) {
    const stdout = stream();
    assert.equal(await cliMain([...base, '--dry-run'], { env, stdout, stderr: stream(),
      fetchImpl: () => assert.fail('no dry-run transport') }), 0);
    const result = JSON.parse(stdout.text());
    assert.deepEqual(result.requestAllowance, expectedAllowance);
    assert.equal(result.ledger.requestCap, 5_000);
  }
  assert.equal(keyReads, 0);
  assert.equal(ledgerState(f.ledger).requestCount, 0);
  await assert.rejects(lstat(path.join(f.ledger.directory,
    `experiment-case-deadline-${executionId}.claim.json`)), { code: 'ENOENT' });

  const noOptError = stream();
  assert.equal(await cliMain([...base.filter((value, index) => value !== '--request-allowance-authorization-id'
    && base[index - 1] !== '--request-allowance-authorization-id'), '--dry-run'], {
    env, stdout: stream(), stderr: noOptError, fetchImpl: () => assert.fail('no default transport'),
  }), 1);
  assert.equal(noOptError.text(), 'invalid_extension\n');
  assert.equal(keyReads, 0);

  const wrong = [...base];
  wrong[wrong.indexOf('--request-allowance-authorization-id') + 1] = 'wrong-allowance';
  const wrongError = stream();
  assert.equal(await cliMain([...wrong, '--dry-run'], { env, stdout: stream(), stderr: wrongError,
    fetchImpl: () => assert.fail('no wrong-grant transport') }), 1);
  assert.equal(wrongError.text(), 'invalid_extension\n');
  assert.equal(keyReads, 0);

  const calls = [];
  const output = f.output('allowance-live');
  const stdout = stream();
  assert.equal(await cliMain([...base, '--output', output], { env, stdout, stderr: stream(),
    fetchImpl: fakeUpstream({ calls }) }), 0);
  assert.equal(keyReads, 1);
  assert.ok(calls.length > 0);
  const finalOutput = JSON.parse(stdout.text().trimEnd().split('\n').at(-1));
  assert.equal(finalOutput.summary.scored, 1);
  assert.deepEqual(finalOutput.requestAllowance, expectedAllowance);
  const manifest = await readJson(output, 'manifest.json');
  const report = await readJson(output, 'report.json');
  assert.equal(report.caseTimeoutIdentity.executionId, executionId);
  assert.equal(report.operator.authorizationId, 'synthetic-public-pilot');
  assert.deepEqual(manifest.operator.requestAllowance, expectedAllowance);
  assert.deepEqual(report.operator.requestAllowance, expectedAllowance);
  assert.equal(ledgerState(f.ledger).requestCount, calls.length);
});

test('B5 budget-extension CLI only loads explicit authority and keeps dry-run keyless/non-consuming', async (t) => {
  const f = await setup(t, { source: sourceCases().slice(0, 1), requestCap: 5 });
  const baseLedger = { ...f.ledger };
  const allowance = authorizeBenchmarkRequestAllowance({ oldLedger: baseLedger, policy: f.policy,
    benchmarkExtension: f.benchmarkExtension, authorizationId: 'synthetic-cli-allowance-budget',
    newRequestCap: 20, expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 } });
  f.ledger.requestCap = 20;
  const allowanceLedger = { ...f.ledger };
  const budget = authorizeBenchmarkBudgetExtension({ oldLedger: allowanceLedger, policy: f.policy,
    requestAllowance: allowance, authorizationId: 'synthetic-cli-budget-extension',
    newLimitMicroUsd: 100_000_000, newRequestCap: 5_000,
    expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 } });
  f.ledger.limitMicroUsd = 100_000_000;
  f.ledger.requestCap = 5_000;
  const ledgerFile = f.output('budget-extension-ledger.json');
  await writeFile(ledgerFile, JSON.stringify(f.ledger), { mode: 0o600 });
  const executionId = 'synthetic-budget-extension-execution';
  const base = ['--prepared', f.prepared, '--ledger', ledgerFile,
    '--authorization-id', 'synthetic-public-pilot',
    '--request-allowance-authorization-id', allowance.authorizationId,
    '--budget-extension-authorization-id', budget.authorizationId,
    '--cases', 'plain', '--case-timeout-policy', 'case-deadline-v1',
    '--case-authorization-id', 'synthetic-budget-extension-case', '--execution-id', executionId,
    '--expected-request-count', '0', '--expected-reserved-micro-usd', '0'];
  const stream = () => { const chunks = []; return { write(value) { chunks.push(value); return true; },
    text() { return chunks.join(''); } }; };
  let keyReads = 0;
  const env = {};
  Object.defineProperty(env, 'OPENAI_API_KEY', { get() { keyReads += 1; return KEY; } });
  const expectedBudget = { version: 'benchmark-budget-extension-v1',
    authorizationId: budget.authorizationId, priorLimitMicroUsd: 50_000_000,
    limitMicroUsd: 100_000_000, priorRequestCap: 20, requestCap: 5_000,
    checkpoint: { requestCount: 0, reservedMicroUsd: 0 }, historicalDigest: budget.historicalDigest };

  const keylessEnv = { ...process.env, NODE_NO_WARNINGS: '1' };
  delete keylessEnv.OPENAI_API_KEY;
  const processDry = spawnSync(process.execPath,
    [new URL('../public-pilot-cli.mjs', import.meta.url).pathname, ...base, '--dry-run'],
    { encoding: 'utf8', env: keylessEnv });
  assert.equal(processDry.status, 0, processDry.stderr);
  const processResult = JSON.parse(processDry.stdout);
  assert.deepEqual(processResult.budgetExtension, expectedBudget);
  assert.equal(processResult.ledger.limitMicroUsd, 100_000_000);
  assert.equal(processResult.ledger.requestCount, 0);
  await assert.rejects(lstat(path.join(f.ledger.directory,
    `experiment-case-deadline-${executionId}.claim.json`)), { code: 'ENOENT' });

  const dry = stream();
  assert.equal(await cliMain([...base, '--dry-run'], { env, stdout: dry, stderr: stream(),
    fetchImpl: () => assert.fail('no dry-run transport') }), 0);
  assert.deepEqual(JSON.parse(dry.text()).budgetExtension, expectedBudget);
  assert.equal(keyReads, 0);
  assert.equal(ledgerState(f.ledger).requestCount, 0);

  const missingAllowance = base.filter((value, index) => value !== '--request-allowance-authorization-id'
    && base[index - 1] !== '--request-allowance-authorization-id');
  const missingError = stream();
  assert.equal(await cliMain([...missingAllowance, '--dry-run'], { env, stdout: stream(), stderr: missingError,
    fetchImpl: () => assert.fail('no missing-allowance transport') }), 1);
  assert.equal(missingError.text(), 'budget_extension_requires_request_allowance\n');
  assert.equal(keyReads, 0);

  const calls = [];
  const output = f.output('budget-extension-live');
  const stdout = stream();
  assert.equal(await cliMain([...base, '--output', output], { env, stdout, stderr: stream(),
    fetchImpl: fakeUpstream({ calls }) }), 0);
  assert.equal(keyReads, 1);
  assert.ok(calls.length > 0);
  const finalOutput = JSON.parse(stdout.text().trimEnd().split('\n').at(-1));
  assert.deepEqual(finalOutput.budgetExtension, expectedBudget);
  const manifest = await readJson(output, 'manifest.json');
  const report = await readJson(output, 'report.json');
  assert.deepEqual(manifest.operator.budgetExtension, expectedBudget);
  assert.deepEqual(report.operator.budgetExtension, expectedBudget);
  assert.equal(ledgerState(f.ledger).requestCount, calls.length);
});

test('R1/R5: opt CLI live run consumes once and edited output cannot resume or reload the key', async (t) => {
  const f = await setup(t, { source: sourceCases().slice(0, 1) });
  const ledgerFile = f.output('case-live-ledger.json');
  await writeFile(ledgerFile, JSON.stringify(f.ledger), { mode: 0o600 });
  const output = f.output('case-cli-live');
  const executionId = 'synthetic-cli-live';
  const argv = ['--prepared', f.prepared, '--ledger', ledgerFile,
    '--authorization-id', 'synthetic-public-pilot', '--cases', 'plain', '--output', output,
    '--case-timeout-policy', 'case-deadline-v1', '--case-authorization-id', 'synthetic-case-cli-live',
    '--execution-id', executionId, '--expected-request-count', '0', '--expected-reserved-micro-usd', '0'];
  let keyReads = 0;
  const env = {};
  Object.defineProperty(env, 'OPENAI_API_KEY', { get() { keyReads += 1; return KEY; } });
  const stream = () => { const chunks = []; return { write(value) { chunks.push(value); return true; },
    text() { return chunks.join(''); } }; };
  const calls = [];
  const stdout = stream();
  assert.equal(await cliMain(argv, { env, stdout, stderr: stream(), fetchImpl: fakeUpstream({ calls }) }), 0);
  assert.equal(keyReads, 1);
  assert.ok(calls.length > 0);
  const final = JSON.parse(stdout.text().trimEnd().split('\n').at(-1));
  assert.equal(final.mode, 'run');
  assert.equal((await readJson(output, 'report.json')).caseTimeoutIdentity.executionId, executionId);
  const afterFirst = { calls: calls.length, ledger: ledgerState(f.ledger) };

  const repeatedError = stream();
  assert.equal(await cliMain(argv, { env, stdout: stream(), stderr: repeatedError,
    fetchImpl: fakeUpstream({ calls }) }), 1);
  assert.equal(repeatedError.text(), 'capability_consumed\n');
  assert.equal(keyReads, 1);
  assert.equal(calls.length, afterFirst.calls);
  assert.deepEqual(ledgerState(f.ledger), afterFirst.ledger);

  const checkpoint = await readJson(output, 'checkpoint.json');
  checkpoint.cases[ids.plain] = { stage: 'pending', attemptIds: [] };
  await writeFile(path.join(output, 'checkpoint.json'), JSON.stringify(checkpoint), { mode: 0o600 });
  const beforeEditedResume = await fileSnapshot(output);
  const resumeExecution = 'synthetic-cli-edited-resume';
  const resumeArgv = argv.map((value, index) => {
    if (argv[index - 1] === '--execution-id') return resumeExecution;
    if (argv[index - 1] === '--expected-request-count') return `${afterFirst.ledger.requestCount}`;
    if (argv[index - 1] === '--expected-reserved-micro-usd') return `${afterFirst.ledger.reservedMicroUsd}`;
    return value;
  });
  const resumeError = stream();
  assert.equal(await cliMain(resumeArgv, { env, stdout: stream(), stderr: resumeError,
    fetchImpl: fakeUpstream({ calls }) }), 1);
  assert.equal(resumeError.text(), 'case_output_must_be_new\n');
  assert.equal(keyReads, 1);
  assert.equal(calls.length, afterFirst.calls);
  assert.deepEqual(ledgerState(f.ledger), afterFirst.ledger);
  assert.deepEqual(await fileSnapshot(output), beforeEditedResume);
  await assert.rejects(lstat(path.join(f.ledger.directory,
    `experiment-case-deadline-${resumeExecution}.claim.json`)), { code: 'ENOENT' });
});

test('X1: a Cairn arm that packs no receipts is labelled by arm order and counted as a measured zero', async (t) => {
  const f = await setup(t, { source: [
    fixture({ id: 'plain', answerTurn: 'The plain color is amber.' }),
    fixture({ id: 'norecall', answerTurn: 'The norecall shade was chosen quietly last spring.' }),
  ] });
  const norecall = opaqueQuestionId('norecall');
  const session = f.session();
  const report = await runPublicPilot({ pilot: f.pilot, session, directory: f.output('zero-recall') });
  session.close();

  const stored = await readJson(f.output('zero-recall'), 'cases', norecall, 'answer-requests.json');
  assert.deepEqual(stored.requests.map((item) => item.armGuess), ['cairn', 'full-history', 'no-memory']);
  assert.ok(stored.requests.every((item) => item.armLabelMethod === 'run-arm-order'));
  const cairnEvidence = JSON.parse(stored.requests[0].request.messages[1].content).evidence;
  assert.deepEqual(cairnEvidence, []);

  const truncation = await readJson(f.output('zero-recall'), 'cases', norecall, 'truncation.json');
  assert.equal(truncation.armStatus.cairn.status, 'completed');
  assert.equal(truncation.retrieval.selectedCount, 0);
  assert.equal(truncation.retrieval.candidateCount, 0);
  assert.deepEqual(truncation.packed,
    { receipts: 0, receiptsFromTruncatedChunks: 0, omittedUnits: 0, unmatched: 0 });

  const zeroCase = report.cases.find((item) => item.sourceQuestionId === 'norecall');
  assert.deepEqual(zeroCase.truncation.packed, truncation.packed);
  assert.notEqual(zeroCase.truncation.packed, null);
  const packedCases = report.cases.map((item) => item.truncation.packed);
  assert.ok(packedCases.every((item) => item !== null));
  const aggregate = await readJson(f.output('zero-recall'), 'aggregate.json');
  assert.equal(aggregate.truncation.packedReceipts,
    packedCases.reduce((sum, item) => sum + item.receipts, 0));
  assert.ok(aggregate.truncation.packedReceipts > 0);
});

test('X2: a completed case missing its accounting artifacts refuses the resume and sends nothing', async (t) => {
  const f = await setup(t);
  const output = f.output('half-written');
  const first = f.session();
  await runPublicPilot({ pilot: f.pilot, session: first, directory: output, caseIds: [ids.plain] });
  first.close();
  const callsAfterFirst = f.calls.length;
  await rm(path.join(output, 'report.json'));
  await rm(path.join(output, 'aggregate.json'));
  await rm(path.join(output, 'cases', ids.plain, 'accounting.json'));
  const second = f.session();
  await assert.rejects(runPublicPilot({ pilot: f.pilot, session: second, directory: output, caseIds: [ids.plain] }),
    { code: 'invalid_checkpoint' });
  second.close();
  assert.equal(f.calls.length, callsAfterFirst);
});

test('X4: aggregate.json without report.json is its own code, and removing it lets the run finish', async (t) => {
  const f = await setup(t);
  const output = f.output('aggregate-only');
  const first = f.session();
  const report = await runPublicPilot({ pilot: f.pilot, session: first, directory: output, caseIds: [ids.plain] });
  first.close();
  const callsAfterFirst = f.calls.length;
  await rm(path.join(output, 'report.json'));
  const second = f.session();
  await assert.rejects(runPublicPilot({ pilot: f.pilot, session: second, directory: output, caseIds: [ids.plain] }),
    { code: 'aggregate_without_report' });
  await rm(path.join(output, 'aggregate.json'));
  const again = await runPublicPilot({ pilot: f.pilot, session: second, directory: output, caseIds: [ids.plain] });
  second.close();
  assert.equal(f.calls.length, callsAfterFirst);
  assert.deepEqual(again.cases, report.cases);
  assert.deepEqual(again.official, report.official);
});

test('S2: an existing non-empty directory is refused without changing its permissions', async (t) => {
  const f = await setup(t);
  const output = f.output('pre-existing');
  await mkdir(output, { mode: 0o755 });
  await chmod(output, 0o755);
  await writeFile(path.join(output, 'stray.json'), '{}', { mode: 0o644 });
  const before = await readdir(output);
  const session = f.session();
  await assert.rejects(runPublicPilot({ pilot: f.pilot, session, directory: output }), { code: 'output_not_empty' });
  session.close();
  assert.equal((await lstat(output)).mode & 0o777, 0o755);
  assert.deepEqual(await readdir(output), before);
  assert.deepEqual(before, ['stray.json']);
  assert.equal((await lstat(path.join(output, 'stray.json'))).mode & 0o777, 0o644);
  assert.equal(f.calls.length, 0);
});

test('N12: every CLI refusal exits 1 with a fixed code and no transport call', async (t) => {
  const f = await setup(t);
  const out = () => {
    const chunks = [];
    return { write: (text) => { chunks.push(text); return true; }, text: () => chunks.join('') };
  };
  const noTransport = () => assert.fail('transport must not be invoked');
  const ledgerFile = f.output('ledger.json');
  await writeFile(ledgerFile, JSON.stringify(f.ledger), { mode: 0o600 });
  await chmod(ledgerFile, 0o600);
  const garbage = f.output('garbage.json');
  await writeFile(garbage, 'not json', { mode: 0o600 });
  await chmod(garbage, 0o600);
  const emptyLedger = f.output('empty-ledger.json');
  await writeFile(emptyLedger, '{}', { mode: 0o600 });
  await chmod(emptyLedger, 0o600);
  const badExclusions = f.output('bad-exclusions.json');
  await writeFile(badExclusions, '{}');
  const base = ['--prepared', f.prepared, '--ledger', ledgerFile,
    '--authorization-id', 'synthetic-public-pilot', '--dry-run'];
  const rows = [
    { code: 'duplicate_flag --dry-run', argv: ['--dry-run', '--dry-run'] },
    { code: 'unknown_flag', argv: ['--bogus'] },
    { code: 'invalid_flag_value --prepared', argv: ['--prepared'] },
    { code: 'invalid_flag_value --prepared', argv: ['--prepared', '--ledger', ledgerFile] },
    { code: 'sidecar_flags_incomplete', argv: [...base, '--sidecar', f.prepared] },
    { code: 'cap_flags_incomplete', argv: [...base, '--batch-cap-micro-usd', '1000'] },
    { code: 'invalid_number --batch-cap-micro-usd',
      argv: [...base, '--batch-cap-micro-usd', 'abc', '--batch-request-cap', '600'] },
    { code: 'invalid_number --max-prepared-cases',
      argv: [...base, '--max-prepared-cases', 'abc'] },
    { code: 'invalid_max_prepared_cases', argv: [...base, '--max-prepared-cases', '0'] },
    { code: 'invalid_max_prepared_cases', argv: [...base, '--max-prepared-cases', '501'] },
    { code: 'invalid_run_commit', argv: [...base, '--run-commit', 'ZZZZZZZ'] },
    { code: 'input_unreadable',
      argv: ['--prepared', f.prepared, '--ledger', f.output('missing.json'),
        '--authorization-id', 'synthetic-public-pilot', '--dry-run'] },
    { code: 'input_invalid_json',
      argv: ['--prepared', f.prepared, '--ledger', garbage,
        '--authorization-id', 'synthetic-public-pilot', '--dry-run'] },
    { code: 'invalid_ledger_config',
      argv: ['--prepared', f.prepared, '--ledger', emptyLedger,
        '--authorization-id', 'synthetic-public-pilot', '--dry-run'] },
    { code: 'invalid_exclusions', argv: [...base, '--exclusions-file', badExclusions] },
  ];
  for (const row of rows) {
    const stdout = out();
    const stderr = out();
    const exit = await cliMain(row.argv, { env: {}, stdout, stderr, fetchImpl: noTransport });
    assert.equal(exit, 1, row.code);
    assert.equal(stderr.text(), `${row.code}\n`, row.code);
    assert.equal(stdout.text(), '', row.code);
  }
  assert.equal(f.calls.length, 0);
  assert.equal(ledgerState(f.ledger).requestCount, 0);
});

test('A1: a failed generation missing its accounting artifacts refuses the resume and sends nothing', async (t) => {
  const f = await setup(t);
  const output = f.output('failed-half-written');
  let poisoned = false;
  const session = f.session((body) => {
    if (body.model === ANSWER_MODEL && !poisoned) {
      poisoned = true;
      return new Response('not json', { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return defaultChat(body);
  });
  await runPublicPilot({ pilot: f.pilot, session, directory: output, caseIds: [ids.plain] });
  session.close();
  const callsAfterFirst = f.calls.length;
  assert.ok(callsAfterFirst > 0);

  // A halted case still reserved real spend before its generation record was written.
  const generation = await readJson(output, 'cases', ids.plain, 'generation.json');
  assert.equal(generation.status, 'completed');
  const accounting = await readJson(output, 'cases', ids.plain, 'accounting.json');
  assert.ok(accounting.totals['cairn-count'].requests > 0);

  // Rewrite the record as a crash would leave it: failed, with its companions gone.
  await rm(path.join(output, 'report.json'));
  await rm(path.join(output, 'aggregate.json'));
  for (const name of ['accounting.json', 'answer-requests.json', 'truncation.json']) {
    await rm(path.join(output, 'cases', ids.plain, name));
  }
  await rm(path.join(output, 'cases', ids.plain, 'generation.json'));
  await writeFile(path.join(output, 'cases', ids.plain, 'generation.json'),
    JSON.stringify({ schemaVersion: 'cairn-longmemeval-public-pilot-v1', questionId: ids.plain,
      status: 'failed', latencyMs: 1, error: { code: 'generation_failed' } }), { mode: 0o600 });
  const checkpoint = await readJson(output, 'checkpoint.json');
  checkpoint.cases[ids.plain] = { stage: 'generating', attemptIds: [] };
  checkpoint.halted = false;
  await writeFile(path.join(output, 'checkpoint.json'), JSON.stringify(checkpoint), { mode: 0o600 });

  const second = f.session();
  await assert.rejects(runPublicPilot({ pilot: f.pilot, session: second, directory: output, caseIds: [ids.plain] }),
    { code: 'invalid_checkpoint' });
  second.close();
  assert.equal(f.calls.length, callsAfterFirst);
});

test('A3: the evidence-shape fallback labels requests when no run record backs them', async (t) => {
  const f = await setup(t);
  const cairnRequest = (evidence) => ({ messages: [{ role: 'system', content: 'Answer from evidence.' },
    { role: 'user', content: JSON.stringify({ question: { text: 'q', date: 'd' }, evidence }) }] });
  // Each label is derived from the payload exactly as the runner derives it.
  const payloads = [cairnRequest([{ receipts: [] }]), cairnRequest([{ turns: [] }]), cairnRequest([])];
  const entries = () => payloads.map((request, order) =>
    ({ order, armGuess: evidenceArmGuess(request), request }));
  assert.deepEqual(entries().map((entry) => entry.armGuess), ['cairn', 'full-history', 'unknown']);
  assert.equal(evidenceArmGuess({ messages: [{ content: 'x' }, { content: 'not json' }] }), 'unknown');
  assert.equal(evidenceArmGuess(cairnRequest([{ receipts: [] }, { turns: [] }])), 'unknown');

  // No run record at all: the shape decides, and an empty evidence array stays unknown,
  // because a Cairn arm that packed nothing looks exactly like the no-memory arm.
  const withoutRun = labelCapturedArms(entries(), null);
  assert.deepEqual(withoutRun.map((entry) => entry.armGuess), ['cairn', 'full-history', 'unknown']);
  assert.ok(withoutRun.every((entry) => entry.armLabelMethod === 'evidence-shape-fallback'));

  // A run record that accounts for fewer requests than were captured is not trusted positionally.
  const partialRun = { arms: [{ name: 'cairn', status: 'completed', diagnostics: { preflight: { inputTokens: 1 } } }] };
  const mismatched = labelCapturedArms(entries(), partialRun);
  assert.ok(mismatched.every((entry) => entry.armLabelMethod === 'evidence-shape-fallback'));
  assert.deepEqual(mismatched.map((entry) => entry.armGuess), ['cairn', 'full-history', 'unknown']);

  // The positional path still wins whenever the counts agree.
  const fullRun = { arms: ['cairn', 'full-history', 'no-memory'].map((name) =>
    ({ name, status: 'completed', diagnostics: { preflight: { inputTokens: 1 } } })) };
  const positional = labelCapturedArms(entries(), fullRun);
  assert.deepEqual(positional.map((entry) => entry.armGuess), ['cairn', 'full-history', 'no-memory']);
  assert.ok(positional.every((entry) => entry.armLabelMethod === 'run-arm-order'));
});

test('PO1-PO4: case artifacts distinguish adapter and core rejection without changing generation', async (t) => {
  const source = [
    fixture({ id: 'adapterbad', answerTurn: 'The adapterbad color is amber.' }),
    fixture({ id: 'corebadrange', answerTurn: 'The corebadrange color is amber.' }),
    fixture({ id: 'corebadduplicate', answerTurn: 'The corebadduplicate color is amber.' }),
    fixture({ id: 'partial', answerTurn: 'The partial color is amber.' }),
    fixture({ id: 'clean', answerTurn: 'The clean color is amber.' }),
  ];
  const caseIds = Object.fromEntries(source.map(({ question_id: id }) => [id, opaqueQuestionId(id)]));
  const f = await setup(t, { source });
  const generation = (body, record, method) => {
    const input = JSON.parse(body.input[0].content[0].text);
    const serialized = JSON.stringify(input);
    if (method === 'extract' && serialized.includes('adapterbad')) {
      const response = responsesEnvelope(body.model, { items: [] });
      response.output[0].content[0].text = '{not-json';
      return Response.json(response);
    }
    if (method === 'extract' && serialized.includes('corebadrange')) {
      return Response.json(responsesEnvelope(body.model, { items: [{ content: 'synthetic invalid item',
        kind: 'fact', confidence: 0.5, sourceIndices: [99] }] }));
    }
    if (method === 'extract' && serialized.includes('corebadduplicate')) {
      return Response.json(responsesEnvelope(body.model, { items: [{ content: 'synthetic invalid item',
        kind: 'fact', confidence: 0.5, sourceIndices: [0, 0] }] }));
    }
    if (method === 'extract' && serialized.includes('partial')) {
      return Response.json(responsesEnvelope(body.model, { items: [{ content: 'partial classification marker',
        kind: 'fact', confidence: 0.5, sourceIndices: [0] }] }));
    }
    if (method === 'classify' && serialized.includes('partial classification marker')) {
      const response = responsesEnvelope(body.model, { items: [] });
      response.output[0].content[0].text = '{not-json';
      return Response.json(response);
    }
    return Response.json(responsesEnvelope(body.model, scripted[method](input)));
  };
  const session = f.session(null, null, generation);
  const output = f.output('diagnostic-rejections');
  const report = await runPublicPilot({ pilot: f.pilot, session, directory: output });
  session.close();

  const adapter = await readJson(output, 'cases', caseIds.adapterbad, 'diagnostics.json');
  const coreRange = await readJson(output, 'cases', caseIds.corebadrange, 'diagnostics.json');
  const coreDuplicate = await readJson(output, 'cases', caseIds.corebadduplicate, 'diagnostics.json');
  const partial = await readJson(output, 'cases', caseIds.partial, 'diagnostics.json');
  const clean = await readJson(output, 'cases', caseIds.clean, 'diagnostics.json');
  assert.deepEqual(adapter.memoryModel.records, [
    { version: 1, stage: 'extract', layer: 'adapter', reason: 'output_json' },
    { version: 1, stage: 'extract', layer: 'core_call', reason: 'adapter_output_invalid' },
  ]);
  assert.deepEqual(coreRange.memoryModel.records,
    [{ version: 1, stage: 'extract', layer: 'core_validation', reason: 'invalid_extraction_source_range' }]);
  assert.deepEqual(coreDuplicate.memoryModel.records,
    [{ version: 1, stage: 'extract', layer: 'core_validation', reason: 'invalid_extraction_source_duplicate' }]);
  assert.ok(partial.memoryModel.records.some(record => record.stage === 'classify'));
  assert.deepEqual(clean.memoryModel.records, []);
  assert.ok([adapter, coreRange, coreDuplicate, partial, clean].every((item) => item.questionId
    && item.memoryModel.availability === 'available' && item.memoryModel.recordLimit === 64
    && item.memoryModel.droppedRecords === 0));
  assert.deepEqual(adapter.captureAdmission.records.map(record => record.status), ['failed']);
  assert.deepEqual(coreRange.captureAdmission.records.map(record => record.status), ['failed']);
  assert.deepEqual(coreDuplicate.captureAdmission.records.map(record => record.status), ['failed']);
  assert.deepEqual(partial.captureAdmission.records.map(record => [record.status,
    record.admittedReferenceCount, record.classificationStatus]), [['partial', 1, 'failed']]);
  assert.ok(clean.captureAdmission.records.every(record => record.status === 'completed'));
  assert.ok(clean.captureAdmission.records.some(record => record.admittedReferenceCount > 0));
  assert.deepEqual(adapter.answerCompletions.records.map((item) => [item.arm, item.diagnostic]), [
    ['full-history', { availability: 'available', finishReason: 'stop' }],
    ['no-memory', { availability: 'available', finishReason: 'stop' }],
  ]);
  assert.deepEqual(clean.answerCompletions.records.map((item) => item.diagnostic.finishReason),
    ['stop', 'stop', 'stop']);
  assert.equal(report.summary.generated, 5);
  assert.equal(report.summary.generationFailed, 0);
  assert.equal(Object.hasOwn(report, 'diagnostics'), false);
  assert.ok(report.cases.every((item) => Object.hasOwn(item, 'diagnostics') === false));

  const memoryGenerations = f.calls.filter((call) => call.pathname === URLS.generation);
  for (const marker of ['adapterbad', 'corebadrange', 'corebadduplicate']) {
    assert.equal(memoryGenerations.filter((call) => call.rawBody.includes(marker)).length, 1,
      `${marker} must stop memory generation after failed extraction`);
  }
  for (const diagnostic of [adapter, coreRange, coreDuplicate, partial, clean]) {
    const filename = path.join(output, 'cases', diagnostic.questionId, 'diagnostics.json');
    assert.equal((await lstat(filename)).mode & 0o777, 0o600);
    const text = await readFile(filename, 'utf8');
    assert.equal(text.includes(KEY), false);
    assert.equal(text.includes(RAW_PHRASE), false);
    assert.equal(text.includes('synthetic invalid item'), false);
    assert.ok(diagnostic.memoryModel.records.every((item) =>
      Object.keys(item).sort().join(',') === 'layer,reason,stage,version'));
  }
});

test('PO2-PO4: stop and length stay private while unknown finish rejection is unchanged', async (t) => {
  const f = await setup(t, { source: [fixture({ id: 'plain', answerTurn: 'The plain color is amber.' })] });
  const lengthChat = (body) => {
    const response = chatEnvelope(body.model, body.model === JUDGE_MODEL ? judgeText(body) : answerText(body));
    if (body.model === ANSWER_MODEL) response.choices[0].finish_reason = 'length';
    return Response.json(response);
  };
  const session = f.session(lengthChat);
  const output = f.output('length-finish');
  const report = await runPublicPilot({ pilot: f.pilot, session, directory: output });
  const diagnostics = await readJson(output, 'cases', ids.plain, 'diagnostics.json');
  assert.deepEqual(diagnostics.answerCompletions.records.map((item) => item.diagnostic), [
    { availability: 'available', finishReason: 'length' },
    { availability: 'available', finishReason: 'length' },
    { availability: 'available', finishReason: 'length' },
  ]);
  assert.ok(report.cases[0].arms.every((arm) => arm.generation.status === 'completed'));
  assert.equal(JSON.stringify(report).includes('finishReason'), false);
  assert.equal(JSON.stringify(await readJson(output, 'aggregate.json')).includes('finishReason'), false);
  session.close();

  const unknown = await setup(t, { source: [fixture({ id: 'plain', answerTurn: 'The plain color is amber.' })] });
  const unknownChat = (body) => {
    const response = chatEnvelope(body.model, body.model === JUDGE_MODEL ? judgeText(body) : answerText(body));
    if (body.model === ANSWER_MODEL) response.choices[0].finish_reason = 'content_filter';
    return Response.json(response);
  };
  const unknownSession = unknown.session(unknownChat);
  const unknownOutput = unknown.output('unknown-finish');
  const unknownReport = await runPublicPilot({ pilot: unknown.pilot, session: unknownSession,
    directory: unknownOutput });
  unknownSession.close();
  assert.ok(unknownReport.cases[0].arms.every((arm) => arm.generation.status === 'failed'
    && arm.generation.reason === 'answer_failed'));
  const unknownDiagnostics = await readJson(unknownOutput, 'cases', ids.plain, 'diagnostics.json');
  assert.ok(unknownDiagnostics.answerCompletions.records.every((item) =>
    JSON.stringify(item.diagnostic) === JSON.stringify({ availability: 'unavailable' })));
  assert.equal(unknownDiagnostics.answerCompletions.droppedRecords, 0);
});

test('PO3-PO4: observation is bounded and late case callbacks cannot contaminate the next case', async (t) => {
  const source = [
    fixture({ id: 'latefirst', answerTurn: 'The latefirst color is amber.' }),
    fixture({ id: 'latesecond', answerTurn: 'The latesecond color is amber.' }),
  ];
  const caseIds = Object.fromEntries(source.map(({ question_id: id }) => [id, opaqueQuestionId(id)]));
  const f = await setup(t, { source });
  let releaseLate;
  const late = new Promise((resolve) => { releaseLate = resolve; });
  let session;
  let scheduled = false;
  const generation = async (body, record, method) => {
    const input = JSON.parse(body.input[0].content[0].text);
    const serialized = JSON.stringify(input);
    if (method === 'extract' && serialized.includes('latefirst') && !scheduled) {
      scheduled = true;
      let reasonReads = 0;
      const changing = { version: 1, stage: 'extract', layer: 'adapter' };
      Object.defineProperty(changing, 'reason', { enumerable: true,
        get: () => reasonReads++ === 0 ? 'output_shape' : KEY });
      session.memoryModel.onDiagnostic(changing);
      session.memoryModel.onDiagnostic({ version: 1, stage: 'extract',
        layer: { secret: KEY, toString: () => 'adapter' }, reason: 'output_shape' });
      for (let index = 0; index < 66; index += 1) {
        session.memoryModel.onDiagnostic({ version: 1, stage: 'extract', layer: 'adapter',
          reason: 'output_json', raw: `${KEY}-${index}` });
      }
      session.memoryModel.onDiagnostic({ version: 1, stage: 'extract', layer: 'adapter', reason: 'not-allowlisted' });
      const hostile = {};
      Object.defineProperty(hostile, 'version', { get: () => { throw new Error(KEY); } });
      assert.doesNotThrow(() => session.memoryModel.onDiagnostic(hostile));
      late.then(() => session.memoryModel.onDiagnostic({ version: 1, stage: 'extract',
        layer: 'adapter', reason: 'output_shape' }));
    }
    if (method === 'extract' && serialized.includes('latesecond')) {
      releaseLate();
      await new Promise((resolve) => setImmediate(resolve));
    }
    return Response.json(responsesEnvelope(body.model, scripted[method](input)));
  };
  session = f.session(null, null, generation);
  const output = f.output('late-isolation');
  let firstSnapshot;
  await runPublicPilot({ pilot: f.pilot, session, directory: output,
    onCase: async ({ stage, index }) => {
      if (stage === 'generation' && index === 0) {
        firstSnapshot = await readFile(path.join(output, 'cases', caseIds.latefirst, 'diagnostics.json'), 'utf8');
      }
    } });
  session.close();
  const first = await readJson(output, 'cases', caseIds.latefirst, 'diagnostics.json');
  const second = await readJson(output, 'cases', caseIds.latesecond, 'diagnostics.json');
  assert.equal(first.memoryModel.records.length, 64);
  assert.equal(first.memoryModel.droppedRecords, 3);
  assert.ok(first.memoryModel.records.every((item) => Object.keys(item).sort().join(',')
    === 'layer,reason,stage,version'));
  assert.equal(JSON.stringify(first).includes(KEY), false);
  assert.deepEqual(second.memoryModel.records, []);
  assert.equal(second.memoryModel.droppedRecords, 0);
  assert.equal(first.recallStages.closed, true);
  assert.equal(second.recallStages.closed, true);
  assert.equal(first.recallStages.selection.invocationCount, 1);
  assert.equal(second.recallStages.selection.invocationCount, 1);
  assert.equal(first.recallStages.ranking.invocationCount, 1);
  assert.equal(second.recallStages.ranking.invocationCount, 1);
  assert.equal(await readFile(path.join(output, 'cases', caseIds.latefirst, 'diagnostics.json'), 'utf8'), firstSnapshot);
});

test('PO3-PO4: concurrent live sessions keep diagnostic contexts isolated', async (t) => {
  const one = await setup(t, { source: [fixture({ id: 'plain', answerTurn: 'The plain color is amber.' })] });
  const two = await setup(t, { source: [fixture({ id: 'plain', answerTurn: 'The plain color is amber.' })] });
  let secondStarted;
  const secondGate = new Promise((resolve) => { secondStarted = resolve; });
  let sessionOne;
  let injected = false;
  const generationOne = async (body, record, method) => {
    const input = JSON.parse(body.input[0].content[0].text);
    if (method === 'extract' && !injected) {
      injected = true;
      sessionOne.memoryModel.onDiagnostic({ version: 1, stage: 'extract', layer: 'adapter', reason: 'output_json' });
      await secondGate;
    }
    return Response.json(responsesEnvelope(body.model, scripted[method](input)));
  };
  const generationTwo = (body, record, method) => {
    const input = JSON.parse(body.input[0].content[0].text);
    if (method === 'extract') secondStarted();
    return Response.json(responsesEnvelope(body.model,
      method === 'select' ? { refs: [] } : scripted[method](input)));
  };
  sessionOne = one.session(null, null, generationOne);
  const sessionTwo = two.session(null, null, generationTwo);
  const outputOne = one.output('concurrent-one');
  const outputTwo = two.output('concurrent-two');
  await Promise.all([
    runPublicPilot({ pilot: one.pilot, session: sessionOne, directory: outputOne }),
    runPublicPilot({ pilot: two.pilot, session: sessionTwo, directory: outputTwo }),
  ]);
  sessionOne.close();
  sessionTwo.close();
  const diagnosticsOne = await readJson(outputOne, 'cases', ids.plain, 'diagnostics.json');
  const diagnosticsTwo = await readJson(outputTwo, 'cases', ids.plain, 'diagnostics.json');
  assert.deepEqual(diagnosticsOne.memoryModel.records,
    [{ version: 1, stage: 'extract', layer: 'adapter', reason: 'output_json' }]);
  assert.deepEqual(diagnosticsTwo.memoryModel.records, []);
  assert.equal(diagnosticsOne.recallStages.selection.records[0].returnedRefCount, 1);
  assert.equal(diagnosticsOne.recallStages.ranking.invocationCount, 1);
  assert.equal(diagnosticsTwo.recallStages.selection.records[0].returnedRefCount, 0);
  assert.equal(diagnosticsTwo.recallStages.ranking.invocationCount, 0);
  assert.equal(diagnosticsOne.recallStages.closed, true);
  assert.equal(diagnosticsTwo.recallStages.closed, true);
});

test('PO1/PO4: legacy custom sessions stay compatible and explicitly report unavailable observation', async (t) => {
  const f = await setup(t, { source: [fixture({ id: 'plain', answerTurn: 'The plain color is amber.' })] });
  const actual = f.session();
  const legacy = Object.freeze({ ...actual });
  const output = f.output('legacy-session');
  const report = await runPublicPilot({ pilot: f.pilot, session: legacy, directory: output });
  const diagnostics = await readJson(output, 'cases', ids.plain, 'diagnostics.json');
  assert.deepEqual(diagnostics.memoryModel,
    { availability: 'unavailable', recordLimit: 64, droppedRecords: null, records: [] });
  assert.equal(diagnostics.answerCompletions.availability, 'unavailable');
  assert.equal(diagnostics.answerCompletions.droppedRecords, null);
  assert.ok(diagnostics.answerCompletions.records.every((item) =>
    JSON.stringify(item.diagnostic) === JSON.stringify({ availability: 'unavailable' })));
  assert.equal(diagnostics.captureAdmission.availability, 'available');
  assert.ok(diagnostics.captureAdmission.records.length > 0);
  assert.ok(diagnostics.captureAdmission.records.every(record => record.status === 'completed'));

  const calls = f.calls.length;
  await rm(path.join(output, 'cases', ids.plain, 'diagnostics.json'));
  await rm(path.join(output, 'report.json'));
  await rm(path.join(output, 'aggregate.json'));
  const resumed = await runPublicPilot({ pilot: f.pilot, session: legacy, directory: output });
  actual.close();
  assert.equal(f.calls.length, calls);
  assert.deepEqual(resumed.official, report.official);
  assert.equal(await readFile(path.join(output, 'cases', ids.plain, 'diagnostics.json'), 'utf8').then(() => true,
    (error) => error.code === 'ENOENT'), true);
});

test('PO3/PO4: a diagnostic artifact write refusal preserves accounting and resume never repeats generation', async (t) => {
  const f = await setup(t, { source: [fixture({ id: 'plain', answerTurn: 'The plain color is amber.' })] });
  const output = f.output('diagnostic-write-refusal');
  const diagnosticPath = path.join(output, 'cases', ids.plain, 'diagnostics.json');
  let planted = false;
  const chat = async (body) => {
    if (body.model === ANSWER_MODEL && !planted) {
      planted = true;
      await writeFile(diagnosticPath, '{}', { mode: 0o600 });
    }
    return defaultChat(body);
  };
  const first = f.session(chat);
  await assert.rejects(runPublicPilot({ pilot: f.pilot, session: first, directory: output }),
    { code: 'output_exists' });
  first.close();
  const callsAfterGeneration = f.calls.length;
  const accounting = await readJson(output, 'cases', ids.plain, 'accounting.json');
  assert.ok(accounting.attempts.length > 0);
  assert.equal(accounting.ledgerAfter.requestCount, ledgerState(f.ledger).requestCount);
  assert.equal((await readJson(output, 'checkpoint.json')).cases[ids.plain].stage, 'generating');

  await rm(diagnosticPath);
  const second = f.session();
  const report = await runPublicPilot({ pilot: f.pilot, session: second, directory: output });
  second.close();
  assert.equal(report.summary.generated, 1);
  assert.equal(report.summary.scored, 1);
  assert.equal(f.calls.slice(callsAfterGeneration).filter((call) => call.model === ANSWER_MODEL).length, 0);
  assert.equal(await readFile(diagnosticPath, 'utf8').then(() => true,
    (error) => error.code === 'ENOENT'), true);
});

test('CAO4: actual runner and core retain successful empty capture admission counts', async t => {
  const source = [fixture({ id: 'plain', answerTurn: 'The plain color is amber.' })];
  const f = await setup(t, { source });
  const generation = (body, record, method) => {
    const input = JSON.parse(body.input[0].content[0].text);
    return Response.json(responsesEnvelope(body.model,
      method === 'extract' ? { items: [] } : scripted[method](input)));
  };
  const session = f.session(null, null, generation);
  const output = f.output('capture-admission-empty');
  await runPublicPilot({ pilot: f.pilot, session, directory: output });
  session.close();
  const diagnostics = await readJson(output, 'cases', ids.plain, 'diagnostics.json');
  assert.equal(Object.hasOwn(diagnostics, 'captureAdmission'), true,
    'successful empty capture currently has no retained admission-count observation');
  assert.equal(diagnostics.captureAdmission.schemaVersion, CAPTURE_ADMISSION_OBSERVATION_VERSION);
  assert.equal(diagnostics.captureAdmission.availability, 'available');
  assert.equal(diagnostics.captureAdmission.recordLimit, 64);
  assert.equal(diagnostics.captureAdmission.droppedRecords, 0);
  assert.ok(diagnostics.captureAdmission.records.length > 0);
  assert.ok(diagnostics.captureAdmission.records.every((record) =>
    record.status === 'completed' && record.admittedReferenceCount === 0 && record.suppressedCount === 0
      && record.duplicateEvent === false && record.classificationStatus === 'skipped'));
  assert.equal(JSON.stringify(await readJson(output, 'aggregate.json')).includes('captureAdmission'), false);
  assert.equal(JSON.stringify(await readJson(output, 'report.json')).includes('captureAdmission'), false);

  const baseline = await setup(t, { source });
  const baselineSession = baseline.session(null, null, generation);
  const databaseRoot = await mkdtemp(path.join(tmpdir(), 'cairn-unobserved-public-comparison-'));
  t.after(() => rm(databaseRoot, { recursive: true, force: true }));
  const core = openMemoryCore({ path: path.join(databaseRoot, 'memory.sqlite'), model: baselineSession.memoryModel });
  const item = baseline.pilot.cases[0];
  const directAnswerRequests = [];
  const directRun = await runPublicComparison({ history: item.history, question: item.question,
    namespace: { ownerId: OWNER_ID, scope: 'project', projectId: item.question.question_id }, core,
    answer: call => { directAnswerRequests.push(structuredClone(call.request)); return baselineSession.answer(call); },
    countTokens: baselineSession.countTokens, answerModel: baselineSession.stages.answer.model,
    limits: PUBLIC_PILOT_LIMITS });
  const directScore = await scorePublicComparison({ run: directRun,
    evaluator: pilotEvaluatorFor(baseline.pilot, item.question.question_id), judge: baselineSession.judge,
    judgeTimeoutMs: 90_000 });
  core.close();
  const directAttempts = baselineSession.attempts();
  baselineSession.close();
  const generated = await readJson(output, 'cases', ids.plain, 'generation.json');
  const scored = await readJson(output, 'cases', ids.plain, 'scoring.json');
  const storedRequests = await readJson(output, 'cases', ids.plain, 'answer-requests.json');
  const stripLatency = value => JSON.parse(JSON.stringify(value, (key, entry) =>
    key === 'latencyMs' ? undefined : entry));
  assert.deepEqual(stripLatency(generated.run), stripLatency(directRun));
  assert.deepEqual(scored.score, directScore);
  assert.deepEqual(storedRequests.requests.map(entry => entry.request), directAnswerRequests);
  const callShape = call => ({ pathname: call.pathname, rawBody: call.rawBody });
  assert.deepEqual(f.calls.map(callShape), baseline.calls.map(callShape));
  const accounting = await readJson(output, 'cases', ids.plain, 'accounting.json');
  const attemptShape = attempt => ({ stage: attempt.stage, reservedMicroUsd: attempt.reservedMicroUsd,
    actualMicroUsd: attempt.actualMicroUsd, outcome: attempt.outcome,
    ...(attempt.countDiagnostic ? { countDiagnostic: attempt.countDiagnostic } : {}) });
  assert.deepEqual([...accounting.attempts, ...scored.accounting.attempts].map(attemptShape),
    directAttempts.map(attemptShape));
  const recallStages = diagnostics.recallStages;
  assert.equal(recallStages.schemaVersion, RECALL_STAGE_OBSERVATION_VERSION);
  assert.equal(recallStages.closed, true);
  assert.equal(recallStages.selection.invocationCount, 1);
  assert.equal(recallStages.ranking.invocationCount, 0);
  assert.deepEqual(recallStages.recall.records[0].mapExhausted, [true]);
  assert.deepEqual(recallStages.recall.records[0].fetchExhausted, [true]);
  assert.equal(JSON.stringify(generated).includes('recallStages'), false);
  assert.equal(JSON.stringify(scored).includes('recallStages'), false);
  assert.equal(JSON.stringify(await readJson(output, 'aggregate.json')).includes('recallStages'), false);
  assert.equal(JSON.stringify(await readJson(output, 'report.json')).includes('recallStages'), false);
});

test('O2/O5: actual runner, guarded fake HTTP and core distinguish selection, ranking and packing losses', async t => {
  const run = async (name, { generation, countTokens, limits } = {}) => {
    const f = await setup(t, { source: [fixture({ id: 'plain', answerTurn: 'The plain color is amber.' })] });
    const actual = f.session(null, null, generation);
    const session = countTokens ? Object.freeze({ ...actual, countTokens }) : actual;
    const output = f.output(name);
    const report = await runPublicPilot({ pilot: f.pilot, session, directory: output,
      ...(limits ? { limits } : {}) });
    actual.close();
    return { f, output, report, diagnostics: await readJson(output, 'cases', ids.plain, 'diagnostics.json'),
      generation: await readJson(output, 'cases', ids.plain, 'generation.json') };
  };
  const scriptedGeneration = (overrides = {}) => (body, record, method) => {
    const input = JSON.parse(body.input[0].content[0].text);
    const output = Object.hasOwn(overrides, method) ? overrides[method](input) : scripted[method](input);
    return Response.json(responsesEnvelope(body.model, output));
  };

  const emptyMap = await run('recall-empty-map', { generation: scriptedGeneration({
    extract: () => ({ items: [] }),
  }) });
  const emptyMapStages = emptyMap.diagnostics.recallStages;
  assert.deepEqual(emptyMapStages.selection.records.map((entry) => ({
    visibleItemCount: entry.visibleItemCount, returnedRefCount: entry.returnedRefCount,
  })), [{ visibleItemCount: 0, returnedRefCount: 0 }]);
  assert.equal(emptyMapStages.ranking.invocationCount, 0);
  assert.deepEqual(emptyMapStages.recall.records[0].mapExhausted, [true]);

  const emptySelection = await run('recall-empty-selection', { generation: scriptedGeneration({
    select: () => ({ refs: [] }),
  }) });
  const selectionStages = emptySelection.diagnostics.recallStages;
  assert.ok(selectionStages.selection.records[0].visibleItemCount > 0);
  assert.equal(selectionStages.selection.records[0].returnedRefCount, 0);
  assert.equal(selectionStages.selection.records[0].cumulativeUniqueSelectedRefCount, 0);
  assert.equal(selectionStages.ranking.invocationCount, 0);
  assert.equal(emptySelection.generation.run.arms[0].diagnostics.retrieval.candidateCount, 0);

  const emptyRanking = await run('recall-empty-ranking', { generation: scriptedGeneration({
    rank: () => ({ refs: [] }),
  }) });
  const rankingStages = emptyRanking.diagnostics.recallStages;
  assert.ok(rankingStages.selection.records[0].returnedRefCount > 0);
  assert.equal(rankingStages.ranking.invocationCount, 1);
  assert.ok(rankingStages.ranking.records[0].inputCandidateCount > 0);
  assert.equal(rankingStages.ranking.records[0].returnedRefCount, 0);
  assert.equal(emptyRanking.generation.run.arms[0].diagnostics.retrieval.candidateCount, 0);

  const packing = await run('recall-packing-omission', {
    countTokens: (text) => text.includes('memoryId') ? 1_000 : 1,
    limits: { ...PUBLIC_PILOT_LIMITS, contextWindow: 600 },
  });
  const packingStages = packing.diagnostics.recallStages;
  assert.ok(packingStages.ranking.records[0].returnedRefCount > 0);
  const packingRetrieval = packing.generation.run.arms[0].diagnostics.retrieval;
  assert.ok(packingRetrieval.candidateCount > 0);
  assert.equal(packingRetrieval.selectedCount, 0);
  assert.equal(packingRetrieval.omitted.length, packingRetrieval.candidateCount);
  assert.equal(JSON.stringify(packing.diagnostics).includes(KEY), false);
  assert.equal(JSON.stringify(packing.diagnostics).includes(RAW_PHRASE), false);

  const selectError = await run('recall-select-error', { generation: scriptedGeneration({
    select: () => ({ malformed: true }),
  }) });
  assert.equal(selectError.diagnostics.recallStages.selection.records[0].status, 'unavailable');
  assert.equal(selectError.diagnostics.recallStages.ranking.invocationCount, 0);
  assert.equal(selectError.diagnostics.recallStages.recall.records[0].status, 'failed');
  assert.equal(selectError.generation.run.arms[0].status, 'failed');

  const rankError = await run('recall-rank-error', { generation: scriptedGeneration({
    rank: () => ({ malformed: true }),
  }) });
  assert.equal(rankError.diagnostics.recallStages.selection.records[0].status, 'completed');
  assert.equal(rankError.diagnostics.recallStages.ranking.records[0].status, 'unavailable');
  assert.equal(rankError.diagnostics.recallStages.recall.records[0].status, 'failed');
  assert.equal(rankError.generation.run.arms[0].status, 'failed');

  for (const item of [emptyMap, emptySelection, emptyRanking, packing]) {
    assert.equal(item.report.summary.generated, 1);
    assert.equal(item.report.summary.scored, 1);
    assert.equal(item.diagnostics.recallStages.schemaVersion, RECALL_STAGE_OBSERVATION_VERSION);
    assert.equal(item.diagnostics.recallStages.closed, true);
    assert.equal(item.diagnostics.recallStages.recall.records[0].status, 'completed');
    assert.equal(JSON.stringify(item.report).includes('recallStages'), false);
  }
  for (const item of [selectError, rankError]) {
    assert.equal(item.report.summary.generated, 1);
    assert.equal(item.diagnostics.recallStages.closed, true);
    assert.equal(JSON.stringify(item.diagnostics).includes('"malformed":true'), false);
  }
});

test('O1/O5: nonempty actual-core observation preserves frozen-adapter payloads, output and scoring', async t => {
  const f = await setup(t, { source: [fixture({ id: 'plain', answerTurn: 'The plain color is amber.' })] });
  const item = f.pilot.cases[0];
  const namespace = { ownerId: OWNER_ID, scope: 'project', projectId: item.question.question_id };
  const plan = planLongMemEvalCase({ history: item.history, namespace });
  const source = plan.batches[0].sourceMap[0];
  const seedPath = path.join(f.root, 'recall-stage-seed.sqlite');
  const seed = openMemoryCore({ path: seedPath });
  const admitted = seed.admit({ namespace, memory: { content: 'private generated interpretation', kind: 'fact' },
    receipts: [{ client: INGESTION_CLIENT, sessionId: plan.batches[0].captureInput.sessionId,
      eventId: source.messageId, role: source.role,
      excerpt: canonicalStoredReceiptExcerpt(source.normalizedContent) }] });
  assert.equal(admitted.ok, true, JSON.stringify(admitted));
  const memoryRef = admitted.value.memory;
  seed.close();
  const observedPath = path.join(f.root, 'observed.sqlite');
  const baselinePath = path.join(f.root, 'baseline.sqlite');
  await cp(seedPath, observedPath);
  await cp(seedPath, baselinePath);

  const observedSession = f.session();
  const baselineSession = f.session();
  assert.equal(Object.isFrozen(observedSession.memoryModel), true);
  assert.equal(Object.isFrozen(baselineSession.memoryModel), true);
  const collector = createRecallStageCollector();
  const observedCore = openMemoryCore({ path: observedPath,
    model: collector.observeModel(observedSession.memoryModel) });
  const baselineCore = openMemoryCore({ path: baselinePath, model: baselineSession.memoryModel });
  const captureResponse = { ok: true, value: { duplicate: false,
    admission: { memories: [{ id: memoryRef.id, revision: memoryRef.revision }], suppressedCount: 0, indexRevision: 1 },
    classification: { status: 'skipped', reason: 'already_filed' } } };
  const comparisonCore = (core, observed = false) => ({ ...core,
    list: () => ({ ok: true, value: { memories: [], exhausted: true, nextCursor: null } }),
    capture: () => captureResponse,
    ...(observed ? { recall: (...args) => collector.observeRecall(() => Reflect.apply(core.recall, core, args)) } : {}),
  });
  const compare = async (core, session) => {
    const run = await runPublicComparison({ history: item.history, question: item.question, namespace, core,
      answer: session.answer, countTokens: session.countTokens, answerModel: session.stages.answer.model,
      limits: PUBLIC_PILOT_LIMITS });
    const score = await scorePublicComparison({ run, evaluator: pilotEvaluatorFor(f.pilot, item.question.question_id),
      judge: session.judge, judgeTimeoutMs: 90_000 });
    return { run, score };
  };
  const observedCallStart = f.calls.length;
  const observed = await compare(comparisonCore(observedCore, true), observedSession);
  const observedCalls = f.calls.slice(observedCallStart);
  collector.close();
  const baselineCallStart = f.calls.length;
  const baseline = await compare(comparisonCore(baselineCore), baselineSession);
  const baselineCalls = f.calls.slice(baselineCallStart);
  observedCore.close();
  baselineCore.close();
  observedSession.close();
  baselineSession.close();

  const withoutLatency = value => JSON.parse(JSON.stringify(value, (key, entry) =>
    key === 'latencyMs' ? undefined : entry));
  assert.deepEqual(withoutLatency(observed.run), withoutLatency(baseline.run));
  assert.deepEqual(observed.score, baseline.score);
  assert.deepEqual(observedCalls.map(call => [call.pathname, call.rawBody]),
    baselineCalls.map(call => [call.pathname, call.rawBody]));
  assert.equal(observed.run.arms[0].diagnostics.retrieval.candidateCount, 1);
  const snapshot = collector.snapshot();
  assert.equal(snapshot.selection.records[0].returnedRefCount, 1);
  assert.equal(snapshot.ranking.records[0].inputCandidateCount, 1);
  assert.equal(snapshot.ranking.records[0].returnedRefCount, 1);
  assert.deepEqual(snapshot.recall.records[0].mapExhausted, [true]);
  assert.deepEqual(snapshot.recall.records[0].fetchExhausted, [true]);
  assert.equal(JSON.stringify(snapshot).includes('private generated interpretation'), false);
  assert.equal(JSON.stringify(snapshot).includes(memoryRef.id), false);
});

test('CAO2/CAO3: capture projection distinguishes outcomes and rejects malformed or hostile metadata', () => {
  const reference = { id: 'synthetic-memory', revision: 1 };
  const fresh = (memories, suppressedCount, classification) => ({ ok: true, value: { duplicate: false,
    admission: { memories, suppressedCount, indexRevision: 1 }, classification } });
  const expected = (batchOrdinal, status, admittedReferenceCount, suppressedCount,
    duplicateEvent, classificationStatus) => ({ batchOrdinal, status, admittedReferenceCount,
    suppressedCount, duplicateEvent, classificationStatus });
  assert.deepEqual(projectCaptureAdmissionObservation(fresh([], 0,
    { status: 'skipped', reason: 'empty' }), 0), expected(0, 'completed', 0, 0, false, 'skipped'));
  assert.deepEqual(projectCaptureAdmissionObservation(fresh([], 1,
    { status: 'skipped', reason: 'empty' }), 1), expected(1, 'completed', 0, 1, false, 'skipped'));
  assert.deepEqual(projectCaptureAdmissionObservation(fresh([reference], 0,
    { status: 'applied', memoryRevisions: [{ memoryId: reference.id, revision: 2 }], indexRevision: 2 }), 2),
  expected(2, 'completed', 1, 0, false, 'applied'));
  assert.deepEqual(projectCaptureAdmissionObservation({ ok: true, value: { duplicate: true,
    memoryIds: [reference.id], suppressedCount: 0 } }, 3), expected(3, 'completed', 1, 0, true, null));
  assert.deepEqual(projectCaptureAdmissionObservation({ ok: false,
    error: { code: 'invalid_model_output', retryable: false } }, 4),
  expected(4, 'failed', null, null, null, null));
  assert.deepEqual(projectCaptureAdmissionObservation(fresh([reference], 0,
    { status: 'failed', error: { code: 'classification_failed', retryable: false } }), 5),
  expected(5, 'partial', 1, 0, false, 'failed'));

  const malformed = [
    { ok: true, value: { processing: true } },
    { ok: true, value: { duplicate: true, memoryIds: Array(1), suppressedCount: 0 } },
    { ok: true, value: { duplicate: true,
      memoryIds: Object.assign(Array(1), { extra: reference.id }), suppressedCount: 0 } },
    { ok: true, value: { duplicate: true, memoryIds: [{}], suppressedCount: 0 } },
    fresh([{ id: '', revision: 1 }], 0, { status: 'skipped', reason: 'empty' }),
    fresh([reference], 0, { status: 'applied', memoryRevisions: [{ memoryId: {}, revision: 1 }], indexRevision: 1 }),
    { ok: false, error: { code: { toString: () => 'invalid_model_output' }, retryable: false } },
  ];
  for (const [batchOrdinal, response] of malformed.entries()) {
    assert.deepEqual(projectCaptureAdmissionObservation(response, batchOrdinal),
      expected(batchOrdinal, 'unavailable', null, null, null, null));
  }

  let okReads = 0; let valueReads = 0; let duplicateReads = 0;
  const hostileValue = {};
  Object.defineProperties(hostileValue, {
    duplicate: { enumerable: true, get: () => { duplicateReads += 1; return true; } },
    memoryIds: { enumerable: true, value: [reference.id] },
    suppressedCount: { enumerable: true, value: 0 },
  });
  const hostile = {};
  Object.defineProperties(hostile, {
    ok: { enumerable: true, get: () => { okReads += 1; return true; } },
    value: { enumerable: true, get: () => { valueReads += 1; return hostileValue; } },
  });
  assert.deepEqual(projectCaptureAdmissionObservation(hostile, 9),
    expected(9, 'completed', 1, 0, true, null));
  assert.deepEqual([okReads, valueReads, duplicateReads], [1, 1, 1]);
  const throwing = {};
  Object.defineProperty(throwing, 'ok', { enumerable: true, get: () => { throw new Error(KEY); } });
  assert.doesNotThrow(() => projectCaptureAdmissionObservation(throwing, 10));
  assert.deepEqual(projectCaptureAdmissionObservation(throwing, 10),
    expected(10, 'unavailable', null, null, null, null));
  for (const ordinal of [NaN, -1, { toString: () => { throw new Error(KEY); } }]) {
    assert.deepEqual(projectCaptureAdmissionObservation({ ok: true, value: {} }, ordinal),
      expected(null, 'unavailable', null, null, null, null));
  }
});

test('CAO3: capture collector bounds records, preserves throws and closes late observations per case', async () => {
  const empty = { ok: true, value: { duplicate: false,
    admission: { memories: [], suppressedCount: 0, indexRevision: 1 },
    classification: { status: 'skipped', reason: 'empty' } } };
  const first = createCaptureAdmissionCollector();
  for (let index = 0; index < 66; index += 1) {
    assert.equal(await first.capture(async () => empty), empty);
  }
  const bounded = first.snapshot();
  assert.equal(bounded.records.length, 64);
  assert.equal(bounded.droppedRecords, 2);
  assert.deepEqual(bounded.records.map(record => record.batchOrdinal),
    Array.from({ length: 64 }, (_, index) => index));
  let settle;
  const pending = first.capture(() => new Promise(resolve => { settle = resolve; }));
  const beforeLate = first.snapshot();
  first.close();
  const isolated = createCaptureAdmissionCollector();
  settle(empty);
  assert.equal(await pending, empty);
  assert.deepEqual(first.snapshot(), beforeLate);
  assert.deepEqual(isolated.snapshot().records, []);
  assert.equal(await first.capture(async () => empty), empty);
  assert.deepEqual(first.snapshot(), beforeLate);

  const second = createCaptureAdmissionCollector();
  const sentinel = new Error('synthetic throw must be preserved');
  let caught;
  try { await second.capture(async () => { throw sentinel; }); } catch (error) { caught = error; }
  assert.equal(caught, sentinel);
  assert.deepEqual(second.snapshot().records,
    [{ batchOrdinal: 0, status: 'failed', admittedReferenceCount: null,
      suppressedCount: null, duplicateEvent: null, classificationStatus: null }]);
  assert.deepEqual(first.snapshot(), beforeLate);
});

test('CAO2: actual core mixed filed dedup and fresh admission keeps a two-ref observation', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'cairn-capture-observation-core-'));
  const database = path.join(root, 'memory.sqlite');
  t.after(() => rm(root, { recursive: true, force: true }));
  const namespace = { ownerId: 'capture-observation', scope: 'personal', projectId: null };
  const model = { contextWindow: 8192, countTokens: () => 1,
    extract: ({ input }) => ({ items: input.messages.map(message => ({ content: message.content,
      kind: 'fact', confidence: 0.5, sourceIndices: [message.index] })) }),
    classify: ({ input }) => ({ items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) }) };
  const core = openMemoryCore({ path: database, model }); t.after(() => core.close());
  const capture = (eventId, messages) => core.capture({ namespace, client: 'synthetic', sessionId: 'session', eventId, messages });
  const existingMessage = { id: 'existing-source', role: 'assistant', content: 'Existing filed memory' };
  const first = await capture('first', [existingMessage]);
  assert.equal(first.ok, true, JSON.stringify(first));
  const existing = first.value.admission.memories[0];
  const current = core.get({ namespace, memoryId: existing.id });
  assert.equal(current.ok, true, JSON.stringify(current));
  const currentRef = { memoryId: existing.id, revision: current.value.memory.revision };
  const mapped = core.map({ namespace });
  assert.equal(mapped.ok, true, JSON.stringify(mapped));
  const placed = core.applyPlacement({ namespace,
    proposal: { items: [{ memoryId: existing.id, parentIds: [],
      newL1: { title: 'Filed observations', parentL2Ids: [] } }] },
    expectedMemoryRevisions: [currentRef], expectedIndexRevision: mapped.value.indexRevision });
  assert.equal(placed.ok, true, JSON.stringify(placed));
  const mixed = await capture('mixed', [existingMessage,
    { id: 'fresh-source', role: 'assistant', content: 'Fresh unfiled memory' }]);
  assert.equal(mixed.ok, true, JSON.stringify(mixed));
  assert.equal(mixed.value.admission.memories.length, 2);
  assert.equal(mixed.value.classification.status, 'applied');
  assert.equal(mixed.value.classification.memoryRevisions.length, 1);
  assert.deepEqual(projectCaptureAdmissionObservation(mixed, 0),
    { batchOrdinal: 0, status: 'completed', admittedReferenceCount: 2,
      suppressedCount: 0, duplicateEvent: false, classificationStatus: 'applied' });
});
