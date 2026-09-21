import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { openMemoryCore } from '../../../core/contract.mjs';
import { runLongMemEvalComparison } from '../comparison.mjs';
import { prepareLongMemEval } from '../prepare.mjs';
import { scoreLongMemEvalComparison } from '../scoring.mjs';

const fixture = (answerId = 'answer_abs', distractorId = 'distractor_answer') => [{
  question_id: 'blinding-case', question_type: 'single-session-user',
  question: 'What is the launch color?', answer: 'amber', question_date: 'Saturday',
  haystack_session_ids: [answerId, distractorId], haystack_dates: ['Tuesday', 'Friday'],
  haystack_sessions: [
    [{ role: 'user', content: 'The launch color is amber; this is the answer.', has_answer: true }],
    [{ role: 'assistant', content: 'The mascot is a cairn.', has_answer: false }],
  ],
  answer_session_ids: [answerId],
}];

const records = (text) => text.trimEnd().split('\n').map((line) => JSON.parse(line));
const prepare = async (root, name, source) => {
  const inputPath = path.join(root, `${name}.json`);
  const outputDirectory = path.join(root, name);
  const content = JSON.stringify(source);
  await writeFile(inputPath, content);
  await prepareLongMemEval({ inputPath,
    expectedSha256: createHash('sha256').update(content).digest('hex'),
    datasetRevision: 'synthetic-revision', datasetVariant: 's-cleaned',
    questionIds: ['blinding-case'], outputDirectory });
  const artifact = async (filename) => readFile(path.join(outputDirectory, filename), 'utf8');
  return { historyText: await artifact('history.jsonl'), questionText: await artifact('questions.jsonl'),
    history: records(await artifact('history.jsonl'))[0],
    question: records(await artifact('questions.jsonl'))[0],
    evaluator: records(await artifact('evaluator.jsonl'))[0],
    manifest: JSON.parse(await artifact('manifest.json')) };
};

const limits = { evidenceTokens: 20_000, requestTokens: 30_000, outputTokens: 100,
  answerTimeoutMs: 1_000, recallLimit: 6, lexicalLimit: 20 };
const namespace = (history) => ({ ownerId: 'session-blinding-test', scope: 'project',
  projectId: history.question_id });
const emptyRecall = (history) => ({ ok: true, value: { memories: [], namespaces: [
  { namespace: namespace(history), mapExhausted: true, fetchExhausted: true },
], coverage: 'complete' } });

test('SB1-SB3: raw label changes leave files and scripted callback payloads identical', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'cairn-lme-blinding-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = await prepare(root, 'first', fixture());
  const second = await prepare(root, 'second', fixture('private-evidence-77', 'private-noise-88'));
  assert.equal(first.historyText, second.historyText);
  assert.equal(first.questionText, second.questionText);
  assert.deepEqual(first.evaluator, second.evaluator);
  assert.deepEqual(first.manifest.session_id_map[0].occurrences.map((item) => item.source_session_id),
    ['answer_abs', 'distractor_answer']);
  assert.deepEqual(second.manifest.session_id_map[0].occurrences.map((item) => item.source_session_id),
    ['private-evidence-77', 'private-noise-88']);
  assert.ok(first.historyText.includes('this is the answer.'));
  assert.doesNotMatch(first.historyText, /answer_abs|distractor_answer/u);

  const runScripted = async ({ history, question }) => {
    const calls = { capture: [], recall: [], answer: [] };
    const core = {
      list: () => ({ ok: true, value: { memories: [], nextCursor: null, exhausted: true } }),
      capture: async (input) => { calls.capture.push(structuredClone(input)); return { ok: true,
        value: { duplicate: false, admission: { memories: [], suppressedCount: 0, indexRevision: 1 },
          classification: { status: 'skipped', reason: 'empty' } } }; },
      recall: async (input) => { calls.recall.push(structuredClone(input)); return emptyRecall(history); },
    };
    await runLongMemEvalComparison({ history, question, namespace: namespace(history), core,
      answerModel: 'scripted', countTokens: (text) => text.length, limits,
      answer: async ({ model, request, maxOutputTokens }) => {
        calls.answer.push({ model, request: structuredClone(request), maxOutputTokens });
        return { text: 'amber' };
      } });
    return calls;
  };
  const firstCalls = await runScripted(first);
  const secondCalls = await runScripted(second);
  assert.ok(firstCalls.capture.length > 0);
  assert.equal(firstCalls.recall.length, 1);
  assert.equal(firstCalls.answer.length, 3);
  assert.deepEqual(firstCalls, secondCalls);
});

test('SB4: prepared v2 history runs through actual local core and opaque coverage scores', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'cairn-lme-v2-core-'));
  let core;
  t.after(async () => { core?.close(); await rm(root, { recursive: true, force: true }); });
  const prepared = await prepare(root, 'prepared', fixture());
  const selectedRefs = (input) => input.maps.flatMap((page) => page.items.map((item) =>
    item.type === 'unfiled' ? item.ref
      : item.type === 'ref' && item.ref.childType === 'memory'
        ? { memoryId: item.ref.childId, revision: item.ref.childRevision } : null)
    .filter(Boolean).map((ref) => ({ namespaceIndex: page.namespaceIndex, ...ref })));
  const modelCalls = [];
  const observe = (stage, input) => { modelCalls.push({ stage, input: JSON.stringify(input) }); };
  const model = {
    contextWindow: 8192, countTokens: (text) => Math.ceil(Buffer.byteLength(text, 'utf8') / 4),
    extract: async ({ input }) => {
      observe('extract', input);
      const sourceIndex = input.messages.findIndex((message) =>
        message.content.includes('launch color is amber'));
      return { items: sourceIndex < 0 ? [] : [{ content: 'The launch color is amber.', kind: 'fact',
        confidence: 0.9, sourceIndices: [sourceIndex] }] };
    },
    classify: async ({ input }) => { observe('classify', input); return { items: input.memories.map((memory) => ({
      memoryId: memory.id, parentIds: [], newL1: { title: 'Launch', parentL2Ids: [] },
    })) }; },
    select: async ({ input }) => { observe('select', input); return { refs: selectedRefs(input) }; },
    rank: async ({ input }) => { observe('rank', input); return { refs: input.candidates.slice(0, input.limit).map((item) => ({
      namespaceIndex: item.namespaceIndex, memoryId: item.memory.id, revision: item.memory.revision,
    })) }; },
  };
  core = openMemoryCore({ path: path.join(root, 'memory.sqlite'), model });
  const answerCalls = [];
  const run = await runLongMemEvalComparison({ history: prepared.history,
    question: prepared.question, namespace: namespace(prepared.history), core,
    answerModel: 'synthetic-answer', countTokens: model.countTokens, limits,
    answer: async ({ model: answerModel, request, maxOutputTokens }) => {
      answerCalls.push({ model: answerModel, request: structuredClone(request), maxOutputTokens });
      return { text: request.evidence.some((item) => item.text.includes('amber'))
        ? 'amber' : 'I do not know' };
    } });
  assert.ok(run.arms.every((arm) => arm.status === 'completed'));
  assert.equal(answerCalls.length, 3);
  assert.ok(['extract', 'classify', 'select', 'rank']
    .every((stage) => modelCalls.some((call) => call.stage === stage)));
  assert.doesNotMatch(JSON.stringify(modelCalls), /answer_abs|distractor_answer/u);
  assert.doesNotMatch(JSON.stringify(answerCalls), /answer_abs|distractor_answer|reference_answer|answer_session_ids/u);
  const score = await scoreLongMemEvalComparison({ run, evaluator: prepared.evaluator });
  for (const armName of ['cairn', 'lexical']) {
    const arm = score.arms.find((item) => item.name === armName);
    assert.deepEqual(arm.referenceSessionEvidenceCoverage.retrieved,
      { numerator: 1, denominator: 1, rate: 1 });
    assert.deepEqual(arm.referenceSessionEvidenceCoverage.packed,
      { numerator: 1, denominator: 1, rate: 1 });
  }
  assert.deepEqual(score.arms.find((item) => item.name === 'no-memory')
    .referenceSessionEvidenceCoverage.packed, { numerator: 0, denominator: 1, rate: 0 });
});
