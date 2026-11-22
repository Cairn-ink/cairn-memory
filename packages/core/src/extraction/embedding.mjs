const MAX_DIMENSIONS = 32768;
const failure = code => Object.assign(new Error(code), { code });
const invalid = code => { throw Object.assign(new TypeError(code), { code }); };

function validateEmbedderMetadata(value) {
  for (const key of ['id', 'revision']) {
    if (typeof value?.[key] !== 'string' || !value[key].trim() || value[key].length > 200 ||
        value[key].includes('\0') || !value[key].isWellFormed()) invalid('invalid_input');
  }
  if (!Number.isSafeInteger(value.dimensions) || value.dimensions < 1 || value.dimensions > MAX_DIMENSIONS ||
      !['none', 'l2'].includes(value.normalization)) invalid('invalid_input');
  return Object.freeze({ id: value.id, revision: value.revision, dimensions: value.dimensions, normalization: value.normalization });
}

function validateVector(input, metadata) {
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

function providerVector(input, metadata) {
  if (!Array.isArray(input) || input.length !== metadata.dimensions) throw failure('dimension_mismatch');
  let squared = 0;
  for (const component of input) {
    if (typeof component !== 'number' || !Number.isFinite(component)) throw failure('provider_error');
    squared += component * component;
  }
  const norm = Math.sqrt(squared);
  if (!Number.isFinite(norm) || norm < .9 || norm > 1.1) throw failure('provider_error');
  // Normalize in float64 before validating the persisted float32 values.
  return validateVector(Float32Array.from(input, component => component / norm), metadata);
}

/** Decode the response data in request order using the host's embedder metadata. */
export function decodeEmbeddingData(data, requestedCount, spec) {
  if (!Array.isArray(data) || data.length !== requestedCount) throw failure('provider_error');
  const vectors = new Array(requestedCount);
  for (const item of data) {
    if (!Number.isInteger(item?.index) || item.index < 0 || item.index >= requestedCount ||
        vectors[item.index] !== undefined) throw failure('provider_error');
    try { vectors[item.index] = providerVector(item.embedding, spec); }
    catch (error) { throw failure(error.code === 'dimension_mismatch' ? 'dimension_mismatch' : 'provider_error'); }
  }
  return vectors;
}
