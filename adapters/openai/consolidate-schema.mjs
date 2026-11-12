const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export function consolidationSchema(input) {
  if (!input || !Array.isArray(input.memories) || !input.memories.length || input.memories.length > 96 ||
      !Array.isArray(input.rawSpans) || input.rawSpans.length > 96 ||
      Object.keys(input).some(key => !['memories', 'rawSpans', 'relations'].includes(key))) throw Error('invalid_openai_request');
  const ids = input.memories.map(memory => memory.id);
  if (new Set(ids).size !== ids.length || input.memories.some(m => typeof m.id !== 'string' || !m.id.length ||
      !Number.isSafeInteger(m.revision) || m.revision < 1 || typeof m.content !== 'string' || !m.content.isWellFormed() ||
      typeof m.date !== 'string' || !Number.isFinite(Date.parse(m.date)) || !['current', 'historical'].includes(m.currentness)) ||
      input.rawSpans.some(span => !ids.includes(span.memoryId) || typeof span.text !== 'string' || !span.text.isWellFormed() || span.text.length > 400)) {
    throw Error('invalid_openai_request');
  }
  if (input.relations !== undefined && (!Array.isArray(input.relations) || input.relations.length > 192 ||
      input.relations.some(edge => !ids.includes(edge?.from) || !ids.includes(edge?.to) ||
        !['supersedes', 'contradicts'].includes(edge?.kind) || typeof edge.slot !== 'string'))) throw Error('invalid_openai_request');
  const sentence = { text: { type: 'string', maxLength: 2000 },
    memoryIds: { type: 'array', items: { type: 'string', enum: ids }, maxItems: 96 } };
  const array = item => ({ type: 'array', items: object(item), maxItems: 16 });
  return object({ currentState: array(sentence), timeline: array({ date: { type: 'string' }, ...sentence }),
    contradictions: array(sentence) });
}
