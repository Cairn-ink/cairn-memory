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

export function isMixedNativeFailure(value) {
  try {
    if (!value || typeof value !== 'object' || types.isProxy(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = ['version', 'layer', 'reason'];
    if (Reflect.ownKeys(descriptors).length !== keys.length
      || keys.some(key => !Object.hasOwn(descriptors, key)
        || !Object.hasOwn(descriptors[key], 'value'))) return false;
    const { version, layer, reason } = Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
    return version === 1 && typeof reason === 'string'
      && (layer === 'runtime' ? RUNTIME_REASONS : layer === 'gateway' ? GATEWAY_REASONS : null)
        ?.has(reason) === true;
  } catch { return false; }
}
