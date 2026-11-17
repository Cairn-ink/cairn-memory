import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { buildCairnServer } from '../server.mjs';
import { registerContextReadTools, CONTEXT_TOOL_NAMES } from '../context-read-tools.mjs';
import { registerContextReadSourcesTools } from '../context-read-sources-tools.mjs';
import { createContextReadAccess } from '../context-read-access.mjs';
import { assemblyFixture, ns } from '../../../core/testing/context-read-assembly-fixture.mjs';

// Reuse the frozen wire oracle with only the presentation changes already
// present at be13a6e4. No compact-specific allowance belongs in discovery.
const historical = JSON.parse(readFileSync(new URL('../../../core/test/fixtures/context-read/u5c2-legacy-wire.json', import.meta.url)));
const expected = historical.contextHost.tools.tools.filter(tool => CONTEXT_TOOL_NAMES.includes(tool.name));
for (const tool of expected) {
  tool.description = tool.description
    .replace('Search the fixed host read set. Semantic defaults to false; explicit semantic true', 'Preferred memory read: search the fixed host read set. Semantic defaults on with a configured embedding provider; semantic false selects BM25 only. Semantic lookup')
    .replace('Assemble whole canonical bodies and sources within an exact local token budget. Semantic defaults to false; explicit semantic true', 'Preferred memory read: assemble dated Memory and Raw sources within an exact local token budget. Semantic defaults on with a configured embedding provider; semantic false selects BM25 only. Semantic lookup');
  if (tool.name === 'read_memory_context') {
    tool.inputSchema.properties.maxTokens.maximum = 6000;
    tool.inputSchema.properties = Object.fromEntries(Object.entries(tool.inputSchema.properties).flatMap(entry => entry[0] === 'policy'
      ? [entry, ['representation', { type: 'string', enum: ['representation-v2', 'representation-v2-dated'] }]] : [entry]));
  }
}

test('MCP retains baseline schema/discovery bytes and refuses compact before any engine call', async t => {
  const f = assemblyFixture(t);
  let calls = 0;
  const core = { ...f.context, contextRead() { calls++; assert.fail('schema must refuse before calling the engine'); } };
  const args = { query: 'assembly', types: ['memory'], intent: 'current' };
  for (const withSources of [false, true]) {
    const access = createContextReadAccess(ns);
    const tools = new Map(), register = (name, description, schema) => tools.set(name, { description, schema });
    if (withSources) registerContextReadSourcesTools(register, core, access, ['relations-one-hop-v1']);
    else registerContextReadTools(register, core, access);
    assert.deepEqual([...tools.keys()], CONTEXT_TOOL_NAMES);
    const schema = tools.get('read_memory_context').schema;
    for (const input of [{ ...args, representation: 'memory-compact-v1' },
      { ...args, representation: 'memory-compact-v1', raw: false }, { ...args, raw: false }])
      assert.equal(schema.safeParse(input).success, false);

    const server = buildCairnServer({ path: f.path, binding: ns, core, context: access, ownsCore: false, maintenance: false,
      ...(withSources ? { contextReadSources: ['relations-one-hop-v1'] } : {}) });
    const client = new Client({ name: 'compact-refusal', version: '1' });
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverSide); await client.connect(clientSide);
      const listed = (await client.listTools()).tools.filter(tool => CONTEXT_TOOL_NAMES.includes(tool.name));
      if (withSources) for (const tool of listed.filter(tool => tool.name !== 'fetch_memory_candidate_evidence')) {
        assert.equal(Object.keys(tool.inputSchema.properties).at(-1), 'sources');
        assert.ok(tool.inputSchema.properties.sources);
        delete tool.inputSchema.properties.sources;
      }
      assert.equal(JSON.stringify(listed), JSON.stringify(expected));
      for (const input of [{ ...args, representation: 'memory-compact-v1' },
        { ...args, representation: 'memory-compact-v1', raw: false }, { ...args, raw: false }]) {
        const response = await client.callTool({ name: 'read_memory_context', arguments: {
          ...input, ...(withSources ? { sources: [] } : {}),
        } });
        assert.equal(response.isError, true);
      }
      assert.equal(calls, 0);
    } finally { await client.close(); await server.close(); }
  }
});
