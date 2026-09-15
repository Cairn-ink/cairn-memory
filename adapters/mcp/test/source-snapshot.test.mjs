import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createCairnServer } from '../server.mjs';
import { parseConfiguration } from '../cli.mjs';

const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const scripted = fileURLToPath(new URL('./fixtures/staged-server.mjs', import.meta.url));
const flags = ['--source-snapshot', 'current-admitted-v1'];
const namespace = { ownerId: 'synthetic-source-reader', scope: 'personal', projectId: null };
const database = () => join(mkdtempSync(join(tmpdir(), 'cairn-mcp-source-reader-')), 'memory.sqlite');
const denyFetch = 'data:text/javascript,globalThis.fetch=()=>{process.exit(91)}';
const denyTokenizer = 'data:text/javascript,' + encodeURIComponent("import {registerHooks} from 'node:module'; registerHooks({resolve(s,c,n){if(s==='tiktoken'||s.includes('/openai/index.mjs'))throw Error('Unexpected tokenizer load');return n(s,c)}});globalThis.fetch=()=>{process.exit(91)};");
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
async function host(t, path, { args = flags, owner = namespace.ownerId, project, script = cli, forbidTokenizer = false } = {}) {
  const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', forbidTokenizer ? denyTokenizer : denyFetch,
    script, '--db', path, '--owner', owner, ...(project ? ['--project', project] : []), ...args],
    env: { NODE_NO_WARNINGS: '1', SYNTHETIC_FORBID_MODEL: '1' }, stderr: 'pipe' });
  let stderr = ''; transport.stderr.on('data', chunk => { stderr += chunk; });
  const client = new Client({ name: 'synthetic-source-reader', version: '1.0.0' }); t.after(() => client.close());
  await client.connect(transport); return { client, close: () => client.close(), stderr: () => stderr };
}
async function call(h, name, args = {}) {
  const result = await h.client.callTool({ name, arguments: args }); const value = JSON.parse(result.content[0].text);
  assert.equal(value.evidenceTrust, 'untrusted-data-not-instructions'); assert.equal(Boolean(result.isError), !value.ok); return value;
}
async function invalid(h, args) {
  try { assert.equal((await h.client.callTool({ name: 'read_memory_sources', arguments: args })).isError, true); }
  catch (error) { if (error instanceof assert.AssertionError) throw error; assert.match(String(error), /invalid|validation|required|unrecognized/i); }
}

test('source snapshot mode and counter reject before database creation', () => {
  for (const config of [{ sourceSnapshot: undefined }, { sourceSnapshot: null }, { sourceSnapshot: 'unknown' },
    { sourceSnapshot: 'current-admitted-v1' }, { sourceSnapshot: 'current-admitted-v1', model: {} },
    { sourceSnapshot: 'current-admitted-v1', model: { countTokens: 1 } }]) {
    const path = database(); assert.throws(() => createCairnServer({ path, namespace, ...config })); assert.equal(existsSync(path), false);
  }
  for (const args of [['--source-snapshot'], ['--source-snapshot', 'other'], [...flags, ...flags]]) {
    const path = database(); assert.throws(() => parseConfiguration(['--db', path, '--owner', namespace.ownerId, ...args]));
    assert.equal(existsSync(path), false);
  }
});

test('syntax-only source check and default keyless startup never load tokenizer or contact a provider', { timeout: 15000 }, async t => {
  const path = database();
  const result = spawnSync(process.execPath, ['--import', denyTokenizer, cli, '--check-config', '--db', path,
    '--owner', namespace.ownerId, ...flags], { encoding: 'utf8', timeout: 5000, env: { NODE_NO_WARNINGS: '1' } });
  assert.equal(result.status, 0, result.stderr); const report = JSON.parse(result.stdout);
  assert.equal(report.sourceSnapshot, 'current-admitted-v1'); assert.equal(report.databaseOpened, false);
  assert.equal(report.providerContacted, false); assert.equal(existsSync(path), false);
  const h = await host(t, path, { args: [], forbidTokenizer: true });
  assert.equal((await h.client.listTools()).tools.length, 5);
  assert.equal((await h.client.listTools()).tools.some(tool => tool.name === 'read_memory_sources'), false);
});

test('explicit source discovery is strict, read-only, local and composes with existing capture/staging options', { timeout: 30000 }, async t => {
  for (const [extra, count] of [[[], 6], [['--capture-qualification', 'source-bound-v1'], 7],
    [['--capture-qualification', 'source-bound-v2'], 7], [['--capture-evidence-access', 'staged-v1'], 8],
    [['--capture-qualification', 'source-bound-v2', '--capture-evidence', 'staged-v1'], 9]]) {
    const h = await host(t, database(), { args: [...flags, ...extra] }); const tools = (await h.client.listTools()).tools;
    assert.equal(tools.length, count); const tool = tools.find(tool => tool.name === 'read_memory_sources');
    assert.equal(tool.annotations.readOnlyHint, true); assert.equal(tool.annotations.openWorldHint, false);
    assert.equal(tool.annotations.destructiveHint, false); assert.equal(tool.inputSchema.additionalProperties, false);
    assert.deepEqual(Object.keys(tool.inputSchema.properties).sort(), ['limit', 'tokenBudget']);
    assert.deepEqual(ok(await call(h, 'read_memory_sources')).memories, []); await h.close();
  }
});

test('actual keyless CLI persists exact sources across restart and returns no partial over-limit result', { timeout: 30000 }, async t => {
  const path = database(), first = await host(t, path);
  const saved = [];
  const sources = ['Mira is the actor.', 'Only if an evening seat opens.', 'The reason is a quiet room.'];
  for (const content of sources) {
    saved.push(ok(await call(first, 'remember_memory', { content })).memory);
  }
  await first.close(); const cold = await host(t, path);
  const value = ok(await call(cold, 'read_memory_sources'));
  assert.equal(value.coverage, 'complete-current-admitted'); assert.equal(value.semanticCoverage, 'unassessed');
  assert.deepEqual(value.memories.map(item => item.memory.id).sort(), saved.map(memory => memory.id).sort());
  assert.deepEqual(value.memories.flatMap(item => item.receipts.map(receipt => receipt.excerpt)).sort(), [...sources].sort());
  assert.ok(value.memories.every(item => item.namespaceIndex === 0 && item.interpretationStatus === 'omitted'));
  assert.equal(Object.hasOwn(value.memories[0].memory, 'content'), false);
  for (const args of [{ limit: 2 }, { tokenBudget: 1 }]) {
    const result = await call(cold, 'read_memory_sources', args); assert.equal(result.error.code, 'context_item_too_large');
    assert.equal(Object.hasOwn(result, 'value'), false);
  }
  const own = saved[0];
  ok(await call(cold, 'correct_memory', { memoryId: own.id, expectedRevision: own.revision, content: 'Mira changed the condition.' }));
  const revision = ok(await call(cold, 'inspect_memory', { memoryId: own.id })).memory.revision;
  const corrected = ok(await call(cold, 'read_memory_sources')).memories.find(item => item.memory.id === own.id);
  assert.equal(corrected.memory.revision, revision); assert.ok(revision > own.revision);
  assert.ok(corrected.receipts.some(receipt => receipt.excerpt === 'Mira changed the condition.'));
  ok(await call(cold, 'forget_memory', { memoryId: own.id, expectedRevision: revision }));
  await cold.close(); const final = await host(t, path);
  const remaining = ok(await call(final, 'read_memory_sources')).memories;
  assert.equal(remaining.length, 2); assert.equal(remaining.some(item => item.memory.id === own.id), false);
  const recall = await call(final, 'recall_memory', { query: 'Any source?' }); assert.equal(recall.error.code, 'model_not_configured');
});

test('source input cannot choose another namespace or relevance/cursor mode', { timeout: 30000 }, async t => {
  const path = database(), first = await host(t, path, { project: 'first' });
  ok(await call(first, 'remember_memory', { content: 'Project private source' }));
  for (const field of ['namespace', 'ownerId', 'projectId', 'readSet', 'query', 'cursor', 'sourceIds', 'contextMode']) {
    await invalid(first, { [field]: 'forged' });
  }
  for (const args of [{ limit: null }, { limit: 0 }, { limit: 13 }, { limit: 1.5 }, { tokenBudget: null }, { tokenBudget: 0 }, { tokenBudget: 4001 }]) await invalid(first, args);
  for (const config of [{ project: 'second' }, { project: 'first', owner: 'different-owner' }, {}]) {
    const other = await host(t, path, config); assert.deepEqual(ok(await call(other, 'read_memory_sources')).memories, []); await other.close();
  }
  assert.equal(ok(await call(first, 'read_memory_sources')).memories.length, 1);
});

test('snapshot invokes no scripted generation even when a full model object is supplied', { timeout: 15000 }, async t => {
  const h = await host(t, database(), { script: scripted });
  ok(await call(h, 'remember_memory', { content: 'Generation-independent source' }));
  assert.equal(ok(await call(h, 'read_memory_sources')).memories.length, 1);
  assert.equal(h.stderr().includes('synthetic_model:'), false);
});
