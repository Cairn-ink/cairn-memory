import { HR2B_VERSION, compareIds } from './fixture.mjs';

export const HR2B_FIXED = Object.freeze({ format: 'hr2b-ranking-configuration-v1', fixtureVersion: HR2B_VERSION,
  arms: ['A1', 'A3--bge-m3'], fusion: { method: 'rrf', k: 60, depth: 12, weights: [.45, .45] },
  lexical: 'A1', horizon: 24, scale: 'S1000', namespaces: ['target', 'foreign'], isolationVariant: 'with-foreign',
  documents: 'body', dense: { repository: 'Xenova/bge-m3', revision: '4de13258303883538bd53b696b452bf8099f0858',
    pooling: 'cls', normalization: 'L2', maxLength: 8192 } });
export const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort(compareIds).map(key => [key, canonical(value[key])])) : value;
export const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
export const hr2bConfiguration = hashes => ({ ...HR2B_FIXED, fixtureHashes: hashes });
export function checkHR2bConfiguration(configuration, hashes) {
  if (!equal(configuration, hr2bConfiguration(hashes))) throw new Error('hr2b_fixed_configuration_mismatch');
}
export function checkHR2bOptions(options) {
  if (!equal([...options.arms].sort(), ['A1', 'A3']) || !equal(options.models, ['bge-m3']) ||
      options.scale !== 'S1000' || (options.isolationVariant ?? 'with-foreign') !== 'with-foreign' ||
      options.selectionPath || (options.lexical && options.lexical !== 'A1')) throw new Error('hr2b_fixed_options_required');
}
