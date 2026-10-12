import { constants, closeSync, fsyncSync, lstatSync, openSync, realpathSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual, types } from 'node:util';
import { openMemoryCore } from '../../core/contract.mjs';
import { countOpenAITokens } from '../../adapters/openai/index.mjs';
import { inspectEmbeddingExperimentBudgetSnapshot } from '../experiment-budget/index.mjs';
import { freeze, snapshotJson } from '../longmemeval/mixed-validation.mjs';
import { cardPlanQaRoster } from './card-plan-profile.mjs';
import { createAlgorithmDevelopmentTransport } from './transport.mjs';
import { createSourceBundleGuard, deliverSourceBundleObservation } from './source-bundle-runner.mjs';
import { createCardPlanRankTransport } from '../architecture/source-bundle-plan-rank-transport.mjs';
import { createCardPlanRankInvocation } from '../architecture/card-plan-invocation.mjs';
import { assembleCardPlanEvidence, packCardPlanAnswer } from '../architecture/card-plan-evidence.mjs';
import { compileOrdinaryCardSelection, packGroupedCardPlanAnswer } from '../architecture/card-plan-projection.mjs';
import { consumeCardPlanPreparation, assertCardPlanStoreUnchanged } from './card-plan-store.mjs';

const VERSION = 'card-plan-first-answer-comparison-v1';
const orders = ['ABC', 'ACB', 'BAC', 'BCA', 'CAB', 'CBA'];
const limits = freeze({ cases: 24, selections: 48, answers: 72, httpRequests: 168,
  reservationMicroUsd: 5000, reservedMicroUsd: 840000, inputTokens: 6000,
  providerInputTokens: 7024, rankOutputTokens: 1024, answerOutputTokens: 512,
  logicalMs: 30000, physicalMs: 200000, caseMs: 1200000, runMs: 28800000 });
const sha = text => createHash('sha256').update(text).digest('hex');
const fail = code => { const error = new Error(code); error.code = code; throw error; };
const nativeAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
const signalAborted = signal => nativeAborted.call(signal);
const signalOn = (signal, listener) => EventTarget.prototype.addEventListener.call(signal, 'abort', listener, { once: true });
const signalOff = (signal, listener) => EventTarget.prototype.removeEventListener.call(signal, 'abort', listener);
function fields(value, keys, code = 'invalid_card_plan_configuration') {
  if (!value || typeof value !== 'object' || types.isProxy(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(code);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length || keys.some(key => !descriptors[key]
    || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value'))) fail(code);
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}
function data(value, code) {
  const active = new WeakSet(); let nodes = 0;
  const walk = (item, depth = 0) => {
  if (++nodes > 2000000 || depth > 28) fail(code);
    if (!item || typeof item !== 'object') return;
    if (types.isProxy(item) || active.has(item)) fail(code);
    const proto = Object.getPrototypeOf(item);
    if (Array.isArray(item) ? proto !== Array.prototype : ![Object.prototype, null].includes(proto)) fail(code);
    active.add(item);
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(item))) {
      if (!Object.hasOwn(descriptor, 'value')) fail(code); walk(descriptor.value, depth + 1);
    }
    active.delete(item);
  };
  walk(value);
  return JSON.parse(JSON.stringify(snapshotJson(value, { bytes: 64 * 1024 * 1024, nodes: 4000000, depth: 28 }, code)));
}
// Never evaluate a hostile exception's proxy traps, accessors or JSON hooks.
function errorCode(error, fallback = 'card_plan_request_denied') {
  if (!error || typeof error !== 'object' || types.isProxy(error) || !types.isNativeError(error)) return fallback;
  for (const field of ['code', 'name', 'message']) {
    const descriptor = Object.getOwnPropertyDescriptor(error, field);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) continue;
    if (field === 'name' && descriptor.value === 'AbortError') return 'card_plan_cancelled';
    if (typeof descriptor.value === 'string' && /^[a-z][a-z0-9_]{1,127}$/u.test(descriptor.value)) return descriptor.value;
  }
  return fallback;
}
function failure(code) {
  const provenance = ['invalid_card_plan_evidence', 'card_plan_answer_incomplete', 'invalid_recall_provenance'];
  const ordinary = ['provider_failure', 'provider_failed', 'invalid_model_output', 'invalid_answer_response',
    'invalid_response', 'model_timeout'];
  return { code, category: provenance.includes(code) ? 'fatal-provenance'
    : ordinary.includes(code) ? 'settled-model-failure' : 'fatal-request-denial' };
}
function rootCheck(observation) {
  const stat = lstatSync(observation.outputRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(observation.outputRoot) !== observation.outputRoot
    || (stat.mode & 0o777) !== 0o700 || stat.uid !== process.getuid()
    || !isDeepStrictEqual({ dev: stat.dev, ino: stat.ino, uid: stat.uid }, observation.rootIdentity))
    fail('card_plan_output_unsafe');
}
function artifact(observation, name, chunks, maximum = 8 * 1024 * 1024) {
  rootCheck(observation);
  const path = join(observation.outputRoot, name);
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  const hash = createHash('sha256'); let bytes = 0;
  try {
    for (const chunk of chunks) {
      const buffer = Buffer.from(chunk); bytes += buffer.length;
      if (bytes > maximum) fail('card_plan_artifact_limit');
      hash.update(buffer); let at = 0;
      while (at < buffer.length) at += writeSync(fd, buffer, at);
    }
    fsyncSync(fd);
  } finally { closeSync(fd); }
  rootCheck(observation);
  const directory = openSync(observation.outputRoot, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(directory); } finally { closeSync(directory); }
  return { path, bytes, sha256: hash.digest('hex') };
}
function jsonArtifact(observation, name, value) {
  return artifact(observation, name, [JSON.stringify(value)]);
}
function* historyChunks(snapshot) {
  yield '{'; let first = true;
  for (const [key, value] of Object.entries(snapshot)) {
    if (!first) yield ','; first = false; yield JSON.stringify(key) + ':';
    if (key !== 'attempts') { yield JSON.stringify(value); continue; }
    yield '[';
    for (const [index, row] of value.entries()) { if (index) yield ','; yield JSON.stringify(row); }
    yield ']';
  }
  yield '}';
}
const checkpointOf = state => ({ requestCount: state.requestCount, reservedMicroUsd: state.reservedMicroUsd });
const stateBinding = state => ({ ...checkpointOf(state), historySha256: state.historySha256 });

export function createCardPlanComparisonManifest(observation) {
  const clean = data(observation, 'invalid_card_plan_manifest');
  if (clean.version !== 'card-plan-comparison-preparation-v1'
    || !isDeepStrictEqual(clean.cases?.map(c => c.id), cardPlanQaRoster)
    || clean.cardCount !== 288 || clean.receiptCount !== 288) fail('invalid_card_plan_manifest');
  return freeze({ version: VERSION, preparationSha256: sha(JSON.stringify(clean)),
    sourceValueSha256: clean.sourceValueSha256, sourceFileSha256: clean.sourceFileSha256,
    outputRoot: clean.outputRoot, rootIdentity: clean.rootIdentity, limits,
    cases: clean.cases.map((c, index) => ({ id: c.id, ordinal: index + 1,
      stateSha256: c.stateAfter.sha256, ordinaryRankRequestSha256: sha(JSON.stringify(c.rankRequest)),
      cardPreparedRequestSha256: c.preparedCardRequestSha256,
      selectionOrder: index % 2 ? ['B', 'A'] : ['A', 'B'], answerOrder: [...orders[index % 6]],
      selectionSlots: ['A', 'B'].map(arm => `${c.id}-selection-${arm}`),
      answerSlots: ['A', 'B', 'C'].map(arm => `${c.id}-answer-${arm}`) })) });
}

export async function runCardPlanComparison(options) {
  const opts = fields(options, ['preparation', 'manifest', 'configuration', 'checkpoint', 'historySha256',
    'apiKey', 'fetchImpl', 'onRecord', 'onCheckpoint', 'signal']);
  // This consumes before source/state awaits and before key/setup rejection.
  const observation = await consumeCardPlanPreparation(opts.preparation);
  const manifest = createCardPlanComparisonManifest(observation);
  const report = { version: VERSION, manifest, preparationSha256: manifest.preparationSha256,
    status: 'running', failure: null, cases: manifest.cases.map(row => ({ id: row.id, ordinal: row.ordinal,
      selectionOrder: row.selectionOrder, answerOrder: row.answerOrder,
      selections: ['A', 'B'].map((arm, index) => ({ slotId: row.selectionSlots[index], arm,
        kind: arm === 'A' ? 'ordinary' : 'card-plan', status: 'not-run', failure: null,
        rankRequest: null, rankOutput: null, rankFailure: null, plannerRequest: null, plannerOutput: null,
        plannerFailure: null, recall: null, recallMapText: null,
        authoritativeReads: [], evidence: null, assembly: null, stateChecks: [], attempts: [] })),
      answers: ['A', 'B', 'C'].map((arm, index) => ({ slotId: row.answerSlots[index], arm,
        kind: ['ordinary', 'card-flat', 'card-grouped'][index], selectionSlotId: row.selectionSlots[arm === 'A' ? 0 : 1],
        status: 'not-run', disposition: 'unrun', requestBody: null, packed: null, answer: null,
        result: null, failure: null, stateChecks: [], attempts: [] })) })), attempts: [], checkpoints: [],
    resources: null, originalHistory: null, semanticSufficiency: 'unassessed', liveGrant: false };
  let configuration, expected, expectedState, currentSlot, activeTransport, activeGuard, pendingPort, deadlineTimer, caseTimer;
  let firstIntegrationFailure = null;
  let runDeadline, caseDeadline, activeCase, knownInitialCount = null, callerListening = false;
  const began = performance.now(), controller = new AbortController();
  const callerAbort = () => controller.abort();
  let stopCode = null, recordSequence = 0, transitionSequence = 0;
  const ensure = () => {
    if (controller.signal.aborted) fail(stopCode ?? 'card_plan_cancelled');
    if (performance.now() >= Math.min(runDeadline, caseDeadline ?? runDeadline)) fail('card_plan_absolute_deadline');
  };
  const persistCallback = (callback, row) => {
    try {
      deliverSourceBundleObservation(callback, row);
    } catch { firstIntegrationFailure ??= 'card_plan_persistence_failure'; fail('card_plan_persistence_failure'); }
  };
  const record = raw => {
    rootCheck(observation);
    const row = { ...raw, slotId: currentSlot.slotId, caseId: activeCase.id, caseOrdinal: activeCase.ordinal,
      sequence: ++recordSequence };
    const pre = raw.phase === 'pre' || raw.outcome === 'unknown' && raw.latencyMs === undefined;
    row.phase = pre ? 'pre' : 'post';
    const prior = report.attempts.find(attempt => attempt.attemptId === row.attemptId);
    if (!prior && !pre || prior && pre || !prior && report.attempts.length >= 168) fail('card_plan_request_denied');
    if (pre) {
      // The transport has already reserved this intent. Retain it even if a
      // subsequent wire/cancellation/persistence gate rejects before dispatch.
      const intent = { attemptId: row.attemptId, slotId: currentSlot.slotId,
        reservedMicroUsd: raw.reservedMicroUsd, requestArtifact: null, post: null, dispatched: false };
      report.attempts.push(intent); currentSlot.attempts.push(row.attemptId);
      const body = raw.requestBody;
      if (typeof body === 'string') {
        row.requestArtifact = artifact(observation, `${row.attemptId}-request.txt`, [body], 262144);
        intent.requestArtifact = row.requestArtifact;
      }
      ensure();
      if (raw.reservedMicroUsd !== 5000) fail('card_plan_request_denied');
      if (typeof body !== 'string' || countOpenAITokens(body) > 6000) fail('card_plan_wire_drift');
      const selection = currentSlot.kind === 'ordinary' && currentSlot.slotId.includes('selection');
      const planner = currentSlot.kind === 'card-plan';
      const c = observation.cases[activeCase.ordinal - 1];
      const counting = raw.kind === 'count' || raw.endpoint === 'responses/input_tokens';
      const expectedBody = selection ? c.tokenWitnesses[counting ? 'ordinaryCount' : 'ordinaryGeneration'].text
        : planner ? c.tokenWitnesses[counting ? 'cardCount' : 'cardGeneration'].text : currentSlot.requestBody;
      if (body !== expectedBody) { firstIntegrationFailure ??= 'card_plan_wire_drift'; fail('card_plan_wire_drift'); }
    } else {
      row.requestArtifact = prior.requestArtifact;
      if (prior.post) fail('card_plan_accounting_failure');
      if (typeof row.responseBody === 'string') row.responseArtifact = artifact(observation,
        `${row.attemptId}-response.txt`, [row.responseBody], 262144 * 3);
    }
    // Bodies have distinct bounded artifacts; cumulative metadata cannot lose a last valid slot.
    delete row.requestBody; delete row.responseBody;
    jsonArtifact(observation, `record-${String(recordSequence).padStart(4, '0')}.json`, row);
    if (!pre) prior.post = row;
    persistCallback(opts.onRecord, row);
  };
  const transition = (next, slotId) => {
    const row = { sequence: ++transitionSequence, slotId, before: expected,
      after: stateBinding(next), deltas: next.attempts.slice(expected.requestCount) };
    const observedIds = currentSlot.attempts;
    if (next.schemaVersion !== 2 || next.runId !== configuration.runId
      || next.limitMicroUsd !== configuration.limitMicroUsd || next.requestCap !== configuration.requestCap
      || !isDeepStrictEqual(next.attempts.slice(0, expectedState.attempts.length), expectedState.attempts)
      || next.attempts.length !== next.requestCount || next.state !== 'open'
      || next.requestCount !== expected.requestCount + row.deltas.length
      || next.reservedMicroUsd !== expected.reservedMicroUsd + row.deltas.length * 5000
      || !isDeepStrictEqual(row.deltas.map(attempt => attempt.attemptId), observedIds)
      || row.deltas.some(attempt => attempt.outcome === null)) fail('card_plan_accounting_failure');
    jsonArtifact(observation, `checkpoint-${String(transitionSequence).padStart(4, '0')}.json`, row);
    report.checkpoints.push(row); expected = stateBinding(next); expectedState = next;
    persistCallback(opts.onCheckpoint, row);
  };
  const transportOptions = () => {
    if (activeGuard) fail('card_plan_request_denied');
    activeGuard = createSourceBundleGuard({ fetchImpl: opts.fetchImpl, signal: controller.signal,
      deadline: Math.min(runDeadline, caseDeadline), onFatal(code) {
        stopCode ??= code === 'cancelled' ? 'card_plan_cancelled'
          : code === 'deadline_exceeded' ? 'card_plan_absolute_deadline' : code;
        controller.abort();
      }, onDispatch() {
        ensure(); const intent = report.attempts.find(row => row.attemptId === currentSlot.attempts.at(-1));
        if (!intent || intent.dispatched) fail('card_plan_request_denied'); intent.dispatched = true;
      } });
    return { configuration, checkpoint: checkpointOf(expected), historySha256: expected.historySha256,
      apiKey: opts.apiKey, fetchImpl: activeGuard.fetch, onRecord: record };
  };
  const closeTransport = () => {
    if (!activeTransport) return;
    const transport = activeTransport; activeTransport = null;
    let state, caught;
    try { state = transport.getState ? transport.getState() : transport.state(); } catch (error) { caught = error; }
    try { transport.close(); } catch (error) { caught ??= error; }
    activeGuard?.close(); activeGuard = null;
    if (!state) state = inspectEmbeddingExperimentBudgetSnapshot(configuration);
    const actual = inspectEmbeddingExperimentBudgetSnapshot(configuration);
    if (!isDeepStrictEqual(stateBinding(actual), stateBinding(state))) fail('card_plan_accounting_failure');
    transition(actual, currentSlot.slotId);
    if (caught) throw caught;
  };
  const stateCheck = async (c, slot, phase) => {
    const state = await assertCardPlanStoreUnchanged(c); slot.stateChecks.push({ phase, ...state }); return state;
  };
  const settledFailure = (slot, error, returnedCode = errorCode(error)) => {
    const exact = slot.attempts.map(id => report.attempts.find(row => row.attemptId === id)?.post)
      .find(row => row && (row.failureCode || row.failure));
    const rawCode = exact?.failureCode ?? exact?.failure ?? returnedCode;
    const absoluteDeadlineLive = performance.now() < Math.min(runDeadline, caseDeadline ?? runDeadline);
    let health = null, settled = false;
    if (activeTransport) {
      try {
        if (slot.kind === 'card-plan') health = activeTransport.health();
        else { activeTransport.assertHealthy(); health = { state: 'consumed', fatalCode: null }; }
        const state = activeTransport.getState ? activeTransport.getState() : activeTransport.state();
        settled = state.attempts.every(attempt => attempt.outcome !== null)
          && slot.attempts.every(id => report.attempts.find(row => row.attemptId === id)?.post);
      } catch { health = { state: 'unhealthy', fatalCode: 'card_plan_accounting_failure' }; }
    }
    const localTimeout = ['cancelled', 'deadline_exceeded', 'model_timeout'].includes(rawCode)
      && !signalAborted(controller.signal) && absoluteDeadlineLive && !stopCode && !firstIntegrationFailure
      && settled && health?.state === 'consumed' && health.fatalCode === null;
    const normalizedCode = localTimeout ? 'model_timeout' : rawCode;
    slot.failureEvidence = { rawCode, returnedCode, normalizedCode, health, settled,
      callerAborted: signalAborted(controller.signal), absoluteDeadlineLive,
      normalization: localTimeout ? 'healthy-settled-per-call-timeout' : 'unchanged' };
    return firstIntegrationFailure ?? stopCode ?? (signalAborted(controller.signal)
      ? 'card_plan_cancelled' : normalizedCode);
  };
  const finishSlot = async (c, slot, started, core) => {
    let cleanupError = null;
    if (pendingPort) { try { await pendingPort; } catch { /* First port failure is retained on the slot. */ } pendingPort = null; }
    try { if (core) core.close(); } catch (error) { cleanupError = error; }
    try { if (activeTransport) closeTransport(); } catch (error) { cleanupError ??= error; }
    if (slot.stateChecks.length && !slot.stateChecks.some(row => row.phase === 'after')) {
      try { await stateCheck(c, slot, 'after-failure'); }
      catch (error) { slot.stateFailure = failure(errorCode(error)); cleanupError ??= error; }
    }
    if (cleanupError) {
      slot.cleanupFailure = failure(errorCode(cleanupError));
      slot.failure ??= slot.cleanupFailure; slot.status = 'failed';
      if (Object.hasOwn(slot, 'disposition')) slot.disposition = 'answer-failed';
    }
    slot.latencyMs = performance.now() - started;
    // Closing a failed owner cannot bypass the durable completed/failed slot.
    slot.artifact = jsonArtifact(observation, `${slot.slotId}.json`, slot);
    if (cleanupError) throw cleanupError;
  };
  async function select(c, slot) {
    currentSlot = slot; let core, compiled, invocation, portFailure = null;
    const started = performance.now();
    try {
      ensure(); await stateCheck(c, slot, 'before');
      if (slot.arm === 'A') {
        activeTransport = createAlgorithmDevelopmentTransport(transportOptions());
        activeTransport.beginCase({ id: c.id, ordinal: 1 }); activeTransport.beginArm('baseline');
      } else activeTransport = await createCardPlanRankTransport({ ...transportOptions(), manifest: {
        version: 'card-budgeted-plan-rank-v1', slotId: slot.slotId,
        preparedRequestSha256: c.preparedCardRequestSha256, runDeadline, caseDeadline } });
      const transport = activeTransport;
      const base = { contextWindow: 8192, countTokens(text) {
        let parsed; try { parsed = JSON.parse(text); } catch { /* Raw text is also counted. */ }
        if (parsed?.ok === true && parsed.value?.items?.length === 12
          && parsed.value.items.every(item => item.type === 'unfiled')) {
          slot.recallMapText = text;
          if (!isDeepStrictEqual(parsed, c.actualRecallMap)) {
            firstIntegrationFailure ??= 'card_plan_wire_drift'; fail('card_plan_wire_drift');
          }
        }
        return countOpenAITokens(text);
      },
        select() { fail('card_plan_request_denied'); },
        async rank(request) {
          slot.rankRequest = { system: request.system, input: request.input, maxOutputTokens: request.maxOutputTokens };
          if (!slot.recallMapText || !isDeepStrictEqual(slot.rankRequest, c.rankRequest)) {
            firstIntegrationFailure ??= 'card_plan_wire_drift'; fail('card_plan_wire_drift');
          }
          // The trusted linked signal preserves the actual core timeout while permitting caller cancellation.
          const linked = new AbortController();
          const linkCore = () => linked.abort(), linkCaller = () => linked.abort();
          signalOn(request.signal, linkCore); signalOn(controller.signal, linkCaller);
          if (signalAborted(request.signal) || signalAborted(controller.signal)) linked.abort();
          try {
            pendingPort = Promise.resolve().then(() => slot.arm === 'A'
              ? transport.model.rank({ ...request, signal: linked.signal })
              : invocation.model.rank({ ...request, signal: linked.signal }));
            const output = await pendingPort; slot.rankOutput = output; return output;
          } catch (error) { portFailure = errorCode(error); slot.rankFailure = { code: portFailure }; throw error; }
          finally {
            signalOff(request.signal, linkCore); signalOff(controller.signal, linkCaller);
          }
        } };
      if (slot.arm === 'B') invocation = createCardPlanRankInvocation({ contextWindow: 8192,
        countTokens: countOpenAITokens, select: base.select }, { planRank: async request => {
        slot.plannerRequest = { system: request.system, input: request.input,
          outputSchema: request.outputSchema, maxOutputTokens: request.maxOutputTokens };
        try { const result = await transport.planRank(request); slot.plannerOutput = result; return result; }
        catch (error) { slot.plannerFailure = { code: errorCode(error), health: transport.health() }; throw error; }
      } });
      core = openMemoryCore({ path: c.path, model: base, sourceCandidatePolicy: 'bounded-keyset-v1' });
      slot.recall = await core.recall({ readSet: [c.namespace], query: c.plan.mem0Input.query, limit: 6,
        contextMode: 'source-evidence', selectionMode: 'bounded-source-scan' });
      // Core may win its logical race; never release an active ledger owner early.
      if (pendingPort) { try { await pendingPort; } catch (error) { portFailure ??= errorCode(error); } pendingPort = null; }
      ensure();
      if (slot.recall.ok !== true) fail(portFailure ?? slot.recall.error.code);
      if (slot.recall.value.coverage !== 'complete' || slot.recall.value.selection.strategy !== 'complete-map'
        || slot.recall.value.recallTruncated) fail('card_plan_wire_drift');
      if (slot.arm === 'A') {
        const ordinary = compileOrdinaryCardSelection({ ...slot.rankRequest, signal: new AbortController().signal },
          slot.rankOutput, countOpenAITokens); compiled = ordinary.compiled;
        slot.assembly = { origin: ordinary.origin, ordinaryRefsSha256: ordinary.ordinaryRefsSha256,
          syntheticAssemblyRequestSha256: ordinary.syntheticAssemblyRequestSha256,
          actualOrdinaryRequestArtifact: report.attempts.find(row => row.slotId === slot.slotId)?.requestArtifact,
          proposal: compiled.proposal, refs: compiled.refs };
      } else {
        compiled = invocation.takePlan(); slot.assembly = { origin: 'genuine-card-plan-v1',
          requestSha256: compiled.requestSha256, proposal: compiled.proposal, refs: compiled.refs };
      }
      const reads = { get(input) { const result = core.get(input);
        slot.authoritativeReads.push({ input: structuredClone(input), result: structuredClone(result) }); return result; } };
      const evidence = assembleCardPlanEvidence({ compiled, recall: slot.recall, core: reads,
        plan: c.plan, namespace: c.namespace, question: c.question });
      slot.evidence = evidence;
      await stateCheck(c, slot, 'after'); core.close(); core = null;
      closeTransport(); slot.status = 'completed'; return evidence;
    } catch (error) {
      const code = settledFailure(slot, error, portFailure ?? errorCode(error));
      slot.failure = failure(code); slot.status = 'failed';
      slot.rankFailure ??= { code: errorCode(error) };
      if (slot.failure.category !== 'settled-model-failure') throw error;
      return null;
    } finally {
      await finishSlot(c, slot, started, core);
    }
  }
  async function answer(c, slot, evidence) {
    currentSlot = slot; const started = performance.now();
    try {
      ensure(); await stateCheck(c, slot, 'before');
      const grouped = slot.arm === 'C' ? packGroupedCardPlanAnswer({ evidence, countTokens: countOpenAITokens }) : null;
      slot.packed = grouped ? grouped.packed : packCardPlanAnswer({ evidence, countTokens: countOpenAITokens });
      slot.requestBody = JSON.stringify(slot.packed.request);
      activeTransport = createAlgorithmDevelopmentTransport(transportOptions());
      activeTransport.beginCase({ id: c.id, ordinal: 1 }); activeTransport.beginArm('baseline');
      pendingPort = activeTransport.answer({ question: c.question, units: grouped ? grouped.units : evidence.units });
      slot.result = await pendingPort; pendingPort = null;
      if (JSON.stringify(slot.result.packed.request) !== slot.requestBody) fail('card_plan_wire_drift');
      slot.answer = slot.result.answer; await stateCheck(c, slot, 'after');
      ensure(); closeTransport(); slot.status = 'completed'; slot.disposition = 'answered';
    } catch (error) {
      const code = settledFailure(slot, error);
      slot.failure = failure(code); slot.status = 'failed'; slot.disposition = 'answer-failed';
      if (slot.failure.category !== 'settled-model-failure') throw error;
    } finally {
      await finishSlot(c, slot, started);
    }
  }
  try {
    if (!isDeepStrictEqual(data(opts.manifest, 'invalid_card_plan_manifest'), manifest)) fail('invalid_card_plan_manifest');
    configuration = data(fields(opts.configuration, ['directory', 'runId', 'limitMicroUsd', 'requestCap']), 'invalid_card_plan_configuration');
    const checkpoint = data(fields(opts.checkpoint, ['requestCount', 'reservedMicroUsd']), 'invalid_card_plan_configuration');
    if (typeof opts.apiKey !== 'string' || !/^[A-Za-z0-9_-]{12,200}$/u.test(opts.apiKey)
      || typeof opts.fetchImpl !== 'function' || typeof opts.onRecord !== 'function' || typeof opts.onCheckpoint !== 'function'
      || !opts.signal || types.isProxy(opts.signal) || Object.getPrototypeOf(opts.signal) !== AbortSignal.prototype
      || typeof opts.historySha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(opts.historySha256)) fail('invalid_card_plan_configuration');
    // Native methods bypass attacker-controlled own getters and methods.
    let alreadyAborted;
    try { alreadyAborted = signalAborted(opts.signal); signalOn(opts.signal, callerAbort); callerListening = true; }
    catch { fail('invalid_card_plan_configuration'); }
    if (alreadyAborted) controller.abort();
    runDeadline = performance.now() + limits.runMs;
    deadlineTimer = setTimeout(() => { stopCode = 'card_plan_absolute_deadline'; controller.abort(); }, limits.runMs);
    ensure(); jsonArtifact(observation, 'run-start.json', { version: VERSION, manifest, startedAt: new Date().toISOString() });
    const initial = inspectEmbeddingExperimentBudgetSnapshot(configuration); knownInitialCount = initial.requestCount;
    if (!isDeepStrictEqual(checkpointOf(initial), checkpoint) || initial.historySha256 !== opts.historySha256
      || initial.state !== 'open' || initial.attempts.some(row => row.outcome === null)) fail('card_plan_checkpoint_mismatch');
    if (initial.limitMicroUsd > 400000000 || initial.limitMicroUsd - initial.reservedMicroUsd < 40000000
      || initial.requestCap - initial.requestCount < 1968) fail('algorithm_unaffordable');
    expected = stateBinding(initial); expectedState = initial;
    report.originalHistory = { ...artifact(observation, 'original-ledger-history.json', historyChunks(initial), 128 * 1024 * 1024),
      ...stateBinding(initial) };
    for (const [index, c] of observation.cases.entries()) {
      ensure(); activeCase = report.cases[index]; caseDeadline = performance.now() + limits.caseMs;
      clearTimeout(caseTimer);
      caseTimer = setTimeout(() => { stopCode = 'card_plan_absolute_deadline'; controller.abort(); }, limits.caseMs);
      const results = {};
      for (const arm of activeCase.selectionOrder) results[arm] = await select(c, activeCase.selections.find(slot => slot.arm === arm));
      for (const arm of activeCase.answerOrder) {
        const slot = activeCase.answers.find(row => row.arm === arm), evidence = results[arm === 'A' ? 'A' : 'B'];
        if (!evidence) { slot.disposition = 'unanswered-selection-failed';
          slot.failure = { code: 'selection_failed', category: 'dependent-unanswered' };
          slot.artifact = jsonArtifact(observation, `${slot.slotId}.json`, slot); continue; }
        await answer(c, slot, evidence);
      }
    }
    report.status = 'completed';
  } catch (error) {
    report.status = 'halted'; report.failure = failure(firstIntegrationFailure ?? stopCode
      ?? (controller.signal.aborted ? 'card_plan_cancelled' : errorCode(error)));
    for (const c of report.cases) for (const slot of [...c.selections, ...c.answers]) {
      if (slot.status === 'not-run' && slot.failure === null) { slot.failure = report.failure;
        if (Object.hasOwn(slot, 'disposition')) slot.disposition = 'unrun-fatal'; }
    }
  } finally {
    clearTimeout(deadlineTimer); clearTimeout(caseTimer);
    activeGuard?.close(); activeGuard = null;
    if (callerListening) signalOff(opts.signal, callerAbort);
  }
  const postRows = report.attempts.map(row => row.post).filter(Boolean);
  let reservedIntents = report.attempts.length, missingFinalCalls = report.attempts.filter(row => row.post === null).length;
  if (expectedState) {
    try {
      const final = inspectEmbeddingExperimentBudgetSnapshot(configuration);
      const appendedAttempts = final.attempts.slice(knownInitialCount);
      const unobservedAttemptIds = appendedAttempts.filter(attempt => !report.attempts.some(row => row.attemptId === attempt.attemptId))
        .map(attempt => attempt.attemptId);
      const prefixUnchanged = isDeepStrictEqual(final.attempts.slice(0, expectedState.attempts.length), expectedState.attempts);
      if (appendedAttempts.length > limits.httpRequests || !prefixUnchanged) fail('card_plan_accounting_failure');
      reservedIntents = appendedAttempts.length; missingFinalCalls += unobservedAttemptIds.length;
      report.ledgerReconciliation = { ...stateBinding(final), schemaVersion: final.schemaVersion, runId: final.runId,
        limitMicroUsd: final.limitMicroUsd, requestCap: final.requestCap, state: final.state,
        prefixUnchanged, appendedAttempts, unobservedAttemptIds };
    } catch (error) {
      report.ledgerReconciliationFailure = failure(errorCode(error));
      report.status = 'halted'; report.failure ??= report.ledgerReconciliationFailure;
    }
  }
  report.resources = { physicalCalls: report.attempts.filter(row => row.dispatched === true).length,
    reservedIntents,
    reservedMicroUsd: reservedIntents * 5000,
    partialKnownMicroUsd: postRows.reduce((sum, row) => sum + (row.actualMicroUsd ?? 0), 0),
    unknownCostCalls: postRows.filter(row => row.actualMicroUsd === null).length
      + missingFinalCalls,
    missingFinalCalls,
    selectionsCompleted: report.cases.flatMap(c => c.selections).filter(row => row.status === 'completed').length,
    answersCompleted: report.cases.flatMap(c => c.answers).filter(row => row.status === 'completed').length,
    selectionDenominator: 48, answerDenominator: 72, caseDenominator: 24,
    latencyMs: performance.now() - began, storeBytes: observation.cases.reduce((sum, c) => sum + c.stateAfter.bytes, 0),
    rssBytes: null, serviceCostMicroUsd: null, initialRequestCount: knownInitialCount };
  // Every full slot is retained separately. The bounded final roster references
  // exact length/hash-bound files rather than duplicating all source evidence.
  jsonArtifact(observation, 'comparison-report.json', { ...report,
    representation: 'slot-artifacts-v1', cases: report.cases.map(c => ({ ...c,
      selections: c.selections.map(slot => ({ slotId: slot.slotId, arm: slot.arm, kind: slot.kind,
        status: slot.status, failure: slot.failure, artifact: slot.artifact ?? null })),
      answers: c.answers.map(slot => ({ slotId: slot.slotId, arm: slot.arm, kind: slot.kind,
        selectionSlotId: slot.selectionSlotId, status: slot.status, disposition: slot.disposition,
        failure: slot.failure, artifact: slot.artifact ?? null })) })) });
  return freeze(report);
}
