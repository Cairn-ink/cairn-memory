import { fail } from './validation.mjs';

// Deliberately finite: reserved cells and S2c are not supported by this binary.
const cells = new Map([[34, 18], [38, 23], [48, 33]]);
export const SAFETY_SCHEMA_VERSIONS = Object.freeze([...cells.keys()]);
export function resolveContentLayout(physical) {
  if (!Number.isSafeInteger(physical) || physical < 0 || physical > 33 && !cells.has(physical)) fail('unsupported_database');
  const base = cells.get(physical) ?? physical;
  return Object.freeze({ physical, base, suppressionRevision: cells.has(physical) ? 1 : 0,
    cardLineageRevision: 0, cards: base >= 20, raw: base >= 24, rawCapture: base >= 25,
    rawLineage: base >= 26, rawDeletion: base >= 27, rawSources: base >= 28,
    localControls: base >= 29, methods: base >= 30, assets: base >= 31,
    roles: base >= 32, currentDependencies: base >= 33 });
}
export function safetyPhysicalVersion(base) {
  for (const [physical, layout] of cells) if (base === layout) return physical;
  fail('unsupported_database');
}
export function assertContentFeatures(layout, options) {
  for (const [option, capability] of Object.entries({ privateCards: 'cards', rawConversations: 'raw',
    rawCapture: 'rawCapture', rawLineage: 'rawLineage', rawDeletion: 'rawDeletion', rawSources: 'rawSources',
    localControls: 'localControls', methodPackages: 'methods', assets: 'assets', roleProfiles: 'roles',
    currentDependencies: 'currentDependencies' })) {
    if (options[option] && !layout[capability]) fail('unsupported_database');
  }
}
export function contentSafetyPin(layout, storeId) {
  return layout.suppressionRevision ? Object.freeze({ version: 'content-safety-existing-v1', storeId,
    physical: layout.physical, base: layout.base, suppressionRevision: 1, cardLineageRevision: 0 }) :
    Object.freeze({ version: 'schema29-existing-v1', storeId });
}
