import { fail } from '../../core/validation.mjs';
import { prepareSelectionChecklist } from './query-evidence-checklist.mjs';

const key = ref => JSON.stringify([ref.namespaceIndex, ref.memoryId, ref.revision]);

function selectionRefs(output) {
  if (!output || typeof output !== 'object' || Array.isArray(output) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(output))) fail('invalid_model_output');
  const names = Reflect.ownKeys(output);
  if (names.length !== 1 || names[0] !== 'refs') fail('invalid_model_output');
  const descriptor = Object.getOwnPropertyDescriptor(output, 'refs');
  if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail('invalid_model_output');
  if (!Array.isArray(descriptor.value) || Object.getPrototypeOf(descriptor.value) !== Array.prototype) {
    fail('invalid_model_output');
  }
  return descriptor.value;
}

/** Evaluation-only padding of validated selections; core freshness remains authoritative. */
export function prepareBoundedSelection(value) {
  const prepared = prepareSelectionChecklist(value);
  const input = prepared.request.input;
  return { input, augment(output) {
    let refs;
    try {
      // One full-query span reuses mechanical reference validation, not a
      // generated query decomposition or an assertion of semantic coverage.
      refs = prepared.compile({ requests: [{ start: 0, end: input.query.length,
        refs: selectionRefs(output) }] }).selection.refs;
    } catch { fail('invalid_model_output'); }
    const baseRefCount = refs.length;
    if (baseRefCount) {
      const seen = new Set(refs.map(key));
      const counts = new Map();
      for (const ref of refs) counts.set(ref.namespaceIndex, (counts.get(ref.namespaceIndex) ?? 0) + 1);
      for (const map of input.maps) {
        for (const item of map.items) {
          if (refs.length >= input.maxRefs || (counts.get(map.namespaceIndex) ?? 0) >= 12) break;
          const memory = item.type === 'unfiled' ? item.ref :
            item.type === 'ref' && item.ref.childType === 'memory' ?
              { memoryId: item.ref.childId, revision: item.ref.childRevision } : null;
          if (!memory) continue;
          const ref = { namespaceIndex: map.namespaceIndex, ...memory };
          const identity = key(ref);
          if (seen.has(identity)) continue;
          seen.add(identity);
          refs.push(ref);
          counts.set(map.namespaceIndex, (counts.get(map.namespaceIndex) ?? 0) + 1);
        }
      }
    }
    return { selection: { refs }, diagnostics: { strategy: 'seed-preserving-map-order',
      baseRefCount, addedRefCount: refs.length - baseRefCount, semanticCoverage: 'unassessed' } };
  } };
}
