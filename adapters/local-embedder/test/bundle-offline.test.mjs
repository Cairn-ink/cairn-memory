import test from 'node:test';
import assert from 'node:assert/strict';
import { startBundle } from '../bundle.mjs';
import { fakeProcess } from './fixtures/fake-process.mjs';
import { VERSION } from '../common.mjs';
const hash = 'a'.repeat(64), pack = { manifestHash: hash, metadata: { id: 'fixture', revision: '1', dimensions: 1024, normalization: 'l2' }, fence: {} };
const vector = Array(1024).fill(0); vector[0] = 1;
async function setup(options = {}, dependencies = {}) {
  let child;
  const bundle = await startBundle(pack, 4, { spawn: () => (child = fakeProcess(options)), fence: async () => {}, terminate: async (_, pid, exited) => exited, ...dependencies });
  return { bundle, child };
}
test('L07 successful split IPC validates vectors and token counts at both endpoints', async () => {
  for (const count of [1, 8192]) {
    const { bundle, child } = await setup({ split: true, response(c, m) { c.send({ v: VERSION, op: 'result', session: m.session, id: m.id, vectors: [vector], tokenCounts: [count] }); } });
    assert.equal((await bundle.embed(['fixture']))[0][0], 1); await bundle.close(); assert.equal(child.closed, true);
  }
});
test('L07 invalid/missing counts poison before settlement even with valid vectors', async () => {
  for (const count of [undefined, [], [1, 2], '1', null, [1.5], [-1], [0], [9007199254740992], [8193], ['1']]) {
    const { bundle, child } = await setup({ response(c, m) { c.send({ v: VERSION, op: 'result', session: m.session, id: m.id, vectors: [vector], ...(count === undefined ? {} : { tokenCounts: count }) }); } });
    await assert.rejects(bundle.embed(['fixture']), { code: 'protocol_error' }); assert.equal(child.closed, true);
    assert.deepEqual(bundle.localStatus(), { state: 'unavailable', reason: 'protocol_error' }); await bundle.close();
  }
});
test('L07 invalid IDs, sessions, duplicate replies, ready replay, EOF and fatal codes poison', async () => {
  for (const mode of ['id', 'session', 'duplicate', 'ready', 'eof', 'fatal', 'vector', 'unknown']) {
    const { bundle, child } = await setup({ response(c, m) {
      const result = { v: VERSION, op: 'result', session: m.session, id: m.id, vectors: [vector], tokenCounts: [1] };
      if (mode === 'id') result.id++;
      if (mode === 'session') result.session = 'b'.repeat(32);
      if (mode === 'unknown') result.unknown = 'CANARY';
      if (mode === 'vector') result.vectors = [[0]];
      if (mode === 'ready') { c.send({ v: VERSION, op: 'ready', manifestHash: hash, dimensions: 1024, normalization: 'l2' }); return; }
      if (mode === 'fatal') { c.send({ v: VERSION, op: 'fatal', manifestHash: hash, code: 'model_pack_integrity' }); return; }
      if (mode === 'eof') { c.finish(); return; }
      c.send(result); if (mode === 'duplicate') c.send(result);
    } });
    await assert.rejects(bundle.embed(['fixture']), { code: mode === 'fatal' ? 'model_pack_integrity' : mode === 'eof' ? 'child_crash' : 'protocol_error' });
    assert.equal(child.closed, true); await bundle.close();
  }
});
test('L08 injected deadline and explicit exit gate retain underlying promise until cleanup', async () => {
  let release, fire, entered;
  const gate = new Promise(resolve => { release = resolve; }), sent = new Promise(resolve => { entered = resolve; });
  const { bundle, child } = await setup({ response() { entered(); }, closeGate: gate }, { setTimer(callback, ms) { if (ms !== 120000) fire = callback; return {}; }, clearTimer() {} });
  let settled = false; const result = bundle.embed(['fixture']).finally(() => { settled = true; });
  await sent; fire(); await Promise.resolve(); assert.equal(settled, false); assert.equal(child.closed, false);
  assert.deepEqual(bundle.localStatus(), { state: 'unavailable', reason: 'timeout' });
  release(); await assert.rejects(result, { code: 'timeout' }); assert.equal(child.closed, true);
  await assert.rejects(bundle.embed(['next']), { code: 'timeout' }); await bundle.close();
});
test('L03 parent fence checked before ready, before send, after inference and before settlement', async () => {
  for (const checkpoint of [1, 2, 3, 4]) {
    let checks = 0;
    const start = setup({}, { fence: async () => { if (++checks === checkpoint) throw Error('CANARY_PATH'); } });
    if (checkpoint === 1) { await assert.rejects(start, { code: 'model_pack_integrity' }); continue; }
    const { bundle } = await start;
    await assert.rejects(bundle.embed(['fixture']), { code: 'model_pack_integrity' }); await bundle.close();
    assert.deepEqual(bundle.localStatus(), { state: 'unavailable', reason: 'model_pack_integrity' });
  }
});
test('L06/L08 IPC overflow and abort before send publish no user frame; abort after send reaps', async () => {
  const { bundle, child } = await setup();
  await assert.rejects(bundle.embed(['\u0001'.repeat(1400000)]), { code: 'context_item_too_large' });
  const early = new AbortController(); early.abort(); await assert.rejects(bundle.embed(['fixture'], { signal: early.signal }), { code: 'timeout' });
  assert.equal(child.frames.filter(f => f.op === 'embed').length, 0); assert.equal(bundle.localStatus().state, 'ready'); await bundle.close();
  let entered; const sent = new Promise(resolve => { entered = resolve; }), controller = new AbortController();
  const second = await setup({ response() { entered(); } });
  const pending = second.bundle.embed(['fixture'], { signal: controller.signal }); await sent; controller.abort();
  await assert.rejects(pending, { code: 'timeout' }); assert.equal(second.child.closed, true); await second.bundle.close();
});
test('L08 initialization clock and failed termination quarantine rather than releasing an active operation', async () => {
  let fire, child;
  const initialization = startBundle(pack, 4, { spawn: () => (child = fakeProcess({ initialize() {} })), fence: async () => {}, terminate: async (_, pid, exited) => exited,
    setTimer(fn) { fire = fn; return 1; }, clearTimer() {} });
  await Promise.resolve(); fire(); await assert.rejects(initialization, { code: 'timeout' }); assert.equal(child.closed, true);
  let sent, expire; const entered = new Promise(resolve => { sent = resolve; });
  const second = await setup({ response() { sent(); }, closeGate: new Promise(() => {}) }, { terminate: async () => { throw Object.assign(Error('quarantined'), { code: 'child_crash' }); },
    setTimer(fn, ms) { if (ms !== 120000) expire = fn; return 1; }, clearTimer() {} });
  let settled = false;
  second.bundle.embed(['fixture']).then(() => { settled = true; }, () => { settled = true; });
  await entered; expire(); await Promise.resolve(); await Promise.resolve(); assert.equal(settled, false);
  await assert.rejects(second.bundle.close(), { code: 'child_crash' }); assert.equal(second.child.closed, false);
});
