import { createReadStream } from 'node:fs';
import { decoder, INPUT_BYTES, OUTPUT_BYTES, shape, writeFrame } from './protocol.mjs';
import { VERSION, fail } from './common.mjs';
import { checkFence } from './pack.mjs';
import { loadRuntime, resolutionGuard } from './runtime.mjs';
const root = process.argv[2];
let pack, runtime, guard, busy = false, initialized = false, dead = false, session = null, previous = 0;
async function stop() {
  if (dead) return; dead = true; input.stop();
  try { await runtime?.close(); } catch { /* Only sanitized protocol codes escape. */ }
  guard?.close(); process.stdin.destroy(); process.stdout.end(); lifeline.destroy();
}
async function fatal(code) {
  if (dead) return;
  try { await writeFrame(process.stdout, { v: VERSION, op: 'fatal', manifestHash: pack?.fence.manifestHash, code }, OUTPUT_BYTES); } catch { /* Parent will observe EOF. */ }
  await stop();
}
async function accept(value) {
  if (dead) return;
  try {
    if (!initialized) {
      shape(value, 'init', ['manifestHash', 'threads', 'verificationFence']);
      if (busy || !/^[a-f0-9]{64}$/.test(value.manifestHash) || !Number.isInteger(value.threads) || value.threads < 1 || value.threads > 64 || value.verificationFence?.manifestHash !== value.manifestHash) fail('protocol_error');
      busy = true;
      pack = { packPath: root, fence: value.verificationFence };
      pack.manifest = await checkFence(root, pack.fence); // Before first pack import; bounded manifest read.
      guard = resolutionGuard(pack);
      await checkFence(root, pack.fence); // Immediately before model/session load.
      runtime = await loadRuntime(pack, value.threads, undefined, async () => { guard.assert(); await checkFence(root, pack.fence); });
      guard.assert(); await runtime.embed(['Cairn local embedder warm-up']); guard.assert();
      await checkFence(root, pack.fence); guard.assert(); // After loading and warm-up.
      if (dead) return;
      initialized = true; busy = false;
      await writeFrame(process.stdout, { v: VERSION, op: 'ready', manifestHash: value.manifestHash, dimensions: 1024, normalization: 'l2' }, OUTPUT_BYTES);
    } else {
      shape(value, 'embed', ['session', 'id', 'texts']);
      if (busy || !/^[a-f0-9]{32}$/.test(value.session) || session !== null && session !== value.session || !Number.isSafeInteger(value.id) || value.id !== previous + 1) fail('protocol_error');
      busy = true; session = value.session; previous = value.id;
      try {
        const result = await runtime.embed(value.texts); guard.assert(); await checkFence(root, pack.fence); guard.assert();
        if (!dead) await writeFrame(process.stdout, { v: VERSION, op: 'result', session, id: value.id, ...result }, OUTPUT_BYTES);
      } catch (e) {
        guard.assert();
        if (['model_pack_integrity', 'model_runtime_unavailable'].includes(e.code)) throw e;
        await checkFence(root, pack.fence); guard.assert();
        if (!dead) await writeFrame(process.stdout, { v: VERSION, op: 'error', session, id: value.id, code: ['context_item_too_large', 'dimension_mismatch'].includes(e.code) ? e.code : 'provider_error' }, OUTPUT_BYTES);
      } finally { busy = false; }
    }
  } catch (e) {
    if (['model_pack_integrity', 'model_runtime_unavailable'].includes(e.code)) await fatal(e.code);
    else if (!initialized) await fatal('model_runtime_unavailable');
    else await stop();
  }
}
const input = decoder(INPUT_BYTES, value => { if (value.op === 'close') { shape(value, 'close', []); void stop(); } else void accept(value); }, () => stop());
process.stdin.on('data', chunk => input.push(chunk)); process.stdin.on('end', () => { input.end(); void stop(); }); process.stdin.on('error', () => stop()); process.stdout.on('error', () => stop());
// Pre-init supervisor death cannot leave a native process behind. Once native
// work starts, the registered live parent or independent supervisor kills it.
const lifeline = createReadStream('', { fd: 3 }); lifeline.on('end', () => stop()); lifeline.on('error', () => stop()); lifeline.resume();
