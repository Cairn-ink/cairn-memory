// Linux OS metadata only; no environment, store or SQLite access.
import { readFileSync, readlinkSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { withFileLock } from '../../integrations/client/file-lock.mjs';
import { canonical, physicalStore, assertStoreLocation } from './local-daemon-identity.mjs';
import { DAEMON_UNRESPONSIVE_MS } from './local-daemon-wire.mjs';
import { runtimeDirectory, endpointPaths, readPrivate, checkedEntry, refuse, retryMetadata } from './local-daemon-state.mjs';

export function processStart(pid) {
  try {
    const source = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = source.slice(source.lastIndexOf(')') + 2).trim().split(/\s+/);
    if (!/^\d+$/.test(fields[19] ?? '')) throw refuse('daemon_liveness');
    // Zombies have completed all work and cannot retain SQLite handles.
    return { start: fields[19], zombie: fields[0] === 'Z' };
  } catch (error) { if (error.code === 'ENOENT' || error.code === 'ESRCH') return null; throw refuse('daemon_liveness'); }
}
export function localProcessIdentity() {
  return { pid: process.pid, start: processStart(process.pid).start,
    boot: readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(),
    namespace: readlinkSync('/proc/self/ns/pid') };
}
export function startAwareAlive(owner, live = localProcessIdentity(), read = processStart) {
  if (!Number.isSafeInteger(owner?.pid) || owner.pid < 1 || typeof owner.start !== 'string' || !owner.boot || !owner.namespace) throw refuse('daemon_liveness');
  if (owner.boot !== live.boot) return false;
  if (owner.namespace !== live.namespace) throw refuse('daemon_namespace');
  const current = read(owner.pid);
  return current !== null && !current.zombie && current.start === owner.start;
}

// Linux CLOCK_MONOTONIC: comparable between processes on this boot; excludes
// suspended time. Never use the wall clock to decide that an owner is stale.
export const daemonMonotonicMs = () => Number(process.hrtime.bigint() / 1000000n);
export async function readDaemonHeartbeat(directory, paths, descriptor) {
  const text = await readPrivate(directory, paths.stamp, { fileClass: 'stamp', missing: true, openMissing: false });
  if (!text) return;
  let stamp; try { stamp = JSON.parse(text); } catch { throw refuse('daemon_stamp'); }
  if (stamp.incarnation !== descriptor.incarnation || canonical(stamp.owner) !== canonical(descriptor.owner) || stamp.build !== descriptor.identity.build) return;
  if (stamp.version !== 1 ||
      !Number.isSafeInteger(stamp.monotonicMs) || stamp.monotonicMs < 0 ||
      !Number.isSafeInteger(stamp.attachedSessions) || stamp.attachedSessions < 0 || stamp.attachedSessions > 64 ||
      !Array.isArray(stamp.codes) || stamp.codes.length > 8 || stamp.codes.some(code => !/^daemon_[a-z_]+$/.test(code))) throw refuse('daemon_stamp');
  return stamp;
}
export function verifiedOwner(owner, live = localProcessIdentity(), uid = process.getuid()) {
  if (!startAwareAlive(owner, live)) return false;
  try { return statSync(`/proc/${owner.pid}`).uid === uid; }
  catch (error) { if (error.code === 'ENOENT' || error.code === 'ESRCH') return false; throw refuse('daemon_liveness'); }
}
export async function takeOver(directory, paths, observed, {
  staleMs = DAEMON_UNRESPONSIVE_MS, deadline = performance.now() + 10000,
  graceMs = 5000, alive = owner => verifiedOwner(owner), signal = (owner, code) => process.kill(owner.pid, code),
  afterLock = async () => {}, afterTerm = async () => {},
} = {}) {
  const stale = stamp => daemonMonotonicMs() - stamp.monotonicMs > staleMs;
  const stamp = await readDaemonHeartbeat(directory, paths, observed);
  if (!stamp || !stale(stamp) || !alive(observed.owner)) return false;
  const incarnation = observed.incarnation, owner = canonical(observed.owner), live = localProcessIdentity();
  return withFileLock(paths.takeover, async () => {
    await afterLock(); // Programmatic test seam; never bootstrap/argv/environment.
    const text = await readPrivate(directory, paths.ready, { fileClass: 'descriptor', missing: true });
    if (!text) return;
    const current = JSON.parse(text), fresh = await readDaemonHeartbeat(directory, paths, current);
    if (current.incarnation !== incarnation || canonical(current.owner) !== owner ||
        !fresh || !stale(fresh) || !alive(current.owner)) return;
    if (performance.now() >= deadline) return;
    // Each signal has its own immediate start/boot/namespace/uid verification.
    if (!alive(current.owner)) return;
    try { signal(current.owner, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    await afterTerm();
    const grace = performance.now() + graceMs;
    while (alive(current.owner) && performance.now() < grace) await new Promise(resolve => setTimeout(resolve, 20));
    if (alive(current.owner)) {
      try { signal(current.owner, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    while (alive(current.owner)) await new Promise(resolve => setTimeout(resolve, 20));
    // Election/reapEndpoint belong to the lifetime lock, after releasing this one.
  }, { timeoutMs: Math.max(0, deadline - performance.now()), deadlineMs: deadline, pollMs: 20, context: live,
    isAlive: (_pid, owner) => startAwareAlive(owner, live), validateOwner: owner => { startAwareAlive(owner, live); },
    validatePath: path => checkedEntry(directory, path, { missing: true }),
    read: path => readPrivate(directory, path, { fileClass: 'lock', missing: true, deadline }),
  });
}

export const daemonStoreKey = store => createHash('sha256').update(canonical({ dev: store.dev, ino: store.ino })).digest('hex').slice(0,12);

export async function runDaemonCommand(args, {
  platform = process.platform, root, write = text => process.stdout.write(text), graceMs = 5000,
} = {}) {
  if (platform !== 'linux') { write('daemon_platform\n'); return 0; }
  const [action, flag, path, ...extra] = args;
  if (!['status', 'stop'].includes(action) || extra.length || (flag !== undefined && (flag !== '--db' || !path))) throw refuse('daemon_arguments');
  const metadataDeadline = performance.now() + 1000;
  const directory = await runtimeDirectory({ root });
  if (path !== undefined) await assertStoreLocation(path, directory);
  const store = path === undefined ? undefined : await physicalStore(path);
  const { entries, uncertain } = await retryMetadata(async () => {
  const entries = [], uncertain = [];
  // Bound sockets are discoverable before a ready descriptor is published.
  // Lifetime-lock metadata supplies the physical-store identity, never a path.
  for (const name of (await readdir(directory.path)).filter(name => /^d-[a-f0-9]{32}\.sock$/.test(name)).sort()) {
    const base = name.slice(0, -5);
    if (await readPrivate(directory, join(directory.path, base + '.json'), { fileClass: 'descriptor', missing: true })) continue;
    let owner, removable = false;
    try {
      await checkedEntry(directory, join(directory.path, name), { socket: true });
      const lock = await readPrivate(directory, join(directory.path, base + '.lock'), { fileClass: 'lock', missing: true, deadline: metadataDeadline });
      if (lock) { owner = JSON.parse(lock); removable = !startAwareAlive(owner); }
    } catch { removable = false; }
    if (store && (owner?.store?.dev !== store.dev || owner?.store?.ino !== store.ino)) continue;
    uncertain.push({ code: 'endpoint_uncertain', auto_removable: removable });
  }
  for (const name of (await readdir(directory.path)).filter(name => /^d-[a-f0-9]{32}\.json$/.test(name)).sort()) {
    const text = await readPrivate(directory, join(directory.path, name), { fileClass: 'descriptor', missing: true });
    if (!text) continue;
    const descriptor = JSON.parse(text);
    if (descriptor.identity?.uid !== directory.uid || !/^[a-f0-9]{64}$/.test(descriptor.identity.build ?? '') || !/^[a-f0-9]{64}$/.test(descriptor.incarnation ?? '')) throw refuse('daemon_descriptor');
    if (store && (store.dev !== descriptor.identity.store?.dev || store.ino !== descriptor.identity.store?.ino)) continue;
    const paths = endpointPaths(directory, createHash('sha256').update(canonical(descriptor.identity)).digest('hex'));
    if (paths.ready !== join(directory.path, name)) throw refuse('daemon_identity');
    const stamp = await readDaemonHeartbeat(directory, paths, descriptor);
    entries.push({ descriptor, stamp });
  }
  return { entries, uncertain };
  }, metadataDeadline);
  if (action === 'status') {
    write(JSON.stringify({ daemons: entries.map(({ descriptor, stamp }) => ({
      store: daemonStoreKey(descriptor.identity.store),
      running: verifiedOwner(descriptor.owner), build: descriptor.identity.build.slice(0,12),
      attached_sessions: stamp?.attachedSessions ?? null,
      stamp_age_seconds: stamp && stamp.owner.boot === localProcessIdentity().boot ? Math.max(0, daemonMonotonicMs() - stamp.monotonicMs) / 1000 : null,
      last_codes: stamp?.codes ?? [],
    })).concat(uncertain) }) + '\n');
  } else {
    const signalled = [];
    for (const { descriptor } of entries) {
      // Read-only discovery is never authority to signal without this check.
      if (!verifiedOwner(descriptor.owner)) continue;
      try { process.kill(descriptor.owner.pid, 'SIGTERM'); signalled.push(descriptor.owner); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    const deadline = performance.now() + graceMs;
    while (signalled.some(owner => verifiedOwner(owner)) && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    const still_running = signalled.filter(owner => verifiedOwner(owner)).length;
    write(JSON.stringify({ stopped: signalled.length - still_running, still_running }) + '\n');
  }
  return 0;
}
