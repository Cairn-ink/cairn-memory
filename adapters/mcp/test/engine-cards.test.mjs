import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createCairnServer } from '../server.mjs';
import { engineCardFixture, ns, ok } from '../../../core/testing/engine-card-fixture.mjs';
import { contextCall } from './context-support.mjs';

test('configured model builds Cards in default maintenance with authoring tools off, then falls back after forget', { timeout: 30000 }, async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('offline scripted model cannot use a provider'));
  const f = engineCardFixture(t), memories = f.seed();
  const server = createCairnServer({ path: f.path, namespace: ns, model: f.model, raw: false });
  f.workspace.defer(() => server.close()); assert.equal(await server.contextCounterReady, true);
  const client = new Client({ name: 'synthetic-engine-card-client', version: '1' });
  f.workspace.defer(() => client.close());
  const [left, right] = InMemoryTransport.createLinkedPair(); await server.connect(left); await client.connect(right);
  const tools = await client.listTools(); assert.equal(tools.tools.some(tool => tool.name === 'create_private_card_draft'), false);
  const query = { query: 'what is the current state of Orion', types: ['memory', 'card'], intent: 'current',
    semantic: false, maxItems: 12, maxTokens: 3000, deadlineMs: 5000 };
  const until = async predicate => {
    const end = Date.now() + 15000; let result;
    while (Date.now() < end) {
      result = await contextCall(client, 'read_memory_context', query);
      if (result.ok && predicate(result.value.items)) return result;
      await delay(100);
    }
    assert.fail(JSON.stringify(result));
  };
  const packed = await until(items => items.some(item => item.ref.type === 'card'));
  assert.ok(packed.value.items.every(item => item.ref.type === 'card'));
  assert.equal(f.model.calls.length, 1);
  ok(f.core.forget({ namespace: ns, memoryId: memories[0].id, expectedRevision: memories[0].revision }));
  const fallback = await until(items => items.length > 0 && items.every(item => item.ref.type === 'memory'));
  assert.doesNotMatch(JSON.stringify(fallback), /Orion current state:/);
  assert.equal(f.model.calls.length, 1, 'next worker pass debounces the stale Card');
});
