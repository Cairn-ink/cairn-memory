// OFFLINE TEST ONLY. Text matching below is an oracle for wiring, not a detector.
// This deterministic byte/4 counter is mechanical, not provider tokens or cost.
export const mechanicalCountTokens = text => Math.ceil(Buffer.byteLength(text) / 4);

export function eventStateScriptedModel({ failMethod, noEdges = false, emptySelection = false,
  staleSelection = false, foreignSelection = false, oversizedOutput = false } = {}) {
  const methods = {
    extract: ({ input }) => ({ items: input.messages.map(message => ({
      content: message.content, kind: 'context', confidence: 0.5, sourceIndices: [message.index],
    })) }),
    qualifyCandidates: ({ input }) => ({ qualifications: input.items.map(item => ({ itemIndex: item.itemIndex,
      ...Object.fromEntries(['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'].map(field => [field,
        { value: ['attribution', 'commitment'].includes(field) ? 'unknown' : null,
          evidenceIndices: field === 'value' ? [item.candidates[0].candidateIndex] : [] }])) })) }),
    // Deliberate no-op filing avoids unmerged MOC foundation dependencies.
    classify: ({ input }) => ({ items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) }),
    relate: ({ input }) => {
      if (noEdges) return { edges: [] };
      const decision = input.memories.find(memory => memory.receipts.some(r => r.excerpt.includes('I adopt Alder')));
      const challenge = input.memories.find(memory => memory.receipts.some(r => r.excerpt.includes('now 960 credits')));
      const edge = (from, to, relation) => ({ from: from.index, to: to.index, relation, fromReceipt: 0, toReceipt: 0 });
      return { edges: decision ? [edge(decision, decision, 'supports-decision'),
        ...(challenge ? [edge(challenge, decision, 'challenges-premise')] : [])] : [] };
    },
    select: ({ input }) => ({ refs: emptySelection ? [] : input.maps.flatMap(map => map.items
      .filter(item => item.type === 'unfiled' || item.type === 'ref' && item.ref.childType === 'memory')
      .map(item => {
        const ref = item.type === 'unfiled' ? item.ref : { memoryId: item.ref.childId, revision: item.ref.childRevision };
        return { namespaceIndex: foreignSelection ? 1 : map.namespaceIndex, ...ref,
          revision: staleSelection ? ref.revision + 1 : ref.revision };
      })) }),
    rank: ({ input }) => ({ refs: input.candidates.slice(0, input.limit).map(candidate => ({
      namespaceIndex: candidate.namespaceIndex, memoryId: candidate.memory.id, revision: candidate.memory.revision,
    })) }),
  };
  return { contextWindow: 16384, countTokens: mechanicalCountTokens,
    ...Object.fromEntries(Object.entries(methods).map(([method, run]) => [method, request => {
      if (method === failMethod) throw new Error('injected-offline-failure');
      if (method === 'extract' && oversizedOutput) return { items: [], padding: 'x'.repeat(24001) };
      return run(request);
    }])) };
}
