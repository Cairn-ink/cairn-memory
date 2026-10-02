// Evaluation observation only: never use this classification as scope authority.
import { types } from 'node:util';
import { Mem0NativeRuntimeError } from '../experiment-budget/mem0-native-runtime.mjs';
import { Mem0NativeGatewayError } from '../experiment-budget/mem0-native-gateway.mjs';
import { isMixedNativeFailure } from './mixed-native-failure-shape.mjs';

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
    const observation = { version: 1, layer, reason: code.value };
    return isMixedNativeFailure(observation) ? Object.freeze(observation) : undefined;
  } catch { return undefined; }
}
