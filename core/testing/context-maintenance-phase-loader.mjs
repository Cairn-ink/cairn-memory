import assert from 'node:assert/strict';
// Test-only source instrumentation. Production validation bytes stay untouched.
let settings;
export function initialize(data) { settings = data; }
// Each rewrite must match exactly once, so a moved line fails loudly instead of
// silently testing unmodified code.
function rewrite(source, before, after, all = false) {
  const count = source.split(before).length - 1;
  assert.ok(all ? count >= 1 : count === 1, `instrumentation anchor matched ${count} times: ${before.slice(0, 60)}`);
  return all ? source.replaceAll(before, after) : source.replace(before, after);
}
export async function load(url, context, next) {
  const result = await next(url, context);
  if (result.format !== 'module') return result;
  let source = String(result.source);
  if (settings.identity && url.endsWith('/core/validation.mjs')) {
    source = rewrite(source, 'throw new MemoryStoreError(code);',
      'const error = new MemoryStoreError(code); globalThis[Symbol.for("phase-fail-object")] = error; throw error;');
  }
  if (settings.identity && url.endsWith('/core/context-product-worker.mjs')) {
    source = rewrite(source, 'catch (error) {attribution?.captureFailure(error);',
      'catch (error) { if(error.code === "authority_required") parentPort.postMessage({kind:"phase-evidence", event:"refusal-identity", same:error === globalThis[Symbol.for("phase-fail-object")]}); attribution?.captureFailure(error);', true);
  }
  if (settings.fresh && url.endsWith('/core/context-product-refusal.mjs')) {
    source = rewrite(source, "import { fail }", "import { fail, MemoryStoreError }");
    source = rewrite(source, 'throw error;', 'throw new MemoryStoreError(code);');
  }
  // Phase-free comparison arm: the same head code with only the phase argument
  // withheld, so outcomes can be compared without pinning historical bytes.
  if (settings.baseline && url.endsWith('/core/context-product-index.mjs')) {
    source = rewrite(source, "access=authorize(method,payload,credential,admitting?'admission':pumpWork?'work':undefined);",
      "access=authorize(method,payload,credential);");
  }
  return {...result, source};
}
