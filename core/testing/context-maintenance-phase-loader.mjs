import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
// Test-only source instrumentation. Production validation bytes stay untouched.
let settings;
export function initialize(data) { settings = data; }
export async function load(url, context, next) {
  const result = await next(url, context);
  if (result.format !== 'module') return result;
  let source = String(result.source);
  if (settings.identity && url.endsWith('/core/validation.mjs')) {
    source = source.replace('throw new MemoryStoreError(code);',
      'const error = new MemoryStoreError(code); globalThis[Symbol.for("phase-fail-object")] = error; throw error;');
  }
  if (settings.identity && url.endsWith('/core/context-product-worker.mjs')) {
    source = source.replaceAll('catch (error) {attribution?.captureFailure(error);',
      'catch (error) { if(error.code === "authority_required") parentPort.postMessage({kind:"phase-evidence", event:"refusal-identity", same:error === globalThis[Symbol.for("phase-fail-object")]}); attribution?.captureFailure(error);');
  }
  if (settings.fresh && url.endsWith('/core/context-product-refusal.mjs')) {
    source = source.replace("import { fail }", "import { fail, MemoryStoreError }")
      .replace('throw error;', 'throw new MemoryStoreError(code);');
  }
  if (settings.baseline && url.endsWith('/core/context-product-authority.mjs')) {
    source = source.replace("return function enter(method, payload, credential, maintenancePhase)", "return function enter(method, payload, credential)");
    source = source.replace("...(maintenancePhase === 'admission' || maintenancePhase === 'work' ? { maintenancePhase } : {}), ", "");
    assert.equal(createHash('sha256').update(source).digest('hex'), '4b1baa5550b1042905dd5ecc1abf3867f2012ba727047a15ae54230eab4e6102', 'exact base runtime bytes');
  }
  if (settings.baseline && url.endsWith('/core/context-product-worker.mjs')) {
    source = source.replace("const authorize = (method,payload,credential,maintenancePhase) => requestAuthority(host,binding,currentControl)(method,payload,credential,maintenancePhase);", "const authorize = (method,payload,credential) => requestAuthority(host,binding,currentControl)(method,payload,credential);");
    assert.equal(createHash('sha256').update(source).digest('hex'), '450a1105d9dc2ec7865f4a1261ad205acd5ebc2826ba7622b863bf11ca4b855e', 'exact base runtime bytes');
  }
  if (settings.baseline && url.endsWith('/core/context-product-index.mjs')) {
    source = source.replace("access=authorize(method,payload,credential,admitting?'admission':pumpWork?'work':undefined);", "access=authorize(method,payload,credential);");
    assert.equal(createHash('sha256').update(source).digest('hex'), 'c04f566f2d199df257a1666508b567d0903b3eb63fd22e33a124df0b5aae2499', 'exact base runtime bytes');
  }
  return {...result, source};
}
