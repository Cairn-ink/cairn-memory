import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { opaqueQuestionId, prepareLongMemEval } from '../prepare.mjs';
import { loadReferenceRenderings } from '../reference-rendering.mjs';
import { aggregateOfficialScores, officialPrompt, scorePublicComparison } from '../official-scoring.mjs';

const sha = (value) => createHash('sha256').update(value).digest('hex');
const python = new URL('../fixtures/render-reference-sidecar.py', import.meta.url).pathname;
const upstreamHashes = JSON.parse(await readFile(new URL('../fixtures/upstream-typed-prompt-hashes.json', import.meta.url)));
const answerCases = [
  ['integer', '3', '3'],
  ['float', '3.0', '3.0'],
  ['large', '9007199254740993', '9007199254740993'],
  ['negative-zero', '-0.0', '-0.0'],
  ['exponent', '1e2', '100.0'],
  ['array', '[3.0,"a","it\'s","quo\\\"te"]', '[3.0, \'a\', "it\'s", \'quo"te\']'],
];

const dataset = () => `[${answerCases.map(([id, answer]) => `{
  "question_id":"${id}","question_type":"single-session-user","question":"What?",
  "answer":${answer},"question_date":"2026/01/01","haystack_session_ids":["s"],
  "haystack_dates":["2026/01/01"],"haystack_sessions":[[{"role":"user","content":"source"}]],
  "answer_session_ids":[]}`).join(',')}]`;

const run = (id) => ({ schemaVersion: 'cairn-longmemeval-public-comparison-v1',
  questionId: opaqueQuestionId(id), question: { text: 'What?', date: '2026/01/01' },
  answerModel: 'scripted', arms: ['cairn', 'full-history', 'no-memory'].map((name) => ({ name,
    status: 'completed', reason: null, answer: { text: 'answer', usage: null } })) });

async function setup(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cairn-reference-rendering-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const inputPath = path.join(root, 'source.json');
  const preparedDirectory = path.join(root, 'prepared');
  const sidecarPath = path.join(root, 'reference-sidecar.json');
  const content = dataset();
  await writeFile(inputPath, content);
  await prepareLongMemEval({ inputPath, expectedSha256: sha(content), datasetRevision: 'synthetic',
    datasetVariant: 's-cleaned', questionIds: answerCases.map(([id]) => id), outputDirectory: preparedDirectory });
  const preparedFiles = ['history.jsonl', 'questions.jsonl', 'evaluator.jsonl', 'manifest.json'];
  const before = await Promise.all(preparedFiles.map(async (name) => sha(await readFile(path.join(preparedDirectory, name)))));
  const result = spawnSync('python3', [python, '--source', inputPath, '--prepared', preparedDirectory,
    '--output', sidecarPath], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr);
  const after = await Promise.all(preparedFiles.map(async (name) => sha(await readFile(path.join(preparedDirectory, name)))));
  assert.deepEqual(after, before);
  const { sidecar_sha256: expectedSidecarSha256 } = JSON.parse(result.stdout);
  const evaluators = (await readFile(path.join(preparedDirectory, 'evaluator.jsonl'), 'utf8'))
    .trimEnd().split('\n').map(JSON.parse);
  return { root, inputPath, preparedDirectory, sidecarPath, expectedSidecarSha256, evaluators };
}

test('Python sidecar preserves numeric types and list repr lost by JS parsing', async (t) => {
  const state = await setup(t);
  assert.equal((await stat(state.sidecarPath)).mode & 0o777, 0o600);
  const sidecar = JSON.parse(await readFile(state.sidecarPath, 'utf8'));
  assert.deepEqual(sidecar.cases.map((item) => item.reference_text), answerCases.map((item) => item[2]));
  assert.equal(state.evaluators[2].reference_answer, 9007199254740992);
  const renderings = await loadReferenceRenderings(state);
  assert.equal(renderings.size, answerCases.length);
  for (const [index, [id, , expected]] of answerCases.entries()) {
    const requests = [];
    const score = await scorePublicComparison({ run: run(id), evaluator: state.evaluators[index],
      referenceRendering: renderings.get(opaqueQuestionId(id)), judge: async ({ request }) => {
        requests.push(request); return { text: 'yes' };
      } });
    assert.equal(score.compatibility.referenceSerialization, 'verified-python-rendered');
    assert.equal(requests.length, 3);
    assert.ok(requests.every((request) => request.messages[0].content.includes(`Correct Answer: ${expected}\n\n`)));
    assert.ok(requests.every((request) => sha(request.messages[0].content) === upstreamHashes[index].prompt_sha256));
    const prompt = officialPrompt({ questionType: 'single-session-user', question: 'What?',
      reference: expected, response: 'answer', abstention: false });
    assert.equal(sha(prompt), upstreamHashes[index].prompt_sha256);
    assert.equal(upstreamHashes[index].id, id);
    assert.equal(JSON.stringify(renderings.get(opaqueQuestionId(id))), '{}');
  }
  const noSidecar = await scorePublicComparison({ run: run('large'), evaluator: state.evaluators[2],
    judge: async () => { throw Error('must not be called'); } });
  assert.equal(noSidecar.compatibility.referenceSerialization, 'unverified-non-string');
  assert.ok(noSidecar.arms.every((arm) => arm.judgment.reason === 'reference_serialization_unverified'));
  const repeat = spawnSync('python3', [python, '--source', state.inputPath, '--prepared', state.preparedDirectory,
    '--output', state.sidecarPath], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(repeat.status, 1);
  assert.equal(JSON.parse(repeat.stderr).error, 'invalid_output');
  assert.doesNotMatch(repeat.stderr, /9007199254740993|reference_text|source\.json/u);
  const scored = await scorePublicComparison({ run: run('float'), evaluator: state.evaluators[1],
    referenceRendering: renderings.get(opaqueQuestionId('float')),
    judge: async () => ({ text: 'yes' }) });
  const summary = aggregateOfficialScores({ roster: [{ questionId: opaqueQuestionId('float'),
    sourceQuestionId: 'float', questionType: 'single-session-user' }], records: [scored] });
  assert.equal(summary.completeVerifiedOfficialStyle, true);
});

test('pinned sidecar and exact evaluator-bound capabilities reject mixing before judge calls', async (t) => {
  const state = await setup(t);
  const renderings = await loadReferenceRenderings(state);
  let calls = 0;
  const judge = async () => { calls += 1; return { text: 'yes' }; };
  const changed = structuredClone(state.evaluators[0]);
  changed.reference_answer = 4;
  await assert.rejects(scorePublicComparison({ run: run('integer'), evaluator: changed,
    referenceRendering: renderings.get(opaqueQuestionId('integer')), judge }), { code: 'rendering_mismatch' });
  await assert.rejects(scorePublicComparison({ run: run('integer'), evaluator: state.evaluators[0],
    referenceRendering: Object.freeze({}), judge }), { code: 'rendering_mismatch' });
  await assert.rejects(scorePublicComparison({ run: run('integer'), evaluator: state.evaluators[0],
    referenceRendering: renderings.get(opaqueQuestionId('float')), judge }), { code: 'rendering_mismatch' });
  await assert.rejects(loadReferenceRenderings({ ...state, expectedSidecarSha256: '0'.repeat(64) }),
    { code: 'sidecar_digest_mismatch' });
  const altered = JSON.parse(await readFile(state.sidecarPath, 'utf8'));
  altered.cases[0].reference_text = 'false';
  const maliciousBytes = `${JSON.stringify(altered)}\n`;
  const maliciousPath = path.join(state.root, 'malicious.json');
  await writeFile(maliciousPath, maliciousBytes);
  // A caller can pin arbitrary bytes; the checksum is not a truth certificate.
  const arbitrary = await loadReferenceRenderings({ ...state, sidecarPath: maliciousPath,
    expectedSidecarSha256: sha(maliciousBytes) });
  assert.equal(arbitrary.size, answerCases.length);
  altered.cases[0].question_id = opaqueQuestionId('float');
  const mismatchedBytes = `${JSON.stringify(altered)}\n`;
  await writeFile(maliciousPath, mismatchedBytes);
  await assert.rejects(loadReferenceRenderings({ ...state, sidecarPath: maliciousPath,
    expectedSidecarSha256: sha(mismatchedBytes) }), { code: 'sidecar_mismatch' });
  assert.equal(calls, 0);
});

test('sidecar loader rejects missing, duplicate, and unexpected roster rows', async (t) => {
  const state = await setup(t);
  const original = JSON.parse(await readFile(state.sidecarPath, 'utf8'));
  for (const [name, mutate] of [
    ['missing', (sidecar) => { sidecar.cases.pop(); }],
    ['duplicate', (sidecar) => { sidecar.cases[1] = structuredClone(sidecar.cases[0]); }],
    ['unexpected', (sidecar) => { sidecar.cases[1].question_id = opaqueQuestionId('unexpected'); }],
    ['manifest hash', (sidecar) => { sidecar.manifest_sha256 = '0'.repeat(64); }],
    ['evaluator hash', (sidecar) => { sidecar.evaluator_sha256 = '0'.repeat(64); }],
    ['source hash', (sidecar) => { sidecar.source_sha256 = '0'.repeat(64); }],
  ]) {
    const sidecar = structuredClone(original);
    mutate(sidecar);
    const bytes = `${JSON.stringify(sidecar)}\n`;
    const sidecarPath = path.join(state.root, `${name.replaceAll(' ', '-')}.json`);
    await writeFile(sidecarPath, bytes);
    await assert.rejects(loadReferenceRenderings({ ...state, sidecarPath,
      expectedSidecarSha256: sha(bytes) }), { code: 'sidecar_mismatch' }, name);
  }
});

test('generator refuses changed source and changed prepared reference, even if local manifest is rehashed', async (t) => {
  const state = await setup(t);
  const alteredSource = path.join(state.root, 'other-source.json');
  await writeFile(alteredSource, dataset().replace('"question":"What?"', '"question":"Changed?"'));
  const sourceRun = spawnSync('python3', [python, '--source', alteredSource,
    '--prepared', state.preparedDirectory, '--output', path.join(state.root, 'source-fail.json')],
  { encoding: 'utf8', timeout: 10_000 });
  assert.equal(sourceRun.status, 1);
  assert.equal(JSON.parse(sourceRun.stderr).error, 'source_digest_mismatch');

  const evaluatorPath = path.join(state.preparedDirectory, 'evaluator.jsonl');
  const manifestPath = path.join(state.preparedDirectory, 'manifest.json');
  const evaluators = structuredClone(state.evaluators);
  evaluators[0].reference_answer = 4;
  const evaluatorBytes = `${evaluators.map(JSON.stringify).join('\n')}\n`;
  await writeFile(evaluatorPath, evaluatorBytes);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.artifacts.evaluator.sha256 = sha(evaluatorBytes);
  manifest.artifacts.evaluator.byte_count = Buffer.byteLength(evaluatorBytes);
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
  const changedRun = spawnSync('python3', [python, '--source', state.inputPath,
    '--prepared', state.preparedDirectory, '--output', path.join(state.root, 'changed-fail.json')],
  { encoding: 'utf8', timeout: 10_000 });
  assert.equal(changedRun.status, 1);
  assert.equal(JSON.parse(changedRun.stderr).error, 'invalid_reference');
  await assert.rejects(loadReferenceRenderings(state), { code: 'sidecar_mismatch' });
});
