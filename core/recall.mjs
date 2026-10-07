import { readFileSync } from 'node:fs';
import { callModel } from './model-call.mjs';
import { emitDiagnostic } from './model-diagnostics.mjs';
import { fail, object, identifier, revision, denseArray } from './validation.mjs';
import { isSourceContext } from './source-evidence.mjs';
import { packRank, packSelect } from './model-packing.mjs';
import { createQueryWindow } from './query-excerpt.mjs';

const selectPrompt = readFileSync(new URL('./prompts/recall-select.md', import.meta.url), 'utf8');
const rankPrompt = readFileSync(new URL('./prompts/recall-rank.md', import.meta.url), 'utf8');
const qualifiedRankPrompt = readFileSync(new URL('./prompts/recall-rank-qualified.md', import.meta.url), 'utf8');
const sourceRankPrompt = readFileSync(new URL('./prompts/recall-rank-source-evidence.md', import.meta.url), 'utf8');
const rationaleRankPrompt = readFileSync(new URL('./prompts/recall-rank-rationale-evidence.md', import.meta.url), 'utf8');
const key = (ref) => JSON.stringify([ref.namespaceIndex, ref.memoryId, ref.revision]);
const unwrap = (result) => { if (!result.ok) fail(result.error.code); return result.value; };
const mapRef = (item) => item.type === 'unfiled' ? item.ref :
  item.type === 'ref' && item.ref.childType === 'memory' ?
    { memoryId: item.ref.childId, revision: item.ref.childRevision } : null;
const oversized = (result) => !result.ok && result.error.code === 'context_item_too_large';

// Content first, then receipts in list order, each cut to a query-aware window.
// Every listed receipt keeps its identity; only excerpt text is cut, possibly
// to empty. When the whole fetched list cannot fit, the list is capped to the
// most recent receipts (ties by ID), and the final read returns that same list.
// Metadata and qualification stay whole; source-context sets are atomic.
function rankText(window, recent) {
  const length = (text) => [...text].length;
  return (candidate) => {
    const fetched = candidate.receipts;
    const contentPoints = length(candidate.memory.content);
    let pool;
    const list = (receiptCap) => receiptCap >= fetched.length ? fetched
      : (pool ??= recent(candidate, fetched.length - 1)).slice(0, receiptCap);
    return { points: contentPoints + fetched.reduce((sum, receipt) => sum + length(receipt.excerpt), 0),
      receipts: recent ? fetched.length : 0, view: (limit, receiptCap = Infinity) => {
        const chosen = list(receiptCap);
        const content = limit < contentPoints ? window(candidate.memory.content, limit) : candidate.memory.content;
        let cut = content !== candidate.memory.content;
        let left = Math.max(0, limit - contentPoints);
        const receipts = chosen.map((receipt) => {
          const points = length(receipt.excerpt);
          const shown = Math.min(left, points);
          left -= shown;
          if (shown === points) return receipt;
          cut = true;
          return { ...receipt, excerpt: window(receipt.excerpt, shown), excerptShortened: true };
        });
        return { ...candidate, ...(content === candidate.memory.content ? {}
          : { memory: { ...candidate.memory, content } }), receipts,
        ...(cut ? { textShortened: true } : {}),
        ...(chosen === fetched ? {} : { receiptsOmitted: candidate.receiptCount - chosen.length }) };
      } };
  };
}

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

export async function recallMemories({ model, modelCallTimeoutMs, readSet, query, limit, map, fetch, finalize, recentReceipts,
  validateFresh = () => {}, includeQualification = false, contextMode, selectionMode }) {
  if (typeof model?.select !== 'function' || typeof model?.rank !== 'function') {
    emitDiagnostic(model, typeof model?.select !== 'function' ? 'select' : 'rank', 'core_call', 'model_not_configured');
    fail('model_not_configured');
  }
  const maps = [];
  const chosen = new Map();
  const truncation = { navigationItemsOmitted: 0, candidatesOmitted: 0, candidatesShortened: 0, receiptListsCapped: 0 };
  let strategy = 'model-selected';
  for (let round = 0; round < 2; round++) {
    const visible = [];
    const complete = new Map();
    readSet.forEach((namespace, namespaceIndex) => {
      const previous = maps[namespaceIndex];
      if (previous && (previous.exhausted || previous.nextCursor === null)) return;
      const page = unwrap(map({ namespace, purpose: 'recall', tokenBudget: 4000,
        ...(previous ? { cursor: previous.nextCursor } : {}) }));
      maps[namespaceIndex] = page;
      visible.push({ namespaceIndex, items: page.items, exhausted: page.exhausted });
      for (const item of page.items) {
        const ref = mapRef(item);
        if (ref) { const candidate = { namespaceIndex, ...ref }; complete.set(key(candidate), candidate); }
      }
    });
    if (!visible.length) break;
    if (selectionMode === 'bounded-source-scan' && round === 0 &&
        maps.every(page => page.exhausted && page.nextCursor === null) && complete.size <= 24 &&
        readSet.every((_, index) => [...complete.values()].filter(ref => ref.namespaceIndex === index).length <= 12)) {
      for (const [identity, ref] of complete) chosen.set(identity, ref);
      strategy = 'complete-map';
      break;
    }
    const maxRefs = Math.min(24, 36 - chosen.size);
    const packed = packSelect(model, selectPrompt, { query, maps: visible, maxRefs });
    truncation.navigationItemsOmitted += packed.omitted;
    // Only refs shown in this request's maps are selectable.
    const allowed = new Map();
    for (const page of packed.input.maps) for (const item of page.items) {
      const ref = mapRef(item);
      if (ref) { const candidate = { namespaceIndex: page.namespaceIndex, ...ref }; allowed.set(key(candidate), candidate); }
    }
    if (packed.omitted && !packed.overflow && packed.input.maps.every((page) => !page.items.length)) continue;
    const output = await callModel(model, 'select', selectPrompt, packed.input,
      { validateFresh: () => validateFresh([...chosen.values()]), modelCallTimeoutMs });
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
  const candidates = [];
  for (const ref of chosen.values()) {
    validateFresh([...chosen.values()]);
    const request = { namespace: readSet[ref.namespaceIndex], tokenBudget: 4000,
      ...(includeQualification ? { includeQualification: true } : {}),
      ...(isSourceContext(contextMode) ? { contextMode } : {}),
      refs: [{ memoryId: ref.memoryId, revision: ref.revision }] };
    const receipts = [];
    const receiptIds = new Set();
    let page;
    let item;
    let exhausted = false;
    for (let round = 0; round < 2; round++) {
      const result = fetch({ ...request, ...(page ? { cursor: page.nextCursor } : {}) });
      // A memory that cannot fit one fetch envelope is left out, not fatal; a
      // later receipt page that cannot fit leaves the earlier receipts.
      if (oversized(result)) break;
      page = unwrap(result);
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
      exhausted = page.exhausted;
      if (exhausted) break;
    }
    if (!item) { truncation.candidatesOmitted++; continue; }
    if (!exhausted) namespaces[ref.namespaceIndex].fetchExhausted = false;
    candidates.push({ ...ref, item: { ...item, receipts } });
  }
  let ranked = [];
  if (candidates.length) {
    const prompt = contextMode === 'rationale-evidence' ? rationaleRankPrompt
      : contextMode === 'source-evidence' ? sourceRankPrompt : includeQualification ? qualifiedRankPrompt : rankPrompt;
    const recent = recentReceipts && ((candidate, count) => recentReceipts({ namespaceIndex: candidate.namespaceIndex,
      memoryId: candidate.memory.id, revision: candidate.memory.revision }, count));
    const packed = packRank(model, prompt, { query, limit,
      candidates: candidates.map(({ namespaceIndex, item }) => ({ namespaceIndex, ...item })) },
    isSourceContext(contextMode) ? () => null : rankText(createQueryWindow(query), recent));
    truncation.candidatesOmitted += packed.omitted;
    packed.input.candidates.forEach((sent, position) => {
      if (sent.textShortened === true) truncation.candidatesShortened++;
      if (sent.receiptsOmitted === undefined) return;
      // The final read returns exactly this capped, most-recent-first list.
      truncation.receiptListsCapped++;
      candidates[packed.included[position]].receiptCap = sent.receipts.length;
    });
    const shown = packed.included.map((index) => candidates[index]);
    if (shown.length || packed.overflow) {
      const rankOutput = await callModel(model, 'rank', prompt, packed.input,
        { validateFresh: () => validateFresh(candidates), modelCallTimeoutMs });
      ranked = selection(rankOutput, new Map(shown.map((ref) => [key(ref), ref])), limit, model, 'rank');
    }
  }
  const truncated = Object.values(truncation).some((count) => count > 0);
  // No model/counter callback may follow the authoritative final read.
  const memories = finalize(candidates, ranked.map((ref) => candidates.findIndex((item) => key(item) === key(ref))));
  return { memories, namespaces,
    ...(selectionMode ? { selection: { mode: selectionMode, strategy, semanticCoverage: 'unassessed' } } : {}),
    coverage: !truncated && namespaces.every((ns) => ns.mapExhausted && ns.fetchExhausted)
    ? 'complete' : 'budget_exhausted',
    ...(truncated ? { recallTruncated: truncation } : {}) };
}
