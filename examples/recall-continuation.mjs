import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openMemoryCore } from '../core/contract.mjs';

const namespace = { ownerId: 'synthetic-continuation', scope: 'personal', projectId: null };
const path = join(mkdtempSync(join(tmpdir(), 'cairn-continuation-demo-')), 'memory.sqlite');
let target;
const calls = [];
const model = { contextWindow: 8192,
  // Fixed counter is only for testing traversal; not a production tokenizer.
  countTokens: () => 1,
  select: async ({ input }) => {
    calls.push('select');
    return { refs: input.maps.flatMap(({ namespaceIndex, items }) => items
      .filter((item) => item.type === 'unfiled' && item.ref.memoryId === target.id)
      .map((item) => ({ namespaceIndex, ...item.ref }))) };
  },
  rank: async ({ input }) => {
    calls.push('rank');
    return { refs: input.candidates.map(({ namespaceIndex, memory }) => ({
      namespaceIndex, memoryId: memory.id, revision: memory.revision })) };
  },
};
const core = openMemoryCore({ path, model });
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
const receipt = (eventId) => ({ client: 'demo', sessionId: 'session', eventId,
  role: 'user', excerpt: `Synthetic evidence ${eventId}.` });
try {
  const saved = [];
  for (let index = 0; index < 101; index++) {
    const content = `Synthetic preference ${index}.`;
    const result = ok(core.admit({ namespace, memory: { content, kind: 'preference' },
      receipts: [receipt(`source-${index}`)] }));
    saved.push({ ...result.memory, content });
  }
  target = saved.sort((a, b) => a.id.localeCompare(b.id)).at(-1);
  // The second-page target has 201 receipts: two pages expose a 200-receipt prefix.
  for (let index = 0; index < 200; index += 4) {
    const result = ok(core.admit({ namespace, memory: { content: target.content, kind: 'preference' },
      receipts: Array.from({ length: 4 }, (_, offset) => receipt(`extra-${index + offset}`)) }));
    target.revision = result.memory.revision;
  }
  const result = ok(await core.recall({ readSet: [namespace], query: target.content, limit: 1 }));
  assert.deepEqual(calls, ['select', 'select', 'rank']);
  assert.equal(result.memories[0].memory.id, target.id);
  assert.equal(result.memories[0].receipts.length, 200);
  assert.equal(new Set(result.memories[0].receipts.map((r) => r.id)).size, 200);
  assert.equal(result.namespaces[0].mapExhausted, true);
  assert.equal(result.namespaces[0].fetchExhausted, false);
  assert.equal(result.coverage, 'budget_exhausted');
  console.log('PASS: second map page → two receipt pages → authoritative unique prefix → explicit incomplete');
  console.log(`Synthetic database retained at ${path}`);
  console.log('Scripted selection and fixed counter only; real provider context/quality are not established.');
} finally { core.close(); }
