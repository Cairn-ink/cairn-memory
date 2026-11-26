import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { serveStdio } from '../core-local/host.mjs';

test('a shared runtime survives stdio session closure and rechecks authority before sending a tool result', async () => {
  let authorizeCalls = 0, closeCalls = 0;
  const shared = {
    authorize() {
      authorizeCalls++;
      if (authorizeCalls === 4) throw new Error('authority_changed');
    },
    runtime: Promise.resolve({ service: { save: () => ({ status: 'paused' }) }, close() { closeCalls++; } }),
  };
  const options = { owner: 'synthetic', database: 'never-opened' };
  const call = async () => {
    const input = new PassThrough(), output = new PassThrough();
    const frames = [];
    output.setEncoding('utf8');
    output.on('data', text => frames.push(JSON.parse(text)));
    input.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'remember_memory', arguments: { content: 'Synthetic memory' } } }) + '\n');
    await serveStdio(input, output, options, { shared });
    return frames;
  };
  const first = await call();
  assert.equal(first.length, 1);
  assert.ok(first[0].result);
  assert.equal(authorizeCalls, 2);
  assert.equal(closeCalls, 0);
  assert.deepEqual(await call(), [{ jsonrpc: '2.0', id: 1, error: { code: -32603, message: 'Internal error' } }]);
  assert.equal(authorizeCalls, 4);
  assert.equal(closeCalls, 0);
});
