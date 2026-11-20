import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { createConnection } from 'node:net';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { workspace, until } from './local-daemon-support.mjs';
import { runtimeDirectory, endpointPaths } from '../local-daemon-state.mjs';
import { canonical } from '../local-daemon-identity.mjs';
import { authenticateClient } from '../local-daemon-wire.mjs';
import { daemonStderrTail } from './fixtures/local-daemon-diagnostics.mjs';

async function pending(t, failure) {
  const w = await workspace(t), bootstrap = await w.bootstrap();
  const directory = await runtimeDirectory({ root: bootstrap.root });
  const digest = createHash('sha256').update(canonical(bootstrap.identity)).digest('hex');
  const paths = endpointPaths(directory, digest), evidence = join(w.root, 'activation-events.json');
  const child = fork(new URL('./fixtures/local-daemon-activation-child.mjs', import.meta.url), [], {
    execArgv: [], env: {}, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  const events = [], stderr = daemonStderrTail(); let exit;
  child.on('message', event => events.push(event));
  child.stderr.on('data', bytes => stderr.write(bytes));
  child.once('exit', (code, signal) => { exit = { code, signal }; });
  const seen = kind => events.find(event => event.kind === kind);
  const wait = kind => until(() => seen(kind), kind + '; ' + JSON.stringify({ events, exit, stderr: stderr.read() }));
  let socket;
  t.after(async () => {
    socket?.destroy();
    if (!exit) child.kill('SIGKILL');
    await until(() => exit, 'instrumented candidate must have an actual exit record');
    t.diagnostic('activation candidate exit ' + JSON.stringify(exit));
  });
  child.send({ bootstrap, paths, evidence, failure });
  const descriptor = await until(w.descriptor, 'candidate publishes before activation');
  socket = createConnection(paths.socket); socket.on('error', () => {});
  await once(socket, 'connect');
  // Catch immediately: shutdown deliberately interrupts this handshake.
  const authentication = authenticateClient(socket, descriptor, descriptor.identity, performance.now() + 10000).catch(() => {});
  await wait('activation-pending');
  const held = async () => assert.equal(JSON.parse(await readFile(paths.lock, 'utf8')).pid, child.pid, 'lifetime lock still belongs to pending candidate');
  async function fault(kind) {
    const count = events.filter(event => event.kind === 'fault-delivered').length;
    child.send({ kind: 'fault', fault: kind });
    await until(() => events.filter(event => event.kind === 'fault-delivered').length > count, 'fault delivered to owned listener/process');
    // Gates, rather than a timed import, define the race. Give erroneous early
    // cleanup a chance to return; subsequent event-order assertions also catch
    // release after this observation window but before activation/close settle.
    const end = performance.now() + 250;
    while (!seen('candidate-returned') && performance.now() < end) await delay(10);
  }
  async function finish(code) {
    await wait('candidate-returned'); child.send({ kind: 'finish' });
    await until(() => exit, 'candidate exits after settled cleanup');
    assert.deepEqual(exit, { code, signal: null });
    await authentication;
    return JSON.parse(await readFile(evidence, 'utf8')).events;
  }
  async function next() {
    const candidate = w.forward(); candidate.release(); const fresh = await w.connect(candidate);
    assert.notEqual(fresh.incarnation, descriptor.incarnation);
    assert.ok((await candidate.request('tools/list')).result.tools.length > 0, 'next candidate serves');
  }
  return { w, child, paths, evidence, events, seen, wait, held, fault, finish, next, exited: () => exit };
}
function ordered(events, kinds) {
  const positions = kinds.map(kind => events.findIndex(event => event.kind === kind));
  assert.ok(positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1])), JSON.stringify({ kinds, events }));
  assert.ok(events.filter(event => /^(activation-|host-)/.test(event.kind)).every(event => event.held), 'activation and host close must precede lock release');
}

for (const termFirst of [false, true]) test('listener error joins pending activation and host close before lifetime release; TERM first=' + termFirst, { timeout: 20000 }, async t => {
  const c = await pending(t);
  if (termFirst) await c.fault('TERM');
  await c.fault('listener'); await c.held();
  assert.equal(c.seen('candidate-returned'), undefined, 'error path cannot return while activation can still construct a host');
  c.child.send({ kind: 'release-import' }); await c.wait('host-close-started');
  await c.held(); assert.equal(c.seen('lock-release'), undefined, 'host close must finish under the lock');
  c.child.send({ kind: 'release-close' });
  const events = await c.finish(1);
  ordered(events, ['activation-pending', 'fault-delivered', 'host-created', 'activation-fulfilled', 'host-closed', 'lock-release', 'candidate-returned']);
  assert.equal(events.filter(event => event.kind === 'host-created').length, 1, 'no host is constructed after release');
  assert.equal(events.filter(event => event.kind === 'host-closed').length, 1, 'overlapping exits share one resource close');
  await c.next();
});

for (const failure of ['import', 'constructor']) for (const fault of ['listener', 'TERM']) {
  test(failure + ' throws during ' + fault + ' while activation is pending', { timeout: 20000 }, async t => {
    const c = await pending(t, failure);
    await c.fault(fault); await c.held();
    assert.equal(c.seen('candidate-returned'), undefined, 'failure path retains ownership until activation settles');
    c.child.send({ kind: 'release-import' });
    const events = await c.finish(fault === 'listener' ? 1 : 0);
    ordered(events, ['activation-pending', 'fault-delivered', 'activation-rejected', 'lock-release', 'candidate-returned']);
    assert.equal(events.filter(event => event.kind === 'host-created').length, 0, 'failed activation creates no late host');
    assert.equal(await c.w.descriptor(), undefined, 'failed activation leaves no poisoned endpoint');
    await c.next();
  });
}

test('five second outer bound exits with the lifetime lock retained while activation is pending', { timeout: 20000 }, async t => {
  const c = await pending(t);
  const start = performance.now(); await c.fault('listener');
  await until(() => c.exited() || c.seen('candidate-returned'), 'outer bound exits the candidate', 7500);
  assert.deepEqual(c.exited(), { code: 1, signal: null }, 'bound terminates the process instead of returning to withFileLock');
  assert.ok(performance.now() - start >= 4500 && performance.now() - start < 7500, 'existing 5 s bound');
  const { events, code } = JSON.parse(await readFile(c.evidence, 'utf8'));
  assert.equal(code, 1);
  assert.equal(events.filter(event => event.kind === 'lock-release').length, 0, 'lock callback never releases while activation can build');
  assert.equal(events.filter(event => /^(host-|activation-(fulfilled|rejected))/.test(event.kind)).length, 0, 'activation remained pending until death');
  await c.held(); // The dead owner file is reclaimed by the next election.
  await c.next();
});
