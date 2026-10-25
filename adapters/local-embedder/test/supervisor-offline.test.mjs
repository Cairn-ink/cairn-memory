import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { EventEmitter, once } from 'node:events';
import { runSupervisor } from '../supervisor.mjs';
import { startBundle } from '../bundle.mjs';
import { VERSION } from '../common.mjs';
import { decoder, INPUT_BYTES, OUTPUT_BYTES, frame, nextRequestId } from '../protocol.mjs';
test('L08 crash EOF precedes gated reaping; crash reason wins and settlement still waits for all exits', async () => {
  const control = new PassThrough(), output = new PassThrough(), registration = new PassThrough();
  const inference = Object.assign(new EventEmitter(), { pid: 900000002, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() });
  const supervisor = Object.assign(new EventEmitter(), { pid: 900000001, stdin: control, stdout: output, stderr: new PassThrough(), stdio: [control, output, null, registration] });
  let release, timer, entered;
  const gate = new Promise(resolve => { release = resolve; }), reapEntered = new Promise(resolve => { entered = resolve; });
  const hash = 'a'.repeat(64), pack = { manifestHash: hash, fence: {}, metadata: { id: 'fixture', revision: '1', dimensions: 1024, normalization: 'l2' } };
  const incoming = decoder(INPUT_BYTES, m => {
    if (m.op === 'init') inference.stdout.write(frame({ v: VERSION, op: 'ready', manifestHash: hash, dimensions: 1024, normalization: 'l2' }, OUTPUT_BYTES));
    if (m.op === 'embed') { inference.emit('exit', 7); inference.stdout.end(); }
  }, () => assert.fail('unexpected protocol failure'));
  inference.stdin.on('data', b => incoming.push(b));
  const eof = once(output, 'end');
  const started = startBundle(pack, 4, { spawn: () => supervisor, fence: async () => {},
    setTimer(fn, ms) { if (ms !== 120000) timer = fn; return fn; }, clearTimer() {}, terminate: async (_, pid, closed) => closed });
  await runSupervisor({ control, dataOutput: output, registration, spawn: () => inference, signals: [], reap: async (_, closed) => {
    entered(); await gate; assert.equal(closed(), true); supervisor.emit('close', 0);
  } });
  const b = await started; let settled = false;
  const request = b.embed(['crash']).finally(() => { settled = true; });
  await reapEntered; await eof;
  assert.deepEqual(b.localStatus(), { state: 'unavailable', reason: 'child_crash' });
  timer(); assert.equal(settled, false, 'deadline cannot replace the latched crash or release capacity');
  inference.emit('close', 7); release();
  await assert.rejects(request, { code: 'child_crash' }); await b.close();
});

test('L07/L08 pre-send refusal may skip an ID; the child requires monotonic IDs, never adjacency', () => {
  assert.equal(nextRequestId(2,0),true,'ID 1 was consumed by a pre-send abort/overflow');
  assert.equal(nextRequestId(5,2),true);
  for(const invalid of [0,1,2,-1,1.5,Number.MAX_SAFE_INTEGER+1,'3',null]) assert.equal(nextRequestId(invalid,2),false);
});
