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
import { authenticateClient } from '../local-daemon-wire.mjs';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import * as idleSidecar from '../../../tools/testing/fixtures/daemon-idle-sidecar.mjs';

if (process.argv[2] === 'child') {
  const [bootstrap] = await once(process, 'message');
  const mode = process.argv[3];
  let draining = false, released = false, connections = 0, checks = 0, logGated = false, stampGated = false;
  const gates = new Map();
  const send = (kind, extra = {}) => process.send({ kind, ...extra });
  const gate = name => new Promise(resolve => { gates.set(name, resolve); send(name); });
  process.on('message', message => gates.get(message.kind)?.());
  globalThis.a10Gate = gate;
  const rawMode = mode.startsWith('raw-');
  let syntheticNow = 100;
  if (rawMode) Object.defineProperty(performance, 'now', { configurable: true, value: () => syntheticNow });
  let barrier, worker;
  if (mode === 'raw-native') {
    barrier = new Int32Array(new SharedArrayBuffer(4));
    worker = new Worker(`const {workerData,parentPort}=require('node:worker_threads');
      const value=new Int32Array(workerData);
      new (require('node:net').Socket)({fd:4,readable:true,writable:false}).on('data',()=>{
        Atomics.store(value,0,1);Atomics.notify(value,0);});parentPort.postMessage('ready');`, { eval: true, workerData: barrier.buffer });
    await once(worker, 'message');
  }
  let rawTask, idleTask;
  globalThis.a10Scheduler = {
    setTimer(callback) { rawTask = { callback, unref() {} }; send('raw-scheduled'); return rawTask; },
    clearTimer(task) { if (task && task === rawTask) { rawTask = null; send('raw-cancelled'); } },
  };
  const nativeTimer = globalThis.setTimeout;
  globalThis.setTimeout = function(callback, ms, ...args) {
    const stack = new Error().stack;
    if (rawMode && /at arm \([^\n]*\/core\/local-raw-search.mjs:/.test(stack)) {
      return globalThis.a10Scheduler.setTimer(callback);
    }
    if (rawMode && /at armIdle \([^\n]*local-daemon.mjs:/.test(stack)) {
      idleTask = { callback }; send('idle-scheduled'); return idleTask;
    }
    return nativeTimer(callback, ms, ...args);
  };
  const nativeClear = globalThis.clearTimeout;
  globalThis.clearTimeout = function(task) {
    if (task && task === rawTask) { rawTask = null; send('raw-cancelled'); return; }
    if (task && task === idleTask) return;
    return nativeClear(task);
  };
  process.on('message', message => {
    if (message.kind === 'tick') {
      syntheticNow += 1100;
      const task = rawTask; rawTask = null;
      Promise.resolve(task?.callback()).then(() => send('tick-settled'));
    }
    if (message.kind === 'expire') { idleTask?.callback(); send('expiry-processed'); }
    if (message.kind === 'flush') void (async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); send('flushed'); })();
  });
  // Observe the real host, including rejected attach attempts and completed close.
  const hook = registerHooks({ load(url, context, next) {
    const result = next(url, context);
    if (rawMode && ['raw-opening', 'raw-status-opening'].includes(mode) && url.endsWith('/raw-search-index.mjs')) return { ...result,
      source: String(result.source).replace('const interrupted = error =>', "if (!globalThis.a10OpeningGated) { globalThis.a10OpeningGated = true; await globalThis.a10Gate('raw-pending'); } const interrupted = error =>") };
    if (mode === 'raw-status-opening' && url.endsWith('/local-raw-search.mjs')) return { ...result,
      source: String(result.source)
        .replace('if (entry.service) return entry.service;', "if (entry.opening) process.send({kind:'opening-shared'}); if (entry.service) return entry.service;")
        .replace("entry.error = error?.code ?? 'raw_search_unavailable';", "process.send({kind:'raw-failed'}); entry.error = error?.code ?? 'raw_search_unavailable';") };
    if (rawMode && ['raw-preparation', 'raw-reattach'].includes(mode) && url.endsWith('/raw-search-maintenance.mjs')) return { ...result,
      source: String(result.source).replace('const started=performance.now(),state=storage.head();', "if (!globalThis.a10PreparationGated) { globalThis.a10PreparationGated = true; await globalThis.a10Gate('raw-pending'); } const started=performance.now(),state=storage.head();") };
    if (!url.endsWith('/local-shared-runtime.mjs')) return result;
    return { ...result, source: String(result.source)
      .replace('rawUpkeepScheduler } = {})', rawMode ? 'rawUpkeepScheduler = globalThis.a10Scheduler } = {})' : 'rawUpkeepScheduler } = {})')
      .replace('attach(input, output) {', "attach(input, output) { process.send({kind:'attach'});")
      .replace('connections.delete(handle);', "connections.delete(handle); process.send({kind:'detach-processed'});")
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
    if (!rawMode && connections === 2 && path === bootstrap.identity.store.path && ++checks === 4) await gate('auth-pending');
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
  const sidecars = new WeakSet(), prepare = DatabaseSync.prototype.prepare, exec = DatabaseSync.prototype.exec;
  // The fallback keeps this regression behavioural on the pre-a10 checkout,
  // before the qualification fixture exposes its shared tracing seam.
  const sharedTrace = rawMode ? idleSidecar.traceSidecar?.(event => {
    if (event.success && event.category === 'write') send('sidecar-write', { afterRelease: released });
    if (event.success && event.category === 'commit') send('sidecar-commit', { afterRelease: released });
    if (event.category === 'gate_held') send('native-held', { inTransaction: event.inTransaction });
  }, barrier) : null;
  if (mode === 'raw-native') sharedTrace?.arm();
  if (rawMode && !sharedTrace) {
    DatabaseSync.prototype.prepare = function(sql, ...args) {
      if (sql === "SELECT 1 FROM sqlite_master WHERE name='header'") sidecars.add(this);
      const statement = prepare.call(this, sql, ...args);
      if (sidecars.has(this) && /^\s*(INSERT|UPDATE|DELETE|REPLACE)/i.test(sql)) {
        for (const method of ['run', 'get', 'all', 'iterate']) {
          const original = statement[method];
          statement[method] = function(...values) { const result = original.apply(this, values); send('sidecar-write', { afterRelease: released }); return result; };
        }
      }
      return statement;
    };
    DatabaseSync.prototype.exec = function(sql, ...args) {
      if (barrier && sidecars.has(this) && sql === 'COMMIT' && Atomics.load(barrier, 0) === 0) {
        send('native-held', { inTransaction: this.isTransaction });
        if (Atomics.wait(barrier, 0, 0, 10000) === 'timed-out') throw Error('native_barrier_timeout');
      }
      const result = exec.call(this, sql, ...args);
      if (sidecars.has(this) && sql === 'COMMIT') send('sidecar-commit', { afterRelease: released });
      return result;
    };
  }
  try {
    await runCandidate(bootstrap, { runtimeOptions: { ...(mode === 'raw-provider' ? { rawSemantic: true,
      contextEmbedding: { embedder: { id: 'synthetic-lifetime', revision: '1', dimensions: 2, normalization: 'l2',
        async embed(texts) { await gate('raw-provider-pending'); send('provider-returned'); return texts.map(() => [1, 0]); } },
      policy: { family: 'hosted', maxRequests: 30, maxConcurrent: 1, maxUsd: 1, estimateUsd: () => 0 } } } : {}), model: {
      contextWindow: 8192, countTokens: () => 1, rank: () => ({ refs: [] }),
      async select() { await gate('provider-pending'); return { refs: [] }; },
    } } });
    await gate('candidate-returned');
    send('candidate-done');
  } finally { sharedTrace?.close(); await worker?.terminate(); hook.deregister(); process.removeAllListeners('message'); process.disconnect(); }
} else {
  const { workspace, until, ok } = await import('./local-daemon-support.mjs');
  const [{ openRawCaptureCore }, { defaultRawOptions }, { request, splitRaw, cardHost }] = await Promise.all([
    import('../../../core/raw-capture.mjs'), import('../../../core/local-defaults.mjs'), import('../../../core/testing/raw-source-fixtures.mjs'),
  ]);
  test('no-context-read admission does not record its cancelled initial status opening as a failure', { timeout: 20000 }, async t => {
    const hooks = [], w = await workspace({ after: hook => hooks.push(hook), diagnostic: text => t.diagnostic(text) });
    const bootstrap = await w.bootstrap(); bootstrap.args = [...bootstrap.args, '--no-context-read'];
    const state = await import('../local-daemon-state.mjs'), identity = await import('../local-daemon-identity.mjs');
    const directory = await state.runtimeDirectory({ root: bootstrap.root });
    bootstrap.identity = (await identity.createIdentity(bootstrap.args, { key: await state.identityKey(directory),
      environment: {}, node: { executable: process.execPath, version: process.version, execArgv: [] } })).record;
    const child = fork(new URL(import.meta.url), ['child', 'raw-status-opening'], { execArgv: [], env: {}, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    const events = []; let exit, stderr = '';
    child.on('message', event => events.push(event)); child.stderr.on('data', bytes => { stderr += bytes; });
    child.once('exit', (code, signal) => { exit = { code, signal }; });
    const wait = kind => until(() => events.some(event => event.kind === kind), kind);
    child.send(bootstrap);
    try {
      await until(w.descriptor, 'candidate publishes');
      const a = w.forward(['--no-context-read']); a.release(); await w.connect(a);
      await wait('raw-pending'); child.send({ kind: 'tick' }); await wait('opening-shared');
      child.send({ kind: 'raw-pending' }); await wait('tick-settled');
      child.send({ kind: 'flush' }); await wait('flushed');
      assert.equal(events.some(event => event.kind === 'raw-failed'), false, 'a cancelled construction opening is benign for the attached generation');
      assert.ok(events.some(event => event.kind === 'sidecar-write'), 'the attached generation opens its own reader');
      a.process.stdin.end(); await wait('detach-processed'); child.kill('SIGTERM'); await wait('candidate-returned');
      child.send({ kind: 'candidate-returned' }); await until(() => exit, 'candidate exits'); assert.equal(exit.code, 0, stderr);
    } finally { if (!exit) child.kill('SIGKILL'); await until(() => exit, 'candidate cleanup'); await hooks[0](); t.diagnostic(JSON.stringify({ events, exit, stderr })); }
  });
  test('attach queued during a synchronous native transaction follows commit with one upkeep successor', { timeout: 20000 }, async t => {
    const hooks = [], w = await workspace({ after: hook => hooks.push(hook), diagnostic: text => t.diagnostic(text) });
    const child = fork(new URL(import.meta.url), ['child', 'raw-native'], { execArgv: [], env: {}, stdio: ['ignore', 'ignore', 'pipe', 'ipc', 'pipe'] });
    const events = []; let exit, stderr = '', socket;
    child.on('message', event => events.push(event)); child.stderr.on('data', bytes => { stderr += bytes; });
    child.once('exit', (code, signal) => { exit = { code, signal }; });
    const wait = kind => until(() => events.some(event => event.kind === kind), kind);
    child.send(await w.bootstrap());
    try {
      const descriptor = await until(w.descriptor, 'candidate publishes');
      const a = w.forward(); a.release(); await w.connect(a); await wait('raw-scheduled');
      child.send({ kind: 'tick' }); await wait('native-held');
      assert.equal(events.find(event => event.kind === 'native-held').inTransaction, true);
      socket = net.createConnection(descriptor.socket.path ?? join(w.root, 'run', 'cairn-memory',
        (await fs.readdir(join(w.root, 'run', 'cairn-memory'))).find(name => name.endsWith('.sock'))));
      socket.on('error', () => {}); await once(socket, 'connect');
      const authentication = authenticateClient(socket, descriptor, descriptor.identity, performance.now() + 10000);
      child.stdio[4].write('release'); await authentication;
      await until(() => events.filter(event => event.kind === 'attach').length === 2, 'second attach processed');
      await wait('tick-settled');
      const secondAttach = events.findLastIndex(event => event.kind === 'attach');
      assert.ok(events.findIndex(event => event.kind === 'sidecar-commit') < secondAttach);
      assert.equal(events.filter(event => event.kind === 'raw-scheduled').length, 2, 'one initial timer and one successor');
      socket.destroy(); a.process.stdin.end(); child.kill('SIGTERM'); await wait('candidate-returned');
      child.send({ kind: 'candidate-returned' }); await until(() => exit, 'candidate exits'); assert.equal(exit.code, 0, stderr);
    } finally {
      child.stdio[4]?.write('release'); socket?.destroy(); if (!exit) child.kill('SIGKILL');
      await until(() => exit, 'candidate cleanup'); await hooks[0](); t.diagnostic(JSON.stringify({ events, exit, stderr }));
    }
  });

  for (const attachFirst of [true, false]) test(`socket idle expiry callback ordering: attachFirst=${attachFirst}`, { timeout: 20000 }, async t => {
    const hooks = [], w = await workspace({ after: hook => hooks.push(hook), diagnostic: text => t.diagnostic(text) });
    const child = fork(new URL(import.meta.url), ['child', 'raw-idle'], { execArgv: [], env: {}, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    const events = []; let exit, stderr = '';
    child.on('message', event => events.push(event)); child.stderr.on('data', bytes => { stderr += bytes; });
    child.once('exit', (code, signal) => { exit = { code, signal }; });
    const wait = kind => until(() => events.some(event => event.kind === kind), kind);
    child.send(await w.bootstrap());
    try {
      const descriptor = await until(w.descriptor, 'candidate publishes');
      const endpoint = join(w.root, 'run', 'cairn-memory', (await fs.readdir(join(w.root, 'run', 'cairn-memory'))).find(name => name.endsWith('.sock')));
      const a = w.forward(); a.release(); await w.connect(a);
      a.process.stdin.end(); await wait('detach-processed'); await wait('idle-scheduled');
      if (attachFirst) {
        const b = w.forward(); b.release(); await w.connect(b);
        child.send({ kind: 'expire' }); await wait('expiry-processed');
        ok(await b.tool('remember_memory', { content: 'Synthetic surviving stale timer.', kind: 'fact' }));
        assert.equal(events.some(event => event.kind === 'draining'), false);
        b.process.stdin.end(); await until(() => events.filter(event => event.kind === 'detach-processed').length === 2, 'second detach');
      }
      child.send({ kind: 'expire' }); await wait('draining'); await wait('candidate-returned');
      if (!attachFirst) {
        const refused = net.createConnection(endpoint);
        const outcome = await new Promise(resolve => {
          refused.once('error', () => resolve('refused'));
          refused.once('connect', () => { void authenticateClient(refused, descriptor, descriptor.identity, performance.now() + 2000)
            .then(() => resolve('attached'), () => resolve('refused')); });
        });
        refused.destroy(); assert.equal(outcome, 'refused', 'shutdown processed first refuses a later attach');
      }
      assert.equal(events.slice(events.findIndex(event => event.kind === 'draining') + 1).some(event => event.kind === 'attach'), false);
      child.send({ kind: 'candidate-returned' }); await until(() => exit, 'candidate exits'); assert.equal(exit.code, 0, stderr);
    } finally { if (!exit) child.kill('SIGKILL'); await until(() => exit, 'candidate cleanup'); await hooks[0](); t.diagnostic(JSON.stringify({ events, exit, stderr })); }
  });
  for (const mode of ['raw-opening', 'raw-preparation', 'raw-provider', 'raw-reattach']) test('writer lifetime fences pending ' + mode, { timeout: 20000 }, async t => {
    const hooks = [], w = await workspace({ after: hook => hooks.push(hook), diagnostic: text => t.diagnostic(text) });
    const bootstrap = await w.bootstrap();
    const raw = openRawCaptureCore({ path: bootstrap.identity.store.path, model: { extract: () => ({ items: [] }) },
      privateCards: cardHost().options }, { ...defaultRawOptions(), sources: true });
    try { ok(await raw.captureRaw(request(splitRaw('Synthetic cobalt telescope.')[0], {
      namespace: { ownerId: 'synthetic-daemon-owner', scope: 'personal', projectId: null }, client: 'codex' }))); }
    finally { await raw.close(); }
    const child = fork(new URL(import.meta.url), ['child', mode], { execArgv: [], env: {}, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    const events = []; let exit, stderr = '';
    child.on('message', event => events.push(event)); child.stderr.on('data', bytes => { stderr += bytes; });
    child.once('exit', (code, signal) => { exit = { code, signal }; });
    const wait = kind => until(() => events.some(event => event.kind === kind), kind);
    child.send(bootstrap);
    try {
      await until(w.descriptor, 'candidate publishes');
      const a = w.forward(); a.release(); await w.connect(a); await wait('raw-scheduled');
      if (mode === 'raw-provider') {
        for (let i = 0; i < 16 && !events.some(event => event.kind === 'raw-provider-pending'); i++) {
          child.send({ kind: 'tick' });
          await until(() => events.filter(event => event.kind === 'tick-settled').length > i, 'upkeep tick settled');
        }
        await wait('raw-provider-pending');
      } else { child.send({ kind: 'tick' }); await wait('raw-pending'); }
      a.process.stdin.end(); await wait('detach-processed');
      assert.ok(events.some(event => event.kind === 'raw-cancelled') || !events.some(event => event.kind === 'tick-settled'));
      if (mode === 'raw-reattach') {
        const b = w.forward(); b.release(); await w.connect(b);
        assert.equal(events.filter(event => event.kind === 'raw-scheduled').length, 1, 'reattach does not overlap the held old turn');
        const detachedWrites = events.filter(event => event.kind === 'sidecar-write').length;
        child.send({ kind: 'raw-pending' }); await wait('tick-settled');
        await until(() => events.filter(event => event.kind === 'raw-scheduled').length === 2, 'one fresh successor');
        assert.equal(events.filter(event => event.kind === 'sidecar-write').length, detachedWrites, 'old generation stays cancelled across attach');
        child.send({ kind: 'tick' });
        await until(() => events.filter(event => event.kind === 'tick-settled').length === 2, 'new turn publishes');
        assert.ok(events.filter(event => event.kind === 'sidecar-write').length > detachedWrites, 'fresh generation publishes');
        b.process.stdin.end(); await until(() => events.filter(event => event.kind === 'detach-processed').length === 2, 'last detach');
      }
      child.kill('SIGTERM'); await wait('draining');
      if (mode !== 'raw-provider') child.send({ kind: 'raw-pending' });
      await wait('candidate-returned');
      if (mode === 'raw-provider') {
        child.send({ kind: 'raw-provider-pending' }); await wait('provider-returned');
        child.send({ kind: 'flush' }); await wait('flushed');
      }
      const detach = events.findLastIndex(event => event.kind === 'detach-processed');
      assert.deepEqual(events.slice(detach + 1).filter(event => event.kind === 'sidecar-write'), [], 'no sidecar writes after processed detach');
      assert.deepEqual(events.filter(event => event.afterRelease), [], 'no protected work after lifetime release');
      assert.ok(events.some(event => event.kind === 'lifetime-released'));
      child.send({ kind: 'candidate-returned' }); await until(() => exit, 'candidate reaped');
      assert.equal(exit.code, 0, stderr);
    } finally {
      if (!exit) child.kill('SIGKILL'); await until(() => exit, 'candidate cleanup'); await hooks[0]();
      t.diagnostic(JSON.stringify({ mode, events, exit, stderr }));
    }
  });
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
            assert.equal(seen('host-closed'), false, 'host close waits for held authentication');
          }
          release('auth-pending');
          if (mode === 'refusal') {
            await wait('log-pending'); await delay(100); assert.equal(seen('lifetime-released'), false);
            release('log-pending');
          }
          if (mode !== 'after-close') release('provider-pending');
          await authentication; await work;
          if (mode === 'after-close') await wait('host-closed');
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
