import { fail, MemoryStoreError } from './validation.mjs';
import { cardLineageRevision } from './content-safety-schema.mjs';

// Deliberately finite: legacy cells and per-base attested-feature families.
// The integer selects a family, never an installed feature or future revision.
export const RELATION_LAYOUTS = Object.freeze([18,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,38,48,51,52,53].map(v => v + 100));
const families = new Set([51, 52, 53]);
const cells = new Map([[34, 18], [38, 23], [48, 33], [51, 18], [52, 23], [53, 33]]);
export const SAFETY_SCHEMA_VERSIONS = Object.freeze([...cells.keys()]);
export function resolveContentLayout(physical) {
  const relationsRevision = RELATION_LAYOUTS.includes(physical) ? 1 : 0;
  const inherited = relationsRevision ? physical - 100 : physical;
  if (!Number.isSafeInteger(inherited) || inherited < 0 || inherited > 33 && !cells.has(inherited)) fail('unsupported_database');
  const base = cells.get(inherited) ?? inherited;
  return Object.freeze({ physical, base, relationsRevision, suppressionRevision: cells.has(inherited) ? 1 : 0,
    cardLineageRevision: 0, attestedFeatures: families.has(inherited), cards: base >= 20, raw: base >= 24, rawCapture: base >= 25,
    rawLineage: base >= 26, rawDeletion: base >= 27, rawSources: base >= 28,
    localControls: base >= 29, methods: base >= 30, assets: base >= 31,
    roles: base >= 32, currentDependencies: base >= 33 });
}
export function safetyPhysicalVersion(base) {
  for (const [physical, layout] of cells) if (base === layout) return physical;
  fail('unsupported_database');
}
export const supportsCardLineage = layout => layout.attestedFeatures && [23,33].includes(layout.base);
const rawCapabilityRefusals = new WeakSet();
export const isRawCapabilityRefusal = error => rawCapabilityRefusals.has(error);
export function assertContentFeatures(layout, options) {
  for (const [option, capability] of Object.entries({ privateCards: 'cards', rawConversations: 'raw',
    rawCapture: 'rawCapture', rawLineage: 'rawLineage', rawDeletion: 'rawDeletion', rawSources: 'rawSources',
    localControls: 'localControls', methodPackages: 'methods', assets: 'assets', roleProfiles: 'roles',
    currentDependencies: 'currentDependencies' })) {
    if (options[option] && !layout[capability]) {
      const error = new MemoryStoreError('unsupported_database');
      if (['raw', 'rawCapture', 'rawLineage', 'rawDeletion', 'rawSources', 'localControls'].includes(capability)) {
        rawCapabilityRefusals.add(error);
      }
      throw error;
    }
  }
}
export function contentSafetyPin(layout, storeId) {
  return layout.suppressionRevision ? Object.freeze({ version: 'content-safety-existing-v1', storeId,
    physical: layout.physical, base: layout.base, suppressionRevision: 1, cardLineageRevision: cardLineageRevision(layout) }) :
    Object.freeze({ version: 'schema29-existing-v1', storeId });
}
