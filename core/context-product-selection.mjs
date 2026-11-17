import { types } from 'node:util';
import { ownData } from './local-authority-input.mjs';
import { cardNamespace, deepFreeze } from './private-card-input.mjs';
import { contextReadSet, namespaceKey } from './context-read-input.mjs';
import { coverage, PRODUCT_PROFILE } from './context-product-control.mjs';
import { fail } from './validation.mjs';

// Trusted host utility, never called by reader admission or lookup. Run inventory
// enumeration/selection in host background work; HTTP receives only the bounded
// result. ACL filtering and inventory snapshot/revision ownership are the host's.
// Keep only 31 project winners rather than sorting the entire inventory.
export function selectContextProductNamespaces(inventory, selectionRevision) {
  if (types.isProxy(inventory) || !Array.isArray(inventory) || Object.getPrototypeOf(inventory) !== Array.prototype) fail('invalid_input');
  const descriptors = Object.getOwnPropertyDescriptors(inventory);
  if (!inventory.length || Reflect.ownKeys(descriptors).length !== inventory.length + 1) fail('invalid_input');
  let personal, ownerId;
  const projects = [], seen = new Set();
  const compare = (a,b) => b.lastActiveAt - a.lastActiveAt ||
    Buffer.compare(Buffer.from(a.namespace.projectId), Buffer.from(b.namespace.projectId));
  for (let i = 0; i < inventory.length; i++) {
    if (!Object.hasOwn(descriptors[i] ?? {}, 'value')) fail('invalid_input');
    const entry = ownData(descriptors[i].value, ['namespace', 'lastActiveAt']);
    const namespace = cardNamespace(ownData(entry.namespace, ['ownerId', 'scope', 'projectId']));
    const lastActiveAt = Object.hasOwn(entry, 'lastActiveAt') ? entry.lastActiveAt : 0;
    if (!Number.isSafeInteger(lastActiveAt) || lastActiveAt < 0) fail('invalid_input');
    ownerId ??= namespace.ownerId;
    const key = namespaceKey(namespace);
    if (namespace.ownerId !== ownerId || seen.has(key)) fail('invalid_read_set');
    seen.add(key);
    if (namespace.scope === 'personal') personal = namespace;
    else {
      projects.push({ namespace, lastActiveAt }); projects.sort(compare);
      if (projects.length > 31) projects.pop();
    }
  }
  const readSet = contextReadSet([...(personal ? [personal] : []), ...projects.map(p => p.namespace)], PRODUCT_PROFILE);
  const ownerCoverage = coverage({ policy: 'recent-projects-v1', selectionRevision,
    requestedNamespaces: inventory.length, selectedNamespaces: readSet.length,
    omittedNamespaces: inventory.length - readSet.length }, readSet);
  return deepFreeze({ readSet, ownerCoverage });
}

// Product-private, per-read narrowing. This never changes the publication's
// readSet or its stream numbering. Inspect only scope descriptors at admission;
// derive retrieval keys only after the ordinary query grammar validates types.
export function contextProductReadSelection(payload, readSet, selectedTypes) {
  let namespaces;
  try {
    if (!payload || types.isProxy(payload)) fail('invalid_read_set');
    const descriptor = Object.getOwnPropertyDescriptor(payload, 'namespaces');
    if (!descriptor) return null;
    if (!Object.hasOwn(descriptor, 'value')) fail('invalid_read_set');
    namespaces = contextReadSet(descriptor.value, PRODUCT_PROFILE);
    if (namespaces.length > 2 || namespaces.filter(ns => ns.scope === 'personal').length !== 1 ||
        namespaces.some(ns => !readSet.some(full => namespaceKey(full) === namespaceKey(ns)))) fail('invalid_read_set');
  } catch { fail('invalid_read_set'); }
  if (namespaces.length === readSet.length) return null;
  if (!selectedTypes) return deepFreeze({ namespaces });
  let stream = 0;
  const streams = readSet.flatMap(ns => ['card', 'memory'].filter(type => selectedTypes.includes(type))
    .flatMap(type => (type === 'card' ? ['draft', 'confirmed', 'cancelled', 'deleted'] : ['memory'])
      .map(() => ({ ns, stream: stream++ }))))
    .filter(row => namespaces.some(ns => namespaceKey(ns) === namespaceKey(row.ns))).map(row => row.stream);
  const ranges = namespaces.map(namespace => {
    // Same JSON array encoding as document identity / vector item. The ASCII
    // successor of the boundary comma isolates the exact namespace, including
    // escaped and non-ASCII identifiers, without LIKE or per-row JSON parsing.
    const prefix = JSON.stringify([namespace.ownerId, namespace.scope, namespace.projectId ?? '']).slice(0, -1) + ',';
    return { namespace, lower: prefix, upper: prefix.slice(0, -1) + '-' };
  });
  return deepFreeze({ namespaces, streams, ranges });
}
export function assertContextProductSelection(selection, ref) {
  if (selection && !selection.namespaces.some(ns => namespaceKey(ns) === namespaceKey(ref.namespace))) fail('index_unavailable');
}
