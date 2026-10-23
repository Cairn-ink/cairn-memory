import { countTokens } from './counter.mjs';

export function prepareItems(memories) {
  return memories.map(memory => ({ id: memory.id,
    body: { id: `${memory.id}#body`, text: memory.content, tokens: countTokens(memory.content) },
    spans: memory.spans.map(span => ({ id: span.id, text: span.text, tokens: countTokens(span.text) })) }));
}
