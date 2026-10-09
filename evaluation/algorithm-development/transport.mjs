import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createOpenAIModel, countOpenAITokens } from '../../adapters/openai/index.mjs';
import { DEFAULT_MODEL, modelProfile } from '../../adapters/openai/profiles.mjs';
import { openBoundEmbeddingExperimentBudget } from '../experiment-budget/index.mjs';
import { packMixedAnswer } from '../longmemeval/mixed-answer.mjs';
import { snapshotJson } from '../longmemeval/mixed-validation.mjs';

export const algorithmLimits = Object.freeze({ cases: 24, coreCallsPerCase: 40,
  answersPerCase: 2, httpRequests: 1968, reservationMicroUsd: 5000,
  reservedMicroUsd: 10_000_000, protectedMicroUsd: 30_000_000,
  inputTokens: 6000, providerInputTokens: 7024, coreOutputTokens: 1024,
  answerOutputTokens: 512, callMs: 200_000, caseMs: 1_200_000, runMs: 28_800_000 });
const prompts = Object.fromEntries(Object.entries({ extract: 'extract-source-windows',
  classify: 'classify-placement', select: 'recall-select', rank: 'recall-rank-source-evidence' })
  .map(([method, file]) => [method, readFileSync(new URL(`../../core/prompts/${file}.md`, import.meta.url), 'utf8')]));
const origin = 'https://api.openai.com/v1';
const fail = code => { const error = new Error(code); error.code = code; throw error; };
export const freezeObservation = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezeObservation); Object.freeze(value); }
  return value;
};
const snapshot = value => freezeObservation(structuredClone(value));
function persist(callback, record) {
  try { if (callback(snapshot(record)) !== undefined) fail('algorithm_persistence_failure'); }
  catch { fail('algorithm_persistence_failure'); }
}
async function boundedBody(response, signal, maximum, record, secret) {
  const reader = response.body?.getReader();
  if (!reader) fail('response_body_bounds');
  const chunks = []; let bytes = 0;
  const cancel = () => reader.cancel().catch(() => {});
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      const part = await reader.read();
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maximum) fail('response_body_bounds');
      chunks.push(part.value);
      record.responseBody = Buffer.concat(chunks).toString('utf8').split(secret).join('[REDACTED]');
    }
    return new TextDecoder('utf8', { fatal: true }).decode(Buffer.concat(chunks));
  } finally { signal.removeEventListener('abort', cancel); cancel(); reader.releaseLock(); }
}
function interrupted(signal, operation) {
  let cancel;
  const interruption = new Promise((_, reject) => {
    cancel = () => reject(new DOMException('Cancelled', 'AbortError'));
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
  });
  const pending = Promise.resolve().then(() => { if (signal.aborted) throw new DOMException('Cancelled', 'AbortError'); return operation(); });
  pending.then(value => { if (signal.aborted) value?.body?.cancel().catch(() => {}); }, () => {});
  return Promise.race([pending, interruption])
    .finally(() => signal.removeEventListener('abort', cancel));
}
function containsCredential(value, secret) {
  const pending = [value];
  while (pending.length) {
    const entry = pending.pop();
    if (typeof entry === 'string' && entry.includes(secret)) return true;
    if (entry && typeof entry === 'object') for (const [key, child] of Object.entries(entry)) {
      if (key.includes(secret)) return true;
      pending.push(child);
    }
  }
  return false;
}

/** Existing-only shared ledger; explicit credential and HTTP injection. No retries. */
export function createAlgorithmDevelopmentTransport({ configuration, checkpoint, historySha256,
  apiKey, fetchImpl = globalThis.fetch, onRecord = () => {} } = {}) {
  const frozen = freezeObservation(snapshotJson({ configuration, checkpoint, historySha256 },
    { bytes: 65536, nodes: 128, depth: 4 }, 'invalid_algorithm_configuration'));
  if (typeof apiKey !== 'string' || !apiKey || apiKey.length > 512 || /[\s\x00-\x1f\x7f]/u.test(apiKey)
    || typeof fetchImpl !== 'function' || typeof onRecord !== 'function'
    || !Number.isSafeInteger(frozen.checkpoint?.requestCount) || !Number.isSafeInteger(frozen.checkpoint?.reservedMicroUsd)
    || Object.keys(frozen.checkpoint).length !== 2 || !/^[a-f0-9]{64}$/u.test(frozen.historySha256)) fail('invalid_algorithm_configuration');
  let fatal = null, closed = false, active = null, busy = false, expected = null;
  let started = null, attempted = 0, reserved = 0;
  const rows = [], seen = new Set();
  const stop = code => { fatal ??= code; fail(fatal); };
  const handle = openBoundEmbeddingExperimentBudget({ configuration: frozen.configuration, authorize: state => {
    if (state.requestCount !== frozen.checkpoint.requestCount || state.reservedMicroUsd !== frozen.checkpoint.reservedMicroUsd
      || state.historySha256 !== frozen.historySha256) fail('algorithm_checkpoint_mismatch');
    if (state.limitMicroUsd > 400_000_000 || state.limitMicroUsd - state.reservedMicroUsd
      < algorithmLimits.protectedMicroUsd + algorithmLimits.reservedMicroUsd
      || state.requestCap - state.requestCount < algorithmLimits.httpRequests) fail('algorithm_unaffordable');
  } });
  const check = () => { if (fatal) fail(fatal); if (closed) fail('algorithm_closed'); };
  const ledgerState = () => { try { return handle.getState(); } catch (error) { stop(error.code ?? 'algorithm_accounting_failure'); } };
  const deadline = () => Math.min(algorithmLimits.caseMs - (performance.now() - active.started),
    algorithmLimits.runMs - (performance.now() - started));

  async function send(url, options) {
    check();
    const request = expected;
    const counting = url === `${origin}/responses/input_tokens`;
    const answer = request?.method === 'answer';
    if (!active || busy || !request || options?.method !== 'POST' || options.redirect !== 'error'
      || !(options.signal instanceof AbortSignal) || options.body !== request[counting ? 'count' : 'generation']
      || (answer ? url !== `${origin}/chat/completions` : !counting && url !== `${origin}/responses`)
      || (counting ? request.counted : !answer && !request.counted)) stop('algorithm_request_denied');
    if (options.body.includes(apiKey)) stop('algorithm_credential_echo');
    if (options.signal.aborted || deadline() <= 0) fail('model_timeout');
    if (attempted >= algorithmLimits.httpRequests || reserved + 5000 > algorithmLimits.reservedMicroUsd) stop('algorithm_budget_exceeded');
    const state = ledgerState();
    if (state.limitMicroUsd - state.reservedMicroUsd < algorithmLimits.protectedMicroUsd + 5000) stop('algorithm_budget_exceeded');
    const attemptId = randomUUID();
    try { handle.reserve({ attemptId, channel: counting ? 'cairn-count' : answer ? 'host-completion' : 'cairn-generation', reservedMicroUsd: 5000 }); }
    catch (error) { stop(error.code ?? 'algorithm_accounting_failure'); }
    attempted++; reserved += 5000; busy = true;
    const began = performance.now(), controller = new AbortController();
    const cancel = () => controller.abort();
    options.signal.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(cancel, Math.max(1, Math.min(algorithmLimits.callMs, deadline())));
    const row = { id: active.id, ordinal: active.ordinal, arm: active.arm, method: request.method,
      endpoint: url.slice(origin.length + 1), attemptId, requestBody: options.body,
      requestBytes: Buffer.byteLength(options.body), localInputTokens: countOpenAITokens(options.body),
      responseBody: null, responseBytes: null, httpStatus: null, reservedMicroUsd: 5000,
      actualMicroUsd: null, usage: null, outcome: 'unknown', failure: null };
    rows.push(row);
    try {
      persist(onRecord, row);
      if (options.signal.aborted || deadline() <= 0) controller.abort();
      const response = await interrupted(controller.signal, () => fetchImpl(url, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: options.body }));
      row.httpStatus = response.status;
      if (response.redirected || [401, 403].includes(response.status) || response.status >= 300 && response.status < 400)
        fatal ??= 'algorithm_auth_transport_failure';
      const raw = await interrupted(controller.signal, () => boundedBody(response, controller.signal,
        counting ? 65536 : 262144, row, apiKey));
      row.responseBytes = Buffer.byteLength(raw);
      if (raw.includes(apiKey)) { row.responseBody = '[REDACTED]'; stop('algorithm_credential_echo'); }
      if (fatal) fail(fatal);
      let body; try { body = JSON.parse(raw); } catch {
        if (response.ok) stop('algorithm_usage_anomaly');
        row.outcome = 'failed'; fail('provider_failure');
      }
      if (containsCredential(body, apiKey)) { row.responseBody = '[REDACTED]'; stop('algorithm_credential_echo'); }
      if (counting && response.ok) {
        if (body.object !== 'response.input_tokens' || !Number.isSafeInteger(body.input_tokens) || body.input_tokens < 0)
          stop('algorithm_usage_anomaly');
        row.providerInputTokens = body.input_tokens;
        if (body.input_tokens > 7024) fail('context_budget_exceeded');
        request.counted = true;
      } else if (!counting && (response.ok || body.usage !== undefined)) {
        const usage = body.usage, input = usage?.[answer ? 'prompt_tokens' : 'input_tokens'],
          output = usage?.[answer ? 'completion_tokens' : 'output_tokens'];
        if (![input, output, usage?.total_tokens].every(n => Number.isSafeInteger(n) && n >= 0)
          || usage.total_tokens !== input + output) stop('algorithm_usage_anomaly');
        row.usage = { input_tokens: input, output_tokens: output, total_tokens: usage.total_tokens };
        const price = modelProfile().extract;
        row.actualMicroUsd = Math.ceil(input * price.inputRate + output * price.outputRate);
        if (row.actualMicroUsd > 5000) stop('algorithm_usage_overrun');
        if (input > 7024 || output > (answer ? 512 : 1024) || body.model !== DEFAULT_MODEL) stop('algorithm_usage_anomaly');
      }
      if (!response.ok) { row.outcome = 'failed'; fail('provider_failure'); }
      row.outcome = 'succeeded';
      return new Response(raw, { status: response.status });
    } catch (error) {
      row.failure = fatal ?? (controller.signal.aborted ? 'model_timeout' : error.code ?? 'provider_failure');
      if (row.failure === 'algorithm_persistence_failure') fatal ??= row.failure;
      throw error;
    } finally {
      clearTimeout(timer); options.signal.removeEventListener('abort', cancel);
      row.latencyMs = performance.now() - began;
      try { handle.recordOutcome({ attemptId, outcome: row.outcome,
        ...(row.actualMicroUsd === null ? {} : { actualMicroUsd: row.actualMicroUsd }) }); }
      catch (error) { fatal ??= error.code ?? 'algorithm_accounting_failure'; }
      try { persist(onRecord, row); } catch { fatal ??= 'algorithm_persistence_failure'; }
      busy = false;
      if (fatal) fail(fatal);
    }
  }
  const adapter = createOpenAIModel({ apiKey: 'transport-owns-credential', fetchImpl: send });
  const model = { contextWindow: adapter.contextWindow, countTokens: adapter.countTokens };
  for (const method of ['extract', 'classify', 'select', 'rank']) model[method] = async request => {
    check();
    if (!active || busy || expected || request.system !== prompts[method]
      || request.maxOutputTokens !== 1024 || (method === 'extract' || method === 'classify'
        ? active.arm !== 'capture' : !['baseline', 'full'].includes(active.arm))) stop('algorithm_method_denied');
    if (active.coreCalls >= 40) fail('algorithm_case_call_cap');
    if (deadline() <= 0) fail('model_timeout');
    active.coreCalls++;
    const bodies = {};
    const serializer = createOpenAIModel({ apiKey: 'serializer-only', fetchImpl: async (url, options) => {
      if (url.endsWith('/input_tokens')) { bodies.count = options.body;
        return Response.json({ object: 'response.input_tokens', input_tokens: 0 }); }
      bodies.generation = options.body; throw new Error('serializer_complete');
    } });
    try { await serializer[method](request); } catch { /* Synthetic serializer terminates at generation. */ }
    if (!bodies.count || !bodies.generation || countOpenAITokens(bodies.count) > 6000) fail('context_budget_exceeded');
    expected = { ...bodies, method, counted: false };
    try { return await adapter[method](request); } finally { expected = null; }
  };
  return Object.freeze({ model: Object.freeze(model),
    beginCase({ id, ordinal }) {
      check();
      if (active || busy || seen.has(id) || ordinal !== seen.size + 1 || ordinal > 24) stop('algorithm_lifecycle');
      seen.add(id); started ??= performance.now();
      active = { id, ordinal, started: performance.now(), arm: 'capture', coreCalls: 0, answers: new Set(), arms: new Set() };
    },
    beginArm(name) { check(); if (!active || busy || expected || !['baseline', 'full'].includes(name)
      || active.arms.has(name)) stop('algorithm_lifecycle'); active.arms.add(name); active.arm = name; },
    async answer({ question, units }) {
      check();
      if (!active || busy || expected || !['baseline', 'full'].includes(active.arm) || active.answers.has(active.arm)) stop('algorithm_lifecycle');
      active.answers.add(active.arm);
      const packed = packMixedAnswer({ question, units, countTokens: countOpenAITokens });
      if (packed.inputTokens > 6000) fail('context_budget_exceeded');
      expected = { method: 'answer', generation: JSON.stringify(packed.request) };
      try {
        const response = await send(`${origin}/chat/completions`, { method: 'POST', redirect: 'error',
          signal: new AbortController().signal, body: expected.generation });
        const body = await response.json(), choice = body.choices?.[0];
        if (body.object !== 'chat.completion' || body.choices?.length !== 1 || choice?.finish_reason !== 'stop'
          || choice.message?.role !== 'assistant' || typeof choice.message.content !== 'string'
          || !choice.message.content.trim() || countOpenAITokens(choice.message.content) > 512) fail('invalid_answer_response');
        return snapshot({ packed, answer: choice.message.content });
      } finally { expected = null; }
    },
    endCase() { check(); if (!active || busy || expected) stop('algorithm_lifecycle'); active = null; },
    assertHealthy: check, records: () => snapshot(rows), state: () => { check(); return ledgerState(); },
    close() { if (busy) stop('algorithm_lifecycle'); closed = true; handle.close(); } });
}
