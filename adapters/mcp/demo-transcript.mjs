// Verbose real transcript of the keyless local loop, used to regenerate docs/demo/cairn-memory-loop.gif.
// Run from adapters/mcp after `npm ci --prefix adapters/mcp`:
//   node adapters/mcp/demo-transcript.mjs /abs/path/to/cairn-local/app/node_modules/.bin/cairn-memory > docs/demo/transcript.txt
// Makes no model calls; recall reports model_not_configured by design.
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const executable = process.argv[2];
const db = join(await mkdtemp(join(tmpdir(), 'cairn-d1-')), 'memory.sqlite');
// The child gets only PATH and HOME: no provider key can reach it, so recall
// reports model_not_configured by construction, as in walkthrough.mjs.
const childEnv = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' };
let client, transport;
async function connect(label) {
  transport = new StdioClientTransport({ command: process.execPath, args: [executable, '--db', db, '--owner', 'demo-user'], env: childEnv, stderr: 'pipe' });
  transport.stderr?.resume();
  client = new Client({ name: 'cairn-demo', version: '1.0.0' });
  await client.connect(transport, { timeout: 15000 });
  console.log(`\n#### ${label}`);
}
async function close() { await client?.close(); await transport?.close(); }
async function call(name, args = {}) {
  console.log(`\n$ ${name} ${JSON.stringify(args)}`);
  const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 30000 });
  const v = JSON.parse(r.content[0].text);
  console.log(JSON.stringify(v, null, 2));
  return v;
}
try {
await connect('session A');
const saved = (await call('remember_memory', { content: 'I prefer tabs over spaces in this repo.', kind: 'fact' })).value.memory;
await call('inspect_memory', { memoryId: saved.id });
await close();
await connect('session B (fresh process)');
await call('inspect_memory', { memoryId: saved.id });
const corrected = (await call('correct_memory', { memoryId: saved.id, expectedRevision: saved.revision, content: 'I prefer spaces over tabs in this repo.' })).value.memory;
await call('recall_memory', { query: 'tabs or spaces?' });
await call('forget_memory', { memoryId: saved.id, expectedRevision: corrected.revision });
await call('inspect_memory', {});
} finally {
  await close();
}
