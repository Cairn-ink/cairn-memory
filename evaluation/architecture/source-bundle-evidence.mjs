import { isDeepStrictEqual } from 'node:util';
import { countTokens } from '../../core/model-budget.mjs';
import { fail } from '../../core/validation.mjs';
import { verifiedRoleEvidence } from '../longmemeval/mixed-evidence.mjs';
import { packMixedAnswer } from '../longmemeval/mixed-answer.mjs';
import { canonical, freeze, snapshotJson } from '../longmemeval/mixed-validation.mjs';
import { consumeBundlePlan } from './source-bundle-rank.mjs';

const key = ref => JSON.stringify([ref.namespaceIndex, ref.memoryId, ref.revision]);
const snapshot = value => snapshotJson(value,
  { bytes: 8 * 1024 * 1024, nodes: 200_000, depth: 24 }, 'invalid_bundle_evidence');
const same = (a, b) => canonical(a) === canonical(b);
const assembled = new WeakSet();
function fields(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('invalid_bundle_evidence');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length || keys.some(key => !descriptors[key]
    || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value'))) fail('invalid_bundle_evidence');
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}

/** Caller supplies the actual successful core envelope, actual core and ingestion plan. */
export function assembleSourceBundleEvidence(options) {
  const { sidecar, recall, core, plan, namespace, question } = fields(options,
    ['sidecar', 'recall', 'core', 'plan', 'namespace', 'question']);
  const owned = consumeBundlePlan(sidecar), returned = snapshot(recall);
  const cleanPlan = snapshot(plan), cleanNamespace = snapshot(namespace), cleanQuestion = snapshot(question);
  if (returned.ok !== true || !returned.value || !Array.isArray(returned.value.memories)
    || owned.originalInput.query !== cleanPlan.mem0Input?.query
    || !same(cleanQuestion, { text: cleanPlan.originalQuestion?.text, date: cleanPlan.canonicalQuestionDate })
    || !same(cleanNamespace, cleanPlan.cairnPlan?.batches[0]?.captureInput.namespace)
    || typeof core?.get !== 'function') fail('invalid_bundle_evidence');
  const memories = returned.value.memories;
  if (memories.length !== owned.refs.length || memories.length > 6
    || !same(returned.value.namespaces?.map(row => row.namespace), [cleanNamespace])) fail('invalid_bundle_evidence');
  for (const [index, item] of memories.entries()) {
    const candidate = owned.originalInput.candidates.find(candidate => key({ namespaceIndex: candidate.namespaceIndex,
      memoryId: candidate.memory.id, revision: candidate.memory.revision }) === key(owned.refs[index]));
    if (!candidate || !same(item, Object.fromEntries(Object.entries(candidate).filter(([name]) => name !== 'namespaceIndex')))) {
      fail('invalid_bundle_evidence');
    }
  }
  // This unchanged verifier independently rereads every full receipt through core.get
  // and binds submitted roles/excerpts to prepared original source/window coordinates.
  const verified = verifiedRoleEvidence(returned.value, input => core.get(input), cleanPlan, cleanNamespace);
  const cards = new Map(memories.map(item => [item.memory.id, {
    memoryId: item.memory.id, revision: item.memory.revision,
    sources: item.receipts.map(source => ({ receiptId: source.id, recordedRole: source.role, text: source.excerpt })),
  }]));
  const catalog = owned.request.input.catalog;
  const declaration = source => Object.fromEntries(Object.entries(source).filter(([name]) => name !== 'excerpt'));
  const units = owned.proposal.bundles.map(bundle => {
    const cardIds = [...new Set(bundle.sourceIndices.map(index => catalog[index].memoryId))];
    return { text: JSON.stringify({ format: 'query-local-source-bundle-evidence-v1',
      organization: 'unverified-not-identity-truth-or-execution-authority',
      declaredSources: bundle.sourceIndices.map(index => declaration(catalog[index])),
      terminalSource: declaration(catalog[bundle.terminalSourceIndex]), cards: cardIds.map(id => cards.get(id)) }) };
  });
  const evidence = freeze({ units, provenance: verified.provenance, verifiedUnits: verified.units, refs: owned.refs,
    query: owned.originalInput.query, question: cleanQuestion, requestSha256: owned.requestSha256,
    proposal: owned.proposal, semanticSufficiency: 'unassessed' });
  assembled.add(evidence);
  return evidence;
}

/** Fail rather than silently delivering a terminal-only or partially packed bundle. */
export function packSourceBundleAnswer(options) {
  const { evidence, countTokens: counter } = fields(options, ['evidence', 'countTokens']);
  if (!assembled.has(evidence)) fail('invalid_bundle_evidence');
  const clean = snapshot(evidence);
  if (!Array.isArray(clean.units) || clean.units.length > 6 || !Array.isArray(clean.refs)
    || clean.refs.length > 6 || new Set(clean.refs.map(key)).size !== clean.refs.length) fail('invalid_bundle_evidence');
  // Overlapping bundles would repeat full passages in model context. Fail visibly
  // rather than remove a prerequisite or silently deduplicate a declared bundle.
  const cardIds = clean.units.flatMap(unit => JSON.parse(unit.text).cards.map(card => card.memoryId));
  if (new Set(cardIds).size !== cardIds.length) fail('bundle_answer_incomplete');
  const packed = packMixedAnswer({ question: clean.question, units: clean.units, countTokens: counter });
  // Packer retains its unchanged 123000 context ceiling. This experiment independently
  // imposes 6000 on the complete actual answer request and requires every whole unit.
  if (packed.inputTokens > 6000 || countTokens({ countTokens: counter }, JSON.stringify(packed.request)) > 6000
    || packed.omittedIndices.length || packed.duplicateIndices.length
    || packed.selectedIndices.length !== clean.units.length
    || !isDeepStrictEqual(JSON.parse(packed.request.messages[1].content).evidence,
      clean.units.map(unit => ({ text: unit.text })))) fail('bundle_answer_incomplete');
  return packed;
}
