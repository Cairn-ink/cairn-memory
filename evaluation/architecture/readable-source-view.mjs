import { isDeepStrictEqual, types } from 'node:util';
import { countTokens as measureTokens } from '../../core/model-budget.mjs';
import { fail } from '../../core/validation.mjs';
import { freeze } from '../longmemeval/mixed-validation.mjs';
import { packMixedAnswer } from '../longmemeval/mixed-answer.mjs';
import { packCardPlanAnswer } from './card-plan-evidence.mjs';

const header = 'card-plan-readable-source-v1\n';
const format = 'card-plan-flat-source-evidence-v1';
const framingError = 'invalid_readable_source_unit';
const incomplete = 'card_plan_answer_incomplete';
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 200 && value.isWellFormed();
const integer = (value, minimum, maximum) => Number.isSafeInteger(value)
  && !Object.is(value, -0) && value >= minimum && value <= maximum;

function optionsData(value) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('invalid_card_plan_evidence');
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = ['evidence', 'countTokens'];
  if (Reflect.ownKeys(descriptors).length !== keys.length || keys.some(key => !descriptors[key]
    || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value'))) fail('invalid_card_plan_evidence');
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}

/** Evaluation-only strict DATA decoder; this never grants an assembly capability. */
export function decodeReadableSourceUnit(text) {
  if (typeof text !== 'string' || !text.isWellFormed() || text.includes('\0')
    || Buffer.byteLength(text, 'utf8') > 1024 * 1024 || !text.startsWith(header)) fail(framingError);
  let cursor = header.length;
  const metadata = keys => {
    const end = text.indexOf('\n', cursor);
    if (end < cursor || end - cursor > 16384) fail(framingError);
    const raw = text.slice(cursor, end); cursor = end + 1;
    let value;
    try { value = JSON.parse(raw); } catch { fail(framingError); }
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))
      || raw !== JSON.stringify(Object.fromEntries(keys.map(key => [key, value[key]])))) fail(framingError);
    return value;
  };
  const card = metadata(['format', 'memoryId', 'revision', 'sourceCount']);
  if (card.format !== format || !id(card.memoryId) || !integer(card.revision, 1, Number.MAX_SAFE_INTEGER)
    || !integer(card.sourceCount, 1, 100)) fail(framingError);
  const sources = [], seen = new Set();
  for (let index = 0; index < card.sourceCount; index++) {
    const source = metadata(['receiptId', 'recordedRole', 'textLength']);
    if (!id(source.receiptId) || seen.has(source.receiptId) || !['user', 'assistant'].includes(source.recordedRole)
      || !integer(source.textLength, 1, 1024 * 1024)) fail(framingError);
    seen.add(source.receiptId);
    // Length is JavaScript UTF-16 code units, never bytes/tokens/code points.
    const end = cursor + source.textLength, body = text.slice(cursor, end);
    if (end >= text.length || text[end] !== '\n' || !body.isWellFormed()) fail(framingError);
    cursor = end + 1;
    sources.push({ receiptId: source.receiptId, recordedRole: source.recordedRole, text: body });
  }
  if (cursor !== text.length) fail(framingError);
  return freeze({ format: card.format, memoryId: card.memoryId, revision: card.revision, sources });
}

function render(card) {
  return header + JSON.stringify({ format: card.format, memoryId: card.memoryId,
    revision: card.revision, sourceCount: card.sources.length }) + '\n'
    + card.sources.map(source => JSON.stringify({ receiptId: source.receiptId, recordedRole: source.recordedRole,
      textLength: source.text.length }) + '\n' + source.text + '\n').join('');
}

/** Opt-in lossless source presentation; no changed prompt, selection or budget. */
export function packReadableCardPlanAnswer(options) {
  const { evidence, countTokens } = optionsData(options);
  // Unchanged ownership, authoritative whole-source and original-wire fit checks first.
  const flat = packCardPlanAnswer({ evidence, countTokens });
  const units = evidence.units.map(unit => ({ text: render(JSON.parse(unit.text)) }));
  for (const [index, unit] of units.entries()) {
    if (JSON.stringify(decodeReadableSourceUnit(unit.text)) !== evidence.units[index].text) fail(incomplete);
  }
  const packed = units.length ? packMixedAnswer({ question: evidence.question, units, countTokens }) : flat;
  const exactCount = measureTokens({ countTokens }, JSON.stringify(packed.request));
  if (packed.inputTokens !== exactCount || exactCount > 6000 || packed.omittedIndices.length
    || packed.duplicateIndices.length || !isDeepStrictEqual(packed.selectedIndices, units.map((_, index) => index))
    || !isDeepStrictEqual(JSON.parse(packed.request.messages[1].content).evidence, units)) fail(incomplete);
  return freeze({ units, packed, projection: 'card-plan-readable-source-v1', semanticSufficiency: 'unassessed' });
}
