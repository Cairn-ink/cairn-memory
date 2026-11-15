import assert from 'node:assert/strict';
import { Duplex, PassThrough } from 'node:stream';
import { Client } from '@modelcontextprotocol/client';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

// External writer owns a native SQLite transaction, never a raw file handle.
// Cleanup also supervises early assertion failures and startup/child errors.
export async function holdWriteLock(t, path, holdMs, mode = 'IMMEDIATE') {
  const child = spawn(process.execPath, ['--input-type=module', '-e',
    "import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync(process.argv[1]); db.exec('BEGIN '+process.argv[3]); process.stdout.write('locked\\n'); setTimeout(() => { db.exec('ROLLBACK'); db.close(); }, Number(process.argv[2]));",
    path, String(holdMs), mode], { stdio: ['ignore', 'pipe', 'ignore'] });
  const exited = once(child, 'exit');
  // Register a rejection handler before any asynchronous startup error.
  exited.catch(() => {});
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await exited;
  });
  const [ready] = await Promise.race([
    once(child.stdout, 'data'),
    exited.then(() => { throw Error('synthetic_lock_not_acquired'); }),
  ]);
  assert.equal(ready.toString(), 'locked\n', 'external SQLite writer acquired BEGIN ' + mode);
  return { exited };
}

export const ns = { ownerId: 'synthetic-shared-owner', scope: 'personal', projectId: null };
export const counter = { id: 'synthetic-character-counter', countTokens: text => Math.ceil(text.length / 4) };
export const query = { query: 'cobalt telescope', types: ['memory'], intent: 'current', semantic: false };
export const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
export const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
export function streams() {
  const toServer = new PassThrough(), toClient = new PassThrough();
  const server = Duplex.from({ readable: toServer, writable: toClient });
  const peer = Duplex.from({ readable: toClient, writable: toServer });
  // The synthetic peer owns its errors even before an SDK client is attached.
  // Leave the server endpoint unguarded: its runtime must own teardown errors.
  peer.on('error', () => {});
  return [server, peer];
}
export async function connect(t, host) {
  const [serverSide, clientSide] = streams(), handle = host.attach(serverSide, serverSide);
  const client = new Client({ name: 'synthetic-shared-client', version: '1' });
  t.after(async () => { await client.close(); await handle.close(); serverSide.destroy(); clientSide.destroy(); });
  await client.connect(new StdioServerTransport(clientSide, clientSide));
  return { client, handle, stream: clientSide };
}
export async function call(client, name, args) {
  const response = await client.callTool({ name, arguments: args });
  return JSON.parse(response.content[0].text);
}
export async function context(client, args = query) {
  const response = await client.callTool({ name: 'read_memory_context', arguments: args });
  assert.equal(response.isError, false, JSON.stringify(response));
  return { response, value: ok(JSON.parse(response.content[0].text)),
    diagnostics: response._meta['ink.cairn/context-read-diagnostics'], snapshot: response._meta['ink.cairn/context-read-snapshot'] };
}

export const holdExclusiveLock = (t, path, holdMs) => holdWriteLock(t, path, holdMs, 'EXCLUSIVE');
