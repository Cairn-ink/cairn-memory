import { countTokens } from '../../../core/model-budget.mjs';
import { fail, identifier, revision } from '../../../core/validation.mjs';
import { freeze, snapshotJson } from '../../longmemeval/mixed-validation.mjs';

// The frozen source-linked seam keeps its helpers private. These guards and the
// factory below preserve that exact seam without changing shared code.
const key = ref => JSON.stringify([ref.namespaceIndex, ref.memoryId, ref.revision]);
const refOf = candidate => ({ namespaceIndex: candidate.namespaceIndex,
  memoryId: candidate.memory.id, revision: candidate.memory.revision });
const checkAbort = signal => {
  if (signal.aborted) throw new DOMException('Complementary assembly cancelled', 'AbortError');
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
  try {
    return freeze(JSON.parse(JSON.stringify(snapshotJson(value,
      { bytes: 3 * 1024 * 1024, nodes: 100_000, depth: 32 }, code))));
  } catch { fail(code); }
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

// Lexical navigation only. No generated memory content, timestamps, IDs, roles
// or evaluator labels influence scoring. Lowercasing is intentionally lexical,
// and can conflate distinct names/codes; diagnostics never assert identity.
const stop = new Set('about after again also and are before been being can could did does for from had has have here how into its may might more not now our should some than that the their them then there these they this those through uses using was were what when where which who why will with would you your'.split(' '));
const codeToken = /^[a-z]{1,8}-?[0-9]{1,8}$/u;
const calendarToken = /^(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|t|z|utc|gmt)-?[0-9]+$/u;
function terms(text) {
  return new Set((text.toLowerCase().match(/[\p{L}\p{M}\p{N}_]+(?:-[\p{L}\p{M}\p{N}_]+)*/gu) ?? [])
    .filter(term => !stop.has(term) && !calendarToken.test(term)
      && (codeToken.test(term) || term.length >= 4 && /\p{L}/u.test(term))));
}
function assemble(input, ranked) {
  const refs = input.candidates.map(refOf), selected = [...ranked.refs];
  const seedKeys = new Set(selected.map(key)), chosen = new Set(seedKeys);
  const seededNamespaces = new Set(selected.map(ref => ref.namespaceIndex));
  const eligible = input.candidates.map((card, index) => ({ card, index }))
    .filter(({ card }) => seededNamespaces.has(card.namespaceIndex));
  const additions = [], paths = [];
  let reason = !selected.length ? 'empty_rank' : selected.length === input.limit ? 'limit_exhausted' : 'lexical_bridges';
  if (selected.length && selected.length < input.limit) {
    if (input.candidates.length <= 6 && eligible.length <= input.limit) {
      reason = 'complete_small_seeded_pool';
      for (const { index } of eligible) if (!chosen.has(key(refs[index]))) {
        chosen.add(key(refs[index])); selected.push(refs[index]); additions.push(refs[index]);
      }
    } else {
      const query = terms(input.query), documents = input.candidates.map(card =>
        terms(card.receipts.map(receipt => receipt.excerpt).join('\n')));
      const frequency = new Map(), sizes = new Map();
      for (const { card, index } of eligible) {
        sizes.set(card.namespaceIndex, (sizes.get(card.namespaceIndex) ?? 0) + 1);
        for (const term of documents[index]) {
          const identity = JSON.stringify([card.namespaceIndex, term]);
          frequency.set(identity, (frequency.get(identity) ?? 0) + 1);
        }
      }
      const depths = new Map(eligible.filter(({ index }) => chosen.has(key(refs[index]))).map(({ index }) => [index, 0]));
      while (selected.length < input.limit) {
        let best = null;
        for (const { card, index } of eligible) {
          if (chosen.has(key(refs[index]))) continue;
          for (const [parent, depth] of depths) {
            if (depth >= 2 || card.namespaceIndex !== input.candidates[parent].namespaceIndex) continue;
            const size = sizes.get(card.namespaceIndex), cap = Math.max(3, Math.floor(size / 4));
            const shared = [...documents[index]].filter(term => documents[parent].has(term)
              && frequency.get(JSON.stringify([card.namespaceIndex, term])) <= cap);
            if (shared.length < 2 && !shared.some(term => codeToken.test(term) || term.length >= 5 && !query.has(term))) continue;
            const weight = shared.reduce((sum, term) => sum + Math.log2(1 + size /
              frequency.get(JSON.stringify([card.namespaceIndex, term]))), 0);
            const queryOverlap = [...documents[index]].filter(term => query.has(term)).length;
            const score = weight + queryOverlap * 0.25 - depth * 0.5;
            if (!best || score > best.score || score === best.score && index < best.index) {
              best = { index, parent, depth: depth + 1, score, shared };
            }
          }
        }
        if (!best) break;
        chosen.add(key(refs[best.index])); depths.set(best.index, best.depth);
        selected.push(refs[best.index]); additions.push(refs[best.index]);
        paths.push({ ref: refs[best.index], via: refs[best.parent], hops: best.depth, sharedTerms: best.shared });
      }
    }
  }
  return freeze({ output: { refs: selected }, diagnostics: {
    strategy: 'seed-preserving-rare-lexical-bridges-v1', reason,
    addedRefs: additions, paths, semanticCoverage: 'unassessed' } });
}

/** Pure, source-only navigation compiler. Original validated seeds are always
 * the ordered prefix; additions never leave their seeded namespaces. */
export function assembleComplementarySourceSet(input, rankOutput) {
  const clean = inputSnapshot(input);
  return assemble(clean, outputSnapshot(rankOutput, clean));
}

/** Opt-in offline experiment. The original model is called once with the exact
 * source-only request; original token/structure/cancellation guards remain. */
export function createComplementarySourceSetModel(model) {
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
    const output = assemble(clean, ranked).output, compiled = JSON.stringify(output);
    if (compiled.length > 40000 || countTokens(counter, compiled) > 1024) fail('invalid_model_output');
    checkAbort(signal);
    if (JSON.stringify(outputSnapshot(raw, clean)) !== encoded) fail('invalid_model_output');
    return output;
  } });
}
