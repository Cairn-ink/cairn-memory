import { spawnSync } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { privateRead, privateRemove, privateWrite, syncDirectory } from '../../../integrations/client/private-state.mjs';
import { entry, pinColdFile, privateFile } from '../../adapter-sqlite/src/legacy/paths.mjs';
import { cutoverRefusal as refuse, withColdStoreLease } from './local-cutover-lease.mjs';
import { parseStrictJSON } from './local-descriptor.mjs';

const phases = ['staging', 'exchanging', 'sealed', 'reclaimed', 'active'];
const pathFor = maintenance => join(maintenance, 'activation.json');
const retiredFor = ({ sourcePath, attemptId }) => join(dirname(sourcePath), '.cairn-retired-' + attemptId);
const tombstone = 'Cairn local store migrated. This path is retired.\n';
const inode = info => info && [info.dev, info.ino].join(':');

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

export function assertNoLegacyCaches(source) {
  const suffixes = ['.raw-search', '.context-read-v1.sqlite', '.context-read-product-v1.1.sqlite'];
  if (suffixes.some(suffix => ['', '-wal', '-shm', '-journal'].some(extra => entry(source + suffix + extra)))) {
    throw refuse('cutover_legacy_cache_present');
  }
}

// Atomic exchange leaves no instant in which an old SQLite opener can create
// a fresh database at the registered pathname. Both names are in one private
// directory. There is no non-atomic fallback.
function exchange(source, retired, identity) {
  const result = spawnSync('/usr/bin/python3', ['-I', '-c', `
import ctypes, os, signal, sys
libc = ctypes.CDLL(None, use_errno=True)
# Stop a pending helper if setup dies. Recovery must be the only process
# that can perform a second exchange for the same names.
if libc.prctl(1, signal.SIGKILL, 0, 0, 0) or os.getppid() != int(sys.argv[3]):
    sys.exit(1)
source = os.stat(sys.argv[1], follow_symlinks=False)
if f'{source.st_dev}:{source.st_ino}' != sys.argv[4]:
    sys.exit(1)
exchange = libc.renameat2
exchange.argtypes = (ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint)
if exchange(-100, os.fsencode(sys.argv[1]), -100, os.fsencode(sys.argv[2]), 2):
    raise OSError(ctypes.get_errno(), 'renameat2')
`, source, retired, String(process.pid), identity], { env: {}, stdio: 'ignore', timeout: 5000, killSignal: 'SIGKILL' });
  if (result.error || result.status !== 0) throw refuse('cutover_exchange_unavailable');
}

async function assertTombstone(path) {
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
  if (receipt.phase === 'exchanging' && inode(entry(source)) === receipt.source) {
    assertNoLegacyCaches(source);
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
  assertCompanionsClosed(source);
  assertNoLegacyCaches(source);
  if (receipt.phase === 'exchanging') {
    if (inode(privateFile(retired)) !== receipt.source) throw refuse('cutover_activation_changed');
    // A writer may have been waiting on the original inode. Re-prove that
    // all such handles closed and that the bytes still match the backup.
    await withColdStoreLease(retired, async assertLease => {
      await proveRetired(retired, assertLease);
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
  return advance;
}

export async function abortRetirement(cutover, receipt, reclaim) {
  if (!receipt) return reclaim();
  if (!['staging', 'exchanging'].includes(receipt.phase)) throw refuse('cutover_activation_confirmed');
  const source = cutover.sourcePath, retired = retiredFor(cutover);
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
