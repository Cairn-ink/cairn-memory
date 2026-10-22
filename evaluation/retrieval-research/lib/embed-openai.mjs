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
  if (!Object.hasOwn(OPENAI_MODELS, name) || !ledger || !cacheDir || !apiKey) throw new Error('openai_configuration_required');
  const base = new URL(baseURL);
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
        const response = await fetchImpl(url, { method: 'POST', redirect: 'error', signal: controller.signal,
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: spec.model, input, encoding_format: 'float' }) });
        if (!response.ok) {
          retry = response.status === 429 || response.status >= 500;
          // No trustworthy usage: retain even rejected-request reservations.
          throw new Error(`embedding_http_${response.status}`);
        }
        const result = await response.json();
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
        retry ||= controller.signal.aborted || error instanceof TypeError;
        if (!retry || attempt >= maxRetries) throw error;
      } finally { clearTimeout(timer); }
      await new Promise(resolve => setTimeout(resolve, retryDelayMs * (attempt + 1)));
    }
  }
  return { metadata, async embed(texts, { kind = 'query', bypassCache = false } = {}) {
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
  }, async close() {} };
}
