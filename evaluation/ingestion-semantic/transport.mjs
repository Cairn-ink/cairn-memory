import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { openBoundEmbeddingExperimentBudget } from '../experiment-budget/index.mjs';
import { createOpenAIModel, countOpenAITokens } from '../../adapters/openai/index.mjs';
import { DEFAULT_MODEL } from '../../adapters/openai/profiles.mjs';
import { captureSnapshot, retainedSourceView, extractedItems } from '../../core/capture-input.mjs';
import { createQualificationCandidateSnapshot } from '../../core/qualification-candidates.mjs';
import { snapshotQualificationTextCatalog } from '../../core/qualification-text-catalog.mjs';
import { standardInlineQualificationPrompt } from '../../core/qualification-candidates-prompt.mjs';
import { prepareCombined, measureCombined, combinedPrompt } from '../ingestion-design/combined.mjs';

export const probeLimits = Object.freeze({ reservedMicroUsd: 3_000_000, httpRequests: 576,
  reservationMicroUsd: 4448, callMs: 30_000, armMs: 180_000, probeMs: 5_400_000 });
const extractionPrompt = readFileSync(new URL('../../core/prompts/extract-retained-sources.md', import.meta.url), 'utf8');
const origin = 'https://api.openai.com/v1/responses';
const fail = code => { const error = new Error(code); error.code = code; throw error; };
const freeze = value => { if (value && typeof value === 'object') {
  Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
function copyData(value) {
  if (value === null || typeof value !== 'object') return value;
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) fail('invalid_probe_configuration');
  const result = Array.isArray(value) ? [] : {};
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length' && Array.isArray(value)) continue;
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !Object.hasOwn(d, 'value') || !d.enumerable) fail('invalid_probe_configuration');
    result[key] = copyData(d.value);
  }
  return result;
}
export function combinedBodies(prepared) {
  const measured = measureCombined(prepared);
  if (measured.logicalTokens > 6000 || measured.countBodyTokens > 6000) fail('context_budget_exceeded');
  const payload = { model: DEFAULT_MODEL, instructions: combinedPrompt,
    input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(prepared.requestInput) }] }],
    text: { format: { type: 'json_schema', name: 'evaluation_combined_v1', strict: true, schema: prepared.schema } },
    truncation: 'disabled' };
  return { count: JSON.stringify(payload), generation: JSON.stringify({ ...payload,
    max_output_tokens: 1024, store: false, stream: false }) };
}
// Capture the current adapter's exact serializer with synthetic HTTP. This does
// not call a provider, read credentials, or approximate its schema/prompt logic.
async function adapterBodies(method, input, system) {
  const bodies = {};
  const adapter = createOpenAIModel({ apiKey: 'serializer-only', qualificationInputMode: 'adaptive-text-catalog-v1',
    fetchImpl: async (url, options) => {
      if (url.endsWith('/input_tokens')) {
        bodies.count = options.body;
        return Response.json({ object: 'response.input_tokens', input_tokens: 0 });
      }
      bodies.generation = options.body;
      throw new Error('serializer_complete');
    } });
  try { await adapter[method]({ system, input, maxOutputTokens: 1024, signal: new AbortController().signal }); }
  catch { /* The generation capture deliberately terminates the synthetic call. */ }
  if (!bodies.count || !bodies.generation) fail('context_budget_exceeded');
  const payload = JSON.parse(bodies.count);
  if (countOpenAITokens(bodies.count) > 6000 || countOpenAITokens(JSON.stringify({ system: payload.instructions,
    input, maxOutputTokens: 1024 })) > 6000) fail('context_budget_exceeded');
  return bodies;
}
function interrupted(signal, operation) {
  if (signal.aborted) return Promise.reject(new DOMException('Probe cancelled', 'AbortError'));
  let onAbort;
  const abort = new Promise((_, reject) => { onAbort = () => reject(new DOMException('Probe cancelled', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true }); });
  return Promise.race([Promise.resolve().then(operation), abort])
    .finally(() => signal.removeEventListener('abort', onAbort));
}
async function readBounded(response, maximum, signal, preserve) {
  if (!response.body?.getReader) fail('probe_transport_failure');
  const reader = response.body.getReader();
  const chunks = []; let bytes = 0;
  try {
    while (true) {
      const part = await interrupted(signal, () => reader.read());
      if (part.done) break;
      if (!(part.value instanceof Uint8Array)) fail('probe_transport_failure');
      const owned = new Uint8Array(part.value);
      bytes += owned.byteLength;
      if (bytes > maximum) {
        const remaining = maximum - (bytes - owned.byteLength);
        if (remaining > 0) chunks.push(owned.subarray(0, remaining));
        preserve(new TextDecoder().decode(Buffer.concat(chunks)), true);
        fail('response_body_bounds');
      }
      chunks.push(owned);
      preserve(new TextDecoder().decode(Buffer.concat(chunks, bytes)), true);
    }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes)); }
    catch { fail('response_json'); }
  } finally { reader.cancel().catch(() => {}); }
}
function observedCost(body, counting) {
  if (counting) return { actualMicroUsd: null, usage: null };
  const u = body?.usage;
  if (!u || !['input_tokens', 'output_tokens', 'total_tokens'].every(k => Number.isSafeInteger(u[k]) && u[k] >= 0)
    || u.total_tokens !== u.input_tokens + u.output_tokens) return { actualMicroUsd: null, usage: null };
  return { actualMicroUsd: Math.ceil((u.input_tokens * 4 + u.output_tokens * 16) / 10),
    usage: { input_tokens: u.input_tokens, output_tokens: u.output_tokens, total_tokens: u.total_tokens } };
}
function containsCredential(value, secret) {
  const pending = [value];
  while (pending.length) {
    const entry = pending.pop();
    if (typeof entry === 'string' && entry.includes(secret)) return true;
    if (entry && typeof entry === 'object') {
      for (const [key, child] of Object.entries(entry)) {
        if (key.includes(secret)) return true;
        pending.push(child);
      }
    }
  }
  return false;
}
function outputOf(body) {
  if (body?.object !== 'response' || body.model !== DEFAULT_MODEL || body.status !== 'completed'
    || body.error !== null || body.incomplete_details !== null || !Array.isArray(body.output)) return null;
  const u = body.usage;
  if (!u || !['input_tokens', 'output_tokens', 'total_tokens'].every(k => Number.isSafeInteger(u[k]) && u[k] >= 0)
    || u.input_tokens > 7024 || u.output_tokens > 1024 || u.total_tokens !== u.input_tokens + u.output_tokens) return null;
  let text = '';
  for (const message of body.output) {
    if (message.type !== 'message' || message.role !== 'assistant' || message.status !== 'completed'
      || !Array.isArray(message.content)) return null;
    for (const part of message.content) { if (part.type !== 'output_text' || typeof part.text !== 'string') return null; text += part.text; }
  }
  if (!text || text.length > 40_000 || countOpenAITokens(text) > 1024) return null;
  try { return JSON.parse(text); } catch { return null; }
}

/** Existing-only ledger authority. Importing this module has no side effects. */
export function createIngestionSemanticTransport({ configuration, checkpoint, historySha256,
  apiKey, fetchImpl = globalThis.fetch, onRecord = () => {} } = {}) {
  const frozen = freeze(copyData({ configuration, checkpoint, historySha256 }));
  if (typeof apiKey !== 'string' || !apiKey.length || apiKey.length > 512 || /[\s\x00-\x1f\x7f]/.test(apiKey) || typeof fetchImpl !== 'function' || typeof onRecord !== 'function'
    || !Number.isSafeInteger(frozen.checkpoint?.requestCount) || !Number.isSafeInteger(frozen.checkpoint?.reservedMicroUsd)
    || Object.keys(frozen.checkpoint).length !== 2 || typeof frozen.historySha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(frozen.historySha256)) fail('invalid_probe_configuration');
  let fatal = null, closed = false, arm = null, busy = false, attempted = 0, reserved = 0, probeStarted = null;
  const seenArms = new Set();
  const records = [];
  const stop = code => { fatal ??= code; fail(code); };
  const handle = openBoundEmbeddingExperimentBudget({ configuration: frozen.configuration, authorize: state => {
    if (state.requestCount !== frozen.checkpoint.requestCount || state.reservedMicroUsd !== frozen.checkpoint.reservedMicroUsd
      || state.historySha256 !== frozen.historySha256) fail('probe_checkpoint_mismatch');
  } });
  const check = () => { if (fatal) fail(fatal); if (closed) fail('probe_closed'); };
  function beginArm({ id, repetition, name, input }) {
    check();
    const identity = JSON.stringify([id, repetition, name]);
    if (arm || busy || typeof id !== 'string' || !id.length || id.length > 128 || ![0, 1].includes(repetition)
      || !['baseline', 'combined'].includes(name) || seenArms.has(identity) || seenArms.size >= 48) stop('probe_lifecycle');
    seenArms.add(identity);
    probeStarted ??= performance.now();
    const snapshot = captureSnapshot(input, 'source-bound-v2'), retained = retainedSourceView(snapshot);
    arm = { id, repetition, name, snapshot, retained, items: null, expected: null, permit: null,
      methods: 0, qualified: new Set(), qualificationPlan: null, started: performance.now(), failed: false };
  }
  async function prepareMethod(method, request) {
    check();
    if (!arm || busy || arm.failed || arm.expected || arm.permit) stop('probe_lifecycle');
    if (arm.name === 'combined') {
      if (method !== 'evaluation_combined_v1' || arm.methods) stop('probe_method_denied');
      arm.expected = { ...combinedBodies(prepareCombined(arm.snapshot)), method };
    } else {
      if (!['extract', 'qualifyCandidates'].includes(method)) stop('probe_method_denied');
      if (method === 'extract') {
        const expected = { messages: arm.retained.messages.map(({ role, content }, index) => ({ index, role, content })) };
        if (arm.methods || request.system !== extractionPrompt || !isDeepStrictEqual(request.input, expected)) stop('probe_source_mismatch');
      } else {
        if (!arm.items?.length || arm.methods >= 6 || request.system !== standardInlineQualificationPrompt) stop('probe_method_denied');
        const snapshot = createQualificationCandidateSnapshot(arm.items);
        const allowed = [snapshot.input, ...snapshot.input.items.map(item => ({ items: [{ ...item, itemIndex: 0 }] }))];
        let input = request.input;
        try { if (Object.hasOwn(input, 'inputMode')) input = snapshotQualificationTextCatalog(input).expanded; }
        catch { stop('probe_source_mismatch'); }
        const selected = allowed.findIndex(candidate => isDeepStrictEqual(input, candidate));
        if (selected < 0) stop('probe_source_mismatch');
        const plan = selected === 0 ? 'whole' : 'partition';
        if (arm.qualified.has(selected) || (arm.qualificationPlan && arm.qualificationPlan !== plan)) stop('probe_lifecycle');
        arm.qualificationPlan = plan; arm.qualified.add(selected);
      }
      busy = true;
      try { arm.expected = { ...await adapterBodies(method, request.input, request.system), method }; }
      finally { busy = false; }
    }
    arm.methods += 1;
  }
  async function guardedFetch(url, options) {
    check();
    if (!arm || arm.failed || busy || !arm.expected) stop('probe_lifecycle');
    const counting = url === `${origin}/input_tokens`;
    const generation = url === origin;
    if ((!counting && !generation) || options?.method !== 'POST' || options.redirect !== 'error'
      || !(options.signal instanceof AbortSignal) || typeof options.body !== 'string'
      || options.body !== arm.expected[counting ? 'count' : 'generation']
      || (counting ? arm.permit !== null : arm.permit !== arm.expected.generation)) stop('probe_request_denied');
    if (options.body.includes(apiKey)) stop('probe_credential_echo');
    if (options.signal.aborted || performance.now() - arm.started >= probeLimits.armMs) {
      arm.failed = true; fail('model_timeout');
    }
    if (attempted >= probeLimits.httpRequests || reserved + probeLimits.reservationMicroUsd > probeLimits.reservedMicroUsd) stop('probe_budget_exceeded');
    if (generation) arm.permit = null;
    const attemptId = randomUUID(), channel = counting ? 'cairn-count' : 'cairn-generation';
    try { handle.reserve({ attemptId, channel, reservedMicroUsd: probeLimits.reservationMicroUsd }); }
    catch (error) { stop(error.code ?? 'probe_accounting_failure'); }
    attempted += 1; reserved += probeLimits.reservationMicroUsd; busy = true;
    const current = arm, started = performance.now();
    const controller = new AbortController(), cancel = () => controller.abort();
    options.signal.addEventListener('abort', cancel, { once: true });
    const remaining = () => Math.min(probeLimits.callMs - (performance.now() - started),
      probeLimits.armMs - (performance.now() - current.started), probeLimits.probeMs - (performance.now() - probeStarted));
    const timer = setTimeout(cancel, Math.max(1, remaining()));
    const record = { id: current.id, repetition: current.repetition, arm: current.name,
      method: current.expected.method, endpoint: counting ? 'responses/input_tokens' : 'responses',
      attemptId, requestBody: options.body, responseBody: null, httpStatus: null,
      reservedMicroUsd: probeLimits.reservationMicroUsd, actualMicroUsd: null, usage: null, outcome: 'unknown', failure: null };
    records.push(record);
    let response, raw, parsed;
    try {
      try { if (onRecord(freeze(structuredClone(record))) !== undefined) stop('probe_persistence_failure'); }
      catch { stop('probe_persistence_failure'); }
      const beforeDispatch = () => {
        if (options.signal.aborted || remaining() <= 0) controller.abort();
        if (controller.signal.aborted) throw new DOMException('Probe cancelled', 'AbortError');
      };
      beforeDispatch();
      const pending = Promise.resolve().then(() => {
        beforeDispatch();
        return fetchImpl(url, { method: 'POST', redirect: 'error', signal: controller.signal,
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: options.body });
      });
      pending.then(value => { if (controller.signal.aborted) value?.body?.cancel().catch(() => {}); }, () => {});
      response = await interrupted(controller.signal, () => pending);
      record.httpStatus = response.status;
      // Latch authentication/redirect authority before reading an untrusted
      // body: a hung error stream must not disguise the anomaly as a timeout.
      if (response.redirected || response.status === 401 || response.status === 403
        || (response.status >= 300 && response.status < 400)) fatal ??= 'probe_transport_failure';
      raw = await readBounded(response, counting ? 65536 : 262144, controller.signal,
        (partial, truncated) => { record.responseBody = partial.split(apiKey).join('[REDACTED]'); record.responseTruncated = truncated;
          if (partial.includes(apiKey)) stop('probe_credential_echo'); });
      // Credential strings never enter retained diagnostics, even if echoed.
      record.responseBody = raw.split(apiKey).join('[REDACTED]');
      record.responseTruncated = false;
      try { parsed = JSON.parse(raw); } catch { /* Preserve malformed response, with unknown usage. */ }
      if (containsCredential(parsed, apiKey)) {
        record.responseBody = '[REDACTED] credential-bearing response';
        stop('probe_credential_echo');
      }
      if (fatal) fail(fatal);
      if (response.status < 200 || response.status >= 300) { current.failed = true; record.outcome = 'failed'; }
      else {
        Object.assign(record, observedCost(parsed, counting));
        record.outcome = 'succeeded';
        if (record.actualMicroUsd !== null && record.actualMicroUsd > probeLimits.reservationMicroUsd) stop('probe_usage_overrun');
        if (counting) {
          if (parsed?.object === 'response.input_tokens' && Number.isSafeInteger(parsed.input_tokens)
            && parsed.input_tokens >= 0 && parsed.input_tokens <= 7024) current.permit = current.expected.generation;
          else current.failed = true;
        } else {
          if (current.expected.method === 'extract') {
            try { current.items = extractedItems(outputOf(parsed), current.snapshot, current.retained.messages); }
            catch { current.failed = true; }
          }
          current.expected = null;
        }
      }
      return new Response(raw, { status: response.status });
    } catch (error) {
      current.failed = true;
      record.failure = fatal ?? (controller.signal.aborted ? 'model_timeout' : error.code ?? 'probe_transport_failure');
      if (!controller.signal.aborted && !fatal && !['response_body_bounds', 'response_json'].includes(error.code)) fatal = 'probe_transport_failure';
      throw error;
    } finally {
      clearTimeout(timer); options.signal.removeEventListener('abort', cancel);
      record.latencyMs = performance.now() - started;
      try { handle.recordOutcome({ attemptId, outcome: record.outcome,
        ...(record.actualMicroUsd === null ? {} : { actualMicroUsd: record.actualMicroUsd }) }); }
      catch (error) { fatal ??= error.code ?? 'probe_accounting_failure'; }
      try { if (onRecord(freeze(structuredClone(record))) !== undefined) fatal ??= 'probe_persistence_failure'; }
      catch { fatal ??= 'probe_persistence_failure'; }
      busy = false;
      if (fatal) fail(fatal);
    }
  }
  return Object.freeze({ beginArm, prepareMethod, fetch: guardedFetch,
    assertHealthy: check,
    endArm() { check(); if (!arm || busy) stop('probe_lifecycle'); arm = null; },
    records: () => structuredClone(records),
    state() { check(); try { return handle.getState(); } catch (error) { stop(error.code ?? 'probe_accounting_failure'); } },
    close() { if (busy) stop('probe_lifecycle'); closed = true; handle.close(); } });
}
