import { object, denseArray, identifier, revision, fail } from './validation.mjs';
import { methodContext, methodPackageRef, methodVersionRef, includesNamespace, sameNamespace } from './method-package-input.mjs';
import { canonicalJSON } from './task-receipt.mjs';

export const CARD_CURRENT_VERSION = 'card-current-dependencies-v1';
export const CARD_CURRENT_METHODS = Object.freeze(['declareCardCurrentDependencies', 'revalidateCardCurrentDependencies']);
export function currentDeclaration(value, namespace) {
  object(value, ['context', 'packages']);
  const context = methodContext(value.context);
  if (!includesNamespace(context.readSet, namespace)) fail('invalid_input');
  const packages = denseArray(value.packages, 1, 16).map(entry => {
    object(entry, ['package', 'snapshot']);
    const pkg = methodPackageRef(entry.package);
    if (!includesNamespace(context.readSet, pkg.namespace) || typeof entry.snapshot !== 'string' || !entry.snapshot.length || entry.snapshot.length > 16384) fail('invalid_input');
    return { package: pkg, snapshot: entry.snapshot };
  });
  if (new Set(packages.map(entry => canonicalJSON(entry.package))).size !== packages.length) fail('invalid_input');
  return { context, packages };
}
export function currentCall(input, namespace) {
  object(input, ['namespace', 'cardId', 'actionId', 'expectedRevision', 'expectedDependencyRevision', 'currentDependencies']);
  identifier(input.cardId); identifier(input.actionId); revision(input.expectedRevision);
  if (input.expectedDependencyRevision !== null) revision(input.expectedDependencyRevision);
  return currentDeclaration(input.currentDependencies, namespace);
}
export function dependencyLevels(context) {
  return [...context.readSet].reverse().flatMap(namespace => (context.roleId === null ? ['*'] : [context.roleId, '*']).map(roleKey => ({ namespace, roleKey })));
}
// Persisted observations are deliberately allowed to lag mutable Card/binding revisions.
export function validateDependencyRecord(contextText, vectorText, namespace) {
  const context = JSON.parse(contextText), vector = JSON.parse(vectorText);
  if (canonicalJSON(methodContext(context)) !== contextText || canonicalJSON(vector) !== vectorText || !includesNamespace(context.readSet, namespace)) fail('invalid_input');
  const keys = new Set();
  for (const entry of denseArray(vector, 1, 16)) {
    object(entry, ['package', 'version', 'consulted', 'availability']);
    const pkg = methodPackageRef(entry.package), version = methodVersionRef(entry.version);
    if (!includesNamespace(context.readSet, pkg.namespace) || !sameNamespace(pkg.namespace, version.namespace) || pkg.packageId !== version.packageId || keys.has(canonicalJSON(pkg))) fail('invalid_input');
    keys.add(canonicalJSON(pkg));
    object(entry.availability, ['packageState', 'versionState', 'versionRevision']);
    if (entry.availability.packageState !== 'available' || entry.availability.versionState !== 'available' || entry.availability.versionRevision !== 1) fail('invalid_input');
    const levels = dependencyLevels(context), consulted = denseArray(entry.consulted, 1, levels.length);
    for (let i = 0; i < consulted.length; i++) {
      const b = consulted[i]; object(b, ['namespace', 'roleKey', 'revision', 'state', 'version']);
      if (canonicalJSON({ namespace: b.namespace, roleKey: b.roleKey }) !== canonicalJSON(levels[i])) fail('invalid_input');
      if (i < consulted.length - 1) { if (b.revision !== null || b.state !== null || b.version !== null) fail('invalid_input'); }
      else if (b.state !== 'active' || !revision(b.revision) || canonicalJSON(b.version) !== canonicalJSON(version)) fail('invalid_input');
    }
  }
  return { context, vector };
}
