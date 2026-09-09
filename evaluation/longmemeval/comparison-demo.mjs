import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openMemoryCore } from '../../core/contract.mjs';
import { runLongMemEvalComparison } from './comparison.mjs';
import { opaqueQuestionId, stableTurnId } from './prepare.mjs';
import { scoreLongMemEvalComparison } from './scoring.mjs';

const sourceQuestionId = 'synthetic-comparison-demo';
const questionId = opaqueQuestionId(sourceQuestionId);
const namespace = { ownerId: 'longmemeval-comparison-demo', scope: 'project', projectId: questionId };
const history = { question_id: questionId, sessions: [
  { session_index: 0, session_id: 'launch-session', date: 'Tuesday', turns: [
    { turn_id: stableTurnId(sourceQuestionId, 0, 'launch-session', 0), role: 'user',
      content: 'The launch color is amber.' },
    { turn_id: stableTurnId(sourceQuestionId, 0, 'launch-session', 1), role: 'assistant',
      content: 'I will remember amber.' },
  ] },
  { session_index: 1, session_id: 'distractor-session', date: 'Friday', turns: [
    { turn_id: stableTurnId(sourceQuestionId, 1, 'distractor-session', 0), role: 'user',
      content: 'The unrelated mascot is a cairn.' },
  ] },
] };
const question = { question_id: questionId, text: 'What is the launch color?', date: 'Saturday' };
const databasePath = join(mkdtempSync(join(tmpdir(), 'cairn-lme-comparison-demo-')), 'memory.sqlite');

const selectedRefs = (input) => input.maps.flatMap((page) => page.items.map((item) =>
  item.type === 'unfiled' ? item.ref
    : item.type === 'ref' && item.ref.childType === 'memory'
      ? { memoryId: item.ref.childId, revision: item.ref.childRevision } : null)
  .filter(Boolean).map((ref) => ({ namespaceIndex: page.namespaceIndex, ...ref })));
const model = {
  contextWindow: 8192,
  // Scripted byte counting exercises bounds; it is not a provider tokenizer claim.
  countTokens: (text) => Math.ceil(Buffer.byteLength(text, 'utf8') / 4),
  extract: async ({ input }) => ({ items: input.messages.some((message) => message.content.includes('amber'))
    ? [{ content: 'The launch color is amber.', kind: 'fact', confidence: 0.9,
      sourceIndices: [input.messages.findIndex((message) => message.content.includes('amber'))] }]
    : [] }),
  classify: async ({ input }) => ({ items: input.memories.map((memory) => ({
    memoryId: memory.id, parentIds: [], newL1: { title: 'Launch', parentL2Ids: [] },
  })) }),
  select: async ({ input }) => ({ refs: selectedRefs(input) }),
  rank: async ({ input }) => ({ refs: input.candidates.slice(0, input.limit).map((candidate) => ({
    namespaceIndex: candidate.namespaceIndex,
    memoryId: candidate.memory.id,
    revision: candidate.memory.revision,
  })) }),
};
const core = openMemoryCore({ path: databasePath, model });

try {
  const run = await runLongMemEvalComparison({ history, question, namespace, core,
    answerModel: 'synthetic-scripted-answer-v1', countTokens: model.countTokens,
    limits: { evidenceTokens: 2_000, requestTokens: 4_000, outputTokens: 100,
      answerTimeoutMs: 1_000, recallLimit: 6, lexicalLimit: 20 },
    answer: async ({ request }) => ({
      text: request.evidence.some((item) => item.text.toLowerCase().includes('amber'))
        ? 'amber' : 'I do not know',
      usage: { inputTokens: null, outputTokens: null, costMicroUsd: null },
    }),
  });
  const scored = await scoreLongMemEvalComparison({ run, evaluator: {
    question_id: questionId,
    source_question_id: sourceQuestionId,
    question_type: 'single-session-user',
    reference_answer: 'amber',
    answer_session_ids: ['launch-session'],
    turn_labels: [{ turn_id: history.sessions[0].turns[0].turn_id, has_answer: true }],
  } });

  assert.deepEqual(run.arms.map((arm) => arm.name), ['cairn', 'lexical', 'no-memory']);
  assert.ok(run.arms.every((arm) => arm.status === 'completed'));
  assert.equal(run.arms[0].packing.selectedEvidence[0].source.sessionId, 'launch-session');
  assert.deepEqual(scored.arms.map((arm) => arm.normalizedExactMatchDiagnostic.value),
    [true, true, false]);

  console.log('SYNTHETIC-ONLY PASS: actual public SQLite capture/recall → three answer-blind arms → evaluator');
  console.log(JSON.stringify({ arms: run.arms.map((arm) => ({ name: arm.name, status: arm.status,
    answer: arm.answer.text, retrievedEvidence: arm.retrieval.candidateCount,
    packedEvidence: arm.packing.selectedEvidence.length })),
  normalizedExactMatchDiagnostic: scored.arms.map((arm) => ({ name: arm.name,
    value: arm.normalizedExactMatchDiagnostic.value })) }, null, 2));
  console.log(`Synthetic database retained at ${databasePath}`);
  console.log('Scripted extraction, recall, answering and counting prove orchestration only.');
  console.log('This is not a semantic-quality result or an official LongMemEval score.');
} finally {
  core.close();
}
