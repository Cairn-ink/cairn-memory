import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { normalizeVector } from './embed-local.mjs';

export const OPENAI_MODELS = Object.freeze({
  'openai-3-small': { model: 'text-embedding-3-small', dimensions: 1536 },
  'openai-3-large': { model: 'text-embedding-3-large', dimensions: 3072 },
  'openai-3-large@1024': { model: 'text-embedding-3-large', dimensions: 3072, truncate: 1024 },
});
const sha = text => createHash('sha256').update(text).digest('hex');

// Artifacts and stderr accept only these fixed codes, never arbitrary exception
// messages, stacks, causes, provider bodies or credential-bearing fetch errors.
const PUBLIC_ERROR_CODES = new Set([
  'hr1_operation_failed', 'openai_configuration_required', 'embedding_invalid_api_key', 'invalid_embedding_base_url',
  'invalid_embedding_transport_options', 'https_required', 'empty_embedding_input', 'embedding_input_byte_bound_exceeded',
  'embedding_transport_error', 'embedding_timeout', 'embedding_response_error', 'embedding_usage_missing',
  'invalid_embedding_response', 'invalid_embedding_cache', 'invalid_embedding', 'zero_embedding',
  'embedding_dimension_mismatch', 'invalid_hr1_ledger', 'incomplete_hr1_ledger', 'invalid_hr1_ledger_entry',
  'invalid_hr1_ledger_sequence', 'invalid_reservation', 'invalid_usage', 'invalid_settlement',
  'usage_exceeds_reservation', 'hr1_api_cap_exceeded', 'hr1_ledger_write_failed',
  'frozen_selection_required', 'invalid_frozen_selection', 'selection_not_ready_for_test',
  'invalid_lexical_selection', 'selection_lexical_override', 'selection_fixture_hash_mismatch',
  'invalid_context_selection', 'a5_nominated_context_required', 'no_projected_queries',
  'invalid_split_or_scale', 'exploration_grid_dev_only', 'invalid_threads', 'invalid_lexical_comparator',
  'embedding_model_required', 'invalid_fusion_configuration', 'invalid_local_model_configuration',
  'invalid_document_cache', 'unexpected_model_dimensions', 'local_model_initialization_cleanup_failed',
  'batch_one_required', 'empty_attention_mask', 'nonfinite_score', 'document_id_required',
  'a0_bounded_spans_required', 'a0_receipt_too_long', 'a0_duplicate_body_projection', 'a0_current_replacement_required',
  'a0_supersession_projection_changed', 'a0_unmapped_uuid', 'a0_incomplete_snapshot', 'a0_snapshot_mismatch',
  'hr1_requires_five_latency_passes',
]);
export function publicErrorCode(error) {
  const value = error instanceof Error ? Object.getOwnPropertyDescriptor(error, 'message')?.value : null;
  const message = typeof value === 'string' ? value : '';
  if (PUBLIC_ERROR_CODES.has(message) || /^embedding_http_[1-5][0-9]{2}$/.test(message)) return message;
  if (message.startsWith('missing_--')) return 'missing_cli_option';
  if (message.startsWith('unknown_arm:')) return 'unknown_arm';
  if (message.startsWith('unknown_model:')) return 'unknown_model';
  if (message.startsWith('a0_core_')) return 'a0_core_error';
  if (message.startsWith('a0_timing_')) return 'a0_timing_error';
  return 'hr1_operation_failed';
}

// UTF-8 bytes bound tokens conservatively: ≤8192/input, ≤300000/batch,
// ≤2048 inputs. Oversize inputs fail rather than silently truncate API texts.
export function embeddingBatches(texts) {
  const batches = []; let batch = [], bytes = 0;
  for (const text of texts) {
    if (typeof text !== 'string' || !text.trim()) throw new Error('empty_embedding_input');
    const n = Buffer.byteLength(text, 'utf8');
    if (n > 8192) throw new Error('embedding_input_byte_bound_exceeded');
    if (batch.length === 2048 || bytes + n > 300000) { batches.push(batch); batch = []; bytes = 0; }
    batch.push(text); bytes += n;
  }
  if (batch.length) batches.push(batch);
  return batches;
}
export function createOpenAIEmbedder({ model: name, apiKey, ledger, cacheDir, baseURL = 'https://api.openai.com',
  timeoutMs = 30000, maxRetries = 2, retryDelayMs = 100, fetchImpl = fetch } = {}) {
  const spec = OPENAI_MODELS[name];
  if (!Object.hasOwn(OPENAI_MODELS, name) || !ledger || !cacheDir) throw new Error('openai_configuration_required');
  // OpenAI's opaque keys are ASCII token strings. In particular, never pass
  // whitespace/control bytes to Headers: Node can echo that entire value.
  if (typeof apiKey !== 'string' || apiKey.length < 1 || apiKey.length > 512 || /[^A-Za-z0-9_-]/.test(apiKey)) throw new Error('embedding_invalid_api_key');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || !Number.isSafeInteger(maxRetries) || maxRetries < 0 ||
      !Number.isFinite(retryDelayMs) || retryDelayMs < 0) throw new Error('invalid_embedding_transport_options');
  let base;
  try { base = new URL(baseURL); } catch { throw new Error('invalid_embedding_base_url'); }
  if (base.username || base.password || base.search || base.hash) throw new Error('invalid_embedding_base_url');
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)))
    throw new Error('https_required');
  const url = `${baseURL.replace(/\/$/, '').replace(/\/v1$/, '')}/v1/embeddings`;
  const metadata = { name, repository: spec.model, revision: 'provider-unversioned', dtype: 'float32', device: 'hosted',
    dimensions: spec.truncate ?? spec.dimensions, truncation: spec.truncate ? 'first-1024-then-L2' : 'none', coldLoadMs: 0 };
  const cachePath = text => join(cacheDir, sha(`${spec.model}\0${sha(text)}`) + '.json');
  const valid = vector => Array.isArray(vector) && vector.length === spec.dimensions && vector.every(Number.isFinite);
  async function request(input) {
    for (let attempt = 0; ; attempt++) {
      const id = ledger.reserve(spec.model, input); // durable BEFORE fetch
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
      let retry = false;
      try {
        let response;
        try {
          response = await fetchImpl(url, { method: 'POST', redirect: 'error', signal: controller.signal,
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: spec.model, input, encoding_format: 'float' }) });
        } catch {
          retry = true;
          throw new Error(controller.signal.aborted ? 'embedding_timeout' : 'embedding_transport_error');
        }
        if (!response.ok) {
          if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) throw new Error('invalid_embedding_response');
          retry = response.status === 429 || response.status >= 500;
          // No trustworthy usage: retain even rejected-request reservations.
          throw new Error(`embedding_http_${response.status}`);
        }
        let result;
        try { result = await response.json(); }
        catch { retry = controller.signal.aborted; throw new Error(retry ? 'embedding_timeout' : 'embedding_response_error'); }
        if (Number.isSafeInteger(result?.usage?.total_tokens) && result.usage.total_tokens >= 0)
          ledger.settle(id, result.usage.total_tokens);
        else throw new Error('embedding_usage_missing');
        if (result.model !== spec.model || !Array.isArray(result.data) || result.data.length !== input.length)
          throw new Error('invalid_embedding_response');
        const ordered = Array(input.length), seen = new Set();
        for (const row of result.data) {
          if (!Number.isInteger(row.index) || row.index < 0 || row.index >= input.length || seen.has(row.index) || !valid(row.embedding))
            throw new Error('invalid_embedding_response');
          seen.add(row.index); ordered[row.index] = row.embedding;
        }
        return ordered;
      } catch (error) {
        retry ||= controller.signal.aborted;
        if (!retry || attempt >= maxRetries) throw new Error(publicErrorCode(error));
      } finally { clearTimeout(timer); }
      await new Promise(resolve => setTimeout(resolve, retryDelayMs * (attempt + 1)));
    }
  }
  return { metadata, async embed(texts, { kind = 'query', bypassCache = false } = {}) {
    try {
      // Validate before looking at caches, so invalid text never becomes cache-dependent.
      embeddingBatches(texts);
      await mkdir(cacheDir, { recursive: true });
      const output = Array(texts.length), missing = new Map();
      for (let i = 0; i < texts.length; i++) {
        const text = texts[i];
        if (!(kind === 'query' && bypassCache)) {
          try {
            const data = JSON.parse(await readFile(cachePath(text), 'utf8'));
            if (data.model !== spec.model || data.textHash !== sha(text) || !valid(data.vector)) throw new Error('invalid_embedding_cache');
            output[i] = data.vector; continue;
          } catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
        if (!missing.has(text)) missing.set(text, []);
        missing.get(text).push(i);
      }
      for (const batch of embeddingBatches([...missing.keys()])) {
        const vectors = await request(batch);
        for (let j = 0; j < batch.length; j++) {
          const text = batch[j], vector = vectors[j];
          for (const i of missing.get(text)) output[i] = vector;
          if (!(kind === 'query' && bypassCache)) {
            const target = cachePath(text), temp = `${target}.${randomUUID()}.tmp`;
            await writeFile(temp, JSON.stringify({ model: spec.model, textHash: sha(text), vector }), { mode: 0o600 });
            await rename(temp, target);
          }
        }
      }
      return output.map(vector => normalizeVector(spec.truncate ? vector.slice(0, spec.truncate) : vector));
    } catch (error) { throw new Error(publicErrorCode(error)); }
  }, async close() {} };
}
