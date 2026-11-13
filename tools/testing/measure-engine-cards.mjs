import assert from 'node:assert/strict';
import { scriptedConsolidator, realisticCardMemories } from '../../core/testing/engine-card-fixture.mjs';
import { validateConsolidation } from '../../core/engine-card-output.mjs';
import { deliveredCardText } from '../../core/context-read-assembly.mjs';
import { ENGINE_CARD_LIMITS } from '../../core/private-card-input.mjs';

// Offline dated source lines, real tokenizer, UUID IDs; no model prose.
const model = scriptedConsolidator();
const measurements = [5, 8, 12].map(count => {
  const memories = realisticCardMemories(count);
  for (const memory of memories) assert.ok(memory.content.split(' ').length >= 15 && memory.content.split(' ').length <= 40);
  const { body } = validateConsolidation({ currentState: [{ text: 'ok', memoryIds: [memories.at(-1).id] }],
    timeline: [], contradictions: [] }, memories, model);
  const delivered = deliveredCardText({ type: 'card', text: 'Topic: Orion\n' + body, metadata: { origin: 'engine' } });
  assert.equal(body.split('\n').length, count);
  return { memories: count, storedBodyTokens: model.countTokens(body), deliveredBodyTokens: model.countTokens(delivered) };
});
console.log(JSON.stringify({ tokenizer: 'o200k_base', maxTokens: ENGINE_CARD_LIMITS.maxTokens, measurements }, null, 2));
