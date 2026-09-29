import { AsyncLocalStorage } from 'node:async_hooks';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { openMemoryCore } from '../../core/contract.mjs';
import { captureSnapshot } from '../../core/capture-input.mjs';
import { sourceWindowCatalog } from '../../core/source-windows.mjs';
import { createQueryScore } from '../../core/query-candidates.mjs';
import { countOpenAITokens } from '../../adapters/openai/index.mjs';
import { packMixedAnswer } from '../longmemeval/mixed-answer.mjs';
import { createIndexedSourceWindowObserver } from './source-window-coverage.mjs';
import { createRetainedRecallTrace } from '../long-history/recall-observation.mjs';
import { batches, client, correctedBasalt, namespace, otherNamespace, questions, sessionId,
  sourceText } from './retained-window-control-fixture.mjs';

const scope = new AsyncLocalStorage();
const token = text => countOpenAITokens(text);
const checked = result => {
  if (!result?.ok) throw new Error(`core_${result?.error?.code ?? 'failure'}`);
  return result.value;
};
const limits = { callbackTokens: 2_000_000, counterTokens: 32_000_000 };
const metrics = () => ({ calls: { extract: 0, classify: 0, select: 0, rank: 0 },
  callbackInputTokens: 0, callbackOutputTokens: 0, counterCalls: 0, counterTokens: 0 });
const sharedMetrics = (counterCeiling = limits.counterTokens) => ({ callbackTokens: 0,
  counterTokens: 0, counterCeiling, exceeded: null });
function meteredToken(measure, shared, text) {
  const count = token(text);
  measure.counterCalls++;
  measure.counterTokens += count;
  shared.counterTokens += count;
  if (shared.counterTokens > shared.counterCeiling) {
    shared.exceeded = 'counter';
    throw new Error('control_counter_token_limit');
  }
  return count;
}

const mapRef = (item, namespaceIndex) => item.type === 'unfiled'
  ? { namespaceIndex, ...item.ref }
  : item.type === 'ref' && item.ref.childType === 'memory'
    ? { namespaceIndex, memoryId: item.ref.childId, revision: item.ref.childRevision } : null;

/** Query-only scripted callbacks: no fixture, source handles, gold or store closure. */
export function scriptedModel(measure, shared) {
  const observed = (method, request, output) => {
    measure.calls[method]++;
    const inputTokens = meteredToken(measure, shared,
      JSON.stringify({ system: request.system, input: request.input }));
    const outputTokens = meteredToken(measure, shared, JSON.stringify(output));
    measure.callbackInputTokens += inputTokens;
    measure.callbackOutputTokens += outputTokens;
    shared.callbackTokens += inputTokens + outputTokens;
    if (shared.callbackTokens > limits.callbackTokens) {
      shared.exceeded = 'callback';
      throw new Error('control_callback_token_limit');
    }
    if (method === 'select' || method === 'rank') {
      for (const trace of scope.getStore()?.traces ?? []) {
        try { method === 'select' ? trace.recordSelect(request, output) : trace.recordRank(request, output); }
        catch { /* Observation is never allowed to change a model callback. */ }
      }
    }
    return output;
  };
  return {
    contextWindow: 16_384,
    countTokens(text) { return meteredToken(measure, shared, text); },
    extract(request) {
      return observed('extract', request, { items: request.input.messages.slice(0, 5)
        .map(message => ({ content: message.content, kind: 'context', confidence: 1,
          sourceIndices: [message.index] })) });
    },
    classify(request) {
      return observed('classify', request, { items: request.input.memories.map(memory =>
        ({ memoryId: memory.id, parentIds: [] })) });
    },
    select(request) {
      const score = createQueryScore(request.input.query);
      const rows = request.input.maps.flatMap(map => map.items.map(item => ({
        ref: mapRef(item, map.namespaceIndex), score: score(item.label ?? ''),
      }))).filter(row => row.ref && row.score > 0);
      rows.sort((a, b) => b.score - a.score);
      const perNamespace = new Map();
      const refs = [];
      for (const row of rows) {
        const count = perNamespace.get(row.ref.namespaceIndex) ?? 0;
        if (count >= 12) continue;
        refs.push(row.ref);
        perNamespace.set(row.ref.namespaceIndex, count + 1);
        if (refs.length >= Math.min(request.input.maxRefs, 24)) break;
      }
      return observed('select', request, { refs });
    },
    rank(request) {
      const score = createQueryScore(request.input.query);
      const rows = request.input.candidates.map(candidate => ({ candidate,
        score: Math.max(0, ...candidate.receipts.map(receipt => score(receipt.excerpt))) }))
        .filter(row => row.score > 0);
      rows.sort((a, b) => b.score - a.score);
      const refs = rows.slice(0, Math.min(request.input.limit, 6)).map(({ candidate }) => ({
        namespaceIndex: candidate.namespaceIndex, memoryId: candidate.memory.id,
        revision: candidate.memory.revision,
      }));
      return observed('rank', request, { refs });
    },
  };
}

function preflight() {
  const seen = new Set();
  for (const batch of batches) {
    const snapshot = captureSnapshot(batch, undefined, 'indexed-evidence-v1');
    const catalog = sourceWindowCatalog(snapshot);
    if (catalog.entries.length !== 6) throw new Error('fixture_window_count');
    for (const entry of catalog.entries) {
      if (entry.content.length < 96 || entry.content.length > 180 || seen.has(entry.content)) {
        throw new Error('fixture_source_bounds');
      }
      seen.add(entry.content);
    }
  }
  if (seen.size !== 300) throw new Error('fixture_source_count');
  if ([...seen].some(content => content.includes('silver telescope'))) {
    throw new Error('fixture_absent_answer_nonfit');
  }
  return 300;
}

function opened(workspace, name, model) {
  const path = join(workspace.path, name);
  const options = { path, model, captureSourcePolicy: 'indexed-evidence-v1',
    sourceCandidatePolicy: 'bounded-keyset-v1' };
  let core = openMemoryCore(options);
  workspace.defer(() => { core?.close(); core = null; });
  return { path, get core() { return core; }, close() { core?.close(); core = null; },
    reopen() { core?.close(); core = openMemoryCore(options); return core; } };
}

const receiptKey = receipt => JSON.stringify([receipt.client, receipt.sessionId,
  receipt.eventId, receipt.role, receipt.excerpt]);

/** Recall projects source receipts to id/role/excerpt, unlike full get receipts. */
export function forbiddenSourceReturned(memories, { memoryId, receiptId, role, excerpt }) {
  return memories.some(row => row.memory?.id === memoryId || row.receipts?.some(receipt =>
    receipt.id === receiptId && receipt.role === role && receipt.excerpt === excerpt));
}

function coldIndex(core) {
  const memories = [];
  let cursor;
  for (;;) {
    const page = checked(core.list({ namespace, limit: 100, ...(cursor ? { cursor } : {}) }));
    memories.push(...page.memories);
    if (page.exhausted) break;
    if (!page.nextCursor) throw new Error('list_incomplete');
    cursor = page.nextCursor;
  }
  const byReceipt = new Map();
  let receiptCount = 0;
  for (const memory of memories) {
    const receipts = [];
    let receiptCursor;
    for (;;) {
      const page = checked(core.get({ namespace, memoryId: memory.id,
        receiptLimit: 100, ...(receiptCursor ? { receiptCursor } : {}) }));
      if (page.memory.revision !== memory.revision) throw new Error('cold_revision_changed');
      receipts.push(...page.receipts);
      if (page.exhausted) break;
      if (!page.nextReceiptCursor) throw new Error('receipts_incomplete');
      receiptCursor = page.nextReceiptCursor;
    }
    receiptCount += receipts.length;
    for (const receipt of receipts) {
      const key = receiptKey(receipt);
      if (byReceipt.has(key)) throw new Error('duplicate_receipt_identity');
      byReceipt.set(key, { memoryId: memory.id, revision: memory.revision, receipt });
    }
  }
  return { cards: memories.length, receipts: receiptCount, byReceipt };
}

function verifyColdIdentity(baselineIndex, controlIndex) {
  const baselineExpected = new Set(), controlExpected = new Set();
  for (const batch of batches) {
    const catalog = sourceWindowCatalog(captureSnapshot(batch, undefined, 'indexed-evidence-v1'));
    for (const entry of catalog.entries) {
      const key = receiptKey({ client, sessionId, eventId: entry.id,
        role: entry.role, excerpt: entry.content });
      controlExpected.add(key);
      if (entry.index < 5) baselineExpected.add(key);
    }
  }
  const exact = (actual, expected) => actual.size === expected.size &&
    [...expected].every(key => actual.has(key));
  if (baselineExpected.size !== 250 || controlExpected.size !== 300 ||
      !exact(baselineIndex.byReceipt, baselineExpected) ||
      !exact(controlIndex.byReceipt, controlExpected)) throw new Error('cold_source_identity_nonfit');
  return { baseline: baselineExpected.size, control: controlExpected.size };
}

function probeFromReceipt(index, receipt) {
  const found = index.byReceipt.get(receiptKey(receipt));
  if (!found) return null;
  return { found, sourceProbe: { namespace, memoryId: found.memoryId,
    client: receipt.client, sessionId: receipt.sessionId, eventId: receipt.eventId,
    role: receipt.role, excerpt: receipt.excerpt, routingCue: 'Batch' } };
}

function sourceProbe(index, handle) {
  if (!handle) return null;
  const [batch, slot] = handle.split('/').map(Number);
  return probeFromReceipt(index, { client, sessionId,
    eventId: `message-${String(batch).padStart(2, '0')}-${slot}`,
    role: 'user', excerpt: sourceText(batch, slot) });
}

function databaseBytes(path) {
  const file = statSync(path, { throwIfNoEntry: false })?.size ?? 0;
  const wal = statSync(`${path}-wal`, { throwIfNoEntry: false })?.size ?? 0;
  const shm = statSync(`${path}-shm`, { throwIfNoEntry: false })?.size ?? 0;
  return { file, wal, shm, total: file + wal + shm };
}

function distribution(values) {
  if (!values.length) return { count: 0, min: null, p50: null, p95: null, max: null };
  const sorted = [...values].sort((a, b) => a - b);
  const at = fraction => Math.round(sorted[Math.ceil(fraction * sorted.length) - 1]);
  return { count: sorted.length, min: Math.round(sorted[0]), p50: at(0.5),
    p95: at(0.95), max: Math.round(sorted.at(-1)) };
}

async function ask(arm, index, question, measure, shared, replacement = null) {
  const probes = [{ role: 'primary', handle: question.source },
    { role: 'decoy', handle: question.decoy }].filter(row => row.handle)
    .map(row => ({ ...row, probe: row.role === 'primary' && replacement
      ? replacement : sourceProbe(index, row.handle) }));
  const traces = probes.map(({ role, probe }) => {
    if (!probe) return { role, trace: null };
    const before = arm.core.get({ namespace, memoryId: probe.found.memoryId, receiptLimit: 100 });
    return { role, trace: createRetainedRecallTrace({ sourceProbe: probe.sourceProbe,
      before, readSet: [namespace] }), memoryId: probe.found.memoryId };
  });
  const started = performance.now();
  const recall = await scope.run({ traces: traces.map(row => row.trace).filter(Boolean) }, () =>
    arm.core.recall({ readSet: [namespace], query: question.text, contextMode: 'source-evidence',
      selectionMode: 'bounded-source-scan', limit: 6 }));
  if (shared.exceeded) throw new Error(`resource_nonfit_${shared.exceeded}`);
  const recallMs = performance.now() - started;
  if (recallMs > 20_000) throw new Error('recall_measurement_limit');
  let packed = null;
  const packStarted = performance.now();
  if (recall.ok) packed = packMixedAnswer({ question: { text: question.text, date: '2026-09-29' },
    units: recall.value.memories.map(memory => ({ text: memory.receipts
      .map(receipt => receipt.excerpt).join('\n') })),
    countTokens: text => meteredToken(measure, shared, text) });
  if (shared.exceeded) throw new Error(`resource_nonfit_${shared.exceeded}`);
  const packMs = performance.now() - packStarted;
  const sources = Object.fromEntries(traces.map(row => [row.role, row.trace
    ? row.trace.finish({ recall, packed,
      after: arm.core.get({ namespace, memoryId: row.memoryId, receiptLimit: 100 }) })
    : { status: 'not-retained' }]));
  const delivered = Object.fromEntries(Object.entries(sources).map(([role, trace]) => [role,
    trace.status === 'observed' && trace.final?.status === 'completed' &&
      trace.final.ref === 'yes' && trace.final.text === 'yes' &&
      trace.final.sourceBinding === 'yes' && trace.answer?.textPresent === 'yes']));
  return { id: question.id, recall: recall.ok ? 'completed' : recall.error.code,
    coverage: recall.ok ? recall.value.coverage : 'unavailable',
    returned: recall.ok ? recall.value.memories.length : null,
    recallMs: Math.round(recallMs), packMs: Math.round(packMs),
    packTokens: packed?.totalEstimatedTokens ?? null, sources, delivered };
}

async function runLifecycle(workspace, shared) {
  const measure = metrics();
  const arm = opened(workspace, 'lifecycle.sqlite', scriptedModel(measure, shared));
  const initialBytes = databaseBytes(arm.path);
  const original = { client, sessionId: 'synthetic-lifecycle', eventId: 'basalt-original',
    role: 'user', excerpt: sourceText(20, 4) };
  const replacement = { client, sessionId: 'synthetic-lifecycle', eventId: 'basalt-corrected',
    role: 'user', excerpt: correctedBasalt };
  const first = checked(arm.core.admit({ namespace,
    memory: { content: original.excerpt, kind: 'context' }, receipts: [original] })).memory;
  arm.reopen();
  const corrected = checked(arm.core.correct({ namespace, memoryId: first.id,
    expectedRevision: first.revision, content: correctedBasalt, kind: 'context',
    receipt: replacement })).memory;
  arm.reopen();
  const current = checked(arm.core.get({ namespace, memoryId: first.id, receiptLimit: 100 }));
  const correction = { revised: corrected.revision > first.revision &&
    current.memory.revision === corrected.revision,
  oldReceiptAbsent: !current.receipts.some(receipt => receiptKey(receipt) === receiptKey(original)),
  replacementBound: current.receipts.some(receipt => receiptKey(receipt) === receiptKey(replacement)),
  oldFingerprintSuppressed: arm.core.admit({ namespace,
    memory: { content: original.excerpt, kind: 'context' },
    receipts: [{ ...original, eventId: 'basalt-replay' }] }).error?.code === 'memory_suppressed' };
  if (!Object.values(correction).every(Boolean)) throw new Error('lifecycle_correction_nonfit');
  const index = coldIndex(arm.core);
  const q6 = await ask(arm, index, questions[5], measure, shared,
    probeFromReceipt(index, replacement));
  if (q6.sources.primary?.status !== 'observed') throw new Error('lifecycle_q6_trace_nonfit');

  const forgottenReceipt = { client, sessionId: 'synthetic-lifecycle',
    eventId: 'forget-original', role: 'user', excerpt: sourceText(0, 0) };
  const forgotten = checked(arm.core.admit({ namespace,
    memory: { content: forgottenReceipt.excerpt, kind: 'context' },
    receipts: [forgottenReceipt] })).memory;
  arm.reopen();
  const beforeForget = checked(arm.core.get({ namespace, memoryId: forgotten.id,
    receiptLimit: 100 }));
  const boundReceipt = beforeForget.exhausted === true && beforeForget.receipts.length === 1 &&
    receiptKey(beforeForget.receipts[0]) === receiptKey(forgottenReceipt)
    ? beforeForget.receipts[0] : null;
  if (!boundReceipt) throw new Error('lifecycle_forget_binding_nonfit');
  const forgetResult = checked(arm.core.forget({ namespace, memoryId: forgotten.id,
    expectedRevision: forgotten.revision }));
  arm.reopen();
  const forgetRead = arm.core.get({ namespace, memoryId: forgotten.id });
  const forgetReplay = arm.core.admit({ namespace,
    memory: { content: forgottenReceipt.excerpt, kind: 'context' },
    receipts: [{ ...forgottenReceipt, eventId: 'forget-replay' }] });
  const forgetRecall = checked(await arm.core.recall({ readSet: [namespace],
    query: 'fictional parcel 00-0', contextMode: 'source-evidence',
    selectionMode: 'bounded-source-scan', limit: 6 }));
  if (shared.exceeded) throw new Error(`resource_nonfit_${shared.exceeded}`);
  const forgetting = { forgotten: forgetResult.forgotten === true,
    getDenied: forgetRead.error?.code === 'memory_not_found',
    fingerprintSuppressed: forgetReplay.error?.code === 'memory_suppressed',
    exactSourceAbsent: !forbiddenSourceReturned(forgetRecall.memories, {
      memoryId: forgotten.id, receiptId: boundReceipt.id, role: forgottenReceipt.role,
      excerpt: forgottenReceipt.excerpt }) };
  if (!Object.values(forgetting).every(Boolean)) throw new Error('lifecycle_forgetting_nonfit');

  const duplicateText = sourceText(0, 1);
  const duplicateFirst = { client, sessionId: 'synthetic-lifecycle',
    eventId: 'duplicate-one', role: 'user', excerpt: duplicateText };
  const duplicateSecond = { ...duplicateFirst, eventId: 'duplicate-two' };
  const dedupFirst = checked(arm.core.admit({ namespace,
    memory: { content: duplicateText, kind: 'context' }, receipts: [duplicateFirst] }));
  const dedupSecond = checked(arm.core.admit({ namespace,
    memory: { content: duplicateText, kind: 'context' }, receipts: [duplicateSecond] }));
  arm.reopen();
  const duplicateRead = checked(arm.core.get({ namespace, memoryId: dedupFirst.memory.id,
    receiptLimit: 100 }));
  const deduplication = { sameMemory: dedupFirst.memory.id === dedupSecond.memory.id,
    deduplicated: dedupSecond.deduplicated === true,
    bothCarriers: duplicateRead.receipts.some(row => receiptKey(row) === receiptKey(duplicateFirst)) &&
      duplicateRead.receipts.some(row => receiptKey(row) === receiptKey(duplicateSecond)) &&
      duplicateRead.exhausted === true };
  if (!Object.values(deduplication).every(Boolean)) throw new Error('lifecycle_dedup_nonfit');

  const foreignGetDenied = arm.core.get({ namespace: otherNamespace,
    memoryId: dedupFirst.memory.id }).error?.code === 'memory_not_found';
  const foreignRecall = checked(await arm.core.recall({ readSet: [otherNamespace],
    query: 'fictional parcel 00-1', contextMode: 'source-evidence',
    selectionMode: 'bounded-source-scan', limit: 6 }));
  if (shared.exceeded) throw new Error(`resource_nonfit_${shared.exceeded}`);
  const otherReceipt = { ...duplicateFirst, eventId: 'other-namespace' };
  const otherMemory = checked(arm.core.admit({ namespace: otherNamespace,
    memory: { content: duplicateText, kind: 'context' }, receipts: [otherReceipt] })).memory;
  arm.reopen();
  const otherRead = checked(arm.core.get({ namespace: otherNamespace,
    memoryId: otherMemory.id, receiptLimit: 100 }));
  const ownRead = checked(arm.core.get({ namespace, memoryId: dedupFirst.memory.id,
    receiptLimit: 100 }));
  const isolation = { foreignGetDenied, foreignRecallEmpty: foreignRecall.memories.length === 0,
    separateMemory: otherMemory.id !== dedupFirst.memory.id,
    otherSourceOnlyThere: otherRead.receipts.some(row => receiptKey(row) === receiptKey(otherReceipt)) &&
      !ownRead.receipts.some(row => receiptKey(row) === receiptKey(otherReceipt)) };
  if (!Object.values(isolation).every(Boolean)) throw new Error('lifecycle_isolation_nonfit');
  return { metrics: measure, correction, q6, forgetting, deduplication, isolation,
    databaseBytes: { initial: initialBytes, final: databaseBytes(arm.path) } };
}

/** Executes the real shared core twice; reports only source-free probe roles. */
export async function runRetainedWindowControl(workspace, {
  fault = null, counterCeiling = limits.counterTokens,
} = {}) {
  if (!workspace?.path || typeof workspace.defer !== 'function') throw new Error('owned_workspace_required');
  if (!Number.isSafeInteger(counterCeiling) || counterCeiling < 1 ||
      counterCeiling > limits.counterTokens) throw new Error('invalid_counter_ceiling');
  const offered = preflight();
  const baselineMetrics = metrics(), controlMetrics = metrics(), shared = sharedMetrics(counterCeiling);
  const baseline = opened(workspace, 'baseline.sqlite', scriptedModel(baselineMetrics, shared));
  const control = opened(workspace, 'control.sqlite', scriptedModel(controlMetrics, shared));
  const initialBytes = { baseline: databaseBytes(baseline.path),
    control: databaseBytes(control.path) };
  const started = performance.now();
  const coverage = [];
  const captureTimes = { baseline: [], control: [] };
  for (const [batchIndex, batch] of batches.entries()) {
    const observer = createIndexedSourceWindowObserver();
    let stageStarted = performance.now();
    const result = await observer.capture(baseline.core, batch);
    captureTimes.baseline.push(performance.now() - stageStarted);
    if (shared.exceeded) throw new Error(`resource_nonfit_${shared.exceeded}`);
    if (!result.ok) throw new Error(`capture_${batchIndex}_${result.error.code}_${baselineMetrics.counterTokens}`);
    if (result.value.classification?.status !== 'applied') throw new Error('classification_nonfit');
    coverage.push(observer.finish({ inspectAdmission: input => baseline.core.inspectAdmission(input),
      get: input => baseline.core.get(input) }));
    const catalog = sourceWindowCatalog(captureSnapshot(batch, undefined, 'indexed-evidence-v1'));
    stageStarted = performance.now();
    for (const window of catalog.entries) checked(control.core.admit({ namespace,
      memory: { content: window.content, kind: 'context' },
      receipts: [{ client, sessionId, eventId: window.id, role: window.role,
        excerpt: window.content }] }));
    captureTimes.control.push(performance.now() - stageStarted);
  }
  const captureElapsedMs = Math.round(performance.now() - started);
  const collectionBytes = { baseline: databaseBytes(baseline.path),
    control: databaseBytes(control.path) };
  if (fault === 'after-collection') throw new Error('synthetic_injected_failure');
  baseline.close(); control.close();
  baseline.reopen(); control.reopen();
  const baselineIndex = coldIndex(baseline.core), controlIndex = coldIndex(control.core);
  const coldBytes = { baseline: databaseBytes(baseline.path), control: databaseBytes(control.path) };
  const coldIdentity = verifyColdIdentity(baselineIndex, controlIndex);
  if (baselineIndex.cards !== 250 || baselineIndex.receipts !== 250 ||
      controlIndex.cards !== 300 || controlIndex.receipts !== 300) throw new Error('cold_cardinality_nonfit');
  if (coverage.some(row => row.status !== 'observed' || row.offeredCount !== 6 ||
      row.uniqueRetainedCount !== 5 || row.uniqueUnmatchedCount !== 1)) {
    throw new Error('baseline_observer_nonfit');
  }
  const queries = [];
  let lifecycle = null;
  const reportMetrics = metrics();
  const report = (status, reason = null) => {
    const output = { version: 1, scope: 'synthetic-source-availability',
      acceptanceIds: ['RWC-01', 'RWC-02', 'RWC-03', 'RWC-04', 'RWC-05', 'RWC-06', 'RWC-07'],
      status, ...(reason ? { reason } : {}), offered, coldIdentity, captureElapsedMs,
      captureTimingsMs: { baseline: distribution(captureTimes.baseline),
        control: distribution(captureTimes.control) },
      providerCalls: 0,
      baseline: { cards: baselineIndex.cards, receipts: baselineIndex.receipts,
        databaseBytes: { initial: initialBytes.baseline, collection: collectionBytes.baseline,
          cold: coldBytes.baseline,
          final: databaseBytes(baseline.path) }, metrics: baselineMetrics },
      control: { cards: controlIndex.cards, receipts: controlIndex.receipts,
        databaseBytes: { initial: initialBytes.control, collection: collectionBytes.control,
          cold: coldBytes.control,
          final: databaseBytes(control.path) }, metrics: controlMetrics },
      shared, reportMetrics, queries, lifecycle,
      elapsedMs: Math.round(performance.now() - started) };
    if (!shared.exceeded) {
      try { output.reportMeasurementTokens = meteredToken(reportMetrics, shared,
        JSON.stringify(output)); }
      catch { if (!shared.exceeded) throw new Error('report_token_count_unavailable'); }
    }
    if (shared.exceeded) {
      output.status = 'incomplete';
      output.reason = `resource_nonfit_${shared.exceeded}`;
    }
    return output;
  };
  for (const question of questions) {
    if (question.id === 'Q6') continue;
    try {
      queries.push({ id: question.id,
        baseline: await ask(baseline, baselineIndex, question, baselineMetrics, shared),
        control: await ask(control, controlIndex, question, controlMetrics, shared) });
    } catch (error) {
      if (shared.exceeded || error.message === 'recall_measurement_limit') {
        return report('incomplete', shared.exceeded ? `resource_nonfit_${shared.exceeded}`
          : 'recall_measurement_limit');
      }
      throw error;
    }
  }
  try { lifecycle = await runLifecycle(workspace, shared); }
  catch (error) {
    if (shared.exceeded || error.message === 'recall_measurement_limit') {
      return report('incomplete', shared.exceeded ? `resource_nonfit_${shared.exceeded}`
        : 'recall_measurement_limit');
    }
    throw error;
  }
  return report('completed');
}

/** Strict, source-free contract for this diagnostic's single JSON stdout line. */
export function parseRetainedWindowReport(stdout, exitCode) {
  if (typeof stdout !== 'string' || Buffer.byteLength(stdout, 'utf8') > 32 * 1024 ||
      !stdout.endsWith('\n') || stdout.indexOf('\n') !== stdout.length - 1) {
    throw new Error('invalid_control_json');
  }
  let value;
  try { value = JSON.parse(stdout.slice(0, -1)); }
  catch { throw new Error('invalid_control_json'); }
  if (JSON.stringify(value) !== stdout.slice(0, -1)) throw new Error('invalid_control_json');
  const shape = (row, required, optional = []) => {
    if (!row || typeof row !== 'object' || Array.isArray(row) ||
        required.some(key => !Object.hasOwn(row, key)) ||
        Object.keys(row).some(key => !required.includes(key) && !optional.includes(key))) {
      throw new Error('invalid_control_shape');
    }
  };
  const number = row => { if (!Number.isFinite(row) || row < 0) throw new Error('invalid_control_number'); };
  const yesNo = row => {
    if (!['yes', 'no', 'unavailable', 'not-run', 'bypassed'].includes(row)) {
      throw new Error('invalid_control_status');
    }
  };
  const reportKeys = ['version', 'scope', 'acceptanceIds', 'status', 'offered', 'coldIdentity',
    'captureElapsedMs', 'captureTimingsMs', 'providerCalls', 'baseline', 'control',
    'shared', 'reportMetrics', 'queries', 'lifecycle', 'elapsedMs'];
  shape(value, reportKeys, ['reason', 'reportMeasurementTokens']);
  if (value.version !== 1 || value.scope !== 'synthetic-source-availability' ||
      !['completed', 'incomplete'].includes(value.status) || value.offered !== 300 ||
      value.providerCalls !== 0 || !Array.isArray(value.queries) || value.queries.length > 5 ||
      value.status === 'completed' !== (exitCode === 0) ||
      value.status === 'incomplete' && !['resource_nonfit_counter', 'resource_nonfit_callback',
        'recall_measurement_limit'].includes(value.reason)) throw new Error('invalid_control_status');
  if (value.status === 'completed' && Object.hasOwn(value, 'reason')) {
    throw new Error('invalid_control_status');
  }
  if (JSON.stringify(value.acceptanceIds) !== JSON.stringify(
    ['RWC-01', 'RWC-02', 'RWC-03', 'RWC-04', 'RWC-05', 'RWC-06', 'RWC-07'])) {
    throw new Error('invalid_control_acceptance_ids');
  }
  shape(value.coldIdentity, ['baseline', 'control']);
  if (value.coldIdentity.baseline !== 250 || value.coldIdentity.control !== 300) {
    throw new Error('invalid_control_denominator');
  }
  number(value.captureElapsedMs); number(value.elapsedMs);
  if (value.reportMeasurementTokens !== undefined) number(value.reportMeasurementTokens);
  const timing = row => {
    shape(row, ['count', 'min', 'p50', 'p95', 'max']);
    if (row.count !== 50) throw new Error('invalid_control_denominator');
    for (const key of ['min', 'p50', 'p95', 'max']) number(row[key]);
  };
  shape(value.captureTimingsMs, ['baseline', 'control']);
  timing(value.captureTimingsMs.baseline); timing(value.captureTimingsMs.control);
  const metricsShape = row => {
    shape(row, ['calls', 'callbackInputTokens', 'callbackOutputTokens',
      'counterCalls', 'counterTokens']);
    shape(row.calls, ['extract', 'classify', 'select', 'rank']);
    for (const item of Object.values(row.calls)) number(item);
    for (const key of ['callbackInputTokens', 'callbackOutputTokens',
      'counterCalls', 'counterTokens']) number(row[key]);
  };
  const bytes = row => {
    shape(row, ['file', 'wal', 'shm', 'total']);
    for (const item of Object.values(row)) number(item);
    if (row.total !== row.file + row.wal + row.shm) throw new Error('invalid_control_bytes');
  };
  const arm = (row, cards) => {
    shape(row, ['cards', 'receipts', 'databaseBytes', 'metrics']);
    if (row.cards !== cards || row.receipts !== cards) throw new Error('invalid_control_denominator');
    shape(row.databaseBytes, ['initial', 'collection', 'cold', 'final']);
    for (const phase of Object.values(row.databaseBytes)) bytes(phase);
    metricsShape(row.metrics);
  };
  arm(value.baseline, 250); arm(value.control, 300); metricsShape(value.reportMetrics);
  shape(value.shared, ['callbackTokens', 'counterTokens', 'counterCeiling', 'exceeded']);
  number(value.shared.callbackTokens); number(value.shared.counterTokens);
  if (value.shared.counterCeiling !== 32_000_000 &&
      !(value.status === 'incomplete' && value.shared.counterCeiling < 32_000_000)) {
    throw new Error('invalid_control_ceiling');
  }
  if (value.shared.exceeded !== null && !['counter', 'callback'].includes(value.shared.exceeded)) {
    throw new Error('invalid_control_status');
  }
  if (value.status === 'completed' && (value.shared.exceeded !== null ||
      value.shared.counterTokens > value.shared.counterCeiling ||
      value.shared.callbackTokens > limits.callbackTokens)) throw new Error('invalid_control_status');
  const trace = row => {
    if (row?.status === 'not-retained') { shape(row, ['status']); return; }
    if (row?.status === 'unavailable') {
      shape(row, ['version', 'scope', 'status', 'reason', 'firstObservedGap']);
      if (!['already_finished', 'truncated', 'observation_failed', 'source_unavailable',
        'read_failed', 'read_shape', 'read_incomplete', 'ambiguous_source',
        'source_binding_missing', 'stale', 'report_limit'].includes(row.reason)) {
        throw new Error('invalid_control_trace');
      }
    } else {
      if (row?.status !== 'observed') throw new Error('invalid_control_trace');
      shape(row, ['version', 'scope', 'status', 'source', 'counts', 'selection',
        'rank', 'final', 'answer', 'firstObservedGap']);
      shape(row.source, ['status', 'retainedText', 'currentSourceBinding', 'currentRevision']);
      yesNo(row.source.retainedText); yesNo(row.source.currentSourceBinding);
      if (row.source.status !== 'observed' || row.source.currentRevision !== 'current') {
        throw new Error('invalid_control_trace');
      }
      shape(row.counts, ['selectCalls', 'rankCalls', 'recallCalls', 'packCalls',
        'selectVisibleItems', 'rankCandidates', 'overflowed']);
      for (const key of ['selectCalls', 'rankCalls', 'recallCalls', 'packCalls']) number(row.counts[key]);
      for (const key of ['selectVisibleItems', 'rankCandidates']) {
        if (row.counts[key] !== null) number(row.counts[key]);
      }
      if (row.counts.overflowed !== false) throw new Error('invalid_control_trace');
      shape(row.selection, ['strategy', 'referenceVisible', 'routingTextVisible',
        'candidateTextVisible', 'targetRefType', 'proposal', 'wrongRevisionProposal', 'accepted']);
      for (const key of ['referenceVisible', 'routingTextVisible', 'candidateTextVisible',
        'proposal', 'wrongRevisionProposal', 'accepted']) yesNo(row.selection[key]);
      if (!['complete-map', 'model-selected', 'default', 'unavailable'].includes(row.selection.strategy) ||
          !['unfiled', 'ref', 'unavailable'].includes(row.selection.targetRefType)) {
        throw new Error('invalid_control_trace');
      }
      shape(row.rank, ['inputRef', 'inputText', 'inputSourceBinding', 'proposal', 'accepted']);
      for (const item of Object.values(row.rank)) yesNo(item);
      shape(row.final, ['status', 'ref', 'text', 'sourceBinding', 'strategy']);
      for (const key of ['ref', 'text', 'sourceBinding']) yesNo(row.final[key]);
      if (!['completed', 'failed', 'stale', 'unavailable'].includes(row.final.status) ||
          !['complete-map', 'model-selected', 'default', 'unavailable'].includes(row.final.strategy)) {
        throw new Error('invalid_control_trace');
      }
      shape(row.answer, ['status', 'textPresent', 'sourceBinding']);
      yesNo(row.answer.textPresent); yesNo(row.answer.sourceBinding);
      if (!['completed', 'not-run', 'unavailable'].includes(row.answer.status)) {
        throw new Error('invalid_control_trace');
      }
    }
    if (row.version !== 1 || row.scope !== 'one-current-source/one-recall') {
      throw new Error('invalid_control_trace');
    }
    if (row.firstObservedGap !== null && !['unavailable', 'retained-text', 'source-binding',
      'reference-visible', 'selected', 'rank-input-ref', 'rank-input-text',
      'rank-input-source-binding', 'ranked', 'final-ref', 'final-text',
      'final-source-binding', 'answer-context-present'].includes(row.firstObservedGap)) {
      throw new Error('invalid_control_trace');
    }
  };
  const query = row => {
    shape(row, ['id', 'recall', 'coverage', 'returned', 'recallMs', 'packMs',
      'packTokens', 'sources', 'delivered']);
    if (!questions.some(question => question.id === row.id) ||
        !['completed', 'recall_failed', 'context_item_too_large'].includes(row.recall) ||
        !['complete', 'budget_exhausted', 'unavailable'].includes(row.coverage)) {
      throw new Error('invalid_control_query');
    }
    number(row.recallMs); number(row.packMs);
    if (row.returned !== null) number(row.returned);
    if (row.packTokens !== null) number(row.packTokens);
    const roles = row.id === 'Q4' ? ['primary', 'decoy'] : row.id === 'Q5' ? [] : ['primary'];
    shape(row.sources, roles);
    shape(row.delivered, roles);
    for (const [role, sourceTrace] of Object.entries(row.sources)) {
      trace(sourceTrace);
      if (typeof row.delivered[role] !== 'boolean') throw new Error('invalid_control_delivery');
      const exact = sourceTrace.status === 'observed' && sourceTrace.final?.status === 'completed' &&
        sourceTrace.final.ref === 'yes' && sourceTrace.final.text === 'yes' &&
        sourceTrace.final.sourceBinding === 'yes' && sourceTrace.answer?.textPresent === 'yes';
      if (row.delivered[role] !== exact) throw new Error('invalid_control_delivery');
    }
  };
  const expectedIds = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5'];
  for (const [index, row] of value.queries.entries()) {
    shape(row, ['id', 'baseline', 'control']);
    if (row.id !== expectedIds[index]) throw new Error('invalid_control_query_order');
    query(row.baseline); query(row.control);
    if (row.baseline.id !== row.id || row.control.id !== row.id) {
      throw new Error('invalid_control_query_order');
    }
  }
  if (value.status === 'completed' && (value.queries.length !== 5 || !value.lifecycle)) {
    throw new Error('invalid_control_denominator');
  }
  if (value.lifecycle !== null) {
    shape(value.lifecycle, ['metrics', 'correction', 'q6', 'forgetting',
      'deduplication', 'isolation', 'databaseBytes']);
    metricsShape(value.lifecycle.metrics); query(value.lifecycle.q6);
    if (value.lifecycle.q6.id !== 'Q6') throw new Error('invalid_control_query_order');
    shape(value.lifecycle.databaseBytes, ['initial', 'final']);
    bytes(value.lifecycle.databaseBytes.initial); bytes(value.lifecycle.databaseBytes.final);
    for (const [name, keys] of Object.entries({
      correction: ['revised', 'oldReceiptAbsent', 'replacementBound', 'oldFingerprintSuppressed'],
      forgetting: ['forgotten', 'getDenied', 'fingerprintSuppressed', 'exactSourceAbsent'],
      deduplication: ['sameMemory', 'deduplicated', 'bothCarriers'],
      isolation: ['foreignGetDenied', 'foreignRecallEmpty', 'separateMemory', 'otherSourceOnlyThere'],
    })) {
      shape(value.lifecycle[name], keys);
      if (Object.values(value.lifecycle[name]).some(item => item !== true)) {
        throw new Error('invalid_control_lifecycle');
      }
    }
  }
  const arms = [value.baseline.metrics, value.control.metrics, value.reportMetrics,
    ...(value.lifecycle ? [value.lifecycle.metrics] : [])];
  if (value.shared.counterTokens !== arms.reduce((sum, item) => sum + item.counterTokens, 0) ||
      value.shared.callbackTokens !== arms.reduce((sum, item) => sum +
        item.callbackInputTokens + item.callbackOutputTokens, 0) ||
      value.reportMeasurementTokens !== undefined &&
        value.reportMeasurementTokens !== value.reportMetrics.counterTokens) {
    throw new Error('invalid_control_accounting');
  }
  const serialized = JSON.stringify(value);
  if (/Batch \d{2} slot|message-\d{2}-\d|(?:^|[" ])(?:\/tmp\/|\/home\/)|\b\d{1,2}\/\d\b/u.test(serialized)) {
    throw new Error('control_report_source_leak');
  }
  const inspect = row => {
    if (typeof row === 'number') number(row);
    else if (Array.isArray(row)) row.forEach(inspect);
    else if (row && typeof row === 'object') Object.values(row).forEach(inspect);
  };
  inspect(value);
  return value;
}
