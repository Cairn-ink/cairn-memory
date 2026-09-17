import { readFileSync } from 'node:fs';
import { callModel } from './model-call.mjs';
import { emitDiagnostic } from './model-diagnostics.mjs';
import { fail, object, identifier, revision, denseArray } from './validation.mjs';
import { isSourceContext, isRationaleContext } from './source-evidence.mjs';

const selectPrompt = readFileSync(new URL('./prompts/recall-select.md', import.meta.url), 'utf8');
const rankPrompt = readFileSync(new URL('./prompts/recall-rank.md', import.meta.url), 'utf8');
const qualifiedRankPrompt = readFileSync(new URL('./prompts/recall-rank-qualified.md', import.meta.url), 'utf8');
const sourceRankPrompt = readFileSync(new URL('./prompts/recall-rank-source-evidence.md', import.meta.url), 'utf8');
const rationaleRankPrompt = readFileSync(new URL('./prompts/recall-rank-rationale-evidence.md', import.meta.url), 'utf8');
const key = (ref) => JSON.stringify([ref.namespaceIndex, ref.memoryId, ref.revision]);
const unwrap = (result) => { if (!result.ok) fail(result.error.code); return result.value; };

function selection(output, allowed, maximum, model, stage) {
  let reason = 'malformed_refs';
  try {
    object(output, ['refs']);
    denseArray(output.refs, 0, maximum);
    const seen = new Set();
    return output.refs.map((ref) => {
      object(ref, ['namespaceIndex', 'memoryId', 'revision']);
      if (!Number.isSafeInteger(ref.namespaceIndex) || ref.namespaceIndex < 0) fail('invalid_model_output');
      const clean = { namespaceIndex: ref.namespaceIndex, memoryId: identifier(ref.memoryId), revision: revision(ref.revision) };
      const identity = key(clean);
      if (!allowed.has(identity)) { reason = 'non_visible_ref'; fail('invalid_model_output'); }
      if (seen.has(identity)) { reason = 'duplicate_ref'; fail('invalid_model_output'); }
      seen.add(identity);
      return clean;
    });
  } catch { emitDiagnostic(model, stage, 'core_validation', reason); fail('invalid_model_output'); }
}

export async function recallMemories({ model, readSet, query, limit, map, fetch, finalize,
  validateFresh = () => {}, includeQualification = false, contextMode, selectionMode, rankingMode,
  eventProjection = false }) {
  if (typeof model?.select !== 'function' || typeof model?.rank !== 'function') {
    emitDiagnostic(model, typeof model?.select !== 'function' ? 'select' : 'rank', 'core_call', 'model_not_configured');
    fail('model_not_configured');
  }
  const maps = [];
  const chosen = new Map();
  let strategy = 'model-selected';
  for (let round = 0; round < 2; round++) {
    const visible = [];
    const allowed = new Map();
    readSet.forEach((namespace, namespaceIndex) => {
      const previous = maps[namespaceIndex];
      if (previous && (previous.exhausted || previous.nextCursor === null)) return;
      const page = unwrap(map({ namespace, purpose: 'recall', tokenBudget: 4000,
        ...(previous ? { cursor: previous.nextCursor } : {}) }));
      maps[namespaceIndex] = page;
      visible.push({ namespaceIndex, items: page.items, exhausted: page.exhausted });
      for (const item of page.items) {
        const ref = item.type === 'unfiled' ? item.ref :
          item.type === 'ref' && item.ref.childType === 'memory' ?
            { memoryId: item.ref.childId, revision: item.ref.childRevision } : null;
        if (ref) { const candidate = { namespaceIndex, ...ref }; allowed.set(key(candidate), candidate); }
      }
    });
    if (!visible.length) break;
    if (selectionMode === 'bounded-source-scan' && round === 0 &&
        maps.every(page => page.exhausted && page.nextCursor === null) && allowed.size <= 24 &&
        readSet.every((_, index) => [...allowed.values()].filter(ref => ref.namespaceIndex === index).length <= 12)) {
      for (const [identity, ref] of allowed) chosen.set(identity, ref);
      strategy = 'complete-map';
      break;
    }
    const maxRefs = Math.min(24, 36 - chosen.size);
    const output = await callModel(model, 'select', selectPrompt, { query, maps: visible, maxRefs },
      { validateFresh: () => validateFresh([...chosen.values()]) });
    const selected = selection(output, allowed, maxRefs, model, 'select');
    for (let i = 0; i < readSet.length; i++) {
      if (selected.filter((ref) => ref.namespaceIndex === i).length > 12) {
        emitDiagnostic(model, 'select', 'core_validation', 'namespace_selection_limit');
        fail('invalid_model_output');
      }
    }
    for (const ref of selected) {
      if (!chosen.has(key(ref))) chosen.set(key(ref), ref);
    }
  }
  const namespaces = readSet.map((namespace, i) => ({ namespace, mapExhausted: maps[i].exhausted,
    fetchExhausted: true }));
  const candidates = [...chosen.values()].map((ref) => {
    validateFresh([...chosen.values()]);
    const request = { namespace: readSet[ref.namespaceIndex], tokenBudget: 4000,
      ...(includeQualification ? { includeQualification: true } : {}),
      ...(isSourceContext(contextMode) ? { contextMode: rankingMode ? 'source-evidence' : contextMode } : {}),
      refs: [{ memoryId: ref.memoryId, revision: ref.revision }] };
    const receipts = [];
    const receiptIds = new Set();
    let page;
    let item;
    for (let round = 0; round < 2; round++) {
      page = unwrap(fetch({ ...request, ...(page ? { cursor: page.nextCursor } : {}) }));
      validateFresh([...chosen.values()]);
      if (page.invalidRefs.length || page.items.length !== 1) fail('revision_conflict');
      const current = page.items[0];
      if (current.memory.id !== ref.memoryId || current.memory.revision !== ref.revision) {
        fail('revision_conflict');
      }
      for (const receipt of current.receipts) {
        if (receiptIds.has(receipt.id)) fail('revision_conflict');
        receiptIds.add(receipt.id);
        receipts.push(receipt);
      }
      item = current;
      if (page.exhausted) break;
    }
    if (!page.exhausted) namespaces[ref.namespaceIndex].fetchExhausted = false;
    return { ...ref, item: { ...item, receipts } };
  });
  let ranked = [];
  if (candidates.length) {
    const prompt = rankingMode ? sourceRankPrompt : isRationaleContext(contextMode) ? rationaleRankPrompt
      : contextMode === 'source-evidence' ? sourceRankPrompt : includeQualification ? qualifiedRankPrompt : rankPrompt;
    const rankOutput = await callModel(model, 'rank', prompt, { query, limit,
      candidates: candidates.map(({ namespaceIndex, item }) => ({ namespaceIndex, ...item })) },
      { validateFresh: () => validateFresh(candidates) });
    ranked = selection(rankOutput, new Map(candidates.map((ref) => [key(ref), ref])), limit, model, 'rank');
  }
  // No model/counter callback may follow the authoritative final read.
  const finalized = finalize(candidates, ranked.map((ref) => candidates.findIndex((item) => key(item) === key(ref))));
  return { ...(eventProjection ? { sourceEvents: finalized } : { memories: finalized }), namespaces,
    ...(selectionMode ? { selection: { mode: selectionMode, strategy, semanticCoverage: 'unassessed' } } : {}),
    coverage: namespaces.every((ns) => ns.mapExhausted && ns.fetchExhausted)
    ? 'complete' : 'budget_exhausted' };
}
