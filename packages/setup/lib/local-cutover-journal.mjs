import { dirname, join } from 'node:path';
import { legacyEngineIdPattern } from './local-engine-generation.mjs';

export const cutoverSteps = ['staged', 'quiesced', 'backup-proved', 'migrated', 'verified'];
export const cutoverId = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(value);
export const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
export const targetFor = (source, id) => join(dirname(source), '.cairn-cutover-' + id + '.sqlite');
export const checkpointOf = migration => migration.resumeFrom ?? migration.state;
export const atLeast = (migration, step) => cutoverSteps.indexOf(checkpointOf(migration)) >= cutoverSteps.indexOf(step);

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const expected = keys.split(' ');
  return Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
}
const count = value => Number.isSafeInteger(value) && value >= 0;
export const evidenceKeys = ['sessionFences', 'hideWindows', 'uuidFences', 'excludedSpans', 'rawDeletionActions', 'rawDeletionEffects'];

function validResult(result, validIdentifier) {
  return exact(result, 'migrationId attestation targetDigest rawDeletionEvidence captureControls') &&
    cutoverId(result.migrationId) && digest(result.attestation) && digest(result.targetDigest) &&
    exact(result.rawDeletionEvidence, evidenceKeys.join(' ')) &&
    evidenceKeys.every(key => count(result.rawDeletionEvidence[key])) &&
    exact(result.captureControls, 'namespaces disabledAutomaticCapture rawControls pausedOwners digest') &&
    digest(result.captureControls.digest) && count(result.captureControls.disabledAutomaticCapture) &&
    count(result.captureControls.rawControls) &&
    Array.isArray(result.captureControls.pausedOwners) && result.captureControls.pausedOwners.length === 0 &&
    Array.isArray(result.captureControls.namespaces) && result.captureControls.namespaces.every(ns =>
      exact(ns, 'ownerId scope projectId generation paused enabled') && validIdentifier(ns.ownerId) &&
      validIdentifier(ns.generation) && typeof ns.paused === 'boolean' && typeof ns.enabled === 'boolean' &&
      (ns.scope === 'personal' && ns.projectId === null || ns.scope === 'project' && validIdentifier(ns.projectId)));
}

export function validCutover(descriptor, iso, validIdentifier) {
  const { migration, state, database, clients } = descriptor;
  const cutover = migration.cutover;
  if (!exact(cutover, 'id attemptId sourcePath targetPath previousUpdatedAt source backup result aborting') ||
      !cutoverId(cutover.id) || !cutoverId(cutover.attemptId) || cutover.sourcePath !== database.path ||
      cutover.targetPath !== targetFor(database.path, cutover.attemptId) || !iso(cutover.previousUpdatedAt) ||
      typeof cutover.aborting !== 'boolean' || state !== 'installed' ||
      !cutoverSteps.includes(checkpointOf(migration)) ||
      Object.values(clients).some(receipt => receipt && !legacyEngineIdPattern.test(receipt.vector?.engineId))) return false;
  if (atLeast(migration, 'quiesced') ? !exact(cutover.source, 'storeId layout') ||
      !validIdentifier(cutover.source.storeId) || ![18, 29, 48, 53].includes(cutover.source.layout) : cutover.source !== null) return false;
  if (atLeast(migration, 'backup-proved') ? !exact(cutover.backup, 'logicalDigest byteDigest sourceDigest sourceIdentity') ||
      !Object.values(cutover.backup).every(digest) : cutover.backup !== null) return false;
  return atLeast(migration, 'migrated') ? validResult(cutover.result, validIdentifier) : cutover.result === null;
}
