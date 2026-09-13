import { createQualificationExperimentRequestGuard } from '../experiment-budget/request-guard.mjs';
import { experimentPolicy, MODEL_ID } from './session.mjs';

const fail = code => { throw new Error(code); };

// A parent-only provider boundary for explicitly authorized capture experiments.
// It never creates a ledger or implies the later operator's smaller per-run cap.
export function createQualificationLiveSession(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)
    || Object.keys(options).sort().join(',') !== 'apiKey,fetchImpl,ledger,qualificationExtension') {
    fail('invalid_qualification_session');
  }
  const { ledger, apiKey, qualificationExtension, fetchImpl } = options;
  if (typeof apiKey !== 'string' || !apiKey || /\s/u.test(apiKey)
    || typeof fetchImpl !== 'function' || !Number.isSafeInteger(ledger?.limitMicroUsd)
    || ledger.limitMicroUsd < 1 || ledger.limitMicroUsd > 50_000_000) fail('invalid_qualification_session');
  const guard = createQualificationExperimentRequestGuard({ ledger, policy: experimentPolicy(),
    qualificationExtension, fetchImpl });

  async function request(path, body, { signal = new AbortController().signal } = {}) {
    if (!['/responses', '/responses/input_tokens'].includes(path)) fail('invalid_live_route');
    let encoded; let parsed;
    try {
      encoded = typeof body === 'string' ? body : JSON.stringify(body);
      parsed = JSON.parse(encoded);
    } catch { fail('invalid_qualification_request'); }
    if (parsed?.model !== MODEL_ID
      || !['cairn_extract', 'cairn_classify', 'cairn_qualify'].includes(parsed?.text?.format?.name)) {
      fail('invalid_qualification_request');
    }
    return guard.cairnFetch(`https://api.openai.com/v1${path}`, {
      method: 'POST', redirect: 'error', signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` }, body: encoded,
    });
  }

  return Object.freeze({ request, getState: () => guard.getState(), close: () => guard.close() });
}
