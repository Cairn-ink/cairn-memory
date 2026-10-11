import { createHash } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual, types } from 'node:util';
import { freeze, snapshotJson } from '../longmemeval/mixed-validation.mjs';
import { sourceBundleOrders, sourceBundleRoster } from './source-bundle-profile.mjs';
import { assertSourceBundleStoreUnchanged, consumeSourceBundlePreparation } from './source-bundle-store.mjs';
import { createBundleRankModel } from '../architecture/source-bundle-rank.mjs';
import { assembleSourceBundleEvidence, packSourceBundleAnswer } from '../architecture/source-bundle-evidence.mjs';
import { verifiedRoleEvidence } from '../longmemeval/mixed-evidence.mjs';
import { packMixedAnswer } from '../longmemeval/mixed-answer.mjs';

const VERSION = 'source-bundle-comparison-v1';
const DEPENDENCIES = freeze({ corpus: '51bf373de67680d1fcf5ac0a7b29de1ae0f7055b',
  planner: '21f4bf0a512fa22f54bec637f5ef5a70c478b1f5', integration: '4423cd2bf91e3c479767bd1bebac3a6510846f07' });
const LIMITS = freeze({ cases: 24, answers: 48, probes: 24, physicalIntents: 192,
  reservedMicroUsd: 960000, reservationMicroUsd: 5000, inputTokens: 6000,
  rankOutputTokens: 1024, answerOutputTokens: 512, coreMs: 30000, physicalMs: 200000,
  caseMs: 1200000, runMs: 28800000 });
const CODES = new Set(['invalid_options', 'invalid_manifest', 'invalid_preparation', 'run_busy', 'cancelled',
  'deadline_exceeded', 'request_denied', 'wire_mismatch', 'rank_mismatch', 'store_drift', 'provenance_mismatch',
  'ledger_failed', 'budget_blocked', 'record_persistence_failed', 'credential_echo', 'authentication_failed',
  'redirect_rejected', 'invalid_usage', 'usage_overrun', 'model_mismatch', 'invalid_model_output',
  'provider_failed', 'model_timeout', 'invalid_answer_response', 'context_budget_exceeded', 'invalid_response']);
const FATAL = new Set(['invalid_manifest', 'invalid_preparation', 'cancelled', 'deadline_exceeded',
  'request_denied', 'wire_mismatch', 'rank_mismatch', 'store_drift', 'provenance_mismatch', 'ledger_failed',
  'budget_blocked', 'record_persistence_failed', 'credential_echo', 'authentication_failed',
  'redirect_rejected', 'invalid_usage', 'usage_overrun', 'model_mismatch']);
let running = false;
const sha = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const fail = code => { const error = new Error(CODES.has(code) ? code : 'invalid_response'); error.code = error.message; throw error; };
const requireTrue = (condition, code) => { if (!condition) fail(code); };
const copy = value => freeze(JSON.parse(JSON.stringify(snapshotJson(value,
  { bytes: 32 * 1024 * 1024, nodes: 500000, depth: 28 }, 'invalid_options'))));
function own(value, keys) {
  try {
    requireTrue(!types.isProxy(value) && value !== null && typeof value === 'object'
      && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)), 'invalid_options');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    requireTrue(Reflect.ownKeys(descriptors).length === keys.length && keys.every(key => descriptors[key]
      && descriptors[key].enumerable && Object.hasOwn(descriptors[key], 'value')), 'invalid_options');
    return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
  } catch { fail('invalid_options'); }
}
export function deliverSourceBundleObservation(callback, observation) {
  try {
    const returned = callback(copy(observation));
    if (returned !== undefined) {
      if (types.isPromise(returned)) Promise.prototype.then.call(returned, undefined, () => {});
      fail('record_persistence_failed');
    }
  } catch { fail('record_persistence_failed'); }
}
function persist(path, observation) {
  let fd;
  try { fd = openSync(path, 'wx', 0o600); writeFileSync(fd, `${JSON.stringify(observation, null, 2)}\n`); fsyncSync(fd); }
  catch { fail('record_persistence_failed'); }
  finally { if (fd !== undefined) closeSync(fd); }
}

// Imported ledger snapshots can contain substantial pre-existing history. Validate
// each scalar once without routing that exact history through the general JSON
// observation budget, then stream it once. This does not create or alter a ledger.
function ledgerHeader(state) {
  const data = own(state, ['schemaVersion', 'runId', 'limitMicroUsd', 'requestCap',
    'reservedMicroUsd', 'requestCount', 'state', 'attempts', 'historySha256']);
  requireTrue(data.schemaVersion === 2 && /^[a-f0-9-]{36}$/u.test(data.runId)
    && ['limitMicroUsd', 'requestCap', 'reservedMicroUsd', 'requestCount'].every(key =>
      Number.isSafeInteger(data[key]) && data[key] >= 0)
    && ['open', 'overrun'].includes(data.state) && /^[a-f0-9]{64}$/u.test(data.historySha256)
    && Array.isArray(data.attempts) && !types.isProxy(data.attempts)
    && data.attempts.length === data.requestCount && data.requestCount <= 1000000, 'ledger_failed');
  let reserved = 0;
  for (let index = 0; index < data.attempts.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(data.attempts, String(index));
    requireTrue(descriptor && Object.hasOwn(descriptor, 'value'), 'ledger_failed');
    const attempt = own(descriptor.value, ['attemptId', 'channel', 'reservedMicroUsd', 'outcome', 'actualMicroUsd']);
    requireTrue(typeof attempt.attemptId === 'string' && /^[a-f0-9-]{36}$/u.test(attempt.attemptId)
      && ['host-completion', 'host-embedding', 'cairn-count', 'cairn-generation'].includes(attempt.channel)
      && Number.isSafeInteger(attempt.reservedMicroUsd) && attempt.reservedMicroUsd >= 0
      && [null, 'unknown', 'failed', 'succeeded'].includes(attempt.outcome)
      && (attempt.actualMicroUsd === null || Number.isSafeInteger(attempt.actualMicroUsd) && attempt.actualMicroUsd >= 0), 'ledger_failed');
    reserved += attempt.reservedMicroUsd; requireTrue(Number.isSafeInteger(reserved), 'ledger_failed');
  }
  requireTrue(reserved === data.reservedMicroUsd, 'ledger_failed');
  const { attempts, ...header } = data; return copy(header);
}
function persistLedgerHistory(path, state) {
  const header = ledgerHeader(state), hash = createHash('sha256'); let fd, bytes = 0;
  try {
    fd = openSync(path, 'wx', 0o600);
    const write = text => {
      const buffer = Buffer.from(text); bytes += buffer.length;
      requireTrue(bytes <= 128 * 1024 * 1024, 'ledger_failed'); hash.update(buffer);
      let offset = 0; while (offset < buffer.length) offset += writeSync(fd, buffer, offset, buffer.length - offset);
    };
    write(`{"header":${JSON.stringify(header)},"attempts":[`);
    for (const [index, attempt] of state.attempts.entries()) write(`${index ? ',' : ''}${JSON.stringify(attempt)}`);
    write(']}\n'); fsyncSync(fd);
    return copy({ filename: path.slice(path.lastIndexOf('/') + 1), sha256: hash.digest('hex'), bytes,
      rows: state.attempts.length, header, complete: true });
  } catch { fail('record_persistence_failed'); }
  finally { if (fd !== undefined) closeSync(fd); }
}

/** Closed error projection; never read hostile getters, proxy traps or strings. */
export function sourceBundleFailureCode(error) {
  try {
    if (types.isProxy(error) || !types.isNativeError(error)) return 'provider_failed';
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    const code = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : null;
    if (CODES.has(code)) return code;
    const map = { algorithm_accounting_failure: 'ledger_failed', algorithm_checkpoint_mismatch: 'ledger_failed',
      algorithm_unaffordable: 'budget_blocked', algorithm_budget_exceeded: 'budget_blocked',
      algorithm_usage_anomaly: 'invalid_usage', algorithm_usage_overrun: 'usage_overrun',
      algorithm_auth_transport_failure: 'authentication_failed', algorithm_credential_echo: 'credential_echo',
      algorithm_persistence_failure: 'record_persistence_failed', algorithm_request_denied: 'request_denied',
      algorithm_method_denied: 'request_denied', algorithm_lifecycle: 'request_denied',
      algorithm_case_call_cap: 'request_denied', algorithm_phase_call_cap: 'request_denied',
      invalid_ledger: 'ledger_failed', ledger_closed: 'ledger_failed', ledger_missing: 'ledger_failed',
      configuration_mismatch: 'ledger_failed', unsafe_database_file: 'ledger_failed',
      invalid_input: 'rank_mismatch', request_mutated: 'rank_mismatch',
      invalid_bundle_sidecar: 'provenance_mismatch', invalid_bundle_evidence: 'provenance_mismatch',
      invalid_recall_provenance: 'provenance_mismatch', provenance_limit_exceeded: 'provenance_mismatch',
      bundle_answer_incomplete: 'provenance_mismatch', bundle_invocation_conflict: 'request_denied',
      invalid_model_output: 'invalid_model_output', provider_failure: 'provider_failed' };
    if (typeof code === 'string' && Object.hasOwn(map, code)) return map[code];
    const message = Object.getOwnPropertyDescriptor(error, 'message');
    if (message && Object.hasOwn(message, 'value')) {
      if (message.value === 'source_bundle_store_drift') return 'store_drift';
      if (message.value === 'invalid_source_bundle_preparation') return 'invalid_preparation';
      if (message.value === 'invalid_recall_provenance' || message.value === 'invalid_bundle_evidence') return 'provenance_mismatch';
    }
  } catch { /* Unknown failures carry no arbitrary data. */ }
  return 'provider_failed';
}
function nativeRedirect(error) {
  try {
    if (types.isProxy(error) || !types.isNativeError(error) || Object.getPrototypeOf(error) !== TypeError.prototype) return false;
    const message = Object.getOwnPropertyDescriptor(error, 'message'), cause = Object.getOwnPropertyDescriptor(error, 'cause');
    if (!message || !Object.hasOwn(message, 'value') || message.value !== 'fetch failed'
      || !cause || !Object.hasOwn(cause, 'value')) return false;
    const reason = cause.value;
    if (types.isProxy(reason) || !types.isNativeError(reason) || Object.getPrototypeOf(reason) !== Error.prototype) return false;
    const detail = Object.getOwnPropertyDescriptor(reason, 'message');
    return !!detail && Object.hasOwn(detail, 'value') && detail.value === 'unexpected redirect';
  } catch { return false; }
}

/** Concrete runtime boundary, also exercised directly by offline transport tests. */
export function createSourceBundleGuard(options) {
  const { fetchImpl, signal, deadline, onFatal, onDispatch } = own(options,
    ['fetchImpl', 'signal', 'deadline', 'onFatal', 'onDispatch']);
  requireTrue(typeof fetchImpl === 'function' && signal instanceof AbortSignal && Number.isFinite(deadline)
    && typeof onFatal === 'function' && typeof onDispatch === 'function', 'invalid_options');
  let closed = false;
  const cancelBody = response => { try { Promise.resolve(response.body.cancel()).catch(() => {}); } catch { /* best effort */ } };
  return freeze({ async fetch(url, init) {
    requireTrue(!closed && init?.signal instanceof AbortSignal, 'request_denied');
    const controller = new AbortController(); let reason = 'model_timeout';
    const abort = (code, fatal) => { reason = code; if (fatal && !closed) onFatal(code); controller.abort(); };
    const callerAbort = () => abort('cancelled', true), methodAbort = () => abort('model_timeout', false);
    signal.addEventListener('abort', callerAbort, { once: true }); init.signal.addEventListener('abort', methodAbort, { once: true });
    if (signal.aborted) callerAbort(); else if (init.signal.aborted) methodAbort();
    const timer = setTimeout(() => abort('deadline_exceeded', true), Math.max(0, deadline - performance.now()));
    let reader;
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', callerAbort); init.signal.removeEventListener('abort', methodAbort); };
    const race = pending => new Promise((resolve, reject) => {
      const cancelled = () => { controller.signal.removeEventListener('abort', cancelled); reject(Object.assign(new Error(reason), { code: reason })); };
      controller.signal.addEventListener('abort', cancelled, { once: true });
      Promise.resolve(pending).then(value => { controller.signal.removeEventListener('abort', cancelled);
        if (controller.signal.aborted) { if (value instanceof Response) cancelBody(value); cancelled(); } else resolve(value);
      }, error => { controller.signal.removeEventListener('abort', cancelled);
        if (controller.signal.aborted) { cancelled(); return; }
        const code = nativeRedirect(error) ? 'redirect_rejected' : 'provider_failed';
        if (code === 'redirect_rejected' && !closed) onFatal(code);
        reject(Object.assign(new Error(code), { code }));
      });
      if (controller.signal.aborted) cancelled();
    });
    try {
      if (performance.now() >= deadline) abort('deadline_exceeded', true);
      if (controller.signal.aborted) fail(reason);
      onDispatch();
      const response = await race(Promise.resolve().then(() => fetchImpl(url, { ...init, signal: controller.signal })));
      requireTrue(!types.isProxy(response) && Object.getPrototypeOf(response) === Response.prototype, 'invalid_response');
      if (response.redirected || response.status >= 300 && response.status < 400) onFatal('redirect_rejected');
      if (response.status === 401 || response.status === 403) onFatal('authentication_failed');
      if (!response.body) { finish(); return response; }
      reader = response.body.getReader();
      const stream = new ReadableStream({ async pull(output) {
        try { const part = await race(reader.read()); if (part.done) { finish(); reader.releaseLock(); output.close(); }
          else output.enqueue(part.value); }
        catch (error) { finish(); try { Promise.resolve(reader.cancel()).catch(() => {}); } catch { /* best effort */ }
          output.error(error); }
      }, cancel() { finish(); try { return reader.cancel(); } catch { return undefined; } } });
      const wrapped = new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
      Object.defineProperty(wrapped, 'redirected', { value: response.redirected });
      return wrapped;
    } catch (error) { finish(); throw Object.assign(new Error(sourceBundleFailureCode(error)), { code: sourceBundleFailureCode(error) }); }
  }, close() { closed = true; } });
}

/** A public manifest is a consistency binding, never a preparation capability. */
export function createSourceBundleComparisonManifest(observation) {
  const publicData = copy(observation);
  requireTrue(publicData.eligible === true && publicData.cases.length === 24
    && isDeepStrictEqual(publicData.cases.map(c => c.id), sourceBundleRoster)
    && sha(publicData.manifest) === publicData.manifestSha256, 'invalid_manifest');
  return freeze({ version: VERSION, preparationManifestSha256: publicData.manifestSha256,
    preparationManifest: publicData.manifest, dependencies: DEPENDENCIES, limits: LIMITS,
    schedule: publicData.cases.map((c, index) => ({ id: c.id, ordinal: index + 1,
      armOrder: sourceBundleOrders[index % 2], slots: {
        ordinary: `${c.id}_ordinary_qa`, 'source-bundle': `${c.id}_source_bundle_qa`, probe: `${c.id}_probe` } })) });
}

function initialCases(preparation) {
  return preparation.cases.map((c, index) => ({ id: c.id, ordinal: index + 1, question: c.question,
    armOrder: sourceBundleOrders[index % 2], preparationHashes: c.hashes,
    answers: Object.fromEntries(['ordinary', 'source-bundle'].map(arm => [arm,
      { status: 'unresolved', execution: 'not-run', answerInvoked: false, answer: null, failure: null,
        artifacts: { rankRequest: null, rankOutput: null, rankFailure: null, plannerRequest: null, plannerOutput: null, plannerFailure: null,
          recall: null, sidecar: null, authoritativeReads: null, evidence: null, packed: null,
          answerResult: null, beforeStore: null, afterRecallStore: null, beforeAnswerStore: null, afterStore: null } }])),
    probe: { execution: 'not-run', failure: null, artifacts: {} } }));
}

/** One explicit first comparison, no auto-execution, grant, retry or resume. */
export async function runSourceBundleComparison(options) {
  let descriptor;
  try { requireTrue(!types.isProxy(options) && options !== null && typeof options === 'object', 'invalid_options');
    descriptor = Object.getOwnPropertyDescriptor(options, 'preparation');
    requireTrue(descriptor && Object.hasOwn(descriptor, 'value'), 'invalid_options'); }
  catch { fail('invalid_options'); }
  const preparation = await consumeSourceBundlePreparation(descriptor.value);
  requireTrue(!running, 'run_busy'); running = true;
  const cases = initialCases(preparation), intents = new Map(), transitions = [], events = [];
  let sequence = 0, owner = null, phase = null, fatal = null, finalState = null, directory, guard,
    input, witness, checkpoint, countTokens, openMemoryCore, createOrdinary, createPlanner, inspect,
    activeCaseDeadline = null, historyBase = null, initialHistoryCount = null;
  const began = performance.now(), runDeadline = began + LIMITS.runMs;
  const stop = code => { fatal ??= FATAL.has(code) ? code : 'request_denied'; };
  const checkpointOf = state => ({ requestCount: state.requestCount, reservedMicroUsd: state.reservedMicroUsd });
  const trace = observation => {
    const event = copy({ version: VERSION, sequence: ++sequence, ...observation }); events.push(event);
    persist(join(directory, `${String(sequence).padStart(6, '0')}-event.json`), event);
    deliverSourceBundleObservation(input.onRecord, event);
  };
  const check = () => {
    if (input.signal.aborted) stop('cancelled');
    if (performance.now() >= runDeadline || activeCaseDeadline !== null && performance.now() >= activeCaseDeadline) stop('deadline_exceeded');
    if (fatal) fail(fatal);
  };
  const observe = raw => {
    try {
      requireTrue(phase && owner && raw.attemptId && typeof raw.requestBody === 'string', 'request_denied');
      let intent = intents.get(raw.attemptId); const first = !intent;
      requireTrue(raw.reservedMicroUsd === 5000 && (first || intent.final === null), 'request_denied');
      if (first) {
        requireTrue(raw.reservedMicroUsd === 5000 && intents.size < LIMITS.physicalIntents, 'budget_blocked');
        intent = { ordinal: intents.size + 1, attemptId: raw.attemptId, caseId: phase.caseId,
          slotId: phase.slotId, phaseId: phase.phaseId, method: phase.method, ownerKind: phase.kind, dispatched: false, final: null };
        intents.set(raw.attemptId, intent);
        requireTrue(phase.attempts.length < phase.maximum, 'request_denied'); phase.attempts.push(raw.attemptId);
      }
      requireTrue(intent.slotId === phase.slotId && raw.requestBody === phase.expectedBodies[first ? phase.attempts.length - 1
        : phase.attempts.indexOf(raw.attemptId)], 'wire_mismatch');
      const normalized = { phase: first ? 'pre' : 'post', physicalOrdinal: intent.ordinal,
        attemptId: raw.attemptId, dispatched: raw.dispatched ?? intent.dispatched };
      if (!first) intent.final = copy(raw);
      trace({ caseId: phase.caseId, caseOrdinal: phase.caseOrdinal, arm: phase.arm,
        slotId: phase.slotId, phaseId: phase.phaseId, phase: phase.method, ownerKind: phase.kind, normalized, raw });
    } catch (error) { stop(sourceBundleFailureCode(error)); throw Object.assign(new Error(fatal), { code: fatal }); }
  };
  const compactState = (state, diagnostic = false) => {
    const header = ledgerHeader(state), start = witness?.requestCount ?? initialHistoryCount;
    const prefixUnchanged = !witness || isDeepStrictEqual(state.attempts.slice(0, witness.attempts.length), witness.attempts);
    if (!diagnostic) requireTrue(prefixUnchanged, 'ledger_failed');
    if (!prefixUnchanged || state.requestCount - initialHistoryCount > LIMITS.physicalIntents + 1)
      return copy({ representation: 'exact-history-artifact-v1', diagnostic: true, prefixUnchanged,
        artifact: persistLedgerHistory(join(directory, 'final-ledger-history.json'), state), header });
    return copy({ representation: 'base-plus-ordered-delta-v1', base: historyBase, header, prefixUnchanged,
      deltaStart: start, appendedAttempts: state.attempts.slice(start), diagnostic });
  };
  async function closeOwner() {
    if (!owner) return;
    const owned = owner, currentPhase = phase; owner = null;
    let state, healthy = true;
    try {
      if (currentPhase.kind === 'ordinary') owned.assertHealthy();
      else if (owned.health().fatalCode) { healthy = false; stop(sourceBundleFailureCode(Object.assign(new Error('planner_fatal'),
        { code: owned.health().fatalCode }))); }
      if (healthy) state = currentPhase.kind === 'ordinary' ? owned.state() : owned.getState();
      if (healthy) requireTrue(!witness || isDeepStrictEqual(state.attempts.slice(0, witness.attempts.length), witness.attempts), 'ledger_failed');
    } catch (error) { healthy = false; stop(sourceBundleFailureCode(error)); }
    try { owned.close(); } catch { healthy = false; stop('ledger_failed'); }
    guard?.close(); guard = null;
    if (!healthy) {
      try { finalState = compactState(inspect(input.configuration), true); } catch { stop('ledger_failed'); }
      stop(fatal ?? 'ledger_failed');
      transitions.push(copy({ ...currentPhase.identity, closed: true, healthy: false, finalState }));
      return;
    }
    finalState = compactState(state); witness = state; checkpoint = checkpointOf(state);
    const transition = copy({ ...currentPhase.identity, closed: true, healthy: true, state: finalState });
    transitions.push(transition); trace({ type: 'owner-closed', ...transition });
    deliverSourceBundleObservation(input.onCheckpoint, transition);
  }
  async function paidPhase(c, report, arm, method, kind, expectedBodies, operation) {
    check();
    const maximum = method === 'answer' ? 1 : 2;
    requireTrue(intents.size + maximum <= 192 && (intents.size + maximum) * 5000 <= 960000, 'budget_blocked');
    const slotId = input.manifest.schedule[report.ordinal - 1].slots[arm];
    const phaseId = `${c.id}_${arm.replaceAll('-', '_')}_${method}`;
    phase = { caseId: c.id, caseOrdinal: report.ordinal, arm, method, kind,
      caseDeadline: report.caseDeadline, slotId, phaseId,
      maximum, expectedBodies, attempts: [], identity: { caseId: c.id, caseOrdinal: report.ordinal, slotId, phaseId, arm, method, kind,
        runDeadline, caseDeadline: report.caseDeadline } };
    guard = createSourceBundleGuard({ fetchImpl: input.fetchImpl, signal: input.signal,
      deadline: Math.min(runDeadline, report.caseDeadline), onFatal: stop,
      onDispatch() { const attempt = intents.get(phase.attempts.at(-1)); requireTrue(attempt && !attempt.dispatched, 'request_denied'); attempt.dispatched = true; } });
    try {
      const common = { configuration: input.configuration, checkpoint, historySha256: witness?.historySha256 ?? input.historySha256,
        apiKey: input.apiKey, fetchImpl: guard.fetch, onRecord: observe };
      if (kind === 'ordinary') {
        owner = createOrdinary(common);
        owner.beginCase({ id: c.id, ordinal: 1 }); owner.beginArm(arm === 'source-bundle' ? 'full' : 'baseline');
      } else owner = await createPlanner({ ...common, manifest: { version: 'source-bundle-plan-rank-v1',
        slotId: phase.phaseId, preparedRequestSha256: c.hashes.bundlePreparedSha256, runDeadline, caseDeadline: report.caseDeadline } });
      if (!historyBase) {
        const initial = kind === 'ordinary' ? owner.state() : owner.getState();
        historyBase = persistLedgerHistory(join(directory, 'initial-ledger-history.json'), initial);
        initialHistoryCount = initial.requestCount; witness = initial;
      }
      return await operation(owner);
    } catch (error) { const code = sourceBundleFailureCode(error); if (FATAL.has(code)) stop(code); throw Object.assign(new Error(code), { code }); }
    finally { try {
      if (owner) await closeOwner();
      else if (fatal && inspect && historyBase) finalState = compactState(inspect(input.configuration), true);
    } catch (error) { stop(sourceBundleFailureCode(error)); }
      guard?.close(); guard = null; phase = null; }
  }
  async function qa(c, report, arm) {
    const slot = report.answers[arm]; slot.execution = 'failed';
    let core, evidence, packed, sidecar, activePort, rankCount = 0, methodFailure = null;
    try {
      slot.artifacts.beforeStore = await assertSourceBundleStoreUnchanged(c); check();
      const attestRank = request => {
        rankCount++;
        requireTrue(rankCount === 1 && isDeepStrictEqual({ system: request.system, input: request.input,
          maxOutputTokens: request.maxOutputTokens }, c.rankRequest), 'rank_mismatch');
        slot.artifacts.rankRequest = c.rankRequest;
      };
      const bodies = arm === 'ordinary' ? c.ordinaryWire : c.bundleWire;
      const recall = await paidPhase(c, report, arm, arm === 'ordinary' ? 'rank' : 'plan',
        arm === 'ordinary' ? 'ordinary' : 'planner', [bodies.countBody, bodies.generationBody], async () => {
          const base = { contextWindow: 8192, countTokens, select() { fail('request_denied'); } };
          let bundleModel;
          if (arm === 'source-bundle') bundleModel = createBundleRankModel(base, {
            async planRank(request) {
              requireTrue(sha({ system: request.system, input: request.input, outputSchema: request.outputSchema,
                maxOutputTokens: request.maxOutputTokens }) === c.hashes.bundlePreparedSha256, 'rank_mismatch');
              slot.artifacts.plannerRequest = copy({ system: request.system, input: request.input,
                outputSchema: request.outputSchema, maxOutputTokens: request.maxOutputTokens });
              try { const output = await owner.planRank(request); slot.artifacts.plannerOutput = copy(output); return output; }
              catch (error) {
                const rawCode = sourceBundleFailureCode(error), health = owner.health();
                const absoluteDeadlineLive = performance.now() < Math.min(runDeadline, report.caseDeadline);
                const localTimeout = ['cancelled', 'deadline_exceeded', 'model_timeout'].includes(rawCode)
                  && !input.signal.aborted && absoluteDeadlineLive && !fatal
                  && health.state === 'consumed' && health.fatalCode === null;
                const normalizedCode = localTimeout ? 'model_timeout' : rawCode;
                slot.artifacts.plannerFailure = copy({ rawCode, normalizedCode, health,
                  callerAborted: input.signal.aborted, absoluteDeadlineLive,
                  normalization: localTimeout ? 'healthy-settled-per-call-timeout' : 'unchanged' });
                throw Object.assign(new Error(normalizedCode), { code: normalizedCode });
              }
            }, onPlan(actual) { requireTrue(!sidecar, 'request_denied'); sidecar = actual; slot.artifacts.sidecar = copy(actual); } });
          const model = { ...base, rank(request) {
            attestRank(request);
            activePort = (async () => {
              try { const output = arm === 'ordinary' ? await owner.model.rank(request) : await bundleModel.rank(request);
                slot.artifacts.rankOutput = copy(output); return output; }
              catch (error) { methodFailure = sourceBundleFailureCode(error);
                slot.artifacts.rankFailure = copy({ code: methodFailure }); throw error; }
            })(); return activePort;
          } };
          core = openMemoryCore({ path: c.storePath, sourceCandidatePolicy: 'bounded-keyset-v1', model });
          const returned = await core.recall({ readSet: [c.namespace], query: c.plan.mem0Input.query, limit: 6,
            contextMode: 'source-evidence', selectionMode: 'bounded-source-scan' });
          slot.artifacts.recall = copy(returned);
          // The core's logical race can resolve first. Await the actual imported
          // port's settlement before reading/closing/rebinding its ledger owner.
          if (activePort) await activePort.catch(() => {}); return returned;
        });
      slot.artifacts.recall = copy(recall);
      slot.artifacts.afterRecallStore = await assertSourceBundleStoreUnchanged(c); check();
      requireTrue(recall.ok === true, recall.error?.code === 'model_timeout' ? 'model_timeout'
        : methodFailure ?? (recall.error?.code === 'invalid_model_output' ? 'invalid_model_output' : 'provenance_mismatch'));
      requireTrue(rankCount === 1 && recall.value.coverage === 'complete' && !recall.value.recallTruncated
        && recall.value.selection.strategy === 'complete-map', 'rank_mismatch');
      const reads = []; slot.artifacts.authoritativeReads = reads;
      const observedCore = { get(input) { const returned = core.get(input); reads.push(copy({ input, returned })); return returned; } };
      if (arm === 'ordinary') { evidence = verifiedRoleEvidence(recall.value, input => observedCore.get(input), c.plan, c.namespace);
        packed = packMixedAnswer({ question: c.question, units: evidence.units, countTokens }); }
      else { slot.artifacts.sidecar = copy(sidecar);
        evidence = assembleSourceBundleEvidence({ sidecar, recall, core: observedCore, plan: c.plan, namespace: c.namespace, question: c.question });
        packed = packSourceBundleAnswer({ evidence, countTokens }); }
      requireTrue(packed.inputTokens <= 6000 && !packed.omittedIndices.length && !packed.duplicateIndices.length
        && packed.selectedIndices.length === evidence.units.length, 'provenance_mismatch');
      slot.artifacts.authoritativeReads = reads; slot.artifacts.evidence = copy(evidence); slot.artifacts.packed = copy(packed);
      core.close(); core = null;
      slot.artifacts.beforeAnswerStore = await assertSourceBundleStoreUnchanged(c); check();
      const answer = await paidPhase(c, report, arm, 'answer', 'ordinary', [JSON.stringify(packed.request)], async transport => {
        slot.answerInvoked = true; return await transport.answer({ question: c.question, units: evidence.units });
      });
      slot.artifacts.answerResult = copy(answer); slot.answer = answer.answer;
      requireTrue(isDeepStrictEqual(answer.packed.request, packed.request), 'wire_mismatch');
      slot.status = 'answered'; slot.execution = 'completed'; check();
    } catch (error) { const code = fatal ?? sourceBundleFailureCode(error); slot.failure = code; if (FATAL.has(code)) stop(code); }
    finally { core?.close(); try { slot.artifacts.afterStore = await assertSourceBundleStoreUnchanged(c); }
      catch { stop('store_drift'); slot.failure = 'store_drift'; } }
  }
  async function probe(c, report) {
    const slot = report.probe; slot.execution = 'failed'; let core, activePort, selects = 0, ranks = 0;
    try {
      slot.artifacts.beforeStore = await assertSourceBundleStoreUnchanged(c); check();
      const result = await paidPhase(c, report, 'probe', 'select', 'ordinary', [], async transport => {
        const model = { contextWindow: 8192, countTokens,
          async select(request) {
            if (selects) { stop('request_denied'); fail('request_denied'); }
            requireTrue(++selects === 1 && request.input.maps.length === 1 && request.input.maps[0].items.length === 12
              && request.input.maps[0].exhausted === true && request.input.query === c.plan.mem0Input.query
              && request.input.maps[0].namespaceIndex === 0 && isDeepStrictEqual(request.input.maps[0].items, c.recallMap.items), 'rank_mismatch');
            slot.artifacts.selectRequest = copy({ system: request.system, input: request.input, maxOutputTokens: request.maxOutputTokens });
            // Serialize the unchanged select request to attest its actual wire.
            const { createOpenAIModel } = await import('../../adapters/openai/index.mjs');
            const bodies = [];
            const serializer = createOpenAIModel({ apiKey: 'serializer-only', fetchImpl: async (_url, init) => {
              bodies.push(init.body); if (bodies.length === 1) return Response.json({ object: 'response.input_tokens', input_tokens: 0 });
              throw new Error('serializer_complete'); } });
            try { await serializer.select(request); } catch { /* Stops at generation, no external HTTP. */ }
            requireTrue(bodies.length === 2 && bodies.every(body => countTokens(body) <= 6000), 'context_budget_exceeded');
            phase.expectedBodies = bodies;
            activePort = transport.model.select(request);
            const output = await activePort; slot.artifacts.selected = copy(output); return output;
          }, rank({ system, input, maxOutputTokens }) {
            if (ranks) { stop('request_denied'); fail('request_denied'); }
            requireTrue(++ranks === 1, 'request_denied'); slot.artifacts.rankRequest = copy({ system, input, maxOutputTokens }); return { refs: [] };
          } };
        core = openMemoryCore({ path: c.storePath, sourceCandidatePolicy: 'bounded-keyset-v1', model });
        const returned = await core.recall({ readSet: [c.namespace], query: c.plan.mem0Input.query, limit: 6, contextMode: 'source-evidence' });
        slot.artifacts.recall = copy(returned);
        if (activePort) await activePort.catch(() => {}); return returned;
      });
      slot.artifacts.recall = copy(result); slot.artifacts.selectCalls = selects; slot.artifacts.rankCalls = ranks; check();
      requireTrue(result.ok === true && selects === 1, 'invalid_model_output'); slot.execution = 'completed';
    } catch (error) { const code = fatal ?? sourceBundleFailureCode(error); slot.failure = code; if (FATAL.has(code)) stop(code); }
    finally { core?.close(); try { slot.artifacts.afterStore = await assertSourceBundleStoreUnchanged(c); } catch { stop('store_drift'); } }
  }
  try {
    const candidateDirectory = join(preparation.outputRoot, 'comparison');
    try { mkdirSync(candidateDirectory, { mode: 0o700 }); } catch { fail('record_persistence_failed'); }
    directory = candidateDirectory;
    input = own(options, ['preparation', 'manifest', 'configuration', 'checkpoint', 'historySha256',
      'apiKey', 'fetchImpl', 'onRecord', 'onCheckpoint', 'signal']);
    const data = copy({ manifest: input.manifest, configuration: input.configuration,
      checkpoint: input.checkpoint, historySha256: input.historySha256 });
    input = { ...input, ...data };
    requireTrue(isDeepStrictEqual(input.manifest, createSourceBundleComparisonManifest(preparation)), 'invalid_manifest');
    requireTrue(input.signal instanceof AbortSignal && typeof input.fetchImpl === 'function' && typeof input.onRecord === 'function'
      && typeof input.onCheckpoint === 'function' && typeof input.apiKey === 'string' && /^[A-Za-z0-9_-]{12,200}$/u.test(input.apiKey), 'invalid_options');
    requireTrue(!JSON.stringify(preparation).includes(input.apiKey) && !JSON.stringify(data).includes(input.apiKey), 'credential_echo');
    checkpoint = input.checkpoint;
    ({ openMemoryCore } = await import('../../core/contract.mjs'));
    ({ countOpenAITokens: countTokens } = await import('../../adapters/openai/index.mjs'));
    ({ createAlgorithmDevelopmentTransport: createOrdinary } = await import('./transport.mjs'));
    ({ createSourceBundlePlanRankTransport: createPlanner } = await import('../architecture/source-bundle-plan-rank-transport.mjs'));
    ({ inspectEmbeddingExperimentBudgetSnapshot: inspect } = await import('../experiment-budget/index.mjs'));
    persist(join(directory, 'manifest.json'), input.manifest); persist(join(directory, 'initial-slots.json'), cases);
    check();
    for (const [index, c] of preparation.cases.entries()) {
      const report = cases[index]; report.caseDeadline = Math.min(runDeadline, performance.now() + LIMITS.caseMs);
      activeCaseDeadline = report.caseDeadline;
      for (const arm of report.armOrder) { await qa(c, report, arm); if (fatal) break; }
      if (fatal) break; await probe(c, report); if (fatal) break;
    }
  } catch (error) { fatal ??= sourceBundleFailureCode(error); }
  finally { try { await closeOwner(); } catch { stop('ledger_failed'); } guard?.close(); running = false; }
  if (fatal) for (const report of cases) {
    for (const slot of [...Object.values(report.answers), report.probe]) if (slot.execution === 'not-run') slot.failure = fatal;
  }
  const result = copy({ version: VERSION, manifest: input?.manifest ?? null, manifestSha256: input?.manifest ? sha(input.manifest) : null,
    status: fatal ? 'stopped' : 'accounted', stopReason: fatal, limits: LIMITS, deadlines: { began, runDeadline }, cases,
    history: { representation: 'initial-artifact-plus-transition-deltas-v1', base: historyBase },
    resources: { physicalIntents: intents.size, reservedMicroUsd: intents.size * 5000, peakRss: null,
      preparedStoreBytes: preparation.cases.reduce((sum, c) => sum + c.state.fileBytes, 0),
      transportLatencyMs: [...intents.values()].reduce((sum, intent) => sum + (intent.final?.latencyMs ?? 0), 0),
      knownMicroUsd: [...intents.values()].reduce((sum, intent) => sum + (intent.final?.actualMicroUsd ?? 0), 0),
      knownMicroUsdCoverage: 'partial-known-only',
      unknownUsageIntents: [...intents.values()].filter(intent => intent.final?.actualMicroUsd == null).length,
      unknownUsageReservedMicroUsd: [...intents.values()].filter(intent => intent.final?.actualMicroUsd == null).length * 5000,
      missingFinalRecords: [...intents.values()].filter(intent => intent.final === null).length,
      elapsedMs: performance.now() - began }, intents: [...intents.values()], transitions, finalState });
  if (directory) persist(join(directory, 'result.json'), result);
  return result;
}
