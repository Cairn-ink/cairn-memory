import { createConnection } from 'node:net';
import { spawn } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { runForwarder } from '../../adapters/mcp/local-forwarder.mjs';
import { assertStore, assertStoreLocation, canonical, createIdentity, selectedEnvironment } from '../../adapters/mcp/local-daemon-identity.mjs';
import { checkedEntry, endpointPaths, identityKey, readPrivate, refuse, retryMetadata, runtimeDirectory } from '../../adapters/mcp/local-daemon-state.mjs';
import { takeOver } from '../../adapters/mcp/local-daemon-liveness.mjs';
import { authenticateClient, frameGuard, queuedBytes, requestLedger } from '../../adapters/mcp/local-daemon-wire.mjs';
import { assertActiveAuthority, managedGeneration } from './daemon-authority.mjs';
import { serveStdio } from './host.mjs';
import { documentCardsReady, localModelKey } from './provider-config.mjs';
import { truncateWal } from './wal-checkpoint.mjs';

function start(args, environment) {
  const worker = fileURLToPath(new URL('./daemon-worker.mjs', import.meta.url));
  const child = spawn(process.execPath, [...process.execArgv, worker, ...args],
    { detached: true, env: environment, stdio: 'ignore' });
  const state = { exited: false };
  child.once('exit', () => { state.exited = true; });
  child.once('error', () => { state.exited = true; });
  child.unref();
  return state;
}

async function connect(args, options, generation, environment) {
  const deadline = performance.now() + 10000;
  const store = await assertActiveAuthority(generation, options);
  const directory = await runtimeDirectory();
  await assertStoreLocation(store.path, directory);
  const identity = await createIdentity(args, {
    key: await identityKey(directory, { deadline }), build: generation.build, root: generation.packageRoot, environment,
  });
  if (!identity.eligible || canonical(identity.record.store) !== canonical(store)) throw refuse('daemon_active_store');
  const { record, digest } = identity, paths = endpointPaths(directory, digest);
  let child, attempts = 0;
  while (performance.now() < deadline) {
    await assertActiveAuthority(generation, options);
    await assertStore(record);
    const descriptor = await retryMetadata(async () => {
      const text = await readPrivate(directory, paths.ready, { fileClass: 'descriptor', missing: true, openMissing: false });
      return text ? JSON.parse(text) : undefined;
    }, deadline);
    if (descriptor) {
      if (canonical(descriptor.identity) !== canonical(record)) throw refuse('daemon_identity');
      if (await takeOver(directory, paths, descriptor, { deadline })) continue;
      const info = await checkedEntry(directory, paths.socket, { socket: true, missing: true });
      if (info && String(info.dev) === descriptor.socket?.dev && String(info.ino) === descriptor.socket?.ino) {
        const socket = createConnection({ path: paths.socket });
        socket.on('error', () => {});
        try {
          await once(socket, 'connect', { signal: AbortSignal.timeout(Math.max(1, Math.ceil(deadline - performance.now()))) });
          const ready = await authenticateClient(socket, descriptor, record, deadline);
          return { socket, descriptor, ready };
        } catch (error) {
          socket.destroy();
          if (!['ENOENT', 'EAGAIN', 'ECONNREFUSED', 'daemon_transport', 'daemon_connect_timeout'].includes(error.code)) throw error;
        }
      }
    }
    if ((!child || child.exited) && attempts < 3) {
      await assertActiveAuthority(generation, options);
      child = start(args, environment);
      attempts++;
    }
    await delay(randomInt(25, 101));
  }
  throw refuse('daemon_connect_timeout');
}

async function forwardStdio(args, connect) {
  const stdin = process.stdin, stdout = process.stdout;
  const input = new PassThrough(), ledger = requestLedger();
  let ended = false;
  // Piped callers may close stdin immediately after sending a request. Let
  // the daemon finish every accepted response before closing the transport.
  const finish = () => { if (ended && !ledger.pending.size) input.end(); };
  const incoming = frameGuard({ onFrame: message => ledger.request(message), queued: () => queuedBytes(input) });
  const output = frameGuard({ onFrame(message) { ledger.response(message); finish(); } });
  const abort = error => input.destroy(error);
  stdin.on('error', abort);
  stdout.on('error', abort);
  incoming.on('error', abort);
  incoming.once('end', () => { ended = true; finish(); });
  output.pipe(stdout, { end: false });
  const result = runForwarder(args, { input, output, connect });
  stdin.pipe(incoming).pipe(input, { end: false });
  try { return await result; }
  finally {
    stdin.unpipe(incoming);
    stdin.off('error', abort);
    stdout.off('error', abort);
    incoming.destroy();
    input.destroy();
    if (!output.writableEnded) output.end();
  }
}

async function serveDirect(options, readKey) {
  const generation = managedGeneration();
  const store = await assertActiveAuthority(generation, options);
  const authorize = async () => {
    const current = await assertActiveAuthority(generation, options, { modelConsent: !!readKey });
    if (current.dev !== store.dev || current.ino !== store.ino || (readKey && !current.modelConsent)) {
      throw refuse('daemon_active_store');
    }
  };
  if (readKey) options.provider = { readKey, owner: options.owner, authorize, request: fetch };
  const controller = new AbortController();
  const stop = () => controller.abort();
  const shared = {
    authorize,
    async checkpointForget() {
      // Another stdio session can hold SQLite open. Checkpoint the forgotten
      // bytes before replying while preserving the per-session search state.
      await authorize();
      await truncateWal(store.path, { wait: true });
    },
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  try {
    await serveStdio(process.stdin, process.stdout, options,
      { shared, closed: () => controller.signal.aborted, signal: controller.signal });
  } finally {
    process.off('SIGTERM', stop);
    process.off('SIGINT', stop);
    if (controller.signal.aborted) process.stdin.destroy();
    await (await shared.runtime?.catch(() => {}))?.close();
  }
}

export async function serveManaged(args, options) {
  try {
    const environment = selectedEnvironment(undefined, { providerKeys: false });
    const generation = managedGeneration();
    const { modelConsent } = await assertActiveAuthority(generation, options, { modelConsent: true });
    if (modelConsent && !documentCardsReady) throw refuse('daemon_configuration');
    const readKey = () => localModelKey(process.env);
    const keyed = modelConsent && !!readKey();
    if (process.platform === 'darwin' || keyed) return await serveDirect(options, keyed ? readKey : undefined);
    const result = await forwardStdio(args, () => connect(args, options, generation, environment));
    const code = result?.refused ?? result;
    if (code) throw refuse(code);
  } catch (error) {
    process.stderr.write((process.platform === 'darwin' ?
      'cairn_mcp_start_failed: check documented startup arguments and dependencies' :
      /^daemon_[a-z_]+$/u.test(error.code) ? error.code : 'daemon_active_store') + '\n');
    process.exitCode = 1;
  }
}
