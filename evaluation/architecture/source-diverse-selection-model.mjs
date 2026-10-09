import { createHash } from 'node:crypto';
import { countTokens } from '../../core/model-budget.mjs';
import { fail, identifier } from '../../core/validation.mjs';
import { freeze, snapshotJson } from '../longmemeval/mixed-validation.mjs';
import { prepareSelectionChecklist } from './query-evidence-checklist.mjs';

const key = ref => JSON.stringify([ref.namespaceIndex, ref.memoryId, ref.revision]);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const checkAbort = signal => {
  if (signal.aborted) throw new DOMException('Source-diverse selection cancelled', 'AbortError');
};
function data(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('invalid_input');
  for (const name of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (typeof name !== 'string' || allowed && !allowed.includes(name)
      || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail('invalid_input');
  }
  return value;
}
function snapshot(value, bytes, code = 'invalid_input') {
  try { return freeze(JSON.parse(JSON.stringify(snapshotJson(value,
    { bytes, nodes: 30_000, depth: 20 }, code)))); } catch { fail(code); }
}
function bindings(value) {
  const readSet = snapshot(value, 4096);
  if (!Array.isArray(readSet) || readSet.length < 1 || readSet.length > 2) fail('invalid_input');
  for (const ns of readSet) {
    data(ns, ['ownerId', 'scope', 'projectId']);
    if (Object.keys(ns).length !== 3) fail('invalid_input');
    try {
      identifier(ns.ownerId);
      if (ns.scope === 'project') identifier(ns.projectId);
      else if (ns.scope !== 'personal' || ns.projectId !== null) fail('invalid_input');
    } catch { fail('invalid_input'); }
  }
  if (readSet.length === 2 && (readSet[0].ownerId !== readSet[1].ownerId
    || readSet[0].scope === readSet[1].scope)) fail('invalid_input');
  return readSet;
}
function prepare(input, readSet) {
  const original = snapshot(input, 24_000), prepared = prepareSelectionChecklist(original);
  const visible = new Map();
  for (const map of original.maps) {
    if (!readSet[map.namespaceIndex]) fail('invalid_input');
    for (const item of map.items) {
      const memory = item.type === 'unfiled' ? item.ref : item.type === 'ref' && item.ref.childType === 'memory'
        ? { memoryId: item.ref.childId, revision: item.ref.childRevision } : null;
      if (memory) {
        const ref = { namespaceIndex: map.namespaceIndex, ...memory };
        if (!visible.has(key(ref))) visible.set(key(ref), ref);
      }
    }
  }
  function compile(value) {
    const output = snapshot(value, 40_000, 'invalid_model_output');
    if (!output || typeof output !== 'object' || Array.isArray(output)
      || Object.keys(output).length !== 1 || !Array.isArray(output.refs)) fail('invalid_model_output');
    return freeze(prepared.compile({ requests: [{ start: 0, end: original.query.length, refs: output.refs }] }).selection);
  }
  return { original, visible, compile };
}
function inspectionOrder(original, visible) {
  return [...new Map([...original.refs, ...visible.values()].map(ref => [key(ref), ref])).values()];
}
function inspect(ref, response, readSet) {
  const value = snapshot(response, 65_536, 'revision_conflict');
  try {
    if (value.ok !== true) fail('revision_conflict');
    const detail = value.value, memory = detail.memory, ns = memory.namespace;
    if (memory.id !== ref.memoryId || memory.revision !== ref.revision || memory.state !== 'active'
      || memory.currentness !== undefined && memory.currentness !== 'current'
      || memory.reviewState !== undefined && !['none', 'confirmed'].includes(memory.reviewState)
      || !ns || Object.keys(ns).length !== 3
      || ['ownerId', 'scope', 'projectId'].some(name => ns[name] !== readSet[ref.namespaceIndex][name])
      || typeof memory.content !== 'string' || !memory.content.trim() || memory.content.length > 4000
      || !Number.isSafeInteger(memory.receiptCount) || memory.receiptCount < 0
      || !Array.isArray(detail.receipts) || detail.receipts.length > 8
      || typeof detail.exhausted !== 'boolean'
      || (detail.exhausted ? detail.nextReceiptCursor !== null || memory.receiptCount !== detail.receipts.length
        : typeof detail.nextReceiptCursor !== 'string' || !detail.nextReceiptCursor || memory.receiptCount <= detail.receipts.length)) fail('revision_conflict');
    const ids = new Set(), receipts = detail.receipts.map(receipt => {
      for (const name of ['id', 'client', 'sessionId', 'eventId']) identifier(receipt[name]);
      if (ids.has(receipt.id) || !['user', 'assistant'].includes(receipt.role)
        || typeof receipt.excerpt !== 'string' || !receipt.excerpt.trim() || receipt.excerpt.length > 800) fail('revision_conflict');
      ids.add(receipt.id);
      return { receiptId: receipt.id, client: receipt.client, sessionId: receipt.sessionId,
        eventId: receipt.eventId, role: receipt.role, excerpt: receipt.excerpt };
    });
    const sourceKeys = receipts.map(receipt => JSON.stringify([readSet[ref.namespaceIndex],
      receipt.client, receipt.sessionId, receipt.eventId, receipt.role, receipt.excerpt]));
    const eligible = detail.exhausted && receipts.length > 0 && memory.receiptCount <= 8;
    return { ref, namespace: readSet[ref.namespaceIndex], eligible,
      reason: eligible ? null : detail.exhausted ? 'empty_source_set' : 'partial_source_set', receipts,
      sourceKeys: [...new Set(sourceKeys)], materialBytes: sourceKeys.reduce((sum, source) => sum + Buffer.byteLength(source), 0),
      signature: digest({ ref, state: memory.state, reviewState: memory.reviewState ?? 'none',
        count: memory.receiptCount, exhausted: detail.exhausted, sources: [...sourceKeys].sort() }) };
  } catch { fail('revision_conflict'); }
}
function assemble(prepared, original, cards, materialBytes, materialLimit) {
  const byRef = new Map(cards.map(card => [key(card.ref), card]));
  const represented = new Set(), selected = [], removedSeeds = [], additions = [], counts = new Map();
  const keep = ref => { selected.push(ref); counts.set(ref.namespaceIndex, (counts.get(ref.namespaceIndex) ?? 0) + 1); };
  for (const seed of original.refs) {
    const card = byRef.get(key(seed));
    if (card?.eligible && card.sourceKeys.every(source => represented.has(source))) removedSeeds.push(seed);
    else {
      keep(seed);
      if (card?.eligible) for (const source of card.sourceKeys) represented.add(source);
    }
  }
  const chosen = new Set(selected.map(key));
  for (let round = 0; round < 4 && selected.length < prepared.original.maxRefs; round++) {
    let best = null, novelty = 0;
    for (const ref of prepared.visible.values()) {
      const card = byRef.get(key(ref));
      if (!card?.eligible || chosen.has(key(ref)) || (counts.get(ref.namespaceIndex) ?? 0) >= 12) continue;
      const uncovered = card.sourceKeys.filter(source => !represented.has(source)).length;
      if (uncovered > novelty) { best = card; novelty = uncovered; }
    }
    if (!best) break;
    keep(best.ref); chosen.add(key(best.ref));
    additions.push({ ref: best.ref, novelSources: novelty });
    for (const source of best.sourceKeys) represented.add(source);
  }
  const order = inspectionOrder(original, prepared.visible);
  return freeze({ output: prepared.compile({ refs: selected }), diagnostics: {
    strategy: 'source-diverse-visible-selection-v1', semanticCoverage: 'unassessed',
    sourceMaterialBytes: materialBytes, sourceMaterialLimitReached: materialLimit,
    inspectedCards: cards.length, publicReadUpperBound: cards.length * 2,
    cardLimitReached: order.length > 24 && cards.length === 24,
    originalRefs: original.refs, removedSeeds, additions, representedSourceCount: represented.size,
    inspections: cards.map(({ ref, namespace, eligible, reason, receipts, materialBytes: bytes }) => ({
      ref, namespace, assessment: eligible ? 'complete' : 'unassessed', reason,
      materialBytes: bytes, receipts: reason === 'source_material_limit' ? [] : receipts })) } });
}

/** Pure source-set compiler: (original select input, original { refs },
 * { readSet, inspections: [{ ref, response: actual public get result }] }) ->
 * immutable { output: { refs }, diagnostics }. Observations must be the selected-
 * first visible-order prefix, <=24, ending immediately upon a 64KiB crossing.
 * Exact source identity is namespace/client/sessionId/eventId/role/excerpt,
 * not receipt UUID, interpretation, shared code, relevance or semantic identity.
 */
export function assembleSourceDiverseSelection(input, originalOutput, options) {
  data(options, ['readSet', 'inspections']);
  const readSet = bindings(options.readSet), prepared = prepare(input, readSet), original = prepared.compile(originalOutput);
  const observations = options.inspections;
  if (!Array.isArray(observations) || Object.getPrototypeOf(observations) !== Array.prototype
    || observations.length > 24 || Reflect.ownKeys(observations).length !== observations.length + 1) fail('invalid_input');
  const cards = [], order = original.refs.length ? inspectionOrder(original, prepared.visible) : [];
  let bytes = 0, materialLimit = false;
  for (let index = 0; index < observations.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(observations, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) fail('invalid_input');
    const observation = data(descriptor.value, ['ref', 'response']);
    const detachedRef = snapshot(observation.ref, 4096);
    if (!detachedRef || typeof detachedRef !== 'object' || Array.isArray(detachedRef)
      || Object.keys(detachedRef).length !== 3 || !['namespaceIndex', 'memoryId', 'revision'].every(name => Object.hasOwn(detachedRef, name))
      || !order[index] || key(detachedRef) !== key(order[index]) || materialLimit) fail('invalid_input');
    const card = inspect(order[index], observation.response, readSet);
    if (bytes + card.materialBytes > 65_536) {
      materialLimit = true; card.eligible = false; card.reason = 'source_material_limit';
    } else bytes += card.materialBytes;
    cards.push(card);
  }
  if (!materialLimit && cards.length !== Math.min(order.length, 24)) fail('invalid_input');
  return assemble(prepared, original, cards, bytes, materialLimit);
}

/** Evaluation only; public get calls are bounded, not an atomic snapshot. */
export function createSourceDiverseSelectionModel(model, options) {
  data(model); data(options, ['readSet', 'getMemory']);
  if (typeof model.select !== 'function') fail('model_not_configured');
  if (typeof model.countTokens !== 'function') fail('token_count_unavailable');
  if (!Number.isSafeInteger(model.contextWindow) || model.contextWindow < 8192) fail('context_budget_exceeded');
  if (typeof options.getMemory !== 'function') fail('invalid_input');
  const readSet = bindings(options.readSet), getMemory = options.getMemory;
  const select = model.select.bind(model), counter = { countTokens: model.countTokens.bind(model) };
  return Object.freeze({ ...model, countTokens: counter.countTokens, async select(request) {
    data(request, ['system', 'input', 'maxOutputTokens', 'signal']);
    const { system, input, maxOutputTokens, signal } = request;
    if (Object.keys(request).length !== 4 || typeof system !== 'string' || !system.isWellFormed()
      || system.length > 24_000 || maxOutputTokens !== 1024 || !(signal instanceof AbortSignal)) fail('invalid_input');
    checkAbort(signal);
    const prepared = prepare(input, readSet);
    const actual = freeze({ system, input: prepared.original, maxOutputTokens });
    if (countTokens(counter, JSON.stringify(actual)) > 6000) fail('context_budget_exceeded');
    checkAbort(signal);
    const raw = await select(Object.freeze({ ...actual, signal }));
    checkAbort(signal);
    const cleanRaw = snapshot(raw, 40_000, 'invalid_model_output');
    const original = prepared.compile(cleanRaw), encoded = JSON.stringify(cleanRaw);
    if (encoded.length > 40_000 || countTokens(counter, encoded) > 1024) fail('invalid_model_output');
    checkAbort(signal);
    if (JSON.stringify(snapshot(raw, 40_000, 'invalid_model_output')) !== encoded) fail('invalid_model_output');
    const cards = [], observations = []; let bytes = 0;
    async function read(ref) {
      checkAbort(signal);
      const response = await getMemory(Object.freeze({ namespace: readSet[ref.namespaceIndex],
        memoryId: ref.memoryId, receiptLimit: 8 }));
      checkAbort(signal);
      return { ref, response: snapshot(response, 65_536, 'revision_conflict') };
    }
    if (original.refs.length) for (const ref of inspectionOrder(original, prepared.visible).slice(0, 24)) {
      const observation = await read(ref), card = inspect(ref, observation.response, readSet);
      observations.push(observation); cards.push(card);
      if (bytes + card.materialBytes > 65_536) break;
      bytes += card.materialBytes;
    }
    const result = assembleSourceDiverseSelection(prepared.original, original, { readSet, inspections: observations });
    const compiled = JSON.stringify(result.output);
    if (compiled.length > 40_000 || countTokens(counter, compiled) > 1024) fail('invalid_model_output');
    checkAbort(signal);
    if (JSON.stringify(snapshot(raw, 40_000, 'invalid_model_output')) !== encoded) fail('invalid_model_output');
    for (const previous of cards) {
      const current = await read(previous.ref);
      if (inspect(previous.ref, current.response, readSet).signature !== previous.signature) fail('revision_conflict');
    }
    checkAbort(signal);
    return result.output;
  } });
}
