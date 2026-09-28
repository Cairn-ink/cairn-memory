// Deterministic model port for the temporary local core. It makes no network
// or host call; it only proves that evidence moves through core, not quality.
export const REMEMBER_MARKER = 'F0-REMEMBER:';

export function createScriptedModel(calls = []) {
  return {
    contextWindow: 32_768,
    // Conservative byte count; not a provider tokenizer.
    countTokens: text => Math.ceil(Buffer.byteLength(text, 'utf8') / 4),
    async extract({ input }) {
      calls.push('extract');
      const items = [];
      for (const message of input.messages) {
        if (message.role !== 'user' || items.length >= 5) continue;
        const at = message.content.indexOf(REMEMBER_MARKER);
        if (at < 0) continue;
        const content = message.content.slice(at + REMEMBER_MARKER.length).split(/(?<=\.)\s/u)[0].trim().slice(0, 300);
        if (content) items.push({ content, kind: 'preference', confidence: 0.9, sourceIndices: [message.index] });
      }
      return { items };
    },
    // No classify port: admitted memories stay unfiled, which recall can map.
    async select({ input }) {
      calls.push('select');
      const refs = [];
      for (const map of input.maps) {
        for (const item of map.items) {
          const ref = item.type === 'unfiled' ? item.ref
            : item.type === 'ref' && item.ref.childType === 'memory'
              ? { memoryId: item.ref.childId, revision: item.ref.childRevision } : null;
          if (ref && refs.length < input.maxRefs) refs.push({ namespaceIndex: map.namespaceIndex, ...ref });
        }
      }
      return { refs };
    },
    async rank({ input }) {
      calls.push('rank');
      return { refs: input.candidates.slice(0, input.limit).map(({ memory, namespaceIndex }) =>
        ({ namespaceIndex, memoryId: memory.id, revision: memory.revision })) };
    },
  };
}
