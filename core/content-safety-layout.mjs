import { fail } from './validation.mjs';
import { cardLineageRevision } from './content-safety-schema.mjs';

// Deliberately finite: legacy cells and per-base attested-feature families.
// The integer selects a family, never an installed feature or future revision.
const families = new Set([51, 52, 53]);
const cells = new Map([[34, 18], [38, 23], [48, 33], [51, 18], [52, 23], [53, 33]]);
export const SAFETY_SCHEMA_VERSIONS = Object.freeze([...cells.keys()]);
export function resolveContentLayout(physical) {
  if (!Number.isSafeInteger(physical) || physical < 0 || physical > 33 && !cells.has(physical)) fail('unsupported_database');
  const base = cells.get(physical) ?? physical;
  return Object.freeze({ physical, base, suppressionRevision: cells.has(physical) ? 1 : 0,
    cardLineageRevision: 0, attestedFeatures: families.has(physical), cards: base >= 20, raw: base >= 24, rawCapture: base >= 25,
    rawLineage: base >= 26, rawDeletion: base >= 27, rawSources: base >= 28,
    localControls: base >= 29, methods: base >= 30, assets: base >= 31,
    roles: base >= 32, currentDependencies: base >= 33 });
}
export function safetyPhysicalVersion(base) {
  for (const [physical, layout] of cells) if (base === layout) return physical;
  fail('unsupported_database');
}
export const supportsCardLineage = layout => layout.attestedFeatures && [23,33].includes(layout.base);
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
    physical: layout.physical, base: layout.base, suppressionRevision: 1, cardLineageRevision: cardLineageRevision(layout) }) :
    Object.freeze({ version: 'schema29-existing-v1', storeId });
}
