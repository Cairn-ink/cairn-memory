import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createExperimentBudget, reopenExperimentBudget } from '../../experiment-budget/index.mjs';
import { authorizeBenchmarkExtension, createExperimentRequestGuard } from '../../experiment-budget/request-guard.mjs';
import { opaqueQuestionId, prepareLongMemEval } from '../../longmemeval/prepare.mjs';
import { loadReferenceRenderings } from '../../longmemeval/reference-rendering.mjs';
import { loadPreparedPilot, pilotEvaluatorFor } from '../pilot.mjs';
import { main as cliMain, parseArguments, USAGE } from '../public-pilot-cli.mjs';
import {
  benchmarkStagePolicy,
  createBenchmarkLiveSession,
  evidenceArmGuess,
  labelCapturedArms,
  PUBLIC_PILOT_LIMITS,
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

async function setup(t, { source = sourceCases(), limitMicroUsd = 50_000_000, requestCap = 5_000 } = {}) {
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
  const pilot = await loadPreparedPilot({ directory: prepared });
  const calls = [];
  const session = (chat, count, generation) => createBenchmarkLiveSession({ ledger, apiKey: KEY,
    fetchImpl: fakeUpstream({ calls, ...(chat ? { chat } : {}), ...(count ? { count } : {}),
      ...(generation ? { generation } : {}) }), benchmarkExtension });
  return { root, inputPath, prepared, ledger, policy, benchmarkExtension, pilot, calls, session,
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
  assert.deepEqual(projection.caseIds, [ids.plain, ids.abstain_abs]);
  assert.equal(projection.projections.length, 2);
  assert.deepEqual(projection.fits, { caps: true, ledger: true });
  assert.equal(projection.exclusionCount, 2);
  assert.equal(projection.ledger.requestCount, 0);
  assert.equal(dry.text().includes(KEY), false);
  assert.equal(ledgerState(f.ledger).requestCount, 0);

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
  assert.equal(ledgerState(f.ledger).requestCount, calls.length);
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
    fixture({ id: 'corebad', answerTurn: 'The corebad color is amber.' }),
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
    if (method === 'extract' && serialized.includes('corebad')) {
      return Response.json(responsesEnvelope(body.model, { items: [{ content: 'synthetic invalid item',
        kind: 'fact', confidence: 2, sourceIndices: [0] }] }));
    }
    return Response.json(responsesEnvelope(body.model, scripted[method](input)));
  };
  const session = f.session(null, null, generation);
  const output = f.output('diagnostic-rejections');
  const report = await runPublicPilot({ pilot: f.pilot, session, directory: output });
  session.close();

  const adapter = await readJson(output, 'cases', caseIds.adapterbad, 'diagnostics.json');
  const core = await readJson(output, 'cases', caseIds.corebad, 'diagnostics.json');
  const clean = await readJson(output, 'cases', caseIds.clean, 'diagnostics.json');
  assert.deepEqual(adapter.memoryModel.records, [
    { version: 1, stage: 'extract', layer: 'adapter', reason: 'output_json' },
    { version: 1, stage: 'extract', layer: 'core_call', reason: 'adapter_output_invalid' },
  ]);
  assert.deepEqual(core.memoryModel.records,
    [{ version: 1, stage: 'extract', layer: 'core_validation', reason: 'invalid_extraction' }]);
  assert.deepEqual(clean.memoryModel.records, []);
  assert.ok([adapter, core, clean].every((item) => item.questionId
    && item.memoryModel.availability === 'available' && item.memoryModel.recordLimit === 64
    && item.memoryModel.droppedRecords === 0));
  assert.deepEqual(adapter.answerCompletions.records.map((item) => [item.arm, item.diagnostic]), [
    ['full-history', { availability: 'available', finishReason: 'stop' }],
    ['no-memory', { availability: 'available', finishReason: 'stop' }],
  ]);
  assert.deepEqual(clean.answerCompletions.records.map((item) => item.diagnostic.finishReason),
    ['stop', 'stop', 'stop']);
  assert.equal(report.summary.generated, 3);
  assert.equal(report.summary.generationFailed, 0);
  assert.equal(Object.hasOwn(report, 'diagnostics'), false);
  assert.ok(report.cases.every((item) => Object.hasOwn(item, 'diagnostics') === false));

  const memoryGenerations = f.calls.filter((call) => call.pathname === URLS.generation);
  for (const marker of ['adapterbad', 'corebad']) {
    assert.equal(memoryGenerations.filter((call) => call.rawBody.includes(marker)).length, 1,
      `${marker} must stop memory generation after failed extraction`);
  }
  for (const diagnostic of [adapter, core, clean]) {
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
    return Response.json(responsesEnvelope(body.model, scripted[method](input)));
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
  assert.deepEqual((await readJson(outputOne, 'cases', ids.plain, 'diagnostics.json')).memoryModel.records,
    [{ version: 1, stage: 'extract', layer: 'adapter', reason: 'output_json' }]);
  assert.deepEqual((await readJson(outputTwo, 'cases', ids.plain, 'diagnostics.json')).memoryModel.records, []);
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
