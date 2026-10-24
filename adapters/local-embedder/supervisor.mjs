// This process never imports pack/runtime code or performs file verification.
import { fileURLToPath } from 'node:url';
import { spawnNode, reapGroup } from './process.mjs';
import { decoder, INPUT_BYTES, OUTPUT_BYTES, writeFrame, stderrDrain, shape } from './protocol.mjs';
import { VERSION } from './common.mjs';
import { createWriteStream } from 'node:fs';
export async function runSupervisor({ runner = fileURLToPath(new URL('./child.mjs', import.meta.url)), args = [process.argv[2]], onSpawn = () => {}, control = process.stdin,
  dataOutput = createWriteStream('', { fd: 1 }), registration = createWriteStream('', { fd: 3 }),
  spawn = () => spawnNode(runner, args, { stdio: ['pipe', 'pipe', 'pipe', 'pipe'] }),
  reap = reapGroup, signals = ['SIGTERM', 'SIGINT'] } = {}) {
let child, childClosed = false, stopping = false, shuttingDown, initialized = false;
async function stop() {
  if (shuttingDown) return shuttingDown;
  stopping = true; input.stop(); output?.stop();
  shuttingDown = (async () => {
    // Report EOF now, before reaping. process.stdout's special stream does
    // not own/close fd 1; the dedicated WriteStream does. Native termination
    // may take time, but the parent must latch child_crash before its deadline.
    dataOutput.end(); control.destroy();
    if (child?.pid) { child.stdin.destroy(); await reap(child.pid, () => childClosed); }
    registration.end();
  })();
  return shuttingDown;
}
const input = decoder(INPUT_BYTES, value => {
  if (stopping) return;
  if (value.op === 'close') { shape(value, 'close', []); void stop(); return; }
  if (!initialized) { shape(value, 'init', ['manifestHash', 'threads', 'verificationFence']); initialized = true; }
  else if (value.op !== 'embed') throw new Error('protocol_error');
  control.pause();
  writeFrame(child.stdin, value, INPUT_BYTES).then(() => { if (!stopping) control.resume(); }, () => stop());
}, () => stop());
let output;
control.on('data', chunk => input.push(chunk));
control.on('end', () => { input.end(); void stop(); });
control.on('error', () => stop());
dataOutput.on('error', () => stop());
for (const signal of signals) process.on(signal, () => stop());
try {
  // Only explicit stdio is inherited; fd 3 is a supervisor-to-child lifeline,
  // never the parent's exclusive control writer.
  child = spawn();
  child.stdin.on('error', () => stop());
  child.on('error', () => { childClosed = true; void stop(); });
  child.on('close', () => { childClosed = true; void stop(); });
  stderrDrain(child.stderr);
  output = decoder(OUTPUT_BYTES, () => {}, () => stop());
  child.stdout.on('data', chunk => {
    if (stopping) return;
    // Preserve wire bytes, including an invalid frame/header, so the parent
    // classifies protocol_error rather than seeing only an unexplained EOF.
    if (!dataOutput.write(chunk)) {
      child.stdout.pause(); dataOutput.once('drain', () => { if (!stopping) child.stdout.resume(); });
    }
    output.push(chunk);
  });
  child.stdout.on('end', () => { output.end(); void stop(); });
  // The parent cannot send init (and native loading cannot begin) until it
  // has received this group registration. Pre-registration EOF runs no native.
  await onSpawn(child.pid);
  if (stopping) { await stop(); return; }
  await writeFrame(registration, { v: VERSION, op: 'registered', pid: child.pid }, OUTPUT_BYTES);
  if (stopping) await stop();
} catch { await stop(); }

}
if (process.argv[1] === fileURLToPath(import.meta.url)) await runSupervisor();
