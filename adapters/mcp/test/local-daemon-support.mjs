import { daemonStderrTail } from './fixtures/local-daemon-diagnostics.mjs';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, mkdir, readFile, readdir } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { openMemoryCore } from '../../../core/contract.mjs';
import { runtimeDirectory, identityKey } from '../local-daemon-state.mjs';
import { createIdentity } from '../local-daemon-identity.mjs';
import { processStart } from '../local-daemon-liveness.mjs';

export const ns = { ownerId: 'synthetic-daemon-owner', scope: 'personal', projectId: null };
export const query = { query: 'synthetic cobalt telescope', types: ['memory'], intent: 'current', semantic: false };
export const ok = value => { assert.equal(value.ok, true, JSON.stringify(value)); return value.value; };
const diagnostics = new Set();
const safeTail = text => Buffer.from(text.split('\n').filter(line => !/sk-|ghp_|Bearer|token=|crn_pat_/.test(line)).join('\n')).subarray(-2048).toString();
export async function until(predicate, marker, milliseconds = 12000) {
  const end = performance.now() + milliseconds;
  while (performance.now() < end) { const result = await predicate(); if (result) return result; await delay(20); }
  assert.fail(marker + '\n' + JSON.stringify([...diagnostics].map(snapshot => snapshot())));
}
export async function workspace(t) {
  // The runner nests TMPDIR; use its parent to keep Unix socket names <100B.
  const scratch = /^cairn-test-run-/.test(basename(tmpdir())) ? dirname(tmpdir()) : tmpdir();
  const root = await mkdtemp(join(scratch, 'd-')); await mkdir(join(root, 'run'), { mode: 0o700 });
  const path = join(root, 'synthetic.sqlite');
  const seed = openMemoryCore({ path, raw: false }); await seed.close();
  const children = [], owners = new Map(), exits = [], messages = [];
  const snapshot = () => children.map(entry => ({ role: entry.role, closeCode: entry.messages.findLast(m => m.kind === 'forwarder-done')?.code ?? null, exit: entry.exit, messages: entry.messages, stderr: safeTail(entry.stderr) }));
  diagnostics.add(snapshot);
  const args = ['--db', path, '--owner', ns.ownerId];
  let nextId = 0;
  function child(configuration) {
    const startedAt = performance.now();
    const process = fork(new URL('./fixtures/local-daemon-client.mjs', import.meta.url), [], {
      execArgv: [], env: {}, detached: true, stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });
    const entry = { process, startedAt, responseTimes: new Map(), role: configuration.role ?? 'forwarder', messages: [], responses: new Map(), stderr: '', lines: [], exit: null };
    children.push(entry);
    process.stdin.on('error', () => {}); // Expected EPIPE after injected transport death.
    process.on('message', message => {
      entry.messages.push(message); messages.push(message);
      if (message.kind === 'connected') owners.set(message.owner.pid, message.owner);
    });
    const stderr = daemonStderrTail();
    process.stderr.on('data', bytes => { stderr.write(bytes); entry.stderr = stderr.read(); });
    let buffer = '';
    process.stdout.on('data', bytes => {
      buffer += bytes;
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        const message = JSON.parse(line); entry.lines.push(message);
        if (Object.hasOwn(message, 'id')) { entry.responses.set(message.id, message); entry.responseTimes.set(message.id, performance.now()); }
      }
    });
    process.on('exit', (code, signal) => { entry.exit = { pid: process.pid, code, signal }; exits.push(entry.exit); });
    entry.release = () => process.send(configuration);
    entry.request = async (method, params = {}) => {
      const id = ++nextId; process.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      return until(() => entry.responses.get(id), 'RPC response must settle: ' + method);
    };
    entry.tool = async (name, arguments_ = {}) => {
      const response = await entry.request('tools/call', { name, arguments: arguments_ });
      if (response.error) return response;
      return JSON.parse(response.result.content[0].text);
    };
    return entry;
  }
  function forward(extra = [], options = {}) {
    return child({ args: [...args, ...extra], options: { root: join(root, 'run'), environment: {}, ...options } });
  }
  async function probeConnection(options) {
    // Use the same empty execArgv/environment as the elected forwarders, so
    // socket/owner tests reach the intended check on both supported runtimes.
    const entry = child({ role: 'connection-probe', args,
      options: { root: join(root, 'run'), environment: {}, ...options } });
    entry.release();
    const result = await until(() => entry.messages.find(m => m.kind === 'connection-probe-result'),
      'connection probe must report its refusal');
    assert.deepEqual(result.execArgv, []);
    await until(() => entry.exit, 'connection probe must record its exit');
    assert.equal(entry.exit.code, 0);
    if (result.code) throw Object.assign(Error(result.code), { code: result.code });
  }
  async function connect(entry) {
    const connections = () => entry.messages.filter(m => m.kind === 'connected');
    const connected = await until(() => connections().at(-1), 'authenticated connection must report metadata');
    const generation = connections().length;
    const response = await entry.request('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'synthetic-r3', version: '1' } });
    if (response.error || !response.result?.protocolVersion)
      throw Object.assign(Error('daemon test setup: initialization did not succeed'), { code: 'daemon_test_setup_initialize_failed', cause: response.error });
    if (connections().length !== generation)
      throw Object.assign(Error('daemon test setup: connection generation changed during initialization'), { code: 'daemon_test_setup_generation_changed' });
    entry.process.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    return connected;
  }
  async function bootstrap() {
    const directory = await runtimeDirectory({ root: join(root, 'run') });
    const identity = await createIdentity(args, { key: await identityKey(directory), environment: {}, node: { executable: process.execPath, version: process.version, execArgv: [] } });
    return { args, environment: {}, identity: identity.record, root: join(root, 'run') };
  }
  async function descriptor() {
    const names = (await readdir(join(root, 'run', 'cairn-memory'))).filter(name => /^d-.*\.json$/.test(name));
    if (!names.length) return;
    try { return JSON.parse(await readFile(join(root, 'run', 'cairn-memory', names[0]), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  t.after(async () => {
    try {
    for (const entry of children) if (!entry.exit) entry.process.kill('SIGCONT');
    for (const entry of children) if (!entry.exit && entry.role === 'forwarder') entry.process.stdin.end();
    await until(async () => {
      if (!children.every(entry => entry.exit || entry.role !== 'forwarder' || entry.messages.some(m => m.kind === 'forwarder-done'))) return false;
      for (const name of (await readdir(join(root, 'run', 'cairn-memory'))).filter(name => /^d-.*\.json$/.test(name))) {
        let descriptor;
        try { descriptor = JSON.parse(await readFile(join(root, 'run', 'cairn-memory', name), 'utf8')); }
        catch (error) { if (error.code === 'ENOENT') return false; throw error; }
        owners.set(descriptor.owner.pid, descriptor.owner);
      }
      return true;
    }, 'forwarder supervision must stop reconnects before daemon cleanup');
    for (const owner of owners.values()) {
      const current = processStart(owner.pid);
      if (!current || current.zombie || current.start !== owner.start) continue;
      try { process.kill(owner.pid, 'SIGCONT'); process.kill(owner.pid, 'SIGTERM'); } catch (e) { if (e.code !== 'ESRCH') throw e; }
    }
    for (const entry of children) if (!entry.exit && entry.role === 'candidate') entry.process.kill('SIGTERM');
    // The fixture waits for every candidate before exiting. A candidate still
    // waiting on the lifetime lock can win as the recorded owner exits, so stop
    // these descendants before waiting for their supervising forwarder.
    const signalled = new Set();
    await until(() => {
      let liveCandidate = false;
      for (const candidate of messages.filter(m => m.kind === 'candidate')) {
        const live = processStart(candidate.pid);
        if (!live || live.zombie || live.start !== candidate.start) continue;
        liveCandidate = true;
        if (signalled.has(candidate)) continue;
        signalled.add(candidate);
        try { process.kill(candidate.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
      return !liveCandidate && children.every(entry => entry.exit);
    }, 'every candidate descendant and its supervisor must record exit');
    const candidatePids = new Set(messages.filter(m => m.kind === 'candidate').map(m => m.pid));
    // Candidate exits are reported by the spawning fixture, including losers.
    for (const owner of owners.values()) await until(() => {
      const current = processStart(owner.pid); return !current || current.zombie || current.start !== owner.start;
    }, 'no daemon descendant may survive cleanup');
    t.diagnostic('R3 child exits ' + JSON.stringify(exits));
    t.diagnostic('R3 candidate exits ' + JSON.stringify(messages.filter(m => m.kind === 'candidate-exit')));
    assert.equal(exits.length, children.length, 'every child has an exit record');
    assert.equal(messages.filter(m => m.kind === 'candidate-exit').length, candidatePids.size, 'every detached candidate must record actual exit code and signal');
    } finally {
      for (const candidate of messages.filter(m => m.kind === 'candidate')) {
        const current = processStart(candidate.pid);
        if (current && !current.zombie && current.start === candidate.start) { try { process.kill(candidate.pid, 'SIGKILL'); } catch {} }
      }
      for (const owner of owners.values()) {
        const current = processStart(owner.pid);
        if (current && !current.zombie && current.start === owner.start) { try { process.kill(owner.pid, 'SIGKILL'); } catch {} }
      }
      for (const entry of children) if (!entry.exit) entry.process.kill('SIGKILL');
      try { await until(() => children.every(entry => entry.exit), 'cleanup must reap every direct child after failure'); }
      finally { diagnostics.delete(snapshot); await rm(root, { recursive: true, force: true }); }
    }
  });
  return { root, path, args, children, owners, exits, messages, child, forward, connect, bootstrap, descriptor, probeConnection };
}
