import { basename, dirname, join } from 'node:path';
import { privateList, privateRead, privateRemove, syncDirectory } from '../../../integrations/client/private-state.mjs';
import { entry } from '../../adapter-sqlite/src/legacy/paths.mjs';
import { captureTargetFor, cutoverId, legacyTargetFor, taggedCutoverAttemptForName, targetFor } from './local-cutover-journal.mjs';
import { cutoverRefusal as refuse } from './local-cutover-lease.mjs';
import { canonicalPath, inside, ownedDirectory, parseStrictJSON, removeCutoverDirectory } from './local-descriptor.mjs';

const suffixes = ['', '-wal', '-shm', '-journal'];
const uid = BigInt(process.getuid?.() ?? -1);
export const maintenanceFor = (root, id) => join(root, '.cutover-' + id);
export const backupFor = (maintenance, attempt) => join(maintenance, 'backup-' + attempt);

const ownFile = info => info?.isFile() && info.uid === uid;
const privateFile = info => ownFile(info) && (info.mode & 0o7777n) === 0o600n;
const privateDirectory = info => info?.isDirectory() && info.uid === uid && (info.mode & 0o7777n) === 0o700n;
const stageName = name => /^\.legacy-backup-[A-Za-z0-9]{6}$/u.test(name);
const backupId = name => name.startsWith('backup-') && cutoverId(name.slice(7)) ? name.slice(7) : undefined;

async function storeDirectory(source) {
  const parent = dirname(source);
  if (basename(source).startsWith('.cairn-cutover-') || await canonicalPath(parent) !== parent ||
      (entry(source) && await canonicalPath(source) !== source)) {
    throw refuse('cutover_unsafe_artifact');
  }
  return await ownedDirectory(parent, { missing: true }) ? parent : undefined;
}

async function reclaimTargets(source, targets, checkpoint) {
  const parent = await storeDirectory(source);
  if (parent) {
    const { cleanMigrationBootstraps } = await import('../../adapter-sqlite/src/legacy/migration-bootstrap.mjs');
    for (const path of targets) {
      cleanMigrationBootstraps(path);
      const names = ['', '.stale'].flatMap(tail => suffixes.map(suffix => path + tail + suffix));
      const files = names.filter(file => entry(file));
      if (files.some(file => {
        const info = entry(file);
        return !privateFile(info) || info.nlink !== 1n;
      })) throw refuse('cutover_unsafe_artifact');
      for (const file of files) await privateRemove(file);
    }
    await syncDirectory(parent);
  }
  await checkpoint('reclaim-target');
}

async function reclaimBackup(directory, name) {
  const path = join(directory, name);
  const stage = stageName(name);
  await removeCutoverDirectory(path, names => names.every(file => {
    const info = entry(join(path, file));
    if (info?.nlink !== 1n) return false;
    if (file === 'proof.json') return privateFile(info);
    // SQLite can leave a staging file before the backup code sets its mode.
    return suffixes.some(suffix => file === 'store.sqlite' + suffix) &&
      (stage ? ownFile(info) : privateFile(info));
  }));
}

export async function reclaimAttempt(maintenance, { sourcePath, attemptId, targetPath, reclaimCapture = false }, checkpoint) {
  if (inside(maintenance, sourcePath)) throw refuse('cutover_unsafe_artifact');
  // A journal supplies the exact target. Historical maintenance receipts
  // can identify an attempt by UUID alone and cover both naming generations.
  const targets = [...(reclaimCapture ? [captureTargetFor(sourcePath, attemptId)] : []),
    ...(targetPath ? [targetPath] : [targetFor(sourcePath, attemptId), legacyTargetFor(sourcePath, attemptId)])];
  await reclaimTargets(sourcePath, targets, checkpoint);
  const names = await privateList(maintenance);
  for (const name of names) {
    if (backupId(name) === attemptId || stageName(name)) await reclaimBackup(maintenance, name);
  }
  await syncDirectory(maintenance);
  await checkpoint('reclaim-backup');
}

function metadataOnly(directory, names) {
  const records = new Map();
  for (const name of names) {
    const match = /^(maintenance|stale|claude|codex|capture-claude|capture-codex)\.json(?:\.tmp-\d+-([a-f0-9-]{36}))?$/u.exec(name);
    const info = entry(join(directory, name));
    if (match?.[0] !== name || (match[2] && !cutoverId(match[2])) || !privateFile(info)) return false;
    const key = match[1] + ':' + info.dev + ':' + info.ino;
    const record = records.get(key) ?? { count: 0n, links: info.nlink };
    record.count++;
    records.set(key, record);
  }
  // Exclusive private writes can be interrupted with both names still linked.
  // Every link must be accounted for inside this maintenance directory.
  return [...records.values()].every(({ count, links }) => count === links);
}

export async function assertReclaimedMaintenance(directory) {
  if (!metadataOnly(directory, await privateList(directory))) throw refuse('cutover_unsafe_artifact');
}

export async function reclaimMaintenance(root, directory) {
  await removeCutoverDirectory(directory, names => metadataOnly(directory, names));
  await syncDirectory(root);
}

async function readMarker(path) {
  if (!privateFile(entry(path))) return undefined;
  const text = await privateRead(path);
  try { return parseStrictJSON(text); }
  catch { return undefined; }
}

async function maintenanceAttempts(directory, source, id) {
  const path = join(directory, 'maintenance.json');
  if (entry(path)) {
    const marker = await readMarker(path);
    if (!marker || Object.keys(marker).length !== 3 || marker.id !== id ||
        marker.sourcePath !== source || marker.maintenance !== true) return undefined;
    return [id];
  }
  // Older aborts removed the source marker and kept a receipt in the
  // installation's private maintenance directory.
  const stale = await readMarker(join(directory, 'stale.json'));
  if (stale && Object.keys(stale).length === 1 && cutoverId(stale.attemptId)) return [stale.attemptId];
  return undefined;
}

export async function reclaimPastAttempts(root, source, active, checkpoint) {
  const parent = await storeDirectory(source);
  for (const name of await privateList(root)) {
    if (!name.startsWith('.cutover-') || !cutoverId(name.slice(9))) continue;
    const id = name.slice(9), directory = maintenanceFor(root, id);
    if (inside(directory, source) || !privateDirectory(entry(directory))) continue;
    const current = active?.id === id;
    const attempts = current ? [] : await maintenanceAttempts(directory, source, id);
    if (!attempts) continue;
    if (!current && ['capture-claude.json', 'capture-codex.json'].some(file => entry(join(directory, file))) &&
        attempts.some(attempt => suffixes.some(suffix => entry(captureTargetFor(source, attempt) + suffix)))) {
      throw refuse('cutover_capture_journal_required');
    }
    const stages = [];
    for (const file of await privateList(directory)) {
      const attemptId = backupId(file);
      if (attemptId) attempts.push(attemptId);
      if (stageName(file)) stages.push(file);
    }
    for (const attemptId of new Set(attempts)) {
      if (attemptId !== active?.attemptId) await reclaimAttempt(directory, { sourcePath: source, attemptId }, checkpoint);
    }
    // A kill can precede publication of the first archive.
    for (const stage of stages) await reclaimBackup(directory, stage);
    await syncDirectory(directory);
    if (!current) {
      await reclaimMaintenance(root, directory);
      await checkpoint('reclaim-maintenance');
    }
  }
  // The exact reserved namespace in the canonical store directory also
  // covers sidecar-only leftovers after journal loss. Ignore other store
  // tags, lookalike names, links and entries outside the private file contract.
  if (!parent) return;
  let found = false;
  for (const name of await privateList(parent)) {
    const attemptId = taggedCutoverAttemptForName(source, name);
    if (!attemptId || attemptId === active?.attemptId && !active.aborting) continue;
    const file = join(parent, name), info = entry(file);
    if (privateFile(info) && info.nlink === 1n) {
      await privateRemove(file);
      found = true;
    }
  }
  await syncDirectory(parent);
  if (found) await checkpoint('reclaim-orphans');
}
