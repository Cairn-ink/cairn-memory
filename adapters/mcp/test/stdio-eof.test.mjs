import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { setImmediate as nextTurn } from 'node:timers/promises';
import test from 'node:test';
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { openMemoryCore } from '../../../core/contract.mjs';
import { startStdio } from '../cli.mjs';
import { buildCairnServer } from '../server.mjs';

const namespace = { ownerId: 'synthetic-eof-owner', scope: 'personal', projectId: null };
const rendezvous = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

test('stdin EOF disposes once without draining an outstanding tool or writing a late reply', async t => {
  const input = new PassThrough(), events = new EventEmitter(), replies = new EventEmitter();
  const entered = rendezvous(), release = rendezvous(), finished = rendezvous();
  const disposed = rendezvous(), closed = rendezvous();
  const core = openMemoryCore({ path: ':memory:' });
  let coreCloses = 0, handleCloses = 0, recallCalls = 0, lateResult;
  let stdout = '', stderr = '';
  const failures = [];
  const onRejection = error => { failures.push(error); };
  const onException = error => { failures.push(error); };
  process.on('unhandledRejection', onRejection);
  process.on('uncaughtExceptionMonitor', onException);
  t.mock.method(process.stderr, 'write', (chunk, encoding, callback) => {
    stderr += chunk.toString();
    (typeof encoding === 'function' ? encoding : callback)?.();
    return true;
  });
  const output = new Writable({ write(chunk, encoding, callback) {
    const text = chunk.toString();
    stdout += text;
    // The real transport writes one complete JSON-RPC line per write.
    assert.ok(text.endsWith('\n'));
    const message = JSON.parse(text.slice(0, -1));
    assert.equal(message.jsonrpc, '2.0');
    replies.emit(String(message.id), message);
    callback();
  } });
  // Use the existing registration seam with a real core. Only recall's entry
  // is gated; disposal and the eventual store_closed result remain real.
  const server = buildCairnServer({ binding: namespace, client: 'synthetic-eof', sessionId: 'eof',
    core: { ...core,
      async recall(args) {
        recallCalls++;
        entered.resolve();
        await release.promise;
        try { lateResult = await core.recall(args); return lateResult; }
        finally { finished.resolve(); }
      },
      close() { coreCloses++; core.close(); disposed.resolve(); },
    },
  });
  const handle = startStdio(() => server, {
    serveStdio(factory, options) {
      const owned = serveStdio(factory, options), close = owned.close.bind(owned);
      owned.close = () => { handleCloses++; return close(); };
      return owned;
    },
    StdioServerTransport, input, output, events,
  }, 65536, () => { closed.resolve(); });
  t.after(async () => {
    release.resolve();
    try { await handle.close(); await server.close(); }
    finally {
      core.close(); input.destroy(); output.destroy();
      process.off('unhandledRejection', onRejection);
      process.off('uncaughtExceptionMonitor', onException);
    }
  });
  const send = message => input.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  const initialized = once(replies, '1');
  send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {},
    clientInfo: { name: 'synthetic-eof', version: '1' } } });
  assert.ok((await initialized)[0].result);
  send({ method: 'notifications/initialized' });
  const request = { id: 2, method: 'tools/call', params: {
    name: 'recall_memory', arguments: { query: 'Synthetic pending recall' },
  } };
  send(request);
  await entered.promise;
  assert.equal(coreCloses, 0);
  const inputClosed = once(input, 'close');
  input.end();
  // All three rendezvous must complete while the tool is still blocked.
  await Promise.all([disposed.promise, closed.promise, inputClosed]);
  assert.equal(coreCloses, 1);
  assert.equal(handleCloses, 1);
  assert.equal(input.destroyed, true);
  assert.equal(core.list({ namespace }).error.code, 'store_closed');
  const atClosure = stdout;
  assert.deepEqual(stdout.trimEnd().split('\n').map(line => JSON.parse(line).id), [1]);

  release.resolve();
  await finished.promise;
  // Flush the SDK's promise continuations and unhandled-error reporting at an
  // event-loop boundary, without a sleep, deadline, or elapsed-time assertion.
  await nextTurn();
  assert.equal(lateResult.error.code, 'store_closed');
  assert.equal(stdout, atClosure, 'EOF aborts the request: no late response is written');

  // Even a stale emitter trying to deliver another request cannot reach core.
  assert.equal(input.listenerCount('data'), 0);
  input.emit('data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...request, id: 3 }) + '\n'));
  await nextTurn();
  assert.equal(recallCalls, 1);
  assert.equal(stdout, atClosure);
  const closing = handle.close();
  assert.equal(handle.close(), closing);
  await closing;
  await server.close();
  assert.equal(handleCloses, 1);
  assert.equal(coreCloses, 1);
  assert.equal(events.listenerCount('SIGTERM'), 0);
  assert.equal(events.listenerCount('SIGINT'), 0);
  assert.deepEqual(failures, []);
  assert.equal(stderr, '');
});
