import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runCandidate } from '../local-daemon.mjs';
import { workspace, until, ok } from './local-daemon-support.mjs';
import { authenticateClient } from '../local-daemon-wire.mjs';

if (process.argv[2] === 'child') {
  const [bootstrap] = await once(process, 'message');
  const mode = process.argv[3];
  let draining = false, released = false, connections = 0, checks = 0, logGated = false, stampGated = false;
  const gates = new Map();
  const send = (kind, extra = {}) => process.send({ kind, ...extra });
  const gate = name => new Promise(resolve => { gates.set(name, resolve); send(name); });
  process.on('message', message => gates.get(message.kind)?.());
  // Observe the real host, including rejected attach attempts and completed close.
  const hook = registerHooks({ load(url, context, next) {
    const result = next(url, context);
    if (!url.endsWith('/local-shared-runtime.mjs')) return result;
    return { ...result, source: String(result.source)
      .replace('attach(input, output) {', "attach(input, output) { process.send({kind:'attach'});")
      .replace('then(() => runtime?.close());', "then(() => runtime?.close()).then(() => process.send({kind:'host-closed'}));") };
  } });
  const createServer = net.createServer, stat = fs.stat, open = fs.open, unlink = fs.unlink, rename = fs.rename;
  net.createServer = (...args) => {
    const server = createServer(...args), close = server.close.bind(server);
    server.close = (...args) => { if (!draining) send('draining'); draining = true; return close(...args); };
    server.prependListener('connection', socket => {
      connections++;
      socket.prependOnceListener('close', () => { if (draining) send('socket-closed'); });
    });
    return server;
  };
  fs.stat = async (path, ...args) => {
    const result = await stat(path, ...args);
    if (connections === 2 && path === bootstrap.identity.store.path && ++checks === 4) await gate('auth-pending');
    return result;
  };
  const protectedPath = path => /\/d-[a-f0-9]{32}\.(stamp|json|log)(\.tmp-[a-f0-9]{24})?$/.test(String(path));
  fs.open = async (path, ...args) => {
    if (mode === 'startup' && /\.stamp\.tmp-/.test(String(path)) && !draining) await gate('startup-pending');
    if (draining && !stampGated && /\.stamp\.tmp-/.test(String(path))) { stampGated = true; await delay(150); }
    if (protectedPath(path)) send('fs', { operation: 'open', afterRelease: released, target: String(path).match(/\.(stamp|json|log)/)[1] });
    const file = await open(path, ...args);
    for (const name of ['writeFile', 'sync', 'close']) {
      const original = file[name].bind(file);
      file[name] = async (...args) => { if (name === 'writeFile' && mode === 'refusal' && !logGated && String(args[0]).includes('daemon_refused')) { logGated = true; await gate('log-pending'); } if (protectedPath(path)) send('fs', { operation: name, afterRelease: released }); return original(...args); };
    }
    return file;
  };
  fs.rename = async (from, to) => {
    const result = await rename(from, to);
    if (protectedPath(to)) send('fs', { operation: 'rename', afterRelease: released, target: String(to).split('.').at(-1) });
    return result;
  };
  fs.unlink = async path => {
    if (protectedPath(path)) send('fs', { operation: 'unlink', afterRelease: released });
    const result = await unlink(path);
    if (/\/d-[a-f0-9]{32}\.lock$/.test(String(path))) { released = true; send('lifetime-released'); }
    return result;
  };
  syncBuiltinESMExports();
  try {
    await runCandidate(bootstrap, { runtimeOptions: { model: {
      contextWindow: 8192, countTokens: () => 1, rank: () => ({ refs: [] }),
      async select() { await gate('provider-pending'); return { refs: [] }; },
    } } });
    await gate('candidate-returned');
    send('candidate-done');
  } finally { hook.deregister(); process.removeAllListeners('message'); process.disconnect(); }
} else {
  for (const mode of ['before-close', 'after-close', 'startup', 'refusal']) {
    test('writer lifetime joins ' + mode, { timeout: 18000 }, async t => {
      const hooks = [], w = await workspace({ after: hook => hooks.push(hook), diagnostic: text => t.diagnostic(text) });
      const child = fork(new URL(import.meta.url), ['child', mode], { execArgv: [], env: {}, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
      let exit, stderr = '', socket;
      const events = [];
      child.on('message', event => events.push(event)); child.stderr.on('data', bytes => { stderr += bytes; });
      child.once('exit', (code, signal) => { exit = { code, signal }; });
      const seen = kind => events.some(event => event.kind === kind);
      const wait = kind => until(() => seen(kind), kind);
      const release = kind => child.send({ kind });
      child.send(await w.bootstrap());
      try {
        if (mode === 'startup') {
          await wait('startup-pending'); child.kill('SIGTERM'); await wait('draining');
          await delay(100); assert.equal(seen('lifetime-released'), false);
          release('startup-pending');
        } else {
          const descriptor = await until(w.descriptor, 'candidate publishes');
          const a = w.forward(); a.release(); await w.connect(a);
          ok(await a.tool('remember_memory', { content: 'synthetic cobalt telescope pending authentication', kind: 'fact' }));
          const work = a.tool('recall_memory', { query: 'synthetic cobalt telescope' });
          await wait('provider-pending');
          const names = await fs.readdir(join(w.root, 'run', 'cairn-memory'));
          socket = net.createConnection(join(w.root, 'run', 'cairn-memory', names.find(name => name.endsWith('.sock'))));
          socket.on('error', () => {}); await once(socket, 'connect');
          const authentication = authenticateClient(socket, descriptor, descriptor.identity, performance.now() + 10000).catch(error => error.code);
          await wait('auth-pending'); child.kill('SIGTERM'); await wait('socket-closed');
          if (mode === 'after-close') {
            release('provider-pending'); await work;
            // The old shutdown reaches host close here. A correct producer join
            // holds that boundary until authentication settles instead.
            await delay(150);
            t.diagnostic('after-close schedule: host closed before auth release=' + seen('host-closed'));
          }
          release('auth-pending');
          if (mode === 'refusal') {
            await wait('log-pending'); await delay(100); assert.equal(seen('lifetime-released'), false);
            release('log-pending');
          }
          if (mode !== 'after-close') release('provider-pending');
          await authentication; await work;
        }
        await wait('candidate-returned'); await delay(200); release('candidate-returned');
        await until(() => exit, 'candidate exits');
        assert.equal(exit.code, 0, stderr);
        assert.ok(seen('lifetime-released'));
        const drain = events.findIndex(event => event.kind === 'draining');
        assert.equal(events.slice(drain + 1).some(event => event.kind === 'attach'), false, 'no attach after drain');
        assert.deepEqual(events.filter(event => event.kind === 'fs' && event.afterRelease), [], 'no protected filesystem work after lifetime release');
      } finally {
        t.diagnostic(JSON.stringify({ mode, events, exit, stderr }));
        socket?.destroy(); if (!exit) child.kill('SIGKILL');
        await until(() => exit, 'child reaped'); await hooks[0]();
      }
    });
  }
}
