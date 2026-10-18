import { readFileSync } from 'node:fs';
import { callModel } from './model-call.mjs';
import { emitDiagnostic } from './model-diagnostics.mjs';
import { fail, object, identifier, revision, denseArray } from './validation.mjs';
import { isSourceContext } from './source-evidence.mjs';
import { packRank, packSelect } from './model-packing.mjs';
import { createQueryWindow } from './query-excerpt.mjs';
import { generateMocCandidates } from './moc-recall-candidates.mjs';

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

export async function recallMemories({ model, readSet, query, limit, map, hierarchyMap, standaloneMap, fetch, finalize, recentReceipts,
  validateFresh = () => {}, includeQualification = false, contextMode, selectionMode }) {
  if (typeof model?.select !== 'function' || typeof model?.rank !== 'function') {
    emitDiagnostic(model, typeof model?.select !== 'function' ? 'select' : 'rank', 'core_call', 'model_not_configured');
    fail('model_not_configured');
  }
  const maps = [];
  const chosen = new Map();
  const truncation = { navigationItemsOmitted: 0, candidatesOmitted: 0, candidatesShortened: 0, receiptListsCapped: 0 };
  let strategy = 'model-selected';
  let hierarchySelection;
  if (selectionMode === 'moc-hierarchy-v1') {
    const routed = await generateMocCandidates({ core: { map: hierarchyMap }, readSet, query,
      groupModel: model, validateFresh });
    const visible = readSet.map((namespace, namespaceIndex) => {
      validateFresh();
      const page = unwrap(map({ namespace, purpose: 'recall', limit: 100, tokenBudget: 4000 }));
      if (page.invalidRefs.length) fail('invalid_ref');
      maps[namespaceIndex] = page;
      return { namespaceIndex, items: page.items, exhausted: page.exhausted };
    });
    const packed = packSelect(model, selectPrompt, { query, maps: visible, maxRefs: 12 });
    truncation.navigationItemsOmitted += packed.omitted;
    const allowed = new Map();
    for (const page of packed.input.maps) for (const item of page.items) {
      const ref = mapRef(item);
      if (ref) { const candidate = { namespaceIndex: page.namespaceIndex, ...ref }; allowed.set(key(candidate), candidate); }
    }
    let fallback = [];
    let flatCalls = 0;
    if (allowed.size || packed.overflow) {
      flatCalls++;
      fallback = selection(await callModel(model, 'select', selectPrompt, packed.input, { validateFresh }),
        allowed, 12, model, 'select');
    }
    const add = (ref, origin) => {
      if (!ref) return;
      const previous = chosen.get(key(ref));
      if (previous) {
        if (!previous.origins.includes(origin)) previous.origins.push(origin);
        if (origin === 'hierarchy') previous.paths = ref.paths;
      } else chosen.set(key(ref), { namespaceIndex: ref.namespaceIndex, memoryId: ref.memoryId,
        revision: ref.revision, origins: [origin], paths: ref.paths ?? [] });
    };
    for (let index = 0; index < Math.max(fallback.length, routed.candidates.length); index++) {
      add(fallback[index], 'fallback'); add(routed.candidates[index], 'hierarchy');
    }
    if (chosen.size > 36 || readSet.some((_, index) =>
      [...chosen.values()].filter(ref => ref.namespaceIndex === index).length > 24)) {
      fail('invalid_model_output');
    }
    strategy = 'hierarchy-with-bounded-flat-reserve';
    hierarchySelection = { mode: selectionMode, strategy, semanticCoverage: 'unassessed',
      snapshotGuarantee: 'atomic-finalization', fallback: { strategy: 'one-current-query-page-per-namespace',
        maxRefs: 12, selectedRefs: fallback, navigationItemsOmitted: packed.omitted },
      selectedL2: routed.audit.selectedL2, selectedL1: routed.audit.selectedL1,
      candidates: [...chosen.values()].map(({ namespaceIndex, memoryId, revision, origins, paths }) => {
        const edge = value => ({ parentId: value.parentId, parentRevision: value.parentRevision,
          childType: value.childType, childId: value.childId, childRevision: value.childRevision, relation: value.relation });
        const group = value => ({ namespaceIndex: value.namespaceIndex, mocId: value.mocId, revision: value.revision });
        return { namespaceIndex, memoryId, revision, origins: [...origins], paths: paths.map(path => ({
          l2: group(path.l2), l1: group(path.l1), l2ToL1: edge(path.l2ToL1), l1ToMemory: edge(path.l1ToMemory) })) };
      }),
      partialPages: routed.audit.partialPages,
      // Audit exposes references and page metadata, never the flat map labels or fetched bodies.
      maps: [...routed.audit.maps.map(({ namespaceIndex, stage, result }) => ({ namespaceIndex, stage,
        indexRevision: result.value.indexRevision, rows: result.value.items.length + result.value.invalidRefs.length,
        exhausted: result.value.exhausted, truncatedBy: result.value.truncatedBy })),
      ...maps.map((page, namespaceIndex) => ({ namespaceIndex, stage: 'fallback', indexRevision: page.indexRevision,
        rows: page.items.length, exhausted: page.exhausted, truncatedBy: page.truncatedBy }))],
      resources: { mapCalls: routed.audit.resources.mapCalls + maps.length,
        groupModelCalls: routed.audit.resources.modelCalls, flatModelCalls: flatCalls, rankModelCalls: 0,
        modelCalls: routed.audit.resources.modelCalls + flatCalls, fetchCalls: 0 }, rankVisibleRefs: [], rankSelectedRefs: [] };
  } else {
    const routed = selectionMode === 'moc-hierarchy-v2'
      ? await generateMocCandidates({ core: { map: hierarchyMap, standaloneMap }, readSet, query,
        groupModel: model, validateFresh, selectionMode }) : null;
    const flatPages = [];
    let flatModelCalls = 0;
    for (let round = 0; round < 2; round++) {
      const visible = [];
      const complete = new Map();
      readSet.forEach((namespace, namespaceIndex) => {
        const previous = maps[namespaceIndex];
        if (previous && (previous.exhausted || previous.nextCursor === null)) return;
        const page = unwrap(map({ namespace, purpose: 'recall', tokenBudget: 4000,
          ...(previous ? { cursor: previous.nextCursor } : {}) }));
        if (routed) {
          if (page.invalidRefs.length) fail('invalid_ref');
          flatPages.push({ namespaceIndex, stage: 'flat', round, indexRevision: page.indexRevision,
            rows: page.items.length, exhausted: page.exhausted, truncatedBy: page.truncatedBy });
        }
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
      flatModelCalls++;
      const output = await callModel(model, 'select', selectPrompt, packed.input,
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
    if (routed) {
      const reference = ({ namespaceIndex, memoryId, revision }) => ({ namespaceIndex, memoryId, revision });
      const flatRefs = [...chosen.values()].map(reference);
      for (const ref of chosen.values()) Object.assign(ref, { origins: ['flat'], paths: [] });
      const capacityOmittedRefs = [];
      for (const ref of routed.candidates) {
        const previous = chosen.get(key(ref));
        if (previous) {
          previous.origins.push('hierarchy');
          previous.paths = ref.paths;
        } else if (chosen.size >= 36 || [...chosen.values()]
          .filter(candidate => candidate.namespaceIndex === ref.namespaceIndex).length >= 24) {
          capacityOmittedRefs.push(reference(ref));
        } else chosen.set(key(ref), { ...ref, origins: ['hierarchy'] });
      }
      strategy = 'hierarchy-with-two-round-flat-priority';
      hierarchySelection = { mode: selectionMode, strategy, semanticCoverage: 'unassessed',
        snapshotGuarantee: 'atomic-finalization',
        fallback: { strategy: 'two-current-query-rounds', maxRefsPerCall: 24,
          maxRefsPerNamespacePerRound: 12, maxCumulativeRefs: 36, selectedRefs: flatRefs,
          navigationItemsOmitted: truncation.navigationItemsOmitted },
        selectedL2: routed.audit.selectedL2, selectedL1: routed.audit.selectedL1,
        candidates: [...chosen.values()].map(ref => ({ ...reference(ref), origins: ref.origins, paths: ref.paths })),
        hierarchyCapacityOmittedRefs: capacityOmittedRefs,
        groupPacking: routed.audit.packing ?? [],
        partialPages: routed.audit.partialPages.map(page => ({ ...page, unreadTail: 'unknown' })),
        maps: [...routed.audit.maps.map(({ namespaceIndex, stage, result }) => ({ namespaceIndex, stage,
          indexRevision: result.value.indexRevision, rows: result.value.items.length + result.value.invalidRefs.length,
          exhausted: result.value.exhausted, truncatedBy: result.value.truncatedBy })), ...flatPages],
        resources: { mapCalls: routed.audit.resources.mapCalls + flatPages.length,
          groupModelCalls: routed.audit.resources.modelCalls, flatModelCalls, rankModelCalls: 0,
          groupFitChecks: (routed.audit.packing ?? []).reduce((sum, packed) => sum + packed.fitChecks, 0),
          modelCalls: routed.audit.resources.modelCalls + flatModelCalls, fetchCalls: 0 },
        rankVisibleRefs: [], rankSelectedRefs: [] };
    }
  }
  const namespaces = readSet.map((namespace, i) => ({ namespace, mapExhausted: !hierarchySelection && maps[i].exhausted,
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
      if (hierarchySelection) hierarchySelection.resources.fetchCalls++;
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
    if (hierarchySelection) hierarchySelection.rankVisibleRefs = shown.map(ref => ({ namespaceIndex: ref.namespaceIndex,
      memoryId: ref.memoryId, revision: ref.revision }));
    if (shown.length || packed.overflow) {
      if (hierarchySelection) { hierarchySelection.resources.rankModelCalls++; hierarchySelection.resources.modelCalls++; }
      const rankOutput = await callModel(model, 'rank', prompt, packed.input,
        { validateFresh: () => validateFresh(candidates) });
      ranked = selection(rankOutput, new Map(shown.map((ref) => [key(ref), ref])), limit, model, 'rank');
    }
  }
  if (hierarchySelection) {
    hierarchySelection.rankSelectedRefs = ranked;
    const visible = new Set(hierarchySelection.rankVisibleRefs.map(key));
    hierarchySelection.rankOmittedRefs = [...chosen.values()].filter(ref => !visible.has(key(ref)))
      .map(ref => ({ namespaceIndex: ref.namespaceIndex, memoryId: ref.memoryId, revision: ref.revision }));
  }
  const truncated = Object.values(truncation).some((count) => count > 0);
  // No model/counter callback may follow the authoritative final read.
  const memories = finalize(candidates, ranked.map((ref) => candidates.findIndex((item) => key(item) === key(ref))));
  return { memories, namespaces,
    ...(selectionMode ? { selection: hierarchySelection ?? { mode: selectionMode, strategy, semanticCoverage: 'unassessed' } } : {}),
    coverage: !truncated && namespaces.every((ns) => ns.mapExhausted && ns.fetchExhausted)
    ? 'complete' : 'budget_exhausted',
    ...(truncated ? { recallTruncated: truncation } : {}) };
}
