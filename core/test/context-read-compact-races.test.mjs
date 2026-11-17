import test from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryCore, openContextReader } from '../index.mjs';
import { eventTimeSafetyFixture, ns, ok, receipt } from '../testing/receipt-event-time-fixture.mjs';
import { host } from '../testing/context-read-core-fixture.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';
import { transaction } from '../database.mjs';

for (const readOnly of [false, true]) for (const intent of ['current', 'history']) for (const mutation of ['suppressed', 'forgotten', 'denied'])
test(`compact hides candidate identity, source and date after ${mutation}, readOnly=${readOnly}, intent=${intent}`, async t => {
  const f = eventTimeSafetyFixture(t, 33); await f.migrate();
  const trusted = host(), db = f.connect(); t.after(() => db.close());
  const config = { version: 'context-read-v1', authority: trusted.authority, counter: { id: 'fit', countTokens: () => 1 } };
  const writer = openMemoryCore({ path: f.path, contextRead: config }); t.after(() => writer.close());
  const canary = 'PRIVATE_COMPACT_CANARY', secretDate = '1971-02-03T04:05:00.000Z';
  const target = ok(writer.admit({ namespace: ns, memory: { content: 'telescope ' + canary, kind: 'fact' },
    receipts: [{ ...receipt('secret', 'source ' + canary), occurredAt: secretDate }] })).memory;
  ok(writer.admit({ namespace: ns, memory: { content: 'telescope allowed', kind: 'fact' }, receipts: [receipt('allowed')] }));
  ok(await trusted.call(writer, 'refreshContextIndex', { readSet: [ns], types: ['memory'], intent: 'current', budget: { maxItems: 1024, maxMs: 5000 } }));
  if (mutation === 'suppressed') transaction(db, () => writeContentSuppressionInside(db,
    { namespace: ns, kind: 'memory', key: target.id, reason: 'purge', actionId: 'compact-secret' }));
  if (mutation === 'forgotten') ok(writer.forget({ namespace: ns, memoryId: target.id, expectedRevision: target.revision }));
  if (mutation === 'denied') trusted.state.enabled = false;
  // A read-only reader never reconciles the index itself: after a canonical write a writer read must reconcile first.
  if (readOnly && mutation !== 'denied') {
    let warm;
    for (let i = 0; i < 5 && !warm?.ok; i++) warm = await trusted.call(writer, 'contextRead',
      { readSet: [ns], types: ['memory'], intent, query: 'telescope', raw: false, deadlineMs: 5000 });
    assert.equal(warm.ok, true, JSON.stringify(warm));
  }
  const core = readOnly ? openContextReader({ path: f.path, contextRead: config }) : writer;
  if (readOnly) t.after(() => core.close());
  const result = await trusted.call(core, 'contextRead', { readSet: [ns], types: ['memory'], intent,
    query: 'telescope', raw: false, representation: 'memory-compact-v1', deadlineMs: 5000 });
  if (mutation === 'denied') assert.equal(result.ok, false);
  else { assert.equal(result.ok, true, JSON.stringify(result)); assert.ok(result.value.metered.items.some(item => item.body === 'telescope allowed')); }
  for (const forbidden of [canary, target.id, secretDate.slice(0, 16)]) assert.ok(!JSON.stringify(result).includes(forbidden));
});

for (const phase of ['counter', 'authority']) test(`compact ${phase} mutation fails fresh delivery without leaked identities`, async t => {
  const f = eventTimeSafetyFixture(t, 33); await f.migrate();
  const trusted = host(); let mutate;
  const counter = { id: 'mutating', countTokens() { if (phase === 'counter') { const work = mutate; mutate = null; work?.(); } return 1; } };
  const core = openMemoryCore({ path: f.path, contextRead: { version: 'context-read-v1', authority: trusted.authority, counter } });
  t.after(() => core.close());
  const memory = ok(core.admit({ namespace: ns, memory: { content: 'telescope PRIVATE_CALLBACK_CANARY', kind: 'fact' }, receipts: [receipt('secret')] })).memory;
  ok(await trusted.call(core, 'refreshContextIndex', { readSet: [ns], types: ['memory'], intent: 'current', budget: { maxItems: 1024, maxMs: 5000 } }));
  mutate = () => ok(core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
  if (phase === 'authority') trusted.state.hook = () => { const work = mutate; mutate = null; work?.(); };
  const result = await trusted.call(core, 'contextRead', { readSet: [ns], types: ['memory'], intent: 'current', query: 'telescope', raw: false,
    representation: 'memory-compact-v1', deadlineMs: 5000 });
  if (result.ok) assert.equal(result.value.metered.items.length, 0);
  else assert.ok(['snapshot_stale', 'index_unavailable', 'evidence_unavailable'].includes(result.error.code));
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_CALLBACK_CANARY/);
  assert.ok(!JSON.stringify(result).includes(memory.id));
});
