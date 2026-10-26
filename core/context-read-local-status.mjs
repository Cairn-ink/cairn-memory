import { types } from 'node:util';
import { ownData } from './local-authority-input.mjs';
export const LOCAL_OPERATIONAL_CODES = Object.freeze(['model_pack_conflict', 'model_pack_unavailable', 'model_pack_manifest_invalid',
  'model_pack_integrity', 'model_pack_license', 'model_pack_download_failed', 'model_runtime_unavailable', 'child_crash', 'protocol_error', 'timeout']);
const malformed = Object.freeze({ state: 'unavailable', reason: 'protocol_error' });
export function sampleLocalStatus(observer) {
  try {
    if (typeof observer !== 'function' || types.isAsyncFunction(observer)) return malformed;
    const result = observer();
    if (types.isPromise(result)) { Promise.prototype.then.call(result, undefined, () => {}); return malformed; }
    const value = ownData(result, ['state', 'reason']);
    if (Object.keys(value).length !== 2 || !['ready', 'unavailable', 'closed'].includes(value.state) ||
        (value.state === 'ready' ? value.reason !== null : value.state === 'closed' ? value.reason !== 'closed' : !LOCAL_OPERATIONAL_CODES.includes(value.reason))) return malformed;
    return Object.freeze({ state: value.state, reason: value.reason });
  } catch { return malformed; }
}
