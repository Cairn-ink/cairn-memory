import { basename, dirname, join } from 'node:path';
import { cutoverRefusal as refuse, exchange, localCutoverExclusion, withColdStoreLease } from './local-cutover-lease.mjs';
import { parseStrictJSON, removeCutoverDirectory } from './local-descriptor.mjs';
import { cutoverImport } from './local-cutover-runtime.mjs';

const { privateList, privateRead, privateRemove, privateWrite, syncDirectory } = await cutoverImport('state');
const { assertPrivateDirectory, entry, pinColdFile, privateFile } = await cutoverImport('paths');

const phases = ['staging', 'exchanging', 'sealed', 'reclaimed', 'active'];
const pathFor = maintenance => join(maintenance, 'activation.json');
const retiredFor = ({ sourcePath, attemptId }) => join(dirname(sourcePath), '.cairn-retired-' + attemptId);
const tombstone = 'Cairn local store migrated. This path is retired.\n';
const inode = info => info && [info.dev, info.ino].join(':');
const fenceState = { privateList, privateRead, privateWrite };

export async function readActivation(maintenance, cutover) {
  const text = await privateRead(pathFor(maintenance), { missing: true });
  if (text === undefined) return null;
  const value = parseStrictJSON(text);
  if (Object.keys(value ?? {}).length !== 5 || value.version !== 1 ||
      value.attempt !== cutover.attemptId || !phases.includes(value.phase) ||
      !/^\d+:\d+$/u.test(value.source ?? '') ||
      (value.phase === 'staging' ? value.target !== null : !/^\d+:\d+$/u.test(value.target ?? ''))) {
    throw refuse('cutover_activation_changed');
  }
  return value;
}

async function save(maintenance, receipt) {
  await privateWrite(pathFor(maintenance), JSON.stringify(receipt) + '\n');
}

export async function beginActivation(maintenance, cutover) {
  const file = pinColdFile(cutover.sourcePath);
  const receipt = { version: 1, attempt: cutover.attemptId, phase: 'staging', source: inode(file.stat), target: null };
  await save(maintenance, receipt);
  return receipt;
}

const cacheSuffixes = ['.raw-search', '.context-read-v1.sqlite', '.context-read-product-v1.1.sqlite'];
const companions = ['', '-wal', '-shm', '-journal'];

async function legacySiblingEntries(source) {
  const parent = dirname(source), device = assertPrivateDirectory(parent).dev;
  const files = [], directories = [];
  async function collect(path, allowDirectory) {
    const info = entry(path);
    if (!info) return;
    if (info.dev !== device) throw refuse('cutover_unsafe_artifact');
    if (allowDirectory && info.isDirectory()) {
      assertPrivateDirectory(path);
      for (const name of await privateList(path)) await collect(join(path, name), true);
      directories.push(path);
    } else files.push({ path, identity: inode(privateFile(path)) });
  }
  // The cold source proof has already ruled out an uncheckpointed journal.
  // These names may appear after the exchange while an old opener unwinds.
  for (const tail of companions.slice(1)) await collect(source + tail, false);
  for (const suffix of cacheSuffixes) {
    for (const tail of companions) await collect(source + suffix + tail, suffix === '.raw-search' && tail === '');
  }
  // Legacy sidecar creation may leave a private stage beside its final name.
  const names = await privateList(parent);
  for (const suffix of cacheSuffixes.slice(1)) {
    const prefix = '.' + basename(source) + suffix + '.cairn-create-';
    for (const name of names) {
      if (name.startsWith(prefix) && /^[1-9][0-9]*-[0-9a-f-]{36}(?:-wal|-shm|-journal)?$/u.test(name.slice(prefix.length))) {
        await collect(join(parent, name), false);
      }
    }
  }
  return { files, directories };
}

async function removeLegacySiblings(source) {
  const { files, directories } = await legacySiblingEntries(source);
  for (const { path, identity } of files) {
    await withColdStoreLease(path, async assertLease => {
      if (inode(privateFile(path)) !== identity) throw refuse('cutover_unsafe_artifact');
      await assertLease();
      await privateRemove(path);
      await syncDirectory(dirname(path));
    });
  }
  for (const path of directories) {
    assertPrivateDirectory(path);
    await removeCutoverDirectory(path, names => names.length === 0);
    await syncDirectory(dirname(path));
  }
}

export async function assertTombstone(path) {
  if (privateFile(path).size !== BigInt(Buffer.byteLength(tombstone)) || await privateRead(path) !== tombstone) {
    throw refuse('cutover_activation_changed');
  }
}

const assertCompanionsClosed = path => {
  if (['-wal', '-shm', '-journal'].some(suffix => entry(path + suffix))) {
    throw refuse('cutover_store_busy');
  }
};

export async function retireLegacy({ maintenance, cutover, receipt, targetIdentity, drain, reattest,
  proveRetired, onCheckpoint }) {
  const source = cutover.sourcePath, retired = retiredFor(cutover), parent = dirname(source);
  if (basename(source).startsWith('.cairn-retired-')) throw refuse('cutover_unsafe_path');
  const advance = async (phase, state) => {
    receipt.phase = phase;
    await save(maintenance, receipt);
    await onCheckpoint(state, structuredClone(cutover));
  };
  if (receipt.phase === 'staging') {
    receipt.target = targetIdentity;
    await advance('exchanging', 'activation-retirement-planned');
  }
  if (receipt.target !== targetIdentity) throw refuse('cutover_target_changed');
  const exclusion = localCutoverExclusion();
  if (exclusion.retireLegacy) {
    await exclusion.retireLegacy({ source, retired, tombstone, receipt, drain, proveRetired,
      assertTombstone, assertSiblings: () => legacySiblingEntries(source), state: fenceState, syncDirectory, advance,
      notify: state => onCheckpoint(state, structuredClone(cutover)) });
  } else {
    await retireWithExchange();
  }
  if (receipt.phase === 'sealed') {
    await removeLegacySiblings(source);
    await onCheckpoint('activation-caches-removed', structuredClone(cutover));
  }
  assertCompanionsClosed(source);
  return advance;

  async function retireWithExchange() {
    if (receipt.phase === 'exchanging' && inode(entry(source)) === receipt.source) {
      drain();
      await withColdStoreLease(source, async assertLease => {
        if (!entry(retired)) await privateWrite(retired, tombstone, { exclusive: true });
        await assertTombstone(retired);
        await reattest(assertLease);
        exchange(source, retired, receipt.source);
      });
      await syncDirectory(parent);
      await onCheckpoint('activation-source-exchanged', structuredClone(cutover));
    }
    await assertTombstone(source);
    if (receipt.phase === 'exchanging') {
      if (inode(privateFile(retired)) !== receipt.source) throw refuse('cutover_activation_changed');
      // A writer may have been waiting on the original inode. Re-prove that
      // all such handles closed and that the bytes still match the backup.
      await withColdStoreLease(retired, async assertLease => {
        await proveRetired(retired, assertLease);
        await legacySiblingEntries(source);
        await syncDirectory(parent);
        await advance('sealed', 'activation-legacy-sealed');
      });
    }
    if (receipt.phase === 'sealed' && entry(retired)) {
      await withColdStoreLease(retired, async assertLease => {
        if (inode(privateFile(retired)) !== receipt.source) throw refuse('cutover_activation_changed');
        await proveRetired(retired, assertLease);
        await privateRemove(retired);
        await syncDirectory(parent);
      });
      await onCheckpoint('activation-source-removed', structuredClone(cutover));
    }
  }
}

export async function abortRetirement(cutover, receipt, reclaim, notify) {
  if (!receipt) return reclaim();
  if (!['staging', 'exchanging'].includes(receipt.phase)) throw refuse('cutover_activation_confirmed');
  const source = cutover.sourcePath, retired = retiredFor(cutover);
  const exclusion = localCutoverExclusion();
  if (exclusion.abortRetirement) {
    return exclusion.abortRetirement({
      source, retired, tombstone, receipt, reclaim, assertTombstone, state: fenceState, syncDirectory, notify,
    });
  }
  if (inode(entry(source)) !== receipt.source) {
    if (receipt.phase !== 'exchanging' || inode(privateFile(retired)) !== receipt.source) throw refuse('cutover_activation_changed');
    await assertTombstone(source);
    assertCompanionsClosed(source);
    await withColdStoreLease(retired, async assertLease => {
      pinColdFile(retired).check();
      await reclaim();
      await assertLease();
      exchange(retired, source, receipt.source);
    });
  } else await reclaim();
  if (entry(retired)) {
    await assertTombstone(retired);
    await privateRemove(retired);
  }
  await syncDirectory(dirname(source));
}
