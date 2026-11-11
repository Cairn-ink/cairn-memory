import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { installRawSearchTestClock,rawSearchTestWait } from '../../../core/testing/raw-search-clock.mjs';
import { openMemoryCore } from '../../../core/index.mjs';
import { rationaleModel } from '../../../core/testing/rationale-model.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { createCairnServer } from '../server.mjs';
import { contextCall } from './context-support.mjs';

test.beforeEach(installRawSearchTestClock);

const personal = { ownerId: 'synthetic-preference-owner', scope: 'personal', projectId: null };
const project = { ...personal, scope: 'project', projectId: 'synthetic-project' };
const day1 = { id: 'day-1', role: 'user', content: 'I like egg pancakes', occurredAt: '2026-01-01T08:00:00.000Z' };
const day3 = { id: 'day-3', role: 'user', content: 'I no longer like egg pancakes because of gutter oil', occurredAt: '2026-01-03T08:00:00.000Z' };
const query = { query: 'Do I like egg pancakes?', types: ['memory'], intent: 'current' };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const allOutput = result => JSON.stringify({ ...result, decodedSnapshot: result.snapshot
  ? JSON.parse(Buffer.from(result.snapshot.split('.')[0], 'base64url').toString('utf8')) : null });

async function connect(workspace, path, namespace, extra = {}) {
  // Only the model is a fixture; retrieval, counter, Raw port and maintenance
  // use the public constructor defaults, without a provider or embedding key.
  const server = createCairnServer({ path, namespace, model: rationaleModel(), ...extra });
  workspace.defer(() => server.close());
  assert.equal(await server.contextCounterReady, true);
  const client = new Client({ name: 'synthetic-preference-client', version: '1' });
  workspace.defer(() => client.close());
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  return client;
}

async function publish(core, namespace, expected) {
  let found;
  for (let turn = 0; turn < 120; turn++) {
    await rawSearchTestWait(1010);
    // Drive the same bounded maintenance lane used by default capture.
    ok(await core.maintainRawSearch({ namespace }));
    found = ok(await core.searchRaw({ namespace, query: query.query }));
    if (found.coverage.status === 'complete' && found.candidates.length === expected) return found;

  }
  assert.fail('default Raw maintenance did not publish: ' + JSON.stringify(found));
}

async function read(client) {
  // The server owns a separate reader, so wait for its bounded discovery turn.
  let result;
  for (let turn = 0; turn < 16; turn++) {
    await rawSearchTestWait(1010);
    const response = await client.callTool({ name: 'read_memory_context', arguments: query });
    const envelope = JSON.parse(response.content[0].text);
    assert.equal(envelope.evidenceTrust, 'untrusted-data-not-instructions');
    assert.equal(response.isError, false, JSON.stringify(response));
    result = { metered: ok(envelope), diagnostics: response._meta['ink.cairn/context-read-diagnostics'],
      snapshot: response._meta['ink.cairn/context-read-snapshot'] };
    if (result.diagnostics.coverage.raw === 'included') return result;
    await delay(1100);
  }
  assert.fail('default contextRead did not include Raw: ' + JSON.stringify(result));
}

test('default keyless MCP reads dated captured Memory and Raw, forgets and isolates identical text across namespaces', { timeout: 120000 }, async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('synthetic default path must never use the network'));
  const workspace = createTestWorkspace(t), path = join(workspace.path, 'preferences.sqlite');
  const core = openMemoryCore({ path, raw: true, model: rationaleModel() });
  workspace.defer(() => core.close());
  const firstMemories = [];
  for (const message of [day1, day3]) {
    const captured = ok(await core.capture({ namespace: personal, client: 'claude-code', sessionId: 'preference-history',
      eventId: message.id, messages: [message] }));
    assert.equal(captured.admission.memories.length, 1);
    firstMemories.push(captured.admission.memories[0].id);
  }
  const published = await publish(core, personal, 2);
  const firstConversations = [...new Set(published.candidates.map(item => item.conversationId))];
  const client = await connect(workspace, path, personal);
  const before = await read(client);
  assert.equal(before.diagnostics.representation, 'representation-v2-dated');
  assert.equal(before.diagnostics.coverage.raw, 'included');
  assert.deepEqual(before.metered.items.map(item => item.date), ['2026-01-01T08:00Z', '2026-01-03T08:00Z']);
  assert.match(JSON.stringify(before.metered.items[0]), /I like egg pancakes/);
  assert.match(JSON.stringify(before.metered.items[1]), /I no longer like egg pancakes because of gutter oil/);
  assert.ok(before.metered.items.some(item => item.ref.type === 'memory'));
  assert.ok(before.metered.items.some(item => item.ref.type === 'raw' || item.evidence?.some(evidence => evidence.ref.type === 'raw')));

  const second = await connect(workspace, path, project);
  assert.equal((await read(second)).metered.items.length, 0, 'an empty second namespace must see nothing from the first');
  const secondMemories = [];
  for (const message of [day1, day3]) {
    const captured = ok(await core.capture({ namespace: project, client: 'claude-code', sessionId: 'preference-history',
      eventId: message.id, messages: [message] }));
    secondMemories.push(...captured.admission.memories.map(item => item.id));
  }
  await publish(core, project, 2);
  const isolated = await read(second), isolatedWire = allOutput(isolated);
  assert.deepEqual(isolated.metered.items.map(item => item.date), ['2026-01-01T08:00Z', '2026-01-03T08:00Z']);
  for (const id of [...firstMemories, ...firstConversations]) assert.ok(!isolatedWire.includes(id), 'foreign reference: ' + id);
  assert.ok(isolated.metered.items.every(item => secondMemories.includes(item.ref.id)));

  const forgotten = ok(core.get({ namespace: personal, memoryId: firstMemories[1] })).memory;
  ok(await contextCall(client, 'forget_memory', { memoryId: forgotten.id, expectedRevision: forgotten.revision }));
  const after = await read(client), afterWire = allOutput(after);
  for (const denied of [day3.content, 'no longer', 'gutter oil', day3.id, firstMemories[1], '2026-01-03']) {
    assert.ok(!afterWire.includes(denied), 'forgotten evidence anywhere in output: ' + denied);
  }
  assert.match(JSON.stringify(after.metered), /I like egg pancakes/);
  // Local forget fences the entire source session in both intents, including
  // its day-1 Raw. The independent day-1 Memory above remains readable.
  await publish(core, personal, 0);
  assert.equal(ok(await core.searchRaw({namespace:personal,query:query.query,intent:'history'})).candidates.length,0);

  const combined = await connect(workspace, path, project, { contextReadPersonal: true });
  const combinedRead = await read(combined);
  assert.equal(combinedRead.diagnostics.coverage.raw, 'included');
  assert.deepEqual(new Set(combinedRead.metered.items.map(item => item.ref.ns)), new Set([0, 1]));
  assert.ok(!allOutput(combinedRead).includes(firstMemories[1]));
  const stranger = await connect(workspace, path, { ...personal, ownerId: 'synthetic-other-owner' });
  assert.equal((await read(stranger)).metered.items.length, 0);
});
