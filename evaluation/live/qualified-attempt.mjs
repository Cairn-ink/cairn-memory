import { openSync, closeSync, writeFileSync, fsyncSync, lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';

export const QUALIFIED_LIMITS = Object.freeze({ requests: 272, microUsd: 2_300_000 });
const otherModel = 'gpt-4.1-mini-2025-04-14';
const extractionModel = 'gpt-5.4-mini-2026-03-17';
const fail = code => { throw new Error(code); };

/** Exclusive append-only evidence files; a partial write is never reused. */
export function writeQualifiedEvidence(directory, name, value) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,100}$/u.test(name)) fail('unsafe_evidence_name');
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(directory) !== directory
    || (stat.mode & 0o077) !== 0) fail('unsafe_evidence_directory');
  const fd = openSync(path.join(directory, `${name}.json`), 'wx', 0o600);
  try { writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`); fsyncSync(fd); }
  finally { closeSync(fd); }
  const parent = openSync(directory, 'r');
  try { fsyncSync(parent); } finally { closeSync(parent); }
}

function reservation(url, body) {
  const parsed = JSON.parse(body);
  if (url === 'https://api.openai.com/v1/chat/completions' && parsed.model === otherModel) {
    return { channel: 'host', microUsd: 50_000 };
  }
  const count = url === 'https://api.openai.com/v1/responses/input_tokens';
  if (!count && url !== 'https://api.openai.com/v1/responses') fail('request_rejected');
  const method = parsed.text?.format?.name;
  if (!['cairn_extract', 'cairn_classify', 'cairn_select', 'cairn_rank', 'cairn_reconcile'].includes(method)
    || parsed.model !== (method === 'cairn_extract' ? extractionModel : otherModel)) fail('request_rejected');
  return { channel: 'model', microUsd: method === 'cairn_extract' ? (count ? 5268 : 9876) : 5000 };
}

/** One process, serialized requests, over an existing guarded campaign transport.
 * This additional cap grants no authority and does not create/change the ledger.
 * All dependencies are mandatory; there is no native network fallback.
 */
export function createQualifiedAttempt({ readState, checkPins, persist, send } = {}) {
  if ([readState, checkPins, persist, send].some(fn => typeof fn !== 'function')) fail('invalid_attempt');
  let expected = structuredClone(readState());
  if (expected.state !== 'open' || expected.unsettled !== 0
    || !Number.isSafeInteger(expected.requests) || expected.requests < 0
    || !Number.isSafeInteger(expected.reservedMicroUsd) || expected.reservedMicroUsd < 0
    || expected.requests + QUALIFIED_LIMITS.requests > 4000
    || expected.reservedMicroUsd + QUALIFIED_LIMITS.microUsd > 20_000_000) fail('insufficient_budget');
  const before = structuredClone(expected);
  let halted = null, requests = 0, reservedMicroUsd = 0, queue = Promise.resolve();
  const arms = new Map();
  const halt = code => { halted ??= code; return new Error(halted); };
  const state = () => ({ before: structuredClone(before), requests, reservedMicroUsd, halted });
  const sameAccounting = actual => actual.state === 'open' && actual.unsettled === 0
    && actual.requests === expected.requests && actual.reservedMicroUsd === expected.reservedMicroUsd;

  function request({ caseId, arm, url, body, signal }) {
    const pending = queue.then(async () => {
      if (halted) throw halt('global_transport_halt');
      let item;
      try {
        await checkPins();
        if (!sameAccounting(readState())) fail('unexpected_accounting');
        if (!/^Q0[1-8]$/u.test(caseId) || !['baseline', 'qualified'].includes(arm)
          || typeof body !== 'string') fail('request_rejected');
        const charge = reservation(url, body);
        const key = `${caseId}-${arm}`;
        const counters = arms.get(key) ?? { host: 0, model: 0 };
        if (requests >= QUALIFIED_LIMITS.requests || reservedMicroUsd + charge.microUsd > QUALIFIED_LIMITS.microUsd
          || counters[charge.channel] >= (charge.channel === 'host' ? 1 : 16)) fail('attempt_limit');
        requests += 1;
        reservedMicroUsd += charge.microUsd;
        counters[charge.channel] += 1;
        arms.set(key, counters);
        item = { sequence: requests, caseId, arm, endpoint: new URL(url).pathname,
          reservedMicroUsd: charge.microUsd, startedAt: new Date().toISOString(), status: 'reserved' };
        // Durable local reservation precedes the campaign guard and actual I/O.
        await persist(`request-${requests}-reserved`, item);
        const response = await send({ arm, url, body, signal, channel: charge.channel });
        expected = { ...expected, requests: expected.requests + 1,
          reservedMicroUsd: expected.reservedMicroUsd + charge.microUsd };
        if (!sameAccounting(readState())) fail('unexpected_accounting');
        if (!response?.ok || response.redirected) fail('transport_failed');
        await persist(`request-${requests}-settled`, { ...item, status: 'settled',
          httpStatus: response.status, completedAt: new Date().toISOString() });
        return response;
      } catch (error) {
        const code = ['unexpected_accounting', 'attempt_limit', 'request_rejected', 'transport_failed'].includes(error?.message)
          ? error.message : 'guard_pin_or_persistence_failed';
        halt(code);
        // No retry, refund, overwrite or repair. Preserve whatever evidence remains writable.
        try { await persist(`request-${requests}-halted`, { ...item, ...state() }); } catch { /* Original failure retained. */ }
        throw halt(code);
      }
    });
    queue = pending.then(() => undefined, () => undefined);
    return pending;
  }
  return Object.freeze({ request, getState: state, stop: () => { halt('operator_halted'); } });
}
