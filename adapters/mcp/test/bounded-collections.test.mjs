import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createCairnServer } from '../server.mjs';

test('capture messages reject overflow before elements and validate the allowed boundary', async t => {
  const namespace = { ownerId: 'synthetic-bounds-owner', scope: 'personal', projectId: null };
  const server = createCairnServer({ path: ':memory:', namespace, captureQualification: 'source-bound-v1' });
  const client = new Client({ name: 'synthetic-bounds', version: '1' });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(serverSide);
  await client.connect(clientSide);
  const schema = (await client.listTools()).tools.find(tool => tool.name === 'capture_memory').inputSchema;
  const maximum = schema.properties.messages.maxItems;
  assert.equal(maximum, 24);

  // In-memory transport preserves object identity, unlike JSON serialization.
  // These enumerable role getters run only when an element object is parsed;
  // no schema is copied and the request uses the public Client.callTool path.
  function messages(count, role) {
    const reads = new Set();
    let accesses = 0;
    return { reads, accesses: () => accesses,
      value: Array.from({ length: count }, (_, index) => ({
        get role() { accesses++; reads.add(index); return role; },
        content: 'Synthetic bounded message',
      })),
    };
  }
  const call = value => client.callTool({ name: 'capture_memory', arguments: {
    batchId: 'synthetic-bounded-batch', messages: value,
  } });
  const oversized = messages(maximum + 1, 'invalid-role');
  const rejected = await call(oversized.value);
  assert.equal(rejected.isError, true);
  assert.match(rejected.content[0].text, /Input validation error/);
  assert.match(rejected.content[0].text, /messages.*(?:<=24|at most 24|too big)/i);
  assert.equal(oversized.accesses(), 0, 'overflow must not validate any element');
  assert.equal(oversized.reads.size, 0);

  const boundary = messages(maximum, 'user');
  const accepted = await call(boundary.value);
  assert.equal(boundary.reads.size, maximum);
  assert.ok(boundary.accesses() >= maximum);
  // Reaching the real keyless core proves the schema accepted all 24 elements.
  assert.equal(accepted.isError, true);
  assert.equal(JSON.parse(accepted.content[0].text).error.code, 'model_not_configured');

  const invalidBoundary = messages(maximum, 'invalid-role');
  const invalid = await call(invalidBoundary.value);
  assert.equal(invalid.isError, true);
  assert.equal(invalidBoundary.reads.size, maximum);
  assert.match(invalid.content[0].text, /Input validation error/);
  assert.match(invalid.content[0].text, /role/);
  assert.doesNotMatch(invalid.content[0].text, /model_not_configured/);
});
