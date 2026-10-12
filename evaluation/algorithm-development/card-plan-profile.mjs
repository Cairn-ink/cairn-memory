import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { redactSecrets } from '../../plugins/cairn-memory/lib/redact.mjs';

// Family and evaluator IDs remain external to model-facing preparation.
export const CARD_PLAN_QA_VERSION = 'card-plan-qa24-v1';
export const cardPlanQaRoster = Object.freeze(Array.from({ length: 24 }, (_, i) =>
  `CQ${String(i + 1).padStart(2, '0')}`));
export const cardPlanQaLimits = Object.freeze({ cases: 24, sessions: 12, messages: 1,
  contentMinUtf16: 40, contentMaxUtf16: 360, questionMaxUtf16: 400,
  windowMaxUtf16: 800, sourceBytes: 262144, traversalNodes: 4096, traversalDepth: 8,
  inputTokens: 6000, providerInputTokens: 7024, rankOutputTokens: 1024,
  answerOutputTokens: 512 });
const FAMILIES = Object.freeze(['prerequisite-chain', 'evolving-decision',
  'scope-exception', 'proposal-quotation', 'entity-link', 'compositional-set']);
const FILE_SHA256 = '9a426a536efd97c8b61a7aed9890a399f7e6f8cb72758cc2c1fbc2c78605a48f';
const VALUE_SHA256 = '09ecd9710ea980d8ac228ad55858e4a757de4dc006eb8451a30707142b102cb5';
const sha = value => createHash('sha256').update(value).digest('hex');
const fail = code => { throw new TypeError(code); };
const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
};

// Reject proxies before reflection; never evaluate accessors or JSON hooks.
function snapshot(value, state, depth = 0) {
  if (++state.nodes > cardPlanQaLimits.traversalNodes
    || depth > cardPlanQaLimits.traversalDepth) fail('card_plan_limit');
  if (typeof value === 'string') {
    state.bytes += Buffer.byteLength(value);
    if (state.bytes > cardPlanQaLimits.sourceBytes) fail('card_plan_limit');
    return value;
  }
  if (!value || typeof value !== 'object' || types.isProxy(value)
    || state.ancestors.has(value)) fail('invalid_card_plan');
  if (Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON')
    || Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON')) fail('invalid_card_plan');
  const array = Array.isArray(value), proto = Object.getPrototypeOf(value);
  if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null)
    fail('invalid_card_plan');
  const keys = Reflect.ownKeys(value);
  if (keys.length > cardPlanQaLimits.traversalNodes - state.nodes) fail('card_plan_limit');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  state.ancestors.add(value);
  let result;
  if (array) {
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || length < 0
      || length > cardPlanQaLimits.traversalNodes || keys.length !== length + 1)
      fail('invalid_card_plan');
    result = [];
    for (let i = 0; i < length; i++) {
      const d = descriptors[String(i)];
      if (!d || !Object.hasOwn(d, 'value') || !d.enumerable) fail('invalid_card_plan');
      result.push(snapshot(d.value, state, depth + 1));
    }
  } else {
    result = Object.create(null);
    for (const key of keys) {
      if (typeof key !== 'string'
        || ['toJSON', '__proto__', 'constructor', 'prototype'].includes(key)) fail('invalid_card_plan');
      state.bytes += Buffer.byteLength(key);
      if (state.bytes > cardPlanQaLimits.sourceBytes) fail('card_plan_limit');
      const d = descriptors[key];
      if (!d || !Object.hasOwn(d, 'value') || !d.enumerable) fail('invalid_card_plan');
      result[key] = snapshot(d.value, state, depth + 1);
    }
  }
  state.ancestors.delete(value);
  return result;
}
function exact(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== fields.length
    || fields.some(key => !Object.hasOwn(value, key))) fail('invalid_card_plan');
}
function text(value, min, max) {
  if (typeof value !== 'string' || value.length < min || value.length > max
    || value.trim() !== value || !value.isWellFormed() || /[\p{Cc}\p{Cf}]/u.test(value)
    || redactSecrets(value) !== value) fail('invalid_card_plan_text');
}
function day(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) fail('invalid_card_plan_date');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number(value.slice(0, 4)) < 1900 || !Number.isFinite(date.getTime())
    || date.toISOString().slice(0, 10) !== value) fail('invalid_card_plan_date');
}

export function validateCardPlanQaCases(input) {
  const cases = snapshot(input, { nodes: 0, bytes: 0, ancestors: new WeakSet() });
  if (!Array.isArray(cases) || cases.length !== cardPlanQaLimits.cases) fail('invalid_card_plan_count');
  for (const [ordinal, c] of cases.entries()) {
    exact(c, ['id', 'family', 'question', 'sessions']);
    if (c.id !== cardPlanQaRoster[ordinal] || c.family !== FAMILIES[ordinal % 6])
      fail('invalid_card_plan_roster');
    exact(c.question, ['text', 'date']);
    text(c.question.text, 1, cardPlanQaLimits.questionMaxUtf16); day(c.question.date);
    if (!Array.isArray(c.sessions) || c.sessions.length !== cardPlanQaLimits.sessions)
      fail('invalid_card_plan_count');
    let previous = '';
    for (const [index, s] of c.sessions.entries()) {
      exact(s, ['id', 'eventTime', 'messages']);
      if (s.id !== `${c.id}-S${String(index + 1).padStart(2, '0')}`) fail('invalid_card_plan_session');
      if (typeof s.eventTime !== 'string'
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/u.test(s.eventTime))
        fail('invalid_card_plan_date');
      day(s.eventTime.slice(0, 10));
      const time = new Date(s.eventTime);
      if (!Number.isFinite(time.getTime()) || time.toISOString() !== s.eventTime
        || s.eventTime <= previous || s.eventTime.slice(0, 10) > c.question.date)
        fail('invalid_card_plan_date');
      previous = s.eventTime;
      if (!Array.isArray(s.messages) || s.messages.length !== cardPlanQaLimits.messages)
        fail('invalid_card_plan_count');
      exact(s.messages[0], ['role', 'content']);
      if (!['user', 'assistant'].includes(s.messages[0].role)) fail('invalid_card_plan_role');
      text(s.messages[0].content, cardPlanQaLimits.contentMinUtf16, cardPlanQaLimits.contentMaxUtf16);
    }
  }
  return freeze(cases);
}

export async function loadCardPlanQaCases(file = new URL('./card-plan-cases.json', import.meta.url)) {
  const { open } = await import('node:fs/promises');
  const handle = await open(file, 'r');
  let bytes;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > cardPlanQaLimits.sourceBytes) fail('card_plan_limit');
    const buffer = Buffer.alloc(cardPlanQaLimits.sourceBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > cardPlanQaLimits.sourceBytes) fail('card_plan_limit');
    bytes = buffer.subarray(0, bytesRead);
  } finally { await handle.close(); }
  if (sha(bytes) !== FILE_SHA256) fail('card_plan_hash_drift');
  const cases = validateCardPlanQaCases(JSON.parse(bytes.toString('utf8')));
  if (sha(JSON.stringify(cases)) !== VALUE_SHA256) fail('card_plan_hash_drift');
  return cases;
}

const dateLabel = iso => {
  const d = new Date(iso);
  return `${d.toISOString().slice(0, 10).replaceAll('-', '/')} (${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]}) ${d.toISOString().slice(11, 16)}`;
};

export async function prepareCardPlanQaCase(input, caseId) {
  const cases = validateCardPlanQaCases(input);
  if (sha(JSON.stringify(cases)) !== VALUE_SHA256) fail('card_plan_hash_drift');
  const source = cases.find(c => c.id === caseId);
  if (!source) fail('invalid_card_plan_case');
  const { prepareMixedSourceCase } = await import('../longmemeval/mixed-source.mjs');
  const questionId = `lme-case-${sha(`${CARD_PLAN_QA_VERSION}:${source.id}`)}`;
  const history = { question_id: questionId, sessions: source.sessions.map((s, i) => ({
    session_index: i, session_id: `lme-session-${sha(s.id)}`, date: dateLabel(s.eventTime),
    turns: [{ turn_id: `lme-turn-${sha(`${s.id}:0`)}`, ...s.messages[0] }],
  })) };
  const plan = prepareMixedSourceCase({ history,
    question: { question_id: questionId, text: source.question.text,
      date: dateLabel(`${source.question.date}T23:59:00.000Z`) },
    namespace: { ownerId: 'card-plan-offline-owner', scope: 'project', projectId: questionId },
  }, 'indexed-evidence-v1');
  if (plan.counts.windows !== 12 || plan.counts.renderedTurns !== 12
    || plan.counts.excludedFutureSessions !== 0 || plan.cairnPlan.batches.length !== 12
    || plan.cairnPlan.batches.some(b => b.captureInput.messages.length !== 1
      || b.indexedWindows.length !== 1 || b.indexedWindows[0].content.length > 800))
    fail('card_plan_preparation_mismatch');
  return freeze({ version: CARD_PLAN_QA_VERSION, id: source.id, plan,
    question: { text: source.question.text, date: plan.canonicalQuestionDate },
    sourceProvenance: source.sessions.map((s, i) => ({ originalSessionId: s.id,
      eventTime: s.eventTime, originalMessageIndex: 0, role: s.messages[0].role,
      renderedSessionId: history.sessions[i].session_id,
      renderedTurnId: plan.renderedHistory.sessions[i].turns[0].turn_id })),
  });
}
