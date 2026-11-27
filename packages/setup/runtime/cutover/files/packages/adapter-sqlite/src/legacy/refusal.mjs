import { CONTEXT_READ_SCHEMA_VERSIONS } from '../../../../core/database.mjs';

// The engine's context reader includes the intermediate Raw and safety layouts.
export const LEGACY_LAYOUTS = Object.freeze([...CONTEXT_READ_SCHEMA_VERSIONS].sort((a, b) => a - b));
export const LEGACY_RULES = Object.freeze({
  readablePhysicalLayouts: LEGACY_LAYOUTS,
  firstPossibleSuccessor: Math.max(...LEGACY_LAYOUTS) + 1,
  openPin: Object.freeze(['storeId', 'physical', 'base', 'suppressionRevision',
    'cardLineageRevision', 'receiptEventTime', 'localRawPrivacy']),
});

export class LegacyRefusal extends Error {
  constructor(code) {
    super(code);
    this.name = 'LegacyRefusal';
    this.code = code;
  }
}

export function assertLegacyLayout(physical) {
  if (!LEGACY_LAYOUTS.includes(physical)) throw new LegacyRefusal('legacy_unknown_layout');
}

// Exact pins matter even at the same physical version. Attested families can
// acquire a different feature set while leaving user_version unchanged.
export function assertLegacyOpen(actual, expected) {
  assertLegacyLayout(expected?.physical);
  if (actual?.physical > expected.physical) throw new LegacyRefusal('legacy_downgrade');
  assertLegacyLayout(actual?.physical);
  if (!actual.storeId || actual.storeId !== expected.storeId) throw new LegacyRefusal('legacy_foreign_store');
  if (LEGACY_RULES.openPin.some(field => actual[field] === undefined || actual[field] !== expected[field])) {
    throw new LegacyRefusal('legacy_cross_version');
  }
}

// A range check for a proposed future version. The migration must supply an
// allocated number and attest the target schema separately.
export function assertForwardTarget(source, target) {
  assertLegacyLayout(source);
  if (!Number.isInteger(target) || target < 1 || target > 0x7fffffff) {
    throw new LegacyRefusal('legacy_unknown_layout');
  }
  if (target < source) throw new LegacyRefusal('legacy_downgrade');
  if (target < LEGACY_RULES.firstPossibleSuccessor) throw new LegacyRefusal('legacy_cross_version');
}
