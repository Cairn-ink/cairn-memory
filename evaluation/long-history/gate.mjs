import { statSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { openMemoryCore } from '../../core/contract.mjs';
import { countOpenAITokens } from '../../adapters/openai/index.mjs';
import { packMixedAnswer } from '../longmemeval/mixed-answer.mjs';
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

// This control sees only its invocation's model input. Evaluation expectations,
// target IDs and the store stay in the runner, never on this object.
function scriptedModel(metrics, frames, modes = {}) {
  const observe = (method, request, output) => {
    metrics.calls[method]++;
    metrics.inputTokens += token(JSON.stringify({ system: request.system, input: request.input }));
    metrics.outputTokens += token(JSON.stringify(output));
    if (method === 'select' || method === 'rank') frames.push({ method,
      input: structuredClone(request.input), output: structuredClone(output) });
    return output;
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

function observePassage({ frames, recall, core, memory, marker, requiredSource, question, expectedRefType }) {
  const detail = ok(core.get({ namespace, memoryId: memory.id }));
  const exactSourceIn = receipts => receipts?.some(row => row.excerpt === requiredSource) ?? false;
  const retained = exactSourceIn(detail.receipts);
  const selectFrames = frames.filter(frame => frame.method === 'select');
  const visibleRows = selectFrames.flatMap(frame => frame.input.maps.flatMap(map => map.items.map(item => ({
    item, ref: refFromMap(item, map.namespaceIndex),
  }))));
  const matchingRef = visibleRows.filter(row => row.ref?.memoryId === memory.id);
  const referenceVisible = matchingRef.length > 0;
  const routingCueVisible = matchingRef.some(row => row.item.label?.includes(marker));
  const candidateVisible = matchingRef.some(row => row.item.label?.includes(requiredSource));
  const selected = selectFrames.some(frame => frame.output.refs.some(ref => ref.memoryId === memory.id));
  const rankFrames = frames.filter(frame => frame.method === 'rank');
  const rankInputSourceVisible = rankFrames.some(frame => frame.input.candidates.some(candidate =>
    candidate.memory.id === memory.id && exactSourceIn(candidate.receipts)));
  const ranked = rankFrames.some(frame => frame.output.refs.some(ref => ref.memoryId === memory.id));
  const finalReturned = recall.ok && recall.value.memories.some(item => item.memory.id === memory.id &&
    exactSourceIn(item.receipts));
  let answerContextPresent = false;
  let packedTokens = 0;
  if (recall.ok) {
    const units = recall.value.memories.map(item => ({ text: item.receipts.map(receipt => receipt.excerpt).join('\n') }));
    const packed = packMixedAnswer({ question: { text: question, date: '2026-09-28' }, units, countTokens: token });
    answerContextPresent = JSON.parse(packed.request.messages[1].content).evidence
      .some(unit => unit.text.includes(requiredSource));
    packedTokens = packed.totalEstimatedTokens;
  }
  const stages = { retained,
    referenceVisible: retained ? referenceVisible : 'not-run',
    candidateVisible: retained ? candidateVisible : 'not-run',
    selected: referenceVisible ? selected : 'not-run',
    rankInputSourceVisible: selected ? rankInputSourceVisible : 'not-run',
    ranked: rankInputSourceVisible ? ranked : 'not-run',
    finalReturned: ranked ? finalReturned : 'not-run',
    answerContextPresent: finalReturned ? answerContextPresent : 'not-run' };
  const firstMissing = !retained ? 'retained' : !candidateVisible ? 'candidate-visible'
    : !selected ? 'selected' : !rankInputSourceVisible ? 'rank-input-source-visible'
      : !ranked ? 'ranked' : !finalReturned ? 'final-returned'
        : !answerContextPresent ? 'answer-context-present' : null;
  const firstDeliveryFailure = !retained ? 'retained' : !referenceVisible ? 'reference-visible'
    : !selected ? 'selected' : !rankInputSourceVisible ? 'rank-input-source-visible'
      : !ranked ? 'ranked' : !finalReturned ? 'final-returned'
        : !answerContextPresent ? 'answer-context-present' : null;
  const deliverySucceeded = retained && selected && rankInputSourceVisible && ranked &&
    finalReturned && answerContextPresent;
  return { stages, routingCueVisible, firstMissing, firstDeliveryFailure,
    deliverySucceeded, packedTokens,
    ...(expectedRefType ? { expectedRefTypeObserved: matchingRef.some(row => row.item.type === expectedRefType) } : {}) };
}

async function inspectQuestion(store, modelFrames, memory, question, policy, expectedRefType) {
  modelFrames.length = 0;
  const recall = await store.core.recall({ readSet: [namespace], query: question.query,
    contextMode: 'source-evidence', limit: 6 });
  const observed = observePassage({ frames: modelFrames, recall, core: store.core,
    memory, marker: question.marker, requiredSource: question.requiredSource,
    question: question.query, expectedRefType });
  return { key: question.key, policy, ...observed, recallOk: recall.ok,
    recallCoverage: recall.ok ? recall.value.coverage : 'not-run' };
}

function assertGate(condition, code) { if (!condition) throw new Error(`gate_${code}`); }
const delivered = row => ['retained', 'selected', 'rankInputSourceVisible',
  'ranked', 'finalReturned', 'answerContextPresent'].every(stage => row.stages[stage] === true);

export async function runGate() {
  const workspace = createTestWorkspace(null, { prefix: 'cairn-long-history-' });
  const metrics = metric();
  const report = { version: VERSION, control: 'offline-scripted-visible-input-only',
    cases: [], batchOutcomes: { longWindows: [], capacity1025: [], datedAB: [], faultControls: [] },
    controls: {}, controlStages: {}, denominators: { requiredPassages: 7, captureBatches: 0,
      admittedMemories: 0, negativeControls: Object.keys(faultControls).length },
    stages: {}, calls: metrics.calls, tokens: {}, elapsedMs: {}, finalDatabaseBytes: 0,
    expectedNegativeCount: 0, unexpectedCount: 0 };
  const dbPaths = [];
  // Deferred callbacks run in reverse order: close every store, then measure
  // stable SQLite files, then let the owned workspace remove them.
  workspace.defer(() => { report.finalDatabaseBytes = dbPaths.reduce((sum, path) => sum + statSync(path).size, 0); });
  const start = performance.now();
  let writeMs = 0, readMs = 0;
  try {
    // Three source windows; the classifier proposes a real L1 for the first memory.
    const longFrames = [];
    const longStore = opened(workspace, 'long.sqlite', scriptedModel(metrics, longFrames));
    dbPaths.push(longStore.path);
    let phase = performance.now();
    let result = ok(await longStore.core.capture(captureInput('long', longCase.messages)));
    writeMs += performance.now() - phase;
    report.denominators.captureBatches++;
    report.denominators.admittedMemories += result.admission.memories.length;
    report.batchOutcomes.longWindows.push({ capture: 'completed', admitted: result.admission.memories.length,
      classification: result.classification.status });
    assertGate(result.classification.status === 'applied', 'long_classification');
    assertGate(result.sourceWindowCatalog.windowCount === longCase.expectedWindowCount, 'window_count');
    assertGate(result.admission.memories.length === 3, 'long_admission');
    const longMemories = result.admission.memories;
    longStore.reopen();
    phase = performance.now();
    const longRows = [];
    for (const [index, question] of longCase.questions.entries()) {
      const requiredSource = longCase.messages[0].content.slice(index * 800, (index + 1) * 800).trimEnd();
      longRows.push(await inspectQuestion(longStore, longFrames, longMemories[index],
        { ...question, requiredSource },
        'default', index === 0 ? 'ref' : undefined));
    }
    assertGate(longRows.every(delivered), 'long_delivery');
    assertGate(longRows.every(row => row.stages.referenceVisible && row.routingCueVisible
      && row.stages.candidateVisible === false && row.firstMissing === 'candidate-visible'),
    'long_preview_boundary');
    assertGate(longRows[0].expectedRefTypeObserved, 'filed_ref');
    readMs += performance.now() - phase;
    report.cases.push({ family: longCase.name, sourceWindows: 3, questions: longRows });

    // All 1,025 memories are admitted through capture; target is fixed by max ID
    // after all writes and before either recall. Both policies read this cold DB.
    const capacityFrames = [];
    const capacityModel = scriptedModel(metrics, capacityFrames);
    const capacityStore = opened(workspace, 'capacity.sqlite', capacityModel);
    dbPaths.push(capacityStore.path);
    const admitted = [];
    phase = performance.now();
    for (let batch = 0; batch < capacityCase.count / capacityCase.batchSize; batch++) {
      const messages = Array.from({ length: capacityCase.batchSize }, (_, offset) => {
        const index = batch * capacityCase.batchSize + offset;
        return message(`capacity-source-${index}`, capacityCase.source(index));
      });
      result = ok(await capacityStore.core.capture(captureInput(`capacity-batch-${batch}`, messages)));
      report.denominators.captureBatches++;
      report.denominators.admittedMemories += result.admission.memories.length;
      report.batchOutcomes.capacity1025.push({ capture: 'completed', admitted: result.admission.memories.length,
        classification: result.classification.status });
      assertGate(result.classification.status === 'applied' &&
        result.admission.memories.length === messages.length, 'capacity_capture');
      admitted.push(...result.admission.memories.map((memory, index) => ({ memory,
        marker: messages[index].content.split(' ')[0], source: messages[index].content })));
    }
    assertGate(admitted.length === capacityCase.count, 'capacity_total');
    writeMs += performance.now() - phase;
    const target = admitted.reduce((max, row) => row.memory.id > max.memory.id ? row : max);
    capacityStore.reopen();
    phase = performance.now();
    const capacityQuestion = { key: 'greatest-id-target', query: target.marker,
      marker: target.marker, requiredSource: target.source };
    const defaultRow = await inspectQuestion(capacityStore, capacityFrames, target.memory,
      capacityQuestion, 'default');
    capacityStore.close();
    const optFrames = [];
    const optStore = opened(workspace, 'capacity.sqlite', scriptedModel(metrics, optFrames), 'bounded-keyset-v1');
    const optRow = await inspectQuestion(optStore, optFrames, target.memory, capacityQuestion,
      'bounded-keyset-v1');
    assertGate(defaultRow.stages.retained && !defaultRow.stages.referenceVisible &&
      defaultRow.firstMissing === 'candidate-visible' &&
      defaultRow.firstDeliveryFailure === 'reference-visible', 'capacity_default_prefix');
    assertGate(delivered(optRow) && optRow.stages.referenceVisible === true
      && optRow.routingCueVisible === true, 'capacity_optin_delivery');
    assertGate(optRow.recallCoverage === 'budget_exhausted', 'capacity_coverage');
    readMs += performance.now() - phase;
    report.cases.push({ family: capacityCase.name, eligibleMemories: admitted.length,
      candidateTopLimit: 1024, targetRule: capacityCase.targetRule,
      questions: [defaultRow, optRow] });

    // Distinct dated decisions and stated reasons remain separate source receipts.
    const datedFrames = [];
    const datedStore = opened(workspace, 'dated.sqlite', scriptedModel(metrics, datedFrames));
    dbPaths.push(datedStore.path);
    const datedMemories = [];
    phase = performance.now();
    for (const source of datedCase.sources) {
      result = ok(await datedStore.core.capture(captureInput(source.id, [source])));
      report.denominators.captureBatches++;
      report.denominators.admittedMemories += result.admission.memories.length;
      report.batchOutcomes.datedAB.push({ capture: 'completed', admitted: result.admission.memories.length,
        classification: result.classification.status });
      assertGate(result.admission.memories.length === 1 && result.classification.status === 'applied', 'dated_capture');
      datedMemories.push(result.admission.memories[0]);
    }
    writeMs += performance.now() - phase;
    datedStore.reopen();
    phase = performance.now();
    const datedRows = [];
    for (const [index, question] of datedCase.questions.entries()) {
      datedRows.push(await inspectQuestion(datedStore, datedFrames, datedMemories[index],
        { ...question, requiredSource: datedCase.sources[index].content }, 'default'));
    }
    assertGate(datedRows.every(delivered), 'dated_delivery');
    const snapshot = ok(datedStore.core.sourceSnapshot({ readSet: [namespace], limit: 6 }));
    assertGate(datedCase.questions.every(question => snapshot.memories.some(row =>
      passageIn(row.receipts, question.marker))), 'dated_both_retained');
    readMs += performance.now() - phase;
    report.cases.push({ family: datedCase.name, choicesRetained: 2,
      currentChoiceJudgment: 'not-assessed', questions: datedRows });

    report.elapsedMs.write = Math.round(writeMs);
    report.elapsedMs.read = Math.round(readMs);
    const controlStart = performance.now();
    const faultRun = await runFaultControls(workspace, metrics, dbPaths);
    report.controls = faultRun.controls;
    report.controlStages = faultRun.stageRows;
    report.batchOutcomes.faultControls = faultRun.outcomes;
    report.elapsedMs.controls = Math.round(performance.now() - controlStart);
    report.expectedNegativeCount = Object.values(report.controls).filter(Boolean).length;
    assertGate(report.expectedNegativeCount === report.denominators.negativeControls, 'negative_controls');
    const allRows = report.cases.flatMap(row => row.questions);
    assertGate(allRows.length === report.denominators.requiredPassages, 'passage_denominator');
    for (const stage of ['retained', 'referenceVisible', 'candidateVisible', 'selected',
      'rankInputSourceVisible', 'ranked', 'finalReturned', 'answerContextPresent']) {
      report.stages[stage] = allRows.filter(row => row.stages[stage] === true).length;
    }
    report.tokens = { inputTokens: metrics.inputTokens, outputTokens: metrics.outputTokens,
      tokenizerCalls: metrics.tokenizerCalls, tokenizerTokens: metrics.tokenizerTokens };
    report.elapsedMs.total = Math.round(performance.now() - start);
    // Closing releases WAL resources and gives a stable final size.
    await workspace.cleanup();
    return report;
  } catch (error) {
    report.unexpectedCount++;
    report.failure = /^gate_[a-z_]+$/u.test(error?.message ?? '') ? error.message : 'unexpected_error';
    report.tokens = { inputTokens: metrics.inputTokens, outputTokens: metrics.outputTokens,
      tokenizerCalls: metrics.tokenizerCalls, tokenizerTokens: metrics.tokenizerTokens };
    report.elapsedMs.write = Math.round(writeMs);
    report.elapsedMs.read = Math.round(readMs);
    report.elapsedMs.total = Math.round(performance.now() - start);
    try { await workspace.cleanup(); }
    catch { report.failure = 'workspace_cleanup_failed'; }
    return report;
  }
}

async function runFaultControls(workspace, metrics, dbPaths) {
  const controls = {}, outcomes = [], stageRows = {};
  const fixture = (filename, modes = {}) => {
    const frames = [];
    const store = opened(workspace, filename, scriptedModel(metrics, frames, modes));
    dbPaths.push(store.path);
    return { store, frames };
  };
  let test = fixture('malformed.sqlite', { extract: 'malformed' });
  let response = await test.store.core.capture(captureInput('malformed', [message('fault-0', 'faultmarker malformed source')]));
  outcomes.push({ control: 'malformedExtraction', admitted: 0, classification: 'not-run',
    capture: response.ok ? 'completed' : 'failed' });
  test.store.reopen();
  controls.malformedExtraction = response.ok === false && response.error.code === 'invalid_model_output'
    && ok(test.store.core.list({ namespace })).memories.length === 0;
  stageRows.malformedExtraction = { retained: false, candidateVisible: 'not-run',
    selected: 'not-run', ranked: 'not-run', finalReturned: 'not-run', answerContextPresent: 'not-run' };

  test = fixture('failed-classify.sqlite', { classify: 'fail' });
  response = ok(await test.store.core.capture(captureInput('failed-classify', [message('fault-1', 'faultmarker retained source')])));
  outcomes.push({ control: 'failedClassification', admitted: response.admission.memories.length,
    classification: response.classification.status, capture: 'completed-post-admission-failure' });
  test.store.reopen();
  controls.failedClassification = response.classification.status === 'failed' &&
    passageIn(ok(test.store.core.get({ namespace, memoryId: response.admission.memories[0].id })).receipts, 'faultmarker');
  stageRows.failedClassification = { retained: controls.failedClassification,
    candidateVisible: 'not-run', selected: 'not-run', ranked: 'not-run',
    finalReturned: 'not-run', answerContextPresent: 'not-run' };

  test = fixture('omitted.sqlite', { extract: 'omit' });
  response = ok(await test.store.core.capture(captureInput('omitted', [message('fault-2', 'faultmarker omitted source')])));
  outcomes.push({ control: 'omittedSource', admitted: response.admission.memories.length,
    classification: response.classification.status, capture: 'completed' });
  test.store.reopen();
  controls.omittedSource = response.admission.memories.length === 0 &&
    ok(test.store.core.list({ namespace })).memories.length === 0;
  stageRows.omittedSource = { retained: false, candidateVisible: 'not-run',
    selected: 'not-run', ranked: 'not-run', finalReturned: 'not-run', answerContextPresent: 'not-run' };

  for (const [name, modes] of [['emptySelection', { select: 'empty' }], ['emptyRank', { rank: 'empty' }]]) {
    test = fixture(`${name}.sqlite`, modes);
    response = ok(await test.store.core.capture(captureInput(name, [message(`fault-${name}`, 'faultmarker control source')])));
    outcomes.push({ control: name, admitted: response.admission.memories.length,
      classification: response.classification.status, capture: 'completed' });
    test.store.reopen();
    const row = await inspectQuestion(test.store, test.frames, response.admission.memories[0],
      { key: name, query: 'faultmarker', marker: 'faultmarker',
        requiredSource: 'faultmarker control source' }, 'default');
    stageRows[name] = { ...row.stages, firstDeliveryFailure: row.firstDeliveryFailure };
    controls[name] = row.firstDeliveryFailure === (name === 'emptySelection' ? 'selected' : 'ranked') &&
      row.stages.answerContextPresent === 'not-run';
  }

  test = fixture('lifecycle.sqlite');
  response = ok(await test.store.core.capture(captureInput('lifecycle', [message('fault-lifecycle', 'faultmarker original source')])));
  outcomes.push({ control: 'lifecycle', admitted: response.admission.memories.length,
    classification: response.classification.status, capture: 'completed' });
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
  controls.correction = detail.memory.revision > original.revision &&
    passageIn(detail.receipts, 'correctionmarker') && !passageIn(detail.receipts, 'faultmarker') &&
    correctedRecall.memories.some(row => passageIn(row.receipts, 'correctionmarker')) &&
    !staleRecall.memories.some(row => passageIn(row.receipts, 'faultmarker'));
  const otherRecall = ok(await test.store.core.recall({ readSet: [otherNamespace], query: 'correctionmarker',
    contextMode: 'source-evidence', limit: 6 }));
  controls.namespace = test.store.core.get({ namespace: otherNamespace, memoryId: original.id }).error?.code === 'memory_not_found'
    && otherRecall.memories.length === 0;
  ok(test.store.core.forget({ namespace, memoryId: original.id,
    expectedRevision: corrected.memory.revision }));
  test.store.reopen();
  const forgotten = test.store.core.get({ namespace, memoryId: original.id });
  const recall = ok(await test.store.core.recall({ readSet: [namespace], query: 'faultmarker',
    contextMode: 'source-evidence', limit: 6 }));
  controls.forgetting = forgotten.error?.code === 'memory_not_found' &&
    !recall.memories.some(row => passageIn(row.receipts, 'faultmarker')) &&
    !ok(await test.store.core.recall({ readSet: [namespace], query: 'correctionmarker',
      contextMode: 'source-evidence', limit: 6 })).memories.some(row => passageIn(row.receipts, 'correctionmarker'));
  return { controls, outcomes, stageRows };
}
