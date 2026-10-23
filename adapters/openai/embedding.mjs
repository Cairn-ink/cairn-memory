import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { validateVector } from '../../core/context-read-embedder.mjs';

export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';
export const DEFAULT_EMBEDDING_DIMENSIONS = 1536;
export const EMBEDDING_REQUEST_BYTES = 2 * 1024 * 1024;
export const EMBEDDING_RESPONSE_BYTES = 64 * 1024 * 1024;
// Frozen accounting inputs, not a live price quote or billing attestation.
// Unlisted models require a trusted SDK caller to declare its reviewed rate.
export const EMBEDDING_USD_PER_MILLION = Object.freeze({ 'text-embedding-3-small': .02, 'text-embedding-3-large': .13, 'text-embedding-ada-002': .10 });
const failure = code => Object.assign(Error(code), { code });
function price(model, rate) {
  const selected = rate ?? EMBEDDING_USD_PER_MILLION[model];
  if (!Number.isFinite(selected) || selected <= 0) throw failure('invalid_input');
  return selected;
}
export function embeddingPrice(model = DEFAULT_EMBEDDING_MODEL, usdPerMillionTokens) { return price(model, usdPerMillionTokens); }
function tokenBound(texts) { return texts.reduce((sum, text) => sum + Buffer.byteLength(text) + 16, 0); }
function providerVector(input, metadata) {
  if (!Array.isArray(input) || input.length !== metadata.dimensions) throw failure('dimension_mismatch');
  let squared = 0;
  for (const component of input) {
    if (typeof component !== 'number' || !Number.isFinite(component)) throw failure('provider_error');
    squared += component * component;
  }
  const norm = Math.sqrt(squared);
  if (!Number.isFinite(norm) || norm < .9 || norm > 1.1) throw failure('provider_error');
  // Provider L2 vectors are approximate. Normalize in float64, then subject
  // persisted float32 values to the same strict validation as every embedder.
  return validateVector(Float32Array.from(input, component => component / norm), metadata);
}
export function estimateEmbeddingUsd(texts, { model = DEFAULT_EMBEDDING_MODEL, usdPerMillionTokens } = {}) {
  return tokenBound(texts) * price(model, usdPerMillionTokens) / 1_000_000;
}
export function createOpenAIEmbedder({ apiKey, model = DEFAULT_EMBEDDING_MODEL, dimensions = DEFAULT_EMBEDDING_DIMENSIONS,
  endpoint = 'https://api.openai.com/v1/embeddings', fetchImpl = globalThis.fetch, usdPerMillionTokens, ...unknown } = {}) {
  if (Object.keys(unknown).length || typeof apiKey !== 'string' || !apiKey.trim() || apiKey.length > 8192 || /[\r\n\0]/.test(apiKey) ||
      typeof model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(model) || !Number.isSafeInteger(dimensions) ||
      dimensions < 1 || dimensions > 32768 || typeof fetchImpl !== 'function') throw failure('invalid_input');
  if (model === 'text-embedding-ada-002' && dimensions !== 1536) throw failure('invalid_input');
  let url;
  try { url = new URL(endpoint); } catch { throw failure('invalid_input'); }
  if (url.username || url.password || url.hash || url.search || url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname))) throw failure('invalid_input');
  const rate = price(model, usdPerMillionTokens);
  const metadata = Object.freeze({ id: `openai:${model}:${createHash('sha256').update(url.href).digest('hex').slice(0, 16)}`,
    revision: 'provider-unversioned', dimensions, normalization: 'l2' });
  return Object.freeze({ ...metadata, async embed(texts, { signal, beforeDispatch, deadlineAt, settleUsd } = {}) {
    if (typeof beforeDispatch !== 'function' || typeof settleUsd !== 'function' || !Number.isFinite(deadlineAt)) throw failure('budget_denied');
    if (!Array.isArray(texts) || texts.length < 1 || texts.some(text => typeof text !== 'string' || !text.trim() ||
        !text.isWellFormed() || text.includes('\0'))) throw failure('invalid_input');
    if (texts.length > 64 || texts.some(text => Buffer.byteLength(text) + 16 > 8192) || tokenBound(texts) > 300000) {
      settleUsd(0); throw failure('context_item_too_large');
    }
    const body = JSON.stringify({ model, ...(model === 'text-embedding-ada-002' ? {} : { dimensions }), encoding_format: 'float', input: texts });
    if (Buffer.byteLength(body) > EMBEDDING_REQUEST_BYTES) { settleUsd(0); throw failure('context_item_too_large'); }
    const controller = new AbortController(), abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(abort, Math.max(0, deadlineAt - performance.now()));
    let reader, bodyComplete = false;
    const check = () => { beforeDispatch(); if (controller.signal.aborted || performance.now() >= deadlineAt) throw failure('timeout'); };
    try {
      check();
      const response = await fetchImpl(url.href, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body, signal: controller.signal, redirect: 'error' });
      check();
      if (response.status === 429) throw failure('rate_limited');
      if (!response.ok) throw failure('provider_error');
      const maximum = Math.min(EMBEDDING_RESPONSE_BYTES, texts.length * dimensions * 32 + 65536);
      const length = response.headers.get('content-length');
      if (length !== null && (!/^[0-9]+$/.test(length) || Number(length) > maximum) || !response.body) throw failure('provider_error');
      reader = response.body.getReader(); const chunks = []; let size = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) bodyComplete = true;
        check(); if (done) break;
        size += value.byteLength; if (size > maximum) throw failure('provider_error'); chunks.push(value);
      }
      let json;
      try { json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size))); }
      catch { throw failure('provider_error'); }
      check();
      if (json?.object !== 'list' || json.model !== model) throw failure('provider_error');
      if (json?.usage !== undefined) {
        const usage = json.usage;
        if (!Number.isSafeInteger(usage?.prompt_tokens) || usage.prompt_tokens < 0 || usage.prompt_tokens > tokenBound(texts) ||
            usage.total_tokens !== usage.prompt_tokens) throw failure('provider_error');
        settleUsd(usage.prompt_tokens * rate / 1_000_000);
      }
      if (!Array.isArray(json.data) || json.data.length !== texts.length) throw failure('provider_error');
      const vectors = new Array(texts.length);
      for (const item of json.data) {
        if (!Number.isInteger(item?.index) || item.index < 0 || item.index >= texts.length || vectors[item.index] !== undefined) throw failure('provider_error');
        try { vectors[item.index] = providerVector(item.embedding, metadata); }
        catch (error) { throw failure(error.code === 'dimension_mismatch' ? 'dimension_mismatch' : 'provider_error'); }
      }
      return vectors;
    } catch (error) {
      if (['scope_changed', 'store_closed', 'index_unavailable', 'budget_denied'].includes(error?.code)) throw error;
      if (controller.signal.aborted || error?.code === 'timeout' || error?.name === 'AbortError') throw failure('timeout');
      throw failure(['rate_limited', 'dimension_mismatch', 'invalid_input'].includes(error?.code) ? error.code : 'provider_error');
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      // EOF already settled the response. In particular, a known validation
      // failure must not wait on cancellation of an exhausted decoded stream.
      if (!bodyComplete) controller.abort();
      if (reader) { if (!bodyComplete) await reader.cancel().catch(() => {}); reader.releaseLock(); }
    }
  } });
}
