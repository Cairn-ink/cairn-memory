import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { workspace, until } from './local-daemon-support.mjs';
import { startAwareAlive } from '../local-daemon-liveness.mjs';

test('a real daemon emits liveness every five seconds without client stdout frames', { timeout: 18000 }, async t => {
  const w = await workspace(t);
  const a = w.child({ args: w.args, observeLiveness: true, options: { root: join(w.root, 'run'), environment: {} } });
  a.release(); await w.connect(a);
  const replies = [...a.lines];
  await until(() => a.messages.filter(m => m.kind === 'liveness-seen').length >= 2, 'daemon sends repeated heartbeats', 11500);
  assert.deepEqual(a.lines, replies, 'no liveness byte becomes an MCP stdout frame');
});

test('a protocol-one descriptor refuses before any stdin byte', { timeout: 20000 }, async t => {
  const w = await workspace(t), a = w.forward(); a.release(); await w.connect(a);
  const directory = join(w.root, 'run', 'cairn-memory');
  const name = (await readdir(directory)).find(name => /^d-.*\.json$/.test(name));
  const path = join(directory, name), bytes = await readFile(path);
  try {
    await writeFile(path, JSON.stringify({ ...JSON.parse(bytes), protocol: 1 }));
    const b = w.forward(); b.release();
    b.process.stdin.write('{"jsonrpc":"2.0","id":91,"method":"tools/list"}\n');
    const result = await until(() => b.messages.find(m => m.kind === 'forwarder-done'), 'protocol refusal settles');
    assert.deepEqual(result.code, { refused: 'daemon_protocol' }); assert.equal(result.bytesRead, 0);
    assert.equal(b.messages.filter(m => m.kind === 'candidate').length, 0);
  } finally { await writeFile(path, bytes); }
});

test('SIGSTOP after attach gets daemon_unresponsive within T plus 1500ms', { timeout: 20000 }, async t => {
  const w = await workspace(t), a = w.forward([], { unresponsiveMs: 300 });
  a.release(); const descriptor = await w.connect(a);
  assert.ok(startAwareAlive(descriptor.owner)); process.kill(descriptor.owner.pid, 'SIGSTOP');
  try {
    const started = process.hrtime.bigint();
    const response = await a.tool('inspect_memory', {});
    const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
    assert.equal(response.error.message, 'daemon_unresponsive');
    assert.ok(elapsed < 1800, 'T=300ms plus 1500ms scheduler/IPC margin');
    const done = await until(() => a.messages.find(m => m.kind === 'forwarder-done'), 'hung session terminates');
    assert.equal(done.code, 'daemon_unresponsive');
  } finally {
    if (startAwareAlive(descriptor.owner)) process.kill(descriptor.owner.pid, 'SIGCONT');
  }
});
