import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createRawSearchMaintenance } from '../raw-search-maintenance.mjs';
import { broker } from '../testing/raw-search-fixtures.mjs';

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
  const pass = async () => {
    now += 1010; checking = []; ring = false;
    const before = inventoryCalls;
    await maintenance.maintain({ maxItems: 16, maxMs: 12 }, guard => guard?.());
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

test('starvation: inventory advances on every reconciliation and completes within 16 passes', async t => {
  const f = fixture(t, { cost: 1 }); await f.reopen();
  let passes = 0;
  while (!f.checkpoint().coverageComplete && passes < 16) {
    assert.equal(await f.pass(), 1, 'ring must leave inventory a share on every non-overrun pass'); passes++;
  }
  assert.equal(f.checkpoint().coverageComplete, true, 'quiet coverage bound is 16 reconciliation passes');
  t.diagnostic(`quiet coverage: ${passes} passes; bound 16`);
});

test('quiet store: 32 further passes cost zero ring snapshots and dispositions', async t => {
  const f = fixture(t); await f.reopen(); await f.idle();
  assert.equal(f.checkpoint().coverageComplete, true);
  const before = f.counts();
  for (let i = 0; i < 32; i++) await f.pass();
  assert.equal(f.counts().ringReads - before.ringReads, 0, 'idle ring performs zero snapshots');
  assert.equal(f.counts().ringChecks - before.ringChecks, 0, 'idle ring performs zero dispositions');
});

test('restart: partial resumed lap cannot idle before a complete lap from zero', async t => {
  const f = fixture(t, { count: 8, after: 6, complete: true }); await f.reopen();
  const checked = new Set();
  for (let i = 0; i < 16; i++) { await f.pass(); f.lastChecks().forEach(id => checked.add(id)); }
  assert.deepEqual([...checked].sort((a, b) => a - b), [1,2,3,4,5,6,7,8], 'restart must check the skipped prefix');
  const before = f.counts(); await f.pass();
  assert.equal(f.counts().ringReads, before.ringReads, 'full stable lap idles the new instance');
  await f.reopen(); await f.pass();
  assert.ok(f.counts().ringReads > before.ringReads, 'a new authority lifetime must not inherit idle');
});

test('denial in the last disposition repeats the lap and removes an already checked row', async t => {
  const f = fixture(t, { count: 4, complete: true }); await f.reopen();
  let moved = false;
  f.hook(id => { if (id === 4 && !moved) { moved = true; f.denied.add(1); f.commit(); } });
  for (let i = 0; i < 4; i++) await f.pass();
  assert.equal(moved, true);
  assert.ok(f.events.findLastIndex(event => event.kind === 'version') >
    f.events.findLastIndex(event => event.kind === 'disposition' && event.id === 4),
  'lap-end version must be read strictly after the final disposition');
  for (let i = 0; i < 6; i++) await f.pass();
  assert.equal(f.rows.some(row => row.source.id === 1), false, 'end version must follow the last disposition');
});

test('start version precedes the first disposition, including the first pass after idle', async t => {
  const f = fixture(t, { count: 4, complete: true }); await f.reopen(); await f.idle();
  f.commit(); let moved = false;
  f.hook(id => { if (id === 1 && !moved) { moved = true; f.denied.add(1); f.commit(); } });
  for (let i = 0; i < 10; i++) await f.pass();
  assert.equal(f.rows.some(row => row.source.id === 1), false, 'a denial during first check requires another lap');
});

for (const cost of [1, 13]) test(`version moves every pass: ${cost} ms dispositions complete within 32 passes`, async t => {
  const f = fixture(t, { cost }); await f.reopen(); let passes = 0, lastAdvanced = true;
  while (!f.checkpoint().coverageComplete && passes < 32) {
    f.commit(); const advanced = Boolean(await f.pass());
    if (cost === 1) assert.equal(advanced, true);
    else assert.ok(advanced || lastAdvanced, 'an overrun must leave the next turn for inventory');
    lastAdvanced = advanced; passes++;
  }
  assert.equal(f.checkpoint().coverageComplete, true, 'always-armed coverage bound is 32 reconciliation passes');
  t.diagnostic(`always-armed ${cost} ms: ${passes} passes; bound 32`);
});

test('snapshot cost counts against the share, but one row is always admitted', async t => {
  const f = fixture(t, { count: 8, snapshotCost: 4 }); await f.reopen();
  await f.pass(); assert.equal(f.lastChecks().length, 1, 'one admitted row after a slow snapshot');
  await f.pass(); assert.equal(f.lastChecks().length, 0, 'snapshot overrun also skips the next ring turn');
});

// Real canonical commits exercise both denial kinds and the connection-local
// version export; only the ring's synchronous cost is virtualized.
import { sourceFixture, ns, ok, request, splitRaw } from '../testing/raw-source-fixtures.mjs';
import { searchFixture, consumeRecentHints } from '../testing/raw-search-fixtures.mjs';
import { createRawSearchAuthority } from '../raw-search-authority.mjs';
import { openReadDatabase } from '../read-database.mjs';
import { openRawSearchStorage } from '../raw-search-storage.mjs';

for (const denial of ['exclusion', 'delete']) test(`idle ring re-arms for ${denial} and removes deep residue during saves`, async t => {
  const own = Object.getOwnPropertyDescriptor(performance, 'now'); let now = 0;
  Object.defineProperty(performance, 'now', { configurable: true, value: () => now });
  t.after(() => { if (own) Object.defineProperty(performance, 'now', own); else delete performance.now; });
  const f = sourceFixture(t);
  const save = async i => ok(await f.core.captureRaw(request(splitRaw('synthetic copper '+i, { id: 'message-'+i, ordinal: 1 })[0],
    { sessionId: 'synthetic-'+i, eventId: 'synthetic-'+i })));
  for (let i = 0; i < 32; i++) await save(i);
  const s = await searchFixture(f); await consumeRecentHints(f, s);
  const reader = openReadDatabase(f.path, { contextRead: true });
  const authority = createRawSearchAuthority(reader, s.options);
  const storage = await openRawSearchStorage({ directory: s.directory, identity: authority.identity, bind: authority.bind, quotaBytes: 512*1024*1024 });
  let ring = false, checks = 0, reads = 0, inventories = 0;
  const wrapped = { ...authority, disposition(source) { if (ring) { checks++; now += 1; } return authority.disposition(source); },
    inventory(...args) { inventories++; return authority.inventory(...args); } };
  const port = { ...storage, async snapshot(input) { ring = input.limit === 1; if (ring) reads++; return storage.snapshot(input); } };
  const maintenance = createRawSearchMaintenance(port, wrapped, s.options);
  t.after(async () => { await maintenance.close(); await storage.close(); reader.db.close(); });
  const pass = async (maxMs = 12) => { now += 1010; await maintenance.maintain({ maxItems: 16, maxMs }, guard => guard?.()); };
  for (let i = 0; i < 24; i++) await pass(5000);
  assert.equal(storage.head().checkpoint.coverageComplete, true);
  for (let i = 0; i < 70; i++) await pass();
  const quiet = { checks, reads }; for (let i = 0; i < 8; i++) await pass();
  assert.deepEqual({ checks, reads }, quiet, 'real quiet authority must idle before denial');
  const old = (await storage.snapshot({ limit: 128 })).rows.at(-1); assert.ok(old.segment >= 24);
  const version = authority.version();
  if (denial === 'exclusion') f.db.prepare('INSERT INTO raw_source_exclusions VALUES(?,?,?,?,1)').run(
    old.source.ref.conversationId, old.source.ref.messageId, old.source.ref.span.start, old.source.ref.span.end);
  else ok(f.core.deleteConversation({ namespace: ns, conversationId: old.source.ref.conversationId,
    expectedRevision: f.db.prepare('SELECT revision FROM raw_conversations WHERE id=?').get(old.source.ref.conversationId).revision,
    actionId: 'synthetic-delete' }));
  assert.notEqual(authority.version(), version, 'canonical denial changes the reader version');
  const before = inventories; let removed = false, passes = 0;
  for (; passes < 160; passes++) {
    await save(1000 + passes); await pass();
    if (!(await storage.lookup([old.key])).length) { removed = true; break; }
  }
  assert.equal(removed, true, 'deep denied row removed within 160 passes despite continuous saves');
  assert.ok(storage.tail() > old.segment, 'recent inventory continues publishing during these same saves');
  t.diagnostic(`${denial}: residue removed in ${passes + 1} passes; bound 160`);
});

for (const denial of ['exclusion', 'delete']) test(`re-arm model: ${denial} residue and inventory advance during commits`, async t => {
  const f = fixture(t, { count: 64 }); await f.reopen(); await f.idle();
  f.denied.add(60); f.commit(); f.invalidateInventory();
  const before = f.counts();
  for (let i = 0; i < 64 && f.rows.some(row => row.source.id === 60); i++) {
    f.commit();
    await f.pass();
  }
  assert.equal(f.rows.some(row => row.source.id === 60), false, 're-armed ring reaches deep residue within 64 turns');
  assert.ok(f.counts().inventoryCalls > before.inventoryCalls);
});
