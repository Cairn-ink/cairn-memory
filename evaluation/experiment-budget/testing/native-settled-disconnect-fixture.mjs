// Genuine HTTP/UDS peer-close; controlled child only, never a provider or key.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { dirname } from 'node:path';
import { PassThrough } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { checkedMem0NativeArtifact } from '../mem0-native-artifact.mjs';
import { mem0NativeConfiguration } from '../mem0-native-gateway.mjs';
import { runNativeGatewayKernel } from '../mem0-native-runtime.mjs';
import { nativeFakeProvider } from '../test/mem0-native-fixture.mjs';
import { artifactFor, syntheticPost } from './native-http-client-error-fixture.mjs';
import { keepAliveReplyProbe, nativeHttpTimeoutFixture } from './native-http-timeout-fixture.mjs';

const embedding = JSON.stringify({ model: 'text-embedding-3-small', input: ['synthetic'],
  dimensions: 1536, encoding_format: 'float' });
const frame = `POST /v1/embeddings HTTP/1.1\r\nHost: unix-gateway\r\n` +
  `Authorization: Bearer local-only-dummy-key\r\nContent-Type: application/json\r\n` +
  `Content-Length: ${Buffer.byteLength(embedding)}\r\n\r\n${embedding}`;

async function connect(socketPath) {
  const raw = net.connect(socketPath);
  raw.on('error', () => {});
  await new Promise((resolve, reject) => { raw.once('connect', resolve); raw.once('error', reject); });
  return raw;
}

export function observeDisconnectServer(t, events, { veto = null, mode = null } = {}) {
  const original = http.createServer;
  t.mock.method(http, 'createServer', function(...args) {
    const server = original.apply(this, args);
    server.on('clientError', (error, socket) => {
      const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
      events.push({ code: descriptor?.value ?? null, syscall: error.syscall ?? null });
      if (veto === 'unknown') Object.defineProperty(error, 'code', { value: 'unidentified-synthetic-code' });
    });
    if (mode === 'reuse') {
      const counts = new WeakMap();
      server.on('request', request => {
        const count = (counts.get(request.socket) ?? 0) + 1;
        counts.set(request.socket, count);
        if (count === 2) {
          // Negative-only injection: proves a previous response cannot confer
          // eligibility on a new unfinished request on that same connection.
          const error = new Error('synthetic write fault during new request');
          error.code = 'EPIPE'; error.syscall = 'write';
          server.emit('clientError', error, request.socket);
        }
      });
    }
    if (mode === 'late-exit') {
      let connection;
      server.on('request', request => { connection = request.socket; });
      const originalClose = server.close;
      t.mock.method(server, 'close', function(...closeArgs) {
        // Additional lifecycle race only: deterministic injection after the
        // kernel snapshots successful child output, at its cleanup boundary.
        // D1's actual EPIPE reproduction remains entirely genuine UDS traffic.
        const error = new Error('synthetic write fault after successful child exit');
        error.code = 'EPIPE'; error.syscall = 'write';
        server.emit('clientError', error, connection);
        return originalClose.apply(this, closeArgs);
      });
    }
    return server;
  });
}

export function disconnectChild(socketPath, { mode = 'disconnect', prefix = 0, resources,
  onStop = () => {}, closeDelay = 0 } = {}) {
  const child = new EventEmitter();
  child.pid = 987654;
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  let closed = false, extra;
  child.complete = code => {
    if (closed) return;
    closed = true;
    child.stdout.end(code === 0 ? JSON.stringify({ version: 'cairn-mem0-native-result-v1',
      verifiedAddRecords: 0, results: [] }) : '');
    child.stderr.end();
    setImmediate(() => { child.emit('exit', code, null); child.emit('close', code, null); });
  };
  child.stop = () => {
    onStop();
    if (mode === 'late-parser') extra?.end('Bad Header: x\r\n\r\n');
    if (closeDelay) setTimeout(() => child.complete(137), closeDelay);
    else child.complete(137);
  };
  child.stdin.once('finish', () => {
    child.operation = (async () => {
      for (let index = 0; index < prefix; index++) assert.equal(await syntheticPost(socketPath, embedding), 200);
      if (mode === 'healthy') { assert.equal(await syntheticPost(socketPath, embedding), 200); return; }
      if (mode === 'late-parser') {
        extra = await connect(socketPath); resources.push(extra); extra.resume();
        extra.write('POST /v1/embeddings HTTP/1.1\r\n');
      }
      const raw = await connect(socketPath); resources.push(raw);
      const ended = new Promise(resolve => raw.once('close', resolve));
      let reused = false;
      raw.on('data', () => {
        if (mode === 'received') raw.destroy();
        if (mode === 'late-exit') child.complete(0);
        if (mode === 'reuse' && !reused) { reused = true; raw.write(frame); }
      });
      if (mode === 'fin') raw.end(frame);
      else { raw.write(frame); if (!['received', 'fin', 'reuse', 'late-exit'].includes(mode)) raw.destroy(); }
      await ended;
      await delay(20);
    })();
    child.operation.then(() => { if (!closeDelay || mode !== 'late-parser') child.complete(0); }, () => child.complete(1));
  });
  return child;
}

export async function settledDisconnectProbe(t, { mode = 'disconnect', prefix = 0,
  veto = null } = {}) {
  const artifact = artifactFor(t);
  const configuration = mem0NativeConfiguration({ topK: 1, threshold: 0,
    childTimeoutMs: 10_000, httpTimeoutMs: 2000 });
  const fake = nativeFakeProvider();
  const fixture = nativeHttpTimeoutFixture(t, { artifact, configuration, fetchImpl: fake.fetchImpl });
  const events = [], resources = [];
  observeDisconnectServer(t, events, { veto, mode });
  let child, caseRoot, caseSocket, inner, outer, value, result, scopeAtStop;
  if (['reuse', 'late-exit'].includes(mode)) keepAliveReplyProbe(t, () => caseSocket);
  const originalRemove = fs.rmSync;
  let refusedCleanup = false;
  if (veto === 'cleanup') t.mock.method(fs, 'rmSync', function(target, options) {
    if (target === caseRoot && !refusedCleanup) { refusedCleanup = true; throw new Error('synthetic cleanup refusal'); }
    return originalRemove.call(this, target, options);
  });
  const guarded = ['accounting', 'settlement', 'scope'].includes(veto) ? { ...fixture.guard,
    attempts() {
      const attempts = structuredClone(fixture.guard.attempts());
      if (attempts.length && veto === 'settlement') attempts.at(-1).outcome = 'failed';
      if (attempts.length && veto === 'scope') attempts.at(-1).ordinal += 1;
      return attempts;
    },
    getState() {
      const state = structuredClone(fixture.guard.getState());
      if (veto === 'accounting' && scopeAtStop) state.attempts.at(-1).outcome = null;
      return state;
    } } : fixture.guard;
  try {
    try {
      result = await fixture.guard.withCaseScope(fixture.capability.schedule[0], async handle => {
        try {
          value = await runNativeGatewayKernel({ artifact, roots: checkedMem0NativeArtifact(artifact),
            configuration: configuration.configuration,
            childFile: fileURLToPath(new URL('./mem0-native-child.py', import.meta.url)),
            guard: guarded, handle,
            input: { batches: [[{ role: 'user', content: 'synthetic' }]], query: 'synthetic' },
            scope: { caseId: fixture.capability.schedule[0].caseId } }, {
            startChild({ socket }) {
              caseRoot = dirname(socket);
              caseSocket = socket;
              child = disconnectChild(socket, { mode, prefix, resources,
                closeDelay: mode === 'late-parser' ? 100 : 0,
                onStop: () => { scopeAtStop = handle.snapshot(); } });
              return child;
            }, stopChild: child => child.stop(), forceProcessGroupLiveForTest: veto === 'descendants',
          });
          return value;
        } catch (error) { inner = error; throw error; }
      });
    } catch (error) { outer = error; }
    if (child?.operation) await Promise.allSettled([child.operation]);
    const closed = child?.stdout.readableEnded;
    const attempts = fixture.guard.attempts();
    assert.equal(attempts.length, prefix + 1);
    assert.ok(attempts.every(a => a.outcome === 'succeeded' && Number.isSafeInteger(a.actualMicroUsd)
      && a.transportTermination === 'response'));
    assert.ok(fixture.guard.getState().attempts.every(a => a.outcome !== null));
    assert.equal(closed, true);
    const rootAbsent = !fs.existsSync(caseRoot);
    if (['descendants', 'cleanup'].includes(veto)) assert.equal(rootAbsent, false);
    else assert.equal(rootAbsent, true);
    return { fixture, events, inner, outer, value, result, scopeAtStop, rootAbsent };
  } finally {
    for (const raw of resources) raw.destroy();
    // A forced in-process descendant veto owns no OS group; retain its root
    // until after the assertion, then clean this explicitly owned synthetic path.
    if (['descendants', 'cleanup'].includes(veto) && caseRoot && fs.existsSync(caseRoot)) {
      originalRemove(caseRoot, { recursive: true });
    }
    fixture.guard.close();
  }
}
