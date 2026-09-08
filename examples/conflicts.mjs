import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openMemoryCore } from '../core/contract.mjs';

const namespace = { ownerId: 'synthetic-conflicts', scope: 'personal', projectId: null };
const path = join(mkdtempSync(join(tmpdir(), 'cairn-conflicts-demo-')), 'memory.sqlite');
const core = openMemoryCore({ path });
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
const receipt = (eventId, excerpt) => ({ client: 'demo', sessionId: 'session', eventId, role: 'user', excerpt });
const admit = (content, eventId, conflictHints = []) => ok(core.admit({ namespace,
  memory: { content, kind: 'preference' }, receipts: [receipt(eventId, content)], conflictHints }));
const inspect = (id) => ok(core.get({ namespace, memoryId: id }));
try {
  const first = admit('Use short written explanations.', 'first').memory;
  const second = admit('Use long narrated explanations.', 'second', [{
    memoryId: first.id, expectedRevision: first.revision, relation: 'contradicts' }]).memory;
  assert.deepEqual(inspect(first.id).conflicts, [{ memoryId: second.id,
    revision: second.revision, relation: 'contradicts', source: 'explicit-hint' }]);
  assert.equal(inspect(second.id).conflicts[0].memoryId, first.id);
  assert.equal(inspect(first.id).memory.content, 'Use short written explanations.');
  const changed = ok(core.correct({ namespace, memoryId: second.id,
    expectedRevision: second.revision, content: 'Use diagrams when useful.', kind: 'preference',
    receipt: receipt('correction', 'Use diagrams when useful.') })).memory;
  assert.deepEqual(inspect(first.id).conflicts, []);
  assert.deepEqual(inspect(second.id).conflicts, []);
  ok(core.forget({ namespace, memoryId: second.id, expectedRevision: changed.revision }));
  assert.equal(core.get({ namespace, memoryId: second.id }).ok, false);
  console.log('PASS: explicit hints → symmetric attributed inspection → correction invalidates → forget');
  console.log(`Synthetic database retained at ${path}`);
  console.log('Caller assertions only: no semantic contradiction detector or model service.');
} finally { core.close(); }
