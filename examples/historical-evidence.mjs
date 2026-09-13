import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openMemoryCore } from '../core/contract.mjs';

// Synthetic explicit changes demonstrate evidence access, not semantic detection,
// event-time queries or generated explanations. No provider or model generation.
const namespace = { ownerId: 'synthetic-history-demo', scope: 'personal', projectId: null };
const path = join(mkdtempSync(join(tmpdir(), 'cairn-history-demo-')), 'memory.sqlite');
const model = { countTokens: (text) => Math.ceil(text.length / 4) };
const core = openMemoryCore({ path, model });
const ok = (result) => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const receipt = (eventId, excerpt) => ({ client: 'synthetic', sessionId: 'demo', eventId, role: 'user', excerpt });
try {
  const original = ok(core.admit({ namespace, memory: { content: 'Review day is Friday.', kind: 'fact' },
    receipts: [receipt('initial', 'I choose Friday for the review.')] })).memory;
  const current = ok(core.supersede({ namespace, memoryId: original.id, expectedRevision: original.revision,
    replacement: { content: 'Review day is Monday.', kind: 'fact' },
    receipts: [receipt('update', 'Move the review to Monday because the team is unavailable Friday.')] })).memory;
  const historical = ok(core.list({ namespace, states: ['historical'] }));
  assert.equal(historical.memories.length, 1);
  const refs = historical.memories.map(({ id, revision }) => ({ memoryId: id, revision }));
  const retained = ok(core.fetch({ namespace, refs, view: 'historical' }));
  assert.equal(retained.items[0].memory.content, 'Review day is Friday.');
  assert.equal(retained.items[0].supersession.replacement.memoryId, current.id);
  assert.deepEqual(ok(core.fetch({ namespace, refs })).items, []);
  const successor = ok(core.fetch({ namespace, refs: [{ memoryId: current.id, revision: current.revision }] }));
  const bound = new Set(retained.items[0].supersession.receiptIds);
  const updateEvidence = successor.items[0].receipts.filter(({ id }) => bound.has(id));
  assert.equal(updateEvidence.length, 1);
  console.log(JSON.stringify({ demonstration: 'Explicit retained evidence; no as-of or generated rationale',
    historical: retained.items[0].memory.content, current: successor.items[0].memory.content,
    sourceStatedReason: updateEvidence[0].excerpt }, null, 2));
} finally { core.close(); }
