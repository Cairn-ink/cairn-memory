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

// Real canonical commits exercise both denial kinds and the connection-local
// version export; only the ring's synchronous cost is virtualized.
import { sourceFixture, ns, ok, request, splitRaw } from '../testing/raw-source-fixtures.mjs';
import { searchFixture, consumeRecentHints } from '../testing/raw-search-fixtures.mjs';
import { createRawSearchAuthority } from '../raw-search-authority.mjs';
import { openReadDatabase } from '../read-database.mjs';
import { openRawSearchStorage } from '../raw-search-storage.mjs';

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

test('missing version stays armed after a full lap and removes a later denial within 32 passes', async t => {
  const own = Object.getOwnPropertyDescriptor(performance, 'now'); let now = 0;
  Object.defineProperty(performance, 'now', { configurable: true, value: () => now });
  t.after(() => { if (own) Object.defineProperty(performance, 'now', own); else delete performance.now; });
  const f = sourceFixture(t);
  for (let i = 0; i < 32; i++) ok(await f.core.captureRaw(request(
    splitRaw('synthetic copper missing version '+i, { id: 'message-'+i, ordinal: 1 })[0],
    { sessionId: 'synthetic-'+i, eventId: 'synthetic-'+i })));
  const s = await searchFixture(f); await consumeRecentHints(f, s);
  for (let i = 0; i < 24; i++) { now += 1010; await s.maintain({ maxItems: 16, maxMs: 5000 }); }
  const reader = openReadDatabase(f.path, { contextRead: true });
  const authority = createRawSearchAuthority(reader, s.options);
  const storage = await openRawSearchStorage({ directory: s.directory, identity: authority.identity,
    bind: authority.bind, quotaBytes: 512*1024*1024 });
  assert.equal(storage.head().checkpoint.coverageComplete, true);
  assert.equal(storage.head().checkpoint.cleanup.afterSegment, 0);
  const { version, ...withoutVersion } = authority;
  assert.equal(typeof version, 'function');
  assert.equal(Object.hasOwn(withoutVersion, 'version'), false);
  let reads = 0, ring = false; const checked = new Set(), ringRemoved = new Set();
  const wrapped = { ...withoutVersion, disposition(source) {
    checked.add(JSON.stringify(source)); now += 1;
    const result = authority.disposition(source);
    if (ring && result === 'remove') ringRemoved.add(JSON.stringify(source));
    return result;
  } };
  const port = { ...storage, snapshot(input) { ring = input.limit === 1; if (ring) reads++; return storage.snapshot(input); } };
  const maintenance = createRawSearchMaintenance(port, wrapped, s.options);
  t.after(async () => { await maintenance.close(); await storage.close(); reader.db.close(); });
  const pass = async () => { now += 1010; await maintenance.maintain({ maxItems: 16, maxMs: 12 }, guard => guard?.()); };
  const rows = (await storage.snapshot({ limit: 64 })).rows;
  assert.equal(rows.length, 32);
  for (let i = 0; i < rows.length; i++) await pass();
  assert.equal(checked.size, rows.length, 'first full lap checks every existing row');
  assert.equal(storage.head().checkpoint.cleanup.afterSegment, 0, 'first full lap finished');
  const before = reads;
  for (let i = 0; i < 16; i++) await pass();
  assert.equal(reads - before, 16, 'missing version keeps reading ring snapshots after the first full lap');
  // This row is next in the ring, beyond the sweep's first page. Record the
  // ring's removal decision so a restarted sweep cannot satisfy the test.
  const old = rows[16];
  f.db.prepare('INSERT INTO raw_source_exclusions VALUES(?,?,?,?,1)').run(old.source.ref.conversationId,
    old.source.ref.messageId, old.source.ref.span.start, old.source.ref.span.end);
  let passes = 0;
  while ((await storage.lookup([old.key])).length && passes < 32) { await pass(); passes++; }
  assert.equal((await storage.lookup([old.key])).length, 0, 'missing-version ring removes a later denial within 32 passes');
  assert.ok(ringRemoved.has(JSON.stringify(old.source)), 'the ring decides removal before the sweep reaches the denied row');
  t.diagnostic(`missing version: 16 quiet snapshots; later denial removed in ${passes} passes; bound 32`);
});

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
