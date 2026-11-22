import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createLocalRawSearch, createLocalRawSearchUpkeepControl, withLocalRawSearchUpkeep } from '../local-raw-search.mjs';
import { installRawSearchTestClock, rawSearchTestWait } from '../testing/raw-search-clock.mjs';
import { ns, ok, request, savedSource, sourceFixture, splitRaw } from '../testing/raw-source-fixtures.mjs';

const total = 128;
const bound = 2;
const sessionId = 'denial-target';
const needle = 'quartztelescope';
const replacement = { client: 'synthetic', sessionId: 'independent', eventId: 'replacement',
  role: 'user', excerpt: 'Synthetic replacement.' };

test.beforeEach(installRawSearchTestClock);

async function indexed(t) {
  let capture = false, opened = 0;
  const f = sourceFixture(t, { model: { extract: () => ({ items: capture ?
    [{ content: 'Synthetic target fact.', kind: 'fact', confidence: 0.8, sourceIndices: [0] }] : [] }) } });
  const open = f.port.openRaw;
  f.port.openRaw = async input => { opened++; return open(input); };
  for (let i = 1; i < total; i += 16) {
    const messages = [];
    for (let ordinal = i; ordinal < Math.min(i + 16, total); ordinal++) {
      messages.push(splitRaw('syntheticfiller' + ordinal, { id: 'message-' + ordinal, ordinal })[0]);
    }
    ok(await f.core.captureRaw(request(messages[0], { client: 'codex', sessionId: 'filler',
      eventId: 'filler-' + i, messages })));
  }
  let pending, manager, search;
  const upkeep = createLocalRawSearchUpkeepControl({
    setTimer(callback) {
      assert.equal(pending, undefined);
      return pending = { callback, unref() {} };
    },
    clearTimer(timer) { if (pending === timer) pending = undefined; },
  });
  function connect() {
    manager = withLocalRawSearchUpkeep(upkeep, () => createLocalRawSearch(f.path, f.port));
    search = manager.contextPort([ns]);
    manager.schedule(ns);
    upkeep.resume();
  }
  f.workspace.defer(() => manager.close());
  connect();
  async function turn() {
    assert.ok(pending, 'attached upkeep schedules the next turn');
    const { callback } = pending;
    pending = undefined;
    await rawSearchTestWait(1010);
    await callback();
  }
  await turn();
  const root = f.path + '.raw-search';
  const directory = join(root, readdirSync(root)[0]);
  const db = new DatabaseSync(join(directory, readdirSync(directory).find(name => name.endsWith('.sqlite'))), { readOnly: true });
  f.workspace.defer(() => db.close());
  const head = () => db.prepare('SELECT sequence, checkpoint FROM header').get();
  const checkpoint = () => JSON.parse(head().checkpoint);
  const rows = () => db.prepare('SELECT id,segment_key FROM segments WHERE published=1 ORDER BY id').all();
  for (let n = 0; n < total * 4 && rows().length < total - 1; n++) await turn();
  assert.equal(rows().length, total - 1);
  capture = true;
  const source = await savedSource(f, needle, { sessionId });
  await turn();
  for (let n = 0; n < total * 4 && !checkpoint().coverageComplete; n++) await turn();
  assert.equal(checkpoint().coverageComplete, true);
  assert.equal(rows().length, total);
  for (let n = 0; n < total + 4; n++) await turn();
  const idle = head();
  await turn();
  assert.deepEqual(head(), idle, 'the ring is idle before recording a denial');
  const initial = rows(), target = initial.find(row => JSON.parse(row.segment_key)[0] === source.conversationId);
  assert.ok(initial.indexOf(target) >= total / 2, 'the target starts far from both cleanup cursors');
  assert.equal(checkpoint().cleanup.afterSegment, 0);
  assert.equal(checkpoint().sweep, 0);
  assert.equal((await search.search({ query: needle })).candidates.length, 1);
  const rawOpens = opened;
  const fence = { namespace: ns, client: 'codex', sessionId };
  async function deny(kind) {
    if (kind === 'fence') return ok(await f.core.fenceSession(fence));
    if (kind === 'deleteConversation') return ok(await f.core.deleteConversation({ namespace: ns,
      conversationId: source.conversationId, expectedRevision: source.expectedConversationRevision, actionId: 'synthetic-delete' }));
    const memory = f.db.prepare('SELECT id,revision FROM memories WHERE deleted=0').get();
    return ok(await f.core[kind]({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision,
      ...(kind === 'correct' ? { content: replacement.excerpt, kind: 'fact', receipt: replacement } : {}) }));
  }
  async function hidden() {
    for (const intent of ['current', 'history'])
      assert.deepEqual((await search.search({ query: needle, intent })).candidates, [], intent);
  }
  return { f, fence, source, deny, hidden, turn, rows, initial, target, checkpoint,
    detach() { upkeep.suspend(); assert.equal(pending, undefined); },
    attach() { upkeep.resume(); },
    async restart() { upkeep.suspend(); await manager.close(); connect(); },
    assertErased() {
      assert.equal(rows().some(row => row.id === target.id), false, `denied row remains after ${bound} upkeep turns`);
      assert.deepEqual(rows(), initial.filter(row => row.id !== target.id), 'only the denied row is erased');
      assert.equal(opened, rawOpens, 'erasure never opens Raw payloads');
    },
  };
}

for (const [kind, lifecycle] of [
  ['forget', 'attached'], ['correct', 'attached'], ['deleteConversation', 'attached'],
  ['fence', 'attached'], ['forget', 'reattach'], ['fence', 'restart'],
]) test(`${kind} directly queues a distant indexed row (${lifecycle})`, async t => {
  const s = await indexed(t);
  if (lifecycle === 'reattach') s.detach();
  await s.deny(kind);
  assert.deepEqual(s.rows(), s.initial, 'denial is recorded before physical erasure');
  await s.hidden();
  if (lifecycle === 'reattach') s.attach();
  if (lifecycle === 'restart') await s.restart();
  const cycles = s.checkpoint().cycles;
  for (let n = 0; n < bound; n++) {
    await s.turn();
    await s.hidden();
  }
  s.assertErased();
  assert.equal(s.checkpoint().cycles, cycles);
  assert.ok(s.checkpoint().cleanup.afterSegment < s.target.id, 'the ring never reaches the target');
});

test('an interrupted denial rolls back, and the ring still erases a committed denial with a missing queue entry', async t => {
  const s = await indexed(t);
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { DatabaseSync } from 'node:sqlite';
    import { openRawCaptureCore } from './core/raw-capture.mjs';
    const [path, input] = process.argv.slice(1);
    const core = openRawCaptureCore({ path }, { mode: 'off', deletion: true, readPolicy: () => {} });
    const prepare = DatabaseSync.prototype.prepare;
    DatabaseSync.prototype.prepare = function(sql) {
      const statement = prepare.call(this, sql);
      if (sql.startsWith('INSERT OR IGNORE INTO raw_session_fences')) {
        const run = statement.run.bind(statement);
        statement.run = (...args) => {
          if (run(...args).changes === 1 && this.isTransaction) process.exit(86);
        };
      }
      return statement;
    };
    await core.fenceSession(JSON.parse(input));
  `, s.f.path, JSON.stringify(s.fence)], { encoding: 'utf8' });
  assert.equal(run.status, 86, run.stderr);
  const fenceCount = () => s.f.db.prepare('SELECT count(*) AS n FROM raw_session_fences').get().n;
  assert.equal(fenceCount(), 0, 'exit between recording and queuing rolls the transaction back');

  // An older writer can commit the same denial without an outbox entry. Keep
  // that state reachable so the ordinary ring continues to provide recovery.
  s.f.db.prepare(`INSERT INTO raw_session_fences
    SELECT owner_id,scope,project_id,client,session_key FROM raw_conversations WHERE id=?`).run(s.source.conversationId);
  assert.equal(fenceCount(), 1);
  await s.hidden();
  for (let n = 0; n < bound; n++) await s.turn();
  assert.ok(s.rows().some(row => row.id === s.target.id), 'without the queue the distant row still waits');
  for (let n = 0; n < total && s.rows().some(row => row.id === s.target.id); n++) await s.turn();
  s.assertErased();
  await s.hidden();
});
