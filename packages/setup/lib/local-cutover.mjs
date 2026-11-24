import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { processStart } from '../../../adapters/mcp/local-daemon-liveness.mjs';
import { privateDirectory, privateRead, privateRemove, privateWrite, syncDirectory } from '../../../integrations/client/private-state.mjs';
import { stateLock } from '../../../integrations/client/state-lock.mjs';
import { entry } from '../../adapter-sqlite/src/legacy/paths.mjs';
import { withCutoverCapture } from './local-cutover-capture.mjs';
import { atLeast, checkpointOf, evidenceKeys, targetFor } from './local-cutover-journal.mjs';
import { cutoverRefusal as refuse, withColdStoreLease } from './local-cutover-lease.mjs';
import { boundedJSON, canonicalPath, executableFor, ownedDirectory, readDescriptor, removeCutoverMaintenance,
  retireCutoverTarget, withLocalLock, writeDescriptor } from './local-descriptor.mjs';
import { checkCoreLocalConfig } from './local-engine.mjs';
import { runLocalDaemon } from './local-mode.mjs';

const quiescence = Object.freeze({ admissionsClosed: true, writersStopped: true, readersDrained: true, oldHandlesClosed: true });
const maintenanceFor = (root, id) => join(root, '.cutover-' + id);
const backupFor = (maintenance, attempt) => join(maintenance, 'backup-' + attempt);

function sourceIdentity(path) {
  const file = entry(path);
  if (!file) throw refuse('legacy_backup_stale');
  const fields = [file.dev, file.ino, file.size, file.ctimeNs, file.mtimeNs];
  return createHash('sha256').update(fields.join(':')).digest('hex');
}

function parseDaemon(result) {
  if (result.code !== 0) throw refuse('cutover_daemon_unavailable');
  try { return JSON.parse(result.stdout); }
  catch { throw refuse('cutover_daemon_unavailable'); }
}

function drainDaemon(root, descriptor, env) {
  const stop = parseDaemon(runLocalDaemon('stop', root, descriptor, env, 'pipe'));
  if (stop?.still_running !== 0) throw refuse('cutover_daemon_busy');
  const status = parseDaemon(runLocalDaemon('status', root, descriptor, env, 'pipe'));
  if (!Array.isArray(status?.daemons) || status.daemons.some(entry => entry?.running !== false)) {
    throw refuse('cutover_daemon_busy');
  }
}

async function recoverCutoverLock(root) {
  const path = join(root, '.setup.lock');
  if (!entry(path)) return;
  const descriptor = await readDescriptor(root, { allowV2: true });
  if (!descriptor?.migration?.cutover) return;
  const owner = await boundedJSON(path, 1024, { privateFile: true });
  if (!Number.isSafeInteger(owner.pid) || owner.pid < 1 || owner.child !== null) return;
  const live = processStart(owner.pid);
  if (!live || live.zombie) await privateRemove(path);
}

async function writeMarker(directory, cutover) {
  const path = join(directory, 'maintenance.json');
  const expected = JSON.stringify({ id: cutover.id, sourcePath: cutover.sourcePath, maintenance: true }) + '\n';
  if (!entry(path)) await privateWrite(path, expected, { exclusive: true });
  if (await privateRead(path) !== expected) throw refuse('cutover_maintenance_changed');
}

async function retireTarget(cutover) {
  if (!await retireCutoverTarget(cutover.targetPath)) return false;
  await syncDirectory(dirname(cutover.targetPath));
  return true;
}

function attestResult(result, inventory) {
  const { rawDeletionEvidence: actual, captureControls: controls } = result;
  const { raw, forgetLogs, pause } = inventory.privacy;
  if (!actual || evidenceKeys.some(key => !Number.isSafeInteger(actual[key]) || actual[key] < 0) ||
      actual.sessionFences < (raw?.sessionFences ?? 0) || actual.hideWindows < (raw?.hideWindows ?? 0) ||
      actual.uuidFences < (raw?.uuidFences ?? 0) || actual.excludedSpans < (raw?.excludedSpans ?? 0) ||
      actual.rawDeletionActions !== (forgetLogs.rawDeletionActions ?? 0) ||
      actual.rawDeletionEffects !== (forgetLogs.rawDeletionEffects ?? 0) ||
      result.storeId !== inventory.storeId || result.sourceLayout !== inventory.physical) {
    throw refuse('cutover_raw_evidence_incomplete');
  }
  if (!controls || controls.pausedOwners.length || controls.namespaces.length !== pause.scopedControls ||
      controls.namespaces.filter(scope => scope.paused).length !== pause.pausedScopes ||
      controls.namespaces.filter(scope => !scope.enabled).length !== pause.disabledScopes ||
      controls.disabledAutomaticCapture !== (pause.localAutomaticCaptureDisabled ?? 0)) {
    throw refuse('cutover_capture_evidence_incomplete');
  }
}

async function prepare(root, descriptor, maintenance, env, onCheckpoint, onMigrationCheckpoint) {
  const path = descriptor.database.path;
  const { migration } = descriptor, { cutover } = migration;
  let lastSaved = structuredClone(migration);
  const checkpoint = async state => {
    migration.state = state;
    delete migration.resumeFrom;
    await writeDescriptor(root, descriptor);
    lastSaved = structuredClone(migration);
    await onCheckpoint(state, structuredClone(cutover));
  };
  const recovery = async state => {
    migration.state = 'paused-recovery';
    migration.resumeFrom = state;
    await writeDescriptor(root, descriptor);
  };
  try {
    await writeMarker(maintenance, cutover);
    return await withCutoverCapture(root, maintenance, path, false, async () => {
      drainDaemon(root, descriptor, env);
      return withColdStoreLease(path, async assertLease => {
        const { inventoryLegacyStore } = await import('../../adapter-sqlite/src/legacy/inventory.mjs');
        const { byteDigest, createLegacyBackup, verifyLegacyBackupAgainstSource } = await import('../../adapter-sqlite/src/legacy/backup.mjs');
        const { migrateLegacyStore } = await import('../../adapter-sqlite/src/migrate/index.mjs');
        const inventory = inventoryLegacyStore(path, { expectedStoreId: cutover.source?.storeId });
        if (![18, 29, 48, 53].includes(inventory.physical)) throw refuse('legacy_cross_version');
        if (atLeast(migration, 'backup-proved') && cutover.source.layout !== inventory.physical) {
          throw refuse('legacy_backup_stale');
        }
        if (cutover.source?.layout !== inventory.physical) {
          cutover.source = { storeId: inventory.storeId, layout: inventory.physical };
          await assertLease();
          await checkpoint('quiesced');
        }
        const input = { path, backupDirectory: backupFor(maintenance, cutover.attemptId), expectedStoreId: inventory.storeId, quiescence };
        const reattest = async () => {
          const proof = verifyLegacyBackupAgainstSource(input);
          const sourceDigest = byteDigest(path);
          const identity = sourceIdentity(path);
          await assertLease();
          const report = { logicalDigest: proof.logicalDigest, byteDigest: proof.byteDigest, sourceDigest, sourceIdentity: identity };
          if (cutover.backup && Object.keys(report).some(key => cutover.backup[key] !== report[key])) {
            throw refuse('legacy_backup_stale');
          }
          return report;
        };
        if (!atLeast(migration, 'backup-proved')) {
          if (!entry(input.backupDirectory)) await createLegacyBackup(input);
          cutover.backup = await reattest();
          await checkpoint('backup-proved');
        } else {
          await reattest();
        }
        if (!atLeast(migration, 'migrated')) {
          await assertLease();
          const result = await migrateLegacyStore({ ...input, destination: cutover.targetPath,
            reportCutoverEvidence: true, onCheckpoint: onMigrationCheckpoint });
          attestResult(result, inventory);
          const { migrationId, attestation, rawDeletionEvidence, captureControls } = result;
          const targetDigest = byteDigest(cutover.targetPath);
          await assertLease();
          cutover.result = { migrationId, attestation, targetDigest, rawDeletionEvidence, captureControls };
          await checkpoint('migrated');
        }
        if (!entry(cutover.targetPath) || byteDigest(cutover.targetPath) !== cutover.result.targetDigest) {
          throw refuse('cutover_target_changed');
        }
        // Finish with the canonical source proof, never a proof of the archival copy alone.
        await reattest();
        if (migration.state !== 'verified') await checkpoint('verified');
        return { state: 'verified', readyToActivate: true, targetPath: cutover.targetPath,
          pausedNamespaces: cutover.result.captureControls.namespaces.filter(scope => scope.paused || !scope.enabled) };
      });
    });
  } catch (error) {
    Object.assign(cutover, lastSaved.cutover);
    if (error.code === 'legacy_backup_stale' || error.code === 'cutover_target_changed') {
      await retireTarget(cutover);
      cutover.attemptId = randomUUID();
      cutover.targetPath = targetFor(path, cutover.attemptId);
      cutover.backup = cutover.result = null;
      await recovery('quiesced');
    } else {
      await recovery(checkpointOf(lastSaved));
    }
    throw error;
  }
}

async function abort(root, descriptor, maintenance) {
  const { migration } = descriptor, { cutover } = migration;
  cutover.aborting = true;
  await writeDescriptor(root, descriptor);
  if (await ownedDirectory(maintenance, { missing: true })) {
    const hadTarget = await retireTarget(cutover);
    await withCutoverCapture(root, maintenance, cutover.sourcePath, true, async () => {
      if (hadTarget) {
        await privateWrite(join(maintenance, 'stale.json'), JSON.stringify({ attemptId: cutover.attemptId }) + '\n');
        await privateRemove(join(maintenance, 'maintenance.json'));
        await syncDirectory(maintenance);
      } else {
        await removeCutoverMaintenance(root, cutover.id);
        await syncDirectory(root);
      }
    });
  }
  delete descriptor.migration;
  descriptor.version = 'cairn-local-installation-v1';
  descriptor.updatedAt = cutover.previousUpdatedAt;
  await writeDescriptor(root, descriptor, { preserveUpdatedAt: true });
  return { state: 'aborted' };
}

// Explicit checkout-only entry point. Leave non-Linux and existing stdio
// sessions alone. A busy lease asks the operator to close those sessions and
// retry. Successful readiness is point-in-time and must be re-attested at activation.
export async function runLocalCutover({ root, manifest, action = 'prepare', env = {}, platform = process.platform,
  onCheckpoint = async () => {}, onMigrationCheckpoint }) {
  if (platform !== 'linux' || process.platform !== 'linux') throw refuse('cutover_platform');
  if (!['prepare', 'abort'].includes(action) || !entry(root) || await canonicalPath(root) !== root) throw refuse('cutover_arguments');
  return stateLock(join(root, '.cutover.lock'), async () => {
    await recoverCutoverLock(root);
    return withLocalLock(root, async () => {
      const descriptor = await readDescriptor(root, { allowV2: true });
      if (descriptor?.state !== 'installed') throw refuse('cutover_installation_required');
      let migration = descriptor.migration;
      if (descriptor.version === 'cairn-local-installation-v2' && !migration?.cutover) throw refuse('cutover_journal_required');
      if (action === 'abort' && !migration) return { state: 'aborted' };
      if (migration?.cutover.aborting || action === 'abort') {
        return abort(root, descriptor, maintenanceFor(root, migration.cutover.id));
      }
      const { engine, database } = descriptor;
      const executable = executableFor(root, engine.id), path = database.path;
      if (!entry(executable) || !entry(path) || await canonicalPath(executable) !== executable || await canonicalPath(path) !== path ||
          basename(path).startsWith('.cairn-cutover-')) throw refuse('cutover_unsafe_path');
      const targetEngineId = manifest?.engineId;
      if (migration && migration.targetEngineId !== targetEngineId) throw refuse('cutover_candidate_changed');
      await checkCoreLocalConfig({ appDirectory: join(root, 'engine', targetEngineId ?? '', 'app'),
        manifest, engineId: targetEngineId, node: descriptor.node });
      if (!migration) {
        const id = randomUUID();
        const cutover = { id, attemptId: id, sourcePath: path, targetPath: targetFor(path, id),
          previousUpdatedAt: descriptor.updatedAt, source: null, backup: null, result: null, aborting: false };
        descriptor.version = 'cairn-local-installation-v2';
        migration = descriptor.migration = { state: 'staged', sourceEngineId: engine.id, targetEngineId, cutover };
        await writeDescriptor(root, descriptor);
        await onCheckpoint('staged', structuredClone(cutover));
      }
      const maintenance = maintenanceFor(root, migration.cutover.id);
      if (!entry(maintenance)) {
        await privateDirectory(maintenance);
        await syncDirectory(root);
      }
      await ownedDirectory(maintenance);
      return prepare(root, descriptor, maintenance, env, onCheckpoint, onMigrationCheckpoint);
    });
  });
}
