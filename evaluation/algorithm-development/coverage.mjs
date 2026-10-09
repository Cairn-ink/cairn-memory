import { isDeepStrictEqual } from 'node:util';
import { redactSecrets } from '../../plugins/cairn-memory/lib/redact.mjs';
import { verifiedEvidence } from '../longmemeval/mixed-evidence.mjs';
import { prepareAlgorithmDevelopmentCase } from './runner.mjs';
import { validateEvaluatorRubric } from './corpus.mjs';

// Evaluator-only literal exposure metric; neither presence nor normalization proves semantic support.
export const REQUIRED_ANCHOR_DENOMINATOR = 42;
const STAGES = ['capture-retained', 'candidate-reachable', 'selected', 'recalled', 'packed'];
const ARMS = ['baseline', 'full'];
const normalize = text => redactSecrets(text.normalize('NFKC')).replace(/\s+/gu, ' ').trim();
const empty = () => ({ denominator: REQUIRED_ANCHOR_DENOMINATOR, present: 0, absent: 0, unknown: 0, 'not-run': 0 });
const stage = (entries = [], complete = false, started = false) => ({ entries, complete, started });

function entriesFromEvidence(recall, details, plan, namespace) {
  const byId = new Map(details.map(detail => [detail.memory?.id, detail]));
  if (byId.size !== details.length) throw new TypeError('duplicate captured memory id');
  const evidence = verifiedEvidence(recall, ({ memoryId }) => ({ ok: byId.has(memoryId), value: byId.get(memoryId) }), plan, namespace);
  const entries = evidence.provenance.map(item => {
    const detail = byId.get(item.memoryId), receipt = detail.receipts.find(candidate => candidate.id === item.receiptId);
    return { memoryId: item.memoryId, revision: detail.memory.revision, text: receipt.excerpt, coordinates: item.coordinates };
  });
  return { entries, evidence };
}

function capturedEntries(details, plan, namespace) {
  const entries = [], ids = new Set(); let valid = true;
  for (const detail of details) {
    if (ids.has(detail.memory?.id)) { valid = false; continue; }
    ids.add(detail.memory?.id);
    const recall = { memories: [{ memory: { id: detail.memory?.id, revision: detail.memory?.revision, currentness: 'current' },
      receipts: detail.receipts, receiptCount: detail.receipts?.length, interpretationStatus: 'omitted', sourceSelectionCoverage: 'unassessed' }] };
    try { entries.push(...entriesFromEvidence(recall, [detail], plan, namespace).entries); } catch { valid = false; }
  }
  return { entries, valid };
}

function navigation(call, selected) {
  if (selected) return (call.output?.refs ?? []).filter(ref => navigation(call, false).some(candidate =>
    candidate.namespaceIndex === ref.namespaceIndex && candidate.memoryId === ref.memoryId && candidate.revision === ref.revision));
  return (call.input?.maps ?? []).flatMap(map => (map.items ?? []).flatMap(item => {
    if (item.type === 'unfiled') return [{ namespaceIndex: map.namespaceIndex, ...item.ref }];
    if (item.type === 'ref' && item.ref?.childType === 'memory') return [{ namespaceIndex: map.namespaceIndex,
      memoryId: item.ref.childId, revision: item.ref.childRevision }];
    return [];
  }));
}

function armStages(arm, capture, details, captured, plan, namespace) {
  const result = { 'capture-retained': capture };
  const calls = (arm?.modelCalls ?? []).filter(call => call.method === 'select');
  for (const [name, selected] of [['candidate-reachable', false], ['selected', true]]) {
    const references = calls.flatMap(call => navigation(call, selected));
    const entries = captured.entries.filter(entry => references.some(ref => ref.namespaceIndex === 0 &&
      ref.memoryId === entry.memoryId && ref.revision === entry.revision));
    result[name] = stage(entries, captured.valid && calls.length > 0 && calls.every(call => call.output && !call.failure), calls.length > 0);
  }
  let verified = null;
  try { if (arm?.recalled) verified = entriesFromEvidence(arm.recalled, details, plan, namespace); } catch { /* unknown binding earns no credit */ }
  result.recalled = stage(verified?.entries ?? [], Boolean(verified), Boolean(arm?.recalled || calls.length));
  const packed = arm?.packed;
  let chosen = null;
  try {
    if (verified && packed && isDeepStrictEqual(arm.evidence, verified.evidence)) {
      const indices = packed.selectedIndices;
      const messages = packed.request?.messages;
      if (!Array.isArray(indices) || new Set(indices).size !== indices.length || indices.some(index =>
        !Number.isSafeInteger(index) || index < 0 || index >= verified.evidence.units.length) ||
        !Array.isArray(messages) || messages.length !== 2 || messages[0].role !== 'system' || messages[1].role !== 'user') throw new TypeError('invalid packed evidence');
      const actual = JSON.parse(messages[1].content).evidence;
      const expected = indices.map(index => verified.evidence.units[index]);
      if (!isDeepStrictEqual(actual, expected)) throw new TypeError('packed evidence differs from selected verified units');
      const ids = new Set(indices.map(index => arm.recalled.memories[index].memory.id));
      chosen = verified.entries.filter(entry => ids.has(entry.memoryId));
    }
  } catch { /* malformed, omitted or unverified provenance is unavailable */ }
  result.packed = stage(chosen ?? [], chosen !== null, Boolean(packed || arm?.evidence || arm?.recalled));
  return result;
}

function statusFor(anchor, source, observed) {
  const sessionIndex = source.sessions.findIndex(session => session.id === anchor.sessionId);
  const needle = normalize(anchor.text);
  const present = observed.entries.some(entry => entry.coordinates.some(coordinate =>
    coordinate.originalSessionIndex === sessionIndex && coordinate.originalTurnIndex === anchor.messageIndex) && normalize(entry.text).includes(needle));
  return present ? 'present' : observed.complete ? 'absent' : observed.started ? 'unknown' : 'not-run';
}

export function scoreDevelopmentCoverage({ observations, modelInputs, evaluatorRubric }) {
  validateEvaluatorRubric(evaluatorRubric, modelInputs);
  if (!Array.isArray(observations) || observations.length > 24) throw new TypeError('invalid coverage observations');
  const anchorCount = Object.values(evaluatorRubric.cases).reduce((total, rule) => total + rule.anchors.length, 0);
  if (anchorCount !== REQUIRED_ANCHOR_DENOMINATOR) throw new TypeError('required-anchor denominator changed');
  const known = new Map(modelInputs.map(item => [item.id, item]));
  const byId = new Map();
  for (const observation of observations) {
    if (!observation || !known.has(observation.id) || byId.has(observation.id) || observation.family !== known.get(observation.id).family) throw new TypeError('unknown, duplicate or mismatched coverage case');
    byId.set(observation.id, observation);
  }
  const aggregates = Object.fromEntries(ARMS.map(arm => [arm, Object.fromEntries(STAGES.map(name => [name, empty()]))]));
  const cases = [];
  for (const source of modelInputs) {
    const observation = byId.get(source.id), { plan, namespace } = prepareAlgorithmDevelopmentCase(source);
    const details = observation?.capture?.receipts ?? [];
    let captured = { entries: [], valid: false };
    try { captured = capturedEntries(details, plan, namespace); } catch { /* unavailable source binding */ }
    const captureStarted = Boolean(observation?.capture?.inputs?.length || observation?.capture?.outcomes?.length || details.length || observation?.capture?.status === 'completed');
    const capture = stage(captured.entries, captured.valid && observation?.capture?.status === 'completed', captureStarted);
    const armResults = Object.fromEntries(ARMS.map(arm => [arm, armStages(observation?.arms?.[arm], capture, details, captured, plan, namespace)]));
    const anchors = evaluatorRubric.cases[source.id].anchors.map((anchor, index) => {
      const statuses = Object.fromEntries(ARMS.map(arm => [arm, Object.fromEntries(STAGES.map(name => {
        const status = statusFor(anchor, source, armResults[arm][name]); aggregates[arm][name][status]++;
        return [name, status];
      }))]));
      return { index, sessionId: anchor.sessionId, messageIndex: anchor.messageIndex, start: anchor.start, end: anchor.end, statuses };
    });
    cases.push({ id: source.id, family: source.family, anchorDenominator: anchors.length, anchors });
  }
  return { schemaVersion: 'algorithm-development-coverage-v1', metric: 'literal-normalized-origin-bound-anchor-presence',
    normalization: 'NFKC;redactSecrets;Unicode-whitespace-to-ASCII-space;trim;no-truncation',
    targetedStage: 'packed', anchorDenominator: REQUIRED_ANCHOR_DENOMINATOR, aggregates, cases,
    gain: aggregates.full.packed.present - aggregates.baseline.packed.present };
}
