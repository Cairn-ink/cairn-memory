// Cold-reader boundary: this process receives only a database path, a query,
// and ordinary recall configuration. It has no event fixture or writer model.
import { openMemoryCore } from '../../core/index.mjs';

const [path, query, mode = 'rationale-evidence'] = process.argv.slice(2);
if (!path || !query) throw new Error('expected database path and query');
const namespace = { ownerId: 'migration-lifecycle', scope: 'personal', projectId: null };
const calls = [];
const model = {
  contextWindow: 8192,
  countTokens: () => 1, // deterministic test counter, not a provider tokenizer
  select: ({ input }) => {
    calls.push({ stage: 'select', visible: input.maps.flatMap(map => map.items.map(item => ({
      type: item.type, label: item.label, ref: item.ref,
    }))) });
    return { refs: input.maps.flatMap(map => map.items.flatMap(item => {
      const ref = item.type === 'unfiled' ? item.ref
        : item.type === 'ref' && item.ref.childType === 'memory'
          ? { memoryId: item.ref.childId, revision: item.ref.childRevision } : null;
      return ref ? [{ namespaceIndex: map.namespaceIndex, ...ref }] : [];
    })) };
  },
  rank: ({ input }) => {
    calls.push({ stage: 'rank', candidates: input.candidates.map(candidate => ({
      memory: candidate.memory, receipts: candidate.receipts, rationale: candidate.rationale,
    })) });
    return { refs: input.candidates.slice(0, input.limit).map(candidate => ({
      namespaceIndex: candidate.namespaceIndex, memoryId: candidate.memory.id,
      revision: candidate.memory.revision,
    })) };
  },
};
const core = openMemoryCore({ path, model });
try {
  const result = await core.recall({ readSet: [namespace], query, limit: 6, contextMode: mode });
  const listed = core.list({ namespace, limit: 20, states: ['active'] });
  const classificationMap = core.map({ namespace, purpose: 'classification' });
  const recallMap = core.map({ namespace, purpose: 'recall' });
  const completeSources = core.sourceSnapshot({ readSet: [namespace], limit: 6 });
  const inspected = listed.ok ? listed.value.memories.map(memory => core.get({
    namespace, memoryId: memory.id, includeQualification: true,
  })) : [];
  process.stdout.write(JSON.stringify({ result, listed, classificationMap, recallMap, completeSources, inspected, calls }));
} finally {
  core.close();
}
