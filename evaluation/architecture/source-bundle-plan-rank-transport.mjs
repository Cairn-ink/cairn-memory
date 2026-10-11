import { randomUUID } from 'node:crypto';
import { freeze, sha256, snapshotJson } from '../longmemeval/mixed-validation.mjs';
import { redactSecrets } from '../../plugins/cairn-memory/lib/redact.mjs';
import { modelProfile } from '../../adapters/openai/profiles.mjs';
import { BUNDLE_RANK_INSTRUCTION, prepareBundleRankRequest, compileBundlePlan } from './source-bundle-rank.mjs';

const VERSION = 'source-bundle-plan-rank-v1';
const MODEL = 'gpt-4.1-mini-2025-04-14';
const COUNT = 'https://api.openai.com/v1/responses/input_tokens';
const GENERATE = 'https://api.openai.com/v1/responses';
const RESERVATION = 5000;
const codes = new Set(['invalid_configuration', 'prerequisite_unavailable', 'invalid_request',
  'request_mutated', 'context_budget_exceeded', 'slot_consumed', 'transport_busy', 'transport_closed',
  'cancelled', 'deadline_exceeded', 'ledger_failed', 'budget_blocked', 'record_persistence_failed',
  'credential_echo', 'provider_failed', 'authentication_failed', 'redirect_rejected',
  'invalid_response', 'response_too_large', 'invalid_usage', 'usage_overrun', 'model_mismatch', 'invalid_model_output']);
const fatal = new Set(['ledger_failed', 'budget_blocked', 'record_persistence_failed', 'credential_echo',
  'authentication_failed', 'redirect_rejected', 'invalid_usage', 'usage_overrun', 'model_mismatch', 'request_mutated']);
export class SourceBundleTransportError extends Error {
  constructor(code) { super(codes.has(code) ? code : 'invalid_response'); this.name = 'SourceBundleTransportError'; this.code = this.message; }
}
const fail = code => { throw new SourceBundleTransportError(code); };
function own(value, keys, code) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(code);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).length !== keys.length || keys.some(key => !descriptors[key]
      || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value'))) fail(code);
    return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
  } catch { fail(code); }
}
function copy(value, code) {
  try { return freeze(JSON.parse(JSON.stringify(snapshotJson(value,
    { bytes: 4 * 1024 * 1024, nodes: 100000, depth: 16 }, code)))); }
  catch { fail(code); }
}
function echo(text, key) {
  return text.includes(key) || text.replace(/\\u([0-9a-f]{4})/gi,
    (_, hex) => String.fromCharCode(parseInt(hex, 16))).includes(key);
}

// JSON.parse alone silently erases duplicate usage/output fields. Reject that
// ambiguity before interpreting any provider envelope or generated proposal.
function json(text, code) {
  let at = 0, nodes = 0;
  const whitespace = () => { while (/[ \t\r\n]/u.test(text[at] ?? '') && at < text.length) at++; };
  function string() {
    const start = at++;
    while (at < text.length) {
      if (text[at++] === '"') return JSON.parse(text.slice(start, at));
      if (text[at - 1] === '\\') at++;
    }
    fail(code);
  }
  function value(depth) {
    if (++nodes > 100000 || depth > 32) fail(code);
    whitespace(); const c = text[at];
    if (c === '"') return string();
    if (c === '{' || c === '[') {
      const object = c === '{', result = object ? Object.create(null) : [], seen = new Set();
      at++; whitespace(); if (text[at] === (object ? '}' : ']')) { at++; return result; }
      while (at < text.length) {
        whitespace(); let key;
        if (object) { if (text[at] !== '"') fail(code); key = string();
          if (seen.has(key)) fail(code); seen.add(key); whitespace(); if (text[at++] !== ':') fail(code); }
        const child = value(depth + 1); if (object) result[key] = child; else result.push(child);
        whitespace(); const end = text[at++]; if (end === (object ? '}' : ']')) return result;
        if (end !== ',') fail(code);
      }
      fail(code);
    }
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/u.exec(text.slice(at));
    if (!match) fail(code); at += match[0].length; return JSON.parse(match[0]);
  }
  try { const result = value(0); whitespace(); if (at !== text.length) fail(code); return result; }
  catch { fail(code); }
}

function reprepare(request, counter) {
  const shell = own(request, ['system', 'input', 'outputSchema', 'maxOutputTokens', 'signal'], 'invalid_request');
  if (!(shell.signal instanceof AbortSignal)) fail('invalid_request');
  const payload = copy({ system: shell.system, input: shell.input,
    outputSchema: shell.outputSchema, maxOutputTokens: shell.maxOutputTokens }, 'invalid_request');
  own(payload.input, ['query', 'limit', 'catalog'], 'invalid_request');
  if (payload.system !== BUNDLE_RANK_INSTRUCTION || payload.maxOutputTokens !== 1024
    || !Array.isArray(payload.input.catalog)) fail('invalid_request');
  const candidates = [], cards = new Map();
  for (const [index, source] of payload.input.catalog.entries()) {
    own(source, ['sourceIndex', 'namespaceIndex', 'memoryId', 'revision', 'receiptId', 'recordedRole', 'excerpt'], 'invalid_request');
    if (source.sourceIndex !== index) fail('invalid_request');
    const key = JSON.stringify([source.namespaceIndex, source.memoryId, source.revision]);
    let candidate = cards.get(key);
    if (!candidate) { candidate = { namespaceIndex: source.namespaceIndex,
      memory: { id: source.memoryId, revision: source.revision, currentness: 'current' },
      receipts: [], receiptCount: 0, interpretationStatus: 'omitted', sourceSelectionCoverage: 'unassessed' };
      cards.set(key, candidate); candidates.push(candidate); }
    candidate.receipts.push({ id: source.receiptId, role: source.recordedRole, excerpt: source.excerpt }); candidate.receiptCount++;
  }
  let prepared;
  try { prepared = prepareBundleRankRequest({ system: BUNDLE_RANK_INSTRUCTION,
    input: { query: payload.input.query, limit: payload.input.limit, candidates },
    maxOutputTokens: 1024, signal: shell.signal }, counter); }
  catch (error) { fail(error?.code === 'context_budget_exceeded' ? error.code
    : shell.signal.aborted ? 'cancelled' : 'invalid_request'); }
  if (JSON.stringify(payload) !== JSON.stringify(prepared.request)) fail('invalid_request');
  return { prepared, signal: shell.signal, encoded: JSON.stringify(payload) };
}

/** Explicit offline-capable one-slot transport, never an experiment grant. */
export async function createSourceBundlePlanRankTransport(options) {
  const opts = own(options, ['configuration', 'checkpoint', 'historySha256', 'manifest',
    'apiKey', 'fetchImpl', 'onRecord'], 'invalid_configuration');
  const configuration = copy(own(opts.configuration, ['directory', 'runId', 'limitMicroUsd', 'requestCap'], 'invalid_configuration'), 'invalid_configuration');
  const checkpoint = copy(own(opts.checkpoint, ['requestCount', 'reservedMicroUsd'], 'invalid_configuration'), 'invalid_configuration');
  const manifest = copy(own(opts.manifest, ['version', 'slotId', 'preparedRequestSha256', 'runDeadline', 'caseDeadline'], 'invalid_configuration'), 'invalid_configuration');
  const key = opts.apiKey, fetchImpl = opts.fetchImpl, onRecord = opts.onRecord;
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{12,200}$/u.test(key)
    || typeof fetchImpl !== 'function' || typeof onRecord !== 'function'
    || manifest.version !== VERSION || typeof manifest.slotId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(manifest.slotId)
    || typeof manifest.preparedRequestSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(manifest.preparedRequestSha256)
    || typeof opts.historySha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(opts.historySha256)
    || ![manifest.runDeadline, manifest.caseDeadline].every(n => Number.isFinite(n) && n > 0)
    || !Number.isSafeInteger(configuration.limitMicroUsd) || configuration.limitMicroUsd > 400000000
    || !Object.values(checkpoint).every(n => Number.isSafeInteger(n) && n >= 0)
    || echo(JSON.stringify({ configuration, checkpoint, manifest }), key)) fail('invalid_configuration');
  let countTokens, budget;
  try { ({ countOpenAITokens: countTokens } = await import('../../adapters/openai/index.mjs'));
    budget = await import('../experiment-budget/index.mjs'); }
  catch { fail('prerequisite_unavailable'); }
  let state = 'ready', fatalCode = null, ledger;
  const records = [];
  const mark = code => { if (fatal.has(code) && !fatalCode) fatalCode = code; };
  const accounting = fn => { try { return fn(); } catch { mark('ledger_failed'); fail('ledger_failed'); } };
  function available(snapshot, slots) {
    if (snapshot.state !== 'open' || configuration.limitMicroUsd - snapshot.reservedMicroUsd - 30000000 < slots * RESERVATION
      || configuration.requestCap - snapshot.requestCount < slots) fail('budget_blocked');
  }
  try { ledger = budget.openBoundEmbeddingExperimentBudget({ configuration, authorize(snapshot) {
    if (snapshot.schemaVersion !== 2 || snapshot.requestCount !== checkpoint.requestCount
      || snapshot.reservedMicroUsd !== checkpoint.reservedMicroUsd || snapshot.historySha256 !== opts.historySha256) fail('ledger_failed');
    available(snapshot, 2);
  } }); } catch (error) { fail(error instanceof SourceBundleTransportError ? error.code : 'ledger_failed'); }
  function observe(record) {
    const clean = freeze(record); records.push(clean);
    try { const returned = onRecord(clean);
      if (returned !== undefined) { if (returned instanceof Promise) returned.catch(() => {}); fail('record_persistence_failed'); } }
    catch { mark('record_persistence_failed'); fail('record_persistence_failed'); }
  }
  async function planRank(request) {
    if (state !== 'ready') fail(state === 'active' ? 'transport_busy' : state === 'closed' ? 'transport_closed' : 'slot_consumed');
    state = 'active'; let timer, signal, abortListener;
    const controller = new AbortController(); let cancellation = 'cancelled';
    const cancelled = () => { if (controller.signal.aborted) fail(cancellation); };
    let source, deadline;
    try {
      source = reprepare(request, countTokens); signal = source.signal;
      if (echo(source.encoded, key)) fail('credential_echo');
      if (source.prepared.requestSha256 !== manifest.preparedRequestSha256) fail('invalid_request');
      const prepared = source.prepared.request;
      const body = { model: MODEL, instructions: prepared.system,
        input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(prepared.input) }] }],
        text: { format: { type: 'json_schema', name: 'cairn_source_bundle_plan_rank_v1', strict: true, schema: prepared.outputSchema } }, truncation: 'disabled' };
      const countBody = JSON.stringify(body), generationBody = JSON.stringify({ ...body, max_output_tokens: 1024, store: false, stream: false });
      if ([source.encoded, countBody, generationBody].some(text => countTokens(text) > 6000)) fail('context_budget_exceeded');
      deadline = Math.min(performance.now() + 30000, manifest.runDeadline, manifest.caseDeadline);
      const abort = code => { cancellation = code; controller.abort(); };
      abortListener = () => abort('cancelled'); signal.addEventListener('abort', abortListener, { once: true });
      if (signal.aborted) abort('cancelled');
      if (performance.now() >= deadline) abort('deadline_exceeded');
      timer = setTimeout(() => abort('deadline_exceeded'), Math.max(0, deadline - performance.now()));
      const check = () => {
        if (performance.now() >= deadline && !controller.signal.aborted) abort('deadline_exceeded');
        cancelled();
        let now; try { const shell = own(request, ['system', 'input', 'outputSchema', 'maxOutputTokens', 'signal'], 'request_mutated');
          if (shell.signal !== signal) fail('request_mutated');
          now = JSON.stringify(copy({ system: shell.system, input: shell.input,
            outputSchema: shell.outputSchema, maxOutputTokens: shell.maxOutputTokens }, 'request_mutated')); }
        catch { fail('request_mutated'); }
        if (now !== source.encoded) fail('request_mutated');
      };
      async function race(promise, late) {
        return await new Promise((resolve, reject) => {
          const listener = () => { controller.signal.removeEventListener('abort', listener); reject(new SourceBundleTransportError(cancellation)); };
          controller.signal.addEventListener('abort', listener, { once: true });
          Promise.resolve(promise).then(value => { controller.signal.removeEventListener('abort', listener);
            if (controller.signal.aborted) { late?.(value); reject(new SourceBundleTransportError(cancellation)); } else resolve(value);
          }, () => { controller.signal.removeEventListener('abort', listener); reject(new SourceBundleTransportError(controller.signal.aborted ? cancellation : 'provider_failed')); });
          if (controller.signal.aborted) listener();
        });
      }
      const cancelBody = response => { try { Promise.resolve(response?.body?.cancel()).catch(() => {}); } catch { /* No raw errors. */ } };
      async function read(response, maximum) {
        let reader; const chunks = []; let bytes = 0;
        try {
          reader = response.body.getReader();
          while (true) { const part = await race(reader.read()); if (part.done) break;
            if (!(part.value instanceof Uint8Array)) fail('invalid_response');
            bytes += part.value.byteLength; if (bytes > maximum) fail('response_too_large'); chunks.push(part.value); }
          const all = new Uint8Array(bytes); let offset = 0;
          for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
          return new TextDecoder('utf-8', { fatal: true }).decode(all);
        } catch (error) { throw error instanceof SourceBundleTransportError ? error : new SourceBundleTransportError('invalid_response'); }
        finally { if (reader) { try { Promise.resolve(reader.cancel()).catch(() => {}); reader.releaseLock(); } catch { /* best effort */ } } else cancelBody(response); }
      }
      async function send(kind, encoded) {
        check(); available(accounting(() => ledger.getState()), kind === 'count' ? 2 : 1); check();
        const endpoint = kind === 'count' ? COUNT : GENERATE, attemptId = randomUUID(), start = performance.now();
        accounting(() => ledger.reserve({ attemptId, channel: kind === 'count' ? 'cairn-count' : 'cairn-generation', reservedMicroUsd: RESERVATION }));
        let dispatched = false, responseBody = null, responseSha256 = null, requestId = null,
          inputTokens = null, outputTokens = null, actualMicroUsd = null, outcome = 'failed', failureCode = null, result;
        const identity = { version: VERSION, slotId: manifest.slotId, preparedRequestSha256: manifest.preparedRequestSha256,
          attemptId, endpoint, kind, requestBody: redactSecrets(encoded), requestSha256: sha256(encoded), reservedMicroUsd: RESERVATION };
        try {
          observe({ ...identity, phase: 'pre', dispatched: false, inputTokens, outputTokens, actualMicroUsd,
            outcome: null, responseBody, responseSha256, requestId, latencyMs: 0, failureCode: null });
          check(); accounting(() => ledger.getState()); check(); dispatched = true; outcome = 'unknown';
          const response = await race(fetchImpl(endpoint, { method: 'POST', redirect: 'error',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: encoded, signal: controller.signal }), cancelBody);
          // A known safety status is fatal even if its body cannot be read or
          // parsed. Defer rejection so safely reported generation usage settles.
          const responseFailure = response.redirected || response.status >= 300 && response.status < 400
            ? 'redirect_rejected' : response.status === 401 || response.status === 403 ? 'authentication_failed' : null;
          if (responseFailure) mark(responseFailure);
          const raw = await read(response, kind === 'count' ? 65536 : 262144);
          outcome = 'failed';
          const credentialEcho = echo(raw, key);
          if (!credentialEcho) { responseBody = redactSecrets(raw); responseSha256 = sha256(raw); }
          // Parse and retain generation usage before rejecting HTTP/auth/model/output.
          let parsed; try { parsed = json(raw, kind === 'generation' ? 'invalid_usage' : 'invalid_response'); }
          catch (error) { if (credentialEcho) fail('credential_echo'); throw error; }
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            if (credentialEcho) fail('credential_echo'); fail(kind === 'generation' ? 'invalid_usage' : 'invalid_response');
          }
          if (!credentialEcho && typeof parsed?.id === 'string' && /^[A-Za-z0-9_-]{1,200}$/u.test(parsed.id)) requestId = parsed.id;
          if (kind === 'generation') {
            const usage = parsed?.usage;
            if (Object.hasOwn(parsed, 'usage') || response.ok) {
              if (!usage || !['input_tokens', 'output_tokens', 'total_tokens'].every(field => Number.isSafeInteger(usage[field]) && usage[field] >= 0)
                || usage.total_tokens !== usage.input_tokens + usage.output_tokens) {
                if (credentialEcho) fail('credential_echo'); fail('invalid_usage');
              }
              inputTokens = usage.input_tokens; outputTokens = usage.output_tokens;
              const profile = modelProfile().rank;
              if (profile.model !== MODEL || profile.inputRate !== 0.4 || profile.outputRate !== 1.6) fail('invalid_usage');
              const price = (BigInt(inputTokens) * 4n + BigInt(outputTokens) * 16n + 9n) / 10n;
              if (price > BigInt(Number.MAX_SAFE_INTEGER)) fail('invalid_usage'); actualMicroUsd = Number(price);
              if (credentialEcho) fail('credential_echo');
              if (inputTokens > 7024 || outputTokens > 1024 || actualMicroUsd > RESERVATION) fail('usage_overrun');
            }
            if ((Object.hasOwn(parsed, 'model') || response.ok) && parsed.model !== MODEL) fail('model_mismatch');
          }
          if (credentialEcho) fail('credential_echo');
          if (responseFailure) fail(responseFailure);
          if (!response.ok) fail('provider_failed');
          if (kind === 'count') {
            own(parsed, ['object', 'input_tokens'], 'invalid_response');
            if (parsed.object !== 'response.input_tokens' || !Number.isSafeInteger(parsed.input_tokens) || parsed.input_tokens < 0) fail('invalid_response');
            inputTokens = parsed.input_tokens; if (inputTokens > 7024) fail('usage_overrun'); result = inputTokens;
          } else {
            if (parsed.status !== 'completed' || parsed.error != null || parsed.incomplete_details != null
              || !Array.isArray(parsed.output) || parsed.output.length !== 1) fail('invalid_model_output');
            const message = parsed.output[0];
            if (message.type !== 'message' || message.role !== 'assistant' || message.status !== 'completed'
              || !Array.isArray(message.content) || message.content.length !== 1) fail('invalid_model_output');
            const part = message.content[0];
            if (part.type !== 'output_text' || typeof part.text !== 'string' || !part.text.isWellFormed()
              || part.text.length > 40000 || countTokens(part.text) > 1024) fail('invalid_model_output');
            const proposal = json(part.text, 'invalid_model_output');
            try { result = compileBundlePlan(source.prepared, proposal).proposal; }
            catch { fail('invalid_model_output'); }
          }
          check(); outcome = 'succeeded';
        } catch (error) { failureCode = error instanceof SourceBundleTransportError ? error.code : 'provider_failed'; mark(failureCode); }
        finally {
          let settlementPersisted = true;
          try { accounting(() => ledger.recordOutcome({ attemptId, outcome,
            ...(actualMicroUsd === null ? {} : { actualMicroUsd }) })); }
          catch { failureCode = 'ledger_failed'; settlementPersisted = false; }
          try { observe({ ...identity, phase: 'post', dispatched, inputTokens, outputTokens, actualMicroUsd,
            outcome, responseBody, responseSha256, requestId, latencyMs: Math.max(0, performance.now() - start),
            failureCode, settlementPersisted }); }
          catch { failureCode = 'record_persistence_failed'; }
        }
        if (failureCode) fail(failureCode); check(); return result;
      }
      await send('count', countBody); return await send('generation', generationBody);
    } catch (error) { const code = error instanceof SourceBundleTransportError ? error.code : 'invalid_request'; mark(code); fail(code); }
    finally { clearTimeout(timer); if (signal && abortListener) signal.removeEventListener('abort', abortListener); state = 'consumed'; }
  }
  return Object.freeze({ planRank, getRecords: () => Object.freeze([...records]),
    getState() { if (state === 'closed') fail('transport_closed'); return accounting(() => ledger.getState()); },
    health: () => Object.freeze({ state, fatalCode }), close() {
      if (state === 'active') fail('transport_busy'); if (state === 'closed') return;
      try { accounting(() => ledger.close()); } finally { state = 'closed'; }
    } });
}
