import { countTokens } from '../../core/model-budget.mjs';
import { fail, identifier } from '../../core/validation.mjs';
import { prepareSelectionChecklist } from './query-evidence-checklist.mjs';

// Inspect descriptors before reading caller data; never invoke accessors/hooks.
function data(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('invalid_input');
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || (allowed && !allowed.includes(key)) ||
        !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail('invalid_input');
  }
  return value;
}
const checkAbort = signal => {
  if (signal.aborted) throw new DOMException('Full label selection cancelled', 'AbortError');
};
const identity = (index, id) => JSON.stringify([index, id]);
// The shared compiler copies arrays without invoking hooks, but permits custom
// array prototypes. This wrapper's ordinary-JSON boundary is stricter. Run only
// after compiler validation has established bounded, acyclic descriptor data.
function ordinaryArrays(value) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value) && Object.getPrototypeOf(value) !== Array.prototype) fail('invalid_input');
  for (const key of Reflect.ownKeys(value)) {
    ordinaryArrays(Object.getOwnPropertyDescriptor(value, key).value);
  }
}
const memoryRef = item => item.type === 'unfiled' ? item.ref :
  item.type === 'ref' && item.ref.childType === 'memory'
    ? { memoryId: item.ref.childId, revision: item.ref.childRevision } : null;

/** Evaluation-only exposure; public get reads are not an atomic snapshot. */
export function createFullLabelSelectionModel(model, options) {
  data(model);
  if (!model || typeof model.select !== 'function') fail('model_not_configured');
  if (typeof model.countTokens !== 'function') fail('token_count_unavailable');
  if (!Number.isSafeInteger(model.contextWindow) || model.contextWindow < 8192) fail('context_budget_exceeded');
  data(options, ['readSet', 'getMemory']);
  const { readSet, getMemory } = options;
  if (typeof getMemory !== 'function' || !Array.isArray(readSet) ||
      Object.getPrototypeOf(readSet) !== Array.prototype || readSet.length < 1 || readSet.length > 2 ||
      Reflect.ownKeys(readSet).length !== readSet.length + 1) fail('invalid_input');
  const bindings = [];
  for (let i = 0; i < readSet.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(readSet, String(i));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) fail('invalid_input');
    const input = data(descriptor.value, ['ownerId', 'scope', 'projectId']);
    let normalized;
    try {
      const ownerId = identifier(input.ownerId);
      if (input.scope === 'personal' && input.projectId === null) {
        normalized = { ownerId, scope: 'personal', projectId: null };
      } else if (input.scope === 'project') {
        normalized = { ownerId, scope: 'project', projectId: identifier(input.projectId) };
      } else fail('invalid_input');
    } catch { fail('invalid_input'); }
    if (bindings.some(b => b.normalized.ownerId !== normalized.ownerId ||
        b.normalized.scope === normalized.scope)) fail('invalid_input');
    bindings.push({ normalized: Object.freeze(normalized), input: Object.freeze({ ...normalized }) });
  }
  const counter = { countTokens: model.countTokens.bind(model) }, select = model.select.bind(model);
  return Object.freeze({ ...model, async select(request) {
    data(request, ['system', 'input', 'maxOutputTokens', 'signal']);
    const { system, input, maxOutputTokens, signal } = request;
    if (typeof system !== 'string' || !system.isWellFormed() || system.length > 24_000 ||
        maxOutputTokens !== 1024 || !(signal instanceof AbortSignal)) fail('invalid_input');
    checkAbort(signal);
    const prepared = prepareSelectionChecklist(input), original = prepared.request.input;
    ordinaryArrays(input);
    const exposed = new Map();
    for (const map of original.maps) {
      if (!bindings[map.namespaceIndex]) fail('invalid_input');
      for (const item of map.items) {
        const ref = memoryRef(item);
        if (ref) exposed.set(identity(map.namespaceIndex, ref.memoryId), { ...ref, namespaceIndex: map.namespaceIndex });
      }
    }
    async function read(ref) {
      checkAbort(signal);
      const binding = bindings[ref.namespaceIndex];
      const response = await getMemory(Object.freeze({ namespace: binding.input, memoryId: ref.memoryId }));
      checkAbort(signal);
      try {
        data(response);
        if (response.ok !== true) fail('revision_conflict');
        const memory = data(data(response.value).memory), ns = data(memory.namespace);
        if (memory.id !== ref.memoryId || memory.revision !== ref.revision || memory.state !== 'active' ||
            ns.ownerId !== binding.normalized.ownerId || ns.projectId !== binding.normalized.projectId ||
            ns.scope !== binding.normalized.scope || typeof memory.content !== 'string' ||
            !memory.content.trim() || !memory.content.isWellFormed() || memory.content.length > 4000) fail('revision_conflict');
        return memory.content;
      } catch { fail('revision_conflict'); }
    }
    for (const ref of exposed.values()) ref.content = await read(ref);
    async function recheck() {
      for (const ref of exposed.values()) if (await read(ref) !== ref.content) fail('revision_conflict');
      checkAbort(signal);
    }
    const expanded = prepareSelectionChecklist({ ...original, maps: original.maps.map(map => ({ ...map,
      items: map.items.map(item => {
        const ref = memoryRef(item);
        return ref ? { ...item, label: exposed.get(identity(map.namespaceIndex, ref.memoryId)).content } : item;
      }) })) }).request.input;
    const modelRequest = Object.freeze({ system, input: expanded, maxOutputTokens });
    const encoded = JSON.stringify(modelRequest);
    if (Buffer.byteLength(encoded) > 24_000) fail('invalid_input');
    if (countTokens(counter, encoded) > 6000) fail('context_budget_exceeded');
    await recheck();
    const output = await select(Object.freeze({ ...modelRequest, signal }));
    checkAbort(signal);
    await recheck();
    const compile = () => {
      try {
        data(output, ['refs']);
        if (Reflect.ownKeys(output).length !== 1 || !Array.isArray(output.refs) ||
            Object.getPrototypeOf(output.refs) !== Array.prototype) fail('invalid_model_output');
        return prepared.compile({ requests: [{ start: 0, end: original.query.length, refs: output.refs }] }).selection;
      } catch { fail('invalid_model_output'); }
    };
    compile();
    const raw = JSON.stringify(output);
    if (raw.length > 40_000 || countTokens(counter, raw) > 1024) fail('invalid_model_output');
    const selection = compile();
    if (JSON.stringify(output) !== raw) fail('invalid_model_output');
    await recheck();
    for (const ref of selection.refs) Object.freeze(ref);
    Object.freeze(selection.refs);
    return Object.freeze(selection);
  } });
}
