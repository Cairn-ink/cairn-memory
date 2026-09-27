import { countOpenAITokens } from '../../adapters/openai/index.mjs';
import { benchmarkStagePolicy } from '../live/public-pilot.mjs';
import { OFFICIAL_JUDGE_MODEL } from './official-scoring.mjs';
import { MIXED_ANSWER_MODEL, MIXED_ANSWER_TIMEOUT_MS } from './mixed-answer.mjs';
import { fail, safeInteger, wellFormed } from './mixed-validation.mjs';

const VERIFIED_LOCAL = new WeakMap();

function authenticatedPrior(guard, ordinal) {
  if (!VERIFIED_LOCAL.get(guard)?.has(ordinal) || guard.isHalted()) return false;
  const outcome = guard.caseOutcomes()?.scopes?.[ordinal];
  const scheduled = guard.mixedSourcePairCapability?.schedule?.[ordinal];
  return outcome?.ordinal === ordinal && outcome.phase === scheduled?.phase
    && outcome.status === 'failed' && ['deadline', 'cancelled'].includes(outcome.reason)
    && guard.attempts().every(attempt => attempt.ordinal !== ordinal || attempt.outcome !== null);
}

export function unknownCurrentAttempt(guard, allowedLocalOrdinals = new Set()) {
  return guard.attempts().find(attempt => {
    const reserveOnly = attempt.stage === 'cairn-count' && attempt.outcome === 'succeeded'
      || attempt.stage === 'mem0-embedding' && attempt.outcome === 'failed';
    return attempt.outcome === null || (attempt.outcome === 'unknown'
      || attempt.actualMicroUsd === null && !reserveOnly)
      && !(allowedLocalOrdinals.has(attempt.ordinal)
        && authenticatedPrior(guard, attempt.ordinal));
  }) ?? null;
}

export function authenticateLocalUnknown(guard, returned, identity, allowedLocalOrdinals,
  { workSettled, transportSettled }) {
  if (guard.isHalted() || !workSettled || !transportSettled
    || returned?.status !== 'failed' || !['deadline', 'cancelled'].includes(returned.reason)) {
    return false;
  }
  const scope = guard.caseScopeSnapshot();
  const outcomes = guard.caseOutcomes()?.scopes;
  const last = outcomes?.at(-1);
  if (!scope || !last || scope.ordinal !== last.ordinal || scope.phase !== identity.phase
    || last.phase !== identity.phase
    || guard.mixedSourcePairCapability.schedule?.[scope.ordinal]?.caseId !== identity.caseId
    || scope.arm !== last.arm || scope.status !== returned.status
    || last.status !== returned.status || scope.reason !== returned.reason
    || last.reason !== returned.reason || scope.ordinal !== outcomes.length - 1) return false;
  const attempts = guard.attempts();
  const ledger = guard.getState();
  if (ledger.attempts?.some(item => item.outcome === null) || attempts.some(item => item.outcome === null)
    || attempts.some(item => item.ordinal === scope.ordinal && item.outcome === 'unknown'
      && item.actualMicroUsd !== null)) return false;
  allowedLocalOrdinals.add(scope.ordinal);
  VERIFIED_LOCAL.set(guard, new Set([...(VERIFIED_LOCAL.get(guard) ?? []), scope.ordinal]));
  return unknownCurrentAttempt(guard, allowedLocalOrdinals) === null;
}

export function verifiedLocalOrdinals(guard) {
  const values = VERIFIED_LOCAL.get(guard) ?? new Set();
  for (const ordinal of values) if (!authenticatedPrior(guard, ordinal)) {
    fail('global_accounting_unsettled');
  }
  return new Set(values);
}

export function trackedTransport() {
  const pending = new Set();
  return Object.freeze({
    track(fetchImpl) {
      return (...args) => {
        const call = Promise.resolve().then(() => fetchImpl(...args));
        pending.add(call);
        call.finally(() => pending.delete(call)).catch(() => {});
        return call;
      };
    },
    async drain() { await Promise.allSettled([...pending]); },
    get size() { return pending.size; },
  });
}

export async function completionOnce({ guard, stage, request, apiKey, timeoutMs, transport }) {
  const channel = guard.stages?.[stage];
  const expectedModel = stage === 'answer' ? MIXED_ANSWER_MODEL
    : stage === 'judge' ? OFFICIAL_JUDGE_MODEL : null;
  const expectedStage = benchmarkStagePolicy()[stage];
  const ceiling = stage === 'answer' ? MIXED_ANSWER_TIMEOUT_MS
    : expectedStage?.timeoutMs;
  const route = stage === 'answer' ? guard.answerFetch : guard.judgeFetch;
  if (!channel || channel.model !== expectedModel || typeof route !== 'function'
    || channel.endpoint !== expectedStage?.endpoint
    || channel.timeoutMs !== expectedStage.timeoutMs
    || timeoutMs !== ceiling || channel.timeoutMs > ceiling
    || !wellFormed(apiKey) || !apiKey.trim() || /[\r\n]/u.test(apiKey)) fail('invalid_mixed_transport');
  const body = JSON.stringify({ ...request, store: false, stream: false });
  // X alone owns the provider deadline. A second same-length timer would race
  // and turn a trustworthy X timeout into an unauthenticated external abort.
  const signal = new AbortController().signal;
  const response = await transport.track(route)(channel.endpoint, { method: 'POST', redirect: 'error',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body, signal });
  let data;
  try { data = await response.json(); } catch { fail('invalid_mixed_completion'); }
  if (data?.object !== 'chat.completion' || data.model !== expectedModel
    || !Array.isArray(data.choices) || data.choices.length !== 1) fail('invalid_mixed_completion');
  const choice = data.choices[0];
  const message = choice?.message;
  const text = message?.content;
  if (choice?.index !== 0 || choice.finish_reason !== 'stop'
    || message?.role !== 'assistant' || !wellFormed(text) || !text
    || Buffer.byteLength(text, 'utf8') > 32 * 1024
    || countOpenAITokens(text) > request.max_tokens
    || message.tool_calls !== undefined) fail('invalid_mixed_completion');
  const usage = data.usage;
  if (!safeInteger(usage?.prompt_tokens) || !safeInteger(usage?.completion_tokens)
    || !safeInteger(usage?.total_tokens)
    || usage.total_tokens !== usage.prompt_tokens + usage.completion_tokens
    || usage.completion_tokens > request.max_tokens) fail('invalid_mixed_usage');
  const attempt = guard.attempts().at(-1);
  if (attempt?.stage !== stage || attempt.outcome !== 'succeeded'
    || !safeInteger(attempt.actualMicroUsd)) fail('mixed_usage_unsettled');
  return Object.freeze({ text, usage: Object.freeze({ inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens, costMicroUsd: attempt.actualMicroUsd }) });
}
