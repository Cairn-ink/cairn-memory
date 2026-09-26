// Internal lifecycle kernel. Only controlled offline tests inject startChild;
// the public gateway never accepts an alternate launcher or child path.
import { AsyncResource } from 'node:async_hooks';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { checkedMem0NativeArtifact } from './mem0-native-artifact.mjs';
import { mem0WireProfile } from './mem0-wire.mjs';

const CHILD_VERSION = 'cairn-mem0-native-result-v1';

export class Mem0NativeRuntimeError extends Error {
  constructor(code) { super(code); this.name = 'Mem0NativeRuntimeError'; this.code = code; }
}
const fail = code => { throw new Mem0NativeRuntimeError(code); };

function pinnedChildSource(childFile, expected) {
  try {
    const stat = fs.statSync(childFile);
    if (!stat.isFile() || stat.size < 1 || stat.size > 1024 * 1024) return false;
    return createHash('sha256').update(fs.readFileSync(childFile)).digest('hex') === expected;
  } catch { return false; }
}

function parentDirectories(target) {
  const result = [];
  let current = path.dirname(target);
  while (current !== '/') { result.push(current); current = path.dirname(current); }
  return result.reverse();
}

// Internal assembly seam for controlled containment fixtures. Production
// always invokes this with its pinned child via realStartChild; no public
// gateway option accepts these arguments or an alternate command.
export function bubblewrapArguments({ roots, childFile, socket, store }) {
  const directories = new Set(['/usr', '/usr/share', '/tmp', '/case', '/app']);
  for (const target of [roots.venvRoot, roots.pythonRoot]) {
    for (const directory of parentDirectories(target)) directories.add(directory);
  }
  const args = ['--unshare-user', '--unshare-net', '--unshare-pid', '--unshare-ipc',
    '--die-with-parent', '--new-session', '--clearenv'];
  for (const directory of [...directories].sort((a, b) => a.length - b.length)) {
    args.push('--dir', directory);
  }
  args.push('--proc', '/proc', '--dev', '/dev', '--symlink', 'usr/lib', '/lib',
    '--symlink', 'usr/lib64', '/lib64', '--ro-bind', '/usr/lib', '/usr/lib',
    '--ro-bind', '/usr/lib64', '/usr/lib64', '--ro-bind', '/usr/share/zoneinfo',
    '/usr/share/zoneinfo', '--ro-bind', roots.venvRoot, roots.venvRoot,
    '--ro-bind', roots.pythonRoot, roots.pythonRoot,
    '--ro-bind', childFile, '/app/child.py', '--ro-bind', socket,
    '/case/gateway.sock', '--bind', store, '/case/store',
    '--remount-ro', '/', '--chdir', '/case/store');
  const environment = { HOME: '/case/store', MEM0_DIR: '/case/store/mem0',
    XDG_CACHE_HOME: '/case/store/cache', TMPDIR: '/case/store/tmp',
    OPENAI_API_KEY: 'local-only-dummy-key', MEM0_TELEMETRY: 'false',
    PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1',
    HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' };
  for (const [name, value] of Object.entries(environment)) args.push('--setenv', name, value);
  args.push('--', path.join(roots.venvRoot, 'bin/python'), '-I', '-B', '/app/child.py');
  return args;
}

function realStartChild(settings) {
  return spawn('bwrap', bubblewrapArguments(settings), {
    env: {}, stdio: ['pipe', 'pipe', 'pipe'], detached: true, windowsHide: true });
}
function realStopChild(child, signal) {
  if (!Number.isSafeInteger(child.pid) || child.pid <= 0) fail('native_pid_invalid');
  process.kill(-child.pid, signal);
}

async function ownProcessGroupGone(child, milliseconds) {
  if (!Number.isSafeInteger(child?.pid) || child.pid <= 0) return false;
  const deadline = Date.now() + milliseconds;
  while (true) {
    try { process.kill(-child.pid, 0); }
    catch (error) { if (error?.code === 'ESRCH') return true; return false; }
    if (Date.now() >= deadline) return false;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

function within(promise, milliseconds) {
  let timer;
  return Promise.race([promise.then(value => ({ timedOut: false, value })),
    new Promise(resolve => { timer = setTimeout(() => resolve({ timedOut: true }), milliseconds); })])
    .finally(() => clearTimeout(timer));
}

function wellFormed(value) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}

function validOutput(value, topK) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'results,verifiedAddRecords,version'
    || value.version !== CHILD_VERSION
    || !Number.isSafeInteger(value.verifiedAddRecords) || value.verifiedAddRecords < 0
    || !Array.isArray(value.results) || value.results.length > topK) fail('native_output_invalid');
  for (const item of value.results) {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || Object.keys(item).sort().join(',') !== 'attributedTo,id,memory,score'
      || typeof item.id !== 'string' || !item.id || item.id.length > 200
      || !wellFormed(item.id)
      || typeof item.memory !== 'string' || !item.memory || item.memory.length > 65_536
      || !wellFormed(item.memory)
      || typeof item.score !== 'number' || !Number.isFinite(item.score)
      || !(item.attributedTo === null || (typeof item.attributedTo === 'string'
        && item.attributedTo.length <= 200
        && wellFormed(item.attributedTo)))) {
      fail('native_output_invalid');
    }
  }
  return Object.freeze({ version: value.version,
    verifiedAddRecords: value.verifiedAddRecords,
    results: Object.freeze(value.results.map((item) => Object.freeze({ ...item }))) });
}

function listen(server, socket) {
  return new Promise((resolve, reject) => {
    const onError = error => { server.off('listening', onListening); reject(error); };
    const onListening = () => { server.off('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(socket);
  });
}

async function closeServer(server, connections) {
  const socketClosures = [...connections].map(socket => new Promise(resolve => {
    socket.once('close', resolve);
    socket.destroy();
  }));
  const listenerClosure = new Promise(resolve => {
    if (!server.listening) { resolve(); return; }
    server.close(resolve);
  });
  await Promise.all([listenerClosure, ...socketClosures]);
}

function boundedBody(request, maximum, timeoutMs) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      request.off('data', onData); request.off('end', onEnd);
      request.off('aborted', onAbort); request.off('error', onAbort);
      if (error) reject(error); else resolve(value);
    };
    const onData = chunk => {
      size += chunk.length;
      if (size > maximum) finish(new Mem0NativeRuntimeError('native_http_invalid'));
      else chunks.push(chunk);
    };
    const onEnd = () => finish(null, Buffer.concat(chunks));
    const onAbort = () => finish(new Error('disconnect'));
    const timer = setTimeout(() => finish(new Error('body_timeout')), timeoutMs);
    request.on('data', onData); request.once('end', onEnd);
    request.once('aborted', onAbort); request.once('error', onAbort);
  });
}

function requestBody(request, maximum, configuration) {
  if (request.method !== 'POST' || request.httpVersion !== '1.1'
    || request.headers.expect !== undefined || request.headers['transfer-encoding'] !== undefined) {
    fail('native_http_invalid');
  }
  const seen = new Map();
  if (request.rawHeaders.length > configuration.headerLimit * 2) fail('native_http_invalid');
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const key = request.rawHeaders[index].toLowerCase();
    if (request.rawHeaders[index + 1].length > configuration.headerValueBytes) {
      fail('native_http_invalid');
    }
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const key of ['content-length', 'content-type', 'authorization']) {
    if (seen.get(key) !== 1) fail('native_http_invalid');
  }
  if ([...seen.keys()].some(key => !['host', 'accept', 'accept-encoding',
    'connection', 'content-length', 'content-type', 'authorization', 'user-agent',
    'x-stainless-lang', 'x-stainless-package-version', 'x-stainless-os',
    'x-stainless-arch', 'x-stainless-runtime', 'x-stainless-runtime-version',
    'x-stainless-async', 'x-stainless-retry-count', 'x-stainless-read-timeout'].includes(key)
    || seen.get(key) !== 1)
    || request.headers['content-type'] !== 'application/json'
    || request.headers.authorization !== 'Bearer local-only-dummy-key'
    || request.headers.host !== 'unix-gateway'
    || (request.headers['x-stainless-retry-count'] !== undefined
      && request.headers['x-stainless-retry-count'] !== '0')
    || !/^(0|[1-9][0-9]*)$/.test(request.headers['content-length'] ?? '')) {
    fail('native_http_invalid');
  }
  const expected = Number(request.headers['content-length']);
  if (!Number.isSafeInteger(expected) || expected < 1 || expected > maximum) fail('native_http_invalid');
  return expected;
}

export async function runNativeGatewayKernel({ artifact, roots, configuration, childFile,
  guard, handle, input, scope }, { startChild = realStartChild, stopChild = realStopChild,
    forceProcessGroupLiveForTest = false } = {}) {
  const profile = mem0WireProfile();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-y-'));
  fs.chmodSync(root, 0o700);
  const socket = path.join(root, 'gateway.sock');
  const store = path.join(root, 'store');
  fs.mkdirSync(store, { mode: 0o700 });
  fs.mkdirSync(path.join(store, 'tmp'), { mode: 0o700 });
  fs.mkdirSync(path.join(store, 'cache'), { mode: 0o700 });
  const pending = new Set();
  const connections = new Set();
  let fault = null;
  let child = null;
  let childClose = null;
  let childExited = false;
  let childClosed = false;
  let stdout = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let activeRequest = false;
  let stopping = false;
  let terminationAt = null;
  let watchdog;
  let stopResolver;
  const stopped = new Promise(resolve => { stopResolver = resolve; });
  const firstFault = code => {
    if (fault !== null) return;
    fault = code;
    // A gateway/reap/accounting uncertainty is global even if an earlier
    // native request locally sealed this case and X swallows its callback.
    handle.halt();
  };
  const terminate = () => {
    if (stopping) return;
    stopping = true;
    terminationAt = Date.now();
    stopResolver();
    // These stores are disposable. Kill the original owned group at once so
    // bwrap's namespace init cannot be stranded during early startup. Once
    // the leader exits, its numeric PID/PGID can be recycled; never signal it.
    if (child && !childExited && !childClosed
      && Number.isSafeInteger(child.pid) && child.pid > 0) {
      try { stopChild(child, 'SIGKILL'); } catch { firstFault('native_kill_failed'); }
    }
  };
  const onRevoke = () => { terminate(); };
  handle.revocationSignal.addEventListener('abort', onRevoke, { once: true });
  const resource = new AsyncResource('Mem0NativeGatewayRequest');
  const server = http.createServer({ maxHeaderSize: configuration.headerBytes },
    (request, response) => {
    const task = resource.runInAsyncScope(async () => {
      try {
        if (stopping || handle.snapshot().status !== 'active') fail('native_scope_closed');
        const route = request.url === '/v1/chat/completions' ? 'chat'
          : request.url === '/v1/embeddings' ? 'embedding' : null;
        if (!route || activeRequest) fail('native_http_invalid');
        activeRequest = true;
        const limit = profile[route].maxRequestBytes;
        const expected = requestBody(request, limit, configuration);
        const bytes = await boundedBody(request, limit, configuration.httpTimeoutMs);
        if (bytes.length !== expected) fail('native_http_invalid');
        let body;
        try {
          body = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
          JSON.parse(body);
        } catch { fail('native_http_invalid'); }
        if (handle.snapshot().status !== 'active') fail('native_scope_closed');
        const controller = new AbortController();
        const fetch = route === 'chat' ? guard.mem0ChatFetch : guard.mem0EmbeddingFetch;
        const checked = await fetch(profile[route].endpoint, {
          method: 'POST', redirect: 'error', body,
          headers: { authorization: 'Bearer local-only-dummy-key',
            'content-type': 'application/json' }, signal: controller.signal });
        const result = Buffer.from(await checked.arrayBuffer());
        if (result.length > profile[route].maxResponseBytes) fail('native_response_invalid');
        if (!response.destroyed) {
          response.writeHead(checked.status, { 'content-type': 'application/json',
            'content-length': result.length });
          response.end(result);
        } else fail('native_response_disconnect');
      } catch (error) {
        // Complete framing/JSON faults remain global after a local seal;
        // expected transport cancellation from revoke is still locally sealed.
        if (error?.code === 'native_http_invalid'
          || handle.snapshot().status === 'active' || guard.isHalted()) {
          firstFault(error?.code === 'native_scope_closed' ? 'native_scope_closed' : 'native_gateway_failed');
          handle.halt();
        }
        if (!response.destroyed) response.destroy();
        terminate();
      } finally { activeRequest = false; }
    });
    pending.add(task);
    task.finally(() => pending.delete(task)).catch(() => {});
    });
  // Node otherwise silently truncates rawHeaders at the configured count;
  // inspect the complete bounded header block and reject excess ourselves.
  server.maxHeadersCount = 0;
  server.headersTimeout = configuration.headerTimeoutMs;
  server.requestTimeout = configuration.httpTimeoutMs;
  server.timeout = configuration.httpTimeoutMs;
  server.on('connection', connection => {
    if (connections.size >= configuration.connectionLimit) {
      firstFault('native_connection_cap');
      connection.destroy();
      terminate();
      return;
    }
    connections.add(connection);
    connection.once('close', () => connections.delete(connection));
    if (stopping || handle.snapshot().status !== 'active') connection.destroy();
  });
  server.on('clientError', (error, connection) => {
    connection.destroy();
    // Parser faults remain global while the listener exists, even if a prior
    // priced response locally sealed this scope. A reset caused by tearing
    // down a revoked connection is expected cancellation, not a new fault.
    if ((stopping || handle.snapshot().status !== 'active')
      && error?.code === 'ECONNRESET') return;
    firstFault('native_http_invalid'); terminate();
  });
  server.on('timeout', connection => {
    if (!stopping && handle.snapshot().status === 'active') firstFault('native_http_timeout');
    connection.destroy();
    terminate();
  });
  server.on('error', () => { firstFault('native_listener_failed'); handle.halt(); terminate(); });
  let output = null;
  let outcome = null;
  let clean = false;
  try {
    await listen(server, socket);
    fs.chmodSync(socket, 0o600);
    if (handle.snapshot().status !== 'active') fail('native_scope_closed');
    checkedMem0NativeArtifact(artifact);
    if (!pinnedChildSource(childFile, configuration.childSourceSha256)) {
      fail('native_child_source_changed');
    }
    const childInput = Buffer.from(JSON.stringify({ version: 'cairn-mem0-native-child-input-v1',
      socket: '/case/gateway.sock', store: '/case/store', userId: scope.caseId,
      topK: configuration.topK, threshold: configuration.threshold,
      httpTimeoutMs: configuration.httpTimeoutMs, input }), 'utf8');
    // The separately validated input may use all 8 MiB; the fixed trusted
    // protocol envelope has a further 2 KiB allowance, never arbitrary data.
    if (childInput.length > configuration.inputBytes + 2048) fail('native_input_exceeded');
    child = startChild({ roots, childFile, socket, store });
    childClose = new Promise((resolve) => {
      child.once('exit', () => { childExited = true; });
      child.once('close', (code, signal) => {
        childExited = true; childClosed = true; resolve({ code, signal });
      });
      child.once('error', () => { firstFault('native_spawn_failed'); terminate(); });
    });
    child.stdout.on('data', chunk => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > configuration.outputBytes) {
        firstFault('native_output_exceeded'); terminate();
      } else stdout.push(chunk);
    });
    child.stderr.on('data', chunk => {
      stderrBytes += chunk.length;
      if (stderrBytes > configuration.stderrBytes) {
        firstFault('native_stderr_exceeded'); terminate();
      }
    });
    child.stdin.on('error', () => {
      // A pipe broken by our own local revoke/TERM is not a new global cause.
      if (stopping || handle.snapshot().status !== 'active') return;
      firstFault('native_input_failed'); terminate();
    });
    watchdog = setTimeout(() => {
      if (fault === null && handle.snapshot().status === 'active') handle.revoke();
      terminate();
    }, configuration.childTimeoutMs);
    child.stdin.end(childInput);
    const completed = await Promise.race([childClose, stopped.then(() => null)]);
    if (completed?.code !== 0 && completed !== null
      && handle.snapshot().status === 'active') {
      firstFault('native_child_failed');
    }
    if (completed?.code === 0 && fault === null && handle.snapshot().status === 'active') {
      try { output = validOutput(JSON.parse(new TextDecoder('utf-8', { fatal: true })
        .decode(Buffer.concat(stdout))),
        configuration.topK); }
      catch { firstFault('native_output_invalid'); }
    }
    outcome = handle.snapshot().status === 'active' ? 'completed' : 'sealed';
  } catch {
    if (handle.snapshot().status === 'active') firstFault('native_gateway_failed');
    outcome = 'sealed';
    terminate();
  } finally {
    clearTimeout(watchdog);
    handle.revocationSignal.removeEventListener('abort', onRevoke);
    if (child && !childClosed) {
      terminate();
      const remaining = Math.max(1,
        terminationAt + configuration.termGraceMs + configuration.reapMs - Date.now());
      const reaped = await within(childClose, remaining);
      if (reaped.timedOut || !childClosed) firstFault('native_reap_failed');
    }
    let processGroupQuiescent = child === null;
    if (childClosed) {
      // The controlled child is an in-process double. Production always probes
      // the owned OS group; the private test seam can only force non-quiescence.
      const hostGroupGone = startChild !== realStartChild
        || await ownProcessGroupGone(child, configuration.reapMs);
      processGroupQuiescent = hostGroupGone && !forceProcessGroupLiveForTest;
      if (!processGroupQuiescent) firstFault('native_process_group_live');
    }
    try {
      const closed = await within(closeServer(server, connections), configuration.reapMs);
      if (closed.timedOut) firstFault('native_listener_cleanup_failed');
    } catch { firstFault('native_listener_cleanup_failed'); }
    let drained = true;
    if (pending.size) {
      const result = await within(Promise.allSettled([...pending]),
        configuration.httpTimeoutMs + configuration.reapMs);
      drained = !result.timedOut && pending.size === 0;
      if (!drained) firstFault('native_guard_drain_failed');
    }
    try { checkedMem0NativeArtifact(artifact); } catch { firstFault('native_artifact_changed'); }
    if (!pinnedChildSource(childFile, configuration.childSourceSha256)) {
      firstFault('native_child_source_changed');
    }
    try {
      if (guard.isHalted() || guard.attempts().some(attempt => attempt.outcome === null)
        || guard.getState().attempts.some(attempt => attempt.outcome === null)) {
        firstFault('native_accounting_unsettled');
      }
    } catch { firstFault('native_accounting_unsettled'); }
    if ((!child || childClosed) && processGroupQuiescent && drained
      && !server.listening && connections.size === 0) {
      try { fs.rmSync(root, { recursive: true, force: false }); clean = true; }
      catch { firstFault('native_cleanup_failed'); }
    } else firstFault('native_reap_failed');
    resource.emitDestroy();
  }
  if (fault !== null || !clean) { handle.halt(); fail(fault ?? 'native_cleanup_failed'); }
  if (outcome === 'sealed') return Object.freeze({ status: 'sealed', value: null });
  if (outcome !== 'completed' || output === null) { handle.halt(); fail('native_output_invalid'); }
  return Object.freeze({ status: 'completed', value: output });
}
