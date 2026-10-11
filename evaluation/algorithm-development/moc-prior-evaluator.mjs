// Evaluator-only source truth, blind judging and post-first-answer observations.
import { randomBytes, randomInt } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { lstatSync, realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { createMemoryRuntime } from '../../core/runtime.mjs';
import { createQueryScore } from '../../core/query-candidates.mjs';
import { createQueryExcerpt } from '../../core/query-excerpt.mjs';
import { verifiedRoleEvidence } from '../longmemeval/mixed-evidence.mjs';
import { packMixedAnswer } from '../longmemeval/mixed-answer.mjs';
import { countOpenAITokens } from '../../adapters/openai/index.mjs';
import { classificationWire } from '../../adapters/openai/classification-wire.mjs';
import { MOC_NATURAL_VERSION, mocNaturalRoster, mocNaturalArms, mocNaturalOrders, mocNaturalPolicies,
  mocNaturalLimits, mocNaturalSourceSha256, mocNaturalSourceValueSha256, naturalHash, naturalFail, freezeNatural,
  loadMocNaturalInputs, prepareMocNaturalCases } from './moc-prior-profile.mjs';
import { mocNaturalLogicalState, mocNaturalResources } from './moc-prior-runner.mjs';

export const mocNaturalRubricSha256 = 'c0238c7755c94be8e849a698697a36524873cf1a7756cc8988c5a72341b9d7cf';
export const MOC_NATURAL_PROTOCOL = freezeNatural({ version: `${MOC_NATURAL_VERSION}-blind-first-v1`,
  instructions: [
    'Submit your first independent judgment for every opaque label; do not consult another judge or the identity mapping.',
    'Correctness concerns the requested proposition against the full original source and rubric, not retrieval coverage.',
    'Support concerns every factual answer claim against only the actual packed evidence. Use the rubric for stale-use and severe errors.',
    'Known complete answers have abstained=false; known refusals have abstained=true and are incorrect.',
    'The unresolved P04 final-choice question has a correct qualified no-adoption answer with abstained=true. Naming an adopted carrier is incorrect.',
    'Optional uncertainty accompanying a complete known answer does not count as abstention. Unknown fields remain null.',
    'Use label, verdict (correct/incorrect/unresolved), reviewedClaims, unsupportedClaims, staleClaims, severeError, abstained and rationale.',
    'Unavailable first answers remain unresolved. Preserve first submissions; no adjudication or subsequent replacement.',
  ], aggregation: 'fieldwise-exact-agreement; fixed-four-per-arm; fixed-eight-outcomes; unresolved-pairs-not-wins-or-losses' });
const valueHash = value => naturalHash(JSON.stringify(value));
export async function loadMocNaturalFreeze() {
  const modelInputs = await loadMocNaturalInputs();
  const bytes = await readFile(new URL('./moc-prior-rubric.json', import.meta.url));
  if (naturalHash(bytes) !== mocNaturalRubricSha256) naturalFail('natural_source_drift');
  const evaluatorRubric = JSON.parse(bytes);
  const hashes = { sourceBytes: mocNaturalSourceSha256, rubricBytes: mocNaturalRubricSha256,
    modelInputs: valueHash(modelInputs), evaluatorRubric: valueHash(evaluatorRubric), protocol: valueHash(MOC_NATURAL_PROTOCOL) };
  return freezeNatural({ version: MOC_NATURAL_VERSION, modelInputs, evaluatorRubric,
    protocol: MOC_NATURAL_PROTOCOL, hashes });
}
function requireFreeze(frozen) {
  if (frozen?.version !== MOC_NATURAL_VERSION || frozen.hashes?.sourceBytes !== mocNaturalSourceSha256
    || frozen.hashes?.rubricBytes !== mocNaturalRubricSha256
    || frozen.hashes?.modelInputs !== mocNaturalSourceValueSha256
    || frozen.hashes?.evaluatorRubric !== '8b2aff8381cd2f5cddc4034c3ba60f4967c015ab5ad2887c43516cb33b4f6bc1'
    || frozen.hashes.modelInputs !== valueHash(frozen.modelInputs)
    || frozen.hashes.evaluatorRubric !== valueHash(frozen.evaluatorRubric)
    || frozen.hashes.protocol !== valueHash(MOC_NATURAL_PROTOCOL)
    || !isDeepStrictEqual(frozen.protocol, MOC_NATURAL_PROTOCOL)) naturalFail('natural_protocol_invalid');
}
export function requireMocNaturalReport(report, frozen) {
  requireFreeze(frozen);
  if (report?.schemaVersion !== `${MOC_NATURAL_VERSION}-comparison` || report.denominator !== 4
    || report.attemptsPerArm !== 4 || report.outcomesDenominator !== 8
    || report.model !== 'gpt-4.1-mini-2025-04-14' || report.evidenceFormat !== 'source-role-evidence-v1'
    || !isDeepStrictEqual(report.armPolicies, mocNaturalPolicies) || !isDeepStrictEqual(report.limits, mocNaturalLimits)
    || !Array.isArray(report.observations) || report.observations.length !== 4 || !Array.isArray(report.records)
    || report.productPromotion !== false || report.stage3 !== false) naturalFail('natural_report_invalid');
  for (const [index, row] of report.observations.entries()) {
    if (row.id !== mocNaturalRoster[index].id || row.family !== mocNaturalRoster[index].family
      || !isDeepStrictEqual(row.source, frozen.modelInputs[index]) || !isDeepStrictEqual(row.order, mocNaturalOrders[index % 2])
      || Object.keys(row.arms).sort().join() !== 'baseline,prior') naturalFail('natural_report_invalid');
  }
}
const itemRef = (item, namespaceIndex = 0) => item.type === 'unfiled' ? { namespaceIndex, ...item.ref }
  : item.type === 'ref' && item.ref.childType === 'memory'
    ? { namespaceIndex, memoryId: item.ref.childId, revision: item.ref.childRevision } : null;
const sameRef = (a, b) => a?.namespaceIndex === b?.namespaceIndex && a?.memoryId === b?.memoryId && a?.revision === b?.revision;
const actualRefs = (calls, selected = false) => calls.flatMap(call => selected ? call.output?.refs ?? []
  : call.input.maps.flatMap(map => map.items.map(item => itemRef(item, map.namespaceIndex)).filter(Boolean)));
function auditCalls(calls, records) {
  try {
    let cursor = 0;
    for (const call of calls) {
      if (!call.output || call.failure) continue; // A failed or missing stage earns no successful-input claim.
      const count = records[cursor++], generation = records[cursor++];
      if (count?.method !== call.method || generation?.method !== call.method
        || count.endpoint !== 'responses/input_tokens' || generation.endpoint !== 'responses'
        || count.outcome !== 'succeeded' || generation.outcome !== 'succeeded') return false;
      const body = JSON.parse(generation.requestBody), input = JSON.parse(body.input[0].content[0].text);
      const wire = call.method === 'classify' ? classificationWire(call.input) : null;
      if (body.instructions !== call.system || !isDeepStrictEqual(input, wire?.input ?? call.input)
        || body.max_output_tokens !== call.maxOutputTokens || body.text.format.name !== `cairn_${call.method}`) return false;
      const raw = JSON.parse(JSON.parse(generation.responseBody).output[0].content[0].text);
      if (!isDeepStrictEqual(wire ? wire.decode(raw) : raw, call.output)) return false;
      const counted = JSON.parse(count.requestBody);
      if (!isDeepStrictEqual(body, { ...counted, max_output_tokens: 1024, store: false, stream: false })) return false;
    }
    return calls.some(call => call.failure || !call.output) || cursor === records.length;
  } catch { return false; }
}
function verifiedEntries(recall, details, prepared) {
  const byId = new Map(details.map(detail => [detail.memory.id, detail]));
  if (byId.size !== details.length) naturalFail('invalid_recall_provenance');
  const evidence = verifiedRoleEvidence(recall, input => ({ ok: byId.has(input.memoryId), value: byId.get(input.memoryId) }), prepared.plan, prepared.namespace);
  return { evidence, entries: evidence.provenance.map(item => ({ ...item,
    revision: byId.get(item.memoryId).memory.revision,
    text: byId.get(item.memoryId).receipts.find(receipt => receipt.id === item.receiptId).excerpt,
    windows: item.coordinates.map(coordinate => ({ coordinate,
      window: prepared.plan.cairnPlan.batches[coordinate.batchIndex].indexedWindows[coordinate.windowIndex],
      origin: prepared.plan.originMap.turns.find(turn => turn.renderedTurnId === coordinate.renderedTurnId) })) })) };
}
function captureEntries(row, prepared) {
  const details = row.capture.receipts;
  const memories = details.map(detail => ({ memory: { id: detail.memory.id, revision: detail.memory.revision, currentness: 'current' },
    receipts: detail.receipts, receiptCount: detail.receipts.length, interpretationStatus: 'omitted', sourceSelectionCoverage: 'unassessed' }));
  // Shared verifier bounds each recall to six; validate captured memories singly.
  return memories.flatMap(memory => verifiedEntries({ memories: [memory] }, [details.find(detail => detail.memory.id === memory.memory.id)], prepared).entries);
}
function anchorEntries(anchor, source, entries) {
  const session = source.sessions.findIndex(item => item.id === anchor.sessionId);
  return entries.filter(entry => entry.text.includes(anchor.text) && entry.coordinates.some(coordinate =>
    coordinate.originalSessionIndex === session && coordinate.originalTurnIndex === anchor.messageIndex
    && (Number.isSafeInteger(coordinate.originalStartUtf16) && Number.isSafeInteger(coordinate.originalEndUtf16)
      ? coordinate.originalStartUtf16 <= anchor.start && coordinate.originalEndUtf16 >= anchor.end
      : entry.windows.some(({ coordinate: bound, window, origin }) => bound === coordinate
        && origin?.normalizationChanged === false && anchor.start >= origin.normalizedStart && anchor.end <= origin.normalizedEnd
        && window.start <= origin.bodyStart + anchor.start - origin.normalizedStart
        && window.end >= origin.bodyStart + anchor.end - origin.normalizedStart))));
}
function auditedArm(row, name, prepared) {
  const arm = row.arms[name], calls = arm.modelCalls, selects = calls.filter(call => call.method === 'select'), ranks = calls.filter(call => call.method === 'rank');
  const expectedInput = { readSet: [prepared.namespace], query: prepared.plan.mem0Input.query, limit: 6, contextMode: 'source-evidence' };
  let integrity = arm.policy === mocNaturalPolicies[name] && calls.length <= 3 && selects.length <= 2 && ranks.length <= 1
    && calls.every(call => ['select', 'rank'].includes(call.method))
    && auditCalls(calls, arm.records.filter(record => record.method !== 'answer'))
    && (arm.recallInput === null || isDeepStrictEqual(arm.recallInput, expectedInput));
  const visible = actualRefs(selects), selected = actualRefs(selects, true);
  if (selected.some(ref => !visible.some(shown => sameRef(ref, shown)))) integrity = false;
  const candidates = ranks.flatMap(call => call.input.candidates.map(candidate =>
    ({ namespaceIndex: candidate.namespaceIndex, memoryId: candidate.memory.id, revision: candidate.memory.revision })));
  if (candidates.some(ref => !selected.some(seed => sameRef(seed, ref)))) integrity = false;
  if (ranks.some(call => (call.output?.refs ?? []).some(ref => !candidates.some(shown => sameRef(shown, ref))))) integrity = false;
  let verified = null, packedEntries = null;
  try {
    if (arm.recalled) {
      verified = verifiedEntries(arm.recalled, row.capture.receipts, prepared);
      if (!isDeepStrictEqual(verified.evidence, arm.evidence)
        || !isDeepStrictEqual(arm.packed, packMixedAnswer({ question: row.source.question, units: verified.evidence.units, countTokens: countOpenAITokens }))) integrity = false;
      const records = arm.records.filter(record => record.method === 'answer');
      if (arm.status === 'completed' && (records.length !== 1 || records[0].requestBody !== JSON.stringify(arm.packed.request)
        || records[0].outcome !== 'succeeded'
        || JSON.parse(records[0].responseBody).choices[0].message.content !== arm.answer)) integrity = false;
      if (integrity && arm.packed) {
        const ids = new Set(arm.packed.selectedIndices.map(index => arm.recalled.memories[index].memory.id));
        packedEntries = verified.entries.filter(entry => ids.has(entry.memoryId));
      }
      const ranked = ranks.flatMap(call => call.output?.refs ?? []);
      const recalled = arm.recalled.memories.map(item => ({ namespaceIndex: 0, memoryId: item.memory.id, revision: item.memory.revision }));
      if (!isDeepStrictEqual(recalled, ranked)) integrity = false;
    }
  } catch { integrity = false; }
  if (arm.status === 'completed' && (!arm.recalled || !arm.packed || typeof arm.answer !== 'string' || !arm.answer.trim()
    || arm.stateBefore !== row.capture.stateAfter || arm.stateAfterReopen !== row.capture.stateAfter
    || arm.stateAfter !== row.capture.stateAfter || calls.some(call => call.failure || !call.output))) integrity = false;
  return { integrity, visible, selected, packedEntries: integrity ? packedEntries : null,
    selectsComplete: selects.length > 0 && selects.every(call => call.output && !call.failure) };
}
/** Terminal first-answer artifacts only. Derived orders are never model inputs. */
export async function analyzeMocNaturalReport({ report, freeze: frozen, outputDirectory }) {
  requireMocNaturalReport(report, frozen);
  if (report.allFirstAnswersSettled !== true) naturalFail('natural_derivation_unavailable');
  const prepared = await prepareMocNaturalCases(frozen.modelInputs), cases = [];
  for (const [index, row] of report.observations.entries()) {
    const source = frozen.modelInputs[index], context = prepared[index];
    let retained = [], captureValid = row.capture.status === 'completed'
      && row.capture.inputs.length === 19 && row.capture.outcomes.length === 19
      && row.capture.modelCalls.length <= 38 && row.capture.modelCalls.every(call => call.output && !call.failure
        && ['extract', 'classify'].includes(call.method))
      && row.capture.outcomes.every(outcome => outcome.ok && outcome.value.classification?.status !== 'failed')
      && isDeepStrictEqual(row.capture.inputs, context.plan.cairnPlan.batches.map(batch => batch.captureInput))
      && auditCalls(row.capture.modelCalls, row.capture.records)
      && isDeepStrictEqual(row.records, report.records.filter(record => record.id === row.id))
      && isDeepStrictEqual(row.capture.records, row.records.filter(record => record.arm === 'capture'))
      && mocNaturalArms.every(name => isDeepStrictEqual(row.arms[name].records, row.records.filter(record => record.arm === name)))
      && report.records.every(record => mocNaturalRoster.some(source => source.id === record.id));
    try { retained = captureEntries(row, context); } catch { captureValid = false; }
    const arms = Object.fromEntries(mocNaturalArms.map(name => [name, auditedArm(row, name, context)]));
    const derived = { kind: 'derived-post-first-answer-not-model-input', query: context.plan.mem0Input.query,
      scorer: 'literal-current-memory-source-overlap-v1', sourceReceiptLimit: 4,
      policies: { ...mocNaturalPolicies }, status: 'unknown', orders: null, stateBefore: null, stateAfter: null,
      internalPriorMembership: 'unobserved' };
    if (captureValid && typeof outputDirectory === 'string') {
      let runtime;
      try {
        const expected = `${String(index + 1).padStart(2, '0')}-${row.id}/memory.sqlite`;
        if (row.databaseFile !== expected) naturalFail('natural_derivation_unavailable');
        const path = join(resolve(outputDirectory), expected), identity = lstatSync(path);
        if (!identity.isFile() || identity.isSymbolicLink() || realpathSync(path) !== path) naturalFail('natural_derivation_unavailable');
        derived.stateBefore = mocNaturalLogicalState(path);
        if (derived.stateBefore !== row.capture.stateAfter) naturalFail('natural_state_changed');
        runtime = createMemoryRuntime({ path });
        const snapshots = Object.fromEntries(mocNaturalArms.map(name => [name,
          runtime.queryCandidateRows(context.namespace, { score: createQueryScore(derived.query),
            memoryLabel: createQueryExcerpt(derived.query), sourceReceiptLimit: 4, sourceCandidatePolicy: mocNaturalPolicies[name] })]));
        runtime.close(); runtime = null;
        derived.stateAfter = mocNaturalLogicalState(path);
        if (derived.stateAfter !== derived.stateBefore) naturalFail('natural_state_changed');
        derived.orders = Object.fromEntries(mocNaturalArms.map(name => [name, snapshots[name].rows.map(row => itemRef(row.item))]));
        derived.snapshots = snapshots;
        const sets = mocNaturalArms.map(name => derived.orders[name].map(ref => JSON.stringify(ref)).sort());
        if (!isDeepStrictEqual(sets[0], sets[1])) naturalFail('natural_derivation_unavailable');
        derived.status = 'verified';
      } catch { derived.status = 'unknown'; }
      finally { runtime?.close(); }
    }
    const statuses = frozen.evaluatorRubric.cases[row.id].anchors.map((anchor, anchorIndex) => {
      const carriers = anchorEntries(anchor, source, retained);
      const byArm = Object.fromEntries(mocNaturalArms.map(name => {
        const arm = arms[name], has = refs => carriers.some(entry => refs.some(ref => sameRef(ref,
          { namespaceIndex: 0, memoryId: entry.memoryId, revision: entry.revision })));
        return [name, { retained: carriers.length > 0 ? 'present' : captureValid ? 'absent' : 'unknown',
          visible: arm.integrity && has(arm.visible) ? 'present' : arm.integrity && arm.selectsComplete ? 'absent' : 'unknown',
          selected: arm.integrity && has(arm.selected) ? 'present' : arm.integrity && arm.selectsComplete ? 'absent' : 'unknown',
          packed: arm.packedEntries && anchorEntries(anchor, source, arm.packedEntries).length ? 'present' : arm.packedEntries ? 'absent' : 'unknown' }];
      }));
      const movedEarlier = derived.status === 'verified' && carriers.some(entry => {
        const target = { namespaceIndex: 0, memoryId: entry.memoryId, revision: entry.revision };
        const left = derived.orders.baseline.findIndex(ref => sameRef(ref, target));
        const right = derived.orders.prior.findIndex(ref => sameRef(ref, target));
        const detail = row.capture.receipts.find(detail => detail.memory.id === entry.memoryId);
        return left >= 0 && right >= 0 && right < left && detail.memory.filing.status !== 'unfiled';
      });
      const opportunity = captureValid && arms.baseline.integrity && arms.prior.integrity && movedEarlier
        && byArm.baseline.retained === 'present' && byArm.baseline.visible === 'absent'
        && byArm.prior.visible === 'present' && byArm.prior.packed === 'present';
      return { index: anchorIndex, carriers: carriers.map(entry => ({ memoryId: entry.memoryId, receiptId: entry.receiptId, revision: entry.revision })),
        stages: byArm, movedEarlier, opportunity: Boolean(opportunity) };
    });
    cases.push({ id: row.id, captureValid,
      armIntegrity: Object.fromEntries(mocNaturalArms.map(name => [name, arms[name].integrity])),
      integrity: captureValid && mocNaturalArms.every(name => arms[name].integrity),
      exposureMeaning: 'source-carrying-reference-visible; actual-labels-retained-in-model-traces', derived,
      anchors: statuses, opportunity: statuses.some(anchor => anchor.opportunity) });
  }
  return freezeNatural({ schemaVersion: `${MOC_NATURAL_VERSION}-analysis`, reportSha256: valueHash(report), cases });
}
export async function buildBlindMocNaturalPacket({ report, freeze: frozen }) {
  requireMocNaturalReport(report, frozen);
  const mapping = [], items = [];
  for (const [index, source] of frozen.modelInputs.entries()) for (const name of mocNaturalArms) {
    const row = report.observations[index], arm = row.arms[name], label = randomBytes(16).toString('hex');
    mapping.push({ label, id: source.id, arm: name });
    items.push({ label, question: structuredClone(source.question), sourceHistory: structuredClone(source.sessions),
      rubric: structuredClone(frozen.evaluatorRubric.cases[source.id]),
      packedEvidence: arm.packed ? JSON.parse(arm.packed.request.messages[1].content).evidence : null,
      answer: arm.status === 'completed' ? arm.answer : null,
      answerAvailability: arm.status === 'completed' ? 'available' : 'unresolved' });
  }
  for (let i = items.length - 1; i > 0; i--) { const j = randomInt(i + 1); [items[i], items[j]] = [items[j], items[i]]; }
  return freezeNatural({ mapping, packet: { protocol: MOC_NATURAL_PROTOCOL, rubricIdentity: frozen.hashes, items } });
}
export function unblindMocNaturalJudgments(mapping, judgments) {
  const labels = new Map(mapping.map(row => [row.label, row])), seen = new Set();
  if (labels.size !== mapping.length || !Array.isArray(judgments) || judgments.length > 8) naturalFail('natural_judgment_invalid');
  return judgments.map(({ label, ...judgment }) => {
    if (!labels.has(label) || seen.has(label) || 'id' in judgment || 'arm' in judgment) naturalFail('natural_judgment_invalid');
    seen.add(label); return { id: labels.get(label).id, arm: labels.get(label).arm, ...judgment };
  });
}
function judgmentMap(judgments) {
  if (!Array.isArray(judgments) || judgments.length > 8) naturalFail('natural_judgment_invalid');
  const map = new Map();
  for (const judgment of judgments) {
    const fields = ['id', 'arm', 'verdict', 'reviewedClaims', 'unsupportedClaims', 'staleClaims', 'severeError', 'abstained', 'rationale'];
    const key = `${judgment.id}/${judgment.arm}`;
    if (Object.keys(judgment).sort().join() !== fields.sort().join() || map.has(key)
      || !mocNaturalRoster.some(row => row.id === judgment.id) || !mocNaturalArms.includes(judgment.arm)
      || !['correct', 'incorrect', 'unresolved'].includes(judgment.verdict)
      || ![true, false, null].includes(judgment.severeError) || ![true, false, null].includes(judgment.abstained)
      || typeof judgment.rationale !== 'string' || !judgment.rationale.trim()) naturalFail('natural_judgment_invalid');
    for (const field of ['reviewedClaims', 'unsupportedClaims', 'staleClaims'])
      if (judgment[field] !== null && (!Number.isSafeInteger(judgment[field]) || judgment[field] < 0)) naturalFail('natural_judgment_invalid');
    for (const field of ['unsupportedClaims', 'staleClaims'])
      if (judgment[field] !== null && (judgment.reviewedClaims === null || judgment[field] > judgment.reviewedClaims)) naturalFail('natural_judgment_invalid');
    map.set(key, judgment);
  }
  return map;
}
/** Always recompute source exposure/order from the retained store, not supplied flags. */
export async function aggregateMocNaturalJudgments({ report, freeze: frozen, outputDirectory, judgmentsA, judgmentsB }) {
  const analysis = await analyzeMocNaturalReport({ report, freeze: frozen, outputDirectory });
  const a = judgmentMap(judgmentsA), b = judgmentMap(judgmentsB), outcomes = [];
  const equal = (left, right, field) => left && right && left[field] === right[field] ? left[field] : null;
  for (const [index, source] of frozen.modelInputs.entries()) for (const name of mocNaturalArms) {
    const left = a.get(`${source.id}/${name}`), right = b.get(`${source.id}/${name}`), arm = report.observations[index].arms[name];
    const completed = report.observations[index].capture.status === 'completed' && arm.status === 'completed'
      && analysis.cases[index].captureValid && analysis.cases[index].armIntegrity[name];
    const outcome = { id: source.id, arm: name, answerability: frozen.evaluatorRubric.cases[source.id].answerability,
      completed, verdict: completed ? equal(left, right, 'verdict') ?? 'unresolved' : 'unresolved' };
    for (const field of ['reviewedClaims', 'unsupportedClaims', 'staleClaims', 'severeError', 'abstained'])
      outcome[field] = completed ? equal(left, right, field) : null;
    if (outcome.verdict === 'correct' && outcome.abstained !== null
      && outcome.abstained !== (outcome.answerability === 'unresolved')) outcome.verdict = 'unresolved';
    outcomes.push(outcome);
  }
  const arms = Object.fromEntries(mocNaturalArms.map(name => {
    const rows = outcomes.filter(row => row.arm === name);
    return [name, { denominator: 4, completed: rows.filter(row => row.completed).length,
      correct: rows.filter(row => row.verdict === 'correct').length, incorrect: rows.filter(row => row.verdict === 'incorrect').length,
      unresolved: rows.filter(row => row.verdict === 'unresolved').length,
      known: { denominator: 3, useful: rows.filter(row => row.answerability === 'known' && row.verdict === 'correct' && row.abstained === false).length,
        abstained: rows.filter(row => row.answerability === 'known' && row.abstained === true).length },
      unresolvedChoice: rows.find(row => row.answerability === 'unresolved') }];
  }));
  const paired = { denominator: 4, wins: 0, losses: 0, bothCorrect: 0, neitherCorrect: 0, unresolvedPairs: 0, netCorrect: 0 };
  for (const source of frozen.modelInputs) {
    const left = outcomes.find(row => row.id === source.id && row.arm === 'baseline'), right = outcomes.find(row => row.id === source.id && row.arm === 'prior');
    if ([left.verdict, right.verdict].includes('unresolved')) { paired.unresolvedPairs++; continue; }
    if (left.verdict === 'correct' && right.verdict === 'correct') paired.bothCorrect++;
    else if (right.verdict === 'correct') paired.wins++;
    else if (left.verdict === 'correct') paired.losses++;
    else paired.neitherCorrect++;
  }
  paired.netCorrect = paired.wins - paired.losses;
  const safetyUnknown = outcomes.some(row => ['unsupportedClaims', 'staleClaims', 'severeError', 'abstained'].some(field => row[field] === null));
  const sum = (name, field) => outcomes.filter(row => row.arm === name).reduce((n, row) => n + Number(row[field] > 0), 0);
  const newSevere = frozen.modelInputs.filter(source => outcomes.find(row => row.id === source.id && row.arm === 'prior').severeError === true
    && outcomes.find(row => row.id === source.id && row.arm === 'baseline').severeError !== true).map(source => source.id);
  const resources = mocNaturalResources(report);
  const accountingIntact = report.initialBudget?.limitMicroUsd === 400_000_000 && report.finalBudget?.state === 'open'
    && report.finalBudget.runId === report.initialBudget.runId
    && report.finalBudget.requestCount === report.initialBudget.requestCount + report.records.length
    && report.finalBudget.reservedMicroUsd === report.initialBudget.reservedMicroUsd + resources.reservedMicroUsd
    && report.finalBudget.limitMicroUsd === 400_000_000 && report.finalBudget.limitMicroUsd - report.finalBudget.reservedMicroUsd >= 30_000_000
    && report.records.every(row => row.reservedMicroUsd === 5000 && (row.usage === null
      || row.usage.input_tokens <= 7024 && row.usage.output_tokens <= (row.method === 'answer' ? 512 : 1024)));
  const resourcesWithinLimits = report.records.length <= 360 && resources.reservedMicroUsd <= 1_800_000
    && resources.reservedMicroUsd <= 4_000_000 && report.observations.every(row => row.capture.modelCalls.length <= 38
      && row.capture.admissions <= 95 && row.capture.outcomes.every(outcome => !outcome.ok || (outcome.value.admission?.memories.length ?? 0) <= 5)
      && mocNaturalArms.every(name => row.arms[name].modelCalls.length <= 3 && row.arms[name].records.filter(record => record.method === 'answer').length <= 1));
  const gates = { correctnessResolved: paired.unresolvedPairs === 0, safetyResolved: !safetyUnknown,
    opportunity: analysis.cases.some(row => row.opportunity), positivePairedGain: paired.netCorrect > 0,
    noCorrectCaseLost: paired.losses === 0, noIncreasedUnsupported: !safetyUnknown && sum('prior', 'unsupportedClaims') <= sum('baseline', 'unsupportedClaims'),
    noIncreasedStale: !safetyUnknown && sum('prior', 'staleClaims') <= sum('baseline', 'staleClaims'), noNewSevere: !safetyUnknown && newSevere.length === 0,
    knownUsefulness: arms.prior.known.useful >= arms.baseline.known.useful && arms.prior.known.abstained <= arms.baseline.known.abstained,
    integrity: report.fatal === null && accountingIntact && analysis.cases.every(row => row.integrity && row.captureValid && row.derived.status === 'verified'), resourcesWithinLimits };
  const positive = Object.values(gates).every(value => value === true);
  const unsafe = !gates.integrity || !resourcesWithinLimits || paired.losses > 0 || newSevere.length > 0
    || !safetyUnknown && (!gates.noIncreasedUnsupported || !gates.noIncreasedStale || !gates.knownUsefulness);
  return freezeNatural({ schemaVersion: `${MOC_NATURAL_VERSION}-judgments`, denominator: 4, outcomesDenominator: 8,
    firstSubmissions: { judgeA: structuredClone(judgmentsA), judgeB: structuredClone(judgmentsB) }, outcomes, arms, paired, analysis, resources, gates,
    supportsFurtherDevelopment: positive, productPromotion: false, stage3: false,
    decision: positive ? 'positive-development-signal' : unsafe ? 'reject/unsafe' : !gates.opportunity ? 'precondition-unmet' : 'inconclusive/no-gain' });
}
