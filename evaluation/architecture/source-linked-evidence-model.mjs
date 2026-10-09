import { countTokens } from '../../core/model-budget.mjs';
import { sourceAddressAnchor, sourceParts } from '../../core/source-addresses.mjs';
import { fail, identifier, revision } from '../../core/validation.mjs';
import { freeze, snapshotJson } from '../longmemeval/mixed-validation.mjs';

const key = ref => JSON.stringify([ref.namespaceIndex, ref.memoryId, ref.revision]);
const refOf = candidate => ({ namespaceIndex: candidate.namespaceIndex,
  memoryId: candidate.memory.id, revision: candidate.memory.revision });
const checkAbort = signal => {
  if (signal.aborted) throw new DOMException('Source-linked assembly cancelled', 'AbortError');
};
function fields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('invalid_input');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some(name => typeof name !== 'string'
    || !descriptors[name].enumerable || !Object.hasOwn(descriptors[name], 'value'))) fail('invalid_input');
  return descriptors;
}
function snapshot(value, code = 'invalid_input') {
  // Reuse the existing descriptor-safe JSON snapshot; restore ordinary JSON
  // prototypes so the detached request preserves the adapter's original shape.
  try {
    return freeze(JSON.parse(JSON.stringify(snapshotJson(value,
      { bytes: 3 * 1024 * 1024, nodes: 100_000, depth: 32 }, code))));
  } catch { fail(code); } // Keep typed core errors across the model-call seam.
}
function inputSnapshot(value) {
  const input = snapshot(value);
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).length !== 3 || !['query', 'limit', 'candidates'].every(name => Object.hasOwn(input, name))
    || typeof input.query !== 'string' || !input.query.trim() || input.query.length > 4000
    || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 12
    || !Array.isArray(input.candidates) || input.candidates.length > 36) fail('invalid_input');
  const seen = new Set();
  for (const candidate of input.candidates) {
    try {
      if (!Number.isSafeInteger(candidate.namespaceIndex) || candidate.namespaceIndex < 0) fail('invalid_input');
      identifier(candidate.memory.id); revision(candidate.memory.revision);
      const identity = JSON.stringify([candidate.namespaceIndex, candidate.memory.id]);
      if (seen.has(identity)) fail('invalid_input');
      seen.add(identity);
      if (!Array.isArray(candidate.receipts) || candidate.receipts.length < 1 || candidate.receipts.length > 100) fail('invalid_input');
      const receipts = new Set();
      for (const receipt of candidate.receipts) {
        identifier(receipt.id);
        if (receipts.has(receipt.id) || !['user', 'assistant'].includes(receipt.role)
          || typeof receipt.excerpt !== 'string' || !receipt.excerpt.trim() || receipt.excerpt.length > 800) fail('invalid_input');
        receipts.add(receipt.id);
      }
    } catch { fail('invalid_input'); }
  }
  return input;
}
function outputSnapshot(value, input) {
  const output = snapshot(value, 'invalid_model_output');
  const allowed = new Set(input.candidates.map(candidate => key(refOf(candidate)))), seen = new Set();
  try {
    if (Object.keys(output).length !== 1 || !Array.isArray(output.refs) || output.refs.length > input.limit) fail('invalid_model_output');
    for (const ref of output.refs) {
      if (Object.keys(ref).length !== 3 || !['namespaceIndex', 'memoryId', 'revision'].every(name => Object.hasOwn(ref, name))
        || !Number.isSafeInteger(ref.namespaceIndex) || ref.namespaceIndex < 0) fail('invalid_model_output');
      identifier(ref.memoryId); revision(ref.revision);
      if (!allowed.has(key(ref)) || seen.has(key(ref))) fail('invalid_model_output');
      seen.add(key(ref));
    }
  } catch { fail('invalid_model_output'); }
  return output;
}

// Whole case-sensitive tokens: 1–8 ASCII letters, optional single ASCII '-',
// 1–8 ASCII digits. Unicode word/hyphen neighbors block substring matches.
// Calendar-prefix classification is case-insensitive; link identity is not.
const literal = /(?<![\p{L}\p{M}\p{N}_-])[A-Za-z]{1,8}-?[0-9]{1,8}(?![\p{L}\p{M}\p{N}_-])/gu;
const calendar = /^(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|t|z|utc|gmt)-?[0-9]+$/iu;

function cardAnchors(candidate) {
  const found = new Map();
  for (const receipt of candidate.receipts) {
    const boundaries = new Map([[0, 0]]); let offset = 0;
    for (const part of sourceParts(receipt.excerpt)) {
      offset += part.text.length; boundaries.set(offset, part.index + 1);
    }
    for (const match of receipt.excerpt.matchAll(literal)) {
      if (calendar.test(match[0]) || found.has(match[0])) continue;
      const startPart = boundaries.get(match.index), endPart = boundaries.get(match.index + match[0].length);
      if (startPart === undefined || endPart === undefined) continue;
      const anchor = sourceAddressAnchor({ startPart, endPart }, receipt.excerpt);
      found.set(match[0], { ...refOf(candidate), receiptId: receipt.id,
        start: anchor.start, end: anchor.end });
    }
  }
  return found;
}
function assemble(input, ranked) {
  const candidates = input.candidates, refs = candidates.map(refOf);
  const index = new Map(refs.map((ref, position) => [key(ref), position]));
  const occurrences = new Map();
  candidates.forEach((candidate, position) => {
    for (const [text, anchor] of cardAnchors(candidate)) {
      const identity = JSON.stringify([candidate.namespaceIndex, text]);
      if (!occurrences.has(identity)) occurrences.set(identity, { identifier: text,
        namespaceIndex: candidate.namespaceIndex, cards: [] });
      occurrences.get(identity).cards.push({ position, anchor });
    }
  });
  const neighbors = candidates.map(() => new Set()), links = [], ambiguousIdentifiers = [];
  for (const occurrence of occurrences.values()) {
    if (occurrence.cards.length > 2) {
      ambiguousIdentifiers.push({ namespaceIndex: occurrence.namespaceIndex,
        identifier: occurrence.identifier, cardCount: occurrence.cards.length });
    } else if (occurrence.cards.length === 2) {
      const [from, to] = occurrence.cards;
      neighbors[from.position].add(to.position); neighbors[to.position].add(from.position);
      links.push({ identifier: occurrence.identifier, from: from.anchor, to: to.anchor });
    }
  }
  const componentByCard = new Map(), components = [];
  for (let start = 0; start < candidates.length; start++) {
    if (componentByCard.has(start)) continue;
    const positions = [], pending = [start], seen = new Set([start]);
    while (pending.length) {
      const position = pending.pop(); positions.push(position);
      for (const next of neighbors[position]) if (!seen.has(next)) { seen.add(next); pending.push(next); }
    }
    positions.sort((a, b) => a - b);
    for (const position of positions) componentByCard.set(position, positions);
    if (positions.length > 1) components.push({ refs: positions.map(position => refs[position]),
      expandable: positions.length <= 3 });
  }
  const selected = [], selectedIndices = new Set(), skippedExpansions = [];
  for (const seed of ranked.refs) {
    const position = index.get(key(seed));
    if (selectedIndices.has(position)) continue;
    const component = componentByCard.get(position);
    const additions = component.filter(member => !selectedIndices.has(member));
    if (component.length <= 3 && additions.length <= input.limit - selected.length) {
      for (const member of [position, ...additions.filter(member => member !== position)]) {
        selectedIndices.add(member); selected.push(refs[member]);
      }
    } else {
      if (component.length > 1) skippedExpansions.push({ seed,
        componentSize: component.length,
        reason: component.length > 3 ? 'component_too_large' : 'insufficient_capacity' });
      if (selected.length < input.limit) { selectedIndices.add(position); selected.push(refs[position]); }
    }
  }
  return freeze({ output: { refs: selected }, diagnostics: {
    strategy: 'bounded-literal-source-sets-v1', semanticCoverage: 'unassessed',
    links, components, ambiguousIdentifiers, skippedExpansions,
    displacedSeeds: ranked.refs.filter(seed => !selectedIndices.has(index.get(key(seed)))) } });
}

/** Pure evaluator-free compiler: (original rank input, original { refs }) ->
 * immutable { output: { refs }, diagnostics }. No model, database or token port.
 * Links preserve the first exact receipt occurrence per identifier/card and
 * are navigation suggestions, not semantic identity or evidence sufficiency.
 */
export function assembleSourceLinkedEvidence(input, rankOutput) {
  const clean = inputSnapshot(input);
  return assemble(clean, outputSnapshot(rankOutput, clean));
}

function assembleSeedGated(input, ranked) {
  const candidates = input.candidates, seeds = new Set(ranked.refs.map(key));
  let reason = null;
  if (!ranked.refs.length) reason = 'empty_rank';
  else if (new Set(candidates.map(candidate => candidate.namespaceIndex)).size !== 1) reason = 'mixed_namespaces';
  else if (candidates.length > 6) reason = 'preservation_cap_exceeded';
  else if (candidates.length > input.limit) reason = 'pool_exceeds_limit';
  const linked = reason && reason !== 'empty_rank' ? assemble(input, ranked) : null;
  const output = linked ? linked.output : { refs: reason === 'empty_rank' ? []
    : [...ranked.refs, ...candidates.map(refOf).filter(ref => !seeds.has(key(ref)))] };
  return freeze({ output, diagnostics: {
    strategy: 'seed-gated-small-source-set-v1', applied: reason === null,
    reason: reason ?? 'eligible_small_pool', semanticCoverage: 'unassessed', relevance: 'unassessed',
    addedRefs: output.refs.filter(ref => !seeds.has(key(ref))),
    linkedFallback: linked?.diagnostics ?? null } });
}

/** Preserve only the complete supplied rank-visible small pool after a nonempty
 * validated seed. This is not closure over upstream selected or stored sources,
 * a relevance assessment, or an assertion that siblings support the query.
 */
export function assembleSeedGatedSourceSet(input, rankOutput) {
  const clean = inputSnapshot(input);
  return assembleSeedGated(clean, outputSnapshot(rankOutput, clean));
}

function createEvidenceSetModel(model, compiler) {
  if (!model || typeof model !== 'object') fail('model_not_configured');
  const descriptors = fields(model);
  if (typeof descriptors.rank?.value !== 'function') fail('model_not_configured');
  if (typeof descriptors.countTokens?.value !== 'function') fail('token_count_unavailable');
  if (!Number.isSafeInteger(descriptors.contextWindow?.value) || descriptors.contextWindow.value < 8192) fail('context_budget_exceeded');
  const rank = descriptors.rank.value.bind(model);
  const counter = Object.freeze({ countTokens: descriptors.countTokens.value.bind(model) });
  const ports = Object.fromEntries(Object.entries(descriptors).map(([name, descriptor]) => [name, descriptor.value]));
  return Object.freeze({ ...ports, countTokens: counter.countTokens, async rank(request) {
    const shell = fields(request);
    if (Object.keys(shell).length !== 4 || !['system', 'input', 'maxOutputTokens', 'signal'].every(name => Object.hasOwn(shell, name))) fail('invalid_input');
    const { system: { value: system }, input: { value: input },
      maxOutputTokens: { value: maximum }, signal: { value: signal } } = shell;
    if (typeof system !== 'string' || !system.isWellFormed() || system.length > 24000
      || maximum !== 1024 || !(signal instanceof AbortSignal)) fail('invalid_input');
    checkAbort(signal);
    const clean = inputSnapshot(input);
    const actual = Object.freeze({ system, input: clean, maxOutputTokens: maximum, signal });
    if (countTokens(counter, JSON.stringify({ system, input: clean, maxOutputTokens: maximum })) > 6000) fail('context_budget_exceeded');
    checkAbort(signal);
    const raw = await rank(actual);
    checkAbort(signal);
    const ranked = outputSnapshot(raw, clean), encoded = JSON.stringify(ranked);
    if (encoded.length > 40000 || countTokens(counter, encoded) > 1024) fail('invalid_model_output');
    checkAbort(signal);
    if (JSON.stringify(outputSnapshot(raw, clean)) !== encoded) fail('invalid_model_output');
    const output = compiler(clean, ranked).output, compiled = JSON.stringify(output);
    if (compiled.length > 40000 || countTokens(counter, compiled) > 1024) fail('invalid_model_output');
    checkAbort(signal);
    if (JSON.stringify(outputSnapshot(raw, clean)) !== encoded) fail('invalid_model_output');
    return output;
  } });
}

/** Evaluation only: one unchanged rank call, then bounded source-set assembly.
 * The shared core retains allowed-reference validation and final freshness.
 */
export function createSourceLinkedEvidenceModel(model) {
  return createEvidenceSetModel(model, assemble);
}

/** Opt-in offline candidate; no extra calls, larger budgets or trusted roles. */
export function createSeedGatedSourceSetModel(model) {
  return createEvidenceSetModel(model, assembleSeedGated);
}
