// Runners are discoverable at link time; their entry guards perform no work.
import './supervisor.mjs';
import './child.mjs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { spawnNode, reapGroup } from './process.mjs';
import { decoder, frame, INPUT_BYTES, OUTPUT_BYTES, shape, stderrDrain } from './protocol.mjs';
import { VERSION, refusal, fail, QUARANTINED } from './common.mjs';
import { checkFence } from './pack.mjs';
import { validateVector } from '../../core/context-read-embedder.mjs';
import { validateText } from './runtime.mjs';
const requestErrors = new Set(['context_item_too_large', 'dimension_mismatch', 'provider_error']);
const fatalErrors = new Set(['model_pack_integrity', 'model_runtime_unavailable']);
export async function startBundle(pack, threads, {
  spawn = () => spawnNode(fileURLToPath(new URL('./supervisor.mjs', import.meta.url)), [pack.packPath], { stdio: ['pipe', 'pipe', 'pipe', 'pipe'], threads }),
  now = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout, fence = () => checkFence(pack.packPath, pack.fence),
  onRegistration = () => {},
  terminate = async (child, pid, closed) => { if (!child.stdin.writableEnded) child.stdin.end(); if (pid) await reapGroup(pid, () => true); await closed; }, initializationMs = 120000
} = {}) {
  let processHandle, processClosed = false, group, state = Object.freeze({ state: 'unavailable', reason: 'model_runtime_unavailable' }), pending, dead = false, ready = false, closing, registered = false, sequence = 0, lastTokenCount = null, checking = false, preparing = false;
  const session = randomBytes(16).toString('hex');
  let resolveExit, resolveReady, rejectReady;
  const exited = new Promise(resolve => { resolveExit = resolve; });
  const readiness = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  let stderr, initTimer;
  const cleanup = () => {
    if (closing) return closing;
    dead = true; decoderOut.stop(); registration.stop(); clearTimer(initTimer);
    closing = (async () => {
      if (processHandle) {
        // EOF is an irrevocable shutdown request to the independent supervisor.
        if (!processHandle.stdin.writableEnded) processHandle.stdin.end(frame({ v: VERSION, op: 'close' }, INPUT_BYTES));
        await terminate(processHandle, group, exited);
      }
      stderr?.clear();
    })();
    return closing;
  };
  const poison = code => {
    if (dead) return;
    state = Object.freeze({ state: 'unavailable', reason: code });
    const current = pending; pending = null;
    const stopped = cleanup();
    // Initialization and embed promises settle only after confirmed reaping.
    stopped.then(() => { rejectReady(refusal(code)); current?.reject(refusal(code)); }, () => {
      // A failed termination is a quarantine: never settle an embed/active slot.
      rejectReady(refusal('child_crash'));
    });
  };
  const accept = value => {
    if (dead || checking) fail('protocol_error');
    if (value.op === 'fatal') {
      shape(value, 'fatal', ['manifestHash', 'code']);
      if (value.manifestHash !== pack.manifestHash || !fatalErrors.has(value.code)) fail('protocol_error');
      poison(value.code); return;
    }
    if (!ready) {
      shape(value, 'ready', ['manifestHash', 'dimensions', 'normalization']);
      if (!registered || value.manifestHash !== pack.manifestHash || value.dimensions !== 1024 || value.normalization !== 'l2') fail('protocol_error');
      checking = true;
      Promise.resolve().then(fence).then(() => {
        checking = false; if (dead) return; clearTimer(initTimer); ready = true;
        state = Object.freeze({ state: 'ready', reason: null }); resolveReady();
      }, () => poison('model_pack_integrity'));
      return;
    }
    if (!pending || value.session !== session || value.id !== pending.id) fail('protocol_error');
    if (value.op === 'error') {
      shape(value, 'error', ['session', 'id', 'code']); if (!requestErrors.has(value.code)) fail('protocol_error');
    } else {
      shape(value, 'result', ['session', 'id', 'vectors', 'tokenCounts']);
      if (!Array.isArray(value.tokenCounts) || value.tokenCounts.length !== 1 || !Number.isSafeInteger(value.tokenCounts[0]) || value.tokenCounts[0] < 1 || value.tokenCounts[0] > 8192 || !Array.isArray(value.vectors) || value.vectors.length !== 1) fail('protocol_error');
      try { value.vectors = [validateVector(value.vectors[0], pack.metadata)]; } catch { fail('protocol_error'); }
    }
    const current = pending;
    checking = true;
    Promise.resolve().then(fence).then(async () => {
      // A separate checkpoint immediately before embed-promise settlement.
      await fence(); checking = false;
      if (dead || pending !== current) return;
      if (current.signal?.aborted || now() >= current.deadline) { poison('timeout'); return; }
      pending = null;
      if (value.op === 'error') current.reject(refusal(value.code)); else { lastTokenCount = value.tokenCounts[0]; current.resolve(value.vectors); }
    }).catch(() => poison('model_pack_integrity'));
  };
  const decoderOut = decoder(OUTPUT_BYTES, accept, poison);
  const registration = decoder(OUTPUT_BYTES, value => {
    shape(value, 'registered', ['pid']);
    if (registered || !Number.isSafeInteger(value.pid) || value.pid < 2 || value.pid === process.pid || value.pid === processHandle.pid) fail('protocol_error');
    registered = true; group = value.pid;
    onRegistration({ supervisorPid: processHandle.pid, inferencePid: group });
    const bytes = frame({ v: VERSION, op: 'init', manifestHash: pack.manifestHash, threads, verificationFence: pack.fence }, INPUT_BYTES);
    processHandle.stdin.write(bytes);
  }, poison);
  try {
    processHandle = spawn();
    processHandle.stdin.on('error', () => poison('child_crash'));
    stderr = stderrDrain(processHandle.stderr);
    processHandle.stdout.on('data', chunk => decoderOut.push(chunk));
    processHandle.stdout.on('end', () => { decoderOut.end(); if (!dead) poison('child_crash'); });
    processHandle.stdio[3].on('data', chunk => registration.push(chunk));
    processHandle.stdio[3].on('end', () => { registration.end(); if (!registered && !dead) poison('child_crash'); });
    processHandle.on('error', () => poison('child_crash'));
    processHandle.on('close', () => {
      processClosed = true; resolveExit();
      if (!dead) poison('child_crash');
      // poison() invokes group cleanup even when the supervisor has exited.
      // Supervisor exit alone never certifies inference-group termination.
    });
    initTimer = setTimer(() => poison('timeout'), initializationMs);
    await readiness;
  } catch (e) {
    if (!processHandle) { dead = true; resolveExit(); fail('model_runtime_unavailable'); }
    if (!dead) poison(e.code ?? 'model_runtime_unavailable');
    try { await cleanup(); }
    catch { const quarantined = refusal('child_crash'); Object.defineProperty(quarantined, QUARANTINED, { value: true }); throw quarantined; }
    throw e;
  }
  return {
    localStatus: () => state,
    async embed(texts, options = {}) {
      validateText(texts);
      if (dead || state.state !== 'ready') fail(state.reason === 'timeout' ? 'timeout' : 'provider_error');
      if (pending || checking || preparing) fail('budget_denied');
      if (options.signal?.aborted) fail('timeout');
      const deadline = Math.min(now() + 5000, options.deadlineAt ?? Infinity);
      if (!Number.isFinite(deadline) || deadline <= now() || sequence === Number.MAX_SAFE_INTEGER) fail('timeout');
      // Build and bound the complete frame before dispatch. No attempt-specific
      // ID is reused, even when the guard refuses a transmission.
      const id = ++sequence, bytes = frame({ v: VERSION, op: 'embed', session, id, texts }, INPUT_BYTES);
      preparing = true;
      try { await fence(); } catch { poison('model_pack_integrity'); await cleanup(); throw refusal('model_pack_integrity'); }
      finally { preparing = false; }
      if (dead) { await cleanup(); fail(state.reason === 'timeout' ? 'timeout' : 'provider_error'); }
      if (options.signal?.aborted || now() >= deadline) fail('timeout');
      let timer, abort;
      try {
        return await new Promise((resolve, reject) => {
          pending = { id, resolve, reject, deadline, signal: options.signal };
          abort = () => poison('timeout');
          options.signal?.addEventListener('abort', abort, { once: true });
          timer = setTimer(abort, Math.max(0, deadline - now()));
          try { options.beforeDispatch?.(); if (options.signal?.aborted || now() >= deadline) { abort(); return; } processHandle.stdin.write(bytes); }
          catch (e) { pending = null; reject(e); }
        });
      } finally { clearTimer(timer); options.signal?.removeEventListener('abort', abort); }
    },
    async close() {
      if (!dead) {
        state = Object.freeze({ state: 'closed', reason: 'closed' });
        const current = pending; pending = null;
        await cleanup(); current?.reject(refusal('provider_error'));
      } else await cleanup();
    },
    // Bounded diagnostic categories only; raw stderr is never exported.
    whenClosed: () => exited,
    diagnostics: () => Object.freeze({ stderrBytes: stderr?.bytes ?? 0, exited: processClosed, lastTokenCount })
  };
}
