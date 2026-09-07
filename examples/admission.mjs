import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openMemoryCore } from '../core/contract.mjs';

const namespace = { ownerId: 'synthetic-demo', scope: 'personal', projectId: null };
const content = 'Use diagrams when explaining protocol transitions.';
const source = { client: 'demo', sessionId: 'session', eventId: 'event', role: 'user', excerpt: content };
const payloadDigest = createHash('sha256').update(JSON.stringify({ messages: [source] })).digest('hex');
const key = { namespace, client: 'demo', eventId: 'event', payloadDigest };
const path = join(mkdtempSync(join(tmpdir(), 'cairn-admission-demo-')), 'memory.sqlite');
const core = openMemoryCore({ path });
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
try {
  const { token } = ok(core.claimAdmission({ ...key, leaseMs: 125000 }));
  assert.deepEqual(ok(core.claimAdmission({ ...key, leaseMs: 125000 })), { processing: true });
  const saved = ok(core.finishAdmission({ ...key, token,
    items: [{ content, kind: 'instruction', confidence: 0.9, receipts: [source] }] }));
  const memory = saved.memories[0];
  const inspected = ok(core.get({ namespace, memoryId: memory.id }));
  assert.equal(inspected.memory.origin, 'agent-inferred');
  assert.equal(inspected.receipts[0].excerpt, content);
  assert.deepEqual(ok(core.claimAdmission({ ...key, leaseMs: 125000 })), {
    duplicate: true, memoryIds: [memory.id], suppressedCount: 0,
  });
  ok(core.forget({ namespace, memoryId: memory.id, expectedRevision: memory.revision }));
  assert.equal(ok(core.claimAdmission({ ...key, leaseMs: 125000 })).duplicate, true);
  assert.deepEqual(ok(core.list({ namespace })).memories, []);
  const next = { ...key, eventId: 'new-event' };
  const fresh = ok(core.claimAdmission({ ...next, leaseMs: 125000 }));
  const suppressed = ok(core.finishAdmission({ ...next, token: fresh.token,
    items: [{ content, kind: 'instruction', confidence: 0.9, receipts: [source] }] }));
  assert.deepEqual(suppressed.memories, []);
  assert.equal(suppressed.suppressedCount, 1);
  console.log('PASS: claim → processing → inferred commit → duplicate → forget → replay suppressed');
  console.log(`Synthetic database retained at ${path}`);
  console.log('Storage lifecycle only: handcrafted trusted items, no extraction model or MCP.');
} finally { core.close(); }
