import { EventEmitter } from 'node:events';
import { Writable, PassThrough } from 'node:stream';
import { decoder, frame, INPUT_BYTES, OUTPUT_BYTES } from '../../protocol.mjs';
import { VERSION } from '../../common.mjs';
export function fakeProcess({ response, initialize, split = false, closeGate } = {}) {
  const child = new EventEmitter(), stdout = new PassThrough(), stderr = new PassThrough(), registration = new PassThrough();
  child.pid = 900000001; child.stdout = stdout; child.stderr = stderr; child.stdio = [null, stdout, stderr, registration]; child.frames = []; child.closed = false;
  child.send = value => { const bytes = frame(value, OUTPUT_BYTES); if (split) for (let i = 0; i < bytes.length; i += 3) stdout.write(bytes.subarray(i, i + 3)); else stdout.write(bytes); };
  child.finish = () => { if (child.closed) return; child.closed = true; stdout.end(); stderr.end(); registration.end(); child.emit('close', 0, null); };
  const input = decoder(INPUT_BYTES, message => {
    child.frames.push(message);
    queueMicrotask(() => {
      if (message.op === 'init') {
        if (initialize) initialize(child, message);
        else child.send({ v: VERSION, op: 'ready', manifestHash: message.manifestHash, dimensions: 1024, normalization: 'l2' });
      } else if (message.op === 'embed') {
        if (response) response(child, message);
        else { const vector = Array(1024).fill(0); vector[0] = 1; child.send({ v: VERSION, op: 'result', session: message.session, id: message.id, vectors: [vector], tokenCounts: [1] }); }
      }
    });
  }, () => child.finish());
  child.stdin = new Writable({ write(chunk, encoding, callback) { input.push(chunk); callback(); }, final(callback) { if (closeGate) closeGate.then(() => child.finish()); else child.finish(); callback(); } });
  queueMicrotask(() => registration.write(frame({ v: VERSION, op: 'registered', pid: 900000002 }, OUTPUT_BYTES)));
  return child;
}
