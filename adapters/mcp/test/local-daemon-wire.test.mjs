import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, createConnection } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { authenticateClient, authenticateServer, frameGuard, requestLedger, proof, verifyProof, FRAME_BYTES, QUEUE_BYTES } from '../local-daemon-wire.mjs';

async function pair(t, serverWork) {
  const root = await mkdtemp('/tmp/cr3-w-'), sockets = [];
  const server = createServer(socket => { sockets.push(socket); socket.on('error', () => {}); void serverWork(socket).catch(() => socket.destroy()); });
  await new Promise(resolve => server.listen(join(root, 'wire.sock'), resolve));
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const socket = createConnection(join(root, 'wire.sock')); sockets.push(socket); socket.on('error', () => {}); await once(socket, 'connect'); return socket;
}
const descriptor = () => ({ protocol: 1, identity: { protocol: 1, build: 'synthetic-build' }, incarnation: 'a'.repeat(64), capability: 'b'.repeat(64) });
test('each authentication uses fresh client and server challenges', async t => {
  const d = descriptor(), clients = [], servers = [];
  for (let i = 0; i < 2; i++) {
    const socket = await pair(t, async peer => {
      peer.once('data', bytes => clients.push(JSON.parse(bytes).clientNonce));
      const write = peer.write.bind(peer);
      peer.write = (bytes, ...args) => { const message = JSON.parse(bytes); if (message.kind === 'challenge') servers.push(message.serverNonce); return write(bytes, ...args); };
      await authenticateServer(peer, d, { deadline: performance.now() + 1000, admitting: () => true });
    });
    await authenticateClient(socket, d, d.identity, performance.now() + 1000); socket.destroy();
  }
  assert.equal(new Set(clients).size, 2, 'each authentication must use fresh client and server nonces');
  assert.equal(new Set(servers).size, 2, 'each authentication must use fresh client and server nonces');
});
test('mutual challenge keeps MCP bytes behind auth; capability identity version nonce and drain refuse', async t => {
  for (const kind of ['valid', 'capability', 'identity', 'protocol', 'nonce', 'draining']) {
    const d = descriptor(); let mcpBytes = 0;
    const socket = await pair(t, async peer => {
      if (kind === 'nonce') {
        peer.once('data', bytes => {
          const hello = JSON.parse(bytes), transcript = { protocol: 1, identity: d.identity, incarnation: d.incarnation, clientNonce: hello.clientNonce, serverNonce: 'c'.repeat(64) };
          peer.write(JSON.stringify({ kind: 'challenge', clientNonce: 'wrong', serverNonce: transcript.serverNonce, mac: proof(d.capability, 'server', transcript) }) + '\n');
          peer.once('data', () => peer.write(JSON.stringify({ kind: 'ready', metadata: {}, mac: proof(d.capability, 'ready', { ...transcript, metadata: {} }) }) + '\n'));
        }); return;
      }
      await authenticateServer(peer, d, { deadline: performance.now() + 1000, admitting: () => kind !== 'draining' });
      peer.on('data', bytes => { mcpBytes += bytes.length; }); peer.resume();
    });
    const seen = { ...d, capability: kind === 'capability' ? 'c'.repeat(64) : d.capability };
    const identity = { ...d.identity, ...(kind === 'identity' ? { build: 'wrong-build' } : {}), ...(kind === 'protocol' ? { protocol: 2 } : {}) };
    if (kind === 'valid') { await authenticateClient(socket, seen, identity, performance.now() + 1000); socket.write('synthetic-MCP\n'); }
    else {
      await assert.rejects(authenticateClient(socket, seen, identity, performance.now() + 1000), undefined, kind + ' must refuse before MCP');
      assert.equal(mcpBytes, 0, 'authentication refusal must precede every MCP byte: ' + kind);
    }
    socket.destroy();
  }
});
test('client independently refuses an authenticated peer advertising a different full identity or protocol', async t => {
  for (const kind of ['identity', 'protocol']) {
    const d = descriptor(), identity = { ...d.identity, ...(kind === 'identity' ? { build: 'different' } : { protocol: 2 }) };
    const advertised = { ...d, ...(kind === 'protocol' ? { protocol: 2, identity } : {}) };
    const socket = await pair(t, peer => authenticateServer(peer, { ...d, identity }, { deadline: performance.now() + 1000, admitting: () => true }));
    await assert.rejects(authenticateClient(socket, advertised, identity, performance.now() + 1000), undefined, 'client must compare full identity and protocol before MCP: ' + kind);
    socket.destroy();
  }
});
test('HMAC binds both fresh nonces full identity incarnation and phase', () => {
  const transcript = { clientNonce: 'a'.repeat(64), serverNonce: 'b'.repeat(64), identity: { build: 'synthetic' }, incarnation: 'c'.repeat(64) };
  const original = proof('d'.repeat(64), 'server', transcript);
  for (const altered of [{ ...transcript, clientNonce: 'e'.repeat(64) }, { ...transcript, serverNonce: 'e'.repeat(64) },
    { ...transcript, incarnation: 'e'.repeat(64) }, { ...transcript, identity: { build: 'other' } }])
    assert.throws(() => verifyProof(original, proof('d'.repeat(64), 'server', altered)), /daemon_auth/, 'changed handshake transcript must fail HMAC');
  assert.throws(() => verifyProof(original, proof('d'.repeat(64), 'client', transcript)), /daemon_auth/, 'challenge roles must be distinct');
});
test('byte framing queue and tool concurrency bounds close only their stream', async () => {
  const fail = async (bytes, options, marker, message) => {
    const stream = frameGuard(options); stream.on('error', () => {});
    let timer;
    try {
      const error = Promise.race([once(stream, 'error').then(([error]) => error), new Promise(resolve => { timer = setTimeout(() => resolve({ code: 'unsafe_input_accepted' }), 200); })]);
      stream.write(bytes); assert.match((await error).code, marker, message);
    } finally { clearTimeout(timer); stream.destroy(); }
  };
  await fail(Buffer.from('x'.repeat(FRAME_BYTES)), {}, /daemon_frame_limit/, 'frame byte bound must reject unterminated overlong frame');
  await fail(Buffer.from(JSON.stringify({ method: 'synthetic/notification', params: 'x'.repeat(FRAME_BYTES) }) + '\n'), {}, /daemon_frame_limit/, 'framed line byte bound must reject overlong valid JSON');
  await fail(Buffer.alloc(QUEUE_BYTES + 1), {}, /daemon_queue_limit/, 'queue byte bound must reject oversized queued input');
  const ledger = requestLedger();
  for (let id = 0; id < 8; id++) ledger.request({ id, method: 'tools/call', params: { synthetic: 'not retained' } });
  assert.deepEqual([...ledger.pending.values()], Array(8).fill('tool'), 'ledger must contain only method classes');
  assert.throws(() => ledger.request({ id: 8, method: 'tools/call' }), /daemon_tool_limit/, 'ninth tool call must refuse');
  ledger.response({ id: 0, result: {} }); ledger.request({ id: 8, method: 'tools/call' });
  const other = requestLedger(); other.request({ id: 1, method: 'tools/call' }); assert.equal(other.tools, 1, 'another connection must remain usable');
});
