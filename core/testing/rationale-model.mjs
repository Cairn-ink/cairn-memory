// Scripted synthetic behavior, not a semantic detector or production adapter.
export function rationaleModel(observe = () => {}) {
  const methods = {
    extract: ({ input }) => ({ items: input.messages.map(message => ({ content: message.content.slice(0, 600),
      kind: 'context', confidence: 0.5, sourceIndices: [message.index] })) }),
    qualifyCandidates: ({ input }) => ({ qualifications: input.items.map(item => ({ itemIndex: item.itemIndex,
      ...Object.fromEntries(['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'].map(field => [field,
        { value: ['attribution', 'commitment'].includes(field) ? 'unknown' : null,
          evidenceIndices: field === 'value' ? [item.candidates[0].candidateIndex] : [] }])) })) }),
    classify: ({ input }) => ({ items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) }),
    relate: ({ input }) => {
      const decision = input.memories.find(memory => memory.receipts.some(r => r.excerpt.startsWith('I chose A')));
      const challenge = input.memories.find(memory => memory.receipts.some(r => r.excerpt.includes('A cannot work offline')));
      const edge = (from, to, relation) => ({ from, to, relation, fromReceipt: 0, toReceipt: 0 });
      return { edges: decision ? [edge(decision.index, decision.index, 'supports-decision'),
        ...(challenge ? [edge(challenge.index, decision.index, 'challenges-premise')] : [])] : [] };
    },
    select: ({ input }) => ({ refs: input.maps.flatMap(map => map.items.filter(item => item.label?.includes('I chose A')).map(item => ({
      namespaceIndex: map.namespaceIndex, ...(item.type === 'unfiled' ? item.ref
        : { memoryId: item.ref.childId, revision: item.ref.childRevision }),
    }))) }),
    rank: ({ input }) => ({ refs: input.candidates.slice(0, input.limit).map(candidate => ({ namespaceIndex: candidate.namespaceIndex,
      memoryId: candidate.memory.id, revision: candidate.memory.revision })) }),
  };
  return { contextWindow: 8192, countTokens: () => 1,
    ...Object.fromEntries(Object.entries(methods).map(([method, run]) => [method, request => {
      observe(method, request); return run(request);
    }])) };
}
