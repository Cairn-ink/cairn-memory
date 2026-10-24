import { readFileSync } from 'node:fs';
import { sha256, fail } from './auth.mjs';
import { hostV2Cost } from './cost.mjs';

export const EXTENSION_COMMIT = '4fb90832';
export const HOST_V2_SHA256 = '5eba1bd4448b17ce51598d1d561ff66280740573830c7ddc55a9b3271c79422b';
export const HOST_V2_IMPLEMENTATION = '42627f60';
export const HOST_V2_LIMITATIONS = 'Exploratory fixed additive default-Memory calibration; not shipped-host token counts. UUID/text tokenization, later completeness transitions, cross-item sameAs deduplication, non-default metadata, sourceAccess and Cards are not modelled faithfully.';

export function authenticateHostV2(bytes = readFileSync(new URL('./overhead-host-v2.json', import.meta.url))) {
  if (sha256(bytes) !== HOST_V2_SHA256) fail('host_v2_constants_hash');
  const file = JSON.parse(bytes);
  return { id: 'host-v2', implementationCommit: file.implementationCommit, sha256: HOST_V2_SHA256,
    constants: { ...file.constants }, bodyTokens: file.bodyTokens };
}

function exact(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) || Array.isArray(b)) return false;
  const keys = Object.keys(a).sort(), expected = Object.keys(b).sort();
  return JSON.stringify(keys) === JSON.stringify(expected) && keys.every(key => exact(a[key], b[key]));
}

// Called only after the legacy-or-exact-string discriminator has been checked.
export function authenticateHostRun(run, { scored = false } = {}) {
  const model = authenticateHostV2();
  if (run.overhead !== 'host-v2' || !exact(run.overheadModel, model) || run.extensionCommit !== EXTENSION_COMMIT ||
      (Object.hasOwn(run, 'overheadModelDigest') && run.overheadModelDigest !== model.sha256) ||
      (scored && run.overheadModelDigest !== model.sha256)) fail('invalid_host_v2_model');
  if (run.budget < model.constants.envelope) fail('context_item_too_large');
  return hostV2Cost(model);
}
