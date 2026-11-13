import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { openMemoryCore } from '../../../core/contract.mjs';
import { runtimeDirectory, identityKey } from '../local-daemon-state.mjs';
import { createIdentity } from '../local-daemon-identity.mjs';
import { processStart } from '../local-daemon-liveness.mjs';

export const ns = { ownerId: 'synthetic-daemon-owner', scope: 'personal', projectId: null };
export const query = { query: 'synthetic cobalt telescope', types: ['memory'], intent: 'current', semantic: false };
export const ok = value => { assert.equal(value.ok, true, JSON.stringify(value)); return value.value; };
export async function until(predicate, marker, milliseconds = 12000) {
  const end = performance.now() + milliseconds;
  while (performance.now() < end) { const result = await predicate(); if (result) return result; await delay(20); }
  assert.fail(marker);
}
export async function workspace(t) {
  const root = await mkdtemp('/tmp/cr3-'); await mkdir(join(root, 'run'), { mode: 0o700 });
  const path = join(root, 'synthetic.sqlite');
  const seed = openMemoryCore({ path, raw: false }); await seed.close();
  const children = [], owners = new Map(), exits = [], messages = [];
  const args = ['--db', path, '--owner', ns.ownerId];
  let nextId = 0;
  function child(configuration) {
    const process = fork(new URL('./fixtures/local-daemon-client.mjs', import.meta.url), [], {
      execArgv: [], env: {}, detached: true, stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });
    const entry = { process, role: configuration.role ?? 'forwarder', messages: [], responses: new Map(), stderr: '', lines: [], exit: null };
    children.push(entry);
    process.stdin.on('error', () => {}); // Expected EPIPE after injected transport death.
    process.on('message', message => {
      entry.messages.push(message); messages.push(message);
      if (message.kind === 'connected') owners.set(message.owner.pid, message.owner);
    });
    process.stderr.on('data', bytes => { entry.stderr += bytes; assert.ok(entry.stderr.length < 8192, 'child stderr must remain bounded'); });
    let buffer = '';
    process.stdout.on('data', bytes => {
      buffer += bytes;
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        const message = JSON.parse(line); entry.lines.push(message);
        if (Object.hasOwn(message, 'id')) entry.responses.set(message.id, message);
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
  async function connect(entry) {
    const connected = await until(() => entry.messages.find(m => m.kind === 'connected'), 'authenticated connection must report metadata');
    await entry.request('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'synthetic-r3', version: '1' } });
    entry.process.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    return connected;
  }
  async function bootstrap() {
    const directory = await runtimeDirectory({ root: join(root, 'run') });
    const identity = await createIdentity(args, { key: await identityKey(directory), environment: {}, node: { executable: process.execPath, version: process.version, execArgv: [] } });
    return { args, environment: {}, identity: identity.record, root: directory.path };
  }
  async function descriptor() {
    const names = (await readdir(join(root, 'run'))).filter(name => /^d-.*\.json$/.test(name));
    if (!names.length) return;
    return JSON.parse(await readFile(join(root, 'run', names[0]), 'utf8'));
  }
  t.after(async () => {
    try {
    for (const entry of children) if (!entry.exit) entry.process.kill('SIGCONT');
    for (const entry of children) if (!entry.exit && entry.role === 'forwarder') entry.process.stdin.end();
    await until(() => children.every(entry => entry.exit || entry.role !== 'forwarder' || entry.messages.some(m => m.kind === 'forwarder-done')), 'forwarder supervision must stop reconnects before daemon cleanup');
    for (const name of (await readdir(join(root, 'run'))).filter(name => /^d-.*\.json$/.test(name))) {
      const descriptor = JSON.parse(await readFile(join(root, 'run', name), 'utf8')); owners.set(descriptor.owner.pid, descriptor.owner);
    }
    for (const owner of owners.values()) {
      const current = processStart(owner.pid);
      if (!current || current.zombie || current.start !== owner.start) continue;
      try { process.kill(owner.pid, 'SIGCONT'); process.kill(owner.pid, 'SIGTERM'); } catch (e) { if (e.code !== 'ESRCH') throw e; }
    }
    for (const entry of children) if (!entry.exit && entry.role === 'candidate') entry.process.kill('SIGTERM');
    await until(() => children.every(entry => entry.exit), 'every spawned direct child must record exit code and signal');
    // Candidate exits are reported by the spawning fixture, including losers.
    const candidatePids = new Set(messages.filter(m => m.kind === 'candidate').map(m => m.pid));
    for (const pid of candidatePids) {
      const live = processStart(pid);
      if (live && !live.zombie) { try { process.kill(pid, 'SIGTERM'); } catch {} }
      await until(() => { const current = processStart(pid); return !current || current.zombie; }, 'no candidate descendant may survive cleanup');
    }
    for (const owner of owners.values()) await until(() => {
      const current = processStart(owner.pid); return !current || current.zombie || current.start !== owner.start;
    }, 'no daemon descendant may survive cleanup');
    t.diagnostic('R3 child exits ' + JSON.stringify(exits));
    t.diagnostic('R3 candidate exits ' + JSON.stringify(messages.filter(m => m.kind === 'candidate-exit')));
    assert.equal(exits.length, children.length, 'every child has an exit record');
    assert.equal(messages.filter(m => m.kind === 'candidate-exit').length, candidatePids.size, 'every detached candidate must record actual exit code and signal');
    } finally {
      for (const owner of owners.values()) {
        const current = processStart(owner.pid);
        if (current && !current.zombie && current.start === owner.start) { try { process.kill(owner.pid, 'SIGKILL'); } catch {} }
      }
      for (const entry of children) if (!entry.exit) entry.process.kill('SIGKILL');
      try { await until(() => children.every(entry => entry.exit), 'cleanup must reap every direct child after failure'); }
      finally { await rm(root, { recursive: true, force: true }); }
    }
  });
  return { root, path, args, children, owners, exits, messages, child, forward, connect, bootstrap, descriptor };
}
