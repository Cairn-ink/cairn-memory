import { spawnSync } from 'node:child_process';
import { linkSync, lstatSync, realpathSync, renameSync, unlinkSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const companions = ['-wal', '-shm', '-journal'];
const identity = info => info && [info.dev, info.ino].join(':');
const fingerprint = info => info && [identity(info), info.nlink, info.mode, info.size, info.mtimeNs, info.ctimeNs].join(':');

function entry(path) {
  try { return lstatSync(path, { bigint: true }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

function assertClosed(paths) {
  const result = spawnSync('/usr/sbin/lsof', ['-nP', '+w', '-Fp', '-f', '--', ...paths], {
    env: {}, encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL', maxBuffer: 65536,
  });
  // Multiple paths can produce a nonzero status even when a handle is found.
  if (result.stdout) return false;
  if (result.error || result.signal || result.status !== 1 || result.stderr) return undefined;
  return true;
}

// The installer holds the setup and capture locks while using this provider.
// The open-file scan is point-in-time. A stray writer can open before the
// rename, so attestation of the retired inode must prove the backup is current
// before the installer seals the receipt. A surviving handle pauses cutover.
export function darwinExclusion(refuse, { closed = assertClosed, rename = renameSync } = {}) {
  const changed = () => refuse('cutover_activation_changed');
  const stale = () => refuse('legacy_backup_stale');
  const names = path => [path, ...companions.map(suffix => path + suffix)];
  const owned = (info, directory = false) => info && info.uid === BigInt(process.getuid()) &&
    (info.mode & 0o7777n) === (directory ? 0o700n : 0o600n) &&
    (directory ? info.isDirectory() : info.isFile());
  const assertPrivate = (path, links = 1n) => {
    const info = entry(path);
    if (!owned(info) || info.nlink !== links) throw changed();
    return info;
  };
  function checkClosed(paths) {
    const existing = paths.filter(path => {
      const info = entry(path);
      if (info && !info.isFile()) throw changed();
      return info;
    });
    if (!existing.length) return;
    const result = closed(existing);
    if (result === false) throw refuse('cutover_busy');
    if (result !== true) throw refuse('cutover_exclusion_unavailable');
  }

  async function withColdStoreLease(path, work) {
    const paths = names(path);
    const inspect = () => paths.map(name => fingerprint(entry(name)));
    const before = inspect();
    const check = () => {
      checkClosed(paths);
      // Candidate staging removes its closed, empty WAL and shared index
      // under this barrier. Surviving or newly appearing names stay pinned.
      if (inspect().some((value, index) => (index === 0 || value !== undefined) &&
          before[index] !== value)) throw stale();
    };
    check();
    assertPrivate(path);
    return work(check);
  }

  function drainDaemon(stop, status) {
    const stopped = stop();
    const unsupported = result => result.code === 0 && result.stdout === 'daemon_platform\n';
    const parse = result => {
      if (result.code !== 0) throw refuse('cutover_daemon_unavailable');
      try { return JSON.parse(result.stdout); }
      catch { throw refuse('cutover_daemon_unavailable'); }
    };
    // On macOS the released legacy engine has only the stdio route.
    if (unsupported(stopped)) {
      if (!unsupported(status())) throw refuse('cutover_daemon_unavailable');
      return;
    }
    if (parse(stopped)?.still_running !== 0) throw refuse('cutover_daemon_busy');
    const current = parse(status());
    if (!Array.isArray(current?.daemons) || current.daemons.some(daemon => daemon?.running !== false)) {
      throw refuse('cutover_daemon_busy');
    }
  }

  function validateParent(source) {
    const parent = dirname(source);
    if (!owned(entry(parent), true) || realpathSync(parent) !== parent) throw changed();
    return parent;
  }

  // Stage a private link to the legacy inode before renaming the marker over
  // its registered pathname. The replacement is atomic, even if setup is killed.
  // A receipt in "exchanging" plus identical source/retired inodes identifies
  // a crash before the rename. Removing that link leaves the source intact.
  function assertLinked(source, retired, receipt) {
    if (receipt.phase !== 'exchanging' || identity(assertPrivate(source, 2n)) !== receipt.source ||
        identity(assertPrivate(retired, 2n)) !== receipt.source) throw changed();
  }

  function resetLink(source, retired, receipt) {
    if (!entry(retired)) return;
    assertLinked(source, retired, receipt);
    unlinkSync(retired);
  }

  async function cleanFence(path, tombstone, { privateList, privateRead }) {
    const parent = dirname(path), prefix = basename(path) + '.tmp-';
    for (const name of await privateList(parent)) {
      if (!name.startsWith(prefix) || !/^\d+-[a-f0-9-]{36}$/u.test(name.slice(prefix.length))) continue;
      // A killed privateWrite may have left an incomplete marker in its temp file.
      const temporary = join(parent, name);
      if (assertPrivate(temporary).size > BigInt(Buffer.byteLength(tombstone)) ||
          !tombstone.startsWith(await privateRead(temporary))) throw changed();
      unlinkSync(temporary);
    }
    if (entry(path)) {
      if (assertPrivate(path).size !== BigInt(Buffer.byteLength(tombstone)) ||
          await privateRead(path) !== tombstone) throw changed();
      unlinkSync(path);
    }
  }

  async function moveCompanions(from, to, checkpoint, sync) {
    for (const suffix of companions) {
      if (!entry(from + suffix)) continue;
      assertPrivate(from + suffix);
      if (entry(to + suffix)) throw changed();
      rename(from + suffix, to + suffix);
      await sync();
      await checkpoint();
    }
  }

  async function retireLegacy({ source, retired, tombstone, receipt, drain, proveRetired, assertTombstone,
    assertSiblings, state, syncDirectory, advance, notify }) {
    const parent = validateParent(source), fence = retired + '.fence';
    const sync = () => syncDirectory(parent);
    if (receipt.phase === 'exchanging' && identity(entry(source)) === receipt.source) {
      drain();
      checkClosed(names(source));
      resetLink(source, retired, receipt);
      await cleanFence(fence, tombstone, state);
      await state.privateWrite(fence, tombstone);
      await withColdStoreLease(source, async assertLease => {
        // Link/unlink changes ctime during recovery. The receipt pins the
        // inode and the attestation compares the exact bytes and logical rows.
        await proveRetired(source, assertLease);
        assertLease();
        if (identity(assertPrivate(source)) !== receipt.source) throw changed();
        linkSync(source, retired);
        await sync();
        await notify('activation-darwin-source-linked');
        assertLinked(source, retired, receipt);
        rename(fence, source);
      });
      await sync();
      await notify('activation-source-exchanged');
    }
    await assertTombstone(source);
    if (receipt.phase === 'exchanging') {
      if (identity(assertPrivate(retired)) !== receipt.source || entry(fence)) throw changed();
      checkClosed([...names(retired), ...names(source)]);
      await moveCompanions(source, retired, () => notify('activation-darwin-companion-retired'), sync);
      if (companions.some(suffix => entry(retired + suffix))) throw stale();
      await withColdStoreLease(retired, async assertLease => {
        try { await proveRetired(retired, assertLease); }
        catch (error) {
          if (error.code === 'legacy_unsafe_path') throw stale();
          throw error;
        }
        checkClosed(names(source));
        if (companions.some(suffix => entry(source + suffix))) throw stale();
        await assertSiblings();
        await advance('sealed', 'activation-legacy-sealed');
      });
    } else await assertSiblings();
    if (receipt.phase === 'sealed' && entry(retired)) {
      await withColdStoreLease(retired, async assertLease => {
        if (identity(assertPrivate(retired)) !== receipt.source) throw changed();
        await proveRetired(retired, assertLease);
        unlinkSync(retired);
        await sync();
      });
      await notify('activation-source-removed');
    }
    if (companions.some(suffix => entry(source + suffix) || entry(retired + suffix))) throw changed();
  }

  async function abortRetirement({ source, retired, tombstone, receipt, reclaim, assertTombstone, state, syncDirectory,
    notify = async () => {} }) {
    const parent = validateParent(source), fence = retired + '.fence';
    const sync = () => syncDirectory(parent);
    if (identity(entry(source)) === receipt.source) {
      resetLink(source, retired, receipt);
      await cleanFence(fence, tombstone, state);
      await sync();
      return reclaim();
    }
    if (receipt.phase !== 'exchanging' || identity(assertPrivate(retired)) !== receipt.source || entry(fence)) throw changed();
    await assertTombstone(source);
    checkClosed([...names(retired), ...names(source)]);
    await reclaim();
    checkClosed([...names(retired), ...names(source)]);
    await moveCompanions(retired, source, () => notify('activation-darwin-companion-restored'), sync);
    rename(retired, source);
    await sync();
    await notify('activation-darwin-source-restored');
  }

  return Object.freeze({ withColdStoreLease, drainDaemon, retireLegacy, abortRetirement });
}
