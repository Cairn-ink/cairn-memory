import { isDeepStrictEqual, types } from 'node:util';
import { countTokens as measureTokens } from '../../core/model-budget.mjs';
import { fail } from '../../core/validation.mjs';
import { freeze, sha256, snapshotJson } from '../longmemeval/mixed-validation.mjs';
import { packMixedAnswer } from '../longmemeval/mixed-answer.mjs';
import { prepareCardPlanRankRequest, compileCardPlan } from './card-plan-rank.mjs';
import { packCardPlanAnswer } from './card-plan-evidence.mjs';

function fields(value, keys, error) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(error);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length || keys.some(key => !descriptors[key]
    || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value'))) fail(error);
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}

// Reject every proxy before reflection, and every accessor/hook before JSON.
// Limits bound accepted data, not arbitrary caller allocations in this process.
function snapshot(value, error) {
  const active = new WeakSet();
  let nodes = 0;
  const walk = (item, depth = 0) => {
    if (++nodes > 100_000 || depth > 16) fail(error);
    if (!item || typeof item !== 'object') return;
    if (types.isProxy(item) || active.has(item)) fail(error);
    const prototype = Object.getPrototypeOf(item);
    if (Array.isArray(item) ? prototype !== Array.prototype
      : ![Object.prototype, null].includes(prototype)) fail(error);
    active.add(item);
    const descriptors = Object.getOwnPropertyDescriptors(item), keys = Reflect.ownKeys(descriptors);
    if (nodes + keys.length > 100_000) fail(error);
    for (const key of keys) {
      if (typeof key !== 'string' || !Object.hasOwn(descriptors[key], 'value')) fail(error);
      walk(descriptors[key].value, depth + 1);
    }
    active.delete(item);
  };
  walk(value);
  return freeze(snapshotJson(value, { bytes: 4 * 1024 * 1024, nodes: 100_000, depth: 16 }, error));
}

const refKey = ref => JSON.stringify([ref.namespaceIndex, ref.memoryId, ref.revision]);

/** Pure synthetic assembly of a literal first ordinary result; makes no call. */
export function compileOrdinaryCardSelection(request, result, countTokens) {
  // The genuine preparer preserves cancellation and its additional schema's
  // conservative 6000-token bound. Never substitute a fake assembly counter.
  const prepared = prepareCardPlanRankRequest(request, countTokens);
  const clean = snapshot(result, 'invalid_model_output');
  const { refs } = fields(clean, ['refs'], 'invalid_model_output');
  if (!Array.isArray(refs) || refs.length > prepared.originalInput.limit) fail('invalid_model_output');
  const candidates = prepared.originalInput.candidates;
  const selectedCards = [], seen = new Set();
  for (const ref of refs) {
    fields(ref, ['namespaceIndex', 'memoryId', 'revision'], 'invalid_model_output');
    if (!Number.isSafeInteger(ref.namespaceIndex) || ref.namespaceIndex !== 0 || Object.is(ref.namespaceIndex, -0)
      || typeof ref.memoryId !== 'string' || !Number.isSafeInteger(ref.revision)
      || ref.revision < 1) fail('invalid_model_output');
    const key = refKey(ref);
    const matches = candidates.flatMap((card, index) => refKey({ namespaceIndex: card.namespaceIndex,
      memoryId: card.memory.id, revision: card.memory.revision }) === key ? [index] : []);
    if (seen.has(key) || matches.length !== 1) fail('invalid_model_output');
    seen.add(key); selectedCards.push(matches[0]);
  }
  const encoded = JSON.stringify(clean);
  if (encoded.length > 40_000 || measureTokens({ countTokens }, encoded) > 1024) fail('invalid_model_output');
  const compiled = compileCardPlan(prepared, { selectedCards, chains: selectedCards.map((_, slot) => ({
    members: [slot], sources: [{ member: 0, receipt: 0 }], terminal: 0 })) });
  return freeze({ origin: 'ordinary-ref-assembly-v1', compiled,
    ordinaryRefsSha256: sha256(encoded), syntheticAssemblyRequestSha256: prepared.requestSha256 });
}

/** Reuse genuine already-assembled B; one explicitly unverified organization. */
export function packGroupedCardPlanAnswer(options) {
  const { evidence, countTokens } = fields(options, ['evidence', 'countTokens'], 'invalid_card_plan_evidence');
  // This unchanged packer first establishes actual CP evidence ownership and
  // full flat-source fit. A clone is never an assembly capability.
  const flat = packCardPlanAnswer({ evidence, countTokens });
  const units = evidence.units.map((unit, index) => {
    if (index !== 0) return { text: unit.text };
    const card = JSON.parse(unit.text);
    card.unverifiedOrganization = { version: 'card-plan-organization-v1', status: 'unverified',
      indexMeaning: { members: 'selected-card-index', sourceMember: 'chain-member-index',
        receipt: 'receipt-index-within-card', terminal: 'chain-source-index' }, chains: evidence.proposal.chains };
    return { text: JSON.stringify(card) };
  });
  // Independently recover literal flat bytes by removing only the one field.
  for (const [index, unit] of units.entries()) {
    const card = JSON.parse(unit.text);
    if (index === 0) delete card.unverifiedOrganization;
    if (JSON.stringify(card) !== evidence.units[index].text) fail('card_plan_answer_incomplete');
  }
  const packed = units.length ? packMixedAnswer({ question: evidence.question, units, countTokens }) : flat;
  const exactCount = measureTokens({ countTokens }, JSON.stringify(packed.request));
  if (packed.inputTokens !== exactCount || exactCount > 6000 || packed.omittedIndices.length
    || packed.duplicateIndices.length || !isDeepStrictEqual(packed.selectedIndices, units.map((_, index) => index))
    || !isDeepStrictEqual(JSON.parse(packed.request.messages[1].content).evidence, units)) fail('card_plan_answer_incomplete');
  return freeze({ units, packed, projection: 'card-plan-grouped-source-v1', semanticSufficiency: 'unassessed' });
}
