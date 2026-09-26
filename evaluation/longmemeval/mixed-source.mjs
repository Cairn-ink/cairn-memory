import { createHash } from 'node:crypto';

import { redactSecrets } from '../../plugins/cairn-memory/lib/redact.mjs';
import { planIndexedWindowLongMemEvalCase } from './ingestion.mjs';

export const MIXED_SOURCE_VERSION = 'cairn-lme-mixed-source-v2';
const CASE_ID = /^lme-case-[a-f0-9]{64}$/u;
const SESSION_ID = /^lme-session-[a-f0-9]{64}$/u;
const TURN_ID = /^lme-turn-[a-f0-9]{64}$/u;
const DATE = /^(\d{4})\/(\d{2})\/(\d{2}) \((Mon|Tue|Wed|Thu|Fri|Sat|Sun)\) (\d{2}):(\d{2})$/u;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_NODES = 200_000;
const MAX_DEPTH = 16;
const MAX_SESSIONS = 2_500;
const MAX_TURNS = 60_000;
const MAX_MESSAGE = 4_000;
const MAX_PARTITION_PROBE_UTF16 = 32 * 1024 * 1024;
const MAX_QUERY_BYTES = 16 * 1024;
const MAX_BATCHES = 2_500;
const PREFIX = (date) => `[session-date: ${date}; clock: dataset-local] source{`;
const SUFFIX = ' }';
const POLICY_DOMAIN = 'cairn.lme.mixed-source.policy.v2';
const HISTORY_DOMAIN = 'cairn.lme.mixed-source.original-history.v2';
const TURN_DOMAIN = 'cairn.lme.mixed-source.rendered-turn.v2';
const CASE_DOMAIN = 'cairn.lme.mixed-source.case.v2';

export class MixedSourceError extends Error {
  constructor(code) { super(code); this.name = 'MixedSourceError'; this.code = code; }
}
const fail = (code) => { throw new MixedSourceError(code); };
const byteLength = (value) => Buffer.byteLength(value, 'utf8');
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort()
    .map((key) => [key, canonical(value[key])])) : value;
const digest = (domain, value) => createHash('sha256')
  .update(JSON.stringify([domain, canonical(value)]), 'utf8').digest('hex');
const freeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

const policyBody = freeze({ version: MIXED_SOURCE_VERSION,
  date: { grammar: 'YYYY/MM/DD (Ddd) HH:mm', years: [1900, 9999],
    clock: 'dataset-local-floating-minute', cutoff: 'include-at-or-before;preserve-source-order',
    canonicalLabel: 'YYYY-MM-DD HH:mm' },
  normalization: 'NFKC;redactSecrets;Unicode-whitespace-to-ASCII-space;trim',
  rendering: { prefix: '[session-date: ${YYYY-MM-DD HH:mm}; clock: dataset-local] source{',
    suffix: ' }', roles: ['user', 'assistant'],
    chunks: 'greedy-longest-capture-stable-code-point-prefix;full-turn-first' },
  limits: { inputUtf8Bytes: MAX_INPUT_BYTES, traversalDepth: MAX_DEPTH, traversalNodes: MAX_NODES,
    sessions: MAX_SESSIONS, originalTurns: MAX_TURNS, messageUtf16: MAX_MESSAGE,
    partitionProbeUtf16: MAX_PARTITION_PROBE_UTF16,
    batchMessages: 24, batchUtf16: 20_000, indexedWindowUtf16: 800,
    indexedWindowsPerBatch: 64, batches: MAX_BATCHES, queryUtf16: MAX_MESSAGE,
    queryUtf8Bytes: MAX_QUERY_BYTES, mem0InputUtf8Bytes: MAX_INPUT_BYTES },
  originClasses: ['metadata-or-mixed', 'normalized-source', 'original-source'],
  query: 'normalizeCaptureText(JSON.stringify({question:originalText,date:canonicalDate}))',
  hashDomains: { policy: POLICY_DOMAIN, history: HISTORY_DOMAIN, turn: TURN_DOMAIN,
    case: CASE_DOMAIN } });
const POLICY = freeze({ ...policyBody, digest: digest(POLICY_DOMAIN, policyBody) });
export function mixedSourcePolicy() { return POLICY; }

// Copy only own enumerable JSON data, inspecting descriptors before any value read.
// Byte and node accounting is charged before a full input tree can be cloned.
function snapshot(value, state, depth = 0) {
  if (++state.nodes > MAX_NODES || depth > MAX_DEPTH) fail('input_limit_exceeded');
  if (typeof value === 'string') {
    if (!value.isWellFormed() || value.includes('\0')) fail('invalid_input');
    state.bytes += byteLength(value);
    if (state.bytes > MAX_INPUT_BYTES) fail('input_limit_exceeded');
    return value;
  }
  if (value === null || typeof value === 'boolean'
    || typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object') fail('invalid_input');
  if (state.ancestors.has(value)) fail('invalid_input');
  const prototype = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    const length = value.length;
    if (prototype !== Array.prototype || !Number.isSafeInteger(length)
      || length > MAX_NODES) fail('invalid_input');
    const keys = Reflect.ownKeys(value);
    if (keys.length !== length + 1 || !keys.includes('length')) fail('invalid_input');
    if (length > MAX_NODES - state.nodes) fail('input_limit_exceeded');
    state.ancestors.add(value);
    const result = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable)
        fail('invalid_input');
      result.push(snapshot(descriptor.value, state, depth + 1));
    }
    state.ancestors.delete(value);
    return result;
  }
  if (prototype !== Object.prototype && prototype !== null) fail('invalid_input');
  const keys = Reflect.ownKeys(value);
  if (keys.length > MAX_NODES - state.nodes) fail('input_limit_exceeded');
  state.ancestors.add(value);
  const result = Object.create(null);
  for (const key of keys) {
    if (typeof key !== 'string') fail('invalid_input');
    state.bytes += byteLength(key);
    if (state.bytes > MAX_INPUT_BYTES) fail('input_limit_exceeded');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable
      || !Object.hasOwn(descriptor, 'value')) fail('invalid_input');
    Object.defineProperty(result, key, { value: snapshot(descriptor.value, state, depth + 1),
      enumerable: true, configurable: true, writable: true });
  }
  state.ancestors.delete(value);
  return result;
}

function exact(value, keys, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length
    || keys.some((key) => !Object.hasOwn(value, key))) fail(code);
}
function dense(value, minimum, maximum, code) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) fail(code);
}
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
const coreId = (value) => nonempty(value) && value.length <= 200
  && value.trim() === value && !/[\x00-\x1f\x7f]/u.test(value);

function parseDate(value) {
  const match = typeof value === 'string' ? DATE.exec(value) : null;
  if (!match) fail('invalid_date');
  const [, yearText, monthText, dayText, weekday, hourText, minuteText] = match;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const hour = Number(hourText), minute = Number(minuteText);
  if (year < 1900 || year > 9999 || month < 1 || month > 12
    || day < 1 || day > 31 || hour > 23 || minute > 59) fail('invalid_date');
  // UTC is used only for Gregorian calendar arithmetic, never as a clock conversion.
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1
    || calendar.getUTCDate() !== day || DAY_NAMES[calendar.getUTCDay()] !== weekday)
    fail('invalid_date');
  return { order: year * 100_000_000 + month * 1_000_000 + day * 10_000
      + hour * 100 + minute,
    label: `${yearText}-${monthText}-${dayText} ${hourText}:${minuteText}` };
}

const normalize = (value) => redactSecrets(value.normalize('NFKC'))
  .replace(/\s+/gu, ' ').trim();

function normalizeTurn(content) {
  let normalized;
  try { normalized = normalize(content); } catch { fail('invalid_normalization'); }
  if (!normalized || normalized === '[REDACTED]' || normalized.includes('\0'))
    fail('invalid_normalization');
  return normalized;
}

function renderTurn(content, normalized, date, origin, budget) {
  const prefix = PREFIX(date);
  const maxBody = MAX_MESSAGE - prefix.length - SUFFIX.length;
  if (maxBody < 1) fail('render_limit_exceeded');
  const result = [];
  let start = 0;
  while (start < normalized.length) {
    let end = start;
    const ends = [];
    while (end < normalized.length) {
      const pointLength = normalized.codePointAt(end) > 0xffff ? 2 : 1;
      if (end + pointLength - start > maxBody) break;
      end += pointLength;
      ends.push(end);
    }
    if (ends.length === 0) fail('render_limit_exceeded');
    let rendered;
    for (let index = ends.length - 1; index >= 0; index--) {
      end = ends[index];
      const candidate = prefix + normalized.slice(start, end) + SUFFIX;
      if (candidate.length > MAX_MESSAGE) fail('render_limit_exceeded');
      if (budget.probedUtf16 + candidate.length > MAX_PARTITION_PROBE_UTF16)
        fail('render_probe_limit_exceeded');
      budget.probedUtf16 += candidate.length;
      if (normalize(candidate) === candidate) { rendered = candidate; break; }
    }
    if (!rendered) fail('render_normalization_mismatch');
    const body = normalized.slice(start, end);
    // This is a lower bound on the eventual JSON wire size. Reject expanded
    // source before building a complete plan; the exact JSON bound remains below.
    budget.renderedBytes += byteLength(rendered);
    budget.renderedMessages++;
    if (budget.renderedBytes > MAX_INPUT_BYTES || budget.renderedMessages > MAX_TURNS)
      fail('render_limit_exceeded');
    const renderedTurnId = `lme-turn-${digest(TURN_DOMAIN,
      [origin.turnId, start, end, date])}`;
    result.push({ turn: { turn_id: renderedTurnId, role: origin.role, content: rendered },
      origin: { renderedTurnId, originalSessionIndex: origin.sessionIndex,
        originalSessionId: origin.sessionId, originalTurnIndex: origin.turnIndex,
        originalTurnId: origin.turnId, normalizedStart: start, normalizedEnd: end,
        bodyStart: prefix.length, bodyEnd: prefix.length + body.length,
        normalizationChanged: normalized !== content } });
    start = end;
  }
  return { normalized, rendered: result };
}

export function prepareMixedSourceCase(options) {
  let data;
  try { data = snapshot(options, { nodes: 0, bytes: 0, ancestors: new WeakSet() }); }
  catch (error) { if (error instanceof MixedSourceError) throw error; fail('invalid_input'); }
  exact(data, ['history', 'question', 'namespace'], 'invalid_options');
  const { history, question, namespace } = data;
  exact(history, ['question_id', 'sessions'], 'invalid_history');
  exact(question, ['question_id', 'text', 'date'], 'invalid_question');
  exact(namespace, ['ownerId', 'scope', 'projectId'], 'invalid_namespace');
  if (!CASE_ID.test(history.question_id) || question.question_id !== history.question_id
    || !CASE_ID.test(question.question_id)) fail('invalid_question');
  if (!nonempty(question.text) || !nonempty(question.date)) fail('invalid_question');
  if (!coreId(namespace.ownerId) || namespace.scope !== 'project'
    || namespace.projectId !== history.question_id) fail('invalid_namespace');
  dense(history.sessions, 1, MAX_SESSIONS, 'invalid_history');
  const cutoff = parseDate(question.date);
  const seenSessions = new Set(), seenTurns = new Set();
  const renderedSessions = [], sessionOrigins = [], turnOrigins = [];
  const renderBudget = { renderedBytes: 0, renderedMessages: 0, probedUtf16: 0 };
  let originalTurnCount = 0, excludedFutureSessions = 0;
  for (const [sessionIndex, session] of history.sessions.entries()) {
    exact(session, ['session_index', 'session_id', 'date', 'turns'], 'invalid_history');
    if (session.session_index !== sessionIndex || Object.is(session.session_index, -0)
      || !SESSION_ID.test(session.session_id)
      || seenSessions.has(session.session_id)) fail('invalid_history');
    seenSessions.add(session.session_id);
    dense(session.turns, 1, MAX_TURNS, 'invalid_history');
    const date = parseDate(session.date);
    const eligible = date.order <= cutoff.order;
    const renderedTurns = [];
    for (const [turnIndex, turn] of session.turns.entries()) {
      originalTurnCount++;
      if (originalTurnCount > MAX_TURNS) fail('input_limit_exceeded');
      exact(turn, ['turn_id', 'role', 'content'], 'invalid_history');
      if (!TURN_ID.test(turn.turn_id) || seenTurns.has(turn.turn_id)
        || !['user', 'assistant'].includes(turn.role) || !nonempty(turn.content))
        fail('invalid_history');
      seenTurns.add(turn.turn_id);
      const normalized = normalizeTurn(turn.content);
      if (!eligible) continue;
      const { rendered } = renderTurn(turn.content, normalized, date.label,
        { sessionIndex, sessionId: session.session_id, turnIndex,
          turnId: turn.turn_id, role: turn.role }, renderBudget);
      for (const item of rendered) { renderedTurns.push(item.turn); turnOrigins.push(item.origin); }
    }
    if (!eligible) { excludedFutureSessions++; continue; }
    sessionOrigins.push({ renderedSessionIndex: renderedSessions.length,
      originalSessionIndex: sessionIndex, originalSessionId: session.session_id,
      originalDate: session.date });
    renderedSessions.push({ session_index: renderedSessions.length,
      session_id: session.session_id, date: date.label, turns: renderedTurns });
  }
  if (renderedSessions.length === 0) fail('no_eligible_history');
  const renderedHistory = { question_id: history.question_id, sessions: renderedSessions };
  let cairnPlan;
  try { cairnPlan = planIndexedWindowLongMemEvalCase({ history: renderedHistory, namespace }); }
  catch { fail('planner_failed'); }
  if (!cairnPlan.executable || cairnPlan.batches.length > MAX_BATCHES)
    fail('planner_limit_exceeded');
  const byTurn = new Map(turnOrigins.map((entry) => [entry.renderedTurnId, entry]));
  const seenRendered = new Set(), windows = [], mem0Batches = [];
  for (const batch of cairnPlan.batches) {
    const messages = batch.captureInput.messages;
    if (messages.length > 24 || batch.indexedWindows.length > 64
      || messages.reduce((sum, message) => sum + message.content.length, 0) > 20_000)
      fail('planner_limit_exceeded');
    for (const source of batch.sourceMap) {
      const origin = byTurn.get(source.turnId);
      const message = messages[source.messageIndex];
      const normalizedMessage = batch.normalizedCapture.messages[source.messageIndex];
      if (!origin || seenRendered.has(source.turnId) || source.chunkIndex !== 0
        || source.rawStartUtf16 !== 0 || source.rawEndUtf16 !== message?.content.length
        || source.rawContent !== message.content || source.messageId !== message.id
        || source.role !== message.role || normalizedMessage?.content !== message.content
        || normalizedMessage?.role !== message.role) fail('planner_mismatch');
      seenRendered.add(source.turnId);
    }
    for (const window of batch.indexedWindows) {
      const source = batch.sourceMap[window.messageIndex];
      const origin = byTurn.get(source?.turnId);
      if (!origin || window.id !== source.messageId || window.role !== source.role
        || window.content !== messages[window.messageIndex]?.content.slice(window.start, window.end))
        fail('planner_mismatch');
      let classification = 'metadata-or-mixed', originalStart = null, originalEnd = null;
      if (window.start >= origin.bodyStart && window.end <= origin.bodyEnd) {
        classification = 'normalized-source';
        if (!origin.normalizationChanged) {
          const start = origin.normalizedStart + window.start - origin.bodyStart;
          const end = origin.normalizedStart + window.end - origin.bodyStart;
          const raw = history.sessions[origin.originalSessionIndex].turns[origin.originalTurnIndex].content;
          if (raw.slice(start, end) === window.content) {
            classification = 'original-source'; originalStart = start; originalEnd = end;
          }
        }
      }
      windows.push({ batchIndex: batch.batchIndex, windowIndex: window.index,
        renderedTurnId: origin.renderedTurnId, classification,
        originalStartUtf16: originalStart, originalEndUtf16: originalEnd });
    }
    mem0Batches.push(messages.map(({ role, content }) => ({ role, content })));
  }
  if (seenRendered.size !== turnOrigins.length) fail('planner_mismatch');
  let query;
  try { query = normalize(JSON.stringify({ question: question.text, date: cutoff.label })); }
  catch { fail('invalid_query'); }
  if (!query || query === '[REDACTED]' || query.length > MAX_MESSAGE
    || byteLength(query) > MAX_QUERY_BYTES) fail('invalid_query');
  const mem0Input = { batches: mem0Batches, query };
  if (byteLength(JSON.stringify(mem0Input)) > MAX_INPUT_BYTES) fail('mem0_input_limit_exceeded');
  const originMap = { sessions: sessionOrigins, turns: turnOrigins, windows };
  const originalHistoryDigest = digest(HISTORY_DOMAIN, history);
  const caseDigest = digest(CASE_DOMAIN, { policyDigest: POLICY.digest,
    history, question, namespace, renderedHistory, mem0Input, originMap });
  return freeze({ version: MIXED_SOURCE_VERSION, policy: POLICY, originalQuestion: question,
    canonicalQuestionDate: cutoff.label, renderedHistory, cairnPlan, mem0Input,
    counts: { originalSessions: history.sessions.length, eligibleSessions: renderedSessions.length,
      excludedFutureSessions, originalTurns: originalTurnCount,
      renderedTurns: turnOrigins.length, batches: mem0Batches.length, windows: windows.length },
    originalHistoryDigest, caseDigest, originMap });
}
