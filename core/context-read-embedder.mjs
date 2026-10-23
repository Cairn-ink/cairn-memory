import { createHash } from 'node:crypto';
import { tokenizeT1 } from './context-read-tokenize.mjs';

export const MAX_DIMENSIONS = 32768;
export const MAX_VECTORS = 20000;
export const MAX_CACHE_BYTES = 134217728;
const invalid = code => { throw Object.assign(new TypeError(code), { code }); };
export function validateEmbedderMetadata(value) {
  for (const key of ['id', 'revision']) {
    if (typeof value?.[key] !== 'string' || !value[key].trim() || value[key].length > 200 ||
        value[key].includes('\0') || !value[key].isWellFormed()) invalid('invalid_input');
  }
  if (!Number.isSafeInteger(value.dimensions) || value.dimensions < 1 || value.dimensions > MAX_DIMENSIONS ||
      !['none', 'l2'].includes(value.normalization)) invalid('invalid_input');
  return Object.freeze({ id: value.id, revision: value.revision, dimensions: value.dimensions, normalization: value.normalization });
}
export function validateEmbedder(port) {
  const metadata = validateEmbedderMetadata(port);
  if (typeof port.embed !== 'function') invalid('invalid_input');
  const embed = port.embed.bind(port);
  return Object.freeze({ ...metadata, embed });
}
export function semanticCapacity(eligible, metadata) {
  const { dimensions } = validateEmbedderMetadata(metadata);
  if (!Number.isSafeInteger(eligible) || eligible < 0) invalid('invalid_input');
  const bytes = eligible * dimensions * 4;
  return { eligible: eligible <= MAX_VECTORS && bytes <= MAX_CACHE_BYTES, bytes };
}

export function validateVector(input, metadata) {
  const { dimensions, normalization } = validateEmbedderMetadata(metadata);
  // Bound allocation independently of dimension equality. Conversion precedes
  // component, dimension and norm validation (including fp32 overflow/underflow).
  if ((!Array.isArray(input) && !(input instanceof Float32Array) && !(input instanceof Float64Array)) ||
      input.length > MAX_DIMENSIONS) invalid('dimension_mismatch');
  if (Array.from(input).some(component => typeof component !== 'number')) invalid('invalid_vector');
  const vector = Float32Array.from(input);
  if (vector.length !== dimensions) invalid('dimension_mismatch');
  let squared = 0;
  for (const value of vector) {
    if (!Number.isFinite(value)) invalid('invalid_vector');
    squared += value * value;
  }
  const norm = Math.sqrt(squared);
  if (!Number.isFinite(norm) || norm <= 0 || normalization === 'l2' && Math.abs(norm - 1) > 1e-5) invalid('invalid_vector');
  return vector;
}
export function encodeVector(input, metadata) {
  const vector = validateVector(input, metadata), bytes = Buffer.alloc(vector.length * 4);
  vector.forEach((value, i) => bytes.writeFloatLE(value, i * 4));
  return bytes;
}
export function loadVector(bytes, metadata) {
  const { dimensions } = validateEmbedderMetadata(metadata);
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== dimensions * 4) invalid('dimension_mismatch');
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), vector = new Float32Array(dimensions);
  for (let i = 0; i < dimensions; i++) vector[i] = buffer.readFloatLE(i * 4);
  return validateVector(vector, metadata);
}
export function cosine(left, right) {
  if (left.length !== right.length) invalid('dimension_mismatch');
  let dot = 0, a = 0, b = 0;
  for (let i = 0; i < left.length; i++) { dot += left[i] * right[i]; a += left[i] ** 2; b += right[i] ** 2; }
  const score = dot / (Math.sqrt(a) * Math.sqrt(b));
  if (!Number.isFinite(score)) invalid('invalid_vector');
  return Math.max(-1, Math.min(1, score));
}

/** Synthetic, deterministic, no ports/keys/network. Aliases let tests express
 * paraphrases while retaining reproducible float32 cosine calculations. */
export function createFakeEmbedder({ dimensions = 32, aliases = {} } = {}) {
  const metadata = validateEmbedderMetadata({ id: 'deterministic-fake', revision: '1', dimensions, normalization: 'l2' });
  return { ...metadata, async embed(texts, { signal } = {}) {
    signal?.throwIfAborted();
    return texts.map(text => {
      const values = new Float64Array(dimensions);
      for (const term of tokenizeT1(text)) {
        const hash = createHash('sha256').update(aliases[term] ?? term).digest();
        values[hash.readUInt32LE(0) % dimensions] += 1;
      }
      if (!values.some(Boolean)) values[0] = 1;
      const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
      return validateVector(values.map(value => value / norm), metadata);
    });
  } };
}
