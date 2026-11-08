import test from 'node:test';
import assert from 'node:assert/strict';
import { openSync, closeSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createCairnServer } from '../server.mjs';
import { parseConfiguration, start } from '../cli.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { sourcesFixture, ns, ok } from '../../../core/testing/context-read-sources-fixture.mjs';
import { registerContextReadSourcesTools, contextSourcesToolResponse } from '../context-read-sources-tools.mjs';

const sources = ['relations-one-hop-v1', 'moc-v1'];
const base = ['--db', '/synthetic/source.sqlite', '--owner', 'synthetic'];
const flag = ['--context-read', 'context-read-v1'];
test('C06 pinned independent 94c1076f wire fixtures, controlled identity/clock/entropy/maintenance', t => {
  const workspace = createTestWorkspace(t, { prefix: 'u5c2-wire-' });
  const stdout = openSync(join(workspace.path, 'out'), 'wx', 0o600), stderr = openSync(join(workspace.path, 'err'), 'wx', 0o600);
  const report = join(workspace.path, 'wire.json'); let result;
  try { result = spawnSync(process.execPath, [new URL('./fixtures/context-sources-legacy-worker.mjs', import.meta.url).pathname,
    new URL('../../../', import.meta.url).pathname, workspace.path, report], { stdio: ['ignore', stdout, stderr], timeout: 30000 }); }
  finally { closeSync(stdout); closeSync(stderr); }
  assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 0, readFileSync(join(workspace.path, 'err'), 'utf8'));
  const historical = readFileSync(new URL('../../../core/test/fixtures/context-read/u5c2-legacy-wire.json', import.meta.url), 'utf8');
  const expected = JSON.parse(historical);
  // Preserve historical bytes except documented defaults and the dated option.
  const insertAfter = (object, key, addition) => Object.fromEntries(Object.entries(object)
    .flatMap(entry => entry[0] === key ? [entry, ...Object.entries(addition)] : [entry]));
  for (const key of ['capabilities', 'hostedCapabilities']) {
    const capabilities = expected[key].value;
    capabilities.assembly = insertAfter(capabilities.assembly, 'representation', {
      raw: { default: true, configured: false }, representations: ['representation-v2', 'representation-v2-dated'],
    });
    capabilities.assembly.representation = 'representation-v2-dated';
    Object.assign(capabilities.assembly.limits, { defaultMaxTokens: 6000, maxTokens: 6000, defaultMaxItems: 24 });
    capabilities.unsupported = capabilities.unsupported.filter(feature => feature !== 'raw-search');
  }
  const schema = expected.contextHost.tools.tools[2].inputSchema;
  schema.properties = insertAfter(schema.properties, 'policy', {
    representation: { type: 'string', enum: ['representation-v2', 'representation-v2-dated'] },
  });
  // Keep the legacy bytes except these reviewed host presentation changes.
  for (const host of ['defaultHost', 'contextHost']) for (const tool of expected[host].tools.tools) {
    tool.description = tool.description
      .replace('Retrieve relevant current memories and source receipts.', 'Legacy model-assisted recall; prefer find_memory_candidates and read_memory_context. Retrieve relevant current memories and source receipts.')
      .replace('Search the fixed host read set. Semantic defaults to false; explicit semantic true', 'Preferred memory read: search the fixed host read set. Semantic defaults on with a configured embedding provider; semantic false selects BM25 only. Semantic lookup')
      .replace('Assemble whole canonical bodies and sources within an exact local token budget. Semantic defaults to false; explicit semantic true', 'Preferred memory read: assemble dated Memory and Raw sources within an exact local token budget. Semantic defaults on with a configured embedding provider; semantic false selects BM25 only. Semantic lookup');
    if (tool.name === 'read_memory_context') tool.inputSchema.properties.maxTokens.maximum = 6000;
  }
  // The MCP legacy representation retains the new default Raw coverage status;
  // this host has explicitly disabled Raw and cannot supply its search port.
  expected.assembly.value.diagnostics = insertAfter(expected.assembly.value.diagnostics, 'trace', { coverage: { raw: 'unavailable' } });
  const diagnostics = expected.contextHost.assembly._meta['ink.cairn/context-read-diagnostics'];
  expected.contextHost.assembly._meta['ink.cairn/context-read-diagnostics'] =
    insertAfter(diagnostics, 'trace', { coverage: { raw: 'unavailable' } });
  const compare = actual => assert.equal(actual, JSON.stringify(expected, null, 2) + '\n');
  const actual = readFileSync(report, 'utf8');
  compare(actual);
  // One unrelated byte must still fail the same comparison.
  const mutated = actual.replace('94c1076f', '94c1076e');
  assert.notEqual(mutated, actual);
  assert.throws(() => compare(mutated), { code: 'ERR_ASSERTION' });
});
test('C06 source startup grammar, refusals and check-config side-effect freedom', async t => {
  for (const selected of ['relations-one-hop-v1', 'moc-v1', sources.join(','), [...sources].reverse().join(',')]) {
    const value = parseConfiguration([...base, '--context-read-sources', selected, ...flag]);
    assert.deepEqual(value.contextReadSources, sources.filter(s => selected.split(',').includes(s)));
  }
  for (const value of ['', ',', 'moc-v1,', ',moc-v1', 'moc-v1,moc-v1', 'unknown', ' moc-v1', 'moc-v1,,relations-one-hop-v1'])
    assert.throws(() => parseConfiguration([...base, ...flag, '--context-read-sources', value]), /invalid_mcp_configuration/);
  for (const tail of [['--no-context-read', '--context-read-sources', 'moc-v1'], [...flag, '--context-read-sources'], [...flag, '--context-read-sources', 'moc-v1', '--context-read-sources', 'moc-v1'],
    [...flag, '--retained-raw-profile', '/synthetic/profile', '--context-read-sources', 'moc-v1']])
    assert.throws(() => parseConfiguration([...base, ...tail]), /invalid_mcp_configuration/);
  const workspace = createTestWorkspace(t, { prefix: 'u5c2-config-' }), path = join(workspace.path, 'absent', 'store.sqlite'), logs = [];
  const logger = t.mock.method(console, 'log', value => logs.push(JSON.parse(value)));
  await start(['--check-config', '--db', path, '--owner', 'synthetic', ...flag, '--context-read-sources', sources.join(',')],
    Object.defineProperty({}, 'OPENAI_API_KEY', { get() { assert.fail('key access'); } }));
  logger.mock.restore();
  assert.equal(logs.length, 1); assert.deepEqual(logs[0].sources, sources); assert.equal(logs[0].preset, 'rrf-k60-d12-moc-v1');
  assert.equal(logs[0].databaseOpened, false); assert.equal(existsSync(join(workspace.path, 'absent')), false);
  for (const contextReadSources of [[], ['unknown'], ['moc-v1', 'moc-v1'], 'moc-v1'])
    assert.throws(() => createCairnServer({ path, namespace: ns, contextRead: 'context-read-v1', contextReadSources }), /invalid_mcp_configuration/);
  assert.throws(() => createCairnServer({ path, namespace: ns, contextRead:false, contextReadSources: ['moc-v1'] }), /invalid_mcp_configuration/);
});
test('C05/C08 real SDK tools/list narrowing, no extra tools, metadata-only diagnostics and compact fetch', async t => {
  const f = sourcesFixture(t); const seed = f.admit('needle direct'), endpoint = f.admit('Unmatched endpoint'); await f.relate(endpoint, seed);
  const server = createCairnServer({ path: f.path, namespace: ns, contextRead: 'context-read-v1', contextReadSources: sources,
    contextCounter: { id: 'synthetic-unit', countTokens: () => 1 } });
  const [a, b] = InMemoryTransport.createLinkedPair(), client = new Client({ name: 'u5c2-synthetic', version: '1' });
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(b); await client.connect(a);
  const listed = (await client.listTools()).tools;
  for (const name of ['find_memory_candidates', 'read_memory_context']) assert.ok(listed.find(t => t.name === name).inputSchema.properties.sources);
  assert.equal(listed.find(t => t.name === 'fetch_memory_candidate_evidence').inputSchema.properties.sources, undefined);
  const query = { query: 'needle', types: ['memory'], intent: 'current' };
  const found = await client.callTool({ name: 'find_memory_candidates', arguments: query });
  const envelope = JSON.parse(found.content[0].text); assert.equal(envelope.value.items.length, 2);
  assert.equal(envelope.value.trace.sources, undefined); assert.ok(found._meta['ink.cairn/context-read-diagnostics'].trace.sources);
  for (const sources of [[], ['moc-v1']]) {
    const narrowed = await client.callTool({ name: 'find_memory_candidates', arguments: { ...query, sources } });
    assert.equal(JSON.parse(narrowed.content[0].text).value.items.length, 1);
  }
  for (const sources of [['unknown'], ['moc-v1', 'moc-v1'], null]) {
    const invalid = await client.callTool({ name: 'find_memory_candidates', arguments: { ...query, sources } }); assert.equal(invalid.isError, true);
  }
  const assembly = await client.callTool({ name: 'read_memory_context', arguments: query });
  assert.equal(assembly.content.length, 1); assert.equal(assembly.structuredContent, undefined);
  assert.ok(assembly._meta['ink.cairn/context-read-diagnostics'].candidates.trace.sources);
  const snapshot = assembly._meta['ink.cairn/context-read-snapshot']; assert.equal(assembly.content[0].text.includes(snapshot), false);
  assert.equal(assembly.content[0].text.includes('trace'), false);
  const refs = JSON.parse(assembly.content[0].text).value.items.map(item => item.ref);
  const fetch = await client.callTool({ name: 'fetch_memory_candidate_evidence', arguments: { refs, intent: 'current' } });
  assert.equal(JSON.parse(fetch.content[0].text).value.items.length, 2);
});
test('C08 source schemas reject attempts to widen the host before any core call', () => {
  let calls = 0; const tools = new Map();
  registerContextReadSourcesTools((name, description, schema, action) => tools.set(name, { schema, action }), {}, { readSet: [ns], call() { calls++; } }, ['moc-v1']);
  for (const name of ['find_memory_candidates', 'read_memory_context']) {
    const schema = tools.get(name).schema;
    assert.equal(schema.safeParse({ query: 'q', types: ['memory'], intent: 'current', sources: ['relations-one-hop-v1'] }).success, false);
  }
  assert.equal(calls, 0);
  const error = contextSourcesToolResponse({ ok: false, error: { code: 'index_unavailable', retryable: false,
    details: { trace: { sources: { 'moc-v1': { status: 'unavailable', reasons: ['index_unavailable'] } } } } } });
  assert.equal(error.content[0].text.includes('moc-v1'), false); assert.ok(error._meta);
});
