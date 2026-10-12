import { isDeepStrictEqual, types } from 'node:util';
import { countTokens } from '../../core/model-budget.mjs';
import { fail } from '../../core/validation.mjs';
import { redactSecrets } from '../../plugins/cairn-memory/lib/redact.mjs';
import { verifiedRoleEvidence } from '../longmemeval/mixed-evidence.mjs';
import { packMixedAnswer } from '../longmemeval/mixed-answer.mjs';
import { canonical, freeze, snapshotJson } from '../longmemeval/mixed-validation.mjs';
import { consumeCardPlan } from './card-plan-rank.mjs';

const error = 'invalid_card_plan_evidence', assembled = new WeakSet();
const same = (a, b) => canonical(a) === canonical(b);
const key = ref => JSON.stringify([ref.namespaceIndex, ref.memoryId, ref.revision]);
function fields(value, keys) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(error);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length || keys.some(key => !descriptors[key]
    || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value'))) fail(error);
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}
function snapshot(value) {
  const active = new WeakSet();
  let nodes = 0;
  const walk = (item, depth = 0) => {
    if (++nodes > 200_000 || depth > 24) fail(error);
    if (!item || typeof item !== 'object') return;
    if (types.isProxy(item) || active.has(item)) fail(error);
    active.add(item);
    const prototype = Object.getPrototypeOf(item);
    if (Array.isArray(item) ? prototype !== Array.prototype
      : prototype !== Object.prototype && prototype !== null) fail(error);
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(item))) {
      if (!Object.hasOwn(descriptor, 'value')) fail(error);
      walk(descriptor.value, depth + 1);
    }
    active.delete(item);
  };
  walk(value);
  return snapshotJson(value, { bytes: 8 * 1024 * 1024, nodes: 200_000, depth: 24 }, error);
}
function questionQuery(question) {
  if (typeof question?.text !== 'string' || typeof question?.date !== 'string') fail(error);
  return redactSecrets(JSON.stringify({ question: question.text, date: question.date }).normalize('NFKC'))
    .replace(/\s+/gu, ' ').trim();
}

/** Consume before all evidence checks; use only actual core.get authoritative receipts. */
export function assembleCardPlanEvidence(options) {
  const { compiled, recall, core, plan, namespace, question } = fields(options,
    ['compiled', 'recall', 'core', 'plan', 'namespace', 'question']);
  const owned = consumeCardPlan(compiled);
  const returned = snapshot(recall), cleanPlan = snapshot(plan), cleanNamespace = snapshot(namespace),
    cleanQuestion = snapshot(question);
  if (!core || typeof core !== 'object' || types.isProxy(core)) fail(error);
  const get = Object.getOwnPropertyDescriptor(core, 'get');
  if (!get || !Object.hasOwn(get, 'value') || typeof get.value !== 'function'
    || returned.ok !== true || !returned.value || !Array.isArray(returned.value.memories)
    || owned.originalInput.query !== cleanPlan.mem0Input?.query
    || !same(cleanQuestion, { text: cleanPlan.originalQuestion?.text, date: cleanPlan.canonicalQuestionDate })
    || owned.originalInput.query !== questionQuery(cleanQuestion)
    || !Array.isArray(cleanPlan.cairnPlan?.batches) || !cleanPlan.cairnPlan.batches.length
    || cleanPlan.cairnPlan.batches.some(batch => !same(cleanNamespace, batch.captureInput?.namespace))) fail(error);
  const memories = returned.value.memories;
  if (memories.length !== owned.refs.length || memories.length > 6
    || !same(returned.value.namespaces?.map(row => row.namespace), [cleanNamespace])) fail(error);
  for (const [index, item] of memories.entries()) {
    const candidate = owned.originalInput.candidates[owned.proposal.selectedCards[index]];
    if (!candidate || key(owned.refs[index]) !== key({ namespaceIndex: candidate.namespaceIndex,
      memoryId: candidate.memory.id, revision: candidate.memory.revision })
      || !same(item, Object.fromEntries(Object.entries(candidate).filter(([name]) => name !== 'namespaceIndex')))) fail(error);
  }
  // The existing verifier rereads full receipts, roles and source/window bindings
  // through the supplied actual core; its 384-total/100-card caps are unchanged.
  const verified = verifiedRoleEvidence(returned.value, input => get.value.call(core, input), cleanPlan, cleanNamespace);
  const units = memories.map(item => ({ text: JSON.stringify({ format: 'card-plan-flat-source-evidence-v1',
    memoryId: item.memory.id, revision: item.memory.revision,
    sources: item.receipts.map(source => ({ receiptId: source.id, recordedRole: source.role, text: source.excerpt })) }) }));
  const evidence = freeze({ units, refs: owned.refs, provenance: verified.provenance,
    question: cleanQuestion, query: owned.originalInput.query, requestSha256: owned.requestSha256,
    proposal: owned.proposal, semanticSufficiency: 'unassessed' });
  assembled.add(evidence);
  return evidence;
}

/** Flat whole-card answer projection with unchanged answer instruction/model/cap. */
export function packCardPlanAnswer(options) {
  const { evidence, countTokens: counter } = fields(options, ['evidence', 'countTokens']);
  if (!assembled.has(evidence)) fail(error);
  const clean = snapshot(evidence);
  if (!Array.isArray(clean.units) || clean.units.length > 6 || !Array.isArray(clean.refs)
    || clean.refs.length > 6 || clean.units.length !== clean.refs.length
    || new Set(clean.refs.map(key)).size !== clean.refs.length) fail(error);
  const cards = clean.units.map(unit => JSON.parse(unit.text));
  if (cards.some((card, index) => card.memoryId !== clean.refs[index].memoryId
    || card.revision !== clean.refs[index].revision || !Array.isArray(card.sources) || !card.sources.length)
    || new Set(cards.flatMap(card => card.sources.map(source => source.receiptId))).size
      !== cards.reduce((sum, card) => sum + card.sources.length, 0)) fail(error);
  const packed = packMixedAnswer({ question: clean.question, units: clean.units, countTokens: counter });
  if (packed.inputTokens > 6000 || countTokens({ countTokens: counter }, JSON.stringify(packed.request)) > 6000
    || packed.omittedIndices.length || packed.duplicateIndices.length
    || !isDeepStrictEqual(packed.selectedIndices, clean.units.map((_, index) => index))
    || !isDeepStrictEqual(JSON.parse(packed.request.messages[1].content).evidence,
      clean.units.map(unit => ({ text: unit.text })))) fail('card_plan_answer_incomplete');
  return packed;
}
