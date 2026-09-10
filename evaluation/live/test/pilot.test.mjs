import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { prepareLongMemEval } from '../../longmemeval/prepare.mjs';
import {
  loadPreparedPilot,
  PILOT_GENERATION_CONCURRENCY,
  PILOT_LIMITS,
  runPilot,
} from '../pilot.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const caseFixture = ({ id, fact, failure = false }) => ({
  question_id: id,
  question_type: 'single-session-user',
  question: `What is the ${id} color?`,
  answer: fact,
  question_date: 'Saturday',
  haystack_session_ids: [`${id}-answer`, `${id}-distractor`],
  haystack_dates: ['Tuesday', 'Friday'],
  haystack_sessions: [
    [{ role: 'user', content: `${failure ? 'CAPTURE_FAIL ' : ''}The ${id} color is ${fact}.`,
      has_answer: true }],
    [{ role: 'assistant', content: `The unrelated ${id} mascot is a cairn.`, has_answer: false }],
  ],
  answer_session_ids: [`${id}-answer`],
});

const prepare = async (root) => {
  const source = JSON.stringify([
    caseFixture({ id: 'working-case', fact: 'amber' }),
    caseFixture({ id: 'capture-failure-case', fact: 'violet', failure: true }),
  ]);
  const inputPath = path.join(root, 'source.json');
  const prepared = path.join(root, 'prepared');
  await writeFile(inputPath, source);
  await prepareLongMemEval({
    inputPath,
    expectedSha256: digest(source),
    datasetRevision: 'synthetic-pilot-revision',
    datasetVariant: 's-cleaned',
    questionIds: ['working-case', 'capture-failure-case'],
    outputDirectory: prepared,
  });
  return prepared;
};

const selectedRefs = (input) => input.maps.flatMap((page) => page.items.map((item) =>
  item.type === 'unfiled' ? item.ref
    : item.type === 'ref' && item.ref.childType === 'memory'
      ? { memoryId: item.ref.childId, revision: item.ref.childRevision } : null)
  .filter(Boolean).map((ref) => ({ namespaceIndex: page.namespaceIndex, ...ref })));

const scriptedSession = () => {
  const countTokens = (text) => Math.ceil(Buffer.byteLength(text, 'utf8') / 4);
  const calls = { extract: 0, answer: [], judge: [] };
  const memoryModel = {
    contextWindow: 16_384,
    countTokens,
    extract: async ({ input }) => {
      calls.extract += 1;
      const content = input.messages.map((message) => message.content).join(' ');
      if (content.includes('CAPTURE_FAIL')) throw new Error('deliberate private capture failure');
      const match = content.match(/color is ([a-z]+)\./u);
      return { items: match ? [{ content: `The color is ${match[1]}.`, kind: 'fact', confidence: 0.9,
        sourceIndices: [input.messages.findIndex((message) => message.content.includes(match[0]))] }] : [] };
    },
    classify: async ({ input }) => ({ items: input.memories.map((memory) => ({
      memoryId: memory.id, parentIds: [], newL1: { title: 'Color', parentL2Ids: [] },
    })) }),
    select: async ({ input }) => ({ refs: selectedRefs(input) }),
    rank: async ({ input }) => ({ refs: input.candidates.slice(0, input.limit).map((candidate) => ({
      namespaceIndex: candidate.namespaceIndex,
      memoryId: candidate.memory.id,
      revision: candidate.memory.revision,
    })) }),
  };
  const answer = async ({ model, request, maxOutputTokens }) => {
    calls.answer.push(structuredClone({ model, request, maxOutputTokens }));
    const found = request.evidence.map((item) => item.text).join(' ').match(/color is ([a-z]+)/iu);
    return { text: found?.[1] ?? 'I do not know' };
  };
  const judge = async ({ model, input }) => {
    assert.equal(calls.answer.length, 5, 'all generation must finish before the first judge');
    calls.judge.push(structuredClone({ model, input }));
    return { verdict: 'unknown' };
  };
  return { session: Object.freeze({
    modelId: 'scripted-pilot-model-v1', memoryModel, countTokens, answer, judge,
  }), calls };
};

const readCheckpoint = async (output, caseIndex, name) => JSON.parse(await readFile(
  path.join(output, `case-${String(caseIndex).padStart(4, '0')}`, `${name}.json`), 'utf8',
));

test('two-case pilot uses actual core, retains capture failure, and judges only after generation', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'cairn-live-pilot-test-'));
  const prepared = await prepare(root);
  const output = path.join(root, 'output');
  await mkdir(output);
  const pilot = await loadPreparedPilot({ directory: prepared });
  assert.equal(Object.isFrozen(pilot), true);
  assert.equal(Object.isFrozen(pilot.cases[0].history), true);
  assert.doesNotMatch(JSON.stringify(pilot), /reference_answer|has_answer|synthetic-pilot-revision/iu);

  const { session, calls } = scriptedSession();
  const progress = [];
  const result = await runPilot({ pilot, directory: output, session,
    onCase: (item) => progress.push(structuredClone(item)) });
  assert.equal(result.generationConcurrency, PILOT_GENERATION_CONCURRENCY);
  assert.equal(PILOT_GENERATION_CONCURRENCY, 3);
  assert.deepEqual(result.limits, {
    evidenceTokens: 6_000, requestTokens: 8_000, outputTokens: 512,
    answerTimeoutMs: 60_000, recallLimit: 6, lexicalLimit: 100,
  });
  assert.deepEqual(progress.map((item) => item.stage).sort(),
    ['generation', 'generation', 'scoring', 'scoring']);
  assert.ok(progress.every((item) => Object.keys(item).sort().join(',')
    === 'caseCount,index,questionId,stage,status'));
  assert.equal(calls.answer.length, 5);
  assert.equal(calls.judge.length, 5);
  assert.equal(result.arms.find((arm) => arm.name === 'cairn').failedCases, 1);
  assert.ok(result.arms.every((arm) => arm.unknownCases === arm.completedCases));

  const firstGeneration = await readCheckpoint(output, 1, 'generation');
  const secondGeneration = await readCheckpoint(output, 2, 'generation');
  assert.deepEqual(firstGeneration.run.arms.map((arm) => arm.status),
    ['completed', 'completed', 'completed']);
  assert.deepEqual(secondGeneration.run.arms.map((arm) => arm.status),
    ['failed', 'completed', 'completed']);
  assert.equal(secondGeneration.run.arms[0].failedStage, 'ingestion');
  for (const generation of [firstGeneration, secondGeneration]) {
    assert.deepEqual(generation.run.limits, PILOT_LIMITS);
    assert.ok(generation.run.arms.every((arm) => arm.name === 'cairn'
      || arm.packing !== null));
  }
  for (const [question, requests] of Map.groupBy(calls.answer, (call) => call.request.question.text)) {
    assert.ok(question.length > 0);
    assert.ok(requests.every((call) => call.request.question.text === question
      && call.request.question.date === requests[0].request.question.date
      && call.maxOutputTokens === PILOT_LIMITS.outputTokens
      && call.model === session.modelId));
  }
  assert.ok(calls.answer.every((call) => !/reference_answer|has_answer|amber|violet/u.test(
    JSON.stringify({ ...call.request, evidence: [] }),
  )));
  assert.ok(calls.judge.every((call) => call.model === session.modelId));

  for (const caseIndex of [1, 2]) for (const name of ['generation', 'scoring']) {
    const mode = (await stat(path.join(output, `case-${String(caseIndex).padStart(4, '0')}`,
      `${name}.json`))).mode & 0o777;
    assert.equal(mode, 0o600);
  }
  assert.equal((await stat(path.join(output, 'aggregate.json'))).mode & 0o777, 0o600);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /amber|violet|CAPTURE_FAIL|reference_answer|source\.json/u);
  assert.ok(result.storage.databaseBytes > 0);
});

test('artifact digest mismatch fails before a model callback or output mutation', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'cairn-live-pilot-hash-test-'));
  const prepared = await prepare(root);
  const historyPath = path.join(prepared, 'history.jsonl');
  await chmod(historyPath, 0o600);
  await writeFile(historyPath, (await readFile(historyPath, 'utf8')).replace('amber', 'umber'));
  const { calls } = scriptedSession();
  await assert.rejects(loadPreparedPilot({ directory: prepared }),
    { code: 'artifact_digest_mismatch' });
  assert.deepEqual(calls, { extract: 0, answer: [], judge: [] });
  await assert.rejects(stat(path.join(root, 'output')), { code: 'ENOENT' });
});

test('checkpoint failure drains sibling generation before returning and starts no judges', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'cairn-live-pilot-drain-'));
  const prepared = await prepare(root);
  const output = path.join(root, 'output');
  await mkdir(output);
  const pilot = await loadPreparedPilot({ directory: prepared });
  const { session, calls } = scriptedSession();
  let blockedCheckpoint = false;
  let activeSiblings = 0;
  const answer = async (input) => {
    if (input.request.question.text.includes('capture-failure-case')) {
      activeSiblings++;
      await new Promise(resolve => setTimeout(resolve, 80));
      activeSiblings--;
    } else if (!blockedCheckpoint) {
      blockedCheckpoint = true;
      await mkdir(path.join(output, 'case-0001', 'generation.json'));
    }
    return session.answer(input);
  };
  await assert.rejects(runPilot({ pilot, directory: output, session: { ...session, answer } }),
    error => ['output_exists', 'output_write_failed'].includes(error.code));
  assert.equal(activeSiblings, 0);
  assert.equal(calls.judge.length, 0);
  assert.equal((await readCheckpoint(output, 2, 'generation')).status, 'completed');
});
