import { boundedData, coverage } from './context-product-control.mjs';
import { contextReadSet } from './context-read-input.mjs';
import { ownData } from './local-authority-input.mjs';
import { fail } from './validation.mjs';
const writerKey = Symbol.for('context-read-product-v1.1/maintenance-writers');
export function claimMaintenanceWriter(identity, readSet) {
  const writers = globalThis[writerKey] ??= new Set();
  const key = JSON.stringify([identity,readSet]);
  if (writers.has(key)) fail('read_in_progress');
  writers.add(key);
  let released = false;
  return () => { if (!released) { released=true;writers.delete(key); } };
}

// This is trusted host issuance state, never an operation's kind flag. The
// Worker independently obtains the exact grant from its local host adapter.
export function serviceIssuance(value, readSet, ownerCoverage) {
  if (!value) fail('authority_required');
  const b = boundedData(value);
  ownData(b,['kind','serviceId','credentialBindingId','credentialExpiresUtcMs','credentialDigest','ownerId','namespaces','issuedAt','ownerGeneration']);
  if (b.kind !== 'service') fail('authority_required');
  if (['serviceId','credentialBindingId'].some(k => typeof b[k] !== 'string' || !/^[\x00-\x7f]{1,64}$/.test(b[k])) ||
      !Number.isSafeInteger(b.issuedAt) || b.issuedAt<0 || !/^[A-Za-z0-9_-]{43}$/.test(b.credentialDigest) ||
      b.credentialExpiresUtcMs !== null && (!Number.isSafeInteger(b.credentialExpiresUtcMs) || b.credentialExpiresUtcMs<0) ||
      b.ownerGeneration !== undefined && (!Number.isSafeInteger(b.ownerGeneration) || b.ownerGeneration<1)) fail('invalid_input');
  const ns = ownData(b.namespaces,['readSet','ownerCoverage']);
  if (b.ownerId !== readSet[0].ownerId || JSON.stringify(contextReadSet(ns.readSet)) !== JSON.stringify(readSet) ||
      JSON.stringify(boundedData(coverage(ns.ownerCoverage,readSet))) !== JSON.stringify(boundedData(ownerCoverage))) fail('authority_required');
  return b;
}
