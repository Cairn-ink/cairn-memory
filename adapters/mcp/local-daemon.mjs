import { createServer, Socket } from 'node:net';
import { chmod } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { withFileLock } from '../../integrations/client/file-lock.mjs';
import { runtimeDirectory, endpointPaths, identityKey, checkedEntry, readPrivate, writePrivate, removePrivate, logCode, refuse } from './local-daemon-state.mjs';
import { createIdentity, daemonVector, canonical, assertStore, assertStoreSync, assertStoreLocation, creationIdentity, creationDigest, physicalStore, DAEMON_PROTOCOL } from './local-daemon-identity.mjs';
import { localProcessIdentity, startAwareAlive } from './local-daemon-liveness.mjs';
import { authenticateServer, frameGuard, requestLedger, queuedBytes } from './local-daemon-wire.mjs';

async function reapEndpoint(directory, paths, live) {
  const text = await readPrivate(directory, paths.ready, { missing: true });
  const socket = await checkedEntry(directory, paths.socket, { socket: true, missing: true });
  if (text === undefined) {
    // No published incarnation means no proof of death. Never unlink on a timeout.
    if (socket) throw refuse('daemon_endpoint_uncertain');
    return;
  }
  let old; try { old = JSON.parse(text); } catch { throw refuse('daemon_descriptor'); }
  if (!/^[a-f0-9]{64}$/.test(old.incarnation ?? '') || startAwareAlive(old.owner, live)) throw refuse('daemon_owner_live');
  if (socket && (String(socket.dev) !== old.socket.dev || String(socket.ino) !== old.socket.ino)) throw refuse('daemon_endpoint_changed');
  // Holding the lifetime lock excludes other publishers; compare incarnation again.
  const current = JSON.parse(await readPrivate(directory, paths.ready));
  if (current.incarnation !== old.incarnation) throw refuse('daemon_incarnation');
  if (socket) await removePrivate(directory, paths.socket, { socket: true });
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
  // Lock before ANY server, SDK, core, provider, SQLite or tokenizer import.
  // stateLock cannot record start time in its context. Use its unchanged underlying
  // withFileLock seam directly, with stricter daemon-specific owner validation.
  return withFileLock(paths.lock, async () => {
    await directory.validate();
    await reapEndpoint(directory, paths, live);
    await afterLock(); // Programmatic instrumentation only; never accepted by bootstrap/argv/env.
    await serve(directory, paths, identity.record, bootstrap, live, { idleMs, graceMs, exit, runtimeOptions });
  }, { timeoutMs: 250, pollMs: 10, context: live,
    isAlive: (_pid, owner) => startAwareAlive(owner, live),
    validateOwner: owner => { startAwareAlive(owner, live); },
    validatePath: path => checkedEntry(directory, path, { missing: true }),
    read: path => readPrivate(directory, path, { missing: true }),
  });
}

async function provisionStore(bootstrap, directory) {
  await assertStoreLocation(bootstrap.creation.path, directory);
  const creation = await creationIdentity(bootstrap.creation.path);
  if (canonical(creation) !== canonical(bootstrap.creation)) throw refuse('daemon_store_changed');
  const path = resolve(directory.path, 'p-' + creationDigest(creation).slice(0, 32) + '.lock'), live = localProcessIdentity();
  await checkedEntry(directory, path, { missing: true });
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
    validatePath: p => checkedEntry(directory, p, { missing: true }), read: p => readPrivate(directory, p, { missing: true }),
  });
}

async function serve(directory, paths, identity, bootstrap, owner, { idleMs, graceMs, exit, runtimeOptions }) {
  let host, embedding, activated, draining = false, idle, outer, closed = false, doneResolve, doneReject;
  let logTail = Promise.resolve();
  const log = code => { logTail = logTail.then(() => logCode(directory, paths.log, code)).catch(() => {}); };
  const sockets = new Set(), handles = new Map();
  const descriptor = { version: 1, protocol: DAEMON_PROTOCOL, identity, owner,
    incarnation: randomBytes(32).toString('hex'), capability: randomBytes(32).toString('hex'), socket: null };
  const done = new Promise((resolve, reject) => { doneResolve = resolve; doneReject = reject; });
  // Provider creation and heavy import are single-flight and follow authentication.
  const activate = () => activated ??= (async () => {
    const { createLocalSharedRuntime } = await import('./local-shared-runtime.mjs');
    const configuration = daemonVector(bootstrap.args).configuration;
    configuration.path = identity.store.path;
    let model;
    if (bootstrap.environment.OPENAI_API_KEY) {
      const { createOpenAIModel } = await import('../openai/index.mjs');
      model = createOpenAIModel({ apiKey: bootstrap.environment.OPENAI_API_KEY });
      if (configuration.contextRead) {
        const { prepareContextEmbedding, contextEmbeddingPort } = await import('./context-read-provider.mjs');
        embedding = await prepareContextEmbedding(undefined, bootstrap.environment);
        configuration.contextEmbedding = contextEmbeddingPort(embedding);
      }
    }
    // Synthetic provider/counter injection is programmatic only, never bootstrap data.
    host = createLocalSharedRuntime({ ...configuration, ...(model ? { model } : {}), ...runtimeOptions });
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
    let input, output, handle;
    const drop = () => {
      void handle?.close().catch(() => {}); input?.destroy(); output?.destroy(); socket.destroy();
    };
    socket.once('close', () => { drop(); sockets.delete(socket); handles.delete(socket); armIdle(); });
    void (async () => {
      await directory.validate(); await assertStore(identity);
      await authenticateServer(socket, descriptor, { deadline: performance.now() + 2000, admitting: () => !draining,
        ready: () => ({ owner, incarnation: descriptor.incarnation, counters: host.inspect() }),
        authenticated: async () => {
      const runtime = await activate();
      if (draining || socket.destroyed) throw refuse('daemon_draining');
      await assertStore(identity);
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
        } });
      output.pipe(socket); socket.pipe(input); socket.resume();
      // No tool text, ids, paths or response bodies in daemon-owned collections.
    })().catch(() => { log('daemon_refused'); drop(); });
  });
  async function cleanupEndpoint() {
    const text = await readPrivate(directory, paths.ready, { missing: true });
    if (text && JSON.parse(text).incarnation !== descriptor.incarnation) throw refuse('daemon_incarnation');
    const info = await checkedEntry(directory, paths.socket, { socket: true, missing: true });
    if (info && descriptor.socket && (String(info.dev) !== descriptor.socket.dev || String(info.ino) !== descriptor.socket.ino)) throw refuse('daemon_endpoint_changed');
    if (info) await removePrivate(directory, paths.socket, { socket: true });
    if (text) await removePrivate(directory, paths.ready);
  }
  async function shutdown() {
    if (draining) return;
    draining = true; clearTimeout(idle); log('daemon_draining');
    server.close(); // Stop admissions before revocation; lifetime lock remains held.
    outer = setTimeout(() => { log('daemon_grace_expired'); exit(1); }, graceMs);
    // Connection close synchronously revokes grants; it does not own the runtime.
    for (const entry of handles.values()) void entry.handle?.close().catch(() => {});
    for (const socket of sockets) socket.destroy();
    await activated?.catch(() => {});
    while (host?.inspect().inFlight) await new Promise(resolve => setTimeout(resolve, 10));
    await host?.close();
    await embedding?.close?.(); await cleanupEndpoint();
    log('daemon_exit'); await logTail; clearTimeout(outer); closed = true; doneResolve();
  }
  const term = () => { void shutdown().catch(doneReject); };
  process.once('SIGTERM', term); process.once('SIGINT', term);
  server.on('error', () => { doneReject(refuse('daemon_listener')); });
  try {
    await directory.validate();
    const previousMask = process.umask(0o077);
    try {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(paths.socket, () => { server.off('error', reject); resolve(); }); });
    } finally { process.umask(previousMask); }
    await chmod(paths.socket, 0o600);
    const info = await checkedEntry(directory, paths.socket, { socket: true });
    descriptor.socket = { dev: String(info.dev), ino: String(info.ino) };
    await writePrivate(directory, paths.ready, canonical(descriptor));
    log('daemon_ready'); armIdle(); await done;
  } finally {
    process.off('SIGTERM', term); process.off('SIGINT', term); clearTimeout(idle);
    if (!closed) {
      // A failed cleanup must terminate the process while ownership is retained.
      // Returning to withFileLock would release it while old code could write.
      draining = true; server.close(); for (const socket of sockets) socket.destroy();
      try { await host?.close(); await embedding?.close?.(); await cleanupEndpoint(); }
      catch { exit(1); await new Promise(() => {}); }
    }
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
