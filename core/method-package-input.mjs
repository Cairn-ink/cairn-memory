import { types } from 'node:util';
import { redactSecrets } from '../plugins/cairn-memory/lib/redact.mjs';
import { cardNamespace, sourceRef } from './private-card-input.mjs';
import { evidenceRef } from './private-evidence-input.mjs';
import { denseArray, fail, identifier, object, revision } from './validation.mjs';

export const METHOD_METHODS = Object.freeze(['importMethodVersion','getMethodVersion','listMethodManifest',
  'readMethodFile','listMethodPackages','listMethodVersions','compareMethodVersions',
  'deleteMethodVersion','deleteMethodPackage','listMethodEffects','getMethodPackageUsage',
  'adoptMethodVersion','disableMethodBinding','resolveMethod','resolveMethodsForRole','listMethodBindingEvents']);
export const METHOD_READS = new Set(METHOD_METHODS.filter(name => !['importMethodVersion','deleteMethodVersion','deleteMethodPackage','adoptMethodVersion','disableMethodBinding'].includes(name)));
export const METHOD_LIMITS = Object.freeze({ packages: 256, versions: 128, bindings: 1024, files: 64, fileUnits: 100_000,
  versionUnits: 1_000_000, pathUnits: 512, reasonRefs: 16, changeItems: 32, changeUnits: 500,
  ownerBytes: 50_000_000, partUnits: 4000, pageItems: 20, responseBytes: 65536 });
export const METHOD_MEDIA = Object.freeze(['text/markdown','text/plain','application/json','application/yaml','text/csv']);
export function methodPackageOptions(value) {
  if (value === undefined) return undefined;
  object(value, ['version','storage','authority']);
  if (value.version !== 'method-packages-local-v1' || value.storage !== 'local-plain-v1') fail('invalid_input');
  object(value.authority, ['authorize','isCurrent']);
  if (typeof value.authority.authorize !== 'function' || typeof value.authority.isCurrent !== 'function') fail('authority_required');
  return Object.freeze({ ...value, authority: Object.freeze({ ...value.authority }) });
}
// Separate import budget: Card snapshots intentionally retain their original limits.
export function methodSnapshot(value, depth = 0, budget = { nodes: 16384, units: 3_300_000 }) {
  if (--budget.nodes < 0 || depth > 16) fail('invalid_input');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.length > 100_000) fail('invalid_input');
    budget.units -= value.length;
    if (budget.units < 0) fail('invalid_input');
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || types.isProxy(value) ||
      ![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(value))) fail('invalid_input');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length > budget.nodes ||
      Reflect.ownKeys(descriptors).some(key => typeof key !== 'string')) fail('invalid_input');
  if (Array.isArray(value)) {
    denseArray(value, 0, 128);
    return Array.from({ length: value.length }, (_, i) => {
      if (!Object.hasOwn(descriptors[i], 'value')) fail('invalid_input');
      return methodSnapshot(descriptors[i].value, depth + 1, budget);
    });
  }
  const result = {};
  for (const key of Object.keys(descriptors).sort()) {
    if (key === '__proto__' || !Object.hasOwn(descriptors[key], 'value')) fail('invalid_input');
    budget.units -= key.length;
    if (budget.units < 0) fail('invalid_input');
    result[key] = methodSnapshot(descriptors[key].value, depth + 1, budget);
  }
  return result;
}
export const sameNamespace = (a,b) => ['ownerId','scope','projectId'].every(key => a[key] === b[key]);
export function methodPackageRef(value) {
  object(value, ['type','namespace','packageId']);
  if (value.type !== 'method-package') fail('invalid_input');
  return { type: value.type, namespace: cardNamespace(value.namespace), packageId: identifier(value.packageId) };
}
export function methodVersionRef(value) {
  object(value, ['type','namespace','packageId','versionId','manifestIdentity']);
  if (value.type !== 'method-version' || typeof value.manifestIdentity !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(value.manifestIdentity)) fail('invalid_input');
  return { type: value.type, namespace: cardNamespace(value.namespace), packageId: identifier(value.packageId),
    versionId: identifier(value.versionId), manifestIdentity: value.manifestIdentity };
}
export function methodRole(value) {
  if (value === null) return '*';
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]{1,200}$/.test(value)) fail('invalid_input');
  return value;
}
export function methodReadSet(value) {
  const namespaces = denseArray(value, 1, 2).map(cardNamespace);
  if (namespaces.some(ns => ns.ownerId !== namespaces[0].ownerId) ||
      namespaces.length === 2 && namespaces[0].scope === namespaces[1].scope) fail('invalid_input');
  return namespaces.sort((a,b) => a.scope === b.scope ? 0 : a.scope === 'personal' ? -1 : 1);
}
export function methodContext(value) {
  object(value, ['readSet','roleId']);
  methodRole(value.roleId);
  return { readSet: methodReadSet(value.readSet), roleId: value.roleId };
}
export function methodBindingRef(value) {
  object(value,['type','bindingNamespace','package','roleKey','revision']);
  if (value.type !== 'method-binding') fail('invalid_input');
  if (value.roleKey !== '*') methodRole(value.roleKey);
  revision(value.revision);
  return { type:value.type, bindingNamespace:cardNamespace(value.bindingNamespace),package:methodPackageRef(value.package),roleKey:value.roleKey,revision:value.revision };
}
export function methodReasons(value, ns) {
  const refs=denseArray(value===undefined?[]:value,0,16).map(ref=>methodReasonRef(ref,ns));
  if(new Set(refs.map(ref=>JSON.stringify(ref))).size!==refs.length)fail('invalid_input');
  return refs;
}
export const includesNamespace = (readSet, ns) => readSet.some(value=>sameNamespace(value,ns));
export function methodPath(value) {
  if (typeof value !== 'string' || !value.isWellFormed() || !value || value.length > 512 ||
      /[\\\0]/.test(value) || value.startsWith('/') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) ||
      value.split('/').some(part => !part || part === '.' || part === '..')) fail('invalid_path');
  return value;
}
function text(value, maximum, required = false) {
  if (typeof value !== 'string' || !value.isWellFormed() || value.includes('\0') || value.length > maximum ||
      required && !value.trim()) fail('invalid_input');
  const clean = redactSecrets(value);
  if (clean.length > maximum) fail('invalid_input');
  return clean;
}
export function methodFiles(values) {
  let units = 0, retainedUnits = 0;
  const paths = new Set();
  const files = denseArray(values, 1, 64).map(file => {
    object(file, ['path','text','mediaType']);
    const path = methodPath(file.path), folded = path.toLowerCase();
    if (paths.has(folded)) fail('invalid_path');
    paths.add(folded);
    if (!METHOD_MEDIA.includes(file.mediaType)) fail('unsupported_media');
    const clean = text(file.text, 100_000);
    units += file.text.length; retainedUnits += clean.length;
    return { path, text: clean, mediaType: file.mediaType };
  });
  if (units > 1_000_000 || retainedUnits > 1_000_000) fail('invalid_input');
  return files;
}
export function methodReasonRef(value, ns) {
  const namespace = cardNamespace(value?.namespace);
  if (!sameNamespace(namespace, ns)) fail('method_not_found');
  if (['memory','card'].includes(value.type)) return evidenceRef(value, ns);
  if (['submitted-note','receipt','raw'].includes(value.type)) {
    try { return sourceRef(value, ns, true); }
    catch (error) { if (error.code === 'source_unavailable') fail('invalid_input'); throw error; }
  }
  fail('invalid_input');
}
export function methodChange(value, ns) {
  if (value === undefined) return undefined;
  object(value, ['items','reasonRefs']);
  const items = denseArray(value.items ?? [], 0, 32).map(item => {
    object(item, ['summary','paths']);
    const paths = denseArray(item.paths, 0, 128).map(methodPath);
    if (new Set(paths).size !== paths.length) fail('invalid_path');
    return { summary: text(item.summary, 500, true), paths };
  });
  const reasonRefs = denseArray(value.reasonRefs ?? [], 0, 16).map(ref => methodReasonRef(ref, ns));
  if (new Set(reasonRefs.map(ref => JSON.stringify(ref))).size !== reasonRefs.length) fail('invalid_input');
  return { items, reasonRefs };
}
export function methodPageLimit(value = 20) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 20) fail('invalid_input');
  return value;
}
export function validateMethodCall(method, input) {
  const fields = {
    importMethodVersion: ['namespace','actionId','package','expectedPackageRevision','basedOn','title','submittedBy','files','change'],
    getMethodVersion: ['version','intent','context','snapshot'],
    listMethodManifest: ['version','intent','context','snapshot','cursor'],
    readMethodFile: ['version','path','intent','context','snapshot','cursor'],
    listMethodPackages: ['namespace','limit','cursor'], listMethodVersions: ['package','context','limit','cursor'],
    compareMethodVersions: ['from','to','cursor'], deleteMethodVersion: ['actionId','ref','expectedRevision'],
    deleteMethodPackage: ['actionId','ref','expectedRevision'], listMethodEffects: ['namespace','limit','cursor'],
    getMethodPackageUsage: ['namespace'],
    adoptMethodVersion: ['bindingNamespace','actionId','package','roleId','version','expectedRevision','readSet','reasonRefs'],
    disableMethodBinding: ['bindingNamespace','actionId','package','roleId','expectedRevision','readSet','reasonRefs'],
    resolveMethod: ['readSet','package','roleId'], resolveMethodsForRole: ['readSet','roleId','limit','cursor'],
    listMethodBindingEvents: ['bindingNamespace','package','limit','cursor'],
  };
  object(input, fields[method]);
  if (Object.hasOwn(input,'context')) methodContext(input.context);
  if (Object.hasOwn(input,'snapshot') && (typeof input.snapshot !== 'string' || !input.snapshot || input.snapshot.length>65536)) fail('invalid_input');
  if (['getMethodVersion','listMethodManifest','readMethodFile'].includes(method)) {
    if (!['history','current'].includes(input.intent) || input.intent==='current' && input.context===undefined) fail('invalid_input');
  }
  if (input.cursor !== undefined && (typeof input.cursor !== 'string' || input.cursor.length > 8192)) fail('invalid_cursor');
  if (Object.hasOwn(input, 'limit')) methodPageLimit(input.limit);
  if (!METHOD_READS.has(method)) identifier(input.actionId);
  if (['adoptMethodVersion','disableMethodBinding'].includes(method)) {
    const ns=cardNamespace(input.bindingNamespace), ref=methodPackageRef(input.package), readSet=methodReadSet(input.readSet);
    methodRole(input.roleId);
    if (input.expectedRevision!==null)revision(input.expectedRevision);
    if (!(sameNamespace(ns,ref.namespace) || ns.ownerId===ref.namespace.ownerId && ns.scope==='project' && ref.namespace.scope==='personal') ||
        !includesNamespace(readSet,ns) || !includesNamespace(readSet,ref.namespace)) fail('method_not_found');
    if (method==='adoptMethodVersion') {
      const version=methodVersionRef(input.version);
      if (!sameNamespace(version.namespace,ref.namespace) || version.packageId!==ref.packageId)fail('method_not_found');
    }
    denseArray(input.reasonRefs===undefined?[]:input.reasonRefs,0,16).forEach(ref=>cardNamespace(ref?.namespace));
    return ns;
  }
  if (['resolveMethod','resolveMethodsForRole'].includes(method)) {
    const readSet=methodReadSet(input.readSet);methodRole(input.roleId);
    if(method==='resolveMethod' && methodPackageRef(input.package).namespace.ownerId!==readSet[0].ownerId)fail('method_not_found');
    return readSet[0];
  }
  if (method==='listMethodBindingEvents') {
    const ns=cardNamespace(input.bindingNamespace);
    if(input.package!==undefined && methodPackageRef(input.package).namespace.ownerId!==ns.ownerId)fail('method_not_found');
    return ns;
  }
  if (method === 'importMethodVersion') {
    const ns = cardNamespace(input.namespace);
    if (input.package !== undefined) {
      const ref = methodPackageRef(input.package), base = methodVersionRef(input.basedOn);
      revision(input.expectedPackageRevision);
      if (!sameNamespace(ns, ref.namespace) || !sameNamespace(ns, base.namespace) || ref.packageId !== base.packageId) fail('method_not_found');
    } else if (Object.hasOwn(input, 'expectedPackageRevision') || input.basedOn !== undefined && input.basedOn !== null) fail('invalid_input');
    text(input.title, 200, true);
    if (input.submittedBy !== undefined) text(input.submittedBy, 200);
    methodFiles(input.files);
    // Canonical reason validation follows separate read authorization.
    if (input.change !== undefined) {
      object(input.change, ['items','reasonRefs']);
      denseArray(input.change.reasonRefs ?? [], 0, 16).forEach(ref => cardNamespace(ref.namespace));
    }
    return ns;
  }
  if (method.startsWith('delete')) {
    revision(input.expectedRevision);
    return (method === 'deleteMethodVersion' ? methodVersionRef(input.ref) : methodPackageRef(input.ref)).namespace;
  }
  if (['getMethodVersion','listMethodManifest','readMethodFile'].includes(method)) {
    if (method === 'readMethodFile') methodPath(input.path);
    const ref=methodVersionRef(input.version);
    return input.context===undefined ? ref.namespace : methodContext(input.context).readSet[0];
  }
  if (method === 'listMethodVersions') { const ref=methodPackageRef(input.package);return input.context===undefined?ref.namespace:methodContext(input.context).readSet[0]; }
  if (method === 'compareMethodVersions') {
    const from = methodVersionRef(input.from), to = methodVersionRef(input.to);
    if (!sameNamespace(from.namespace, to.namespace) || from.packageId !== to.packageId) fail('method_not_found');
    return from.namespace;
  }
  return cardNamespace(input.namespace);
}
export const methodLabel = (value, required = false) => text(value, 200, required);
