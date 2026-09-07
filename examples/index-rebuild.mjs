import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openMemoryCore } from '../core/contract.mjs';

const namespace = { ownerId: 'synthetic-rebuild', scope: 'personal', projectId: null };
const path = join(mkdtempSync(join(tmpdir(), 'cairn-rebuild-demo-')), 'memory.sqlite');
let tokenCalls = 0;
const core = openMemoryCore({ path, model: { countTokens: () => { tokenCalls++; return 1; } } });
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
try {
  const saved = ok(core.admit({ namespace, memory: { content: 'Prefer diagrams.', kind: 'preference' },
    receipts: [{ client: 'demo', sessionId: 'session', eventId: 'source', role: 'user',
      excerpt: 'Prefer diagrams.' }] }));
  const filed = ok(core.applyPlacement({ namespace,
    proposal: { items: [{ memoryId: saved.memory.id, parentIds: [],
      newL1: { title: 'Explanations', parentL2Ids: [] } }] },
    expectedMemoryRevisions: [{ memoryId: saved.memory.id, revision: saved.memory.revision }],
    expectedIndexRevision: saved.indexRevision }));
  const request = { namespace, expectedIndexRevision: filed.indexRevision, limit: 1 };
  let result = ok(core.rebuildIndex(request));
  assert.equal(result.state, 'staged');
  assert.equal(tokenCalls, 0);
  assert.equal(ok(core.get({ namespace, memoryId: saved.memory.id })).memory.content, 'Prefer diagrams.');
  let pages = 1;
  while (!result.exhausted) {
    assert.ok(pages < 30, 'bounded synthetic demo must finish');
    result = ok(core.rebuildIndex({ ...request, cursor: result.nextCursor }));
    pages++;
  }
  assert.equal(result.state, 'published');
  assert.equal(result.nextCursor, null);
  assert.equal(result.indexRevision, filed.indexRevision + 1);
  assert.equal(tokenCalls, 0);
  assert.ok(ok(core.map({ namespace })).items.length > 0);
  const detail = ok(core.get({ namespace, memoryId: saved.memory.id }));
  assert.equal(detail.placements.length, 1);
  ok(core.forget({ namespace, memoryId: saved.memory.id, expectedRevision: detail.memory.revision }));
  assert.deepEqual(ok(core.map({ namespace })).items, []);
  console.log(`PASS: ${pages} bounded model-free pages → atomic publication → live mutation coherence`);
  console.log(`Synthetic database retained at ${path}`);
  console.log('Rebuild validates existing organization; it does not recreate topics or prove semantic quality.');
} finally { core.close(); }
