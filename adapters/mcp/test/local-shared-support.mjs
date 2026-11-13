import assert from 'node:assert/strict';
import { Duplex, PassThrough } from 'node:stream';
import { Client } from '@modelcontextprotocol/client';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

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
