import { createServer } from 'node:net';
import { chmod } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { clearInterval, clearTimeout, setInterval, setTimeout } from 'node:timers';
import { withFileLock } from '../../integrations/client/file-lock.mjs';
import { assertStoreLocation, assertStoreSync, canonical, createIdentity, daemonVector, DAEMON_PROTOCOL, selectedEnvironment } from '../../adapters/mcp/local-daemon-identity.mjs';
import { checkedEntry, endpointPaths, identityKey, logCode, readPrivate, refuse, removePrivate, runtimeDirectory, writePrivate } from '../../adapters/mcp/local-daemon-state.mjs';
import { daemonMonotonicMs, localProcessIdentity, startAwareAlive } from '../../adapters/mcp/local-daemon-liveness.mjs';
import { authenticateServer, DAEMON_LIVENESS_FRAME, DAEMON_LIVENESS_MS, frameGuard, queuedBytes, QUEUE_BYTES, requestLedger } from '../../adapters/mcp/local-daemon-wire.mjs';
import { assertActiveAuthority, managedGeneration } from './daemon-authority.mjs';
import { serveStdio } from './host.mjs';
import { localModelKey } from './provider-config.mjs';

async function reap(directory, paths, live, predecessor) {
  const text = await readPrivate(directory, paths.ready, { fileClass: 'descriptor', missing: true });
  const socket = await checkedEntry(directory, paths.socket, { socket: true, missing: true });
  if (!text) {
    if (socket && (!predecessor || startAwareAlive(predecessor, live))) throw refuse('daemon_endpoint_uncertain');
  } else {
    const old = JSON.parse(text);
    if (!/^[a-f0-9]{64}$/u.test(old.incarnation) || startAwareAlive(old.owner, live)) throw refuse('daemon_owner_live');
    if (socket && (String(socket.dev) !== old.socket?.dev || String(socket.ino) !== old.socket?.ino)) throw refuse('daemon_endpoint_changed');
    const stamp = await readPrivate(directory, paths.stamp, { fileClass: 'stamp', missing: true });
    if (stamp && JSON.parse(stamp).incarnation !== old.incarnation) throw refuse('daemon_incarnation');
  }
  if (socket) await removePrivate(directory, paths.socket, { socket: true });
  await removePrivate(directory, paths.stamp);
  if (text) await removePrivate(directory, paths.ready);
}

async function run(args) {
  if (localModelKey(selectedEnvironment())) throw refuse('daemon_configuration');
  const generation = managedGeneration(), vector = daemonVector(args);
  if (!generation || !vector.eligible) throw refuse('daemon_active_store');
  const { path, namespace } = vector.configuration;
  const options = { database: path, owner: namespace.ownerId, project: namespace.projectId ?? undefined };
  const store = await assertActiveAuthority(generation, options);
  const directory = await runtimeDirectory();
  await assertStoreLocation(path, directory);
  const { eligible, record, digest } = await createIdentity(args, {
    key: await identityKey(directory), build: generation.build, root: generation.packageRoot,
  });
  if (!eligible || canonical(record.store) !== canonical(store)) throw refuse('daemon_active_store');
  const paths = endpointPaths(directory, digest), owner = localProcessIdentity();
  let observed, predecessor;
  const authorize = async () => {
    if (canonical(await assertActiveAuthority(generation, options)) !== canonical(store)) throw refuse('daemon_active_store');
  };
  await withFileLock(paths.lock, async () => {
    await authorize();
    await reap(directory, paths, owner, predecessor);
    await serve(directory, paths, record, owner, options, authorize);
  }, {
    timeoutMs: 250, pollMs: 10, context: { ...owner, store: { dev: store.dev, ino: store.ino } },
    isAlive: (_pid, lock) => {
      const alive = startAwareAlive(lock, owner);
      if (!alive && lock.token === observed?.token) predecessor = lock;
      return alive;
    },
    validateOwner: lock => { startAwareAlive(lock, owner); },
    validatePath: file => checkedEntry(directory, file, { missing: true }),
    read: async file => {
      const text = await readPrivate(directory, file, { fileClass: 'lock', missing: true });
      if (file === paths.lock) observed = text ? JSON.parse(text) : undefined;
      return text;
    },
  });
}

function sharedStorage(authorize) {
  let active = 0, becameIdle, checkpoint = Promise.resolve();
  const shared = {
    authorize,
    async enter() {
      for (;;) {
        const observed = checkpoint;
        await observed;
        if (checkpoint === observed) break;
      }
      active++;
      return async checkpointAfter => {
        if (--active === 0) { becameIdle?.(); becameIdle = undefined; }
        if (!checkpointAfter) return;
        // Close the writer after a forget before acknowledging it. This
        // checkpoints old SQLite pages while the daemon keeps its sessions.
        checkpoint = checkpoint.then(async () => {
          if (active) await new Promise(resolve => { becameIdle = resolve; });
          await closeRuntime();
        });
        await checkpoint;
      };
    },
    async close() {
      await checkpoint.catch(() => {});
      await closeRuntime();
    },
  };
  async function closeRuntime() {
    const runtime = shared.runtime;
    shared.runtime = undefined;
    await (await runtime?.catch(() => {}))?.close();
  }
  return shared;
}

async function serve(directory, paths, identity, owner, options, authorize) {
  const descriptor = { version: 1, protocol: DAEMON_PROTOCOL, identity, owner,
    incarnation: randomBytes(32).toString('hex'), capability: randomBytes(32).toString('hex'), socket: null };
  const connections = new Map(), tasks = new Set(), shared = sharedStorage(authorize);
  const codes = [];
  let idle, ticks, closing, drained, reject, startup, tail = Promise.resolve();
  const done = new Promise((resolve, fail) => { drained = resolve; reject = fail; });
  // Publication can fail before the startup promise joins the shutdown path.
  void done.catch(() => {});
  const serial = work => {
    tail = tail.then(work);
    void tail.catch(reject);
    return tail;
  };
  const log = code => { codes.push(code); if (codes.length > 8) codes.shift(); return serial(() => logCode(directory, paths.log, code)); };
  const stamp = () => serial(() => writePrivate(directory, paths.stamp, canonical({
    version: 1, incarnation: descriptor.incarnation, owner, build: identity.build,
    attachedSessions: [...connections.values()].filter(session => session.attached).length,
    monotonicMs: daemonMonotonicMs(), codes: [...codes],
  })));
  const armIdle = () => {
    clearTimeout(idle);
    if (!closing && !connections.size && !tasks.size) idle = setTimeout(stop, 30000);
  };
  const server = createServer({ pauseOnConnect: true }, socket => {
    socket.on('error', () => {});
    if (closing || connections.size >= 64) { socket.destroy(); return; }
    clearTimeout(idle);
    const session = { socket, attached: false };
    connections.set(socket, session);
    const drop = () => { session.input?.destroy(); session.output?.destroy(); socket.destroy(); };
    socket.once('close', () => {
      drop(); clearInterval(session.heartbeat); connections.delete(socket);
      if (!closing) void stamp();
      armIdle();
    });
    const work = (async () => {
      await authorize();
      await authenticateServer(socket, descriptor, {
        deadline: performance.now() + 2000,
        admitting: () => !closing && !socket.destroyed,
        ready: () => ({ owner, incarnation: descriptor.incarnation }),
        authenticated: async () => {
          await authorize();
          if (closing || socket.destroyed) throw refuse('daemon_draining');
          session.attached = true;
          await stamp();
        },
      });
      if (closing || socket.destroyed) return;
      const ledger = requestLedger(), queued = () => queuedBytes(session.input, session.output, socket);
      session.input = frameGuard({ queued, onFrame(message) {
        if (closing) throw refuse('daemon_draining');
        assertStoreSync(identity);
        ledger.request(message);
        const total = [...connections.values()].reduce((sum, peer) => sum + queuedBytes(peer.input, peer.output, peer.socket), 0);
        if (total > 16 * 1048576) throw refuse('daemon_aggregate_queue');
      } });
      session.output = frameGuard({ queued, onFrame: message => ledger.response(message) });
      session.input.on('error', drop); session.output.on('error', drop);
      session.output.pipe(socket); socket.pipe(session.input); socket.resume();
      session.heartbeat = setInterval(() => {
        if (socket.writableLength + DAEMON_LIVENESS_FRAME.length > QUEUE_BYTES) drop();
        else socket.write(DAEMON_LIVENESS_FRAME);
      }, DAEMON_LIVENESS_MS);
      await serveStdio(session.input, session.output, options, { shared, closed: () => socket.destroyed || !!closing });
    })().catch(() => { if (!closing) void log('daemon_refused'); }).finally(() => {
      tasks.delete(work); drop(); armIdle();
    });
    tasks.add(work);
  });
  const stop = () => {
    if (closing) return;
    closing = (async () => {
      clearTimeout(idle); clearInterval(ticks);
      const watchdog = setTimeout(() => process.exit(1), 5000);
      for (const socket of connections.keys()) socket.destroy();
      await startup.catch(() => {});
      if (server.listening) await new Promise(resolve => server.close(resolve));
      await Promise.allSettled([...tasks]);
      await shared.close();
      await tail.catch(() => {});
      if (descriptor.socket) {
        const info = await checkedEntry(directory, paths.socket, { socket: true, missing: true });
        if (info && (String(info.dev) !== descriptor.socket.dev || String(info.ino) !== descriptor.socket.ino)) {
          throw refuse('daemon_endpoint_changed');
        }
        if (info) await removePrivate(directory, paths.socket, { socket: true });
      }
      await removePrivate(directory, paths.stamp);
      await removePrivate(directory, paths.ready);
      await log('daemon_draining'); await log('daemon_exit');
      clearTimeout(watchdog);
      drained();
    })();
    void closing.catch(() => process.exit(1));
  };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  server.on('error', reject);
  startup = (async () => {
    const mask = process.umask(0o177);
    try {
      await new Promise((resolve, fail) => {
        server.once('error', fail);
        server.listen(paths.socket, () => { server.off('error', fail); resolve(); });
      });
    } finally { process.umask(mask); }
    await chmod(paths.socket, 0o600);
    const info = await checkedEntry(directory, paths.socket, { socket: true });
    descriptor.socket = { dev: String(info.dev), ino: String(info.ino) };
    if (closing) return;
    await authorize();
    if (closing) return;
    await log('daemon_ready');
    await stamp();
    await writePrivate(directory, paths.ready, canonical(descriptor));
    if (!closing) { ticks = setInterval(() => { void stamp(); }, DAEMON_LIVENESS_MS); armIdle(); }
  })();
  try { await startup; await done; }
  finally {
    stop();
    await closing;
    process.off('SIGTERM', stop); process.off('SIGINT', stop);
  }
}

try { await run(process.argv.slice(2)); }
catch { process.stderr.write('daemon_failed\n'); process.exitCode = 1; }
