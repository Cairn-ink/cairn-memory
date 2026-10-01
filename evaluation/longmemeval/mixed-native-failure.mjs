// Evaluation observation only: never use this classification as scope authority.
import { types } from 'node:util';
import { Mem0NativeRuntimeError } from '../experiment-budget/mem0-native-runtime.mjs';
import { Mem0NativeGatewayError } from '../experiment-budget/mem0-native-gateway.mjs';

// Explicit codes emitted by the existing classes, pinned to this source contract.
// New native codes require a reviewed diagnostic update; unknowns stay absent.
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

export function projectMixedNativeFailure(error) {
  try {
    // Proxy detection precedes every reflective operation, including revoked proxies.
    // Native Error branding also rejects plain objects forged with a typed prototype.
    if (types.isProxy(error) || !types.isNativeError(error)) return undefined;
    const prototype = Object.getPrototypeOf(error);
    const layer = prototype === Mem0NativeRuntimeError.prototype ? 'runtime'
      : prototype === Mem0NativeGatewayError.prototype ? 'gateway' : null;
    if (layer === null) return undefined;
    const code = Object.getOwnPropertyDescriptor(error, 'code');
    if (!code || !Object.hasOwn(code, 'value') || typeof code.value !== 'string') return undefined;
    const reasons = layer === 'runtime' ? RUNTIME_REASONS : GATEWAY_REASONS;
    if (!reasons.has(code.value)) return undefined;
    return Object.freeze({ version: 1, layer, reason: code.value });
  } catch { return undefined; }
}
