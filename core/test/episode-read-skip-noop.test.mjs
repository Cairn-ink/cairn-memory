import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { createMemoryCore } from '../contract.mjs';
import { openDatabase } from '../database.mjs';
import { createEpisodeReadProjection } from '../episode-reads.mjs';
import { createEpisodeStorage } from '../episode-storage.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { createExclusiveSqliteFile } from '../sqlite-journal-probe.mjs';
import { measureContentRead } from '../testing/content-safety-cost-meter.mjs';
import { safetyFixture } from '../testing/content-safety-s2h-fixture.mjs';
import { batch, ns, ok, options } from '../testing/episode-helpers.mjs';
import { eventTimeSafetyFixture } from '../testing/receipt-event-time-fixture.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const start = Date.parse('2026-06-01T00:00:00.000Z');
const expiry = start + 86_400_000;
const range = {
  namespace: ns, timeBasis: 'receipt', limit: 1,
  since: new Date(start - 1_000).toISOString(), until: new Date(expiry + 1_000).toISOString(),
};
const pages = Object.fromEntries(['source', 'memory', 'policy', 'keep'].map(name => [name, { limit: 20 }]));

function open(workspace, path, layout) {
  let db, runtime;
  const core = createMemoryCore({ path, ...options }, {
    createRuntime(input) {
      runtime = createMemoryRuntime(input, { attachRaw(connection) { db = connection; } });
      return runtime;
    },
  });
  workspace.defer(() => core.close());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, layout);
  return { workspace, path, core, runtime, db };
}

async function fixture(t, layout) {
  if (layout === 29) {
    const workspace = createTestWorkspace(t);
    const path = join(workspace.path, 'store.sqlite');
    openDatabase(path, { localControls: true }).close();
    return open(workspace, path, layout);
  }
  const seed = (layout === 48 ? safetyFixture : eventTimeSafetyFixture)(t, 33);
  await seed.migrate();
  return open(seed.workspace, seed.path, layout);
}

function copyFixture({ db, workspace }, layout) {
  // Clone the seed with SQLite so both histories share IDs and cursor keys.
  const path = join(workspace.path, 'old-touch.sqlite');
  createExclusiveSqliteFile(path);
  db.prepare('VACUUM INTO ?').run(path);
  return open(workspace, path, layout);
}

function read({ core, runtime }, entry, episodeId) {
  return entry === 'contract'
    ? ok(core.getEpisode({ namespace: ns, episodeId }))
    : runtime.getEpisode(ns, { episodeId }, pages);
}

function watermark({ db }) {
  return db.prepare('SELECT watermark FROM staged_capture_clocks').get()?.watermark;
}

function episodeState({ db }, episodeId) {
  return {
    epoch: db.prepare('SELECT epoch FROM namespace_epochs').get().epoch,
    ...db.prepare('SELECT revision, updated_at FROM session_episodes WHERE id=?').get(episodeId),
    staged: db.prepare('SELECT event_id,state FROM staged_capture_evidence ORDER BY event_id').all(),
  };
}

async function meter({ db }, variant, call) {
  const changes = db.prepare('SELECT total_changes() AS n');
  const before = changes.get().n;
  const { result, statements, sql } = await measureContentRead('getEpisode', variant, call);
  return {
    result, statements,
    dml: sql.filter(([query]) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(query))
      .reduce((sum, [, count]) => sum + count, 0),
    delta: changes.get().n - before,
    begins: sql.filter(([query]) => /^\s*BEGIN\b/i.test(query)),
  };
}

function assertNoWrites({ dml, delta, begins }) {
  assert.deepEqual({ dml, delta, begins }, { dml: 0, delta: 0, begins: [['BEGIN IMMEDIATE', 1]] });
}

function assertSameOutput(actual, expected) {
  assert.deepEqual(actual, expected);
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
}

for (const layout of [29, 48, 53]) for (const entry of ['contract', 'runtime']) {
  test(`layout ${layout} ${entry} detail with a clock row and nothing due`, async t => {
    const f = await fixture(t, layout);
    t.mock.timers.enable({ apis: ['Date'], now: start });
    const { episodeId } = f.runtime.reserveEpisodeBatch(ns, batch());
    assert.equal(watermark(f), start);
    t.mock.timers.setTime(start + 5);
    const measured = await meter(f, entry, () => read(f, entry, episodeId));
    t.diagnostic(JSON.stringify({
      layout, entry, statements: measured.statements, dml: measured.dml, delta: measured.delta,
      begins: measured.begins,
    }));
    assert.equal(measured.result.episode.id, episodeId);
    assertNoWrites(measured);
  });

  test(`layout ${layout} ${entry} detail with no clock row`, async t => {
    const f = await fixture(t, layout);
    t.mock.timers.enable({ apis: ['Date'], now: start });
    const { episodeId } = f.runtime.reserveEpisodeBatch(ns, batch());
    f.db.prepare('DELETE FROM staged_capture_clocks').run();
    t.mock.timers.setTime(expiry);
    const measured = await meter(f, entry, () => read(f, entry, episodeId));
    assert.equal(measured.result.episode.id, episodeId);
    assert.equal(measured.result.episode.processing.expired, 0);
    assertNoWrites(measured);
    assert.equal(watermark(f), undefined);
  });

  test(`layout ${layout} ${entry} expiry and repeat match the existing touch history`, async t => {
    const f = await fixture(t, layout);
    t.mock.timers.enable({ apis: ['Date'], now: start });
    const first = batch('first');
    const { episodeId } = f.runtime.reserveEpisodeBatch(ns, first);
    assert.equal(f.runtime.reserveEpisodeBatch(ns, batch('second')).episodeId, episodeId);
    const other = batch('other', 'Synthetic second Episode', 'other-session');
    assert.notEqual(f.runtime.reserveEpisodeBatch(ns, other).episodeId, episodeId);
    const { client, eventId, payloadDigest, view } = { ...batch('plain'), client: 'other-client' };
    assert.ok(f.runtime.claimCaptureEvidence(ns, { client, eventId, payloadDigest, view, leaseMs: 125_000 }).token);
    f.db.prepare("UPDATE staged_capture_evidence SET expires_at=? WHERE event_id='other'").run(expiry + 5);

    const twin = copyFixture(f, layout);
    const initial = episodeState(f, episodeId);
    const cursor = ok(f.core.listEpisodes(range)).nextCursor;
    assert.equal(typeof cursor, 'string');
    assert.equal(ok(twin.core.listEpisodes(range)).nextCursor, cursor);

    t.mock.timers.setTime(expiry);
    // This unchanged staged-evidence entry executes the original touch with the
    // runtime's Episode hooks. Meter it before reading the resulting detail.
    const old = await meter(twin, 'old-touch', () => twin.runtime.inspectCaptureEvidence(ns, first));
    const expected = read(twin, entry, episodeId);
    const actual = await meter(f, entry, () => read(f, entry, episodeId));
    assertSameOutput(actual.result, expected);
    assert.equal(actual.delta, old.delta);
    assert.equal(actual.delta, 12);
    assert.equal(actual.dml, old.dml);
    assert.deepEqual(actual.begins, [['BEGIN IMMEDIATE', 1]]);
    const policies = actual.result.policies.items ?? actual.result.policies;
    assert.deepEqual(policies.map(p => [p.position, p.eventId, p.staging, p.gap, p.gapReasons]), [
      [1, 'first', 'expired', 'expired', ['expired']],
      [2, 'second', 'expired', 'expired', ['expired']],
    ]);
    const state = episodeState(f, episodeId);
    assert.deepEqual(state, episodeState(twin, episodeId));
    assert.equal(state.epoch, initial.epoch + 2);
    assert.equal(state.revision, initial.revision + 2);
    assert.equal(state.revision, actual.result.episode.revision);
    assert.equal(state.updated_at, new Date(expiry).toISOString());
    assert.equal(state.updated_at, actual.result.episode.updatedAt);
    assert.deepEqual(state.staged.map(row => [row.event_id, row.state]), [
      ['first', 'expired'], ['other', 'pending'], ['plain', 'expired'], ['second', 'expired'],
    ]);

    const repeat = await meter(f, entry, () => read(f, entry, episodeId));
    assertSameOutput(repeat.result, actual.result);

    const continuation = { ...range, cursor };
    const continued = f.core.listEpisodes(continuation);
    assertSameOutput(continued, twin.core.listEpisodes(continuation));
    assert.equal(continued.error?.code, 'cursor_stale');
    const forget = { namespace: ns, episodeId, expectedRevision: actual.result.episode.revision };
    const forgotten = f.core.forgetEpisode(forget);
    assertSameOutput(forgotten, twin.core.forgetEpisode(forget));
    assert.equal(ok(forgotten).forgotten, true);
    assertNoWrites(repeat);
  });
}

test('Episode detail expires and withholds evidence that becomes due between reads', async t => {
  const f = await fixture(t, 53);
  t.mock.timers.enable({ apis: ['Date'], now: start });
  const input = batch('crossing', 'Synthetic evidence with an expiry boundary');
  const { episodeId } = f.runtime.reserveEpisodeBatch(ns, input);
  const otherNs = { ...ns, projectId: 'other-project' };
  f.runtime.reserveEpisodeBatch(otherNs, batch('other-namespace'));
  f.db.prepare('UPDATE staged_capture_evidence SET expires_at=? WHERE event_id=?')
    .run(expiry - 1, 'other-namespace');
  const twin = copyFixture(f, 53);
  const row = f.db.prepare('SELECT state,payload FROM staged_capture_evidence WHERE event_id=?');

  t.mock.timers.setTime(expiry - 1);
  const first = await meter(f, 'before-expiry', () => read(f, 'contract', episodeId));
  assert.equal(first.result.policies.items[0].staging, 'pending');
  assert.ok(row.get(input.eventId).payload);
  assert.ok(twin.runtime.inspectCaptureEvidence(ns, input).evidence.view);
  assertSameOutput(first.result, read(twin, 'contract', episodeId));

  t.mock.timers.setTime(expiry);
  const second = await meter(f, 'at-expiry', () => read(f, 'contract', episodeId));
  const { evidence } = twin.runtime.inspectCaptureEvidence(ns, input);
  assert.equal(evidence.view, null);
  assertSameOutput(second.result, read(twin, 'contract', episodeId));
  const [policy] = second.result.policies.items;
  assert.deepEqual([policy.staging, policy.gap, policy.gapReasons], ['expired', 'expired', ['expired']]);
  assert.deepEqual({ ...row.get(input.eventId) }, { state: 'expired', payload: null });
  assert.ok(row.get('other-namespace').payload);
  assertNoWrites(first);
});

test('Episode detail does not revive expired evidence or write after a clock rollback', async t => {
  const f = await fixture(t, 53);
  t.mock.timers.enable({ apis: ['Date'], now: start });
  const input = batch('expired-before-rollback');
  const { episodeId } = f.runtime.reserveEpisodeBatch(ns, input);
  t.mock.timers.setTime(expiry);
  assert.equal(f.runtime.inspectCaptureEvidence(ns, input).evidence.view, null);

  t.mock.timers.setTime(expiry + 1);
  const before = await meter(f, 'before-rollback', () => read(f, 'contract', episodeId));
  t.mock.timers.setTime(expiry - 1);
  const after = await meter(f, 'after-rollback', () => read(f, 'contract', episodeId));
  assertSameOutput(after.result, before.result);
  const [policy] = after.result.policies.items;
  assert.deepEqual([policy.staging, policy.gap], ['expired', 'expired']);
  assert.equal(f.db.prepare('SELECT payload FROM staged_capture_evidence WHERE event_id=?').get(input.eventId).payload, null);
  assertNoWrites(after);
  assertNoWrites(before);
  assert.equal(watermark(f), expiry);
});

test('Episode storage reads with a touch-only staged-evidence port', async t => {
  const { db, runtime } = await fixture(t, 53);
  t.mock.timers.enable({ apis: ['Date'], now: start });
  const { episodeId } = runtime.reserveEpisodeBatch(ns, batch());
  const epoch = () => db.prepare('SELECT epoch FROM namespace_epochs').get().epoch;
  const episodeProjection = createEpisodeReadProjection({ db, epoch });
  const storage = createEpisodeStorage({ db, epoch, episodeProjection, stagedEvidence: { touch() {} } });
  t.mock.timers.setTime(expiry);
  assert.equal(storage.inspect(ns, { episodeId }, pages).episode.id, episodeId);
});
