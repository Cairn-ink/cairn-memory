import { isDeepStrictEqual } from 'node:util';
import { redactSecrets } from '../../plugins/cairn-memory/lib/redact.mjs';
import { verifiedEvidence, verifiedRoleEvidence } from '../longmemeval/mixed-evidence.mjs';
import { packMixedAnswer } from '../longmemeval/mixed-answer.mjs';
import { countOpenAITokens } from '../../adapters/openai/index.mjs';
import { assembleSourceDiverseSelection } from '../architecture/source-diverse-selection-model.mjs';
import { assembleSourceLinkedEvidence } from '../architecture/source-linked-evidence-model.mjs';
import { prepareAlgorithmDevelopmentCase } from './runner.mjs';
import { validateEvaluatorRubric } from './corpus.mjs';

// Evaluator-only literal exposure metric; neither presence nor normalization proves semantic support.
export const REQUIRED_ANCHOR_DENOMINATOR = 42;
const STAGES = ['capture-retained', 'candidate-reachable', 'selected', 'recalled', 'packed'];
const ARMS = ['baseline', 'full'];
const normalize = text => redactSecrets(text.normalize('NFKC')).replace(/\s+/gu, ' ').trim();
const empty = () => ({ denominator: REQUIRED_ANCHOR_DENOMINATOR, present: 0, absent: 0, unknown: 0, 'not-run': 0 });
const stage = (entries = [], complete = false, started = false) => ({ entries, complete, started });

function entriesFromEvidence(recall, details, plan, namespace, role = false) {
  const byId = new Map(details.map(detail => [detail.memory?.id, detail]));
  if (byId.size !== details.length) throw new TypeError('duplicate captured memory id');
  const evidence = (role ? verifiedRoleEvidence : verifiedEvidence)(recall, ({ memoryId }) => ({ ok: byId.has(memoryId), value: byId.get(memoryId) }), plan, namespace);
  const entries = evidence.provenance.map(item => {
    const detail = byId.get(item.memoryId), receipt = detail.receipts.find(candidate => candidate.id === item.receiptId);
    return { memoryId: item.memoryId, revision: detail.memory.revision, text: receipt.excerpt, coordinates: item.coordinates };
  });
  return { entries, evidence };
}

function capturedEntries(details, plan, namespace, role = false) {
  const entries = [], ids = new Set(); let valid = true;
  for (const detail of details) {
    if (ids.has(detail.memory?.id)) { valid = false; continue; }
    ids.add(detail.memory?.id);
    const recall = { memories: [{ memory: { id: detail.memory?.id, revision: detail.memory?.revision, currentness: 'current' },
      receipts: detail.receipts, receiptCount: detail.receipts?.length, interpretationStatus: 'omitted', sourceSelectionCoverage: 'unassessed' }] };
    try { entries.push(...entriesFromEvidence(recall, [detail], plan, namespace, role).entries); } catch { valid = false; }
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

function armStages(arm, capture, details, captured, plan, namespace, effective = false, role = false, question) {
  const result = { 'capture-retained': capture };
  const calls = (arm?.modelCalls ?? []).filter(call => call.method === 'select');
  for (const [name, selected] of [['candidate-reachable', false], ['selected', true]]) {
    const actual = effective ? arm?.effectiveSelections ?? [] : calls;
    const references = actual.flatMap(call => navigation(call, selected));
    const entries = captured.entries.filter(entry => references.some(ref => ref.namespaceIndex === 0 &&
      ref.memoryId === entry.memoryId && ref.revision === entry.revision));
    result[name] = stage(entries, captured.valid && actual.length > 0 && actual.every(call => call.output && !call.failure), actual.length > 0);
  }
  let verified = null;
  try { if (arm?.recalled) verified = entriesFromEvidence(arm.recalled, details, plan, namespace, role); } catch { /* unknown binding earns no credit */ }
  result.recalled = stage(verified?.entries ?? [], Boolean(verified), Boolean(arm?.recalled || calls.length));
  const packed = arm?.packed;
  let chosen = null;
  try {
    if (verified && packed && isDeepStrictEqual(arm.evidence, verified.evidence)) {
      if (role && !isDeepStrictEqual(packed, packMixedAnswer({ question, units: verified.evidence.units,
        countTokens: countOpenAITokens }))) throw new TypeError('packed role request differs from authoritative packing');
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

function scoreCoverage({ observations, modelInputs, evaluatorRubric }, effective = false, role = false) {
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
    try { captured = capturedEntries(details, plan, namespace, role); } catch { /* unavailable source binding */ }
    const captureStarted = Boolean(observation?.capture?.inputs?.length || observation?.capture?.outcomes?.length || details.length || observation?.capture?.status === 'completed');
    const capture = stage(captured.entries, captured.valid && observation?.capture?.status === 'completed', captureStarted);
    const armResults = Object.fromEntries(ARMS.map(arm => [arm, armStages(observation?.arms?.[arm], capture, details, captured, plan, namespace, effective, role, source.question)]));
    const anchors = evaluatorRubric.cases[source.id].anchors.map((anchor, index) => {
      const statuses = Object.fromEntries(ARMS.map(arm => [arm, Object.fromEntries(STAGES.map(name => {
        const status = statusFor(anchor, source, armResults[arm][name]); aggregates[arm][name][status]++;
        return [name, status];
      }))]));
      return { index, sessionId: anchor.sessionId, messageIndex: anchor.messageIndex, start: anchor.start, end: anchor.end, statuses };
    });
    cases.push({ id: source.id, family: source.family, anchorDenominator: anchors.length, anchors });
  }
  return { schemaVersion: role ? 'source-diverse-linked-requested-answer-coverage-v1'
    : effective ? 'source-diverse-requested-answer-coverage-v1' : 'algorithm-development-coverage-v1', metric: 'literal-normalized-origin-bound-anchor-presence',
    normalization: 'NFKC;redactSecrets;Unicode-whitespace-to-ASCII-space;trim;no-truncation',
    targetedStage: 'packed', anchorDenominator: REQUIRED_ANCHOR_DENOMINATOR, aggregates, cases,
    gain: aggregates.full.packed.present - aggregates.baseline.packed.present };
}

export const scoreDevelopmentCoverage = options => scoreCoverage(options);

/** Evaluator only: effective selection is mandatory; never fall back to raw refs. */
export function scoreRequestedAnswerCoverage({ report, modelInputs, evaluatorRubric }) {
  if (report?.schemaVersion !== 'source-diverse-requested-answer-comparison-v1' || report.treatment !== 'source-diverse-v1'
    || report.armPolicies?.baseline !== 'ordinary-v1' || report.armPolicies?.full !== 'source-diverse-v1'
    || !Array.isArray(report.observations)) throw new TypeError('wrong requested-answer report identity');
  for (const row of report.observations) for (const name of ARMS) {
    const arm = row.arms?.[name], calls = arm?.modelCalls?.filter(call => call.method === 'select') ?? [];
    if (!Array.isArray(arm?.effectiveSelections) || !Array.isArray(arm.coreInputs)
      || arm.effectiveSelections.length !== arm.coreInputs.length || calls.length > arm.effectiveSelections.length
      || arm.effectiveSelections.some((trace, index) => !isDeepStrictEqual(trace.input, arm.coreInputs[index].input)
        || trace.policy !== (name === 'baseline' ? 'ordinary-v1' : 'source-diverse-v1')
        || !Array.isArray(trace.publicReads) || trace.publicReads.length > 48
        || trace.output == null && trace.failure == null)
      || arm.status === 'completed' && arm.effectiveSelections.some(trace => !trace.output || trace.failure)) {
      throw new TypeError('missing or mismatched effective selection trace');
    }
  }
  return scoreCoverage({ observations: report.observations, modelInputs, evaluatorRubric }, true);
}

/** Evaluator only: validate actual effective traces against raw calls and pure
 * compilers. Failed pre-delegation calls may have no raw record, never a fallback.
 */
function validateBundleTraces(arm, name, namespace, details, plan) {
  if (!arm || !Array.isArray(arm.modelCalls) || !Array.isArray(arm.coreInputs)
    || !Array.isArray(arm.effectiveSelections) || !Array.isArray(arm.effectiveRanks)
    || arm.effectiveSelections.length !== arm.coreInputs.length) throw new TypeError('missing effective bundle traces');
  const policy = name === 'full' ? 'source-diverse-linked-v1' : 'ordinary-v1';
  for (const [method, traces] of [['select', arm.effectiveSelections], ['rank', arm.effectiveRanks]]) {
    const raw = arm.modelCalls.filter(call => call.method === method);
    let cursor = 0;
    for (const [index, trace] of traces.entries()) {
      if (!trace || trace.policy !== policy || trace.output == null && (typeof trace.failure !== 'string' || !trace.failure)
        || trace.output != null && trace.failure !== null
        || method === 'select' && (!isDeepStrictEqual({ input: trace.input, system: trace.system, maxOutputTokens: trace.maxOutputTokens }, arm.coreInputs[index])
          || !Array.isArray(trace.publicReads) || trace.publicReads.length > 48)) throw new TypeError('mismatched effective bundle trace');
      const call = raw[cursor];
      const matches = call && isDeepStrictEqual(trace.input, call.input) && trace.system === call.system
        && trace.maxOutputTokens === call.maxOutputTokens;
      if (matches) cursor++;
      if (trace.output == null) continue;
      if (!matches || !call.output || call.failure) throw new TypeError('missing successful raw bundle call');
      let expected;
      if (method === 'rank') {
        for (const { namespaceIndex, ...candidate } of trace.input.candidates) {
          if (namespaceIndex !== 0) throw new TypeError('foreign rank namespace');
          entriesFromEvidence({ memories: [candidate] }, details, plan, namespace, true);
        }
        // The shared compiler also validates raw refs against the visible rank
        // candidates. Ordinary ranking keeps its raw output, never its links.
        const linked = assembleSourceLinkedEvidence(trace.input, call.output);
        const compiled = name === 'full' ? linked : { output: call.output, diagnostics: null };
        expected = compiled.output;
        const added = expected.refs.filter(ref => !call.output.refs.some(seed => isDeepStrictEqual(ref, seed)));
        const displaced = call.output.refs.filter(seed => !expected.refs.some(ref => isDeepStrictEqual(ref, seed)));
        if (!isDeepStrictEqual(trace.diagnostics, compiled.diagnostics)
          || !isDeepStrictEqual(trace.addedRefs, added) || !isDeepStrictEqual(trace.displacedRefs, displaced)) {
          throw new TypeError('mismatched effective rank assembly');
        }
        const selected = arm.effectiveSelections.flatMap(selection => selection.output?.refs ?? []);
        if (trace.input.candidates.some(candidate => !selected.some(ref => ref.namespaceIndex === candidate.namespaceIndex
          && ref.memoryId === candidate.memory.id && ref.revision === candidate.memory.revision))) {
          throw new TypeError('rank candidate was not effectively selected');
        }
      } else if (name === 'full') {
        if (trace.publicReads.length % 2) throw new TypeError('incomplete selection freshness reads');
        const first = trace.publicReads.slice(0, trace.publicReads.length / 2);
        if (!isDeepStrictEqual(first, trace.publicReads.slice(first.length))) throw new TypeError('selection freshness reads differ');
        if (first.some(read => !isDeepStrictEqual(read.input?.namespace, namespace)
          || read.input.receiptLimit !== 8 || read.input.memoryId !== read.response?.value?.memory?.id)) {
          throw new TypeError('selection public read differs from bound namespace/ref');
        }
        const compiled = assembleSourceDiverseSelection(trace.input, call.output, { readSet: [namespace],
          inspections: first.map(read => ({ ref: { namespaceIndex: 0, memoryId: read.input.memoryId,
            revision: read.response.value.memory.revision }, response: read.response })) });
        expected = compiled.output;
        if (!isDeepStrictEqual(trace.diagnostics, compiled.diagnostics)) throw new TypeError('mismatched effective selection assembly');
      } else {
        expected = call.output;
        if (trace.publicReads.length || trace.diagnostics !== null) throw new TypeError('ordinary selection has extra assembly');
      }
      if (!isDeepStrictEqual(trace.output, expected)) throw new TypeError('effective bundle output differs from compiler');
    }
    if (cursor !== raw.length) throw new TypeError('raw call has no effective trace');
  }
  if (arm.recalled) {
    const actual = arm.recalled.memories.map(item => ({ namespaceIndex: 0, memoryId: item.memory.id, revision: item.memory.revision }));
    const ranked = arm.effectiveRanks.flatMap(trace => trace.output?.refs ?? []);
    if (!isDeepStrictEqual(actual, ranked)) throw new TypeError('recalled refs differ from effective rank');
  }
  if (arm.status === 'completed' && (!arm.recalled || arm.effectiveSelections.length === 0
    || [...arm.effectiveSelections, ...arm.effectiveRanks].some(trace => trace.output == null || trace.failure))) {
    throw new TypeError('completed bundle lacks successful effective traces');
  }
}

export function scoreEvidenceBundleCoverage({ report, modelInputs, evaluatorRubric }) {
  if (report?.schemaVersion !== 'source-diverse-linked-requested-answer-comparison-v1'
    || report.treatment !== 'source-diverse-linked-v1' || report.armPolicies?.baseline !== 'ordinary-v1'
    || report.armPolicies?.full !== 'source-diverse-linked-v1' || report.evidenceFormat !== 'source-role-evidence-v1'
    || !Array.isArray(report.observations)) throw new TypeError('wrong evidence-bundle report identity');
  const known = new Map(modelInputs.map(source => [source.id, source]));
  for (const row of report.observations) {
    if (!known.has(row.id)) throw new TypeError('unknown evidence-bundle case');
    const { namespace, plan } = prepareAlgorithmDevelopmentCase(known.get(row.id));
    for (const name of ARMS) validateBundleTraces(row.arms?.[name], name, namespace, row.capture?.receipts ?? [], plan);
  }
  return scoreCoverage({ observations: report.observations, modelInputs, evaluatorRubric }, true, true);
}
