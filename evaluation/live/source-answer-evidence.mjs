import { readFileSync } from 'node:fs';
import { redactSecrets } from '../../plugins/cairn-memory/lib/redact.mjs';

const fixture = JSON.parse(readFileSync(new URL('./source-answer-fixture.json', import.meta.url)));
const ARMS = ['none', 'moc', 'lexical', 'moc-basis'];
const schedule = fixture.cases.flatMap((c, i) => ARMS.map((_, j) => ARMS[(i + j) % ARMS.length])
  .map(arm => ({ id: `${c.id}-${arm}`, caseId: c.id, arm, question: c.question, context: c.arms[arm] })));
const pick = (v, keys) => Object.fromEntries(keys.filter(k => Object.hasOwn(v ?? {}, k)).map(k => [k, v[k]]));
const budget = v => pick(v, ['requestCount', 'reservedMicroUsd', 'knownUsageMicroUsd', 'unknownCostRequests', 'unsettled', 'limitMicroUsd', 'state']);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Fixed synthetic development evidence, never a general-purpose raw-log exporter. */
export function exportSourceAnswerEvidence(report) {
  if (report?.version !== 1 || report.id !== fixture.id || report.offline !== false
    || report.pins?.fixture !== 'c6ae2ab4247fd7369404e72bee2f8a8495f825dcc2df12c8c444ce24bb5141b1'
    || report.pins?.sourceRaw !== fixture.sourceRawSha256 || !Array.isArray(report.cases)
    || report.cases.length > schedule.length) throw new Error('invalid_source_answer_evidence');
  const cases = schedule.map((expected, i) => {
    const item = report.cases[i];
    if (!item) return { ...expected, status: 'not_run', body: null, answer: null, responseAvailable: false, response: null };
    if (!same(pick(item, Object.keys(expected)), expected)) throw new Error('invalid_source_answer_context');
    if (item.body !== null && (!same(item.body.messages, [
      { role: 'system', content: fixture.instruction },
      { role: 'user', content: JSON.stringify({ question: expected.question, memory: expected.context }) },
    ]) || !same(Object.keys(item.body).sort(), ['model', 'messages', 'max_completion_tokens', 'store', 'stream', 'n'].sort())
      || item.body.model !== 'gpt-4.1-mini-2025-04-14' || item.body.max_completion_tokens !== 1024
      || item.body.store !== false || item.body.stream !== false || item.body.n !== 1)) throw new Error('invalid_source_answer_body');
    const response = item.providerResponse;
    return { ...expected, ...pick(item, ['status', 'body', 'answer', 'responseAvailable']),
      response: response == null ? null : { ...pick(response, ['object', 'model']),
        usage: pick(response.usage, ['prompt_tokens', 'completion_tokens', 'total_tokens']),
        choices: Array.isArray(response.choices) ? response.choices.map(c => ({ ...pick(c, ['index', 'finish_reason']),
          message: pick(c.message, ['role', 'content', 'refusal']), toolCallsPresent: Boolean(c.message?.tool_calls) })) : null } };
  });
  const result = { version: 1, id: report.id, semanticStatus: 'unassessed',
    ...pick(report, ['sourceHead', 'model', 'status', 'halted']),
    fixtureSha256: report.pins.fixture, rubricSha256: report.pins.rubric,
    operatorSha256: report.pins.operator, sourceRawSha256: report.pins.sourceRaw,
    limits: pick(report.limits, ['requests', 'microUsd']), budgetBefore: budget(report.budgetBefore), budgetAfter: budget(report.budgetAfter), cases };
  const encoded = JSON.stringify(result);
  if (redactSecrets(encoded) !== encoded || /\/(?:tmp|home|Users|workspace)\/|[A-Za-z]:\\|Bearer\s/iu.test(encoded)) {
    throw new Error('sensitive_source_answer_evidence');
  }
  return JSON.parse(encoded);
}
