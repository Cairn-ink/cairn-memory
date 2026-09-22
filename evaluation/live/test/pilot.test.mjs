import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  truncate,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { prepareLongMemEval } from '../../longmemeval/prepare.mjs';
import {
  loadPreparedPilot,
  pilotEvaluatorFor,
  PILOT_DEFAULT_MAX_CASES,
  PILOT_GENERATION_CONCURRENCY,
  PILOT_LIMITS,
  PILOT_MAX_CASES,
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

const prepareEight = async (root, suffix = '') => {
  const cases = Array.from({ length: 8 }, (_, index) => caseFixture({
    id: `cohort-case-${index + 1}`,
    fact: `tone${index + 1}`,
  }));
  const source = JSON.stringify(cases);
  const inputPath = path.join(root, `source-eight${suffix}.json`);
  const prepared = path.join(root, `prepared-eight${suffix}`);
  await writeFile(inputPath, source);
  await prepareLongMemEval({
    inputPath,
    expectedSha256: digest(source),
    datasetRevision: 'synthetic-eight-case-revision',
    datasetVariant: 's-cleaned',
    questionIds: cases.map((item) => item.question_id),
    outputDirectory: prepared,
  });
  return prepared;
};

const selectedRefs = (input) => input.maps.flatMap((page) => page.items.map((item) =>
  item.type === 'unfiled' ? item.ref
    : item.type === 'ref' && item.ref.childType === 'memory'
      ? { memoryId: item.ref.childId, revision: item.ref.childRevision } : null)
  .filter(Boolean).map((ref) => ({ namespaceIndex: page.namespaceIndex, ...ref })));

const scriptedSession = ({ classificationFailure = false } = {}) => {
  const countTokens = (text) => Math.ceil(Buffer.byteLength(text, 'utf8') / 4);
  const calls = { extract: 0, answer: [], judge: [] };
  const memoryModel = {
    contextWindow: 16_384,
    countTokens,
    extract: async ({ input }) => {
      calls.extract += 1;
      const content = input.messages.map((message) => message.content).join(' ');
      if (content.includes('CAPTURE_FAIL') && !classificationFailure) {
        throw Object.assign(new Error('private_exception_text'), { code: 'private_customer_123' });
      }
      const match = content.match(/color is ([a-z]+)\./u);
      return { items: match ? [{ content: `The color is ${match[1]}.`, kind: 'fact', confidence: 0.9,
        sourceIndices: [input.messages.findIndex((message) => message.content.includes(match[0]))] }] : [] };
    },
    classify: async ({ input }) => {
      if (classificationFailure && input.memories.some((memory) => memory.content.includes('violet'))) {
        throw Object.assign(new Error('private_exception_text'), { code: 'private_customer_123' });
      }
      return { items: input.memories.map((memory) => ({
        memoryId: memory.id, parentIds: [], newL1: { title: 'Color', parentL2Ids: [] },
      })) };
    },
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
  assert.doesNotMatch(JSON.stringify(pilot),
    /reference_answer|has_answer|synthetic-pilot-revision|working-case-answer|source_session_id|session_id_map/iu);

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
  assert.deepEqual(secondGeneration.run.arms[0].retrieval.ingestion.outcomes.map((outcome) => ({
    status: outcome.status, errorStage: outcome.errorStage, error: outcome.error,
  })), [
    { status: 'failed', errorStage: 'capture', error: { code: 'extraction_failed', retryable: false } },
    { status: 'not_run', errorStage: undefined, error: undefined },
  ]);
  assert.deepEqual(result.cases[1].arms[0].ingestionFailure,
    { stage: 'capture', reason: 'extraction_failed' });
  assert.ok(result.cases[0].arms.every((arm) => !Object.hasOwn(arm, 'ingestionFailure')));
  assert.ok(result.cases[1].arms.slice(1).every((arm) => !Object.hasOwn(arm, 'ingestionFailure')));
  assert.deepEqual(JSON.parse(await readFile(path.join(output, 'aggregate.json'), 'utf8')), result);
  assert.doesNotMatch(JSON.stringify(secondGeneration), /private_customer_123|private_exception_text/u);
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

test('actual-core pilot retains partial classification cause in generation and public aggregate', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'cairn-live-pilot-classification-'));
  const prepared = await prepare(root);
  const output = path.join(root, 'output');
  await mkdir(output);
  const pilot = await loadPreparedPilot({ directory: prepared });
  const { session, calls } = scriptedSession({ classificationFailure: true });
  const result = await runPilot({ pilot, directory: output, session });
  const generation = await readCheckpoint(output, 2, 'generation');
  const [cairn, ...baselines] = generation.run.arms;
  assert.equal(cairn.status, 'failed');
  assert.equal(cairn.failedStage, 'ingestion');
  assert.equal(cairn.error.code, 'ingestion_incomplete');
  const [first, later] = cairn.retrieval.ingestion.outcomes;
  assert.deepEqual(first, { batchIndex: 0, eventId: first.eventId, status: 'partial',
    errorStage: 'classification', error: { code: 'classification_failed', retryable: false } });
  assert.deepEqual(later, { batchIndex: 1, eventId: later.eventId, status: 'not_run' });
  assert.ok(baselines.every((arm) => arm.status === 'completed'));
  assert.equal(calls.extract, 3);
  assert.equal(calls.answer.length, 5);
  assert.equal(calls.judge.length, 5);
  assert.equal(result.arms[0].failedCases, 1);
  assert.equal(result.arms[0].completedCases, 1);
  assert.equal(result.arms[0].judgedCases, 0);
  assert.deepEqual(result.cases[1].arms[0], { name: 'cairn', generationStatus: 'failed',
    judgeStatus: 'unscored', judgeReason: 'arm_failed',
    ingestionFailure: { stage: 'classification', reason: 'classification_failed' } });
  const persisted = JSON.parse(await readFile(path.join(output, 'aggregate.json'), 'utf8'));
  assert.deepEqual(persisted, result);
  assert.doesNotMatch(JSON.stringify(generation), /private_customer_123|private_exception_text/u);
  assert.doesNotMatch(JSON.stringify(persisted),
    /private_customer_123|private_exception_text|amber|violet|CAPTURE_FAIL|eventId|batchIndex|admission/u);
  assert.ok(result.cases[0].arms.every((arm) => !Object.hasOwn(arm, 'ingestionFailure')));
  assert.ok(result.cases[1].arms.slice(1).every((arm) => !Object.hasOwn(arm, 'ingestionFailure')));
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

test('prepared cohort expansion is explicit, bounded, private, and fail-closed', async (t) => {
  assert.equal(PILOT_DEFAULT_MAX_CASES, 7);
  assert.equal(PILOT_MAX_CASES, 500);
  const root = await mkdtemp(path.join(tmpdir(), 'cairn-live-pilot-cohort-limit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const prepared = await prepareEight(root);
  const manifestBytes = await readFile(path.join(prepared, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes);

  await assert.rejects(loadPreparedPilot({ directory: prepared }), { code: 'invalid_manifest' });
  for (const maxCases of [1, 7]) {
    await assert.rejects(loadPreparedPilot({ directory: prepared, maxCases }),
      { code: 'invalid_manifest' });
  }
  for (const maxCases of [8, 36, 500]) {
    const pilot = await loadPreparedPilot({ directory: prepared, maxCases });
    assert.deepEqual(pilot.identity, {
      manifestSha256: digest(manifestBytes),
      historySha256: manifest.artifacts.history.sha256,
      questionsSha256: manifest.artifacts.questions.sha256,
      evaluatorSha256: manifest.artifacts.evaluator.sha256,
      questionIds: manifest.selection.question_ids,
      count: 8,
    });
    assert.equal(pilot.cases.length, 8);
    assert.doesNotMatch(JSON.stringify(pilot), /reference_answer|answer_session_ids|turn_labels/u);
    assert.equal(pilotEvaluatorFor(pilot, pilot.identity.questionIds[0]).question_id,
      pilot.identity.questionIds[0]);
  }

  for (const maxCases of [0, -1, 501, 1.5, '8', null, undefined]) {
    await assert.rejects(loadPreparedPilot({ directory: prepared, maxCases }),
      { code: 'invalid_options' });
  }
  await assert.rejects(loadPreparedPilot({ directory: prepared, maxCases: 8, extra: true }),
    { code: 'invalid_options' });
  let accessorReads = 0;
  const accessorOptions = { directory: prepared };
  Object.defineProperty(accessorOptions, 'maxCases', { enumerable: true,
    get() { accessorReads += 1; return 8; } });
  await assert.rejects(loadPreparedPilot(accessorOptions), { code: 'invalid_options' });
  assert.equal(accessorReads, 0);

  const digestPrepared = await prepareEight(root, '-digest');
  const historyPath = path.join(digestPrepared, 'history.jsonl');
  await chmod(historyPath, 0o600);
  await writeFile(historyPath, (await readFile(historyPath, 'utf8')).replace('tone1', 'shade'));
  await assert.rejects(loadPreparedPilot({ directory: digestPrepared, maxCases: 8 }),
    { code: 'artifact_digest_mismatch' });

  const oversizedPrepared = await prepareEight(root, '-oversized');
  await truncate(path.join(oversizedPrepared, 'history.jsonl'), (32 * 1024 * 1024) + 1);
  await assert.rejects(loadPreparedPilot({ directory: oversizedPrepared, maxCases: 8 }),
    { code: 'invalid_artifact' });

  const identityPrepared = await prepareEight(root, '-identity');
  const identityManifestPath = path.join(identityPrepared, 'manifest.json');
  const identityManifest = JSON.parse(await readFile(identityManifestPath, 'utf8'));
  identityManifest.selection.question_ids[0] = 'malformed-opaque-question-id';
  await writeFile(identityManifestPath, `${JSON.stringify(identityManifest)}\n`);
  await assert.rejects(loadPreparedPilot({ directory: identityPrepared, maxCases: 8 }),
    { code: 'invalid_manifest' });
});

test('v1 artifacts and self-consistent legacy turn IDs fail closed before generation', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'cairn-live-pilot-v2-identity-'));
  const prepared = await prepare(root);
  const manifestPath = path.join(prepared, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.schema_version = 'cairn-longmemeval-preparation-v1';
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
  await assert.rejects(loadPreparedPilot({ directory: prepared }), { code: 'invalid_manifest' });

  manifest.schema_version = 'cairn-longmemeval-preparation-v2';
  const historyPath = path.join(prepared, 'history.jsonl');
  const evaluatorPath = path.join(prepared, 'evaluator.jsonl');
  const histories = (await readFile(historyPath, 'utf8')).trimEnd().split('\n').map(JSON.parse);
  const evaluators = (await readFile(evaluatorPath, 'utf8')).trimEnd().split('\n').map(JSON.parse);
  const oldTurnId = histories[0].sessions[0].turns[0].turn_id;
  const legacyTurnId = `lme-turn-${digest('raw-source-label').slice(0, 64)}`;
  histories[0].sessions[0].turns[0].turn_id = legacyTurnId;
  evaluators[0].turn_labels.find((label) => label.turn_id === oldTurnId).turn_id = legacyTurnId;
  for (const [name, filename, rows] of [
    ['history', historyPath, histories], ['evaluator', evaluatorPath, evaluators],
  ]) {
    const content = `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
    await writeFile(filename, content);
    manifest.artifacts[name].sha256 = digest(content);
    manifest.artifacts[name].byte_count = Buffer.byteLength(content);
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
  await assert.rejects(loadPreparedPilot({ directory: prepared }), { code: 'case_identity_mismatch' });
});

test('malformed private map and rehashed raw public session label fail closed', async (t) => {
  for (const [name, mutate, code] of [
    ['wrong-opaque-id', (manifest) => {
      manifest.session_id_map[0].occurrences[0].session_id = 'raw-answer-label';
    }, 'invalid_manifest'],
    ['extra-occurrence', (manifest) => {
      manifest.session_id_map[0].occurrences.push({ session_index: 2,
        source_session_id: 'extra', session_id: 'raw-extra' });
    }, 'invalid_manifest'],
    ['missing-occurrence', (manifest) => {
      manifest.session_id_map[0].occurrences.pop();
    }, 'case_identity_mismatch'],
    ['wrong-question', (manifest) => {
      manifest.session_id_map[0].source_question_id = 'another-case';
    }, 'invalid_manifest'],
    ['raw-public-label', (manifest, histories) => {
      histories[0].sessions[0].session_id = 'working-case-answer';
    }, 'case_identity_mismatch'],
  ]) {
    const root = await mkdtemp(path.join(tmpdir(), `cairn-live-pilot-map-${name}-`));
    t.after(() => rm(root, { recursive: true, force: true }));
    const prepared = await prepare(root);
    const manifestPath = path.join(prepared, 'manifest.json');
    const historyPath = path.join(prepared, 'history.jsonl');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const histories = (await readFile(historyPath, 'utf8')).trimEnd().split('\n').map(JSON.parse);
    mutate(manifest, histories);
    const historyContent = `${histories.map((row) => JSON.stringify(row)).join('\n')}\n`;
    await writeFile(historyPath, historyContent);
    manifest.artifacts.history.sha256 = digest(historyContent);
    manifest.artifacts.history.byte_count = Buffer.byteLength(historyContent);
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
    await assert.rejects(loadPreparedPilot({ directory: prepared }), { code }, name);
  }
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
