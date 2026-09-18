import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, cp, lstat, mkdir, mkdtemp, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createExperimentBudget } from '../../experiment-budget/index.mjs';
import { authorizeBenchmarkExtension, createExperimentRequestGuard } from '../../experiment-budget/request-guard.mjs';
import { opaqueQuestionId, prepareLongMemEval } from '../../longmemeval/prepare.mjs';
import { loadPreparedPilot } from '../pilot.mjs';
import { main as cliMain } from '../public-pilot-cli.mjs';
import { mergePublicPilotRuns } from '../public-pilot-merge.mjs';
import { benchmarkStagePolicy, createBenchmarkLiveSession, runPublicPilot } from '../public-pilot.mjs';
import { experimentPolicy } from '../session.mjs';

// Synthetic private ledgers and fake HTTP only: zero network, and no environment key is ever read.
const KEY = 'synthetic-merge-key-never-expose';
const RAW_PHRASE = 'zqx-private-merge-phrase-never-in-report';
const JUDGE_MODEL = 'gpt-4o-2024-08-06';
const digest = (value) => createHash('sha256').update(value).digest('hex');
const FILLER = 'The long session discusses the weather at great length and in careful detail. '.repeat(14);
const fixture = ({ id, answerTurn, answer = 'amber' }) => ({
  question_id: id, question_type: 'single-session-user', question: `What is the ${id.split('_')[0]} color?`, answer,
  question_date: 'Saturday', haystack_session_ids: [`${id}-first`, `${id}-second`], haystack_dates: ['Tuesday', 'Friday'],
  haystack_sessions: [[{ role: 'user', content: answerTurn, has_answer: true }],
    [{ role: 'assistant', content: `The unrelated ${id} mascot is ${RAW_PHRASE}.`, has_answer: false }]],
  answer_session_ids: id.includes('_abs') ? [] : [`${id}-first`],
});
const sourceCases = () => [
  fixture({ id: 'plain', answerTurn: 'The plain color is amber.' }),
  fixture({ id: 'long',
    answerTurn: `${FILLER}The long color is amber.` }),
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
const judgeText = (prompt) => {
  const expected = prompt.startsWith('I will give you an unanswerable question') ? 'I do not know' : 'amber';
  return prompt.includes(`Model Response: ${expected}`) ? 'yes' : 'no';
};
const fakeUpstream = (calls) => async (url, options) => {
  const body = JSON.parse(options.body);
  assert.equal(new URL(url).origin, 'https://api.openai.com');
  const pathname = new URL(url).pathname;
  calls.push({ pathname, body });
  if (pathname === '/v1/responses/input_tokens') return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
  if (pathname === '/v1/responses') {
    const output = scripted[body.text.format.name.replace(/^cairn_/u, '')](JSON.parse(body.input[0].content[0].text));
    return Response.json({ id: 'resp_synthetic', object: 'response', model: body.model, status: 'completed', error: null,
      incomplete_details: null, output: [{ id: 'msg_synthetic', type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: JSON.stringify(output), annotations: [] }] }],
      usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } });
  }
  assert.equal(pathname, '/v1/chat/completions');
  const content = body.model === JUDGE_MODEL ? judgeText(body.messages[0].content)
    : (JSON.stringify(JSON.parse(body.messages.at(-1).content).evidence).includes('amber') ? 'amber' : 'I do not know');
  return Response.json({ id: 'chatcmpl_synthetic', object: 'chat.completion', model: body.model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 50, completion_tokens: 1, total_tokens: 51 } });
};

async function setup(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'cairn-public-pilot-merge-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = sourceCases();
  const content = JSON.stringify(source);
  const inputPath = path.join(root, 'source.json');
  await writeFile(inputPath, content);
  const prepared = path.join(root, 'prepared');
  await prepareLongMemEval({ inputPath, expectedSha256: digest(content), datasetRevision: 'synthetic-merge',
    datasetVariant: 's-cleaned', questionIds: source.map((item) => item.question_id), outputDirectory: prepared });
  const ledger = { directory: path.join(root, 'ledger'), runId: randomUUID(), limitMicroUsd: 50_000_000, requestCap: 5_000 };
  createExperimentBudget(ledger).close();
  const policy = experimentPolicy();
  createExperimentRequestGuard({ ledger, policy, fetchImpl: () => assert.fail('no setup transport') }).close();
  const benchmarkExtension = authorizeBenchmarkExtension({ ledger, policy,
    authorizationId: 'synthetic-merge', stages: benchmarkStagePolicy() });
  const pilot = await loadPreparedPilot({ directory: prepared });
  const calls = [];
  const run = async (name, caseIds, extra = {}) => {
    const session = createBenchmarkLiveSession({ ledger, apiKey: KEY, fetchImpl: fakeUpstream(calls), benchmarkExtension });
    try { return await runPublicPilot({ pilot, session, directory: path.join(root, name), caseIds, ...extra }); }
    finally { session.close(); }
  };
  return { root, calls, run, at: (name) => path.join(root, name) };
}
const readJson = async (filename) => JSON.parse(await readFile(filename, 'utf8'));
const merge = (directories, output) => mergePublicPilotRuns({ directories, output });

test('PP10: merging two disjoint completed runs sums the paired report and never touches a transport', async (t) => {
  const f = await setup(t);
  const first = await f.run('batch-1', [ids.plain, ids.long],
    { caps: { reservedMicroUsd: 3_000_000, requests: 600 }, manifest: { runCommit: 'batch-one' } });
  const second = await f.run('batch-2', [ids.abstain_abs, ids.numeric], { manifest: { runCommit: 'batch-two' } });
  const callsBefore = f.calls.length;
  const merged = await merge([f.at('batch-1'), f.at('batch-2')], f.at('merged'));
  assert.equal(f.calls.length, callsBefore);
  assert.equal(merged.kind, 'merged');
  assert.equal(merged.caps, null);
  assert.equal(merged.operator, null);
  assert.deepEqual(merged.caseIds, [ids.plain, ids.long, ids.abstain_abs, ids.numeric]);
  assert.equal(merged.summary.fixedN, 4);
  assert.equal(merged.summary.scored, 4);
  assert.equal(merged.summary.halted, false);
  assert.deepEqual(merged.summary.blockedReasons, {});
  assert.equal(merged.official.common.commonN, first.official.common.commonN + second.official.common.commonN);
  assert.equal(merged.official.common.commonN, 3);
  for (const arm of ['cairn', 'full-history', 'no-memory']) {
    const expectedCorrect = first.official.common.byArm[arm].correct + second.official.common.byArm[arm].correct;
    assert.equal(merged.official.common.byArm[arm].correct, expectedCorrect);
    assert.equal(merged.official.common.byArm[arm].accuracy, expectedCorrect / 3);
    assert.equal(merged.official.arms[arm].overall.fixedN, 4);
  }
  assert.equal(merged.cost.requests, first.cost.requests + second.cost.requests);
  assert.equal(merged.cost.requests, callsBefore);
  assert.equal(merged.cost.reservedMicroUsd, first.cost.reservedMicroUsd + second.cost.reservedMicroUsd);
  assert.equal(merged.cost.byStage.answer.requests, 12);
  assert.equal(merged.cost.byStage.judge.requests, 9);
  assert.equal(merged.cost.ledger, null);
  assert.equal(merged.latency.generationMs, first.latency.generationMs + second.latency.generationMs);
  assert.equal(merged.truncation.chunksOverBound, 1);
  assert.deepEqual(merged.sources.map((item) => [item.directory, item.caseIds.length, item.halted]),
    [['batch-1', 2, false], ['batch-2', 2, false]]);
  assert.deepEqual(merged.sources[0].caps, { reservedMicroUsd: 3_000_000, requests: 600 });
  assert.deepEqual(merged.sources[1].operator, { runCommit: 'batch-two' });
  assert.deepEqual(merged.cases.map((item) => item.questionId), merged.caseIds);
  assert.deepEqual(merged.models, first.models);
  assert.deepEqual(merged.limits, first.limits);
  assert.equal(merged.receiptExcerptBoundUtf16, 800);

  assert.equal((await lstat(f.at('merged'))).mode & 0o777, 0o700);
  assert.equal((await lstat(path.join(f.at('merged'), 'report.json'))).mode & 0o777, 0o600);
  const text = await readFile(path.join(f.at('merged'), 'report.json'), 'utf8');
  assert.deepEqual(JSON.parse(text), merged);
  assert.equal(text.includes(RAW_PHRASE), false);
  assert.equal(text.includes(KEY), false);
  assert.doesNotMatch(text, /Bearer/u);
  assert.equal(text.includes(f.root), false);
  assert.equal(text.includes('amber'), false);
  assert.doesNotMatch(text, /official benchmark score/iu);
});

test('PP10: overlap, mismatch, incomplete sources and occupied outputs are refused without writing', async (t) => {
  const f = await setup(t);
  await f.run('batch-1', [ids.plain]);
  await f.run('batch-2', [ids.abstain_abs]);
  await cp(f.at('batch-1'), f.at('batch-1-copy'), { recursive: true });
  await assert.rejects(merge([f.at('batch-1'), f.at('batch-1-copy')], f.at('out-overlap')), { code: 'merge_overlap' });
  await assert.rejects(merge([f.at('batch-1'), f.at('batch-1')], f.at('out-overlap')), { code: 'merge_overlap' });
  await assert.rejects(lstat(f.at('out-overlap')), { code: 'ENOENT' });

  const altered = f.at('batch-1-altered');
  await cp(f.at('batch-1'), altered, { recursive: true });
  const manifest = await readJson(path.join(altered, 'manifest.json'));
  manifest.pilot.manifestSha256 = '0'.repeat(64);
  await writeFile(path.join(altered, 'manifest.json'), JSON.stringify(manifest), { mode: 0o600 });
  await assert.rejects(merge([f.at('batch-2'), altered], f.at('out-mismatch')), { code: 'merge_mismatch' });
  const differentLimits = f.at('batch-1-limits');
  await cp(f.at('batch-1'), differentLimits, { recursive: true });
  const limitsManifest = await readJson(path.join(differentLimits, 'manifest.json'));
  limitsManifest.limits.recallLimit = 5;
  await writeFile(path.join(differentLimits, 'manifest.json'), JSON.stringify(limitsManifest), { mode: 0o600 });
  await assert.rejects(merge([f.at('batch-2'), differentLimits], f.at('out-mismatch')), { code: 'merge_mismatch' });
  await assert.rejects(lstat(f.at('out-mismatch')), { code: 'ENOENT' });

  const incomplete = f.at('batch-1-incomplete');
  await cp(f.at('batch-1'), incomplete, { recursive: true });
  await unlink(path.join(incomplete, 'report.json'));
  await assert.rejects(merge([f.at('batch-2'), incomplete], f.at('out-incomplete')), { code: 'run_incomplete' });
  await assert.rejects(merge([f.at('missing-run')], f.at('out-incomplete')), { code: 'run_incomplete' });
  await assert.rejects(merge([f.at('batch-2')], f.at('batch-2')), { code: 'unsafe_output' });
  await assert.rejects(merge([f.at('batch-1'), f.at('batch-2')], path.join(f.at('batch-2'), 'nested')),
    { code: 'unsafe_output' });
  await assert.rejects(lstat(path.join(f.at('batch-2'), 'nested')), { code: 'ENOENT' });

  await mkdir(f.at('occupied'), { mode: 0o700 });
  await writeFile(path.join(f.at('occupied'), 'stray.json'), '{}', { mode: 0o600 });
  await assert.rejects(merge([f.at('batch-1'), f.at('batch-2')], f.at('occupied')), { code: 'output_not_empty' });
  await assert.rejects(mergePublicPilotRuns({ directories: [], output: f.at('out-empty') }), { code: 'invalid_options' });
  const callsBefore = f.calls.length;
  const single = await merge([f.at('batch-2')], f.at('out-single'));
  assert.equal(single.summary.fixedN, 1);
  assert.equal(single.sources.length, 1);
  assert.equal(f.calls.length, callsBefore);
});

test('PP10: the CLI merges offline with no key and rejects any other flag', async (t) => {
  const f = await setup(t);
  await f.run('batch-1', [ids.plain, ids.long]);
  await f.run('batch-2', [ids.abstain_abs, ids.numeric]);
  const out = () => { const chunks = []; return { write: (text) => { chunks.push(text); return true; }, text: () => chunks.join('') }; };
  const noTransport = () => assert.fail('transport must not be invoked');
  const stdout = out();
  const code = await cliMain(['--merge', `${f.at('batch-1')},${f.at('batch-2')}`, '--output', f.at('cli-merged')],
    { env: {}, stdout, stderr: out(), fetchImpl: noTransport });
  assert.equal(code, 0);
  const line = JSON.parse(stdout.text());
  assert.equal(line.mode, 'merge');
  assert.equal(line.directory, f.at('cli-merged'));
  assert.equal(line.summary.fixedN, 4);
  assert.equal(line.common.commonN, 3);
  assert.equal(line.cost.requests, f.calls.length);
  assert.equal(stdout.text().includes(RAW_PHRASE), false);
  const report = await readJson(path.join(f.at('cli-merged'), 'report.json'));
  assert.equal(report.kind, 'merged');

  const stderr = out();
  assert.equal(await cliMain(['--merge', f.at('batch-1'), '--output', f.at('cli-bad'), '--cases', 'plain'],
    { env: {}, stdout: out(), stderr, fetchImpl: noTransport }), 1);
  assert.equal(stderr.text(), 'invalid_merge_arguments\n');
  const dry = out();
  assert.equal(await cliMain(['--merge', f.at('batch-1'), '--output', f.at('cli-bad'), '--dry-run'],
    { env: {}, stdout: out(), stderr: dry, fetchImpl: noTransport }), 1);
  assert.equal(dry.text(), 'invalid_merge_arguments\n');
  const missing = out();
  assert.equal(await cliMain(['--merge', f.at('batch-1')], { env: {}, stdout: out(), stderr: missing, fetchImpl: noTransport }), 1);
  assert.equal(missing.text(), 'missing_required_flag --output\n');
  await assert.rejects(lstat(f.at('cli-bad')), { code: 'ENOENT' });
});

test('S2/S3: a tampered total and a pre-existing output directory are refused without writing', async (t) => {
  const f = await setup(t);
  await f.run('batch-1', [ids.plain]);
  await f.run('batch-2', [ids.abstain_abs]);
  const tampered = f.at('batch-1-tampered');
  await cp(f.at('batch-1'), tampered, { recursive: true });
  const report = await readJson(path.join(tampered, 'report.json'));
  report.cost.requests = 'many';
  await writeFile(path.join(tampered, 'report.json'), JSON.stringify(report), { mode: 0o600 });
  await assert.rejects(merge([tampered, f.at('batch-2')], f.at('out-tampered')), { code: 'invalid_artifact' });

  const floatLatency = f.at('batch-1-float');
  await cp(f.at('batch-1'), floatLatency, { recursive: true });
  const floated = await readJson(path.join(floatLatency, 'report.json'));
  floated.latency.generationMs = 1.5;
  await writeFile(path.join(floatLatency, 'report.json'), JSON.stringify(floated), { mode: 0o600 });
  await assert.rejects(merge([floatLatency, f.at('batch-2')], f.at('out-float')), { code: 'invalid_artifact' });

  const stageTampered = f.at('batch-1-stage');
  await cp(f.at('batch-1'), stageTampered, { recursive: true });
  const staged = await readJson(path.join(stageTampered, 'report.json'));
  staged.cost.byStage.answer.requests = 'many';
  await writeFile(path.join(stageTampered, 'report.json'), JSON.stringify(staged), { mode: 0o600 });
  await assert.rejects(merge([stageTampered, f.at('batch-2')], f.at('out-stage')), { code: 'invalid_artifact' });
  const outcomeTampered = f.at('batch-1-outcome');
  await cp(f.at('batch-1'), outcomeTampered, { recursive: true });
  const outcomes = await readJson(path.join(outcomeTampered, 'report.json'));
  delete outcomes.cost.byStage.answer.reservedMicroUsd;
  await writeFile(path.join(outcomeTampered, 'report.json'), JSON.stringify(outcomes), { mode: 0o600 });
  await assert.rejects(merge([outcomeTampered, f.at('batch-2')], f.at('out-outcome')), { code: 'invalid_artifact' });
  await assert.rejects(lstat(f.at('out-stage')), { code: 'ENOENT' });

  const occupied = f.at('pre-existing');
  await mkdir(occupied, { mode: 0o755 });
  await chmod(occupied, 0o755);
  await writeFile(path.join(occupied, 'stray.json'), '{}', { mode: 0o644 });
  const before = await readdir(occupied);
  await assert.rejects(merge([f.at('batch-1'), f.at('batch-2')], occupied), { code: 'output_not_empty' });
  assert.equal((await lstat(occupied)).mode & 0o777, 0o755);
  assert.deepEqual(await readdir(occupied), before);
  assert.deepEqual(before, ['stray.json']);
  assert.equal((await lstat(path.join(occupied, 'stray.json'))).mode & 0o777, 0o644);
});
