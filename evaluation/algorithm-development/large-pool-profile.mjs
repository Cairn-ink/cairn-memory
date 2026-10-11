// Source-facing closed profile. This module never loads evaluator gold.
import { readFile } from 'node:fs/promises';

export const LARGE_POOL_VERSION = 'large-pool-six-v1';
export const largePoolArms = Object.freeze(['linked', 'complementary']);
export const largePoolPolicies = Object.freeze({ linked: 'source-diverse-linked-v1', complementary: 'source-diverse-complementary-v1' });
export const largePoolRoster = Object.freeze(['three-source-handoff', 'dated-location-update',
  'decision-premise-reconfirmation', 'cjk-paraphrase-retrieval', 'missing-entity-binding', 'lexical-scope-collision']
  .map((family, index) => Object.freeze({ id: `L0${index + 1}`, family })));
export const largePoolOrders = Object.freeze([['linked', 'complementary'], ['complementary', 'linked']].map(Object.freeze));
export const largePoolLimits = Object.freeze({ cases: 6, coreCallsPerCase: 20, captureCallsPerCase: 12,
  coreCallsPerArm: 8, replayCoreCalls: 0, answersPerCase: 2, httpRequests: 252,
  reservationMicroUsd: 5000, reservedMicroUsd: 2_000_000, protectedMicroUsd: 30_000_000,
  inputTokens: 6000, providerInputTokens: 7024, coreOutputTokens: 1024, answerOutputTokens: 512,
  callMs: 200_000, caseMs: 1_200_000, runMs: 7_200_000 });
export const freezeLargePool = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezeLargePool); Object.freeze(value); }
  return value;
};
export function exactLargePool(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Object.keys(value).sort().join() !== [...keys].sort().join()) throw new TypeError('invalid large-pool fields');
}
export const largePoolString = value => {
  if (typeof value !== 'string' || !value.trim() || !value.isWellFormed()) throw new TypeError('invalid large-pool string');
};
const date = (value, event = false) => {
  if (typeof value !== 'string' || !(event ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u : /^\d{4}-\d{2}-\d{2}$/u).test(value)
    || !Number.isFinite(Date.parse(value)) || (event ? new Date(value).toISOString().replace('.000Z', 'Z')
      : new Date(value).toISOString().slice(0, 10)) !== value) throw new TypeError('invalid large-pool date');
};
export function validateLargePoolInputs(inputs) {
  if (!Array.isArray(inputs) || inputs.length !== 6) throw new TypeError('invalid large-pool roster');
  for (const [index, source] of inputs.entries()) {
    exactLargePool(source, ['id', 'family', 'question', 'sessions']);
    if (source.id !== largePoolRoster[index].id || source.family !== largePoolRoster[index].family) throw new TypeError('invalid large-pool identity');
    exactLargePool(source.question, ['text', 'date']); largePoolString(source.question.text); date(source.question.date);
    if (!Array.isArray(source.sessions) || source.sessions.length !== 6) throw new TypeError('invalid large-pool sessions');
    const seen = new Set(); let characters = 0;
    for (const session of source.sessions) {
      exactLargePool(session, ['id', 'eventTime', 'messages']); largePoolString(session.id); date(session.eventTime, true);
      if (seen.has(session.id) || session.eventTime.slice(0, 10) > source.question.date) throw new TypeError('invalid large-pool session identity/time');
      seen.add(session.id);
      if (!Array.isArray(session.messages) || session.messages.length !== 3) throw new TypeError('invalid large-pool messages');
      for (const [turn, message] of session.messages.entries()) {
        exactLargePool(message, ['role', 'content']); largePoolString(message.content);
        if (message.role !== (turn === 1 ? 'assistant' : 'user')) throw new TypeError('invalid large-pool roles');
        characters += [...message.content].length;
      }
    }
    if (characters > 4000) throw new TypeError('large-pool source too large');
  }
  return inputs;
}
export async function loadLargePoolInputs({ casesPath = new URL('./large-pool-cases.json', import.meta.url) } = {}) {
  return freezeLargePool(validateLargePoolInputs(JSON.parse(await readFile(casesPath, 'utf8'))));
}
export function requireLargePoolReport(report) {
  if (report?.schemaVersion !== `${LARGE_POOL_VERSION}-comparison` || report.treatment !== largePoolPolicies.complementary
    || report.evidenceFormat !== 'source-role-evidence-v1' || report.coupling !== 'natural-raw-trace-replay-v1'
    || Object.keys(report.armPolicies ?? {}).sort().join() !== [...largePoolArms].sort().join()
    || largePoolArms.some(name => report.armPolicies[name] !== largePoolPolicies[name])
    || report.denominator !== 6 || report.attemptsPerArm !== 6 || report.observations?.length !== 6) throw new TypeError('wrong large-pool report');
  for (const [index, row] of report.observations.entries()) {
    if (row.id !== largePoolRoster[index].id || row.family !== largePoolRoster[index].family
      || Object.keys(row.arms ?? {}).sort().join() !== [...largePoolArms].sort().join()
      || JSON.stringify(row.order) !== JSON.stringify(largePoolOrders[index % 2])) throw new TypeError('wrong large-pool observations');
  }
}
