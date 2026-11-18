import { createServer, Socket } from 'node:net';
import { chmod, opendir, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, join, basename } from 'node:path';
import { withFileLock } from '../../integrations/client/file-lock.mjs';
import { runtimeDirectory, endpointPaths, identityKey, checkedEntry, readPrivate, writePrivate, removePrivate, logCode, refuse } from './local-daemon-state.mjs';
import { createIdentity, daemonVector, canonical, assertStore, assertStoreSync, assertStoreLocation, creationIdentity, creationDigest, physicalStore, DAEMON_PROTOCOL } from './local-daemon-identity.mjs';
import { localProcessIdentity, startAwareAlive, daemonMonotonicMs } from './local-daemon-liveness.mjs';
import { authenticateServer, frameGuard, requestLedger, queuedBytes, QUEUE_BYTES, DAEMON_LIVENESS_MS, DAEMON_LIVENESS_FRAME } from './local-daemon-wire.mjs';

async function reapEndpoint(directory, paths, live, predecessor, budget) {
  const text = await readPrivate(directory, paths.ready, { fileClass: 'descriptor', missing: true, deadline: budget.deadline });
  const socket = await checkedEntry(directory, paths.socket, { socket: true, missing: true });
  if (text === undefined) {
    // The lifetime lock excludes publishers. Its recorded predecessor must
    // additionally be start/boot/namespace-verified dead before orphan removal.
    if (socket) {
      if (!predecessor || startAwareAlive(predecessor, live)) throw refuse('daemon_endpoint_uncertain');
      await removePrivate(directory, paths.socket, { socket: true });
    }
    return;
  }
  let old; try { old = JSON.parse(text); } catch { throw refuse('daemon_descriptor'); }
  if (!/^[a-f0-9]{64}$/.test(old.incarnation ?? '') || startAwareAlive(old.owner, live)) throw refuse('daemon_owner_live');
  if (socket && (String(socket.dev) !== old.socket.dev || String(socket.ino) !== old.socket.ino)) throw refuse('daemon_endpoint_changed');
  // Holding the lifetime lock excludes other publishers; compare incarnation again.
  const current = JSON.parse(await readPrivate(directory, paths.ready, { fileClass: 'descriptor', deadline: budget.deadline }));
  if (current.incarnation !== old.incarnation) throw refuse('daemon_incarnation');
  const stamp = await readPrivate(directory, paths.stamp, { fileClass: 'stamp', missing: true, deadline: budget.deadline });
  if (stamp && JSON.parse(stamp).incarnation !== old.incarnation) throw refuse('daemon_incarnation');
  if (socket) await removePrivate(directory, paths.socket, { socket: true });
  await removePrivate(directory, paths.stamp);
  await removePrivate(directory, paths.ready);
}

export async function runCandidate(bootstrap, { idleMs = 30000, graceMs = 5000, exit = code => process.exit(code), afterLock = async () => {}, runtimeOptions } = {}) {
  const directory = await runtimeDirectory({ root: bootstrap.root });
  if (bootstrap.creation) return provisionStore(bootstrap, directory);
  const vector = daemonVector(bootstrap.args);
  if (!vector.eligible) throw refuse('daemon_not_eligible');
  await assertStoreLocation(vector.configuration.path, directory);
  await physicalStore(vector.configuration.path);
  const identity = await createIdentity(bootstrap.args, { key: await identityKey(directory),
    environment: bootstrap.environment, build: bootstrap.build });
  if (!identity.eligible || canonical(identity.record) !== canonical(bootstrap.identity)) throw refuse('daemon_identity');
  const paths = endpointPaths(directory, identity.digest), live = localProcessIdentity();
  await checkedEntry(directory, paths.lock, { missing: true });
  let predecessor, lifetimeOwner, held = false;
  const acquisitionDeadline = performance.now() + 250, budget = { deadline: performance.now() + graceMs };
  // Lock before ANY server, SDK, core, provider, SQLite or tokenizer import.
  // stateLock cannot record start time in its context. Use its unchanged underlying
  // withFileLock seam directly, with stricter daemon-specific owner validation.
  return withFileLock(paths.lock, async () => {
    held = true;
    await directory.validate();
    await reapEndpoint(directory, paths, live, predecessor, budget);
    await afterLock(); // Programmatic instrumentation only; never accepted by bootstrap/argv/env.
    await serve(directory, paths, identity.record, bootstrap, live, { idleMs, graceMs, exit, runtimeOptions, budget });
  }, { timeoutMs: 250, pollMs: 10, context: { ...live, store: { dev: identity.record.store.dev, ino: identity.record.store.ino } },
    isAlive: (_pid, owner) => {
      const alive = startAwareAlive(owner, live);
      // The same callback checks reaper markers. Only an owner read from the
      // lifetime lock itself can supply the displaced endpoint's predecessor.
      if (!alive && owner.pid === lifetimeOwner?.pid && owner.token === lifetimeOwner.token) predecessor = owner;
      return alive;
    },
    validateOwner: owner => { startAwareAlive(owner, live); },
    validatePath: path => checkedEntry(directory, path, { missing: true }),
    read: async path => {
      const text = await readPrivate(directory, path, { fileClass: 'lock', missing: true, deadline: held ? budget.deadline : acquisitionDeadline });
      if (path === paths.lock) lifetimeOwner = text ? JSON.parse(text) : undefined;
      return text;
    },
  });
}

async function provisionStore(bootstrap, directory) {
  await assertStoreLocation(bootstrap.creation.path, directory);
  const creation = await creationIdentity(bootstrap.creation.path);
  if (canonical(creation) !== canonical(bootstrap.creation)) throw refuse('daemon_store_changed');
  const path = resolve(directory.path, 'p-' + creationDigest(creation).slice(0, 32) + '.lock'), live = localProcessIdentity();
  await checkedEntry(directory, path, { missing: true });
  const acquisitionDeadline = performance.now() + 250;
  return withFileLock(path, async () => {
    await directory.validate();
    try { await physicalStore(creation.path); return; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    // First creation uses an engine-owned connection under a parent+basename lock.
    // It is closed before the physical identity can elect a serving runtime.
    const { openMemoryCore } = await import('../../core/contract.mjs');
    const core = openMemoryCore({ path: creation.path, raw: false });
    await core.close();
  }, { timeoutMs: 250, pollMs: 10, context: live,
    isAlive: (_pid, owner) => startAwareAlive(owner, live), validateOwner: owner => { startAwareAlive(owner, live); },
    validatePath: p => checkedEntry(directory, p, { missing: true }), read: p => readPrivate(directory, p, { fileClass: 'lock', missing: true, deadline: acquisitionDeadline }),
  });
}

async function cleanupTemps(directory, paths, report) {
  const pattern = new RegExp('^' + basename(paths.stamp, '.stamp') + '\\.(stamp|json)\\.tmp-[a-f0-9]{24}$');
  const deadline = performance.now() + 1000;
  let stream, entries = 0, matches = 0;
  let validationFailure;
  const pinnedDirectory = { ...directory, validate: async () => {
    try { await directory.validate(); }
    catch (error) { validationFailure = error; throw error; }
  } };
  const directoryFailure = error => error === validationFailure || error.code?.startsWith('daemon_directory');
  try {
    await pinnedDirectory.validate();
    stream = await opendir(directory.path);
    for (;;) {
      if (performance.now() >= deadline) { report('daemon_temp_budget'); break; }
      if (entries === 4096) { report('daemon_temp_overflow'); break; }
      const entry = await stream.read();
      if (!entry) break;
      entries++;
      if (performance.now() >= deadline) { report('daemon_temp_budget'); break; }
      if (!pattern.test(entry.name)) continue;
      if (matches === 256) { report('daemon_temp_overflow'); break; }
      matches++;
      const path = join(directory.path, entry.name);
      try {
        const before = await checkedEntry(pinnedDirectory, path, { missing: true });
        if (!before) continue;
        if (before.nlink !== 1n) throw refuse('daemon_temp_invalid');
        const after = await checkedEntry(pinnedDirectory, path, { missing: true });
        if (!after) continue;
        if (after.nlink !== 1n || before.dev !== after.dev || before.ino !== after.ino) throw refuse('daemon_temp_invalid');
        // Sequential and awaited: the scheduling deadline never abandons IO.
        await unlink(path);
      } catch (error) {
        if (directoryFailure(error)) throw error;
        if (error.code === 'ENOENT') continue;
        report('daemon_temp_invalid');
      }
    }
  } catch (error) {
    if (directoryFailure(error)) throw error;
    report('daemon_temp_scan');
  } finally {
    if (stream) {
      try { await stream.close(); }
      catch (error) {
        if (directoryFailure(error)) throw error;
        report('daemon_temp_scan');
      }
    }
  }
}

async function serve(directory, paths, identity, bootstrap, owner, { idleMs, graceMs, exit, runtimeOptions, budget }) {
  budget.deadline = Infinity;
  let host, embedding, activated, draining = false, idle, outer, shutdownTask, doneResolve, doneReject, startupTask;
  let logTail = Promise.resolve(), stampTail = Promise.resolve(), stampTimer;
  let writersFenced = false, logSealed = false;
  const producers = new Set(), socketClosures = new Set();
  const track = promise => {
    const task = Promise.resolve(promise); producers.add(task);
    void task.finally(() => producers.delete(task)).catch(() => {});
    return task;
  };
  const codes = [];
  const log = (code, inStamp = true) => { if (logSealed) return; if (inStamp) { codes.push(code); if (codes.length > 8) codes.shift(); } logTail = logTail.then(() => logCode(directory, paths.log, code, { deadline: Math.min(budget.deadline, performance.now() + 1000) })).catch(() => {}); };
  const sockets = new Set(), handles = new Map();
  const descriptor = { version: 1, protocol: DAEMON_PROTOCOL, identity, owner,
    incarnation: randomBytes(32).toString('hex'), capability: randomBytes(32).toString('hex'), socket: null };
  const refreshStamp = () => {
    if (writersFenced || draining) return stampTail;
    stampTail = stampTail.then(() => writePrivate(directory, paths.stamp, canonical({
      version: 1, incarnation: descriptor.incarnation, owner, build: identity.build,
      attachedSessions: handles.size, monotonicMs: daemonMonotonicMs(), codes: [...codes],
    })));
    stampTail.catch(doneReject);
    return stampTail;
  };
  const done = new Promise((resolve, reject) => { doneResolve = resolve; doneReject = reject; });
  // A rejected import from this package cannot become healthy in this process
  // (ESM caches failures). Stop admissions and retain ownership through cleanup.
  const failedImport = error => { void shutdown().catch(doneReject); throw error; };
  // Provider creation and heavy import are single-flight and follow authentication.
  const activate = () => activated ??= (async () => {
    const { createLocalSharedRuntime } = await import('./local-shared-runtime.mjs').catch(failedImport);
    const configuration = daemonVector(bootstrap.args).configuration;
    configuration.path = identity.store.path;
    let model;
    if (bootstrap.environment.OPENAI_API_KEY) {
      const { createOpenAIModel } = await import('../openai/index.mjs').catch(failedImport);
      model = createOpenAIModel({ apiKey: bootstrap.environment.OPENAI_API_KEY });
      if (configuration.contextRead) {
        const { prepareContextEmbedding, contextEmbeddingPort } = await import('./context-read-provider.mjs').catch(failedImport);
        embedding = await prepareContextEmbedding(undefined, bootstrap.environment);
        configuration.contextEmbedding = contextEmbeddingPort(embedding);
      }
    }
    // Synthetic provider/counter injection is programmatic only, never bootstrap data.
    host = createLocalSharedRuntime({ ...configuration, ...(model ? { model } : {}), ...runtimeOptions }, { manageRawUpkeep: true });
    return host;
  })();
  const activity = () => sockets.size || (host?.inspect().inFlight ?? 0);
  const armIdle = () => {
    clearTimeout(idle);
    if (draining || sockets.size) return;
    idle = setTimeout(() => {
      if (activity()) { armIdle(); return; }
      void shutdown().catch(doneReject);
    }, idleMs);
  };
  const server = createServer({ pauseOnConnect: true }, socket => {
    socket.on('error', () => {});
    if (draining || sockets.size >= 64) { socket.destroy(); return; }
    clearTimeout(idle); sockets.add(socket);
    let input, output, handle, heartbeat, handleClose;
    const drop = () => {
      clearInterval(heartbeat);
      if (handle && !handleClose) handleClose = track(handle.close().catch(() => {})); input?.destroy(); output?.destroy(); socket.destroy();
    };
    const closed = new Promise(resolve => socket.once('close', () => {
      drop(); sockets.delete(socket); handles.delete(socket);
      if (!draining) void refreshStamp(); armIdle(); resolve();
    }));
    socketClosures.add(closed); void closed.then(() => socketClosures.delete(closed));
    track((async () => {
      await directory.validate(); await assertStore(identity);
      await authenticateServer(socket, descriptor, { deadline: performance.now() + 2000, admitting: () => !draining,
        ready: () => ({ owner, incarnation: descriptor.incarnation, counters: host.inspect() }),
        authenticated: async () => {
      const runtime = await activate();
      if (draining || socket.destroyed) throw refuse('daemon_draining');
      await assertStore(identity);
      if (draining || socket.destroyed) throw refuse('daemon_draining');
      const ledger = requestLedger();
      const queued = () => [...handles.values()].reduce((sum, value) => sum + queuedBytes(value.input, value.output, value.socket), 0);
      const connectionQueued = () => queuedBytes(input, output, socket);
      input = frameGuard({ onFrame(message) {
        if (draining) throw refuse('daemon_draining');
        assertStoreSync(identity);
        ledger.request(message);
        if (queued() > 16 * 1048576) throw refuse('daemon_aggregate_queue');
      }, queued: connectionQueued });
      output = frameGuard({ onFrame: message => ledger.response(message), queued: connectionQueued });
      input.on('error', drop); output.on('error', drop);
      handles.set(socket, { socket, input, output });
      handle = runtime.attach(input, output);
      handles.get(socket).handle = handle;
      void refreshStamp();
        } });
      if (socket.destroyed || draining) { drop(); return; }
      output.pipe(socket); socket.pipe(input); socket.resume();
      heartbeat = setInterval(() => {
        if (socket.writableLength + Buffer.byteLength(DAEMON_LIVENESS_FRAME) > QUEUE_BYTES) { drop(); return; }
        socket.write(DAEMON_LIVENESS_FRAME);
      }, DAEMON_LIVENESS_MS);
      // No tool text, ids, paths or response bodies in daemon-owned collections.
    })().catch(() => { log('daemon_refused'); drop(); }));
  });
  async function cleanupEndpoint() {
    const text = await readPrivate(directory, paths.ready, { fileClass: 'descriptor', missing: true, deadline: budget.deadline });
    if (text && JSON.parse(text).incarnation !== descriptor.incarnation) throw refuse('daemon_incarnation');
    const info = await checkedEntry(directory, paths.socket, { socket: true, missing: true });
    if (info && descriptor.socket && (String(info.dev) !== descriptor.socket.dev || String(info.ino) !== descriptor.socket.ino)) throw refuse('daemon_endpoint_changed');
    const stamp = await readPrivate(directory, paths.stamp, { fileClass: 'stamp', missing: true, deadline: budget.deadline });
    if (stamp && JSON.parse(stamp).incarnation !== descriptor.incarnation) throw refuse('daemon_incarnation');
    if (info) await removePrivate(directory, paths.socket, { socket: true });
    await removePrivate(directory, paths.stamp);
    if (text) await removePrivate(directory, paths.ready);
  }
  function shutdown() {
    return shutdownTask ??= (async () => {
      draining = true; clearTimeout(idle); budget.deadline = performance.now() + graceMs; clearInterval(stampTimer); log('daemon_draining');
      const listenerClosed = new Promise(resolve => server.once('close', resolve));
      server.close(); // Stop admissions before revocation; lifetime lock remains held.
      outer = setTimeout(() => { log('daemon_grace_expired'); exit(1); }, graceMs);
      // Revoke synchronously, then join every continuation that can enqueue IO.
      for (const entry of handles.values()) track(entry.handle?.close().catch(() => {}));
      for (const socket of sockets) socket.destroy();
      await startupTask?.catch(() => {});
      await Promise.all([...socketClosures]);
      while (producers.size) await Promise.allSettled([...producers]);
      await activated?.catch(() => {});
      while (host?.inspect().inFlight) await new Promise(resolve => setTimeout(resolve, 10));
      await host?.close();
      await embedding?.close?.();
      writersFenced = true;
      await stampTail.catch(() => {});
      await cleanupEndpoint();
      log('daemon_exit'); logSealed = true; await logTail;
      // TERM may have overlapped a pending bind. Startup is now settled.
      if (server.listening) await new Promise(resolve => server.close(resolve));
      await listenerClosed;
      clearTimeout(outer); doneResolve();
    })();
  }
  const term = () => { void shutdown().catch(doneReject); };
  process.once('SIGTERM', term); process.once('SIGINT', term);
  server.on('error', () => { doneReject(refuse('daemon_listener')); });
  const startupGuard = () => { if (draining) throw refuse('daemon_draining'); };
  startupTask = (async () => {
    await cleanupTemps(directory, paths, code => log(code, false)); startupGuard();
    await directory.validate(); startupGuard();
    // Bind already satisfies the checked 0600 mode if killed before chmod.
    const previousMask = process.umask(0o177);
    try {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(paths.socket, () => { server.off('error', reject); resolve(); }); });
    } finally { process.umask(previousMask); }
    startupGuard();
    await chmod(paths.socket, 0o600); startupGuard();
    const info = await checkedEntry(directory, paths.socket, { socket: true }); startupGuard();
    descriptor.socket = { dev: String(info.dev), ino: String(info.ino) };
    log('daemon_ready'); await refreshStamp(); startupGuard();
    await writePrivate(directory, paths.ready, canonical(descriptor)); startupGuard();
    stampTimer = setInterval(() => { if (!draining) void refreshStamp(); }, DAEMON_LIVENESS_MS);
    armIdle();
  })();
  try {
    try { await startupTask; } catch (error) { if (!draining) throw error; }
    await done;
  } finally {
    clearTimeout(idle); clearInterval(stampTimer);
    // Every exit shares the same bounded cleanup, including listener/setup
    // errors racing activation or a shutdown already started by TERM/import.
    // Its activation join and resource closes precede return to withFileLock.
    try { await shutdown(); }
    catch {
      // Never unwind the lock callback if cleanup fails. The outer bound also
      // exits in place while activation is pending; only process death may
      // then permit recovery of this owner's lock.
      exit(1); await new Promise(() => {});
    }
    process.off('SIGTERM', term); process.off('SIGINT', term);
    clearTimeout(outer); await logTail;
  }
}

export async function readBootstrap(fd = 3) {
  const input = new Socket({ fd, readable: true, writable: false });
  let bytes = 0, chunks = [];
  const timer = setTimeout(() => input.destroy(refuse('daemon_bootstrap_timeout')), 2000);
  try {
    for await (const chunk of input) {
      bytes += chunk.length; if (bytes > 65536) throw refuse('daemon_bootstrap_limit'); chunks.push(chunk);
    }
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8')); chunks = []; return result;
  } finally { clearTimeout(timer); input.destroy(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await runCandidate(await readBootstrap()); }
  catch { process.stderr.write('daemon_failed\n'); process.exitCode = 1; }
}
