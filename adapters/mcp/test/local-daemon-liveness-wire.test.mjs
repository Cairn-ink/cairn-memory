import test from 'node:test';
import assert from 'node:assert/strict';
import { Duplex, PassThrough } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { runForwarder } from '../local-forwarder.mjs';
import { DAEMON_LIVENESS_FRAME as live, DAEMON_UNRESPONSIVE_MS } from '../local-daemon-wire.mjs';

const diagnostics = new Set();
const until = async (predicate, message) => {
  const end = performance.now() + 3000;
  while (performance.now() < end) { if (predicate()) return; await delay(5); }
  assert.fail(message + '\n' + JSON.stringify([...diagnostics].map(snapshot => snapshot())));
};
const frame = message => JSON.stringify(message) + '\n';
async function harness(t, { unresponsiveMs = 2000, replay, swapped } = {}) {
  const input = new PassThrough(), output = new PassThrough(), peers = [], bytes = [];
  output.on('data', chunk => bytes.push(Buffer.from(chunk)));
  const connect = async () => {
    const from = new PassThrough(), to = new PassThrough();
    const socket = Duplex.from({ readable: from, writable: to });
    const peer = Duplex.from({ readable: to, writable: from });
    socket.on('error', () => {}); peer.on('error', () => {});
    const entry = { socket, peer, requests: [] }; peers.push(entry);
    let buffer = '';
    peer.on('data', chunk => {
      buffer += chunk; let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
        entry.requests.push(message);
        if (peers.length > 1 && message.method === 'initialize') replay?.(entry, message);
      }
    });
    return { socket, descriptor: {}, ready: {} };
  };
  let result;
  const snapshot = () => ({ closeCode: result?.code ?? null, messages: peers.flatMap(p => p.requests), candidates: [] });
  diagnostics.add(snapshot);
  const done = runForwarder([], { input, output, connect, unresponsiveMs,
    onConnected() { if (peers.length > 1) swapped?.(peers); },
  }).then(code => { result = { code }; return code; });
  t.after(async () => {
    input.end();
    await done;
    for (const { socket, peer } of peers) { socket.destroy(); peer.destroy(); }
    output.destroy(); diagnostics.delete(snapshot);
  });
  await until(() => peers.length === 1, 'first socket attached');
  return { input, output, peers, done, result: () => result,
    stdout: () => Buffer.concat(bytes).toString(),
    request(id, method = 'tools/call') { input.write(frame({ jsonrpc: '2.0', id, method })); },
  };
}

for (const split of ['partial', 'same-chunk', 'across-chunks']) test('liveness never reaches stdout: ' + split, { timeout: 5000 }, async t => {
  const h = await harness(t);
  h.request('one'); h.request('two');
  await until(() => h.peers[0].requests.length === 2, 'both requests reached socket');
  const first = ' {"jsonrpc":"2.0", "id":"one", "result":{"synthetic":1}}\n';
  const second = '{"jsonrpc":"2.0","id":"two", "result":2}\n';
  const peer = h.peers[0].peer;
  if (split === 'partial') {
    peer.write(live.slice(0, 17)); await delay(20); assert.equal(h.stdout(), '');
    peer.write(live.slice(17) + first + second);
  } else if (split === 'same-chunk') peer.write(first + live + second + live);
  else {
    peer.write(first + live.slice(0, 23)); await delay(20);
    peer.write(live.slice(23) + second.slice(0, 9)); await delay(20);
    peer.write(second.slice(9) + live);
  }
  await until(() => h.stdout() === first + second, 'only the exact response bytes pass');
  assert.equal(h.result(), undefined);
});

for (const timing of ['private-replay', 'after-swap']) test('liveness during reconnect: ' + timing, { timeout: 5000 }, async t => {
  const h = await harness(t, {
    replay(entry, message) {
      const response = frame({ jsonrpc: '2.0', id: message.id, result: { synthetic: 'private' } });
      if (timing === 'private-replay') {
        entry.peer.write(live.slice(0, 19));
        setTimeout(() => entry.peer.write(live.slice(19) + response + live), 10);
      } else entry.peer.write(response);
    },
    swapped(peers) {
      if (timing === 'after-swap') peers.at(-1).peer.write(live);
      // Model an already queued old-socket data callback after the swap.
      peers[0].socket.emit('data', Buffer.from(live));
    },
  });
  h.request(1, 'initialize');
  await until(() => h.peers[0].requests.length === 1, 'initial initialize received');
  const initial = frame({ jsonrpc: '2.0', id: 1, result: { synthetic: 'client' } });
  h.peers[0].peer.write(initial);
  await until(() => h.stdout() === initial, 'initial response forwarded');
  h.peers[0].socket.destroy();
  await until(() => h.peers.length === 2 && h.peers[1].requests.length === 1, 'private initialize replayed');
  await delay(30);
  h.request(2, 'tools/list');
  await until(() => h.peers[1].requests.some(m => m.id === 2), 'new socket carries new request');
  const response = ' {"jsonrpc":"2.0", "id":2,"result":[]}\n';
  h.peers[1].peer.write(live + response);
  await until(() => h.stdout() === initial + response, 'private replay and both liveness sources are stripped');
});

test('T defaults to thirty seconds; silence errors every id and drops tool connection', { timeout: 5000 }, async t => {
  assert.equal(DAEMON_UNRESPONSIVE_MS, 30000);
  const h = await harness(t, { unresponsiveMs: 80 });
  h.request(10); h.request('second'); h.request(12, 'tools/list');
  await until(() => h.peers[0].requests.length === 3, 'requests in flight');
  assert.equal(await Promise.race([h.done, delay(1500, 'watchdog_did_not_fire')]), 'daemon_unresponsive');
  const expected = [10, 'second', 12].map(id => frame({ jsonrpc: '2.0', id,
    error: { code: -32000, message: 'daemon_unresponsive' } })).join('');
  assert.equal(h.stdout(), expected); assert.equal(h.peers.length, 1);
  h.peers[0].socket.emit('data', Buffer.from(frame({ jsonrpc: '2.0', id: 10, result: 'late' })));
  await delay(20); assert.equal(h.stdout(), expected, 'no late response after timeout');
});

test('non-tool silence reconnects and replays initialize without duplicate stdout', { timeout: 5000 }, async t => {
  const h = await harness(t, { unresponsiveMs: 100, replay(entry, message) {
    entry.peer.write(live + frame({ jsonrpc: '2.0', id: message.id, result: {} }));
  } });
  h.request(1, 'initialize');
  await until(() => h.peers[0].requests.length === 1, 'initialize arrived');
  const initial = frame({ jsonrpc: '2.0', id: 1, result: {} }); h.peers[0].peer.write(initial);
  await until(() => h.stdout() === initial, 'initialize settled');
  h.request(2, 'tools/list');
  await until(() => h.peers.length === 2 && h.peers[1].requests.length === 1, 'silence reconnects');
  h.request(3, 'tools/list');
  await until(() => h.peers[1].requests.some(m => m.id === 3), 'post-reconnect request');
  const response = frame({ jsonrpc: '2.0', id: 3, result: [] }); h.peers[1].peer.write(response);
  const expected = initial + frame({ jsonrpc: '2.0', id: 2, error: { code: -32000, message: 'daemon_unresponsive' } }) + response;
  await until(() => h.stdout() === expected, 'exact client replies, without replay or liveness');
  assert.equal(h.result(), undefined);
});

test('partial liveness bytes keep a pending tool healthy beyond T', { timeout: 5000 }, async t => {
  const h = await harness(t, { unresponsiveMs: 200 }); h.request(1);
  await until(() => h.peers[0].requests.length === 1, 'tool received');
  const started = process.hrtime.bigint();
  for (let offset = 0; offset < live.length; offset += 20) {
    h.peers[0].peer.write(live.slice(offset, offset + 20)); await delay(60);
  }
  assert.ok(Number(process.hrtime.bigint() - started) / 1e6 > 200);
  const response = frame({ jsonrpc: '2.0', id: 1, result: true }); h.peers[0].peer.write(response);
  await until(() => h.stdout() === response, 'healthy tool response survives');
  assert.equal(h.result(), undefined);
});
