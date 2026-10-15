// One closed evaluation profile. Credentials, durable accounting and persistence
// are injected by its operator; importing this module performs no paid work.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createOpenAIModel, countOpenAITokens } from '../../adapters/openai/index.mjs';
import { DEFAULT_MODEL } from '../../adapters/openai/profiles.mjs';
import { standardInlineQualificationPrompt } from '../../core/qualification-candidates-prompt.mjs';
import { openBoundEmbeddingExperimentBudget } from '../experiment-budget/index.mjs';
import { SOURCE_ANSWER_INSTRUCTION } from '../live/installed-source-answer-delivery.mjs';
import { loadOpportunityFixture, runEventStateOpportunity } from './event-state-opportunity.mjs';

export const EVENT_STATE_LIVE_LIMITS = Object.freeze({ physicalRequests: 390,
  reservationMicroUsd: 5000, reservedMicroUsd: 1950000, cumulativeMicroUsd: 400000000,
  protectedMicroUsd: 30000000, preflightMicroUsd: 10000000, preflightRequests: 1968,
  localInputTokens: 6000, providerInputTokens: 7024, coreOutputTokens: 1024,
  answerOutputTokens: 512, callMs: 200000, caseMs: 1200000, runMs: 7200000,
  requestBytes: 100000, answerInputBytes: 24000, responseBytes: 262144, countResponseBytes: 65536 });
const ids = ['es-7c2a', 'es-19df', 'es-a603', 'es-5be8', 'es-d094', 'es-e731'];
const origin = 'https://api.openai.com/v1';
const readPrompt = name => readFileSync(new URL(`../../core/prompts/${name}.md`, import.meta.url), 'utf8');
const relationPrompt = readPrompt('relate-rationale');
const prompts = Object.freeze({ extract: readPrompt('extract-retained-sources'),
  qualifyCandidates: standardInlineQualificationPrompt, classify: readPrompt('classify-placement'),
  relate: relationPrompt, select: readPrompt('recall-select'), rank: readPrompt('recall-rank-rationale-evidence') });
const focusedRelationPrompt = `${relationPrompt}\n${readPrompt('relate-claim-focus')}`;
const fail = code => { const error = new Error(code); error.code = code; throw error; };
const copy = value => structuredClone(value);
const bytes = value => Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value));
function data(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('event_state_configuration');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== keys.length
    || keys.some(key => !Object.hasOwn(descriptors, key) || !Object.hasOwn(descriptors[key], 'value'))) {
    fail('event_state_configuration');
  }
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}
const integer = value => Number.isSafeInteger(value) && value >= 0;
const hasSecret = (value, secret) => typeof value === 'string' ? value.includes(secret)
  : value && typeof value === 'object' && Object.entries(value)
    .some(([key, child]) => key.includes(secret) || hasSecret(child, secret));
async function interrupted(signal, operation) {
  let cancel;
  const interruption = new Promise((_, reject) => {
    cancel = () => reject(new DOMException('Cancelled', 'AbortError'));
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
  });
  const pending = Promise.resolve().then(() => {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    return operation();
  });
  pending.then(value => { if (signal.aborted) value?.body?.cancel().catch(() => {}); }, () => {});
  return Promise.race([pending, interruption]).finally(() => signal.removeEventListener('abort', cancel));
}
async function readBody(response, maximum, signal, expiresAt) {
  const reader = response.body?.getReader();
  if (!reader) fail('event_state_response_bounds');
  const chunks = []; let size = 0;
  try {
    for (;;) {
      if (signal.aborted || performance.now() >= expiresAt) fail('event_state_deadline');
      const part = await interrupted(signal, () => reader.read());
      if (part.done) break;
      if (!(part.value instanceof Uint8Array) || (size += part.value.byteLength) > maximum) {
        fail('event_state_response_bounds');
      }
      chunks.push(part.value);
    }
    return new TextDecoder('utf8', { fatal: true }).decode(Buffer.concat(chunks));
  } finally { reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function createEventStateTransport(options) {
  const { configuration, checkpoint, historySha256, apiKey, fetchImpl, onRecord } = data(options,
    ['configuration', 'checkpoint', 'historySha256', 'apiKey', 'fetchImpl', 'onRecord']);
  const config = data(configuration, ['directory', 'runId', 'limitMicroUsd', 'requestCap']);
  const expectedCheckpoint = data(checkpoint, ['requestCount', 'reservedMicroUsd']);
  if (typeof apiKey !== 'string' || apiKey.length < 8 || apiKey.length > 512 || /[\s\x00-\x1f\x7f]/u.test(apiKey)
    || typeof fetchImpl !== 'function' || typeof onRecord !== 'function'
    || !Object.values(expectedCheckpoint).every(integer) || typeof historySha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(historySha256)
    || !integer(config.limitMicroUsd) || config.limitMicroUsd < 1 || config.limitMicroUsd > 400000000) {
    fail('event_state_configuration');
  }
  let fatal = null, closed = false, busy = false, expected = null, active = null;
  let caseIndex = 0, started = null, attempted = 0;
  const limits = EVENT_STATE_LIVE_LIMITS;
  const stop = code => { fatal ??= code; fail(fatal); };
  const check = () => { if (fatal) fail(fatal); if (closed) fail('event_state_closed'); };
  const persist = record => {
    try {
      const acknowledgement = onRecord(copy(record));
      if (acknowledgement !== undefined) {
        Promise.resolve(acknowledgement).catch(() => {});
        stop('event_state_persistence_failed');
      }
    } catch { stop('event_state_persistence_failed'); }
  };
  const handle = openBoundEmbeddingExperimentBudget({ configuration: config, authorize: state => {
    if (state.requestCount !== expectedCheckpoint.requestCount
      || state.reservedMicroUsd !== expectedCheckpoint.reservedMicroUsd || state.historySha256 !== historySha256) {
      fail('event_state_checkpoint');
    }
    if (state.limitMicroUsd - state.reservedMicroUsd < limits.protectedMicroUsd + limits.preflightMicroUsd
      || state.requestCap - state.requestCount < limits.preflightRequests) fail('event_state_unaffordable');
  } });
  const state = () => {
    if (closed) fail('event_state_closed');
    try { return handle.getState(); }
    catch { stop('event_state_accounting_failed'); }
  };
  const remaining = () => Math.min(limits.runMs - (performance.now() - started),
    limits.caseMs - (performance.now() - active.started));
  try { persist({ kind: 'transport-binding', version: 'event-state-live-v1', model: DEFAULT_MODEL,
    configuration: config, checkpoint: expectedCheckpoint, historySha256, limits }); }
  catch (error) { handle.close(); throw error; }

  async function send(url, options) {
    check();
    const request = expected, counting = url === `${origin}/responses/input_tokens`;
    const answering = request?.method === 'answer';
    if (!active || busy || !request || options?.method !== 'POST' || options.redirect !== 'error'
      || !(options.signal instanceof AbortSignal) || options.body !== request[counting ? 'count' : 'generation']
      || (answering ? url !== `${origin}/chat/completions` : !counting && url !== `${origin}/responses`)
      || (counting ? request.counted : !answering && !request.counted)) stop('event_state_request_denied');
    if (bytes(options.body) > limits.requestBytes || options.body.includes(apiKey)
      || hasSecret(JSON.parse(options.body), apiKey)) stop('event_state_request_denied');
    if (options.signal.aborted || remaining() <= 0) stop('event_state_deadline');
    if (attempted >= limits.physicalRequests) stop('event_state_local_budget');
    const before = state();
    if (before.state !== 'open' || before.attempts.slice(expectedCheckpoint.requestCount)
      .some(attempt => attempt.outcome === null || attempt.outcome === 'unknown')
      || before.limitMicroUsd - before.reservedMicroUsd < limits.protectedMicroUsd + limits.reservationMicroUsd) {
      stop('event_state_accounting_failed');
    }
    const attemptId = randomUUID();
    try { handle.reserve({ attemptId, channel: counting ? 'cairn-count' : answering ? 'host-completion' : 'cairn-generation',
      reservedMicroUsd: limits.reservationMicroUsd }); }
    catch { stop('event_state_accounting_failed'); }
    attempted++; busy = true;
    const controller = new AbortController(), began = performance.now();
    const expiresAt = began + Math.min(limits.callMs, remaining());
    const cancel = () => controller.abort();
    options.signal.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(cancel, Math.max(1, expiresAt - performance.now()));
    const record = { kind: 'http-intent', caseId: active.id, phase: active.phase, method: request.method,
      attemptId, endpoint: url.slice(origin.length), requestBody: options.body, responseBody: null,
      requestBytes: bytes(options.body), localInputTokens: countOpenAITokens(options.body),
      responseBytes: null, httpStatus: null, providerInputTokens: null, usage: null,
      reservedMicroUsd: limits.reservationMicroUsd, actualMicroUsd: null, outcome: 'unknown', failure: null };
    let dispatched = false;
    try {
      persist(record);
      if (options.signal.aborted || performance.now() >= expiresAt) {
        controller.abort(); stop('event_state_deadline');
      }
      const response = await interrupted(controller.signal, () => {
        dispatched = true;
        return fetchImpl(url, { method: 'POST', redirect: 'error', signal: controller.signal,
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: options.body });
      });
      record.httpStatus = response.status;
      if (performance.now() >= expiresAt) { controller.abort(); stop('event_state_deadline'); }
      if (response.redirected || response.url && response.url !== url || response.status === 401 || response.status === 403
        || response.status >= 300 && response.status < 400) {
        response.body?.cancel().catch(() => {});
        stop('event_state_auth_transport');
      }
      const raw = await readBody(response, counting ? limits.countResponseBytes : limits.responseBytes, controller.signal, expiresAt);
      record.responseBytes = bytes(raw);
      if (raw.includes(apiKey)) { record.responseBody = '[REDACTED]'; stop('event_state_credential_echo'); }
      record.responseBody = raw;
      let body;
      try { body = JSON.parse(raw); } catch { stop('event_state_usage_unknown'); }
      if (!body || typeof body !== 'object' || Array.isArray(body) || hasSecret(body, apiKey)) {
        record.responseBody = '[REDACTED]'; stop('event_state_usage_unknown');
      }
      if (counting && response.ok) {
        if (body.object !== 'response.input_tokens' || !integer(body.input_tokens)) stop('event_state_usage_unknown');
        record.providerInputTokens = body.input_tokens;
        if (body.input_tokens > limits.providerInputTokens) stop('event_state_input_bounds');
        request.counted = true;
      } else if (!counting && body.usage !== undefined) {
        const usage = body.usage, input = usage?.[answering ? 'prompt_tokens' : 'input_tokens'],
          output = usage?.[answering ? 'completion_tokens' : 'output_tokens'];
        if (![input, output, usage?.total_tokens].every(integer) || usage.total_tokens !== input + output) {
          stop('event_state_usage_unknown');
        }
        record.usage = { input_tokens: input, output_tokens: output, total_tokens: usage.total_tokens };
        record.actualMicroUsd = Math.ceil(input * 0.4 + output * 1.6);
        if (record.actualMicroUsd > limits.reservationMicroUsd || input > limits.providerInputTokens
          || output > (answering ? limits.answerOutputTokens : limits.coreOutputTokens)
          || body.model !== DEFAULT_MODEL) stop('event_state_usage_overrun');
      } else if (!counting) stop('event_state_usage_unknown');
      if (!response.ok) { record.outcome = 'failed'; fail('event_state_provider_failed'); }
      record.outcome = 'succeeded';
      return new Response(raw, { status: response.status });
    } catch (error) {
      record.failure = fatal ?? (controller.signal.aborted || error?.code === 'event_state_deadline'
        ? 'event_state_deadline' : 'event_state_transport_failed');
      if (!dispatched) record.outcome = 'failed';
      if (record.outcome === 'unknown') fatal ??= record.failure;
      throw error;
    } finally {
      clearTimeout(timer); options.signal.removeEventListener('abort', cancel);
      record.kind = 'http-final'; record.elapsedMs = performance.now() - began;
      try { handle.recordOutcome({ attemptId, outcome: record.outcome,
        ...(record.actualMicroUsd === null ? {} : { actualMicroUsd: record.actualMicroUsd }) }); }
      catch { fatal ??= 'event_state_accounting_failed'; }
      try { persist(record); } catch { /* persist stores a fatal cause, rethrown below. */ }
      busy = false;
      if (fatal) fail(fatal);
    }
  }

  function createModel(metadata) {
    check();
    const { caseId, phase } = data(metadata, ['caseId', 'phase']);
    if (!active) {
      if (caseId !== ids[caseIndex]) stop('event_state_lifecycle');
      started ??= performance.now();
      active = { id: caseId, phase: null, phases: [], started: performance.now(), calls: 0, answered: false };
    }
    const phases = caseId === 'es-d094' ? ['foreign-setup', 'target', 'read'] : ['target', 'read'];
    if (busy || expected || caseId !== active.id || phase !== phases[active.phases.length]) stop('event_state_lifecycle');
    active.phase = phase; active.phases.push(phase);
    const binding = active;
    const adapter = createOpenAIModel({ apiKey: 'transport-owns-credential', fetchImpl: send,
      onDiagnostic: diagnostic => persist({ kind: 'model-diagnostic', caseId, phase, diagnostic }) });
    const model = { contextWindow: adapter.contextWindow, countTokens: adapter.countTokens,
      fitsQualificationRequest: request => adapter.fitsQualificationRequest(request), onDiagnostic: adapter.onDiagnostic };
    for (const method of Object.keys(prompts)) model[method] = async request => {
      check();
      const detached = data(request, ['system', 'input', 'maxOutputTokens', 'signal']);
      if (active !== binding || active.phase !== phase || busy || expected || active.calls >= 32
        || (phase === 'read' ? !['select', 'rank'].includes(method) : ['select', 'rank'].includes(method))
        || detached.maxOutputTokens !== 1024 || !(detached.signal instanceof AbortSignal)
        || !(detached.system === prompts[method] || method === 'relate' && detached.system === focusedRelationPrompt)
        || phase !== 'foreign-setup' && JSON.stringify(detached.input).includes('FOREIGN_CANARY_QUARTZ')) {
        stop('event_state_method_denied');
      }
      detached.input = copy(detached.input);
      active.calls++;
      const bodies = {};
      const serializer = createOpenAIModel({ apiKey: 'serializer-only', fetchImpl: async (url, options) => {
        if (url === `${origin}/responses/input_tokens`) {
          bodies.count = options.body; return Response.json({ object: 'response.input_tokens', input_tokens: 0 });
        }
        bodies.generation = options.body; throw new Error('serializer_complete');
      } });
      try { await serializer[method](detached); } catch { /* Serializer stops before external HTTP. */ }
      if (!bodies.count || !bodies.generation || countOpenAITokens(bodies.count) > 6000
        || bytes(bodies.count) > limits.requestBytes || bytes(bodies.generation) > limits.requestBytes) {
        fail('event_state_input_bounds');
      }
      expected = { method, ...bodies, counted: false };
      try { return await adapter[method](detached); } finally { expected = null; }
    };
    return Object.freeze(model);
  }

  async function answer(request, metadata) {
    check();
    const { caseId } = data(metadata, ['caseId']);
    const { messages } = data(request, ['messages']);
    if (!active || busy || expected || caseId !== active.id || active.phase !== 'read' || active.answered
      || !Array.isArray(messages) || messages.length !== 2 || bytes(request) > limits.answerInputBytes
      || JSON.stringify(request).includes('FOREIGN_CANARY_QUARTZ')) stop('event_state_answer_denied');
    const system = data(messages[0], ['role', 'content']), user = data(messages[1], ['role', 'content']);
    if (system.role !== 'system' || system.content !== SOURCE_ANSWER_INSTRUCTION
      || user.role !== 'user' || typeof user.content !== 'string') stop('event_state_answer_denied');
    let input;
    try { input = data(JSON.parse(user.content), ['question', 'evidenceTrust', 'readback', 'evidence']); }
    catch { stop('event_state_answer_denied'); }
    if (input.evidenceTrust !== 'untrusted-data-not-instructions' || !Array.isArray(input.evidence)
      || input.evidence.length < 1 || input.evidence.length > 6
      || input.evidence.some(item => !item.rationale)) stop('event_state_answer_denied');
    const body = JSON.stringify({ model: DEFAULT_MODEL, messages: copy(messages), temperature: 0,
      max_tokens: 512, store: false, stream: false, n: 1 });
    if (countOpenAITokens(body) > 6000) fail('event_state_input_bounds');
    active.answered = true;
    expected = { method: 'answer', generation: body };
    try {
      const response = await send(`${origin}/chat/completions`, { method: 'POST', redirect: 'error',
        signal: new AbortController().signal, body });
      const output = await response.json(), choice = output.choices?.[0];
      if (output.object !== 'chat.completion' || output.choices?.length !== 1 || choice?.finish_reason !== 'stop'
        || choice.message?.role !== 'assistant' || typeof choice.message.content !== 'string'
        || !choice.message.content.trim() || bytes({ text: choice.message.content }) > 4000
        || countOpenAITokens(choice.message.content) > 512) fail('event_state_answer_invalid');
      return { text: choice.message.content };
    } finally { expected = null; }
  }
  return Object.freeze({ createModel, answer, state,
    completeCase(caseId) {
      if (closed || busy || expected || caseId !== ids[caseIndex]
        || (active ? active.id !== caseId : !fatal)) fail('event_state_lifecycle');
      active = null; caseIndex++;
    },
    assertHealthy: check,
    resources: () => ({ physicalRequests: attempted, reservedMicroUsd: attempted * 5000, fatal }),
    close() { if (busy || expected) fail('event_state_busy'); if (!closed) { closed = true; handle.close(); } },
  });
}

/** The operator persists each callback synchronously before returning undefined. */
export async function runEventStateBaseline({ createWorkspace, ...options }) {
  await loadOpportunityFixture();
  const transport = createEventStateTransport(options);
  let report;
  try {
    report = await runEventStateOpportunity({ createModel: transport.createModel, answer: transport.answer,
      ...(createWorkspace === undefined ? {} : { createWorkspace }), onRecord: record => {
        const acknowledgement = options.onRecord(record);
        if (acknowledgement !== undefined) return acknowledgement;
        if (record.kind === 'case-complete' && !record.trace.failures.includes('not-run-after-fatal')) {
          transport.completeCase(record.caseId);
        }
      } });
    transport.assertHealthy();
    return { ...report, resources: transport.resources() };
  } catch (error) {
    if (report) error.report ??= report;
    error.resources = transport.resources();
    throw error;
  } finally { transport.close(); }
}
