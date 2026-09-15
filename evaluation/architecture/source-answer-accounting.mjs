import { denseArray, fail, identifier, object } from '../../core/validation.mjs';
import { countTokens as countedTokens } from '../../core/model-budget.mjs';
import { redactSecrets } from '../../plugins/cairn-memory/lib/redact.mjs';
import { SOURCE_ANSWER_INSTRUCTION } from '../live/installed-source-answer-delivery.mjs';

const system = `${SOURCE_ANSWER_INSTRUCTION}
Return one JSON answer record, not another generation or a relationship graph.
Use exactly these required keys: choice, commitment, scope, reasons, unknown, answer.
choice, commitment and scope are each a claim or null. A claim has exactly
{"text":"model-proposed interpretation","sourceIds":["input-id"]}.
Each claim cites one to four distinct supplied source IDs; text is at most 400 UTF-16 units.
reasons contains at most eight objects with exactly original, later and current.
original is a claim; later is an array of zero to four separately cited update or
reaffirmation claims; current is a claim or null. Separate different reasons.
unknown is an array of at most six distinct nonblank descriptions, each at most
400 UTF-16 units, of requested information not established. answer is a nonblank
concise answer in the question's language, at most 4000 UTF-16 units.
Null means unresolved, not disproved or universally applicable. Empty later means
no update represented, not proof no update exists. Do not strengthen commitment
because a reason survives, or infer a replacement decision because a reason fails.
Preserve actors, enclosing negation, conditions and planned versus completed timing.
An assistant suggestion is not adoption or permission. Missing approval establishes
neither an approver nor that approval occurred. Source identity does not establish
truth, entailment or execution authority. Keep all interpretations unassessed.`;

function exact(value, fields) {
  object(value, fields);
  if (fields.some(field => !Object.hasOwn(value, field))) fail('invalid_input');
}

function text(value, maximum) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum ||
      !value.isWellFormed() || value.includes('\0') || redactSecrets(value) !== value) fail('invalid_input');
  return value;
}

function parse(json, maximumBytes) {
  if (typeof json !== 'string' || !json.isWellFormed() || Buffer.byteLength(json, 'utf8') > maximumBytes) fail('invalid_input');
  return JSON.parse(json);
}

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function claim(value, sourceIds, nullable = false) {
  if (nullable && value === null) return;
  exact(value, ['text', 'sourceIds']);
  text(value.text, 400);
  const seen = new Set();
  for (const id of denseArray(value.sourceIds, 1, 4)) {
    identifier(id);
    if (!sourceIds.has(id) || seen.has(id)) fail('invalid_input');
    seen.add(id);
  }
}

/** Pure evaluation compiler: source binding is not semantic validation. */
export function prepareSourceAnswerAccounting(options) {
  let input, counter;
  const sourceIds = new Set();
  try {
    // Do not invoke accessors on the configuration shell before reaching the
    // string-only data boundary. The counter receives strings, never authority.
    if (!options || ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
        Reflect.ownKeys(options).length !== 2) fail('invalid_input');
    const values = ['inputJson', 'countTokens'].map(key => {
      const descriptor = Object.getOwnPropertyDescriptor(options, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) fail('invalid_input');
      return descriptor.value;
    });
    if (typeof values[1] !== 'function') fail('invalid_input');
    counter = Object.freeze({ countTokens: values[1] });
    input = parse(values[0], 24_000);
    exact(input, ['question', 'sources']);
    text(input.question, 4000);
    for (const source of denseArray(input.sources, 0, 24)) {
      exact(source, ['id', 'role', 'content']);
      identifier(source.id);
      text(source.id, 200);
      if (sourceIds.has(source.id) || !['user', 'assistant'].includes(source.role)) fail('invalid_input');
      sourceIds.add(source.id);
      text(source.content, 800);
    }
    freeze(input);
    if (countedTokens(counter, system + '\n' + JSON.stringify(input)) > 6000) fail('invalid_input');
  } catch { fail('invalid_input'); }

  return Object.freeze({ system, input, maxOutputTokens: 1024, compile(outputJson) {
    try {
      const record = parse(outputJson, 16_000);
      exact(record, ['choice', 'commitment', 'scope', 'reasons', 'unknown', 'answer']);
      for (const field of ['choice', 'commitment', 'scope']) claim(record[field], sourceIds, true);
      for (const reason of denseArray(record.reasons, 0, 8)) {
        exact(reason, ['original', 'later', 'current']);
        claim(reason.original, sourceIds);
        for (const later of denseArray(reason.later, 0, 4)) claim(later, sourceIds);
        claim(reason.current, sourceIds, true);
      }
      const unknown = denseArray(record.unknown, 0, 6);
      unknown.forEach(value => text(value, 400));
      if (new Set(unknown).size !== unknown.length) fail('invalid_input');
      text(record.answer, 4000);
      if (countedTokens(counter, outputJson) > 1024) fail('invalid_input');
      return freeze({ record, sources: input.sources, interpretationStatus: 'model-proposed',
        semanticStatus: 'unassessed', sourceSelectionCoverage: 'unassessed', executionAuthority: 'none' });
    } catch { fail('invalid_model_output'); }
  } });
}
