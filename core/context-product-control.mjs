import { randomUUID, createHash } from 'node:crypto';
import { types } from 'node:util';
import { ownData } from './local-authority-input.mjs';
import { contextReadSet } from './context-read-input.mjs';
import { deepFreeze } from './private-card-input.mjs';
import { fail } from './validation.mjs';

export const PRODUCT_PROFILE = 'context-read-product-v1.1';
const domainKey = Symbol.for('context-read-product-v1.1/clock-domain');
export const clockDomainId = globalThis[domainKey] ??= randomUUID();
const U64 = (1n << 64n) - 1n;
export const id = value => {
  if (typeof value !== 'string' || !/^[\x00-\x7f]{1,64}$/.test(value)) fail('invalid_input');
  return value;
};
export const deadline = (value = 1000) => {
  if (!Number.isSafeInteger(value) || value < 1 || value > 5000) fail('invalid_input');
  return value;
};
export function mono(value) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value) || BigInt(value) > U64) fail('invalid_input');
  return BigInt(value);
}
const stamp = value => { const result = String(value); mono(result); return result; };
export function boundedData(value, maximum = 262144) {
  let nodes = 8192, units = maximum;
  function copy(value, depth = 0) {
    if (--nodes < 0 || depth > 16) fail('invalid_input');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      if ((units -= value.length) < 0 || !value.isWellFormed()) fail('invalid_input');
      return value;
    }
    if (!value || typeof value !== 'object' || types.isProxy(value) ||
        ![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(value))) fail('invalid_input');
    const array = Array.isArray(value), descriptors = Object.getOwnPropertyDescriptors(value), result = array ? [] : {};
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length > nodes + 1) fail('invalid_input');
    if (array) {
      if (value.length > nodes || keys.length !== value.length + 1) fail('invalid_input');
      for (let i = 0; i < value.length; i++) {
        if (!Object.hasOwn(descriptors[i] ?? {}, 'value')) fail('invalid_input');
        result.push(copy(descriptors[i].value, depth + 1));
      }
    } else {
      if (keys.some(key => typeof key !== 'string')) fail('invalid_input');
      for (const key of keys.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))) {
        if ((units -= key.length) < 0 || key === '__proto__' || !key.isWellFormed() || !Object.hasOwn(descriptors[key], 'value')) fail('invalid_input');
        result[key] = copy(descriptors[key].value, depth + 1);
      }
    }
    return result;
  }
  const result = copy(value);
  if (Buffer.byteLength(JSON.stringify(result)) > maximum) fail('invalid_input');
  return deepFreeze(result);
}
// Shared state is trusted host configuration. Operation envelopes validate the
// credential separately, while retaining one byte cap for the full transport.
export function hostConfiguration(value, credentialEnvelope = false) {
  let sharedBytes = 0, nodes = 8192, units = 262144;
  function copy(value, depth = 0) {
    if (--nodes < 0 || depth > 16 || types.isProxy(value)) fail('invalid_input');
    if (value instanceof SharedArrayBuffer) {
      if (value.growable || Reflect.ownKeys(value).length || (sharedBytes += value.byteLength) > 262144) fail('invalid_input');
      return value;
    }
    if (value === null || typeof value !== 'object') {
      if (typeof value === 'string' && (units -= value.length) < 0) fail('invalid_input');
      return boundedData(value);
    }
    const array = Array.isArray(value), descriptors = Object.getOwnPropertyDescriptors(value);
    if (![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(value))) fail('invalid_input');
    const result = array ? [] : {};
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length > nodes + 1) fail('invalid_input');
    for (const key of keys) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string' || key === '__proto__' || !key.isWellFormed() ||
          !Object.hasOwn(descriptors[key], 'value') || (units -= key.length) < 0) fail('invalid_input');
      if (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) !== result.length)) fail('invalid_input');
      // Credential limits are relative to the credential, not the IPC wrapper.
      result[key] = credentialEnvelope && depth === 0 && key === 'credential'
        ? boundedData(descriptors[key].value, 16384) : copy(descriptors[key].value, depth + 1);
    }
    if (array && result.length !== value.length) fail('invalid_input');
    return result;
  }
  const result = copy(value);
  if (sharedBytes + Buffer.byteLength(JSON.stringify(result)) > 262144) fail('invalid_input');
  return deepFreeze(result);
}

export const operationMessage = value => hostConfiguration(value, true);

export const credentialDigest = value => createHash('sha256').update(JSON.stringify(boundedData(value, 16384))).digest('base64url');
export function coverage(value, readSet) {
  const c = ownData(value, ['policy', 'selectionRevision', 'requestedNamespaces', 'selectedNamespaces', 'omittedNamespaces']);
  if (Object.keys(c).length !== 5 || c.policy !== 'recent-projects-v1' || typeof c.selectionRevision !== 'string' ||
      !c.selectionRevision.length || c.selectionRevision.length > 200 || !c.selectionRevision.isWellFormed() ||
      ['requestedNamespaces', 'selectedNamespaces', 'omittedNamespaces'].some(k => !Number.isSafeInteger(c[k]) || c[k] < 0) ||
      c.selectedNamespaces !== readSet.length || c.requestedNamespaces !== c.selectedNamespaces + c.omittedNamespaces || c.omittedNamespaces !== 0) fail('invalid_input');
  return deepFreeze(c);
}
export function issuance(value, control, readSet, ownerCoverage) {
  if (!value) fail('authority_required');
  const binding = boundedData(value);
  ownData(binding, ['kind', 'requestId', 'handleId', 'credentialBindingId', 'credentialExpiresUtcMs', 'credentialDigest',
    'ownerId', 'namespaces', 'issuedAt', 'ownerGeneration']);
  if (binding.kind !== 'request') fail('authority_required');
  if (!Number.isSafeInteger(binding.issuedAt) || binding.issuedAt < 0 ||
      binding.ownerGeneration !== undefined && (!Number.isSafeInteger(binding.ownerGeneration) || binding.ownerGeneration < 1)) fail('invalid_input');
  if (typeof binding.credentialDigest !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(binding.credentialDigest)) fail('invalid_input');
  const namespaces = ownData(binding.namespaces, ['readSet', 'ownerCoverage']);
  if (['requestId', 'handleId', 'credentialBindingId', 'credentialExpiresUtcMs'].some(k => binding[k] !== control[k]) ||
      binding.ownerId !== readSet[0].ownerId || JSON.stringify(contextReadSet(namespaces.readSet)) !== JSON.stringify(readSet) ||
      JSON.stringify(boundedData(namespaces.ownerCoverage)) !== JSON.stringify(boundedData(ownerCoverage))) fail('authority_required');
  return binding;
}
export function requestRecord(value, admitted, utc, domain = clockDomainId) {
  const c = ownData(value, ['requestId', 'handleId', 'credentialBindingId', 'credentialExpiresUtcMs', 'requestMaxMs']);
  if (Object.keys(c).length !== 5) fail('invalid_input');
  for (const k of ['requestId', 'handleId', 'credentialBindingId']) id(c[k]);
  const expiry = c.credentialExpiresUtcMs;
  if (expiry !== null && (!Number.isSafeInteger(expiry) || expiry < 0) || !Number.isSafeInteger(utc) || utc < 0) fail('invalid_input');
  if (!Number.isSafeInteger(c.requestMaxMs)) fail('invalid_input');
  const requestMaxMs = deadline(c.requestMaxMs);
  if (expiry !== null && expiry <= utc) fail('authority_required');
  return Object.freeze({ profile: PRODUCT_PROFILE, clockDomainId: id(domain), requestId: c.requestId, handleId: c.handleId,
    credentialBindingId: c.credentialBindingId, admittedMonoNs: stamp(admitted), admissionUtcMs: utc,
    requestCutoffMonoNs: stamp(admitted + BigInt(requestMaxMs) * 1000000n), credentialExpiresUtcMs: expiry,
    credentialCutoffMonoNs: expiry === null ? null : stamp(admitted + BigInt(Math.max(0, expiry - utc)) * 1000000n) });
}
export function operationRecord(request, entered, duration, epoch, operationId = randomUUID()) {
  let cutoff = mono(stamp(entered + BigInt(deadline(duration)) * 1000000n));
  for (const value of [request.requestCutoffMonoNs, request.credentialCutoffMonoNs]) if (value !== null && mono(value) < cutoff) cutoff = mono(value);
  if (!Number.isSafeInteger(epoch) || epoch < 1) fail('invalid_input');
  return Object.freeze({ requestId: request.requestId, handleId: request.handleId, credentialBindingId: request.credentialBindingId,
    clockDomainId: request.clockDomainId, operationId: id(operationId), workerEpoch: epoch, enteredMonoNs: stamp(entered), operationCutoffMonoNs: stamp(cutoff) });
}
export function verifyRecords(request, operation, expectedRequest, expectedOperation) {
  ownData(request, ['profile', 'clockDomainId', 'requestId', 'handleId', 'credentialBindingId', 'admittedMonoNs', 'admissionUtcMs',
    'requestCutoffMonoNs', 'credentialExpiresUtcMs', 'credentialCutoffMonoNs']);
  ownData(operation, ['requestId', 'handleId', 'credentialBindingId', 'clockDomainId', 'operationId', 'workerEpoch', 'enteredMonoNs', 'operationCutoffMonoNs']);
  if (JSON.stringify(request) !== JSON.stringify(expectedRequest) || expectedOperation && JSON.stringify(operation) !== JSON.stringify(expectedOperation)) fail('authority_required');
  if (request.profile !== PRODUCT_PROFILE || ['requestId', 'handleId', 'credentialBindingId', 'clockDomainId'].some(k => operation[k] !== request[k])) fail('authority_required');
  if (Object.keys(request).length !== 10 || Object.keys(operation).length !== 8) fail('invalid_input');
  for (const key of ['requestId', 'handleId', 'credentialBindingId', 'clockDomainId']) id(request[key]);
  if (!Number.isSafeInteger(request.admissionUtcMs) || request.admissionUtcMs < 0 ||
      request.credentialExpiresUtcMs !== null && (!Number.isSafeInteger(request.credentialExpiresUtcMs) || request.credentialExpiresUtcMs < 0)) fail('invalid_input');
  id(operation.operationId);
  if (!Number.isSafeInteger(operation.workerEpoch) || operation.workerEpoch < 1 || mono(operation.enteredMonoNs) < mono(request.admittedMonoNs) ||
      mono(operation.operationCutoffMonoNs) > mono(request.requestCutoffMonoNs) ||
      request.credentialCutoffMonoNs !== null && mono(operation.operationCutoffMonoNs) > mono(request.credentialCutoffMonoNs)) fail('invalid_input');
  const span = mono(request.requestCutoffMonoNs) - mono(request.admittedMonoNs);
  if (span < 1000000n || span > 5000000000n || span % 1000000n ||
      request.credentialCutoffMonoNs !== (request.credentialExpiresUtcMs === null ? null : stamp(mono(request.admittedMonoNs) +
        BigInt(Math.max(0, request.credentialExpiresUtcMs - request.admissionUtcMs)) * 1000000n))) fail('invalid_input');
}
