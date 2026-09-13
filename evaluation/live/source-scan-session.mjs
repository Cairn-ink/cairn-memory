import { createExperimentRequestGuard } from '../experiment-budget/request-guard.mjs';
import { experimentPolicy, MODEL_ID } from './session.mjs';

const fail = () => { throw new Error('invalid_source_scan_session'); };

/** Narrow parent-only transport. Never creates a ledger or grants extra methods. */
export function createSourceScanSession({ ledger, apiKey, fetchImpl } = {}) {
  if (typeof apiKey !== 'string' || !apiKey || /\s/u.test(apiKey) || typeof fetchImpl !== 'function'
    || !Number.isSafeInteger(ledger?.limitMicroUsd) || ledger.limitMicroUsd <= 0 || ledger.limitMicroUsd > 50_000_000
    || !Number.isSafeInteger(ledger?.requestCap) || ledger.requestCap <= 0 || ledger.requestCap > 5000) fail();
  const guard = createExperimentRequestGuard({ ledger, policy: experimentPolicy(), fetchImpl });
  return Object.freeze({
    request(route, body, { signal = new AbortController().signal } = {}) {
      if (!['/responses', '/responses/input_tokens'].includes(route) || typeof body !== 'string') fail();
      let input; try { input = JSON.parse(body); } catch { fail(); }
      if (input.model !== MODEL_ID || !['cairn_select', 'cairn_rank'].includes(input.text?.format?.name)) fail();
      return guard.cairnFetch(`https://api.openai.com/v1${route}`, { method: 'POST', redirect: 'error', signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` }, body });
    },
    getState: () => guard.getState(), close: () => guard.close(),
  });
}
