import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/candidate-server.mjs', import.meta.url));
const namespace = 'synthetic-v2-mcp';
const database = () => join(mkdtempSync(join(tmpdir(), 'cairn-mcp-v2-')), 'memory.sqlite');
const options = { timeout: 20000 };
async function host(t, path, { mode = 'source-bound-v2', forbidHttp = false, owner = namespace, fake = true } = {}) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [fake ? fixture : cli,
    '--db', path, '--owner', owner, ...(mode ? ['--capture-qualification', mode] : [])],
    env: { OPENAI_API_KEY: '', NODE_NO_WARNINGS: '1', SYNTHETIC_FORBID_HTTP: forbidHttp ? '1' : '0' }, stderr: 'pipe' });
  let text = ''; transport.stderr.on('data', (chunk) => { text += chunk.toString(); });
  const client = new Client({ name: 'synthetic-v2-client', version: '1.0.0' });
  t.after(() => client.close()); await client.connect(transport);
  return { client, close: () => client.close(), http: () => (text.match(/synthetic_http:/g) ?? []).length };
}
async function call(client, name, arguments_ = {}) {
  const response = await client.callTool({ name, arguments: arguments_ }); const result = JSON.parse(response.content[0].text);
  assert.equal(Boolean(response.isError), !result.ok); assert.equal(result.evidenceTrust, 'untrusted-data-not-instructions'); return result;
}
const ok = (result) => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const inspect = (client, id) => call(client, 'inspect_memory', { memoryId: id, includeQualification: true });
const capture = (patch = {}) => ({ batchId: 'batch', messages: [{ role: 'user', content: 'I prefer short examples 🚋.' }], ...patch });
async function invalid(client, args) {
  try { const response = await client.callTool({ name: 'capture_memory', arguments: args }); assert.equal(response.isError, true); }
  catch (error) { if (error instanceof assert.AssertionError) throw error; assert.match(String(error), /invalid|validation|required|unrecognized/i); }
}
const snapshot = (path) => { const db = new DatabaseSync(path); try {
  return ['memories', 'receipts', 'memory_qualifications', 'qualification_anchors', 'qualified_claim_bindings']
    .map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]);
} finally { db.close(); } };

test('M1 v2 syntax-only configuration and help perform no DB or provider access', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cairn-v2-config-')); const path = join(directory, 'memory.sqlite');
  const args = ['--check-config', '--db', path, '--owner', namespace, '--capture-qualification', 'source-bound-v2'];
  for (const key of ['', 'synthetic-key']) {
    const result = spawnSync(process.execPath, ['--import', 'data:text/javascript,globalThis.fetch=()=>{process.exit(91)}', cli, ...args],
      { encoding: 'utf8', timeout: 5000, env: { OPENAI_API_KEY: key, NODE_NO_WARNINGS: '1' } });
    assert.equal(result.status, 0, result.stderr); const report = JSON.parse(result.stdout);
    assert.equal(report.captureQualification, 'source-bound-v2'); assert.equal(report.capture, key ? 'configured-not-verified' : 'model_not_configured');
    assert.equal(report.databaseOpened, false); assert.equal(report.providerContacted, false); assert.equal(report.automaticCapture, false);
    assert.deepEqual(readdirSync(directory), []);
  }
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8', timeout: 5000,
    env: { OPENAI_API_KEY: '', NODE_NO_WARNINGS: '1' } });
  assert.equal(help.status, 0); assert.match(help.stdout, /source-bound-v2/);
});

test('M1/M2 both capture modes expose identical six strict tools, default remains five', options, async (t) => {
  const lists = [];
  for (const mode of [null, 'source-bound-v1', 'source-bound-v2']) {
    const h = await host(t, database(), { mode }); const tools = (await h.client.listTools()).tools;
    assert.equal(tools.length, mode ? 6 : 5);
    if (mode) lists.push(tools.map(({ name, inputSchema }) => ({ name, inputSchema })));
    for (const tool of tools) assert.equal(tool.inputSchema.additionalProperties, false);
    await h.close();
  }
  assert.deepEqual(lists[0], lists[1]);
});

test('M3 v2 capture exact source evidence survives process restart and replay without any HTTP', options, async (t) => {
  const path = database(); const h = await host(t, path); const result = ok(await call(h.client, 'capture_memory', capture()));
  const id = result.admission.memories[0].id; const saved = ok(await inspect(h.client, id));
  assert.equal(saved.qualification.anchors[0].text, capture().messages[0].content);
  assert.equal(saved.qualification.anchors[0].end, capture().messages[0].content.length);
  await h.close(); const cold = await host(t, path, { forbidHttp: true });
  assert.deepEqual(ok(await inspect(cold.client, id)), saved);
  assert.equal(ok(await call(cold.client, 'capture_memory', capture())).duplicate, true); assert.equal(cold.http(), 0);
  await cold.close(); const keyless = await host(t, path, { fake: false }); assert.deepEqual(ok(await inspect(keyless.client, id)), saved);
});

test('M3 v1 and v2 same batch conflict in both directions before any model request', options, async (t) => {
  for (const initial of ['source-bound-v1', 'source-bound-v2']) {
    const path = database(); const first = await host(t, path, { mode: initial }); ok(await call(first.client, 'capture_memory', capture()));
    const before = snapshot(path); await first.close();
    const other = await host(t, path, { mode: initial === 'source-bound-v1' ? 'source-bound-v2' : 'source-bound-v1', forbidHttp: true });
    const result = await call(other.client, 'capture_memory', capture());
    assert.equal(result.ok, false); assert.equal(result.error.code, 'event_payload_conflict'); assert.equal(other.http(), 0);
    assert.deepEqual(snapshot(path), before);
  }
});

test('M3 two distinct v2 claims remain active without inferred bindings, namespaces remain fixed', options, async (t) => {
  const path = database(); const h = await host(t, path); const ids = [];
  for (const [batchId, content] of [['one', 'Deadline Friday'], ['two', 'Deadline Monday']]) {
    const result = ok(await call(h.client, 'capture_memory', capture({ batchId, messages: [{ role: 'user', content }] })));
    ids.push(result.admission.memories[0].id);
  }
  for (const id of ids) assert.equal(ok(await inspect(h.client, id)).memory.state, 'active');
  assert.deepEqual(snapshot(path).at(-1)[1], []);
  assert.deepEqual(ok(await call(h.client, 'inspect_memory', { states: ['historical'] })).memories, []);
  const foreign = await host(t, path, { owner: 'foreign', fake: false });
  assert.equal((await inspect(foreign.client, ids[0])).error.code, 'memory_not_found');
});

test('M4 malformed later candidate output rejects whole capture without source or qualification writes', options, async (t) => {
  const path = database(); const h = await host(t, path); const before = snapshot(path);
  const result = await call(h.client, 'capture_memory', capture({ messages: [
    { role: 'user', content: 'Valid first item' }, { role: 'assistant', content: 'INVALID_CANDIDATE' }] }));
  assert.equal(result.ok, false); assert.equal(result.error.code, 'invalid_model_output'); assert.deepEqual(snapshot(path), before);
});

test('M2/M4 authority and oversized inputs remain rejected without model work', options, async (t) => {
  const path = database(); const h = await host(t, path, { forbidHttp: true }); const before = snapshot(path);
  for (const key of ['qualification', 'namespace', 'receipts', 'causal', 'binding', 'slot', 'currentness', 'authorization'])
    await invalid(h.client, { ...capture(), [key]: {} });
  for (const patch of [{ batchId: 'x'.repeat(201) }, { messages: [] }, { messages: Array(25).fill({ role: 'user', content: 'x' }) },
    { messages: [{ role: 'user', content: 'x'.repeat(4001) }] }, { messages: [{ role: 'system', content: 'x' }] },
    { messages: [{ role: 'user', content: 'bad\ud800' }] }]) await invalid(h.client, { ...capture(), ...patch });
  assert.deepEqual(snapshot(path), before); assert.equal(h.http(), 0);
});
