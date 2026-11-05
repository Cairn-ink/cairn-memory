import test from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryCore } from '../index.mjs';
import { safetyFixture } from '../testing/content-safety-s2h-fixture.mjs';
import { migrateEventTime, ns, ok } from '../testing/receipt-event-time-fixture.mjs';
import { model } from '../testing/episode-capture-helpers.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';
import { options } from '../testing/episode-helpers.mjs';
import { readFileSync } from 'node:fs';

const firstTime = '2001-02-03T04:05:06.789Z', otherTime = '1901-02-03T04:05:06.789Z';
const input = (variant, occurredAt) => ({ namespace: ns, client: 'synthetic', eventId: 'event', sessionId: 'session',
  ...(variant === 'episode' ? { episodeContext: { clientLabel: 'Synthetic', generation: 'initial', origin: 'ordinary' } } : {}),
  messages: [{ id: 'message', role: 'user', content: 'Synthetic source', ...(occurredAt === undefined ? {} : { occurredAt }) }] });
const reference = JSON.parse(readFileSync(new URL('./fixtures/receipt-event-time-main.json', import.meta.url)));
function open(f, variant) {
  return openMemoryCore({ path: f.path, ...(variant === 'episode' ? options : {}), model: model(rationaleModel()) });
}
function receiptTimes(f) {
  const db = f.connect();
  try { return db.prepare('SELECT occurred_at FROM receipts ORDER BY receipt_key').all().map(r => r.occurred_at); }
  finally { db.close(); }
}
function duplicate(result, first) {
  const replay = ok(result);
  assert.equal(replay.duplicate, true);
  assert.deepEqual(replay.memoryIds, first.admission.memories.map(m => m.id));
  assert.equal(replay.suppressedCount, first.admission.suppressedCount);
}
for (const base of [18,23,33]) for (const safety of [false,true]) {
  const old = safety ? {18:34,23:38,33:48}[base] : base, target = {18:51,23:52,33:53}[base];
  for (const variant of ['ordinary','episode']) test(`identical ${variant} replay across ${old} -> ${target} retains ids, receipt count and null time`, async t => {
    const f = safetyFixture(t, base);
    if (safety) await f.migrate();
    let core = open(f, variant);
    let first;
    try { first = ok(await core.capture(input(variant, firstTime))); }
    finally { core.close(); }
    const before = f.connect();
    const receiptCount = before.prepare('SELECT count(*) n FROM receipts').get().n;
    const digests = before.prepare('SELECT payload_digest FROM admission_claims ORDER BY event_id').all();
    before.close();
    assert.equal(receiptCount, 1);
    // All handles are closed before the child-process backup and offline migration.
    await migrateEventTime(f);
    core = open(f, variant);
    try {
      duplicate(await core.capture(input(variant, firstTime)), first);
      assert.deepEqual(receiptTimes(f), [null]);
      const after = f.connect();
      try {
        assert.equal(after.prepare('SELECT count(*) n FROM receipts').get().n, receiptCount);
        assert.deepEqual(after.prepare('SELECT payload_digest FROM admission_claims ORDER BY event_id').all(), digests);
      } finally { after.close(); }
    } finally { core.close(); }
  });
  test(`ordinary untimed -> timed replay on ${target}, migration from ${old}, keeps null`, async t => {
    const f = safetyFixture(t, base);
    if (safety) await f.migrate();
    await migrateEventTime(f);
    const core = open(f, 'ordinary');
    try {
      const first = ok(await core.capture(input('ordinary')));
      duplicate(await core.capture(input('ordinary', firstTime)), first);
      assert.deepEqual(receiptTimes(f), [null]);
    } finally { core.close(); }
  });
  for (const variant of ['ordinary','episode']) test(`changed ${variant} time on ${target}, migration from ${old}, preserves main identity policy`, async t => {
    const f = safetyFixture(t, base);
    if (safety) await f.migrate();
    await migrateEventTime(f);
    const core = open(f, variant);
    try {
      const first = ok(await core.capture(input(variant, firstTime)));
      const replay = await core.capture(input(variant, otherTime));
      if (variant === 'ordinary') duplicate(replay, first);
      else {
        const expected = reference.replays[base + ':episode'];
        assert.equal(expected.ok, false);
        assert.equal(expected.code, 'event_payload_conflict');
        assert.equal(replay.ok, expected.ok);
        assert.equal(replay.error.code, expected.code);
      }
      assert.deepEqual(receiptTimes(f), [firstTime]);
    } finally { core.close(); }
  });
}
