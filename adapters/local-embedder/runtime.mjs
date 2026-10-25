import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks, builtinModules } from 'node:module';
import { validateVector } from '../../core/context-read-embedder.mjs';
import { IDENTITY, fail } from './common.mjs';
const builtins = new Set(builtinModules.flatMap(name => [name, 'node:' + name]));
export function resolutionGuard(pack, { attempt = () => {} } = {}) {
  const files = new Set(pack.fence.files.map(f => join(pack.packPath, f.path)));
  const native = new Set(pack.fence.selectedNativeFiles.map(f => join(pack.packPath, f)));
  let latched = false;
  const refuse = () => { latched = true; fail('model_runtime_unavailable'); };
  const check = (url, binding = false) => {
    attempt(url, binding);
    if (builtins.has(url)) return;
    if (latched) refuse();
    let path;
    try { path = url.startsWith('file:') ? fileURLToPath(url) : url; } catch { refuse(); }
    if (!files.has(path) || /\.wasm$/i.test(path) || /\.(?:wasm|node|dylib|so(?:\.[0-9.]+)?|dll)$/i.test(path) && !native.has(path) || binding && !native.has(path)) refuse();
  };
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (builtins.has(specifier)) return nextResolve(specifier, context);
      let result;
      try { result = nextResolve(specifier, context); } catch (error) { if (error.code === 'ERR_DLOPEN_FAILED') latched = true; throw error; }
      check(result.url); return result;
    },
    load(url, context, nextLoad) { check(url); try { return nextLoad(url, context); } catch (error) { latched = true; throw error; } }
  });
  const dlopen = process.dlopen;
  process.dlopen = function(module, path, ...args) {
    check(path, true);
    try { return dlopen.call(this, module, path, ...args); } catch { refuse(); }
  };
  return { assert() { if (latched) fail('model_runtime_unavailable'); }, close() { hooks.deregister(); process.dlopen = dlopen; } };
}
export function validateText(texts) {
  if (!Array.isArray(texts) || texts.length !== 1 || typeof texts[0] !== 'string' || !texts[0].length || !texts[0].isWellFormed() || texts[0].includes('\0')) fail('invalid_input');
  if (texts[0].length > 2000000) fail('context_item_too_large');
}
export function poolCLS(hidden) {
  const dims = hidden?.dims;
  if (!Array.isArray(dims) || dims.length !== 3 || dims[0] !== 1 || !Number.isSafeInteger(dims[1]) || dims[1] < 1 || dims[1] > 8192 || dims[2] !== 1024 || (!Array.isArray(hidden.data) && !(hidden.data instanceof Float32Array) && !(hidden.data instanceof Float64Array)) || hidden.data.length !== dims[1] * 1024) fail('dimension_mismatch');
  // All returned tensor components must be finite, even outside the CLS row.
  for (const value of hidden.data) if (typeof value !== 'number' || !Number.isFinite(value)) fail('provider_error');
  const values = Float32Array.from(hidden.data.slice(0, 1024));
  if (!values.every(Number.isFinite)) fail('provider_error');
  const norm = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
  if (!Number.isFinite(norm) || norm <= 0) fail('provider_error');
  return validateVector(values.map(v => v / norm), { ...IDENTITY, revision: 'tensor-validation' });
}
// Injection is construction-only, never environment controlled. Production
// uses the verified pinned module; tests supply a tiny tokenizer/tensor oracle.
export async function loadRuntime(pack, threads, load = () => import(pathToFileURL(join(pack.packPath, 'runtime/node_modules/@huggingface/transformers/dist/transformers.node.mjs')).href), beforeLoad = () => {}) {
  const { AutoTokenizer, AutoModel, env } = await load();
  env.allowRemoteModels = false; env.allowLocalModels = true; env.useBrowserCache = false; env.useFSCache = false;
  env.localModelPath = join(pack.packPath, 'model');
  await beforeLoad();
  const options = { local_files_only: true, revision: pack.manifest.model.revision };
  const tokenizer = await AutoTokenizer.from_pretrained(join(pack.packPath, 'model'), options);
  const model = await AutoModel.from_pretrained(join(pack.packPath, 'model'), { ...options, dtype: 'fp32', device: 'cpu', use_external_data_format: true,
    session_options: { intraOpNumThreads: threads, interOpNumThreads: 1, executionMode: 'sequential' } });
  return {
    async embed(texts) {
      validateText(texts);
      const tokens = await tokenizer(texts[0], { add_special_tokens: true, truncation: false, padding: false });
      const shape = tokens?.input_ids?.dims, count = tokens?.input_ids?.data?.length;
      if (!Array.isArray(shape) || shape.length !== 2 || shape[0] !== 1 || !Number.isSafeInteger(count) || count < 1 || shape[1] !== count) fail('provider_error');
      if (count > 8192) fail('context_item_too_large');
      const result = await model(tokens);
      const vector = poolCLS(result?.last_hidden_state);
      if (result.last_hidden_state.dims[1] !== count) fail('dimension_mismatch');
      return { vectors: [Array.from(vector)], tokenCounts: [count] };
    },
    async close() { await model.dispose?.(); }
  };
}
