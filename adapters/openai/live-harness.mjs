import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { openMemoryCore } from '../../core/contract.mjs';
import { createOpenAIModel } from './index.mjs';
import { schemas } from './schemas.mjs';

export const LIVE_MODEL = 'gpt-4.1-mini-2025-04-14';
export const REQUEST_RESERVATION_USD = 0.004448;
const reservationUnits = 4448; // Millionths of a dollar, rounded up per request.
const fail = (code) => { throw new Error(code); };
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const fixture = 'review-preference-v1';

// This guard is a run-local conservative estimate, not a provider account limit.
// Reservations are never refunded, including count calls and ambiguous failures.
export function createBudgetedFetch({ budgetUsd, maxRequests = 40,
  fetchImpl = globalThis.fetch } = {}) {
  if (!Number.isFinite(budgetUsd) || budgetUsd <= 0 || budgetUsd > 5 ||
      !Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 40 ||
      typeof fetchImpl !== 'function') fail('invalid_live_configuration');
  const budgetUnits = Math.floor(budgetUsd * 1e6);
  const counter = createOpenAIModel({ apiKey: 'synthetic-counter-only' });
  const requests = [];
  let observedInputTokens = 0;
  let observedOutputTokens = 0;
  let rejection = null;
  const snapshot = () => ({ budgetUsd, maxRequests, requestCount: requests.length,
    reservedUsd: requests.length * reservationUnits / 1e6,
    observedInputTokens, observedOutputTokens,
    observedUsageEstimateUsd: (observedInputTokens * 0.4 + observedOutputTokens * 1.6) / 1e6,
    rejection, requests: requests.map((request) => ({ ...request })) });
  const guarded = async (url, options = {}) => {
    let payload;
    let method;
    const countEndpoint = url === 'https://api.openai.com/v1/responses/input_tokens';
    try {
      if (!countEndpoint && url !== 'https://api.openai.com/v1/responses') throw 0;
      if (options.method !== 'POST' || options.redirect !== 'error' ||
          !(options.signal instanceof AbortSignal) || typeof options.body !== 'string' ||
          options.body.length > 100000) throw 0;
      payload = JSON.parse(options.body);
      const keys = ['model', 'instructions', 'input', 'text', 'truncation'];
      if (!countEndpoint) keys.push('max_output_tokens', 'store', 'stream');
      if (!isDeepStrictEqual(Object.keys(payload).sort(), keys.sort()) ||
          payload.model !== LIVE_MODEL || payload.truncation !== 'disabled' ||
          typeof payload.instructions !== 'string' ||
          (!countEndpoint && (payload.max_output_tokens !== 1024 || payload.store !== false || payload.stream !== false))) throw 0;
      method = payload.text?.format?.name?.replace(/^cairn_/, '');
      if (!Object.hasOwn(schemas, method) || !isDeepStrictEqual(payload.text,
        { format: { type: 'json_schema', name: `cairn_${method}`, strict: true, schema: schemas[method] } })) throw 0;
      const inputText = payload.input?.[0]?.content?.[0]?.text;
      if (typeof inputText !== 'string' || !isDeepStrictEqual(payload.input,
        [{ role: 'user', content: [{ type: 'input_text', text: inputText }] }])) throw 0;
      if (counter.countTokens(JSON.stringify({ system: payload.instructions,
        input: JSON.parse(inputText), maxOutputTokens: 1024 })) > 6000) throw 0;
    } catch { rejection = 'request_rejected'; fail(rejection); }
    if (options.signal.aborted) { rejection = 'request_aborted'; fail(rejection); }
    if (requests.length >= maxRequests) { rejection = 'request_limit_exceeded'; fail(rejection); }
    if ((requests.length + 1) * reservationUnits > budgetUnits) {
      rejection = 'budget_exceeded'; fail(rejection);
    }
    const entry = { endpoint: countEndpoint ? 'count' : 'generate', method,
      status: null, outcome: 'pending', elapsedMs: 0 };
    requests.push(entry); // Reserve synchronously before any network I/O.
    const started = performance.now();
    let reader;
    const cancel = () => { reader?.cancel().catch(() => {}); };
    try {
      const response = await fetchImpl(url, options);
      if (options.signal.aborted) { response.body?.cancel().catch(() => {}); fail('request_aborted'); }
      if (Number.isInteger(response.status) && response.status >= 100 && response.status <= 599) entry.status = response.status;
      if (!response.ok || response.redirected) {
        response.body?.cancel().catch(() => {});
        entry.outcome = 'http_error';
        fail('provider_request_failed');
      }
      reader = response.body?.getReader();
      if (!reader) fail('invalid_provider_response');
      options.signal.addEventListener('abort', cancel, { once: true });
      const chunks = [];
      let size = 0;
      for (;;) {
        if (options.signal.aborted) fail('request_aborted');
        const { done, value } = await reader.read();
        if (options.signal.aborted) fail('request_aborted');
        if (done) break;
        if (!(value instanceof Uint8Array)) fail('invalid_provider_response');
        size += value.byteLength;
        if (size > (countEndpoint ? 65536 : 262144)) fail('invalid_provider_response');
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      let body;
      try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
      catch { fail('invalid_provider_response'); }
      if (countEndpoint) {
        if (body?.object !== 'response.input_tokens' || !integer(body.input_tokens) || body.input_tokens > 7024) fail('invalid_provider_response');
        entry.inputTokens = body.input_tokens;
      } else {
        const usage = body?.usage;
        if (body?.model !== LIVE_MODEL || !integer(usage?.input_tokens) || usage.input_tokens > 7024 ||
          !integer(usage?.output_tokens) || usage.output_tokens > 1024 ||
          usage.total_tokens !== usage.input_tokens + usage.output_tokens) fail('invalid_provider_response');
        entry.inputTokens = usage.input_tokens;
        entry.outputTokens = usage.output_tokens;
        observedInputTokens += usage.input_tokens;
        observedOutputTokens += usage.output_tokens;
      }
      entry.outcome = 'received';
      return new Response(bytes, { status: response.status, headers: { 'content-type': 'application/json' } });
    } catch {
      if (entry.outcome === 'pending') entry.outcome = options.signal.aborted ? 'aborted' : 'failed';
      fail(options.signal.aborted ? 'request_aborted' : 'provider_request_failed');
    } finally {
      entry.elapsedMs = Math.round(performance.now() - started);
      options.signal.removeEventListener('abort', cancel);
      cancel();
      reader?.releaseLock();
    }
  };
  return Object.freeze({ fetchImpl: guarded, snapshot });
}

export async function runLiveLifecycle({ apiKey, budgetUsd, maxRequests = 40,
  fetchImpl = globalThis.fetch } = {}) {
  const guard = createBudgetedFetch({ budgetUsd, maxRequests, fetchImpl });
  const model = createOpenAIModel({ apiKey, fetchImpl: guard.fetchImpl });
  const started = performance.now();
  const report = { ok: false, model: LIVE_MODEL, runtime: process.version,
    fixtureVersion: fixture, databasePath: null, stages: [], elapsedMs: 0 };
  const namespace = { ownerId: 'synthetic-live-owner', scope: 'personal', projectId: null };
  const source = 'For code reviews, I prefer diagrams rather than long prose.';
  const corrected = 'For code reviews, I prefer concise text rather than diagrams.';
  const unwrap = (result) => { if (!result?.ok) fail('core_operation_failed'); return result.value; };
  const check = (value) => { if (!value) fail('acceptance_failed'); };
  let core;
  let memoryId;
  let original;
  const stage = async (name, action) => {
    const began = performance.now();
    const entry = { name, status: 'failed', elapsedMs: 0 };
    report.stages.push(entry);
    try { await action(); entry.status = 'passed'; }
    finally { entry.elapsedMs = Math.round(performance.now() - began); }
  };
  const recallCurrent = async (content, receiptId) => {
    const current = unwrap(core.get({ namespace, memoryId }));
    const result = unwrap(await core.recall({ readSet: [namespace], query: 'What format do I prefer for code reviews?' }));
    check(result.memories.length === 1);
    const recalled = result.memories[0];
    check(recalled.memory.id === memoryId && recalled.memory.revision === current.memory.revision &&
      recalled.memory.content === content && recalled.receipts.some((receipt) => receipt.eventId === receiptId));
  };
  try {
    await stage('capture_classify', async () => {
      report.databasePath = join(mkdtempSync(join(tmpdir(), 'cairn-openai-live-')), 'memory.sqlite');
      core = openMemoryCore({ path: report.databasePath, model });
      const captured = unwrap(await core.capture({ namespace, client: 'live-fixture', eventId: 'capture-v1',
        sessionId: 'synthetic-session', messages: [{ id: 'source-v1', role: 'user', content: source }] }));
      check(captured.admission.memories.length === 1 && captured.classification.status === 'applied');
      memoryId = captured.admission.memories[0].id;
      const stored = unwrap(core.get({ namespace, memoryId }));
      original = stored.memory.content;
      check(/diagram/i.test(original) && /review/i.test(original));
      check(stored.receipts.some((receipt) => receipt.eventId === 'source-v1' && receipt.excerpt === source));
    });
    await stage('recall', () => recallCurrent(original, 'source-v1'));
    await stage('reopen_recall', async () => {
      core.close(); core = undefined;
      core = openMemoryCore({ path: report.databasePath, model });
      await recallCurrent(original, 'source-v1');
    });
    await stage('correct_recall', async () => {
      const current = unwrap(core.get({ namespace, memoryId }));
      const changed = unwrap(core.correct({ namespace, memoryId, expectedRevision: current.memory.revision,
        content: corrected, kind: 'preference', receipt: { client: 'live-fixture', sessionId: 'synthetic-session',
          eventId: 'correction-v1', role: 'user', excerpt: corrected } }));
      check(changed.memory.revision > current.memory.revision);
      await recallCurrent(corrected, 'correction-v1');
    });
    await stage('forget_recall', async () => {
      const current = unwrap(core.get({ namespace, memoryId }));
      unwrap(core.forget({ namespace, memoryId, expectedRevision: current.memory.revision }));
      check(core.get({ namespace, memoryId }).error?.code === 'memory_not_found');
      check(unwrap(core.list({ namespace })).memories.length === 0);
      const recalled = unwrap(await core.recall({ readSet: [namespace], query: 'What format do I prefer for code reviews?' }));
      check(recalled.memories.length === 0);
    });
    report.ok = true;
  } catch { report.error = 'live_acceptance_failed'; }
  finally {
    try { core?.close(); } catch { report.ok = false; report.error = 'live_acceptance_failed'; }
    report.elapsedMs = Math.round(performance.now() - started);
    report.accounting = guard.snapshot();
  }
  return report;
}
