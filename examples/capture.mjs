import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openMemoryCore } from '../core/contract.mjs';

const namespace = { ownerId: 'synthetic-demo', scope: 'personal', projectId: null };
const path = join(mkdtempSync(join(tmpdir(), 'cairn-capture-demo-')), 'memory.sqlite');
const calls = [];
const model = { contextWindow: 8192,
  // Deliberately conservative mock counter, not a provider tokenizer.
  countTokens: (text) => Buffer.byteLength(text, 'utf8'),
  extract: async () => { calls.push('extract'); return { items: [{
    content: 'Use diagrams in protocol reviews.', kind: 'instruction', confidence: 0.9,
    sourceIndices: [0] }] }; },
  classify: async ({ input }) => { calls.push('classify'); return {
    items: input.memories.map((m) => ({ memoryId: m.id, parentIds: [],
      newL1: { title: 'Protocol reviews', parentL2Ids: [], newL2Title: 'Engineering' } })) }; },
};
const input = { namespace, client: 'demo', eventId: 'capture-event', sessionId: 'session',
  messages: [{ id: 'source-message', role: 'user', content: 'Please use diagrams in protocol reviews.' }] };
const core = openMemoryCore({ path, model });
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
try {
  const result = ok(await core.capture(input));
  assert.equal(result.classification.status, 'applied');
  const { id } = result.admission.memories[0];
  const detail = ok(core.get({ namespace, memoryId: id }));
  assert.equal(detail.memory.filing.status, 'filed');
  assert.equal(detail.receipts[0].eventId, 'source-message');
  assert.equal(detail.receipts[0].excerpt, input.messages[0].content);
  assert.deepEqual(calls, ['extract', 'classify']);
  delete model.extract;
  delete model.classify;
  delete model.countTokens;
  assert.equal(ok(await core.capture(input)).duplicate, true);
  ok(core.forget({ namespace, memoryId: id, expectedRevision: detail.memory.revision }));
  assert.equal(ok(await core.capture(input)).duplicate, true);
  assert.deepEqual(ok(core.list({ namespace })).memories, []);
  console.log('PASS: capture → trusted receipts → filing → model-free replay → forget → no resurrection');
  console.log(`Synthetic database retained at ${path}`);
  console.log('Scripted models only: no semantic quality, provider, passive hook or MCP claim.');
} finally { core.close(); }
