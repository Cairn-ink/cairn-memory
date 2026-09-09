import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openMemoryCore } from '../../core/contract.mjs';
import { ingestLongMemEvalCase } from './ingestion.mjs';
import { opaqueQuestionId, stableTurnId } from './prepare.mjs';

const sourceQuestionId = 'synthetic-ingestion-demo';
const questionId = opaqueQuestionId(sourceQuestionId);
const namespace = { ownerId: 'longmemeval-demo', scope: 'project', projectId: questionId };
const rawContent = `  Remember that I prefer diagrams. ${'x'.repeat(4_200)} 🗺️  `;
const history = {
  question_id: questionId,
  sessions: [{
    session_index: 0,
    session_id: 'repeated-looking-source-id',
    date: 'source date metadata, not dialogue',
    turns: [{
      turn_id: stableTurnId(sourceQuestionId, 0, 'repeated-looking-source-id', 0),
      role: 'user',
      content: rawContent,
    }],
  }],
};
const databasePath = join(mkdtempSync(join(tmpdir(), 'cairn-lme-ingestion-demo-')), 'memory.sqlite');
const modelCalls = [];
const model = {
  contextWindow: 8_192,
  // A fixed scripted count exercises orchestration only; it is not a tokenizer claim.
  countTokens: () => 1,
  extract: async ({ input }) => {
    modelCalls.push('extract');
    return { items: [{
      content: 'Prefer diagrams.',
      kind: 'preference',
      confidence: 0.9,
      sourceIndices: [0],
    }] };
  },
  classify: async ({ input }) => {
    modelCalls.push('classify');
    return { items: input.memories.map((memory) => ({
      memoryId: memory.id,
      parentIds: [],
      newL1: { title: 'Presentation', parentL2Ids: [] },
    })) };
  },
};
const core = openMemoryCore({ path: databasePath, model });
const ok = (result) => {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
};

try {
  const first = await ingestLongMemEvalCase({ history, namespace, capture: core.capture });
  assert.equal(first.plan.executable, true);
  assert.equal(first.outcomes[0].status, 'completed');
  const sourceMap = first.plan.batches.flatMap((batch) => batch.sourceMap);
  assert.equal(sourceMap.map((source) => source.rawContent).join(''), rawContent);
  assert.ok(sourceMap.length > 1);
  const memoryId = first.outcomes[0].result.admission.memories[0].id;
  const detail = ok(core.get({ namespace, memoryId }));
  const receipt = detail.receipts[0];
  const mapped = sourceMap.find((source) => source.messageId === receipt.eventId);
  assert.ok(mapped);
  assert.equal(receipt.sessionId, first.plan.batches[0].captureInput.sessionId);
  assert.match(receipt.excerpt, /prefer diagrams/iu);
  assert.equal(mapped.rawContent, rawContent.slice(mapped.rawStartUtf16, mapped.rawEndUtf16));

  const callCount = modelCalls.length;
  const replay = await ingestLongMemEvalCase({ history, namespace, capture: core.capture });
  assert.equal(replay.outcomes[0].status, 'duplicate');
  assert.equal(modelCalls.length, callCount);
  ok(core.forget({ namespace, memoryId, expectedRevision: detail.memory.revision }));
  const afterForget = await ingestLongMemEvalCase({ history, namespace, capture: core.capture });
  assert.equal(afterForget.outcomes[0].status, 'duplicate');
  assert.equal(core.get({ namespace, memoryId }).ok, false);
  assert.deepEqual(ok(core.list({ namespace: {
    ownerId: namespace.ownerId,
    scope: 'project',
    projectId: `${questionId}-other`,
  } })).memories, []);

  console.log('PASS: plan full synthetic case → lossless raw map → actual core receipt → replay → forget');
  console.log(`Synthetic database retained at ${databasePath}`);
  console.log('Engine input is normalized/redacted; raw reconstruction is reported separately.');
  console.log('Dates stay source metadata. Split turns do not preserve whole-turn model context.');
  console.log('Scripted models only: no context-fit, semantic-quality, provider or benchmark claim.');
} finally {
  core.close();
}
