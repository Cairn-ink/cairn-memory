import test from 'node:test';
import assert from 'node:assert/strict';
import { registerContextReadTools } from '../context-read-tools.mjs';
import { registerContextReadSourcesTools } from '../context-read-sources-tools.mjs';
import { contextToolResponse } from '../context-read-transport.mjs';
import { createContextReadAccess } from '../context-read-access.mjs';
import { createContextCounter } from '../../openai/context-counter.mjs';
import { countOpenAITokens } from '../../openai/context-counter.mjs';
import { assemblyFixture, ns, ok } from '../../../core/testing/context-read-assembly-fixture.mjs';
import { assembleContext } from '../../../core/context-read-assembly.mjs';
import { compactAssemblyOptions } from '../../../core/testing/context-read-compact-fixture.mjs';

const args = { query: 'assembly', types: ['memory'], intent: 'current', raw: false, representation: 'memory-compact-v1' };
test('MCP additive selector/raw switch forwards compact on assembly only, also with source narrowing', async t => {
  const f = assemblyFixture(t, { counter: await createContextCounter() });
  f.admit('assembly whole canonical memory');
  const access = createContextReadAccess(ns), core = f.reopen({ ...access.configuration, counter: await createContextCounter() });
  ok(await access.call(core, 'refreshContextIndex', { readSet: [ns], types: ['memory'], intent: 'current', budget: { maxItems: 1024, maxMs: 5000 } }));
  for (const withSources of [false, true]) {
    const tools = new Map(), register = (name, description, schema, action) => tools.set(name, { description, schema, action });
    if (withSources) registerContextReadSourcesTools(register, core, access, ['relations-one-hop-v1']);
    else registerContextReadTools(register, core, access);
    assert.equal(tools.size, 3);
    const tool = tools.get('read_memory_context'), parsed = tool.schema.parse({ ...args, ...(withSources ? { sources: [] } : {}) });
    const value = ok(await tool.action(parsed)), response = contextToolResponse({ ok: true, value }, { assembly: true });
    const emitted = response.content[0].text, wire = ok(JSON.parse(emitted));
    assert.equal(wire.items.length, 1); assert.deepEqual(Object.keys(wire.items[0]), ['date', 'body']);
    assert.equal(value.diagnostics.budget.used, countOpenAITokens(emitted));
    assert.deepEqual(response._meta['ink.cairn/context-read-diagnostics'], value.diagnostics);
    assert.ok(response._meta['ink.cairn/context-read-snapshot']);
    assert.equal(emitted.includes(value.diagnostics.items[0].ref.memoryId), false);
    assert.equal(tools.get('find_memory_candidates').schema.safeParse(args).success, false);
  }
});

test('real o200k metering counts exact compact success text at the token boundary', async () => {
  const options = compactAssemblyOptions({ representation: 'memory-compact-v1', counter: await createContextCounter() });
  const { selected, ...value } = assembleContext(options);
  const response = contextToolResponse({ ok: true, value }, { assembly: true });
  const used = countOpenAITokens(response.content[0].text);
  assert.equal(value.diagnostics.budget.used, used);
  const exact = assembleContext({ ...options, budget: { maxTokens: used, maxItems: 24 } });
  assert.deepEqual(exact.metered, value.metered);
  const smaller = assembleContext({ ...options, budget: { maxTokens: used - 1, maxItems: 24 } });
  assert.ok(smaller.metered.items.length < value.metered.items.length);
});
