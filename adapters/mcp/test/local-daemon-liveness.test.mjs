import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
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
    assert.deepEqual(result.code, { refused: 'daemon_protocol', cause: { name: 'Error', code: 'daemon_protocol' } }); assert.equal(result.bytesRead, 0);
    assert.equal(b.messages.filter(m => m.kind === 'candidate').length, 0);
  } finally { await writeFile(path, bytes); }
});

test('SIGSTOP after attach gets daemon_unresponsive within T plus 1500ms', { timeout: 20000 }, async t => {
  const w = await workspace(t), a = w.forward([], { unresponsiveMs: 300, armWatchdogOnTool: true });
  a.release(); const setup = w.connect(a);
  await until(() => a.messages.find(m => m.kind === 'initialization-withheld'), 'setup reaches initialization barrier');
  await delay(450);
  assert.equal(a.lines.length, 0, 'initialization may exceed 300ms without the short watchdog');
  a.process.send({ kind: 'release-initialization' });
  const descriptor = await setup;
  const published = await w.descriptor();
  assert.equal(published.incarnation, descriptor.incarnation);
  assert.deepEqual(published.owner, descriptor.owner);
  const generations = () => a.messages.filter(m => m.kind === 'connected');
  assert.equal(generations().at(-1), descriptor, 'setup returns the current owner');
  const generation = generations().length;
  assert.equal(a.messages.filter(m => m.kind === 'watchdog-armed').length, 0, 'short watchdog is unarmed during setup');
  assert.ok(startAwareAlive(descriptor.owner)); process.kill(descriptor.owner.pid, 'SIGSTOP');
  try {
    await stopped(descriptor.owner);
    assert.equal(generations().length, generation, 'verified owner is still current before admission');
    const started = process.hrtime.bigint();
    const response = await a.tool('inspect_memory', {});
    const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
    assert.equal(response.error.message, 'daemon_unresponsive');
    assert.ok(elapsed < 1800, 'T=300ms plus 1500ms scheduler/IPC margin');
    const done = await until(() => a.messages.find(m => m.kind === 'forwarder-done'), 'hung session terminates');
    assert.equal(done.code, 'daemon_unresponsive');
    assert.equal(a.messages.filter(m => m.kind === 'watchdog-armed').length, 1, 'admitted tool arms the short watchdog');
    assert.equal(generations().length, generation, 'no reconnection through forwarder close');
    t.diagnostic('SIGSTOP watchdog: elapsed_ms=' + elapsed.toFixed(3) + ' generations=' + generation);
  } finally {
    if (startAwareAlive(descriptor.owner)) process.kill(descriptor.owner.pid, 'SIGCONT');
  }
});

for (const scenario of ['initialize error', 'missing initialize result', 'generation changed', 'current generation']) {
  test('connect validates setup: ' + scenario, async t => {
    const w = await workspace(t); await w.bootstrap();
    const first = { kind: 'connected', incarnation: 'first' };
    const current = { kind: 'connected', incarnation: 'current' };
    const messages = [first], writes = [];
    if (scenario === 'current generation') messages.push(current);
    const entry = { messages, process: { stdin: { write: bytes => writes.push(bytes) } },
      async request(method) {
        assert.equal(method, 'initialize');
        if (scenario === 'initialize error') return { error: { code: -32000, message: 'daemon_unresponsive' } };
        if (scenario === 'missing initialize result') return {};
        if (scenario === 'generation changed') messages.push(current);
        return { result: { protocolVersion: '2025-03-26' } };
      },
    };
    if (scenario === 'current generation') {
      assert.equal(await w.connect(entry), current, 'returns the current authenticated generation');
      assert.equal(JSON.parse(writes[0]).method, 'notifications/initialized');
    } else {
      await assert.rejects(w.connect(entry), { code: scenario === 'generation changed'
        ? 'daemon_test_setup_generation_changed' : 'daemon_test_setup_initialize_failed' });
      assert.equal(writes.length, 0, 'failed setup never sends initialized');
    }
  });
}

async function stopped(owner) {
  await until(async () => {
    assert.ok(startAwareAlive(owner), 'verified owner remains alive while stopping');
    const stat = await readFile('/proc/' + owner.pid + '/stat', 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0] === 'T';
  }, 'verified owner reaches stopped state T');
}

test('initialization timeout rejects setup before a queued tool first executes on a replacement', { timeout: 20000 }, async t => {
  const w = await workspace(t), bootstrap = await w.bootstrap();
  const launch = async () => {
    const candidate = w.child({ role: 'candidate', bootstrap, observeToolExecutions: true });
    candidate.release();
    const descriptor = await until(async () => {
      const value = await w.descriptor();
      return value?.owner.pid === candidate.process.pid && value;
    }, 'supervised candidate publishes');
    return { candidate, descriptor };
  };
  const old = await launch();
  const a = w.forward([], { unresponsiveMs: 300, initializationTimeoutRace: true });
  a.release();
  const setup = w.connect(a).then(connection => ({ connection }), error => ({ error }));
  await until(() => a.messages.find(m => m.kind === 'initialization-withheld'), 'first initialization response is withheld');
  await until(() => a.lines.find(m => m.error?.message === 'daemon_unresponsive'), 'forwarder emits initialization timeout');
  await until(() => a.messages.find(m => m.kind === 'recovery-connect-pending'), 'second connection is gated');
  const outcome = await setup;
  const first = a.messages.find(m => m.kind === 'connected');
  assert.equal(first.owner.pid, old.descriptor.owner.pid);
  if (outcome.connection) assert.equal(outcome.connection, first, 'old helper returns the obsolete first owner');
  assert.ok(startAwareAlive(first.owner)); process.kill(first.owner.pid, 'SIGSTOP');
  try {
    await stopped(first.owner);
    const queued = a.tool('inspect_memory', {});
    assert.equal(a.messages.filter(m => m.kind === 'connected').length, 1, 'recovery stays gated while the tool is queued');
    process.kill(first.owner.pid, 'SIGCONT'); process.kill(first.owner.pid, 'SIGTERM');
    await until(() => old.candidate.exit && !startAwareAlive(first.owner), 'old daemon is reaped before replacement');
    const replacement = await launch();
    a.process.send({ kind: 'release-recovery-connect' });
    const response = await queued;
    assert.equal(response.ok, true, 'queued tool succeeds on its first execution');
    await until(() => replacement.candidate.messages.some(m => m.kind === 'tool-executed'), 'replacement records execution');
    assert.equal(old.candidate.messages.filter(m => m.kind === 'tool-executed').length, 0, 'zero tool executions on the old daemon');
    assert.equal(replacement.candidate.messages.filter(m => m.kind === 'tool-executed').length, 1, 'one tool execution on the replacement');
    const connections = a.messages.filter(m => m.kind === 'connected');
    assert.equal(connections.length, 2);
    assert.notEqual(connections[1].incarnation, first.incarnation);
    assert.equal(connections[1].owner.pid, replacement.descriptor.owner.pid);
    t.diagnostic('initialization race: generations=2 old_tool_executions=0 replacement_tool_executions=1 setup=' +
      (outcome.error?.code ?? 'accepted'));
    assert.equal(outcome.error?.code, 'daemon_test_setup_initialize_failed', 'failed initialization explicitly rejects setup');
    assert.equal(outcome.error?.cause?.message, 'daemon_unresponsive');
  } finally {
    if (startAwareAlive(first.owner)) process.kill(first.owner.pid, 'SIGCONT');
    if (a.process.connected) a.process.send({ kind: 'release-recovery-connect' });
  }
});
