import { decoder, INPUT_BYTES, OUTPUT_BYTES, writeFrame } from '../../protocol.mjs';
import { VERSION } from '../../common.mjs';
import { checkFence } from '../../pack.mjs';
import { createReadStream, writeFileSync } from 'node:fs';
globalThis.fetch = () => { throw new Error('NETWORK_FORBIDDEN'); };
let fence, busy = false;
const root = process.argv[2], mode = process.argv[3];
const lifeline = createReadStream('', { fd: 3 }); lifeline.on('end', () => process.exit(0)); lifeline.resume();
if (mode === 'blocked-load' || mode === 'blocked-inference') process.on('SIGTERM', () => {});
function block() { if (process.argv[4]) writeFileSync(process.argv[4], JSON.stringify({ pid: process.pid, ppid: process.ppid })); process.stderr.write('ENTERED_BLOCK\n'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0); }
const input = decoder(INPUT_BYTES, value => {
  if (busy) process.exit(1); busy = true;
  void (async () => {
    if (value.op === 'init') {
      fence = value.verificationFence; await checkFence(root, fence);
      if (mode === 'blocked-load') block();
      await writeFrame(process.stdout, { v: VERSION, op: 'ready', manifestHash: value.manifestHash, dimensions: 1024, normalization: 'l2' }, OUTPUT_BYTES);
    } else if (value.op === 'embed') {
      const text = value.texts[0];
      if (text === 'crash') process.exit(7);
      if (text === 'stall') return;
      if (mode === 'blocked-inference') block();
      if (text === 'stderr') process.stderr.write('CANARY_SECRET_USER_TEXT'.repeat(10000));
      await checkFence(root, fence);
      const vector = Array(1024).fill(0); vector[0] = 1;
      const tokenCounts = text.startsWith('tokens:') ? JSON.parse(text.slice(7)) : [1];
      await writeFrame(process.stdout, { v: VERSION, op: 'result', session: value.session, id: value.id, vectors: [vector], tokenCounts }, OUTPUT_BYTES);
    }
    busy = false;
  })().catch(() => process.exit(2));
}, () => process.exit(3));
process.stdin.on('data', chunk => input.push(chunk)); process.stdin.on('end', () => process.exit(0));
