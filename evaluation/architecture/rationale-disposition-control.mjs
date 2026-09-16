import { readFileSync } from 'node:fs';
import { schemasFor } from '../../adapters/openai/schemas.mjs';

const sourceOnlySystem = readFileSync(new URL('../../core/prompts/relate-rationale.md', import.meta.url), 'utf8');
const controlGuidance = readFileSync(new URL('./prompts/rationale-disposition-control.md', import.meta.url), 'utf8');
const controlSystem = `${sourceOnlySystem}\n${controlGuidance}`;
const invalid = () => { throw new Error('invalid_disposition_control_request'); };

function exactRecord(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).length !== fields.length) invalid();
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) invalid();
  }
}

function plainRows(value, maximum) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      value.length > maximum || Reflect.ownKeys(value).length !== value.length + 1) invalid();
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) invalid();
  }
  return value;
}

function frozenSetup(oldEdges) {
  return Object.freeze(plainRows(oldEdges, 10).map((edge, index) => {
    exactRecord(edge, ['index', 'from', 'to', 'relation', 'fromReceipt', 'toReceipt', 'interpretationStatus']);
    if (edge.index !== index || edge.interpretationStatus !== 'unverified' ||
        !['supports-decision', 'challenges-premise'].includes(edge.relation) ||
        !['from', 'to', 'fromReceipt', 'toReceipt'].every(key =>
          Number.isSafeInteger(edge[key]) && edge[key] >= 0)) invalid();
    return Object.freeze({ index, from: edge.from, to: edge.to, relation: edge.relation,
      fromReceipt: edge.fromReceipt, toReceipt: edge.toReceipt, interpretationStatus: 'unverified' });
  }));
}

function expanded(input, oldEdges) {
  exactRecord(input, ['memories']);
  const candidate = { memories: input.memories, oldEdges };
  // This shared dynamic schema validator rejects custom/getter/sparse source
  // inputs and checks every old tuple against its actual source receipts.
  try { schemasFor('reviewRationaleDispositions', candidate); } catch { invalid(); }
  const memories = input.memories.map(memory => Object.freeze({ index: memory.index,
    receipts: Object.freeze(memory.receipts.map(receipt => Object.freeze({ index: receipt.index,
      role: receipt.role, excerpt: receipt.excerpt }))) }));
  return Object.freeze({ memories: Object.freeze(memories), oldEdges });
}

/** One-shot evaluation control; never commits or acquires provider authority. */
export function createRationaleDispositionControl(model, oldEdges) {
  const setup = frozenSetup(oldEdges);
  if (!model || typeof model !== 'object') invalid();
  const relate = model.relate;
  const counter = model.countTokens;
  const contextWindow = model.contextWindow;
  if (typeof relate !== 'function' || typeof counter !== 'function' ||
      !Number.isSafeInteger(contextWindow) || contextWindow < 8192) invalid();
  const boundRelate = relate.bind(model), boundCounter = counter.bind(model);
  let prepared = null, consumed = false;
  const countTokens = text => {
    if (typeof text !== 'string') throw new Error('token_count_unavailable');
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    if (parsed && typeof parsed === 'object' &&
        ['system', 'input', 'maxOutputTokens'].some(key => Object.hasOwn(parsed, key))) {
      if (consumed || prepared !== null) invalid();
      exactRecord(parsed, ['system', 'input', 'maxOutputTokens']);
      if (parsed.system !== sourceOnlySystem || parsed.maxOutputTokens !== 1024) invalid();
      const input = expanded(parsed.input, setup);
      prepared = JSON.stringify({ system: controlSystem, input, maxOutputTokens: 1024 });
      let tokens;
      try { tokens = boundCounter(prepared); } catch (error) { prepared = null; throw error; }
      if (!Number.isSafeInteger(tokens) || tokens < 0) {
        prepared = null;
        throw new Error('token_count_unavailable');
      }
      // Core rejects this count; also prevent a direct relate call from
      // bypassing that core-side limit after a caller counted an oversize input.
      if (tokens > 6000) prepared = null;
      return tokens;
    }
    const tokens = boundCounter(text);
    if (!Number.isSafeInteger(tokens) || tokens < 0) throw new Error('token_count_unavailable');
    return tokens;
  };
  const review = async request => {
    exactRecord(request, ['system', 'input', 'maxOutputTokens', 'signal']);
    if (request.system !== sourceOnlySystem || request.maxOutputTokens !== 1024 ||
        !(request.signal instanceof AbortSignal) || consumed || prepared === null) invalid();
    const input = expanded(request.input, setup);
    if (JSON.stringify({ system: controlSystem, input, maxOutputTokens: 1024 }) !== prepared) invalid();
    consumed = true; prepared = null;
    const signal = request.signal;
    if (signal.aborted) throw new DOMException('Control request cancelled', 'AbortError');
    const result = await boundRelate(Object.freeze({ system: controlSystem, input,
      maxOutputTokens: 1024, signal }));
    if (signal.aborted) throw new DOMException('Control request cancelled', 'AbortError');
    return result;
  };
  return Object.freeze({ contextWindow, countTokens, relate: review });
}
