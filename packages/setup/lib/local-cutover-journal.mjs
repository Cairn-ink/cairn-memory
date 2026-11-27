import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { legacyEngineIdPattern } from './local-engine-generation.mjs';

export const cutoverSteps = ['staged', 'quiesced', 'backup-proved', 'migrated', 'verified'];
export const cutoverId = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(value);
export const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const prefix = '.cairn-cutover-';
const storeTag = source => createHash('sha256').update(source).digest('hex');
export const legacyTargetFor = (source, id) => join(dirname(source), prefix + id + '.sqlite');
export const targetFor = (source, id) => join(dirname(source), prefix + storeTag(source) + '-' + id + '.sqlite');
const capturePrefix = 'cairn-capture-';
export const captureTargetFor = (source, id) => join(dirname(source), capturePrefix + storeTag(source) + '-' + id + '.sqlite');
export function activeVector({ migration }, vector) {
  const { cutover } = migration;
  return migration.state === 'verified' && !cutover.aborting && !cutover.reclaiming &&
    vector.engineId === migration.targetEngineId && vector.databasePath === captureTargetFor(cutover.sourcePath, cutover.attemptId);
}
export function taggedCutoverAttemptForName(source, name) {
  const match = /^\.cairn-cutover-([a-f0-9]{64})-([a-f0-9-]{36})\.sqlite(?:\.stale)?(?:-wal|-shm|-journal)?$/u.exec(name);
  if (match?.[0] !== name || !cutoverId(match[2]) || match[1] !== storeTag(source)) return undefined;
  return match[2];
}
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
  const reclaiming = Object.hasOwn(cutover, 'reclaiming');
  if (!exact(cutover, 'id attemptId sourcePath targetPath previousUpdatedAt source backup result aborting' +
      (reclaiming ? ' reclaiming' : '')) ||
      (reclaiming && (cutover.reclaiming !== true || migration.state !== 'paused-recovery' || !atLeast(migration, 'quiesced'))) ||
      !cutoverId(cutover.id) || !cutoverId(cutover.attemptId) || cutover.sourcePath !== database.path ||
      ![targetFor(database.path, cutover.attemptId), legacyTargetFor(database.path, cutover.attemptId)].includes(cutover.targetPath) ||
      !iso(cutover.previousUpdatedAt) ||
      typeof cutover.aborting !== 'boolean' ||
      (state !== 'installed' && (!['pending', 'uninstalling', 'uninstalled'].includes(state) ||
        migration.state !== 'verified' || cutover.aborting || reclaiming)) ||
      (state === 'pending' && descriptor.engine?.id !== migration.targetEngineId) ||
      !cutoverSteps.includes(checkpointOf(migration)) ||
      Object.values(clients).some(receipt => receipt && !legacyEngineIdPattern.test(receipt.vector?.engineId) &&
        (!receipt.vector || !activeVector(descriptor, receipt.vector)))) return false;
  if (atLeast(migration, 'quiesced') ? !exact(cutover.source, 'storeId layout') ||
      !validIdentifier(cutover.source.storeId) || ![18, 29, 48, 53].includes(cutover.source.layout) : cutover.source !== null) return false;
  if (atLeast(migration, 'backup-proved') ? !exact(cutover.backup, 'logicalDigest byteDigest sourceDigest sourceIdentity') ||
      !Object.values(cutover.backup).every(digest) : cutover.backup !== null) return false;
  return atLeast(migration, 'migrated') ? validResult(cutover.result, validIdentifier) : cutover.result === null;
}
