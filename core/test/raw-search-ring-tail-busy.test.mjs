import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createLocalRawSearch, createLocalRawSearchUpkeepControl, withLocalRawSearchUpkeep } from '../local-raw-search.mjs';
import { createRawSearchAuthority } from '../raw-search-authority.mjs';
import { createRawSearchMaintenance } from '../raw-search-maintenance.mjs';
import { openRawSearchStorage } from '../raw-search-storage.mjs';
import { openReadDatabase } from '../read-database.mjs';
import { installRawSearchTestClock, rawSearchTestWait } from '../testing/raw-search-clock.mjs';
import { consumeRecentHints, searchFixture } from '../testing/raw-search-fixtures.mjs';
import { ns, savedSource, sourceFixture } from '../testing/raw-source-fixtures.mjs';

const tickMs = 1000;
// One idle owner, drained recent work, and at most two indexed rows.
const cleanupTicks = 2;
const words = ['ringtailcopper', 'ringtailsilver'];

function exclude(f, { conversationId, messageId }, start, end) {
  f.db.prepare('INSERT INTO raw_source_exclusions VALUES(?,?,?,?,1)').run(conversationId, messageId, start, end);
}

async function ringFixture(t) {
  installRawSearchTestClock(t);
  const f = sourceFixture(t);
  const captures = [];
  for (const word of words) captures.push(await savedSource(f, word, { sessionId: word }));
  const search = await searchFixture(f);
  await consumeRecentHints(f, search);
  await search.tick({ maxMs: 5000 });

  const events = [];
  let reader, storage, maintenance, beforeTail = () => {};
  let completedFence;
  async function close() {
    await maintenance?.close();
    await storage?.close();
    reader?.db.close();
    reader = storage = maintenance = undefined;
  }
  async function reopen() {
    await close();
    reader = openReadDatabase(f.path, { contextRead: true });
    const authority = createRawSearchAuthority(reader, search.options);
    storage = await openRawSearchStorage({ directory: search.directory, identity: authority.identity,
      bind: authority.bind, quotaBytes: 512 * 1024 * 1024 });
    const { checkpoint } = storage.head();
    assert.equal(checkpoint.coverageComplete, true);
    completedFence ??= checkpoint.fence;
    maintenance = createRawSearchMaintenance({ ...storage,
      tail() {
        events.push('tail');
        beforeTail();
        return storage.tail();
      },
      snapshot(input) {
        events.push(['snapshot', input.after, input.limit]);
        return storage.snapshot(input);
      },
    }, { ...authority,
      // Keep the completed proof sweep out of the test. The ring still uses
      // the real canonical version and disposition, including after reopen.
      fence: () => completedFence,
      disposition(source) {
        const result = authority.disposition(source);
        events.push(['disposition', source.ref.conversationId, result]);
        return result;
      },
    }, search.options);
  }
  f.workspace.defer(close);
  await reopen();
  const { rows } = await storage.snapshot({ limit: 16 });
  assert.equal(rows.length, words.length);
  const word = row => captures.find(capture => capture.conversationId === row.source.ref.conversationId).text;
  for (const row of rows) assert.equal((await search.search({ query: word(row) })).candidates.length, 1);

  return { events, rows, reopen, get storage() { return storage; },
    stop: () => maintenance.close(),
    onTail(hook) { beforeTail = hook; },
    deny(row) { const { span, ...ref } = row.source.ref; exclude(f, ref, span.start, span.end); },
    async hidden(row) {
      for (const intent of ['current', 'history'])
        assert.deepEqual((await search.search({ query: word(row), intent })).candidates, []);
    },
    async tick(maxMs = 25) {
      events.length = 0;
      await rawSearchTestWait(tickMs);
      const result = await maintenance.maintain({ maxItems: 16, maxMs }, guard => guard?.());
      assert.equal(result.phase, 'idle');
      assert.equal(result.error, null);
      assert.equal(result.noProgress, 0);
      return result;
    },
    async busyOnce(stop = () => {}) {
      let faults = 0;
      beforeTail = () => {
        faults++;
        beforeTail = () => {};
        stop();
        throw Object.assign(new Error('synthetic sidecar BUSY at tail'), { code: 'ERR_SQLITE_ERROR', errcode: 5 });
      };
      const result = await this.tick(100);
      assert.equal(faults, 1);
      assert.equal(Object.hasOwn(result, 'checkpoint'), false, 'BUSY discards the turn');
    },
    async erased(row, maxMs = 25) {
      for (let tick = 1; tick <= cleanupTicks; tick++) {
        await this.tick(maxMs);
        await this.hidden(row);
        if (!(await storage.lookup([row.key])).length) {
          t.diagnostic(`Erased after ${tick} upkeep tick(s), bound ${cleanupTicks} × ${tickMs} ms`);
          return tick;
        }
      }
      assert.fail(`Denied index row still on disk after ${cleanupTicks} upkeep ticks`);
    },
  };
}

async function denyMidLap(ring) {
  const [first, last] = ring.rows;
  await ring.tick();
  assert.deepEqual(ring.events, ['tail', ['snapshot', 0, 1], ['disposition', first.source.ref.conversationId, 'allowed']]);
  ring.deny(first);
  await ring.hidden(first);
  await ring.tick();
  assert.deepEqual(ring.events, [['snapshot', first.segment, 1], ['disposition', last.source.ref.conversationId, 'allowed'], 'tail']);
  assert.equal(ring.storage.head().checkpoint.cleanup.afterSegment, 0);
  return first;
}

test('lap end retries a re-queued denial on the next tick after tail BUSY', async t => {
  const ring = await ringFixture(t);
  const denied = await denyMidLap(ring);
  const before = ring.storage.head();
  await ring.busyOnce();
  assert.deepEqual(ring.events, [['snapshot', 0, 16], ['disposition', denied.source.ref.conversationId, 'remove'],
    ['disposition', ring.rows[1].source.ref.conversationId, 'allowed'], 'tail']);
  assert.deepEqual(ring.storage.head(), before);
  assert.equal((await ring.storage.lookup([denied.key])).length, 1);
  await ring.hidden(denied);
  assert.equal(await ring.erased(denied, 100), 1);
});

for (const boundary of ['start', 're-arm']) test(`${boundary} retries tail before scanning a stale lap boundary`, async t => {
  const ring = await ringFixture(t);
  const [first, last] = ring.rows;
  await ring.storage.invalidate([last.segment]);
  if (boundary === 're-arm') {
    await ring.tick();
    await ring.tick();
    assert.deepEqual(ring.events, [], 'the stable completed ring is idle');
  } else {
    // A previous owner can leave an older tail in its signed checkpoint.
    const { checkpoint } = ring.storage.head();
    await ring.storage.checkpoint({ ...checkpoint, cleanup: { afterSegment: 0, throughSegment: first.segment } });
  }
  const segment = await ring.storage.publish(await ring.storage.stage(last), null);
  assert.ok(segment > ring.storage.head().checkpoint.cleanup.throughSegment);
  ring.deny(last);
  const before = ring.storage.head();
  await ring.busyOnce();
  assert.deepEqual(ring.events, ['tail'], 'the fault precedes the first snapshot');
  assert.deepEqual(ring.storage.head(), before);
  assert.equal((await ring.storage.lookup([last.key])).length, 1);
  await ring.hidden(last);
  assert.equal(await ring.erased(last, 100), 1, 'the retry must include the newer row on the next tick');
  assert.deepEqual(ring.events.slice(0, 2), ['tail', ['snapshot', 0, 16]]);
});

test('reopening the owner re-derives the denial queued before the failed tail', async t => {
  const ring = await ringFixture(t);
  const denied = await denyMidLap(ring);
  const before = ring.storage.head();
  let stopped;
  await ring.busyOnce(() => { stopped = ring.stop(); });
  await stopped;
  assert.deepEqual(ring.events.at(-2), ['disposition', ring.rows[1].source.ref.conversationId, 'allowed']);
  assert.ok(ring.events.some(event => event[0] === 'disposition' && event[2] === 'remove'));
  assert.deepEqual(ring.storage.head(), before);
  assert.equal((await ring.storage.lookup([denied.key])).length, 1);
  await ring.reopen();
  assert.deepEqual(ring.storage.head(), before);
  await ring.hidden(denied);
  await ring.erased(denied);
});

test('detach and reattach with pending removal erases it on scheduled upkeep alone', async t => {
  installRawSearchTestClock(t);
  const f = sourceFixture(t);
  const [word] = words;
  const source = await savedSource(f, word);
  let pending;
  const upkeep = createLocalRawSearchUpkeepControl({
    setTimer(callback, delay) {
      assert.equal(pending, undefined, 'only one upkeep timer');
      return pending = { callback, delay, unref() {} };
    },
    clearTimer(timer) { if (pending === timer) pending = undefined; },
  });
  const manager = withLocalRawSearchUpkeep(upkeep, () => createLocalRawSearch(f.path, f.port));
  f.workspace.defer(() => manager.close());
  const search = manager.contextPort([ns]);
  async function tick(delay) {
    assert.equal(pending?.delay, delay);
    const { callback } = pending;
    pending = undefined;
    await rawSearchTestWait(tickMs);
    await callback();
  }
  upkeep.resume();
  await tick(0);
  assert.equal((await search.search({ query: word })).candidates.length, 1);
  // Drain the recent lane and let the ring settle before detaching.
  for (let i = 0; i < 4; i++) await tick(tickMs);

  const root = f.path + '.raw-search';
  const [owner] = readdirSync(root);
  const directory = join(root, owner);
  const file = join(directory, readdirSync(directory).find(name => name.endsWith('.sqlite')));
  const db = new DatabaseSync(file, { readOnly: true });
  f.workspace.defer(() => db.close());
  const count = () => db.prepare('SELECT count(*) AS n FROM segments WHERE published=1').get().n;
  assert.equal(count(), 1);

  exclude(f, source, 0, word.length);
  const stale = pending;
  upkeep.suspend();
  assert.equal(pending, undefined);
  await rawSearchTestWait(tickMs * cleanupTicks);
  await stale.callback();
  assert.equal(pending, undefined);
  assert.equal(count(), 1, 'detached upkeep leaves the index row on disk');
  assert.deepEqual((await search.search({ query: word })).candidates, []);
  upkeep.resume();
  for (let i = 0; i < cleanupTicks && count(); i++) await tick(i === 0 ? 0 : tickMs);
  assert.equal(count(), 0, `reattachment erases the row within ${cleanupTicks} scheduled ticks`);
  assert.deepEqual((await search.search({ query: word })).candidates, []);
});

test('ordinary two-row lap makes the same steps and then idles', async t => {
  const ring = await ringFixture(t);
  const [first, last] = ring.rows;
  const results = [];
  results.push(await ring.tick());
  assert.deepEqual(ring.events, ['tail', ['snapshot', 0, 1], ['disposition', first.source.ref.conversationId, 'allowed']]);
  assert.equal(ring.storage.head().checkpoint.cleanup.afterSegment, first.segment);
  results.push(await ring.tick());
  assert.deepEqual(ring.events, [['snapshot', first.segment, 1], ['disposition', last.source.ref.conversationId, 'allowed'], 'tail']);
  assert.equal(ring.storage.head().checkpoint.cleanup.afterSegment, 0);
  results.push(await ring.tick());
  assert.deepEqual(ring.events, []);
  assert.deepEqual(results.map(result => [result.scanned, result.checkpointAdvances, result.removed]), [[1, 1, 0], [2, 2, 0], [2, 2, 0]]);
});
