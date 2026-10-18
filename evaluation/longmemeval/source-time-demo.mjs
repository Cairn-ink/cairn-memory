import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { openMemoryCore } from '../../core/contract.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { ingestSourceTimeIndexedEvidenceLongMemEvalCase } from './ingestion.mjs';
import { opaqueQuestionId, stableTurnId } from './prepare.mjs';
import { packSourceTimeAnswer } from './source-time-answer.mjs';

const workspace = createTestWorkspace(null, { prefix: 'cairn-t2-demo-' });
const path = join(workspace.path, 'memory.sqlite');
const namespace = { ownerId: 'synthetic-source-time-demo', scope: 'personal', projectId: null };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const model = {
  contextWindow: 8192, countTokens: () => 1,
  extract: ({ input }) => ({ items: input.messages.map(message => ({ content: message.content,
    kind: 'context', confidence: 0.9, sourceIndices: [message.index] })) }),
  classify: ({ input }) => ({ items: input.memories.map(memory => ({ memoryId: memory.id,
    parentIds: [], newL1: { title: `Synthetic ${memory.id}`, parentL2Ids: [] } })) }),
  select: ({ input }) => ({ refs: input.maps.flatMap(page => page.items.map(item =>
    item.type === 'unfiled' ? { namespaceIndex: page.namespaceIndex, ...item.ref }
      : item.type === 'ref' && item.ref.childType === 'memory'
        ? { namespaceIndex: page.namespaceIndex, memoryId: item.ref.childId, revision: item.ref.childRevision } : null).filter(Boolean)) }),
  rank: ({ input }) => ({ refs: input.candidates.map(item => ({ namespaceIndex: item.namespaceIndex,
    memoryId: item.memory.id, revision: item.memory.revision })) }),
};

try {
  const core = openMemoryCore({ path, model, captureSourcePolicy: 'indexed-evidence-v1', captureSourceTime: 'claimed-v1' });
  let closed = false; workspace.defer(() => { if (!closed) core.close(); });
  const history = { question_id: opaqueQuestionId('source-time-demo'), sessions: [
    { session_index: 0, session_id: 'earlier', date: '2026-03-07', turns: [{
      turn_id: stableTurnId('source-time-demo', 0, 'earlier', 0), role: 'user', content: 'Tomorrow I travel by train.',
    }] },
    { session_index: 1, session_id: 'later', date: '2026-03-09', turns: [{
      turn_id: stableTurnId('source-time-demo', 1, 'later', 0), role: 'assistant', content: 'Yesterday you planned to travel by train.',
    }] },
  ] };
  const ingested = await ingestSourceTimeIndexedEvidenceLongMemEvalCase({ history, namespace, capture: core.capture });
  assert.ok(ingested.outcomes.every(item => item.status === 'completed'), JSON.stringify(ingested.outcomes));
  // Unknown time is ordinary core input, not a widened prepared-history format.
  ok(await core.capture({ namespace, client: 'synthetic-source-time-demo', sessionId: 'unknown', eventId: 'unknown-batch',
    messages: [{ id: 'unknown-message', role: 'user', content: 'I have not said when this was discussed.' }] }));
  core.close(); closed = true;
  const cold = openMemoryCore({ path, model }); workspace.defer(() => cold.close());
  const recall = ok(await cold.recall({ readSet: [namespace], query: 'When was train travel discussed?', contextMode: 'source-evidence' }));
  const packed = packSourceTimeAnswer({ question: { text: 'When was train travel discussed?', date: '2026-03-10' },
    namespace, recall, get: cold.get, model: 'synthetic-scripted-model',
    limits: { inputTokens: 10_000, outputTokens: 128, contextTokens: 10_128 },
    countTokens: request => Buffer.byteLength(request, 'utf8') });
  const evidence = JSON.parse(packed.request.messages[1].content).evidence;
  assert.deepEqual(evidence.filter(tuple => Object.hasOwn(tuple, 'sourceTime')).map(tuple => tuple.sourceTime).sort(),
    ['2026-03-07', '2026-03-09']);
  assert.equal(evidence.filter(tuple => !Object.hasOwn(tuple, 'sourceTime')).length, 1);
  assert.equal(packed.serializedRequest, JSON.stringify(packed.request));
  console.log(`PASS: actual producer → capture → close → cold recall → ${evidence.length} measured source tuples; two exact labels, one unknown.`);
  console.log(`Synthetic UTF-8-byte counter: input ${packed.inputTokens}, reserved output ${packed.reservedOutputTokens}; this is not a tokenizer/context-fit or invoice claim.`);
  console.log(`Tuple diagnostics: included ${packed.included.length}, duplicate ${packed.duplicates.length}, omitted ${packed.omitted.length}.`);
  console.log('No answer dispatch, source map at answer time, model service, semantic score or H6 replay.');
} finally {
  await workspace.cleanup();
  assert.equal(existsSync(workspace.path), false);
  console.log('Owned synthetic workspace closed and removed.');
}
