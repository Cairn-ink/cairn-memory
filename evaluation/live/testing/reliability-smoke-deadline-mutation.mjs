import assert from 'node:assert/strict';

const registration = "coreDeadlineSignals.add(controller.signal);\n"
  + "          assertContentPort({invoke:()=>controller.abort()});\n"
  + "          reject(new MemoryStoreError('model_timeout'));";

export function removeCoreDeadlineProvenance(source) {
  assert.equal(source.split(registration).length, 2,
    'one real fenced core timer provenance registration');
  return source.replace(registration,
    registration.replace('coreDeadlineSignals.add(controller.signal);\n          ', ''));
}

export function coreDeadlineProvenanceLoadHook(onMutation = () => {}) {
  return { load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (!url.endsWith('/core/model-call.mjs')) return loaded;
    const source = removeCoreDeadlineProvenance(String(loaded.source));
    onMutation();
    return { ...loaded, source };
  } };
}
