import { readFileSync } from 'node:fs';
import { types } from 'node:util';
import { captureSnapshot } from '../../core/capture-input.mjs';
import { extractionRequest } from '../../core/capture.mjs';
import { extractedWindowItems } from '../../core/source-windows.mjs';
import { callModel, isCoreModelDeadlineSignal, modelRequestText } from '../../core/model-call.mjs';
import { denseArray, fail, identifier, MemoryStoreError } from '../../core/validation.mjs';

const POLICY = 'indexed-evidence-v1';
const SYSTEM = readFileSync(new URL('./prompts/role-stratified-extraction.md', import.meta.url), 'utf8');
const preparations = new WeakMap();

// Copy descriptors, not property reads: neither getters nor toJSON may execute.
// A path set rejects cycles while allowing ordinary repeated JSON subtrees.
function jsonSnapshot(value, code, maximumUnits = 100_000) {
  let remaining = maximumUnits;
  const path = new Set();
  function copy(node, depth) {
    if (--remaining < 0 || depth > 16) fail(code);
    if (node === null || typeof node === 'boolean') return node;
    if (typeof node === 'string') {
      if (!node.isWellFormed() || node.length > remaining) fail(code);
      remaining -= node.length;
      return node;
    }
    if (typeof node === 'number' && Number.isFinite(node)) return node;
    if (!node || typeof node !== 'object' || types.isProxy(node) || path.has(node)) fail(code);
    const array = Array.isArray(node);
    if (array ? Object.getPrototypeOf(node) !== Array.prototype
      : ![Object.prototype, null].includes(Object.getPrototypeOf(node))) fail(code);
    if (array) denseArray(node, 0, maximumUnits);
    path.add(node);
    const result = array ? [] : {};
    for (const name of Reflect.ownKeys(node)) {
      if (array && name === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(node, name);
      if (typeof name !== 'string' || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value') ||
          (array && !/^(0|[1-9]\d*)$/.test(name))) fail(code);
      remaining -= name.length;
      Object.defineProperty(result, name, { value: copy(descriptor.value, depth + 1), enumerable: true });
    }
    path.delete(node);
    return Object.freeze(result);
  }
  try {
    const result = copy(value, 0);
    // Match the core's UTF-16 wire bounds; the tokenizer measures actual tokens.
    if (JSON.stringify(result).length > maximumUnits) fail(code);
    return result;
  } catch { fail(code); }
}

function exactKeys(value, names, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== names.length || names.some(name => !Object.hasOwn(value, name))) fail(code);
}

function trusted(prepared) {
  const state = preparations.get(prepared);
  if (!state) fail('invalid_input');
  return state;
}

/** Offline preparation only. The host must pass capture and options to ordinary core.capture/openMemoryCore. */
export function prepareRoleStratifiedExtraction(value, options) {
  try {
    const config = jsonSnapshot(options, 'invalid_input');
    exactKeys(config, ['captureSourcePolicy'], 'invalid_input');
    if (config.captureSourcePolicy !== POLICY) fail('invalid_input');
    // captureSnapshot permits up to 20,000 raw units before per-message
    // canonicalization, so allow all 24 raw messages before enforcing its bounds.
    const capture = jsonSnapshot(value, 'invalid_input', 600_000);
    exactKeys(capture, ['namespace', 'client', 'sessionId', 'eventId', 'messages'], 'invalid_input');
    exactKeys(capture.namespace, ['ownerId', 'scope', 'projectId'], 'invalid_input');
    identifier(capture.namespace.ownerId);
    if (capture.namespace.scope === 'personal' ? capture.namespace.projectId !== null
      : capture.namespace.scope !== 'project' || !identifier(capture.namespace.projectId)) fail('invalid_input');
    const snapshot = captureSnapshot(capture, undefined, POLICY);
    // extractionRequest invokes the same sourceWindowCatalog as normal capture.
    const baseline = extractionRequest(snapshot, { captureSourcePolicy: POLICY });
    const baselineRequest = jsonSnapshot({ system: baseline.system, input: baseline.input,
      maxOutputTokens: 1024 }, 'invalid_input');
    const request = jsonSnapshot({ system: SYSTEM, input: baseline.input, maxOutputTokens: 1024 }, 'invalid_input');
    const prepared = Object.freeze({ capture, options: config, baselineRequest, request });
    preparations.set(prepared, { snapshot, catalog: baseline.catalog, baselineRequest, request });
    return prepared;
  } catch { fail('invalid_input'); }
}

/** Pure, frozen provider schema. Core compilation still checks UTF-16 and role citations. */
export function roleStratifiedExtractionSchema(prepared) {
  const state = trusted(prepared);
  const entry = { type: 'object', additionalProperties: false,
    required: ['content', 'kind', 'confidence', 'sourceIndices'],
    properties: {
      content: { type: 'string', minLength: 1, maxLength: 600,
        description: 'At most 600 UTF-16 units; compiler validation is authoritative.' },
      kind: { type: 'string', enum: ['fact', 'preference', 'decision', 'instruction', 'context'] },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      sourceIndices: { type: 'array', minItems: 1, maxItems: 4,
        description: 'Use distinct indices; compiler validation rejects duplicates.',
        items: { type: 'integer', minimum: 0, maximum: state.catalog.entries.length - 1 } },
    } };
  return jsonSnapshot({ type: 'object', additionalProperties: false, required: ['userItems', 'assistantItems'],
    properties: {
      userItems: { type: 'array', minItems: 0, maxItems: 3, items: entry,
        description: 'Each item must cite at least one user-role window; unused slots cannot be borrowed.' },
      assistantItems: { type: 'array', minItems: 0, maxItems: 2, items: entry,
        description: 'Each item must cite at least one assistant-role window; unused slots cannot be borrowed.' },
    } }, 'invalid_input');
}

/** Atomic compiler. Role membership is a citation check, never a semantic endorsement. */
export function compileRoleStratifiedExtraction(prepared, value) {
  const state = trusted(prepared);
  try {
    const proposal = jsonSnapshot(value, 'invalid_model_output', 40_000);
    exactKeys(proposal, ['userItems', 'assistantItems'], 'invalid_model_output');
    denseArray(proposal.userItems, 0, 3);
    denseArray(proposal.assistantItems, 0, 2);
    const items = [];
    for (const [group, role] of [['userItems', 'user'], ['assistantItems', 'assistant']]) {
      const entries = proposal[group];
      const compiled = extractedWindowItems({ items: entries }, state.snapshot, state.catalog);
      for (const [index, item] of compiled.entries()) {
        const sourceIndices = entries[index].sourceIndices;
        if (!sourceIndices.some(sourceIndex => state.catalog.entries[sourceIndex].role === role)) fail('invalid_model_output');
        items.push({ content: item.content, kind: item.kind, confidence: item.confidence, sourceIndices });
      }
    }
    const output = jsonSnapshot({ items }, 'invalid_model_output', 40_000);
    const groups = { userItems: { start: 0, count: proposal.userItems.length },
      assistantItems: { start: proposal.userItems.length, count: proposal.assistantItems.length } };
    return jsonSnapshot({ output, observation: { proposal, groups } }, 'invalid_model_output', 100_000);
  } catch { fail('invalid_model_output'); }
}

function portValue(port, name, required = false) {
  if (!port || typeof port !== 'object' || types.isProxy(port)) fail('invalid_input');
  const descriptor = Object.getOwnPropertyDescriptor(port, name);
  if (!descriptor) { if (required) fail('invalid_input'); return undefined; }
  if (!Object.hasOwn(descriptor, 'value')) fail('invalid_input');
  return descriptor.value;
}

/**
 * One prepared batch, one model invocation, no retries or provider access.
 * countTokens is the host's deterministic local full-wire counter. Classify
 * stays bound to the same injected port and receives the unchanged core call.
 */
export function createRoleStratifiedModel(prepared, port) {
  const state = trusted(prepared);
  const extract = portValue(port, 'extractRoleStratified', true);
  const count = portValue(port, 'countTokens', true);
  const classify = portValue(port, 'classify');
  const contextWindow = portValue(port, 'contextWindow', true);
  if (typeof extract !== 'function' || typeof count !== 'function' ||
      (classify !== undefined && typeof classify !== 'function')) fail('invalid_input');
  const baselineWire = modelRequestText(state.baselineRequest.system, state.baselineRequest.input);
  const replacementWire = modelRequestText(state.request.system, state.request.input);
  let used = false;
  let observation = jsonSnapshot({ actualRequest: null, proposal: null, groups: null, output: null }, 'invalid_input');
  const observe = () => observation;
  const localCount = text => count.call(port, text);

  const model = {
    contextWindow,
    countTokens(text) { return localCount(text === baselineWire ? replacementWire : text); },
    async extract(value) {
      if (used) fail('invalid_input');
      // A stale/mismatched attempt consumes this wrapper too. Never repair it.
      used = true;
      let outerSignal;
      try {
        if (!value || typeof value !== 'object' || types.isProxy(value)) fail('invalid_input');
        const descriptors = Object.getOwnPropertyDescriptors(value);
        if (Reflect.ownKeys(descriptors).some(name => typeof name !== 'string' ||
            !['system', 'input', 'maxOutputTokens', 'signal'].includes(name)) ||
            Object.values(descriptors).some(entry => !entry.enumerable || !Object.hasOwn(entry, 'value'))) fail('invalid_input');
        outerSignal = descriptors.signal?.value;
        if (!(outerSignal instanceof AbortSignal)) fail('invalid_input');
        const actual = jsonSnapshot({ system: descriptors.system?.value, input: descriptors.input?.value,
          maxOutputTokens: descriptors.maxOutputTokens?.value }, 'invalid_input');
        if (JSON.stringify(actual) !== JSON.stringify(state.baselineRequest)) fail('invalid_input');
      } catch { fail('invalid_input'); }

      const abortFailure = () => {
        if (isCoreModelDeadlineSignal(outerSignal)) return new MemoryStoreError('model_timeout');
        const error = new Error('model_cancelled'); error.name = 'AbortError'; return error;
      };
      if (outerSignal.aborted) throw abortFailure();
      // The existing core owns the original capture deadline. Its abort also
      // stops the replacement port, even when a provider ignores cancellation.
      const deadline = { expired: () => outerSignal.aborted && isCoreModelDeadlineSignal(outerSignal),
        remainingMs: () => 30_000 };
      const boundedPort = { contextWindow, countTokens: localCount,
        async extractRoleStratified(request) {
          if (outerSignal.aborted) throw abortFailure();
          const controller = new AbortController();
          let rejectAbort;
          const aborted = new Promise((_, reject) => { rejectAbort = reject; });
          // Also handle an abort during setup before the race is attached.
          aborted.catch(() => {});
          const onOuterAbort = () => { controller.abort(); rejectAbort(abortFailure()); };
          const onInnerAbort = () => { controller.abort(); };
          outerSignal.addEventListener('abort', onOuterAbort, { once: true });
          request.signal.addEventListener('abort', onInnerAbort, { once: true });
          try {
            if (outerSignal.aborted) onOuterAbort();
            if (request.signal.aborted) onInnerAbort();
            if (controller.signal.aborted) throw abortFailure();
            const actualRequest = jsonSnapshot({ system: request.system, input: request.input,
              maxOutputTokens: request.maxOutputTokens }, 'invalid_input');
            observation = jsonSnapshot({ ...observation, actualRequest }, 'invalid_input');
            const returned = await Promise.race([
              Promise.resolve().then(() => {
                if (controller.signal.aborted) throw abortFailure();
                const generated = extract.call(port, Object.freeze({ ...actualRequest, signal: controller.signal }));
                const copyOutput = output => jsonSnapshot(output, 'invalid_model_output', 40_000);
                // Copy synchronous results before promise resolution can probe
                // a model-owned `then` accessor. Native async ports still work.
                return types.isPromise(generated)
                  ? Promise.prototype.then.call(generated, copyOutput) : copyOutput(generated);
              }), aborted,
            ]);
            const proposal = jsonSnapshot(returned, 'invalid_model_output', 40_000);
            observation = jsonSnapshot({ ...observation, proposal }, 'invalid_model_output');
            return proposal;
          } finally {
            outerSignal.removeEventListener('abort', onOuterAbort);
            request.signal.removeEventListener('abort', onInnerAbort);
          }
        } };
      let proposal;
      try {
        proposal = await callModel(boundedPort, 'extractRoleStratified', state.request.system, state.request.input,
          { failureCode: 'extraction_failed', deadline });
      } catch (error) {
        // The enclosing ordinary core call recognizes cancellation by name;
        // keep the inner bounded code while preserving that existing boundary.
        if (error instanceof MemoryStoreError && error.code === 'model_cancelled') error.name = 'AbortError';
        throw error;
      }
      const compiled = compileRoleStratifiedExtraction(prepared, proposal);
      // Both the grouped proposal and the ordinary compiled result have the
      // same core output budget. No side channel or quota borrowing is added.
      const outputText = JSON.stringify(compiled.output);
      let outputTokens;
      try { outputTokens = localCount(outputText); } catch { fail('token_count_unavailable'); }
      if (!Number.isSafeInteger(outputTokens) || outputTokens < 0) fail('token_count_unavailable');
      if (outputText.length > 40_000 || outputTokens > 1024) fail('invalid_model_output');
      if (outerSignal.aborted) throw abortFailure();
      observation = jsonSnapshot({ ...observation, ...compiled.observation, output: compiled.output }, 'invalid_model_output');
      return compiled.output;
    },
    ...(classify ? { classify: request => classify.call(port, request) } : {}),
    observe,
  };
  return Object.freeze(model);
}
