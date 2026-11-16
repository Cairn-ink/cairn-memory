import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import { fork, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { PassThrough } from 'node:stream';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { runtimeDirectory, endpointPaths, readPrivate, identityKey, logCode } from '../local-daemon-state.mjs';
import { withFileLock } from '../../../integrations/client/file-lock.mjs';
import { connectOrStart, runForwarder } from '../local-forwarder.mjs';
import { runDaemonCommand } from '../local-daemon-liveness.mjs';
import { workspace, until } from './local-daemon-support.mjs';

// Match the supervised daemon's empty Node configuration, as the child fixtures do.
process.execArgv = [];

async function privateWorkspace(t) {
  const root = await fs.mkdtemp(join(dirname(tmpdir()), 'r-'));
  await fs.mkdir(join(root, 'run'), { mode: 0o700 });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root };
}
async function republish(path) {
  const temporary = path + '.reader-test';
  await fs.writeFile(temporary, await fs.readFile(path), { mode: 0o600 });
  await fs.rename(temporary, path);
}
if (process.argv[2] === 'fifo') {
  const directory = await runtimeDirectory({ root: process.argv[3] });
  const path = endpointPaths(directory, 'f'.repeat(64)).ready;
  const open = fs.open;
  fs.open = async (name, ...args) => {
    if (name === path) {
      await fs.unlink(path);
      const fifo = spawnSync('mkfifo', ['-m', '600', path], { encoding: 'utf8' });
      assert.equal(fifo.status, 0, fifo.stderr);
    }
    return open(name, ...args);
  };
  syncBuiltinESMExports();
  try { await readPrivate(directory, path, { fileClass: 'descriptor' }); process.send({ code: 'accepted' }); }
  catch (error) { process.send({ code: error.code }); }
  process.disconnect();
} else {
  test('a: attached session survives descriptor/stamp snapshots and its real five-second heartbeat rename', { timeout: 25000 }, async t => {
    const w = await workspace(t), a = w.forward(); a.release(); await w.connect(a);
    const directory = await runtimeDirectory({ root: join(w.root, 'run') });
    const paths = endpointPaths(directory, (await import('node:crypto')).createHash('sha256').update((await import('../local-daemon-identity.mjs')).canonical((await w.descriptor()).identity)).digest('hex'));
    const input = new PassThrough(), output = new PassThrough(), connections = [], responses = [];
    let buffer = '', result, settled = false, race, hits = 0;
    output.on('data', bytes => { buffer += bytes; let end; while ((end = buffer.indexOf('\n')) >= 0) { responses.push(JSON.parse(buffer.slice(0, end))); buffer = buffer.slice(end + 1); } });
    const open = fs.open;
    fs.open = async (path, ...args) => {
      const selected = race && path === paths[race.field];
      if (!selected) return open(path, ...args);
      const mode = race.mode; race = undefined; hits++;
      if (mode === 'heartbeat') {
        const before = await fs.lstat(path);
        await until(async () => (await fs.lstat(path)).ino !== before.ino, 'real daemon heartbeat replaces stamp', 6500);
      } else if (mode === 'before') await republish(path);
      const file = await open(path, ...args);
      if (mode === 'after') {
        const stat = file.stat.bind(file);
        file.stat = async (...args) => { const info = await stat(...args); await republish(path); return info; };
      }
      return file;
    };
    syncBuiltinESMExports();
    const done = runForwarder(w.args, { root: join(w.root, 'run'), environment: {}, input, output,
      onConnected: value => connections.push(value),
    }).then(code => { result = code; settled = true; });
    const connected = count => until(() => { assert.equal(settled, false, 'attached session closed: ' + result); return connections.length >= count; }, 'session reconnects');
    try {
      await connected(1);
      input.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'synthetic-reader', version: '1' } } }) + '\n');
      await until(() => responses.find(response => response.id === 1), 'initialize response');
      input.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
      for (const [field, mode] of [['ready','before'], ['stamp','before'], ['ready','after'], ['stamp','after'], ['stamp','heartbeat']]) {
        const count = connections.length + 1; race = { field, mode };
        connections.at(-1).socket.destroy(); await connected(count);
        const id = count + 1;
        input.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/list', params: {} }) + '\n');
        await until(() => { assert.equal(settled, false, result); return responses.find(response => response.id === id); }, 'attached RPC survives replacement');
      }
      assert.equal(hits, 5);
      assert.equal(responses.filter(response => response.id === 1).length, 1, 'private initialize replay stays private');
    } finally { fs.open = open; syncBuiltinESMExports(); input.end(); await done; }
    assert.equal(result, null);
  });

  for (const action of ['status', 'stop']) for (const field of ['ready', 'stamp']) {
    test('b: ' + action + ' retains its shape during ' + field + ' republication', { timeout: 18000 }, async t => {
      const w = await workspace(t), a = w.forward(); a.release(); await w.connect(a);
      if (action === 'stop') { a.process.stdin.end(); await until(() => a.messages.some(message => message.kind === 'forwarder-done'), 'session closes'); }
      const suffix = field === 'ready' ? '.json' : '.stamp', open = fs.open;
      let injected = 0, text = '';
      fs.open = async (path, ...args) => { if (!injected && String(path).endsWith(suffix)) { injected++; await republish(path); } return open(path, ...args); };
      syncBuiltinESMExports();
      try {
        assert.equal(await runDaemonCommand([action, '--db', w.path], { root: join(w.root, 'run'), write: value => { text += value; } }), 0);
        assert.equal(injected, 1);
        const value = JSON.parse(text);
        if (action === 'status') {
          assert.equal(value.daemons.length, 1);
          assert.deepEqual(Object.keys(value.daemons[0]).sort(), ['attached_sessions','build','last_codes','running','stamp_age_seconds','store']);
        } else assert.deepEqual(value, { stopped: 1, still_running: 0 });
      } finally { fs.open = open; syncBuiltinESMExports(); }
    });
  }

  test('c: typed lock family and key accept the real two-link publication window', async t => {
    const w = await privateWorkspace(t), directory = await runtimeDirectory({ root: join(w.root, 'run') });
    const paths = endpointPaths(directory, 'c'.repeat(64));
    for (const path of [paths.lock, paths.takeover, join(directory.path, 'p-' + 'a'.repeat(32) + '.lock')]) {
      await withFileLock(path, async () => {
        assert.equal((await fs.lstat(path)).nlink, 2);
        assert.equal(JSON.parse(await readPrivate(directory, path, { fileClass: 'lock' })).pid, process.pid);
      });
      await assert.rejects(fs.lstat(path), { code: 'ENOENT' });
    }
    const key = await identityKey(directory), path = join(directory.path, 'identity-v1.key'), alias = path + '.retained';
    await fs.link(path, alias);
    assert.deepEqual(await identityKey(directory), key);
    await fs.unlink(alias);
    await fs.writeFile(paths.ready, '{}', { mode: 0o600 });
    await assert.rejects(readPrivate(directory, paths.ready, { fileClass: 'key' }), { code: 'daemon_entry' }, 'a typed reference cannot change namespace');
  });

  test('d: endpoint and log extra links refuse, and an invalid log is never overwritten', async t => {
    const w = await privateWorkspace(t), directory = await runtimeDirectory({ root: join(w.root, 'run') }), paths = endpointPaths(directory, 'd'.repeat(64));
    for (const [path, fileClass] of [[paths.ready, 'descriptor'], [paths.stamp, 'stamp'], [paths.log, 'log']]) {
      await fs.writeFile(path, '{}', { mode: 0o600 }); await fs.link(path, path + '.extra');
      await assert.rejects(readPrivate(directory, path, { fileClass }), { code: 'daemon_entry_links' });
      if (fileClass === 'log') { await assert.rejects(logCode(directory, path, 'daemon_ready'), { code: 'daemon_entry_links' }); assert.equal(await fs.readFile(path, 'utf8'), '{}'); }
      await fs.unlink(path + '.extra');
    }
  });

  test('e: FIFO swapped after entry inspection is refused without hanging', { timeout: 5000 }, async t => {
    const w = await privateWorkspace(t), directory = await runtimeDirectory({ root: join(w.root, 'run') }), path = endpointPaths(directory, 'f'.repeat(64)).ready;
    await fs.writeFile(path, '{}', { mode: 0o600 });
    const child = fork(new URL(import.meta.url), ['fifo', join(w.root, 'run')], { execArgv: [], env: {}, stdio: ['ignore','ignore','pipe','ipc'] });
    let result, stderr = ''; child.on('message', value => { result = value; }); child.stderr.on('data', bytes => { stderr += bytes; });
    const bound = setTimeout(() => child.kill('SIGKILL'), 2000);
    try { const [code, signal] = await once(child, 'exit'); assert.equal(signal, null, 'FIFO read exceeded its own bound'); assert.equal(code, 0, stderr); assert.deepEqual(result, { code: 'daemon_entry_type' }); }
    finally { clearTimeout(bound); await fs.unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  });

  test('f: oversized descriptor refuses once; daemon_entry_changed is never a broad retry', { timeout: 15000 }, async t => {
    const w = await workspace(t), a = w.forward(); a.release(); await w.connect(a);
    const directory = join(w.root, 'run', 'cairn-memory'), name = (await fs.readdir(directory)).find(name => name.endsWith('.json')), path = join(directory, name);
    const bytes = await fs.readFile(path), open = fs.open; let opens = 0;
    await fs.writeFile(path, ' '.repeat(65537), { mode: 0o600 });
    fs.open = async (name, ...args) => { if (name === path) opens++; return open(name, ...args); }; syncBuiltinESMExports();
    try { await assert.rejects(connectOrStart(w.args, { root: join(w.root, 'run'), environment: {}, connectMs: 700 }), { code: 'daemon_entry_changed' }); assert.equal(opens, 1); }
    finally { fs.open = open; syncBuiltinESMExports(); await fs.writeFile(path, bytes); }
  });

  test('raced stamp-open absence restarts discovery before candidate launch', { timeout: 15000 }, async t => {
    const w = await workspace(t), a = w.forward(); a.release(); const expected = await w.connect(a);
    const directory = join(w.root, 'run', 'cairn-memory');
    const ready = join(directory, (await fs.readdir(directory)).find(name => name.endsWith('.json')));
    const stamp = ready.slice(0, -5) + '.stamp', socket = ready.slice(0, -5) + '.sock';
    const open = fs.open, lstat = fs.lstat, candidates = [];
    let epoch = 0, missingEpoch, injected = false, connection;
    fs.open = async (path, ...args) => {
      if (path === ready) epoch++;
      if (path === stamp && !injected) {
        injected = true; missingEpoch = epoch;
        throw Object.assign(Error('synthetic_stamp_open_missing'), { code: 'ENOENT' });
      }
      return open(path, ...args);
    };
    fs.lstat = async (path, ...args) => {
      // Model the same election window: this socket is absent in the old
      // discovery pass, but available after a fresh descriptor discovery.
      if (path === socket && missingEpoch === epoch) throw Object.assign(Error('synthetic_socket_missing'), { code: 'ENOENT' });
      return lstat(path, ...args);
    };
    syncBuiltinESMExports();
    try {
      connection = await connectOrStart(w.args, { root: join(w.root, 'run'), environment: {},
        onCandidate: child => candidates.push(once(child, 'exit')),
      });
      assert.equal(injected, true); assert.equal(connection.descriptor.incarnation, expected.incarnation);
      assert.equal(candidates.length, 0, 'raced stamp absence must repeat discovery before considering a candidate');
    } finally { fs.open = open; fs.lstat = lstat; syncBuiltinESMExports(); connection?.socket.destroy(); await Promise.all(candidates); }
  });

  test('g: one connect EAGAIN authenticates within the original deadline', { timeout: 15000 }, async t => {
    const w = await workspace(t), a = w.forward(); a.release(); const expected = await w.connect(a);
    const createConnection = net.createConnection; let calls = 0;
    const candidates = [];
    net.createConnection = (...args) => {
      if (++calls !== 1) return createConnection(...args);
      const socket = new net.Socket(); queueMicrotask(() => socket.destroy(Object.assign(Error('synthetic'), { code: 'EAGAIN' }))); return socket;
    }; syncBuiltinESMExports();
    const start = performance.now(); let connection;
    try {
      connection = await connectOrStart(w.args, { root: join(w.root, 'run'), environment: {}, connectMs: 2000, onCandidate: child => candidates.push(once(child, 'exit')) });
      assert.equal(connection.descriptor.incarnation, expected.incarnation); assert.ok(calls >= 2); assert.ok(performance.now() - start < 2000); assert.ok(candidates.length <= 3);
    } finally { net.createConnection = createConnection; syncBuiltinESMExports(); connection?.socket.destroy(); await Promise.all(candidates); }
  });

  test('g: repeated connect EAGAIN cannot renew the original deadline or authenticate later', { timeout: 15000 }, async t => {
    const w = await workspace(t), a = w.forward(); a.release(); await w.connect(a);
    const createConnection = net.createConnection, candidates = [], authentications = [];
    const connectMs = 700, toleranceMs = 150, start = performance.now();
    let calls = 0, connection;
    net.createConnection = (...args) => {
      calls++;
      // Continue EAGAIN well past the original deadline. Then expose the real
      // endpoint, so an incorrectly renewed inner loop can authenticate late
      // even if connectOrStart's outer timer has already refused the caller.
      if (performance.now() - start < connectMs + 400) {
        const socket = new net.Socket();
        queueMicrotask(() => socket.destroy(Object.assign(Error('synthetic'), { code: 'EAGAIN' })));
        return socket;
      }
      const socket = createConnection(...args), write = socket.write.bind(socket);
      socket.write = (...bytes) => { authentications.push(performance.now() - start); return write(...bytes); };
      socket.on('connect', () => { connection = socket; });
      return socket;
    };
    syncBuiltinESMExports();
    try {
      await assert.rejects(connectOrStart(w.args, { root: join(w.root, 'run'), environment: {}, connectMs,
        onCandidate: child => candidates.push(once(child, 'exit')),
      }), { code: 'daemon_connect_timeout' });
      const refusedMs = performance.now() - start;
      assert.ok(refusedMs <= connectMs + toleranceMs, 'refusal within original 700ms + 150ms scheduling tolerance: ' + refusedMs);
      assert.ok(calls >= 2, 'EAGAIN was retried');
      await delay(Math.max(0, start + connectMs * 2 + 400 - performance.now()));
      assert.deepEqual(authentications, [], 'no authentication after the original deadline');
      assert.ok(candidates.length <= 3, 'original three-candidate limit is retained');
      t.diagnostic(JSON.stringify({ connectMs, toleranceMs, refusedMs, calls, candidates: candidates.length, authentications }));
    } finally {
      net.createConnection = createConnection; syncBuiltinESMExports(); connection?.destroy();
      await Promise.all(candidates);
    }
  });

}
