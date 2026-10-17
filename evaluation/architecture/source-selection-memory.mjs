import { readFileSync } from 'node:fs';
import { types } from 'node:util';
import { captureSnapshot } from '../../core/capture-input.mjs';
import { extractionRequest } from '../../core/capture.mjs';
import { extractedWindowItems } from '../../core/source-windows.mjs';
import { prefixUnits } from '../../core/model-packing.mjs';
import { callModel, isCoreModelDeadlineSignal, modelRequestText } from '../../core/model-call.mjs';
import { countTokens } from '../../core/model-budget.mjs';
import { denseArray, fail, identifier, MemoryStoreError } from '../../core/validation.mjs';

const POLICY = 'indexed-evidence-v1';
const SYSTEM = readFileSync(new URL('./prompts/source-selection-memory.md', import.meta.url), 'utf8');
const INCOMPLETE = ' [incomplete preview]';
const PREVIEW_TIERS = Object.freeze([600, 400, 256, 160, 128]);
const preparations = new WeakMap();

// Only JSON text crosses the source/proposal boundary. No object coercion,
// getter traversal, toJSON, thenable assimilation or generic snapshot framework.
function parse(text, maximum, code) {
  try {
    if (typeof text !== 'string' || text.length > maximum || !text.isWellFormed()) fail(code);
    return JSON.parse(text);
  } catch { fail(code); }
}

function exactKeys(value, names, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== names.length || names.some(name => !Object.hasOwn(value, name))) fail(code);
}

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function trusted(prepared) {
  const state = preparations.get(prepared);
  if (!state) fail('invalid_input');
  return state;
}

/** Pure offline preparation; callers pass capture/options to ordinary core. */
export function prepareSourceSelectionMemory(captureJSON) {
  try {
    const capture = parse(captureJSON, 600_000, 'invalid_input');
    exactKeys(capture, ['namespace', 'client', 'sessionId', 'eventId', 'messages'], 'invalid_input');
    exactKeys(capture.namespace, ['ownerId', 'scope', 'projectId'], 'invalid_input');
    identifier(capture.namespace.ownerId);
    if (capture.namespace.scope === 'personal' ? capture.namespace.projectId !== null
      : capture.namespace.scope !== 'project' || !identifier(capture.namespace.projectId)) fail('invalid_input');
    const snapshot = captureSnapshot(capture, undefined, POLICY);
    const baseline = extractionRequest(snapshot, { captureSourcePolicy: POLICY });
    const baselineRequest = { system: baseline.system, input: baseline.input, maxOutputTokens: 1024 };
    const request = { system: SYSTEM, input: baseline.input, maxOutputTokens: 1024 };
    const prepared = freeze({ capture, options: { captureSourcePolicy: POLICY }, baselineRequest, request });
    preparations.set(prepared, { snapshot: freeze(snapshot), catalog: baseline.catalog, baselineRequest, request });
    return prepared;
  } catch { fail('invalid_input'); }
}

/** Exact provider schema; compiler and core remain authoritative. */
export function sourceSelectionMemorySchema(prepared) {
  const state = trusted(prepared);
  return freeze({ type: 'object', additionalProperties: false, required: ['groups'], properties: {
    groups: { type: 'array', minItems: 0, maxItems: 5, items: {
      type: 'object', additionalProperties: false, required: ['sourceIndices'], properties: {
        sourceIndices: { type: 'array', minItems: 1, maxItems: 4,
          items: { type: 'integer', minimum: 0, maximum: state.catalog.entries.length - 1 } },
      } } },
  } });
}

/** Copy a labeled first-window preview, then bind every exact original receipt. */
export function compileSourceSelectionMemory(prepared, selectionJSON, previewUnits = 600) {
  const state = trusted(prepared);
  try {
    if (!PREVIEW_TIERS.includes(previewUnits)) fail('invalid_model_output');
    const proposal = parse(selectionJSON, 40_000, 'invalid_model_output');
    exactKeys(proposal, ['groups'], 'invalid_model_output');
    denseArray(proposal.groups, 0, 5);
    const observations = [];
    const items = proposal.groups.map(group => {
      exactKeys(group, ['sourceIndices'], 'invalid_model_output');
      const indices = denseArray(group.sourceIndices, 1, 4);
      if (new Set(indices).size !== indices.length || indices.some(index =>
        !Number.isSafeInteger(index) || index < 0 || index >= state.catalog.entries.length)) fail('invalid_model_output');
      const first = state.catalog.entries[indices[0]];
      const label = `[Untrusted source excerpt; claimed role: ${first.role}; not a verified/current fact] `;
      const clipped = label.length + first.content.length > previewUnits;
      // Canonical source text has single interior spaces. Avoid a doubled space
      // before the marker so the ordinary core normalizer keeps this exact view.
      const copied = prefixUnits(first.content, previewUnits - label.length - (clipped ? INCOMPLETE.length : 0)).trimEnd();
      observations.push({ sourceIndices: [...indices], previewClipped: clipped, copiedUnits: copied.length });
      return { content: label + copied + (clipped ? INCOMPLETE : ''), kind: 'context', confidence: 0,
        sourceIndices: [...indices] };
    });
    const output = { items };
    // Includes core's duplicate receipt-identity check, beyond distinct indices.
    extractedWindowItems(output, state.snapshot, state.catalog);
    return freeze({ output, observation: { previewUnits, groups: observations } });
  } catch { fail('invalid_model_output'); }
}

function portValue(port, name) {
  if (!port || typeof port !== 'object' || types.isProxy(port)) fail('invalid_input');
  const descriptor = Object.getOwnPropertyDescriptor(port, name);
  if (descriptor && !Object.hasOwn(descriptor, 'value')) fail('invalid_input');
  return descriptor?.value;
}

// Compare the finite known request shape through data descriptors only. This is
// not a serializer and does not inspect arbitrary provider result object graphs.
function matches(actual, expected) {
  if (expected === null || typeof expected !== 'object') return actual === expected;
  if (!actual || typeof actual !== 'object' || types.isProxy(actual) ||
      Array.isArray(actual) !== Array.isArray(expected)) return false;
  const keys = Reflect.ownKeys(expected), descriptors = Object.getOwnPropertyDescriptors(actual);
  if (Reflect.ownKeys(descriptors).length !== keys.length) return false;
  return keys.every(key => {
    const descriptor = descriptors[key];
    return descriptor && Object.hasOwn(descriptor, 'value') &&
      descriptor.enumerable === Object.getOwnPropertyDescriptor(expected, key).enumerable &&
      matches(descriptor.value, expected[key]);
  });
}

/** One injected selection invocation; no network, repair, retry or fallback. */
export function createSourceSelectionModel(prepared, port) {
  const state = trusted(prepared);
  const select = portValue(port, 'selectSources');
  const count = portValue(port, 'countTokens');
  const classify = portValue(port, 'classify');
  const contextWindow = portValue(port, 'contextWindow');
  if (typeof select !== 'function' || typeof count !== 'function' ||
      (classify !== undefined && typeof classify !== 'function')) fail('invalid_input');
  const baselineWire = modelRequestText(state.baselineRequest.system, state.baselineRequest.input);
  const selectionWire = modelRequestText(state.request.system, state.request.input);
  const localCount = text => count.call(port, text);
  let used = false;
  let observation = freeze({ actualRequest: null, previewUnits: null, groups: null, output: null });
  const model = {
    contextWindow,
    // Ordinary core preflight must measure the actual substituted request.
    countTokens: text => localCount(text === baselineWire ? selectionWire : text),
    async extract(value) {
      if (used) fail('invalid_input');
      used = true;
      if (!value || typeof value !== 'object' || types.isProxy(value)) fail('invalid_input');
      const descriptors = Object.getOwnPropertyDescriptors(value);
      if (Reflect.ownKeys(descriptors).length !== 4 ||
          !['system', 'input', 'maxOutputTokens', 'signal'].every(key =>
            descriptors[key]?.enumerable && Object.hasOwn(descriptors[key], 'value'))) fail('invalid_input');
      const outerSignal = descriptors.signal.value;
      if (!(outerSignal instanceof AbortSignal) || !matches({ system: descriptors.system.value,
        input: descriptors.input.value, maxOutputTokens: descriptors.maxOutputTokens.value }, state.baselineRequest)) fail('invalid_input');
      const abortFailure = () => {
        if (isCoreModelDeadlineSignal(outerSignal)) return new MemoryStoreError('model_timeout');
        const error = new Error('model_cancelled'); error.name = 'AbortError'; return error;
      };
      if (outerSignal.aborted) throw abortFailure();
      let validatedSelection;
      const boundedPort = { contextWindow, countTokens: localCount,
        async selectSources(request) {
          const controller = new AbortController();
          let rejectAbort;
          const aborted = new Promise((_, reject) => { rejectAbort = reject; });
          aborted.catch(() => {});
          const onAbort = () => { controller.abort(); rejectAbort(abortFailure()); };
          const onInnerAbort = () => controller.abort();
          outerSignal.addEventListener('abort', onAbort, { once: true });
          request.signal.addEventListener('abort', onInnerAbort, { once: true });
          try {
            if (outerSignal.aborted) onAbort();
            if (request.signal.aborted) onInnerAbort();
            if (controller.signal.aborted) throw abortFailure();
            const actualRequest = state.request;
            observation = freeze({ ...observation, actualRequest });
            const accept = text => {
              if (controller.signal.aborted) throw abortFailure();
              // Validate type before Promise resolution can probe a model-owned
              // then accessor on a synchronous nonstring result.
              if (typeof text !== 'string' || text.length > 40_000 || !text.isWellFormed()) fail('invalid_model_output');
              if (countTokens(boundedPort, text) > 1024) fail('invalid_model_output');
              const compiled = compileSourceSelectionMemory(prepared, text);
              if (controller.signal.aborted) throw abortFailure();
              validatedSelection = { text, compiled };
              // The inner guarded call bounds the canonical selection response.
              // Complete compiled outputs are measured once per tier below;
              // ordinary outer core still performs its final output check.
              return parse(text, 40_000, 'invalid_model_output');
            };
            const proposal = await Promise.race([Promise.resolve().then(() => {
              if (controller.signal.aborted) throw abortFailure();
              const generated = select.call(port, Object.freeze({ ...actualRequest, signal: controller.signal }));
              if (!types.isPromise(generated)) return accept(generated);
              // Promise#then consults constructor/species. Accept ordinary
              // native promises only, so a decorated result cannot run a
              // constructor/then accessor before the JSON-text check.
              if (Object.getPrototypeOf(generated) !== Promise.prototype || Object.hasOwn(generated, 'constructor')) {
                fail('invalid_model_output');
              }
              return Promise.prototype.then.call(generated, accept);
            }), aborted]);
            if (controller.signal.aborted) throw abortFailure();
            return proposal;
          } finally {
            outerSignal.removeEventListener('abort', onAbort);
            request.signal.removeEventListener('abort', onInnerAbort);
          }
        } };
      try {
        await callModel(boundedPort, 'selectSources', state.request.system, state.request.input,
          { failureCode: 'extraction_failed', deadline: {
            expired: () => outerSignal.aborted && isCoreModelDeadlineSignal(outerSignal), remainingMs: () => 30_000,
          } });
        for (const previewUnits of PREVIEW_TIERS) {
          if (outerSignal.aborted) throw abortFailure();
          const compiled = previewUnits === 600 ? validatedSelection.compiled
            : compileSourceSelectionMemory(prepared, validatedSelection.text, previewUnits);
          if (outerSignal.aborted) throw abortFailure();
          const outputText = JSON.stringify(compiled.output);
          const tokens = countTokens(boundedPort, outputText);
          if (outerSignal.aborted) throw abortFailure();
          if (outputText.length > 40_000 || tokens > 1024) continue;
          observation = freeze({ actualRequest: state.request, ...compiled.observation, output: compiled.output });
          return compiled.output;
        }
        fail('invalid_model_output');
      } catch (error) {
        if (error instanceof MemoryStoreError && error.code === 'model_cancelled') error.name = 'AbortError';
        throw error;
      }
    },
    ...(classify ? { classify: request => classify.call(port, request) } : {}),
    observe: () => observation,
  };
  return Object.freeze(model);
}
