// Keep this import closure Node-core-only, including before entry fallback.
import { createConnection } from 'node:net';
import { spawn } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { createIdentity, selectedEnvironment, assertStore, assertStoreLocation, canonical, daemonVector, creationIdentity, creationDigest, physicalStore, storeFilesystemProbe, DAEMON_PROTOCOL } from './local-daemon-identity.mjs';
import { runtimeDirectory, identityKey, endpointPaths, readPrivate, checkedEntry, refuse } from './local-daemon-state.mjs';
import { takeOver } from './local-daemon-liveness.mjs';
import { authenticateClient, frameGuard, requestLedger, queuedBytes, QUEUE_BYTES, DAEMON_UNRESPONSIVE_MS, DAEMON_LIVENESS_METHOD } from './local-daemon-wire.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function connectOrStart(args, options = {}) {
  const milliseconds = Math.min(options.connectMs ?? 10000, 10000), deadline = performance.now() + milliseconds;
  let timer;
  const endpointState = { changed: false };
  try {
    return await Promise.race([connectAttempt(args, options, deadline, endpointState), new Promise((_, reject) => {
      timer = setTimeout(() => reject(refuse(endpointState.changed ? 'daemon_endpoint_changed' : 'daemon_connect_timeout')), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}
function spawnCandidate(payload, environment, options) {
  const bytes = JSON.stringify(payload);
  if (Buffer.byteLength(bytes) > 65536) throw refuse('daemon_bootstrap_limit');
  const launchEnvironment = { ...environment };
  delete launchEnvironment.OPENAI_API_KEY; delete launchEnvironment.CAIRN_CONTEXT_SEMANTIC_OPENAI_API_KEY;
  const child = spawn(process.execPath, [...process.execArgv, fileURLToPath(new URL('./local-daemon.mjs', import.meta.url))], {
    detached: true, shell: false, env: launchEnvironment, stdio: ['ignore', 'ignore', 'pipe', 'pipe'],
  });
  const candidate = { exited: false };
  child.once('exit', () => { candidate.exited = true; });
  child.on('error', () => { candidate.exited = true; });
  let stderrBytes = 0;
  child.stderr.on('data', bytes => { stderrBytes += bytes.length; if (stderrBytes > 4096) child.stderr.destroy(); });
  child.stderr.on('error', () => {}); child.stderr.unref();
  child.stdio[3].on('error', () => {}); child.stdio[3].end(bytes); child.stdio[3].unref(); child.unref();
  options.onCandidate?.(child);
  return candidate;
}
async function connectAttempt(args, options, deadline, endpointState) {
  const filesystem = storeFilesystemProbe(options.storeStatfs);
  const environment = selectedEnvironment(options.environment);
  const directory = await runtimeDirectory({ root: options.root });
  const vector = daemonVector(args);
  if (!vector.eligible) throw refuse('daemon_not_eligible');
  await assertStoreLocation(vector.configuration.path, directory, filesystem);
  const creation = await creationIdentity(vector.configuration.path, undefined, filesystem);
  const creationLock = resolve(directory.path, 'p-' + creationDigest(creation).slice(0, 32) + '.lock');
  const candidateLimit = 3;
  let candidate, attempts = 0;
  const canSpawn = () => (!candidate || candidate.exited) && attempts < candidateLimit;
  const launch = payload => { attempts++; candidate = spawnCandidate(payload, environment, options); };
  while (performance.now() < deadline) {
    let exists = false;
    try { await physicalStore(creation.path, undefined, filesystem); exists = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const creating = await checkedEntry(directory, creationLock, { missing: true });
    if (exists && !creating) break;
    if (canSpawn() && performance.now() < deadline) launch({ creation, root: options.root });
    await delay(Math.min(25 + randomInt(76), Math.max(1, deadline - performance.now())));
  }
  if (performance.now() >= deadline) throw refuse('daemon_connect_timeout');
  const identity = await createIdentity(args, { key: await identityKey(directory), environment, build: options.build, filesystem });
  if (!identity.eligible) throw refuse('daemon_not_eligible');
  const paths = endpointPaths(directory, identity.digest);
  while (performance.now() < deadline) {
    await directory.validate(); await assertStore(identity.record, filesystem);
    let text, descriptor;
    try {
      text = await readPrivate(directory, paths.ready, { missing: true });
      if (text) {
        try { descriptor = JSON.parse(text); } catch { throw refuse('daemon_descriptor'); }
        if (descriptor.protocol !== DAEMON_PROTOCOL) throw refuse('daemon_protocol');
        if (canonical(descriptor.identity) !== canonical(identity.record)) throw refuse('daemon_identity');
        if (await takeOver(directory, paths, descriptor, { ...options.takeoverOptions, staleMs: options.unresponsiveMs ?? DAEMON_UNRESPONSIVE_MS, deadline })) continue;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // A lifetime-lock winner can reap the predecessor's descriptor/stamp
      // between the private-file inode check and open. Re-read the published
      // generation and repeat every check within the original connect budget.
      await delay(Math.min(25, Math.max(1, deadline - performance.now())));
      continue;
    }
    if (text) {
      const info = await checkedEntry(directory, paths.socket, { socket: true, missing: true });
      if (info) {
        if (String(info.dev) !== descriptor.socket?.dev || String(info.ino) !== descriptor.socket?.ino) {
          endpointState.changed = true;
          // A normal dead-owner election may publish between these reads.
          // Re-enter every identity, takeover and authentication check without
          // extending the original budget or trusting the changed socket.
          await delay(Math.min(25, Math.max(1, deadline - performance.now())));
          continue;
        }
        const socket = createConnection({ path: paths.socket }); socket.on('error', () => {});
        const timer = setTimeout(() => socket.destroy(refuse('daemon_connect_timeout')), Math.min(2000, Math.max(1, deadline - performance.now())));
        try {
          await once(socket, 'connect');
          const ready = await authenticateClient(socket, descriptor, identity.record, deadline);
          clearTimeout(timer); return { socket, descriptor, ready };
        } catch (error) {
          clearTimeout(timer); socket.destroy();
          if (!['ENOENT', 'ECONNREFUSED', 'daemon_transport', 'daemon_connect_timeout'].includes(error.code)) throw error;
        }
      }
    }
    if (canSpawn() && performance.now() < deadline) {
      launch({ args, environment, identity: identity.record, root: options.root, build: options.build });
    }
    await delay(Math.min(25 + randomInt(76), Math.max(1, deadline - performance.now())));
  }
  throw refuse(endpointState.changed ? 'daemon_endpoint_changed' : 'daemon_connect_timeout');
}

export async function runForwarder(args = process.argv.slice(2), options = {}) {
  const input = options.input ?? process.stdin, output = options.output ?? process.stdout;
  const ledger = requestLedger();
  const monotonicMs = () => Number(process.hrtime.bigint() / 1000000n);
  const unresponsiveMs = options.unresponsiveMs ?? DAEMON_UNRESPONSIVE_MS;
  let socket, incoming, watchdog, lastByte = monotonicMs(), closed = false, attached = false, recovering, initialize, initialized;
  const outgoing = frameGuard({ onFrame(message, bytes) {
    if (!ledger.pending.size) lastByte = monotonicMs();
    ledger.request(message);
    if (message.method === 'initialize') initialize = Buffer.from(bytes);
    if (message.method === 'notifications/initialized') initialized = Buffer.from(bytes);
  }, queued: () => queuedBytes(socket, incoming, output) });
  let finish;
  const done = new Promise(resolve => { finish = resolve; });
  const close = (code, preserveStdio = false) => {
    if (closed) return;
    closed = true; clearInterval(watchdog); input.unpipe(outgoing); outgoing.unpipe(); incoming?.unpipe();
    socket?.destroy(); outgoing.destroy(); incoming?.destroy(); ledger.clear();
    initialize = initialized = undefined;
    input.off('end', end); output.off('close', end);
    // Own async stream errors through final close, including teardown aborts.
    if (preserveStdio) {
      input.off('error', failed); output.off('error', failed);
    } else {
      input.once('close', () => input.off('error', failed)); output.once('close', () => output.off('error', failed));
      input.destroy(); output.end();
    }
    process.off('SIGTERM', term); process.off('SIGINT', term); finish(code);
  };
  const failed = () => close('daemon_transport');
  const end = () => close(null), term = () => close('daemon_terminated');
  input.once('end', end); input.on('error', failed); output.on('error', failed); output.once('close', end);
  process.once('SIGTERM', term); process.once('SIGINT', term); outgoing.on('error', failed);
  async function transportErrors(code = 'daemon_transport') {
    for (const id of ledger.pending.keys()) {
      const bytes = JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message: code } }) + '\n';
      if (output.writableLength + Buffer.byteLength(bytes) > QUEUE_BYTES) throw refuse('daemon_queue_limit');
      if (!output.write(bytes)) await once(output, 'drain');
    }
    ledger.clear();
  }
  async function establish(replay = false) {
    const connection = await (options.connect ?? connectOrStart)(args, options);
    if (closed) { connection.socket.destroy(); return; }
    attached = true;
    socket = connection.socket;
    lastByte = monotonicMs();
    options.onConnected?.(connection);
    let replayId, replayResolve, replayReject, detached = false;
    const replayDone = new Promise((resolve, reject) => { replayResolve = resolve; replayReject = reject; });
    // Only initialization is replayed. Its response belongs to the private replay,
    // and must not appear as a duplicate response on the client's stdout.
    const filter = frameGuard({ onFrame(message) {
      if (!detached && socket === connection.socket) ledger.response(message);
    }, queued: () => queuedBytes(socket, outgoing, output) });
    incoming = filter;
    const originalPush = filter.push.bind(filter);
    filter.push = (bytes, encoding) => {
      if (bytes) {
        if (closed || socket !== connection.socket || detached) return true;
        const message = JSON.parse(bytes.toString('utf8'));
        if (message.method === DAEMON_LIVENESS_METHOD && !Object.hasOwn(message, 'id')) {
          if (message.params?.protocol !== DAEMON_PROTOCOL) throw refuse('daemon_protocol');
          return true;
        }
        if (replayId !== undefined && message.id === replayId && !message.method) {
          replayId = undefined;
          if (message.error) replayReject(refuse('daemon_reinitialize')); else replayResolve();
          return true;
        }
      }
      return originalPush(bytes, encoding);
    };
    filter.on('error', () => { if (!detached && socket === connection.socket) failed(); });
    filter.pipe(output, { end: false }); socket.pipe(filter);
    const lost = (code = 'daemon_transport') => {
      if (closed || socket !== connection.socket) return;
      detached = true; clearInterval(watchdog);
      replayReject?.(refuse('daemon_transport'));
      outgoing.unpipe(connection.socket); connection.socket.unpipe(filter); filter.unpipe(output); filter.destroy(); connection.socket.destroy();
      if (recovering) return;
      const toolInFlight = ledger.tools > 0;
      recovering = (async () => {
        input.pause();
        await transportErrors(code);
        if (toolInFlight) { close(code === 'daemon_unresponsive' ? code : 'daemon_outcome_unknown'); return; }
        if (outgoing.pendingBytes || outgoing.readableLength || outgoing.writableLength) { close('daemon_transport'); return; }
        await establish(true);
        if (!closed) input.resume();
      })().catch(() => close('daemon_transport')).finally(() => { recovering = undefined; });
    };
    socket.once('close', () => lost());
    socket.on('data', () => { if (!detached && socket === connection.socket) lastByte = monotonicMs(); });
    watchdog = setInterval(() => {
      if (ledger.pending.size && monotonicMs() - lastByte >= unresponsiveMs) lost('daemon_unresponsive');
    }, Math.max(1, Math.min(250, unresponsiveMs)));
    if (replay && initialize) {
      replayId = JSON.parse(initialize.toString('utf8')).id;
      const timer = setTimeout(() => replayReject(refuse('daemon_reinitialize_timeout')), 2000);
      try {
        socket.write(initialize); await replayDone;
        if (initialized) socket.write(initialized);
      } finally { clearTimeout(timer); }
    } else replayDone.catch(() => {});
    if (!closed) outgoing.pipe(socket, { end: false });
  }
  try { await establish(); if (!closed) input.pipe(outgoing); }
  catch (error) {
    if (!attached && !closed) close({ refused: /^daemon_[a-z_]+$/.test(error.code) ? error.code : 'daemon_transport', cause: { name: error.name, code: error.code } }, true);
    else close('daemon_transport');
  }
  return done;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runForwarder();
  const code = result?.refused ?? result;
  if (code) { process.stderr.write(code + '\n'); process.exitCode = 1; }
}
