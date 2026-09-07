import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openMemoryCore } from '../core/contract.mjs';
import { createMockRecallModel } from '../core/testing/mock-recall-model.mjs';

const namespace = { ownerId: 'synthetic-demo', scope: 'personal', projectId: null };
const model = createMockRecallModel({
  select: [({ input }) => ({ refs: input.maps[0].items.filter((item) => item.type === 'unfiled')
    .map((item) => ({ namespaceIndex: 0, ...item.ref })) })],
  rank: [({ input }) => ({ refs: input.candidates.map(({ memory, namespaceIndex }) =>
    ({ namespaceIndex, memoryId: memory.id, revision: memory.revision })) })],
});
const path = join(mkdtempSync(join(tmpdir(), 'cairn-recall-demo-')), 'memory.sqlite');
const core = openMemoryCore({ path, model });
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
try {
  const saved = ok(core.admit({ namespace,
    memory: { content: 'Use sequence diagrams for protocol reviews.', kind: 'instruction' },
    receipts: [{ client: 'demo', sessionId: 'session', eventId: 'event', role: 'user',
      excerpt: 'Use sequence diagrams for protocol reviews.' }],
  })).memory;
  const result = ok(await core.recall({ readSet: [namespace], query: 'How should I review a protocol?' }));
  assert.equal(result.coverage, 'complete');
  assert.equal(result.memories[0].memory.id, saved.id);
  assert.equal(result.memories[0].receipts.length, 1);
  assert.equal(model.calls.length, 2);
  ok(core.forget({ namespace, memoryId: saved.id, expectedRevision: saved.revision }));
  const forgotten = ok(core.fetch({ namespace, refs: [{ memoryId: saved.id, revision: saved.revision }] }));
  assert.deepEqual(forgotten.items, []);
  assert.equal(forgotten.invalidRefs[0].reason, 'not_found');
  console.log('PASS: admit → map/select → fetch/rank → authoritative receipts → forget → invalid ref');
  console.log(`Synthetic database retained at ${path}`);
  console.log('Scripted mock only: no semantic-quality, real provider, MCP or hosted claim.');
} finally { core.close(); }
