import { createHash } from 'node:crypto';
import { redactSecrets } from '../../plugins/cairn-memory/lib/redact.mjs';

// Source-facing only. Family is report metadata and is not copied into a plan.
export const SOURCE_BUNDLE_VERSION = 'source-bundle-qa24-v1';
export const sourceBundleRoster = Object.freeze(Array.from({ length: 24 }, (_, index) =>
  `BQ${String(index + 1).padStart(2, '0')}`));
export const sourceBundleLimits = Object.freeze({ cases: 24, sessions: 12,
  messages: 1, contentMinUtf16: 40, contentMaxUtf16: 360, questionMaxUtf16: 400,
  windowMaxUtf16: 800, sourceBytes: 262144, traversalNodes: 4096, traversalDepth: 8,
  inputTokens: 6000, providerInputTokens: 7024, rankOutputTokens: 1024,
  answerOutputTokens: 512, physicalRequests: 192, reservationMicroUsd: 5000 });
export const sourceBundleOrders = Object.freeze([
  Object.freeze(['ordinary', 'source-bundle']), Object.freeze(['source-bundle', 'ordinary']),
]);
const FAMILY_CYCLE = ['two-card', 'three-card', 'missing-link', 'scope-time', 'proposal-uncertainty'];
const FAMILIES = Object.freeze([...Array.from({ length: 20 }, (_, i) => FAMILY_CYCLE[i % 5]),
  'two-card', 'three-card', 'two-card', 'three-card']);
const FILE_SHA256 = '90bf9a3e294db114a0a2e264940221d7971a4e41c51af25b43e7453422de4cf9';
const VALUE_SHA256 = '74c3664e31d1d35a74a614345c273faa2c7f1845811030fd0868141c74a44e7c';
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = code => { throw new TypeError(code); };
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

// Inspect descriptors before reading data; do not invoke accessors or JSON hooks.
function snapshot(value, state, depth = 0) {
  if (++state.nodes > sourceBundleLimits.traversalNodes
    || depth > sourceBundleLimits.traversalDepth) fail('source_bundle_limit');
  if (typeof value === 'string') {
    state.bytes += Buffer.byteLength(value);
    if (state.bytes > sourceBundleLimits.sourceBytes) fail('source_bundle_limit');
    return value;
  }
  if (!value || typeof value !== 'object') fail('invalid_source_bundle');
  if (state.ancestors.has(value)) fail('invalid_source_bundle');
  const proto = Object.getPrototypeOf(value);
  const array = Array.isArray(value);
  if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null)
    fail('invalid_source_bundle');
  if (Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON')
    || Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON')) fail('invalid_source_bundle');
  const keys = Reflect.ownKeys(value);
  if (keys.length > sourceBundleLimits.traversalNodes - state.nodes) fail('source_bundle_limit');
  state.ancestors.add(value);
  let result;
  if (array) {
    const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > sourceBundleLimits.traversalNodes
      || keys.length !== length + 1) fail('invalid_source_bundle');
    result = [];
    for (let i = 0; i < length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable)
        fail('invalid_source_bundle');
      result.push(snapshot(descriptor.value, state, depth + 1));
    }
  } else {
    result = Object.create(null);
    for (const key of keys) {
      if (typeof key !== 'string' || ['toJSON', '__proto__', 'constructor', 'prototype'].includes(key))
        fail('invalid_source_bundle');
      state.bytes += Buffer.byteLength(key);
      if (state.bytes > sourceBundleLimits.sourceBytes) fail('source_bundle_limit');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable)
        fail('invalid_source_bundle');
      result[key] = snapshot(descriptor.value, state, depth + 1);
    }
  }
  state.ancestors.delete(value);
  return result;
}
function exact(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== fields.length
    || fields.some(key => !Object.hasOwn(value, key))) fail('invalid_source_bundle');
}
function text(value, min, max) {
  if (typeof value !== 'string' || value.length < min || value.length > max
    || value.trim() !== value || !value.isWellFormed() || /[\p{Cc}\p{Cf}]/u.test(value)
    || redactSecrets(value) !== value) fail('invalid_source_bundle_text');
}
function day(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) fail('invalid_source_bundle_date');
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number(value.slice(0, 4)) < 1900 || !Number.isFinite(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== value) fail('invalid_source_bundle_date');
}

export function validateSourceBundleCases(input) {
  let cases;
  try { cases = snapshot(input, { nodes: 0, bytes: 0, ancestors: new WeakSet() }); }
  catch (error) { if (error instanceof TypeError) throw error; fail('invalid_source_bundle'); }
  if (!Array.isArray(cases) || cases.length !== 24) fail('invalid_source_bundle_count');
  const sessionsSeen = new Set();
  for (const [ordinal, c] of cases.entries()) {
    exact(c, ['id', 'family', 'question', 'sessions']);
    if (c.id !== sourceBundleRoster[ordinal] || c.family !== FAMILIES[ordinal]) fail('invalid_source_bundle_roster');
    exact(c.question, ['text', 'date']);
    text(c.question.text, 1, sourceBundleLimits.questionMaxUtf16); day(c.question.date);
    if (!Array.isArray(c.sessions) || c.sessions.length !== 12) fail('invalid_source_bundle_count');
    let previous = '';
    for (const [index, s] of c.sessions.entries()) {
      exact(s, ['id', 'eventTime', 'messages']);
      if (s.id !== `${c.id}-S${String(index + 1).padStart(2, '0')}`
        || sessionsSeen.has(s.id)) fail('invalid_source_bundle_session');
      sessionsSeen.add(s.id);
      if (typeof s.eventTime !== 'string'
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/u.test(s.eventTime)) fail('invalid_source_bundle_date');
      day(s.eventTime.slice(0, 10));
      const event = new Date(s.eventTime);
      if (!Number.isFinite(event.getTime()) || event.toISOString() !== s.eventTime
        || s.eventTime <= previous || s.eventTime.slice(0, 10) > c.question.date) fail('invalid_source_bundle_date');
      previous = s.eventTime;
      if (!Array.isArray(s.messages) || s.messages.length !== 1) fail('invalid_source_bundle_count');
      exact(s.messages[0], ['role', 'content']);
      if (!['user', 'assistant'].includes(s.messages[0].role)) fail('invalid_source_bundle_role');
      text(s.messages[0].content, sourceBundleLimits.contentMinUtf16, sourceBundleLimits.contentMaxUtf16);
    }
  }
  return freeze(cases);
}

export async function loadSourceBundleCases(file = new URL('./source-bundle-cases.json', import.meta.url)) {
  const { open } = await import('node:fs/promises');
  const handle = await open(file, 'r');
  let bytes;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > sourceBundleLimits.sourceBytes) fail('source_bundle_limit');
    // Read one bounded buffer even if a supplied file grows after stat.
    const buffer = Buffer.alloc(sourceBundleLimits.sourceBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > sourceBundleLimits.sourceBytes) fail('source_bundle_limit');
    bytes = buffer.subarray(0, bytesRead);
  } finally { await handle.close(); }
  if (hash(bytes) !== FILE_SHA256) fail('source_bundle_hash_drift');
  const cases = validateSourceBundleCases(JSON.parse(bytes.toString('utf8')));
  if (hash(JSON.stringify(cases)) !== VALUE_SHA256) fail('source_bundle_hash_drift');
  return cases;
}

const dateLabel = iso => {
  const d = new Date(iso);
  return `${d.toISOString().slice(0, 10).replaceAll('-', '/')} (${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]}) ${d.toISOString().slice(11, 16)}`;
};

export async function prepareSourceBundleCase(input, caseId) {
  const cases = validateSourceBundleCases(input);
  if (hash(JSON.stringify(cases)) !== VALUE_SHA256) fail('source_bundle_hash_drift');
  const source = cases.find(c => c.id === caseId);
  if (!source) fail('invalid_source_bundle_case');
  // Pure preparation imports only built-ins, redaction, capture validation and
  // source-window utilities; no core store, SQLite, runner or provider adapter.
  const { prepareMixedSourceCase } = await import('../longmemeval/mixed-source.mjs');
  const questionId = `lme-case-${hash(`${SOURCE_BUNDLE_VERSION}:${source.id}`)}`;
  const history = { question_id: questionId, sessions: source.sessions.map((s, index) => ({
    session_index: index, session_id: `lme-session-${hash(s.id)}`, date: dateLabel(s.eventTime),
    turns: [{ turn_id: `lme-turn-${hash(`${s.id}:0`)}`, ...s.messages[0] }],
  })) };
  const plan = prepareMixedSourceCase({ history,
    question: { question_id: questionId, text: source.question.text,
      date: dateLabel(`${source.question.date}T23:59:00.000Z`) },
    namespace: { ownerId: 'source-bundle-offline-owner', scope: 'project', projectId: questionId },
  }, 'indexed-evidence-v1');
  if (plan.counts.windows !== 12 || plan.counts.renderedTurns !== 12
    || plan.counts.excludedFutureSessions !== 0 || plan.cairnPlan.batches.length !== 12
    || plan.cairnPlan.batches.some(b => b.captureInput.messages.length !== 1
      || b.indexedWindows.length !== 1 || b.indexedWindows[0].content.length > 800)) fail('source_bundle_preparation_mismatch');
  const question = { text: plan.originalQuestion.text, date: plan.canonicalQuestionDate };
  return freeze({ version: SOURCE_BUNDLE_VERSION, id: source.id, plan, question,
    sourceProvenance: source.sessions.map((s, index) => ({ originalSessionId: s.id,
      eventTime: s.eventTime, renderedSessionId: history.sessions[index].session_id,
      originalMessageIndex: 0, role: s.messages[0].role })),
  });
}
