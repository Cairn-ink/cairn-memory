import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { runForwarder } from '../local-forwarder.mjs';
import { runEntry } from '../../../packaging/bin/cairn-memory.mjs';

test('pre-attachment refusal exposes only original exception name and code without consuming stdin', async () => {
  const input = new PassThrough(), output = new PassThrough();
  const frame = '{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n';
  input.write(frame);
  const error = Object.assign(new TypeError('synthetic private message /synthetic/path'), { code: 'ENOENT' });
  const result = await runForwarder([], { input, output, connect: async () => { throw error; } });
  assert.deepEqual(result, { refused: 'daemon_transport', cause: { name: 'TypeError', code: 'ENOENT' } });
  assert.equal(input.read().toString(), frame);
  assert.equal(output.readableLength, 0);
  assert.equal(input.destroyed, false); assert.equal(output.writableEnded, false);
  assert.ok(!JSON.stringify(result).includes('synthetic'));
  input.destroy(); output.destroy();
});

test('the bin prints only its existing fallback code when a refusal carries diagnostics', async () => {
  const stderr = []; let starts = 0;
  const rc = await runEntry([], { platform: 'linux', stderr: line => stderr.push(line), load: async name => {
    if (name.endsWith('local-daemon-identity.mjs')) return { daemonVector: () => ({ eligible: true }) };
    if (name.endsWith('local-forwarder.mjs')) return { runForwarder: async () => ({
      refused: 'daemon_transport', cause: { name: 'TypeError', code: 'ENOENT' },
    }) };
    assert.equal(name, '../adapters/mcp/cli.mjs');
    return { start: async () => { starts++; } };
  } });
  assert.equal(rc, 0); assert.equal(starts, 1);
  assert.deepEqual(stderr, ['cairn_daemon_fallback:daemon_transport\n']);
});
