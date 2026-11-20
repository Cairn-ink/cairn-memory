import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, createConnection } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { authenticateServer } from '../local-daemon-wire.mjs';

async function pair(t, serverWork) {
  const root = await mkdtemp('/tmp/cr3-w-'), sockets = [];
  const server = createServer(socket => { sockets.push(socket); socket.on('error', () => {}); void serverWork(socket).catch(() => socket.destroy()); });
  await new Promise(resolve => server.listen(join(root, 'wire.sock'), resolve));
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const socket = createConnection(join(root, 'wire.sock')); sockets.push(socket); socket.on('error', () => {}); await once(socket, 'connect'); return socket;
}
const descriptor = () => ({ protocol: 2, identity: { protocol: 2, build: 'synthetic-build' }, incarnation: 'a'.repeat(64), capability: 'b'.repeat(64) });
test('server independently refuses a protocol-one hello before authentication or MCP', async t => {
  const d = descriptor(); let code, admissions = 0;
  const socket = await pair(t, async peer => {
    try {
      await authenticateServer(peer, d, { deadline: performance.now() + 1000, admitting: () => true,
        authenticated: async () => { admissions++; } });
    } catch (error) { code = error.code; peer.destroy(); }
  });
  const closed = once(socket, 'close');
  socket.write(JSON.stringify({ kind: 'hello', protocol: 1, identity: d.identity,
    incarnation: d.incarnation, clientNonce: 'c'.repeat(64) }) + '\n');
  await closed;
  assert.equal(code, 'daemon_protocol'); assert.equal(admissions, 0);
});
