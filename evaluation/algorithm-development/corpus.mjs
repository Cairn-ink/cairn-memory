import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// Development fixtures only. Model-facing loading never reads rubric.json.
export const CORPUS_VERSION = 'algorithm-development-v1';
export const SPAN_OFFSET_UNIT = 'utf16-code-unit';
export const SOURCE_CHARACTER_LIMIT = 12_000;

const families = [
  ['detail-retention', ['nonopening-number', 'middle-condition', 'tail-exception', 'attributed-assistant-instruction']],
  ['lexical-paraphrase-cjk', ['exact-lexical', 'paraphrase-without-shared-keyword', 'chinese-query', 'mixed-language-alias']],
  ['multi-session-links', ['two-session-dependency', 'three-session-chain', 'distractor-link', 'missing-link-abstention']],
  ['event-time-late-import', ['event-versus-ingestion-time', 'late-old-import', 'relative-date', 'overlapping-scopes']],
  ['proposal-adoption-premise-update', ['unadopted-proposal', 'explicit-adoption', 'premise-changed-reconfirm', 'reaffirmation-without-replacement']],
  ['unknown-conflicting-evidence', ['absent-source', 'unresolved-conflict', 'partial-support', 'quoted-third-party-claim']],
];

function fail(path, message) {
  throw new TypeError(`${path}: ${message}`);
}

function object(value, path, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(path, 'expected a plain object');
  const actual = Object.keys(value).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...keys].sort())) fail(path, `expected only keys ${keys.join(', ')}`);
}

function string(value, path) {
  if (typeof value !== 'string' || !value.trim()) fail(path, 'expected a nonempty string');
}

function array(value, path, min = 0, max = Infinity) {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(path, `expected an array with ${min}–${max} entries`);
  for (let index = 0; index < value.length; index++) if (!Object.hasOwn(value, index)) fail(path, 'sparse arrays are not allowed');
}

function strings(value, path, min = 0) {
  array(value, path, min);
  value.forEach((item, index) => string(item, `${path}[${index}]`));
}

function date(value, path, event = false) {
  const format = event ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/ : /^\d{4}-\d{2}-\d{2}$/;
  if (typeof value !== 'string' || !format.test(value)) fail(path, 'expected an ISO UTC date');
  const parsed = new Date(event ? value : `${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || (event ? parsed.toISOString().replace('.000Z', 'Z') : parsed.toISOString().slice(0, 10)) !== value) fail(path, 'invalid calendar date');
}

function slot(index) {
  return { id: `D${String(index + 1).padStart(2, '0')}`, family: families[Math.floor(index / 4)][0], variant: families[Math.floor(index / 4)][1][index % 4] };
}

export const DEVELOPMENT_ROSTER = deepFreeze(Array.from({ length: 24 }, (_, index) => slot(index)));

/** Reject evaluator metadata at every level of the model-facing fixture. */
export function validateModelInputs(modelInputs) {
  array(modelInputs, 'modelInputs', 24, 24);
  const sessionIds = new Set();
  modelInputs.forEach((item, index) => {
    const path = `modelInputs[${index}]`;
    object(item, path, ['id', 'family', 'question', 'sessions']);
    const expected = slot(index);
    if (item.id !== expected.id || item.family !== expected.family) fail(path, `expected ${expected.id} in ${expected.family}`);
    object(item.question, `${path}.question`, ['text', 'date']);
    string(item.question.text, `${path}.question.text`);
    date(item.question.date, `${path}.question.date`);
    array(item.sessions, `${path}.sessions`, 1, 3);
    let characters = 0;
    let messageCount = 0;
    item.sessions.forEach((session, sessionIndex) => {
      const sessionPath = `${path}.sessions[${sessionIndex}]`;
      object(session, sessionPath, ['id', 'eventTime', 'messages']);
      string(session.id, `${sessionPath}.id`);
      // IDs need only be unique within a case; each case uses its own store.
      const sessionKey = `${item.id}\0${session.id}`;
      if (sessionIds.has(sessionKey)) fail(sessionPath, 'duplicate session id in case');
      sessionIds.add(sessionKey);
      date(session.eventTime, `${sessionPath}.eventTime`, true);
      array(session.messages, `${sessionPath}.messages`, 1, 6);
      messageCount += session.messages.length;
      session.messages.forEach((message, messageIndex) => {
        const messagePath = `${sessionPath}.messages[${messageIndex}]`;
        object(message, messagePath, ['role', 'content']);
        if (!['user', 'assistant'].includes(message.role)) fail(messagePath, 'role must be user or assistant');
        string(message.content, `${messagePath}.content`);
        characters += [...message.content].length;
      });
    });
    if (messageCount < 3 || messageCount > 8) fail(path, 'expected 3–8 conversation messages per case');
    if (characters > SOURCE_CHARACTER_LIMIT) fail(path, `source exceeds ${SOURCE_CHARACTER_LIMIT} Unicode characters`);
  });
  return modelInputs;
}

/** Anchors are evaluator-only exact slices, never capture or recall instructions. */
export function validateEvaluatorRubric(evaluatorRubric, modelInputs) {
  validateModelInputs(modelInputs);
  object(evaluatorRubric, 'evaluatorRubric', ['version', 'spanOffsetUnit', 'cases']);
  if (evaluatorRubric.version !== CORPUS_VERSION) fail('evaluatorRubric.version', `expected ${CORPUS_VERSION}`);
  if (evaluatorRubric.spanOffsetUnit !== SPAN_OFFSET_UNIT) fail('evaluatorRubric.spanOffsetUnit', `expected ${SPAN_OFFSET_UNIT}`);
  object(evaluatorRubric.cases, 'evaluatorRubric.cases', modelInputs.map(item => item.id));
  modelInputs.forEach((item, index) => {
    const path = `evaluatorRubric.cases.${item.id}`;
    const rule = evaluatorRubric.cases[item.id];
    object(rule, path, ['variant', 'requiredPropositions', 'acceptableQualifications', 'anchors', 'requiredMultiSourceSets', 'unsupportedClaims', 'staleUseCriteria', 'severeErrors']);
    if (rule.variant !== slot(index).variant) fail(`${path}.variant`, 'variant does not match the frozen roster');
    strings(rule.requiredPropositions, `${path}.requiredPropositions`, 1);
    for (const field of ['acceptableQualifications', 'unsupportedClaims', 'staleUseCriteria', 'severeErrors']) strings(rule[field], `${path}.${field}`);
    array(rule.anchors, `${path}.anchors`);
    const anchorKeys = new Set();
    rule.anchors.forEach((anchor, anchorIndex) => {
      const anchorPath = `${path}.anchors[${anchorIndex}]`;
      object(anchor, anchorPath, ['sessionId', 'messageIndex', 'start', 'end', 'text']);
      string(anchor.sessionId, `${anchorPath}.sessionId`);
      string(anchor.text, `${anchorPath}.text`);
      const session = item.sessions.find(candidate => candidate.id === anchor.sessionId);
      if (!session) fail(anchorPath, 'unknown session id');
      if (!Number.isSafeInteger(anchor.messageIndex) || anchor.messageIndex < 0 || anchor.messageIndex >= session.messages.length) fail(anchorPath, 'invalid message index');
      const content = session.messages[anchor.messageIndex].content;
      if (!Number.isSafeInteger(anchor.start) || !Number.isSafeInteger(anchor.end) || anchor.start < 0 || anchor.end <= anchor.start || anchor.end > content.length) fail(anchorPath, 'invalid span bounds');
      if (content.slice(anchor.start, anchor.end) !== anchor.text) fail(anchorPath, 'span text does not match source');
      // Neither boundary may bisect a Unicode surrogate pair.
      for (const boundary of [anchor.start, anchor.end]) {
        if (boundary > 0 && boundary < content.length && /[\uD800-\uDBFF]/.test(content[boundary - 1]) && /[\uDC00-\uDFFF]/.test(content[boundary])) fail(anchorPath, 'span bisects a Unicode character');
      }
      const key = JSON.stringify([anchor.sessionId, anchor.messageIndex, anchor.start, anchor.end]);
      if (anchorKeys.has(key)) fail(anchorPath, 'duplicate source span');
      anchorKeys.add(key);
    });
    array(rule.requiredMultiSourceSets, `${path}.requiredMultiSourceSets`);
    rule.requiredMultiSourceSets.forEach((set, setIndex) => {
      const setPath = `${path}.requiredMultiSourceSets[${setIndex}]`;
      array(set, setPath, 2);
      if (new Set(set).size !== set.length) fail(setPath, 'duplicate anchor reference');
      set.forEach(reference => {
        if (!Number.isSafeInteger(reference) || reference < 0 || reference >= rule.anchors.length) fail(setPath, 'invalid anchor reference');
      });
      const sources = new Set(set.map(reference => JSON.stringify([rule.anchors[reference].sessionId, rule.anchors[reference].messageIndex])));
      if (sources.size < 2) fail(setPath, 'requires at least two distinct source messages');
    });
  });
  return evaluatorRubric;
}

function deepFreeze(value) {
  for (const child of Object.values(value)) if (child && typeof child === 'object') deepFreeze(child);
  return Object.freeze(value);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

export function hashCanonicalValue(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export function freezeDevelopmentCorpus({ modelInputs, evaluatorRubric }) {
  validateEvaluatorRubric(evaluatorRubric, modelInputs);
  const inputs = structuredClone(modelInputs);
  const rubric = structuredClone(evaluatorRubric);
  const hashes = { modelInputs: hashCanonicalValue(inputs), evaluatorRubric: hashCanonicalValue(rubric) };
  hashes.freeze = hashCanonicalValue({ version: CORPUS_VERSION, spanOffsetUnit: SPAN_OFFSET_UNIT, ...hashes });
  return deepFreeze({ version: CORPUS_VERSION, modelInputs: inputs, evaluatorRubric: rubric, hashes });
}

export async function loadModelInputs({ casesPath = new URL('./cases.json', import.meta.url) } = {}) {
  const modelInputs = JSON.parse(await readFile(casesPath, 'utf8'));
  validateModelInputs(modelInputs);
  return deepFreeze(modelInputs);
}

export async function loadEvaluatorRubric(modelInputs, { rubricPath = new URL('./rubric.json', import.meta.url) } = {}) {
  const evaluatorRubric = JSON.parse(await readFile(rubricPath, 'utf8'));
  validateEvaluatorRubric(evaluatorRubric, modelInputs);
  return deepFreeze(evaluatorRubric);
}

// Offline review/freezing only. Runtime runners should use loadModelInputs.
export async function loadDevelopmentFreeze(options = {}) {
  const modelInputs = await loadModelInputs(options);
  const evaluatorRubric = await loadEvaluatorRubric(modelInputs, options);
  return freezeDevelopmentCorpus({ modelInputs, evaluatorRubric });
}
