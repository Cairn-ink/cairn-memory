// Finite private observation shape only; no execution imports or authority.
import { types } from 'node:util';

// Explicit existing native class codes. New codes require a reviewed update.
const RUNTIME_REASONS = new Set([
  'native_accounting_unsettled', 'native_artifact_changed', 'native_child_failed',
  'native_child_source_changed', 'native_cleanup_failed', 'native_connection_cap',
  'native_gateway_failed', 'native_guard_drain_failed', 'native_http_invalid',
  'native_http_timeout', 'native_input_exceeded', 'native_input_failed',
  'native_kill_failed', 'native_listener_cleanup_failed', 'native_listener_failed',
  'native_output_exceeded', 'native_output_invalid', 'native_pid_invalid',
  'native_process_group_live', 'native_reap_failed', 'native_response_disconnect',
  'native_response_invalid', 'native_scope_closed', 'native_spawn_failed',
  'native_stderr_exceeded',
]);
const GATEWAY_REASONS = new Set([
  'invalid_native_configuration', 'invalid_native_input', 'invalid_native_options',
  'native_artifact_changed', 'native_child_source_invalid', 'native_configuration_changed',
  'native_configuration_identity_required', 'native_guard_required',
  'native_manifest_mismatch', 'native_scope_required',
]);
const HTTP_CLIENT_CODES = new Set(['HPE_INVALID_HEADER_TOKEN', 'HPE_INVALID_EOF_STATE',
  'HPE_HEADER_OVERFLOW', 'ERR_HTTP_REQUEST_TIMEOUT', 'ECONNRESET', 'other_parser', 'other']);

function ownData(value, keys, enumerable = false) {
  if (!value || typeof value !== 'object' || types.isProxy(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length
    || keys.some(key => !Object.hasOwn(descriptors, key)
      || !Object.hasOwn(descriptors[key], 'value')
      || enumerable && !descriptors[key].enumerable)) return null;
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}

function validHttpClientError(value) {
  const row = ownData(value, ['version', 'code', 'connectionOrdinal', 'requestCount',
    'connectionRequestCount', 'phase', 'stopping', 'scopeStatus', 'connectionAgeMs', 'sinceLastResponseMs'], true);
  if (!row) return false;
  const integer = (value, minimum, maximum) => Number.isSafeInteger(value)
    && !Object.is(value, -0) && value >= minimum && value <= maximum;
  return row.version === 1 && HTTP_CLIENT_CODES.has(row.code)
    && integer(row.connectionOrdinal, 1, 1_000_000)
    && integer(row.requestCount, 0, 1_000_000)
    && integer(row.connectionRequestCount, 0, row.requestCount)
    && ['headers', 'body', 'response', 'idle'].includes(row.phase)
    && typeof row.stopping === 'boolean'
    && ['active', 'completed', 'failed'].includes(row.scopeStatus)
    && integer(row.connectionAgeMs, 0, 2_147_483_647)
    && (row.sinceLastResponseMs === null || integer(row.sinceLastResponseMs, 0, 2_147_483_647));
}

export function isMixedNativeFailure(value) {
  try {
    if (!value || types.isProxy(value)) return false;
    const keys = ['version', 'layer', 'reason', ...(Object.hasOwn(value, 'httpClientError') ? ['httpClientError'] : [])];
    const row = ownData(value, keys, keys.length > 3);
    if (!row) return false;
    const { version, layer, reason } = row;
    return version === 1 && typeof reason === 'string'
      && (layer === 'runtime' ? RUNTIME_REASONS : layer === 'gateway' ? GATEWAY_REASONS : null)
        ?.has(reason) === true
      && (!Object.hasOwn(row, 'httpClientError') || layer === 'runtime'
        && reason === 'native_http_invalid' && validHttpClientError(row.httpClientError));
  } catch { return false; }
}
