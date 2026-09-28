import { AsyncLocalStorage } from 'node:async_hooks';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { openMemoryCore } from '../../core/contract.mjs';
import { countOpenAITokens } from '../../adapters/openai/index.mjs';
import { packMixedAnswer } from '../longmemeval/mixed-answer.mjs';
import { createIndexedSourceWindowObserver } from '../architecture/source-window-coverage.mjs';
import { createRetainedRecallTrace } from './recall-observation.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { VERSION, longCase, capacityCase, datedCase, faultControls } from './fixtures.mjs';

const namespace = { ownerId: 'long-history-gate', scope: 'personal', projectId: null };
const otherNamespace = { ownerId: 'long-history-other', scope: 'personal', projectId: null };
const token = text => countOpenAITokens(text);
const refFromMap = (item, namespaceIndex) => item.type === 'unfiled'
  ? { namespaceIndex, ...item.ref }
  : item.type === 'ref' && item.ref.childType === 'memory'
    ? { namespaceIndex, memoryId: item.ref.childId, revision: item.ref.childRevision } : null;
const ok = result => {
  if (result.ok !== true) throw new Error(`public_${result.error?.code ?? 'failure'}`);
  return result.value;
};
const metric = () => ({ calls: { extract: 0, classify: 0, select: 0, rank: 0 },
  inputTokens: 0, outputTokens: 0, tokenizerCalls: 0, tokenizerTokens: 0 });
const recallTraceScope = new AsyncLocalStorage();
export const withRecallTrace = (trace, operation) => recallTraceScope.run(trace, operation);
export function recordScriptedRecallStage(method, request, output) {
  try {
    const trace = recallTraceScope.getStore();
    if (method === 'select') trace?.recordSelect(request, output);
    if (method === 'rank') trace?.recordRank(request, output);
  } catch { /* Observation must not change the scripted model call. */ }
  return output;
}

// This control sees only its invocation's model input. Evaluation expectations,
// target IDs and the store stay in the runner, never on this object.
export function scriptedModel(metrics, modes = {}) {
  const observe = (method, request, output) => {
    metrics.calls[method]++;
    metrics.inputTokens += token(JSON.stringify({ system: request.system, input: request.input }));
    metrics.outputTokens += token(JSON.stringify(output));
    return recordScriptedRecallStage(method, request, output);
  };
  return {
    contextWindow: 16_384,
    countTokens(text) { const count = token(text); metrics.tokenizerCalls++;
      metrics.tokenizerTokens += count; return count; },
    extract(request) {
      if (modes.extract === 'malformed') return observe('extract', request, { items: [{ malformed: true }] });
      if (modes.extract === 'omit') return observe('extract', request, { items: [] });
      const items = request.input.messages.map((message, sourceIndex) => {
        const marker = message.content.match(/^(frontmarker|middlemarker|tailmarker|capacity\d{4}|datedalpha|datedbeta|faultmarker|correctionmarker)/u)?.[0];
        return marker ? { content: `memory ${marker}`, kind: 'context', confidence: 1,
          sourceIndices: [sourceIndex] } : null;
      }).filter(Boolean);
      return observe('extract', request, { items });
    },
    classify(request) {
      if (modes.classify === 'fail') {
        metrics.calls.classify++;
        metrics.inputTokens += token(JSON.stringify({ system: request.system, input: request.input }));
        throw new Error('scripted_classification_failure');
      }
      const items = request.input.memories.map((memory, index) => ({ memoryId: memory.id,
        parentIds: [], ...(index === 0 && memory.content === 'memory frontmarker'
          ? { newL1: { title: 'Source window observations', parentL2Ids: [] } } : {}) }));
      return observe('classify', request, { items });
    },
    select(request) {
      if (modes.select === 'empty') return observe('select', request, { refs: [] });
      const wanted = request.input.query.toLowerCase();
      const refs = request.input.maps.flatMap(map => map.items
        .filter(item => item.label?.toLowerCase().includes(wanted))
        .map(item => refFromMap(item, map.namespaceIndex)).filter(Boolean)).slice(0, request.input.maxRefs);
      return observe('select', request, { refs });
    },
    rank(request) {
      if (modes.rank === 'empty') return observe('rank', request, { refs: [] });
      const wanted = request.input.query.toLowerCase();
      const refs = request.input.candidates.filter(candidate => candidate.receipts
        .some(receipt => receipt.excerpt.toLowerCase().includes(wanted)))
        .slice(0, request.input.limit).map(candidate => ({ namespaceIndex: candidate.namespaceIndex,
          memoryId: candidate.memory.id, revision: candidate.memory.revision }));
      return observe('rank', request, { refs });
    },
  };
}

const captureInput = (eventId, messages, ns = namespace) => ({ namespace: ns,
  client: 'synthetic-gate', sessionId: 'long-history', eventId, messages });
const message = (id, content) => ({ id, role: 'user', content });
const opened = (workspace, filename, model, candidatePolicy) => {
  const path = join(workspace.path, filename);
  let core = openMemoryCore({ path, model, captureSourcePolicy: 'indexed-evidence-v1',
    ...(candidatePolicy ? { sourceCandidatePolicy: candidatePolicy } : {}) });
  workspace.defer(() => { core?.close(); core = null; });
  return { path, get core() { return core; }, close() { core?.close(); core = null; },
    reopen() { core?.close(); core = openMemoryCore({ path, model, captureSourcePolicy: 'indexed-evidence-v1',
      ...(candidatePolicy ? { sourceCandidatePolicy: candidatePolicy } : {}) }); return core; } };
};
const passageIn = (receipts, marker) => receipts?.some(row => row.excerpt.includes(marker)) ?? false;

const stageValue = value => value === 'yes' ? true : value === 'no' ? false
  : value === 'bypassed' ? 'bypassed' : 'not-run';
const oldGap = gap => ({ 'retained-text': 'retained', 'source-binding': 'retained',
  'reference-visible': 'reference-visible', selected: 'selected',
  'rank-input-ref': 'rank-input-source-visible', 'rank-input-text': 'rank-input-source-visible',
  'rank-input-source-binding': 'rank-input-source-visible', ranked: 'ranked',
  'final-ref': 'final-returned', 'final-text': 'final-returned',
  'final-source-binding': 'final-returned', 'answer-context-present': 'answer-context-present' })[gap]
  ?? (gap === null ? null : 'not-run');

// Preserve the gate's original aggregate stage keys while treating its new
// source-bound trace as authority for progression. Candidate text in a label
// remains an optional routing preview, not a required delivery stage.
export function observePassage({ trace, packedTokens = 0, expectedRefType }) {
  const source = trace.source ?? {};
  const selection = trace.selection ?? {};
  const rank = trace.rank ?? {};
  const final = trace.final ?? {};
  const answer = trace.answer ?? {};
  const retained = trace.status === 'observed'
    ? source.retainedText === 'yes' && source.currentSourceBinding === 'yes' : 'not-run';
  const referenceVisible = stageValue(selection.referenceVisible);
  const candidateVisible = stageValue(selection.candidateTextVisible);
  const selected = stageValue(selection.accepted);
  const rankInputSourceVisible = stageValue(rank.inputText);
  const ranked = stageValue(rank.accepted);
  const finalReturned = final.status === 'completed'
    ? final.ref === 'yes' && final.text === 'yes' && final.sourceBinding === 'yes' : 'not-run';
  const answerContextPresent = stageValue(answer.textPresent);
  const stages = { retained,
    referenceVisible: retained === true ? referenceVisible : 'not-run',
    candidateVisible: retained === true ? candidateVisible : 'not-run',
    selected: retained === true ? selected : 'not-run',
    rankInputSourceVisible: selected === true ? rankInputSourceVisible : 'not-run',
    ranked: rankInputSourceVisible === true ? ranked : 'not-run',
    finalReturned: ranked === true ? finalReturned : 'not-run',
    answerContextPresent: finalReturned === true ? answerContextPresent : 'not-run' };
  const firstMissing = retained === 'not-run' ? 'not-run' : retained === false ? 'retained'
    : candidateVisible === false ? 'candidate-visible'
    : selected === false ? 'selected' : rankInputSourceVisible === false ? 'rank-input-source-visible'
      : ranked === false ? 'ranked' : finalReturned === false ? 'final-returned'
        : answerContextPresent === false ? 'answer-context-present' : null;
  return { stages, routingCueVisible: stageValue(selection.routingTextVisible),
    firstMissing, firstDeliveryFailure: oldGap(trace.firstObservedGap),
    deliverySucceeded: trace.firstObservedGap === 'unavailable' ? 'not-run'
      : trace.firstObservedGap === null, packedTokens, sourceTrace: trace,
    ...(expectedRefType ? { expectedRefTypeObserved: selection.targetRefType === expectedRefType } : {}) };
}

async function inspectQuestion(store, memory, question, policy, expectedRefType) {
  const read = () => { try { return store.core.get({ namespace, memoryId: memory.id,
    receiptLimit: 100 }); } catch { return null; } };
  const before = read();
  const readSet = [namespace];
  const trace = createRetainedRecallTrace({ sourceProbe: { namespace, memoryId: memory.id,
    client: 'synthetic-gate', sessionId: 'long-history', eventId: question.sourceId,
    role: question.role ?? 'user', excerpt: question.requiredSource, routingCue: question.marker },
  before, readSet });
  const recall = await withRecallTrace(trace, () => store.core.recall({ readSet,
    query: question.query, contextMode: 'source-evidence', limit: 6 }));
  let packed = null;
  if (recall.ok) {
    const units = recall.value.memories.map(item => ({ text: item.receipts
      .map(receipt => receipt.excerpt).join('\n') }));
    packed = packMixedAnswer({ question: { text: question.query, date: '2026-09-28' },
      units, countTokens: token });
  }
  const observed = observePassage({ trace: trace.finish({ recall, packed, after: read() }),
    packedTokens: packed?.totalEstimatedTokens ?? 0, expectedRefType });
  return { key: question.key, policy, ...observed, recallOk: recall.ok,
    recallCoverage: recall.ok ? recall.value.coverage : 'not-run' };
}

function assertGate(condition, code) { if (!condition) throw new Error(`gate_${code}`); }
const delivered = row => ['retained', 'selected', 'rankInputSourceVisible',
  'ranked', 'finalReturned', 'answerContextPresent'].every(stage => row.stages[stage] === true);
const stageNames = ['retained', 'referenceVisible', 'candidateVisible', 'selected',
  'rankInputSourceVisible', 'ranked', 'finalReturned', 'answerContextPresent'];
const notRunQuestion = (key, policy) => ({ key, policy, status: 'not-run',
  stages: Object.fromEntries(stageNames.map(stage => [stage, 'not-run'])),
  firstMissing: 'not-run', firstDeliveryFailure: 'not-run', deliverySucceeded: 'not-run',
  recallOk: 'not-run', recallCoverage: 'not-run' });
const notRunBatch = () => ({ capture: 'not-run', admitted: null, classification: 'not-run' });
const faultBatchNames = ['malformedExtraction', 'failedClassification', 'omittedSource',
  'emptySelection', 'emptyRank', 'lifecycle'];
const gateFaults = ['capacity-second-malformed-extraction', 'capacity-second-classification-failure'];

// Exact cold identity, not cardinality, is needed to infer zero admission from
// a failed capture. The caller keeps these IDs private; no row enters the report.
export function sameColdMemoryIdentities(expected, observed) {
  if (!Array.isArray(expected) || !Array.isArray(observed) || expected.length !== observed.length) return false;
  const known = new Map();
  for (const row of expected) {
    if (typeof row?.id !== 'string' || !Number.isSafeInteger(row.revision) ||
        known.has(row.id)) return false;
    known.set(row.id, row.revision);
  }
  const seen = new Set();
  for (const row of observed) {
    if (typeof row?.id !== 'string' || !Number.isSafeInteger(row.revision) ||
        seen.has(row.id) || known.get(row.id) !== row.revision) return false;
    seen.add(row.id);
  }
  return true;
}

export async function runGate({ fault = null } = {}) {
  if (fault !== null && !gateFaults.includes(fault)) throw new TypeError('invalid_gate_fault');
  const workspace = createTestWorkspace(null, { prefix: 'cairn-long-history-' });
  const metrics = metric();
  const report = { version: VERSION, control: 'offline-scripted-visible-input-only',
    cases: [
      { family: longCase.name, status: 'not-run', sourceWindows: 'not-run',
        questions: longCase.questions.map(question => notRunQuestion(question.key, 'default')) },
      { family: capacityCase.name, status: 'not-run', eligibleMemories: 'not-run',
        candidateTopLimit: 1024, targetRule: capacityCase.targetRule,
        questions: [notRunQuestion('greatest-id-target', 'default'),
          notRunQuestion('greatest-id-target', 'bounded-keyset-v1')] },
      { family: datedCase.name, status: 'not-run', choicesRetained: 'not-run',
        currentChoiceJudgment: 'not-assessed',
        questions: datedCase.questions.map(question => notRunQuestion(question.key, 'default')) },
    ],
    batchOutcomes: { longWindows: [notRunBatch()],
      capacity1025: Array.from({ length: capacityCase.count / capacityCase.batchSize }, notRunBatch),
      datedAB: datedCase.sources.map(notRunBatch),
      faultControls: faultBatchNames.map(control => ({ control, ...notRunBatch() })) },
    controls: Object.fromEntries(Object.keys(faultControls).map(control => [control, 'not-run'])),
    controlStages: Object.fromEntries(Object.keys(faultControls).map(control => [control, { status: 'not-run' }])),
    sourceWindowCoverage: { longWindows: 'not-run', omittedSource: 'not-run' },
    denominators: { requiredPassages: 7, plannedCaptureBatches: 208,
      plannedAdmittedMemories: 1030, attemptedCaptureBatches: 0, captureBatches: 0,
      failedCaptureBatches: 0, notRunCaptureBatches: 208,
      admittedMemories: 0, negativeControls: Object.keys(faultControls).length },
    stages: Object.fromEntries(stageNames.map(stage => [stage, 0])), calls: metrics.calls,
    tokens: {}, elapsedMs: {}, finalDatabaseBytes: 0,
    expectedNegativeCount: 0, unexpectedCount: 0 };
  const dbPaths = [];
  // Deferred callbacks run in reverse order: close every store, then measure
  // stable SQLite files, then let the owned workspace remove them.
  workspace.defer(() => { report.finalDatabaseBytes = dbPaths.reduce((sum, path) => sum + statSync(path).size, 0); });
  const start = performance.now();
  let writeMs = 0, readMs = 0, controlMs = 0;
  const timeWrite = async work => { const began = performance.now();
    try { return await work(); } finally { writeMs += performance.now() - began; } };
  const timeRead = async work => { const began = performance.now();
    try { return await work(); } finally { readMs += performance.now() - began; } };
  const recordCapture = (family, index, response) => {
    report.denominators.attemptedCaptureBatches++;
    report.denominators.notRunCaptureBatches--;
    const value = response.ok ? response.value : null;
    const admitted = value?.admission?.memories.length ?? null;
    const classification = value?.classification?.status ?? 'not-run';
    const capture = !response.ok ? 'failed' : classification === 'failed'
      ? 'completed-post-admission-failure' : 'completed';
    report.batchOutcomes[family][index] = { capture, admitted, classification };
    if (value) report.denominators.admittedMemories += admitted;
    if (capture === 'completed') report.denominators.captureBatches++;
    else report.denominators.failedCaptureBatches++;
    return value;
  };
  const captureTracked = async (core, input, family, index, observer = null) => {
    let response;
    try { response = await timeWrite(() => observer ? observer.capture(core, input) : core.capture(input)); }
    catch (error) { recordCapture(family, index, { ok: false }); throw error; }
    return { response, value: recordCapture(family, index, response) };
  };
  const finishReport = () => {
    const rows = report.cases.flatMap(row => row.questions);
    for (const stage of stageNames) report.stages[stage] = rows.filter(row => row.stages[stage] === true).length;
    report.expectedNegativeCount = Object.values(report.controls).filter(value => value === true).length;
    report.tokens = { inputTokens: metrics.inputTokens, outputTokens: metrics.outputTokens,
      tokenizerCalls: metrics.tokenizerCalls, tokenizerTokens: metrics.tokenizerTokens };
    report.elapsedMs = { write: Math.round(writeMs), read: Math.round(readMs),
      controls: Math.round(controlMs), total: Math.round(performance.now() - start) };
  };
  try {
    // Three source windows; the classifier proposes a real L1 for the first memory.
    report.cases[0].status = 'incomplete';
    const longStore = opened(workspace, 'long.sqlite', scriptedModel(metrics));
    dbPaths.push(longStore.path);
    const longWindowObserver = createIndexedSourceWindowObserver();
    let captured = await captureTracked(longStore.core,
      captureInput('long', longCase.messages), 'longWindows', 0, longWindowObserver);
    assertGate(captured.response.ok, 'long_capture');
    let result = captured.value;
    assertGate(result.classification.status === 'applied', 'long_classification');
    assertGate(result.sourceWindowCatalog.windowCount === longCase.expectedWindowCount, 'window_count');
    assertGate(result.admission.memories.length === 3, 'long_admission');
    const longMemories = result.admission.memories;
    longStore.reopen();
    report.sourceWindowCoverage.longWindows = longWindowObserver.finish({
      inspectAdmission: input => longStore.core.inspectAdmission(input),
      get: input => longStore.core.get(input),
    });
    assertGate(report.sourceWindowCoverage.longWindows.status === 'observed' &&
      report.sourceWindowCoverage.longWindows.coverage === 'complete' &&
      report.sourceWindowCoverage.longWindows.uniqueRetainedCount === longCase.expectedWindowCount,
    'long_source_window_coverage');
    const longRows = [];
    for (const [index, question] of longCase.questions.entries()) {
      const requiredSource = longCase.messages[0].content.slice(index * 800, (index + 1) * 800).trimEnd();
      const row = await timeRead(() => inspectQuestion(longStore, longMemories[index],
        { ...question, requiredSource, sourceId: longCase.messages[0].id },
        'default', index === 0 ? 'ref' : undefined));
      longRows.push(row);
      report.cases[0].questions[index] = { ...row, status: 'completed' };
    }
    assertGate(longRows.every(delivered), 'long_delivery');
    assertGate(longRows.every(row => row.stages.referenceVisible && row.routingCueVisible
      && row.stages.candidateVisible === false && row.firstMissing === 'candidate-visible'),
    'long_preview_boundary');
    assertGate(longRows[0].expectedRefTypeObserved, 'filed_ref');
    report.cases[0].sourceWindows = 3;
    report.cases[0].status = 'completed';

    // All 1,025 memories are admitted through capture; target is fixed by max ID
    // after all writes and before either recall. Both policies read this cold DB.
    report.cases[1].status = 'incomplete';
    const capacityModes = {};
    const capacityModel = scriptedModel(metrics, capacityModes);
    const capacityStore = opened(workspace, 'capacity.sqlite', capacityModel);
    dbPaths.push(capacityStore.path);
    const admitted = [];
    for (let batch = 0; batch < capacityCase.count / capacityCase.batchSize; batch++) {
      const messages = Array.from({ length: capacityCase.batchSize }, (_, offset) => {
        const index = batch * capacityCase.batchSize + offset;
        return message(`capacity-source-${index}`, capacityCase.source(index));
      });
      if (batch === 1 && fault === 'capacity-second-malformed-extraction') capacityModes.extract = 'malformed';
      if (batch === 1 && fault === 'capacity-second-classification-failure') capacityModes.classify = 'fail';
      captured = await captureTracked(capacityStore.core,
        captureInput(`capacity-batch-${batch}`, messages), 'capacity1025', batch);
      if (!captured.response.ok && batch === 1 && fault === 'capacity-second-malformed-extraction') {
        const cold = await timeRead(() => { capacityStore.reopen();
          return capacityStore.core.list({ namespace, limit: 100 }); });
        const expected = admitted.map(row => ({ id: row.memory.id, revision: row.expectedRevision }));
        if (cold.ok && cold.value.exhausted &&
            sameColdMemoryIdentities(expected, cold.value.memories)) {
          report.batchOutcomes.capacity1025[batch].admitted = 0;
        }
      }
      if (captured.value?.admission?.memories.length) {
        report.cases[1].eligibleMemories = admitted.length + captured.value.admission.memories.length;
      }
      if (batch === 1 && fault === 'capacity-second-classification-failure' &&
          captured.value?.classification.status === 'failed') {
        const coldReceipts = await timeRead(() => {
          capacityStore.reopen();
          return captured.value.admission.memories.filter((memory, index) => {
            const detail = capacityStore.core.get({ namespace, memoryId: memory.id });
            return detail.ok && detail.value.receipts.some(receipt => receipt.excerpt === messages[index].content);
          }).length;
        });
        report.batchOutcomes.capacity1025[batch].coldReceipts = coldReceipts;
        assertGate(coldReceipts === messages.length, 'capacity_post_admission_cold');
      }
      assertGate(captured.response.ok, 'capacity_capture');
      result = captured.value;
      assertGate(result.classification.status === 'applied', 'capacity_classification');
      assertGate(result.admission.memories.length === messages.length, 'capacity_admission');
      const classifiedRevisions = new Map(result.classification.memoryRevisions
        .map(({ memoryId, revision }) => [memoryId, revision]));
      admitted.push(...result.admission.memories.map((memory, index) => ({ memory,
        expectedRevision: classifiedRevisions.get(memory.id) ?? memory.revision,
        marker: messages[index].content.split(' ')[0], source: messages[index].content,
        sourceId: messages[index].id })));
      report.cases[1].eligibleMemories = admitted.length;
    }
    assertGate(admitted.length === capacityCase.count, 'capacity_total');
    const target = admitted.reduce((max, row) => row.memory.id > max.memory.id ? row : max);
    capacityStore.reopen();
    const capacityQuestion = { key: 'greatest-id-target', query: target.marker,
      marker: target.marker, requiredSource: target.source, sourceId: target.sourceId };
    const defaultRow = await timeRead(() => inspectQuestion(capacityStore, target.memory,
      capacityQuestion, 'default'));
    report.cases[1].questions[0] = { ...defaultRow, status: 'completed' };
    capacityStore.close();
    const optStore = opened(workspace, 'capacity.sqlite', scriptedModel(metrics), 'bounded-keyset-v1');
    const optRow = await timeRead(() => inspectQuestion(optStore, target.memory, capacityQuestion,
      'bounded-keyset-v1'));
    report.cases[1].questions[1] = { ...optRow, status: 'completed' };
    assertGate(defaultRow.stages.retained && !defaultRow.stages.referenceVisible &&
      defaultRow.firstMissing === 'candidate-visible' &&
      defaultRow.firstDeliveryFailure === 'reference-visible', 'capacity_default_prefix');
    assertGate(delivered(optRow) && optRow.stages.referenceVisible === true
      && optRow.routingCueVisible === true, 'capacity_optin_delivery');
    assertGate(optRow.recallCoverage === 'budget_exhausted', 'capacity_coverage');
    report.cases[1].status = 'completed';

    // Distinct dated decisions and stated reasons remain separate source receipts.
    report.cases[2].status = 'incomplete';
    const datedStore = opened(workspace, 'dated.sqlite', scriptedModel(metrics));
    dbPaths.push(datedStore.path);
    const datedMemories = [];
    for (const [index, source] of datedCase.sources.entries()) {
      captured = await captureTracked(datedStore.core, captureInput(source.id, [source]), 'datedAB', index);
      assertGate(captured.response.ok, 'dated_capture');
      result = captured.value;
      assertGate(result.admission.memories.length === 1 && result.classification.status === 'applied', 'dated_capture');
      datedMemories.push(result.admission.memories[0]);
      report.cases[2].choicesRetained = datedMemories.length;
    }
    datedStore.reopen();
    const datedRows = [];
    for (const [index, question] of datedCase.questions.entries()) {
      const row = await timeRead(() => inspectQuestion(datedStore, datedMemories[index],
        { ...question, requiredSource: datedCase.sources[index].content,
          sourceId: datedCase.sources[index].id, role: datedCase.sources[index].role }, 'default'));
      datedRows.push(row);
      report.cases[2].questions[index] = { ...row, status: 'completed' };
    }
    assertGate(datedRows.every(delivered), 'dated_delivery');
    const snapshot = await timeRead(() => ok(datedStore.core.sourceSnapshot({ readSet: [namespace], limit: 6 })));
    assertGate(datedCase.questions.every(question => snapshot.memories.some(row =>
      passageIn(row.receipts, question.marker))), 'dated_both_retained');
    report.cases[2].status = 'completed';

    const controlStart = performance.now();
    try { await runFaultControls(workspace, metrics, dbPaths, report); }
    finally { controlMs += performance.now() - controlStart; }
    finishReport();
    assertGate(report.expectedNegativeCount === report.denominators.negativeControls, 'negative_controls');
    const allRows = report.cases.flatMap(row => row.questions);
    assertGate(allRows.length === report.denominators.requiredPassages, 'passage_denominator');
    // Closing releases WAL resources and gives a stable final size.
    await workspace.cleanup();
    finishReport();
    return report;
  } catch (error) {
    report.unexpectedCount++;
    report.failure = /^gate_[a-z_]+$/u.test(error?.message ?? '') ? error.message : 'unexpected_error';
    finishReport();
    try { await workspace.cleanup(); }
    catch { report.failure = 'workspace_cleanup_failed'; }
    finishReport();
    return report;
  }
}

async function runFaultControls(workspace, metrics, dbPaths, report) {
  const controls = report.controls, outcomes = report.batchOutcomes.faultControls;
  const stageRows = report.controlStages;
  const record = (control, result) => { outcomes[faultBatchNames.indexOf(control)] = { control, ...result }; };
  const captureFault = async (control, store, input, observer = null) => {
    let response;
    try { response = await (observer ? observer.capture(store.core, input) : store.core.capture(input)); }
    catch (error) { record(control, { capture: 'failed', admitted: null, classification: 'not-run' }); throw error; }
    const value = response.ok ? response.value : null;
    const classification = value?.classification?.status ?? 'not-run';
    record(control, { capture: !response.ok ? 'failed' : classification === 'failed'
      ? 'completed-post-admission-failure' : 'completed',
    admitted: value?.admission?.memories.length ?? null, classification });
    return response;
  };
  const fixture = (filename, modes = {}) => {
    const store = opened(workspace, filename, scriptedModel(metrics, modes));
    dbPaths.push(store.path);
    return { store };
  };
  let test = fixture('malformed.sqlite', { extract: 'malformed' });
  let response = await captureFault('malformedExtraction', test.store,
    captureInput('malformed', [message('fault-0', 'faultmarker malformed source')]));
  test.store.reopen();
  controls.malformedExtraction = response.ok === false && response.error.code === 'invalid_model_output'
    && ok(test.store.core.list({ namespace })).memories.length === 0;
  if (controls.malformedExtraction) outcomes[faultBatchNames.indexOf('malformedExtraction')].admitted = 0;
  stageRows.malformedExtraction = { retained: false, candidateVisible: 'not-run',
    selected: 'not-run', ranked: 'not-run', finalReturned: 'not-run', answerContextPresent: 'not-run' };

  test = fixture('failed-classify.sqlite', { classify: 'fail' });
  response = ok(await captureFault('failedClassification', test.store,
    captureInput('failed-classify', [message('fault-1', 'faultmarker retained source')])));
  test.store.reopen();
  const failedSourceRetained = passageIn(ok(test.store.core.get({ namespace,
    memoryId: response.admission.memories[0].id })).receipts, 'faultmarker');
  controls.failedClassification = response.classification.status === 'failed' && failedSourceRetained;
  stageRows.failedClassification = { retained: failedSourceRetained,
    candidateVisible: 'not-run', selected: 'not-run', ranked: 'not-run',
    finalReturned: 'not-run', answerContextPresent: 'not-run' };

  test = fixture('omitted.sqlite', { extract: 'omit' });
  const omittedWindowObserver = createIndexedSourceWindowObserver();
  response = ok(await captureFault('omittedSource', test.store,
    captureInput('omitted', [message('fault-2', 'faultmarker omitted source')]), omittedWindowObserver));
  test.store.reopen();
  report.sourceWindowCoverage.omittedSource = omittedWindowObserver.finish({
    inspectAdmission: input => test.store.core.inspectAdmission(input),
    get: input => test.store.core.get(input),
  });
  assertGate(report.sourceWindowCoverage.omittedSource.status === 'observed' &&
    report.sourceWindowCoverage.omittedSource.coverage === 'none' &&
    report.sourceWindowCoverage.omittedSource.uniqueUnmatchedCount === 1,
  'omitted_source_window_coverage');
  controls.omittedSource = response.admission.memories.length === 0 &&
    ok(test.store.core.list({ namespace })).memories.length === 0;
  stageRows.omittedSource = { retained: false, candidateVisible: 'not-run',
    selected: 'not-run', ranked: 'not-run', finalReturned: 'not-run', answerContextPresent: 'not-run' };

  for (const [name, modes] of [['emptySelection', { select: 'empty' }], ['emptyRank', { rank: 'empty' }]]) {
    test = fixture(`${name}.sqlite`, modes);
    response = ok(await captureFault(name, test.store,
      captureInput(name, [message(`fault-${name}`, 'faultmarker control source')])));
    test.store.reopen();
    const row = await inspectQuestion(test.store, response.admission.memories[0],
      { key: name, query: 'faultmarker', marker: 'faultmarker',
        requiredSource: 'faultmarker control source', sourceId: `fault-${name}` }, 'default');
    stageRows[name] = { ...row.stages, firstDeliveryFailure: row.firstDeliveryFailure };
    controls[name] = row.firstDeliveryFailure === (name === 'emptySelection' ? 'selected' : 'ranked') &&
      row.stages.answerContextPresent === 'not-run';
  }

  test = fixture('lifecycle.sqlite');
  response = ok(await captureFault('lifecycle', test.store,
    captureInput('lifecycle', [message('fault-lifecycle', 'faultmarker original source')])));
  const original = response.admission.memories[0];
  const corrected = ok(test.store.core.correct({ namespace, memoryId: original.id,
    expectedRevision: original.revision, content: 'memory correctionmarker', kind: 'context',
    receipt: { client: 'synthetic-gate', sessionId: 'long-history', eventId: 'correction',
      role: 'user', excerpt: 'correctionmarker corrected source' } }));
  test.store.reopen();
  const detail = ok(test.store.core.get({ namespace, memoryId: original.id }));
  const correctedRecall = ok(await test.store.core.recall({ readSet: [namespace], query: 'correctionmarker',
    contextMode: 'source-evidence', limit: 6 }));
  const staleRecall = ok(await test.store.core.recall({ readSet: [namespace], query: 'faultmarker',
    contextMode: 'source-evidence', limit: 6 }));
  const revised = detail.memory.revision > original.revision;
  const correctedSourcePresent = passageIn(detail.receipts, 'correctionmarker') &&
    correctedRecall.memories.some(row => passageIn(row.receipts, 'correctionmarker'));
  const staleSourceAbsent = !passageIn(detail.receipts, 'faultmarker') &&
    !staleRecall.memories.some(row => passageIn(row.receipts, 'faultmarker'));
  controls.correction = revised && correctedSourcePresent && staleSourceAbsent;
  stageRows.correction = { status: 'completed', revised, correctedSourcePresent, staleSourceAbsent };
  const otherRecall = ok(await test.store.core.recall({ readSet: [otherNamespace], query: 'correctionmarker',
    contextMode: 'source-evidence', limit: 6 }));
  const foreignGetDenied = test.store.core.get({ namespace: otherNamespace,
    memoryId: original.id }).error?.code === 'memory_not_found';
  const foreignRecallEmpty = otherRecall.memories.length === 0;
  controls.namespace = foreignGetDenied && foreignRecallEmpty;
  stageRows.namespace = { status: 'completed', foreignGetDenied, foreignRecallEmpty };
  ok(test.store.core.forget({ namespace, memoryId: original.id,
    expectedRevision: corrected.memory.revision }));
  test.store.reopen();
  const forgotten = test.store.core.get({ namespace, memoryId: original.id });
  const recall = ok(await test.store.core.recall({ readSet: [namespace], query: 'faultmarker',
    contextMode: 'source-evidence', limit: 6 }));
  const forgottenGetDenied = forgotten.error?.code === 'memory_not_found';
  const oldSourceAbsent = !recall.memories.some(row => passageIn(row.receipts, 'faultmarker'));
  const correctedSourceAbsent = !ok(await test.store.core.recall({ readSet: [namespace], query: 'correctionmarker',
    contextMode: 'source-evidence', limit: 6 })).memories.some(row => passageIn(row.receipts, 'correctionmarker'));
  controls.forgetting = forgottenGetDenied && oldSourceAbsent && correctedSourceAbsent;
  stageRows.forgetting = { status: 'completed', forgottenGetDenied, oldSourceAbsent, correctedSourceAbsent };
}
