import { readFileSync } from 'node:fs';
import { callModel } from './model-call.mjs';
import { fail, object, identifier, revision, denseArray } from './validation.mjs';

const selectPrompt = readFileSync(new URL('./prompts/recall-select.md', import.meta.url), 'utf8');
const rankPrompt = readFileSync(new URL('./prompts/recall-rank.md', import.meta.url), 'utf8');
const key = (ref) => JSON.stringify([ref.namespaceIndex, ref.memoryId, ref.revision]);
const unwrap = (result) => { if (!result.ok) fail(result.error.code); return result.value; };

function selection(output, allowed, maximum) {
  try {
    object(output, ['refs']);
    denseArray(output.refs, 0, maximum);
    const seen = new Set();
    return output.refs.map((ref) => {
      object(ref, ['namespaceIndex', 'memoryId', 'revision']);
      if (!Number.isSafeInteger(ref.namespaceIndex) || ref.namespaceIndex < 0) fail('invalid_model_output');
      const clean = { namespaceIndex: ref.namespaceIndex, memoryId: identifier(ref.memoryId), revision: revision(ref.revision) };
      const identity = key(clean);
      if (!allowed.has(identity) || seen.has(identity)) fail('invalid_model_output');
      seen.add(identity);
      return clean;
    });
  } catch { fail('invalid_model_output'); }
}

export async function recallMemories({ model, readSet, query, limit, map, fetch, finalize }) {
  if (typeof model?.select !== 'function' || typeof model?.rank !== 'function') fail('model_not_configured');
  const maps = readSet.map((namespace) => unwrap(map({ namespace, purpose: 'recall' })));
  const allowed = new Map();
  maps.forEach((page, namespaceIndex) => {
    for (const item of page.items) {
      const ref = item.type === 'unfiled' ? item.ref :
        item.type === 'ref' && item.ref.childType === 'memory' ?
          { memoryId: item.ref.childId, revision: item.ref.childRevision } : null;
      if (ref) { const candidate = { namespaceIndex, ...ref }; allowed.set(key(candidate), candidate); }
    }
  });
  const output = await callModel(model, 'select', selectPrompt, {
    query, maps: maps.map((page, namespaceIndex) => ({ namespaceIndex,
      items: page.items, exhausted: page.exhausted })),
  });
  const chosen = selection(output, allowed, 24);
  for (let i = 0; i < readSet.length; i++) {
    if (chosen.filter((ref) => ref.namespaceIndex === i).length > 12) fail('invalid_model_output');
  }
  const namespaces = readSet.map((namespace, i) => ({ namespace, mapExhausted: maps[i].exhausted,
    fetchExhausted: true }));
  const candidates = chosen.map((ref) => {
    const page = unwrap(fetch({ namespace: readSet[ref.namespaceIndex],
      refs: [{ memoryId: ref.memoryId, revision: ref.revision }] }));
    if (page.invalidRefs.length || page.items.length !== 1) fail('revision_conflict');
    if (!page.exhausted) namespaces[ref.namespaceIndex].fetchExhausted = false;
    return { ...ref, item: page.items[0] };
  });
  let ranked = [];
  if (candidates.length) {
    const rankOutput = await callModel(model, 'rank', rankPrompt, { query, limit,
      candidates: candidates.map(({ namespaceIndex, item }) => ({ namespaceIndex, ...item })) });
    ranked = selection(rankOutput, new Map(candidates.map((ref) => [key(ref), ref])), limit);
  }
  // No model/counter callback may follow the authoritative final read.
  const memories = finalize(candidates, ranked.map((ref) => candidates.findIndex((item) => key(item) === key(ref))));
  return { memories, namespaces, coverage: namespaces.every((ns) => ns.mapExhausted && ns.fetchExhausted)
    ? 'complete' : 'budget_exhausted' };
}
