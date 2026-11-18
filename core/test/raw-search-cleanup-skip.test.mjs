import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createRawSearchMaintenance } from '../raw-search-maintenance.mjs';
import { broker } from '../testing/raw-search-fixtures.mjs';
import { sourceFixture, ok, request, splitRaw } from '../testing/raw-source-fixtures.mjs';
import { searchFixture, consumeRecentHints } from '../testing/raw-search-fixtures.mjs';
import { createRawSearchAuthority } from '../raw-search-authority.mjs';
import { openReadDatabase } from '../read-database.mjs';
import { openRawSearchStorage } from '../raw-search-storage.mjs';

// Explicit ports model canonical commits and signed sidecar cursors. No wall
// time participates in either a pass bound or an assertion.
let serial = 0;
function fixture(t, { count = 64, cost = 1, snapshotCost = 0, after = 0, complete = false } = {}) {
  const own = Object.getOwnPropertyDescriptor(performance, 'now');
  let now = 0, version = 1, ringReads = 0, ringChecks = 0, inventoryCalls = 0, ring = false;
  let hook = () => {}, checking = [], lastChecks = [];
  const events = [];
  Object.defineProperty(performance, 'now', { configurable: true, value: () => now });
  t.after(() => { if (own) Object.defineProperty(performance, 'now', own); else delete performance.now; });
  const rows = Array.from({ length: count }, (_, i) => ({ segment: i + 1, key: JSON.stringify(['synthetic', String(i + 1), 0]),
    fingerprint: 'same', source: { id: i + 1 } }));
  const denied = new Set();
  let checkpoint = { after: ['', '', -1], cycles: 0, cycleFence: 'stable', denialsReconciled: true,
    cleanup: { afterSegment: after, throughSegment: count }, ...(complete ? { coverageComplete: true, fence: 'stable' } : {}) };
  const storage = {
    head: () => ({ checkpoint }), tail: () => count,
    async snapshot({ after = 0, limit }) {
      ring = true; ringReads++; now += snapshotCost;
      const remaining = rows.filter(row => row.segment > after);
      events.push({ kind: 'snapshot', limit });
      return { rows: remaining.slice(0, limit), partial: remaining.length > limit };
    },
    lookup: async keys => rows.filter(row => keys.includes(row.key)),
    async commitBatch(batch) {
      checkpoint = batch.checkpoint;
      const removed = rows.filter(row => batch.remove?.includes(row.segment));
      for (const row of removed) rows.splice(rows.indexOf(row), 1);
      return { removed: removed.length };
    },
  };
  const authority = {
    identity: { storeId: 'synthetic-budget', fileIdentity: String(++serial) },
    version: () => { events.push({ kind: 'version', version }); return version; },
    recent: cursor => ({ cursor, rows: [] }), fence: () => 'stable',
    disposition(source) {
      assert.equal(ring, true, 'fixture isolates the ring from the completed denial sweep');
      ringChecks++; checking.push(source.id); now += cost;
      const result = denied.has(source.id) ? 'remove' : 'allowed';
      hook(source.id); events.push({ kind: 'disposition', id: source.id }); return result;
    },
    inventory(after, limit) {
      ring = false; inventoryCalls++;
      const start = Number(after[1]) || 0;
      const entries = Array.from({ length: Math.min(limit, count - start) }, (_, i) => {
        const id = start + i + 1;
        return { key: ['synthetic', String(id), 0], source: { id } };
      });
      // Omit denied canonical sources so only the ring removes old index rows.
      return { rows: entries.filter(entry => !denied.has(entry.source.id)), complete: start + entries.length === count };
    },
    fingerprint: () => 'same',
  };
  let maintenance;
  const reopen = async () => {
    await maintenance?.close();
    maintenance = createRawSearchMaintenance(storage, authority, { maintenanceTurn: broker() });
  };
  t.after(() => maintenance.close());
  const pass = async (maxMs = 12) => {
    now += 1010; checking = []; ring = false;
    const before = inventoryCalls;
    await maintenance.maintain({ maxItems: 16, maxMs }, guard => guard?.());
    lastChecks = checking;
    return inventoryCalls - before;
  };
  return { reopen, pass, rows, denied, events, checkpoint: () => checkpoint, lastChecks: () => lastChecks,
    counts: () => ({ ringReads, ringChecks, inventoryCalls }),
    commit() { version++; },
    invalidateInventory() { checkpoint.coverageComplete = false; checkpoint.after = ['', '', -1]; }, hook(fn) { hook = fn; },
    async idle() {
      // A complete lap from zero must fit even with alternate-turn overruns.
      for (let i = 0; i < count * 2 + 4; i++) await pass();
      const before = this.counts(); await pass();
      assert.deepEqual(this.counts().ringReads, before.ringReads, 'completed stable lap must idle');
    },
  };
}

test('multi-row cleanup stops exactly at the quarter-share boundary', async t => {
  const f = fixture(t, { count: 8, cost: 2 }); await f.reopen();
  assert.equal(await f.pass(32), 1, 'inventory advances at an exact share');
  assert.deepEqual(f.lastChecks(), [1, 2, 3, 4], 'four dispositions exhaust the 8 ms share');
  assert.equal(f.checkpoint().cleanup.afterSegment, 4);
  await f.pass(32);
  assert.deepEqual(f.lastChecks(), [5, 6, 7, 8], 'an exact share resumes without skipping a turn');
});

test('ring snapshot limit changes from one row at 25 ms to a full page at 26 ms', async t => {
  const f = fixture(t, { count: 32, cost: 0 }); await f.reopen();
  await f.pass(25);
  await f.pass(26);
  assert.deepEqual(f.events.filter(event => event.kind === 'snapshot').map(event => event.limit),
    [1, 16], '25 ms reads one row while 26 ms requests the normal page');
});

test('ring time guard stops inside the snapshot cap', async t => {
  const f = fixture(t, { count: 32, cost: 4 }); await f.reopen();
  await f.pass(26);
  assert.equal(f.events.find(event => event.kind === 'snapshot').limit, 16);
  assert.deepEqual(f.lastChecks(), [1, 2], 'the next disposition must wait after 8 ms exceeds the 6.5 ms share');
  assert.equal(f.checkpoint().cleanup.afterSegment, 2);
});

async function realRing(t) {
  const own = Object.getOwnPropertyDescriptor(performance, 'now');
  let now = 0, ring = false;
  Object.defineProperty(performance, 'now', { configurable: true, value: () => now });
  t.after(() => { if (own) Object.defineProperty(performance, 'now', own); else delete performance.now; });
  const f = sourceFixture(t);
  for (const id of [1, 2]) ok(await f.core.captureRaw(request(
    splitRaw('synthetic copper lap '+id, { id: 'message-'+id, ordinal: 1 })[0],
    { sessionId: 'synthetic-'+id, eventId: 'synthetic-'+id })));
  const s = await searchFixture(f);
  await consumeRecentHints(f, s);
  now += 1010;
  await s.maintain({ maxItems: 16, maxMs: 5000 });

  const reader = openReadDatabase(f.path, { contextRead: true });
  const authority = createRawSearchAuthority(reader, s.options);
  f.workspace.defer(() => reader.db.close());
  const storage = await openRawSearchStorage({ directory: s.directory, identity: authority.identity,
    bind: authority.bind, quotaBytes: 512*1024*1024 });
  f.workspace.defer(() => storage.close());
  const { rows } = await storage.snapshot({ limit: 16 });
  assert.equal(rows.length, 2);
  assert.equal(storage.head().checkpoint.coverageComplete, true);

  const snapshots = [], dispositions = [];
  const on = { version() {}, tail() {}, fence() {}, disposition() {} };
  const maintenance = createRawSearchMaintenance({ ...storage,
    snapshot(input) {
      ring = input.limit === 1;
      if (ring) snapshots.push(input.after);
      return storage.snapshot(input);
    },
    tail() { on.tail(); return storage.tail(); },
  }, { ...authority,
    version() { on.version(); return authority.version(); },
    fence(...args) { on.fence(); return authority.fence(...args); },
    disposition(source) {
      const result = authority.disposition(source);
      if (ring) {
        dispositions.push({ source, result });
        on.disposition();
      }
      return result;
    },
  }, s.options);
  f.workspace.defer(() => maintenance.close());
  return { f, rows, storage, snapshots, dispositions, on, spend(ms) { now += ms; },
    pass() {
      now += 1010;
      ring = false;
      return maintenance.maintain({ maxItems: 16, maxMs: 12 }, guard => guard?.());
    },
  };
}

function assertIdle(result) {
  assert.equal(result.phase, 'idle');
  assert.equal(result.error, null);
  assert.equal(result.noProgress, 0);
}

for (const { name, at, fields, cost } of [
  { name: 'over-budget canonical lap-end contention skips the next ring turn', at: 'version', fields: { code: 'source_busy' }, cost: 13 },
  { name: 'over-budget sidecar lap-end contention skips the next ring turn', at: 'tail', fields: { code: 'ERR_SQLITE_ERROR', errcode: 5 }, cost: 13 },
  { name: 'under-budget canonical lap-end contention leaves the next ring turn armed', at: 'version', fields: { code: 'source_busy' }, cost: 1 },
]) test(name, async t => {
  const r = await realRing(t);
  const [first, last] = r.rows;
  const before = r.storage.head();
  // Finish a persisted partial lap so a stable version cannot idle the ring.
  await r.storage.commitBatch({ checkpoint: { ...before.checkpoint, coverageComplete: false,
    cleanup: { afterSegment: first.segment, throughSegment: last.segment } } });
  const checkpoint = r.storage.head();
  let faults = 0;
  r.on[at] = () => {
    if (r.dispositions.length === 1 && faults === 0) {
      faults++;
      throw Object.assign(new Error('injected lap-end contention'), fields);
    }
  };
  r.on.disposition = () => r.spend(cost);
  assertIdle(await r.pass());
  assert.equal(faults, 1);
  assert.deepEqual(r.dispositions, [{ source: last.source, result: 'allowed' }]);
  assert.deepEqual(r.storage.head(), checkpoint, 'the transient pass discards its checkpoint');

  r.on.disposition = () => {};
  const reads = r.snapshots.length;
  assertIdle(await r.pass());
  if (cost > 3) {
    assert.equal(r.snapshots.length - reads, 0, 'the next turn must make zero ring snapshot reads');
    assert.equal(r.storage.head().checkpoint.coverageComplete, true, 'inventory completes on the ring hand-off');
    assertIdle(await r.pass());
    assert.equal(r.snapshots.length - reads, 1, 'the hand-off lasts one reconciliation turn');
  } else {
    assert.equal(r.snapshots.length - reads, 1, 'an under-budget fault must leave the next ring read armed');
  }
});

test('a transient start-version failure preserves the cursor and the ring resumes', async t => {
  const r = await realRing(t);
  assertIdle(await r.pass());
  const [first, last] = r.rows;
  const checkpoint = r.storage.head();
  assert.equal(checkpoint.checkpoint.cleanup.afterSegment, first.segment);
  r.on.version = () => {
    r.on.version = () => {};
    throw Object.assign(new Error('injected start-version contention'), { code: 'source_busy' });
  };
  assertIdle(await r.pass());
  assert.deepEqual(r.snapshots, [0], 'the failure precedes the next snapshot');
  assert.deepEqual(r.storage.head(), checkpoint);
  assertIdle(await r.pass());
  assert.deepEqual(r.snapshots, [0, first.segment]);
  assert.deepEqual(r.dispositions.map(entry => entry.source), [first.source, last.source]);
  assert.equal(r.storage.head().checkpoint.cleanup.afterSegment, 0);
});

test('a missing fence re-arms an idle ring without a canonical version change', async t => {
  const r = await realRing(t);
  await r.pass(); await r.pass(); await r.pass();
  assert.deepEqual(r.snapshots, [0, r.rows[0].segment], 'the stable ring is idle');
  r.on.fence = () => { throw Object.assign(new Error('injected unavailable fence'), { code: 'source_budget_exceeded' }); };
  assertIdle(await r.pass());
  assert.deepEqual(r.snapshots, [0, r.rows[0].segment, 0], 'the missing fence restarts the ring from zero');
});

test('the ring removes a denied row and makes zero snapshot reads over 16 quiet passes', async t => {
  const r = await realRing(t);
  await r.pass(); await r.pass(); await r.pass();
  const reads = r.snapshots.length;
  assert.equal(reads, 2, 'the ring is idle before the denial');
  const [old] = r.rows;
  const ref = old.source.ref;
  r.f.db.prepare('INSERT INTO raw_source_exclusions VALUES(?,?,?,?,1)').run(
    ref.conversationId, ref.messageId, ref.span.start, ref.span.end);
  assertIdle(await r.pass());
  assert.deepEqual(r.dispositions.at(-1), { source: old.source, result: 'remove' });
  assert.deepEqual(await r.storage.lookup([old.key]), []);
  assertIdle(await r.pass());
  assert.equal(r.snapshots.length - reads, 2, 'the ring finishes the re-armed lap');
  const quiet = r.snapshots.length;
  for (let i = 0; i < 16; i++) assertIdle(await r.pass());
  assert.equal(r.snapshots.length - quiet, 0, 'a settled denial leaves the ring idle');
});
