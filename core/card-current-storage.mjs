import { performance } from 'node:perf_hooks';
import { createMethodPackageStorage } from './method-package-storage.mjs';
import { currentDeclaration, validateDependencyRecord } from './card-current-input.mjs';
import { canonicalJSON } from './task-receipt.mjs';
import { includesNamespace, methodPackageRef, methodContext } from './method-package-input.mjs';
import { privateBoundary as boundary, privateWhere as where } from './private-operation-helpers.mjs';
import { fail } from './validation.mjs';

export const hasCardCurrentDependencies = (db, check) => {
  check?.();
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE name='card_current_dependencies' AND type='table'").get());
};
// Conditional fences preserve every legacy byte when this projection has no declarations.
// Generations schedule reconciliation only; the comparator below decides currentness.
export function cardDependencyFence(db, namespace, readSet = [namespace]) {
  if (!hasCardCurrentDependencies(db) || !db.prepare(`SELECT 1 FROM card_current_dependencies WHERE ${where} LIMIT 1`).get(...boundary(namespace))) return {};
  return { currentDependencies: readSet.map(ns => db.prepare(`SELECT generation FROM method_epochs WHERE ${where}`).get(...boundary(ns))?.generation ?? 1) };
}
export function createCardCurrentStorage({ db, identity }) {
  let reader;
  const methods = check => { check?.(); return reader ??= createMethodPackageStorage({ db, identity, ready() {} }).roleRead; };
  const row = (ns, id, check) => {
    if (!hasCardCurrentDependencies(db, check)) return null;
    check?.();
    return db.prepare(`SELECT * FROM card_current_dependencies WHERE card_id=? AND ${where}`).get(id, ...boundary(ns));
  };
  function observation(pkg, context, check) {
    pkg = methodPackageRef(pkg); context = methodContext(context);
    const found = methods(check).stateFor(pkg, context, [], check);
    const { value, state } = found;
    return { found, entry: { package: pkg, version: value.version, consulted: state.consulted,
      availability: { packageState: state.lifecycle.packageState, versionState: state.lifecycle.versionState, versionRevision: state.lifecycle.versionRevision } } };
  }
  function compare(ns, card, readSet = [ns], { deadlineAt = Infinity } = {}) {
    const withinDeadline = () => { if (deadlineAt !== Infinity && performance.now() >= deadlineAt) fail('evidence_unavailable'); };
    const check = deadlineAt === Infinity ? undefined : withinDeadline;
    check?.();
    const saved = row(ns, card.id, check); if (!saved) return null;
    const local = { revision: saved.revision, status: 'needs-review', reasons: ['access_revoked'] };
    const { context, vector } = validateDependencyRecord(saved.context, saved.vector, ns);
    // No target/binding/manifest lookup may precede this complete-context check.
    if (!context.readSet.every(scope => includesNamespace(readSet, scope))) return local;
    const reasons = new Set(), versions = [];
    if (card.revision !== saved.card_revision || (card.body_revision ?? card.bodyRevision) !== saved.body_revision) reasons.add('binding_changed');
    for (const old of vector) {
      check?.();
      const { found, entry } = observation(old.package, context, check);
      check?.();
      const status = found.value.status;
      // The winning target already received U2 metadata/ownership verification.
      // A different described target can only add lifecycle diagnostics; it
      // cannot establish currentness and needs no second manifest scan.
      const describedAvailable = status === 'current' && canonicalJSON(found.value.version) === canonicalJSON(old.version) ? true : methods(check).targetLifecycle(old.version.namespace, old.version, check).available;
      if (!describedAvailable || found.state.lifecycle.packageState === 'deleted' || found.state.lifecycle.versionState === 'deleted') reasons.add('version_deleted');
      if (status === 'no-active-version') reasons.add('binding_absent_now');
      if (status === 'disabled') reasons.add('binding_disabled');
      if (canonicalJSON(entry) !== canonicalJSON(old)) reasons.add('binding_changed');
      versions.push({ described: old.version, current: status === 'current' ? found.value.version : null });
    }
    check?.();
    return { revision: saved.revision, context, status: reasons.size ? 'needs-review' : 'current',
      reasons: ['binding_changed','binding_absent_now','binding_disabled','version_deleted','access_revoked'].filter(reason => reasons.has(reason)), versions };
  }
  function write(ns, card, input, access) {
    const saved = row(ns, card.id), expected = input.expectedDependencyRevision;
    if ((saved?.revision ?? null) !== expected || card.revision !== input.expectedRevision || card.state !== 'confirmed') fail('revision_conflict');
    const declaration = currentDeclaration(input.currentDependencies, ns);
    let packages = declaration.packages;
    if (input.method === 'revalidateCardCurrentDependencies') {
      if (!saved) fail('revision_conflict');
      const old = JSON.parse(saved.vector);
      if (canonicalJSON(declaration.context) !== saved.context || packages.length !== old.length || old.some(entry => !packages.some(p => canonicalJSON(p.package) === canonicalJSON(entry.package)))) fail('revision_conflict');
      // Package identity is a set; retain the declaration's display order when
      // a reviewer supplies fresh snapshots in a different order.
      packages = old.map(entry => packages.find(p => canonicalJSON(p.package) === canonicalJSON(entry.package)));
    }
    const vector = packages.map(({ package: pkg, snapshot }) => {
      const { found, entry } = observation(pkg, declaration.context), reviewed = methods().decode(snapshot);
      const scoped = access.filter(grant => includesNamespace(declaration.context.readSet, grant.namespace));
      if (!reviewed || found.value.status !== 'current' || canonicalJSON(reviewed.context) !== canonicalJSON(declaration.context) ||
          canonicalJSON(reviewed.access) !== canonicalJSON(scoped) || reviewed.states.length !== 1 || canonicalJSON(reviewed.states[0]) !== canonicalJSON(found.state)) fail('revision_conflict');
      return entry;
    });
    const context = canonicalJSON(declaration.context), encoded = canonicalJSON(vector);
    if (Buffer.byteLength(encoded) > 32768) fail('invalid_input');
    validateDependencyRecord(context, encoded, ns);
    const revision = (saved?.revision ?? 0) + 1;
    if (saved) db.prepare('UPDATE card_current_dependencies SET revision=?,card_revision=?,body_revision=?,context=?,vector=? WHERE card_id=?').run(revision, card.revision, card.body_revision, context, encoded, card.id);
    else db.prepare('INSERT INTO card_current_dependencies VALUES(?,?,?,?,?,?,?,?,?)').run(card.id, ...boundary(ns), revision, card.revision, card.body_revision, context, encoded);
    return { id: card.id, revision: card.revision, bodyRevision: card.body_revision, dependencyRevision: revision, state: 'confirmed', effectCount: 0 };
  }
  return { compare, write, row };
}
