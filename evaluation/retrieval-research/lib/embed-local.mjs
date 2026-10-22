import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { collapseMemories } from './bm25.mjs';

export const MODEL_CACHE = '/home/chichieh/.cache/cairn-hr1-models';
export const LOCAL_MODELS = Object.freeze({
  'e5-small': Object.freeze({ repository: 'Xenova/multilingual-e5-small', revision: '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
    pooling: 'masked-mean', queryPrefix: 'query: ', passagePrefix: 'passage: ', maxLength: 512, dimensions: 384, weightBytes: 470268533 }),
  'bge-m3': Object.freeze({ repository: 'Xenova/bge-m3', revision: '4de13258303883538bd53b696b452bf8099f0858',
    pooling: 'cls', queryPrefix: '', passagePrefix: '', maxLength: 8192, dimensions: 1024, weightBytes: 2267427906, externalData: true }),
});
const sha = text => createHash('sha256').update(text).digest('hex');
export function normalizeVector(vector) {
  if (!vector?.length || ![...vector].every(Number.isFinite)) throw new Error('invalid_embedding');
  const norm = Math.sqrt(vector.reduce((s, n) => s + n * n, 0));
  if (!norm) throw new Error('zero_embedding');
  return Float32Array.from(vector, n => n / norm);
}
export function cosine(a, b) {
  if (a.length !== b.length || !a.length) throw new Error('embedding_dimension_mismatch');
  let dot = 0, an = 0, bn = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; an += a[i] * a[i]; bn += b[i] * b[i]; }
  if (!an || !bn) throw new Error('zero_embedding');
  return Math.max(-1, Math.min(1, dot / Math.sqrt(an * bn)));
}
export function poolHidden(hidden, mask, pooling) {
  const [batch, length, width] = hidden.dims;
  if (batch !== 1 || mask.length !== length) throw new Error('batch_one_required');
  const vector = new Float64Array(width); let count = 0;
  for (let token = 0; token < length; token++) {
    if (pooling === 'cls' ? token !== 0 : !Number(mask[token])) continue;
    for (let d = 0; d < width; d++) vector[d] += hidden.data[token * width + d];
    count++;
  }
  if (!count) throw new Error('empty_attention_mask');
  if (pooling !== 'cls') for (let d = 0; d < width; d++) vector[d] /= count;
  return normalizeVector(vector);
}
async function directoryBytes(path) {
  let bytes = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) bytes += await directoryBytes(child);
    else if (entry.isFile()) bytes += (await stat(child)).size;
  }
  return bytes;
}
export async function createLocalEmbedder({ model: name, cacheDir = MODEL_CACHE, threads = 4,
  allowDownload = false, progress = undefined } = {}, {
  loadTransformers = () => import('@huggingface/transformers'), measureDirectoryBytes = directoryBytes, makeDirectory = mkdir,
} = {}) {
  const spec = LOCAL_MODELS[name];
  if (!Object.hasOwn(LOCAL_MODELS, name) || !Number.isSafeInteger(threads) || threads < 1) throw new Error('invalid_local_model_configuration');
  const started = performance.now();
  const { AutoTokenizer, AutoModel } = await loadTransformers();
  const options = { revision: spec.revision, cache_dir: cacheDir, local_files_only: !allowDownload,
    ...(progress ? { progress_callback: progress } : {}) };
  const tokenizer = await AutoTokenizer.from_pretrained(spec.repository, options);
  const model = await AutoModel.from_pretrained(spec.repository, { ...options, dtype: 'fp32', device: 'cpu',
    use_external_data_format: spec.externalData ?? false,
    session_options: { intraOpNumThreads: threads, interOpNumThreads: 1, executionMode: 'sequential' } });
  // Once loading succeeds, this function owns the native session until it
  // returns an embedder. Every subsequent initialization failure must dispose it.
  try {
    const metadata = { name, ...spec, dtype: 'fp32', device: 'cpu', threads, interOpThreads: 1,
      coldLoadMs: performance.now() - started, modelBytes: await measureDirectoryBytes(join(cacheDir, spec.repository, spec.revision)),
      truncation: { maxLength: spec.maxLength, events: [] } };
    const documentCache = join(cacheDir, 'hr1-document-embeddings');
    await makeDirectory(documentCache, { recursive: true });
    const queries = new Map();
    return { metadata, async embed(texts, { kind = 'query', bypassCache = false } = {}) {
      const vectors = [];
      for (const text of texts) {
        const prefixed = (kind === 'document' ? spec.passagePrefix : spec.queryPrefix) + text;
        const key = sha(`${spec.repository}\0${spec.revision}\0fp32\0${sha(prefixed)}`);
        const path = join(documentCache, key + '.json');
        if (kind === 'query' && !bypassCache && queries.has(key)) { vectors.push(queries.get(key)); continue; }
        if (kind === 'document' && !bypassCache) {
          try {
            const saved = JSON.parse(await readFile(path, 'utf8'));
            if (saved.key !== key || saved.vector?.length !== spec.dimensions) throw new Error('invalid_document_cache');
            if (saved.truncation) metadata.truncation.events.push(saved.truncation);
            if (!saved.vector.every(Number.isFinite) || Math.abs(saved.vector.reduce((n, v) => n + v * v, 0) - 1) > 1e-5) throw new Error('invalid_document_cache');
            vectors.push(Float32Array.from(saved.vector)); continue;
          } catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
        const full = await tokenizer(prefixed, { truncation: false, padding: false });
        const originalTokens = full.input_ids.dims.at(-1);
        const inputs = originalTokens > spec.maxLength ?
          await tokenizer(prefixed, { truncation: true, max_length: spec.maxLength, padding: false }) : full;
        const truncation = originalTokens > spec.maxLength ? { textHash: sha(prefixed), kind, originalTokens, retainedTokens: spec.maxLength } : null;
        if (truncation) metadata.truncation.events.push(truncation);
        const output = await model(inputs);
        const vector = poolHidden(output.last_hidden_state, inputs.attention_mask.data, spec.pooling);
        if (vector.length !== spec.dimensions) throw new Error('unexpected_model_dimensions');
        if (kind === 'document' && !bypassCache) {
          const temp = `${path}.${randomUUID()}.tmp`;
          await writeFile(temp, JSON.stringify({ key, vector: [...vector], truncation }), { mode: 0o600 });
          await rename(temp, path);
        } else if (!bypassCache) queries.set(key, vector);
        vectors.push(vector);
      }
      return vectors;
    }, async close() { await model.dispose(); } };
  } catch (error) {
    try { await model.dispose(); }
    catch (disposeError) { throw new AggregateError([error, disposeError], 'local_model_initialization_cleanup_failed'); }
    throw error;
  }
}
export async function createDenseIndex(documents, embedder) {
  const started = performance.now();
  const vectors = await embedder.embed(documents.map(doc => doc.text), { kind: 'document' });
  const buildMs = performance.now() - started;
  return { buildMs, embedDocs: documents.length, embedMsPerDoc: buildMs / Math.max(1, documents.length),
    async search(text, depth = 24, { bypassCache = false } = {}) {
      const [query] = await embedder.embed([text], { kind: 'query', bypassCache });
      return collapseMemories(documents.map((doc, i) => ({ memoryId: doc.memoryId, docId: doc.docId, score: cosine(query, vectors[i]) })), depth);
    } };
}
