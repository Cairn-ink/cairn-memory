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
