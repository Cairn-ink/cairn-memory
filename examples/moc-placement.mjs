import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openMemoryCore } from '../core/contract.mjs';
import { createMockPlacementModel } from '../core/testing/mock-placement-model.mjs';

const path = join(mkdtempSync(join(tmpdir(), 'cairn-moc-demo-')), 'memory.sqlite');
const namespace = { ownerId: 'demo', scope: 'personal', projectId: null };
const model = createMockPlacementModel([({ input }) => ({ items: [{ memoryId: input.memories[0].id,
  parentIds: [], newL1: { title: 'Protocol diagrams', parentL2Ids: [], newL2Title: 'Engineering' } }] })]);
const core = openMemoryCore({ path, model });
const ok = (result) => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
try {
  const saved = ok(core.admit({ namespace,
    memory: { content: 'Explain network handshakes with sequence diagrams.', kind: 'instruction' },
    receipts: [{ client: 'demo', sessionId: 'session', eventId: 'event', role: 'user',
      excerpt: 'Explain network handshakes with sequence diagrams.' }] }));
  const memoryId = saved.memory.id;
  const classified = ok(await core.classifyPlacement({ namespace, memoryIds: [memoryId],
    expectedMemoryRevisions: [{ memoryId, revision: 1 }], mapRevision: saved.indexRevision }));
  assert.equal(ok(core.get({ namespace, memoryId })).memory.filing.status, 'unfiled');
  const filed = ok(core.applyPlacement({ namespace, proposal: classified.proposal,
    expectedMemoryRevisions: classified.basedOn.memoryRevisions,
    expectedIndexRevision: classified.basedOn.indexRevision }));
  const mapped = ok(core.map({ namespace }));
  assert.equal(mapped.items.filter((i) => i.type === 'moc').length, 2);
  assert.equal(mapped.items.filter((i) => i.type === 'ref').length, 2);
  assert.equal(ok(core.get({ namespace, memoryId })).receipts.length, 1);
  ok(core.forget({ namespace, memoryId, expectedRevision: filed.memories[0].revision }));
  assert.deepEqual(ok(core.map({ namespace })).items, []);
  console.log('PASS: admit → mock proposal (no write) → apply → L2/L1 map → forget → empty map');
  console.log(`Synthetic database retained at ${path}`);
  console.log('Scripted mock only: no real model, recall/MCP or quality claim.');
} finally { core.close(); }
