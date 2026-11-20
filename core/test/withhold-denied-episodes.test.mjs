import crypto, { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import assert from 'node:assert/strict';
import { openRawCaptureCore } from '../raw-capture.mjs';
import { migrateCardLineage } from '../content-safety-migration.mjs';
import { attestContentSafety } from '../content-safety-schema.mjs';
import { copySqliteFixture, ns, ok, quiescence, safetyFixture } from '../testing/content-safety-s2h-fixture.mjs';
import { localPlainPort, request, splitRaw } from '../testing/raw-capture-fixtures.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';

const read = (core, memory) => core.get({ namespace: ns, memoryId: memory.id, includeAwaiting: true });

async function rawFixture(t, extraModel = {}, safety = true) {
  const f = safetyFixture(t, 33);
  if (safety) {
    copySqliteFixture(f.path, f.backupPath);
    await migrateCardLineage({ path: f.path, backupPath: f.backupPath,
      expected: { storeId: f.storeId, base: 33 }, quiescence });
  }
  let items;
  const port = localPlainPort();
  const core = openRawCaptureCore({ path: f.path, decisionReview: 'required-v1',
    model: { ...rationaleModel(), extract: () => ({ items }), ...extraModel } },
  { mode: 'raw-v1', lineage: true, port,
    readPolicy: () => ({ generation: 'synthetic', reason: null }) });
  f.workspace.defer(() => core.close());
  const db = f.connect();
  f.workspace.defer(() => db.close());
  if (safety) {
    attestContentSafety(db);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 53);
  }
  function input(event, kinds, { sessionId = event, ordinal = 1 } = {}) {
    items = kinds.map((kind, i) => ({ kind, content: `I chose A: synthetic ${event} memory ${i}`, confidence: .8, sourceIndices: [0] }));
    const [raw] = splitRaw(items.map(item => item.content).join('. '), { id: event, ordinal });
    return request(raw, { namespace: ns, sessionId });
  }
  const capture = async (event, kinds, options) =>
    ok(ok(await core.captureRaw(input(event, kinds, options))).interpretation).admission.memories;
  return { ...f, core, db, port, input, capture };
}

async function deny(f, forgotten, denied) {
  const spans = f.db.prepare(`SELECT l.conversation_id,l.message_id,l.start,l.end FROM raw_receipt_lineage l
    JOIN receipts r ON r.id=l.receipt_id WHERE r.memory_id=? ORDER BY l.start,l.end`);
  const shared = spans.all(forgotten.id);
  assert.ok(shared.length);
  for (const memory of denied) {
    assert.deepEqual(spans.all(memory.id), shared);
    assert.equal(ok(read(f.core, memory)).memory.id, memory.id);
  }
  ok(f.core.forget({ namespace: ns, memoryId: forgotten.id, expectedRevision: forgotten.revision }));
  for (const memory of denied) {
    assert.equal(f.db.prepare('SELECT deleted FROM memories WHERE id=?').get(memory.id).deleted, 0);
    const result = read(f.core, memory);
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.error.code, 'memory_not_found');
  }
  return { ...f, forgotten, denied };
}

async function twice(t, call, check) {
  const first = await call(), fresh = await call();
  const failures = [];
  for (const [name, result] of [['first', first], ['fresh', fresh]]) {
    try {
      check(result);
      t.diagnostic(name + ': visible result');
    } catch (error) {
      failures.push(error);
      t.diagnostic(name + ': ' + (result.error?.code ?? 'visible result differed') + ' (' + error.message + ')');
    }
  }
  if (failures.length) throw failures.at(-1);
}

import { openMemoryCore } from '../index.mjs';
import { config } from '../testing/raw-capture-fixtures.mjs';

async function episodeFixture(t, { forget = true, safety = true, correct = true, protectStep = false } = {}) {
  const f = await rawFixture(t, {}, safety);
  const shared = f.input('shared', ['fact', 'fact']);
  const [forgotten, denied] = ok(ok(await f.core.captureRaw(shared)).interpretation).admission.memories;
  const core = openMemoryCore({ path: f.path, ...config('episode'), model: { ...rationaleModel(),
    extract: () => ({ items: [] }), interpretEpisode({ input }) {
      const field = (value, sourceIndex) => ({ value, anchors: [{ sourceIndex, start: 0, end: input.sources[sourceIndex].text.length }] });
      const mixed = input.sources.length === 3;
      return { type: field('work', mixed ? 1 : 0), language: 'en', gist: field('Synthetic episode gist', 0),
        outcome: mixed && protectStep ? field('Synthetic outcome', 2) : null, nextStep: field('Synthetic next step', mixed && !protectStep ? 2 : 0), disposition: null };
    } } });
  t.after(() => core.close());
  async function episode(sessionId, messages) {
    const result = ok(await core.capture({ namespace: ns, client: shared.client, sessionId,
      eventId: 'episode-' + sessionId, messages,
      episodeContext: { clientLabel: 'Synthetic client', generation: 'initial', origin: 'precompact' } }));
    assert.equal(result.episode.status, 'interpreted', JSON.stringify(result.episode));
    return result.episode.id;
  }
  const message = id => ({ id, role: 'user', content: 'Synthetic visible episode source ' + id, occurredAt: null });
  const retained = turn => turn.messages.map(({ id, role, content, occurredAt }) => ({ id, role, content, occurredAt }));
  const mixed = await episode(shared.sessionId, [...retained(shared), message('one'), message('two')]);
  const visible = await episode('visible-session', [message('three')]);
  const tail = await episode('tail-session', [message('four')]);
  const get = id => core.getEpisode({ namespace: ns, episodeId: id });
  const detail = ok(get(mixed));
  const source = id => detail.sources.items.find(item => item.messageId === id);
  const blockedSource = source('shared'), anchor = source('one');
  assert.ok(blockedSource);
  const original = f.db.prepare('SELECT record FROM session_episodes WHERE id=?').get(mixed).record;
  const patch = { gist: { text: 'Synthetic visible gist', anchors: [{ sourceId: anchor.id, digest: anchor.digest,
    start: 0, end: anchor.text.length }] } };
  if (protectStep) patch.nextStep = { ...patch.gist, text: 'Synthetic visible next step' };
  ok(core.correctEpisode({ namespace: ns, episodeId: mixed, expectedRevision: detail.episode.revision,
    patch }));
  const range = { namespace: ns, timeBasis: 'receipt', limit: 1,
    since: '2025-01-01T00:00:00.000Z', until: '2025-12-31T00:00:00.000Z' };
  const order = f.db.prepare('UPDATE session_episodes SET first_received_at=? WHERE id=?');
  const stepOrder = f.db.prepare("UPDATE session_episodes SET record=json_set(record,'$.nextStep.receiptOrdinal',?) WHERE id=?");
  for (const [index, id] of [mixed, visible, tail].entries()) {
    order.run(`2025-04-0${3 - index}T00:00:00.000Z`, id);
    stepOrder.run(3 - index, id);
  }
  if (forget) await deny(f, forgotten, [denied]);
  if (!correct) {
    // Seed the retained projection of an anchored denied Episode. The write
    // path requires the old published fields to be detached before forgetting.
    f.db.prepare("UPDATE session_episodes SET record=json_set(?,'$.nextStep.receiptOrdinal',3) WHERE id=?")
      .run(original, mixed);
  }
  return { ...f, core, mixed, visible, tail, blockedSource, range, get };
}

for (const correct of [false, true]) {
  test('listEpisodes fills visible pages after a Raw source is denied, corrected=' + correct, async t => {
    const f = await episodeFixture(t, { correct });
    if (!correct) assert.equal(f.get(f.mixed).error?.code, 'source_excluded');
    const expected = correct ? [f.mixed, f.visible, f.tail] : [f.visible, f.tail];
    await twice(t, () => f.core.listEpisodes(f.range), result => {
      let page = ok(result);
      for (const [index, id] of expected.entries()) {
        assert.deepEqual(page.items.map(item => item.id), [id]);
        assert.ok(!JSON.stringify(page).includes(f.blockedSource.id));
        assert.equal(page.exhausted, index === expected.length - 1);
        if (page.nextCursor) page = ok(f.core.listEpisodes({ ...f.range, cursor: page.nextCursor }));
      }
    });
  });
}

test('getEpisode withholds a denied source from a visible episode and fills the source page', async t => {
  const f = await episodeFixture(t);
  const input = { namespace: ns, episodeId: f.mixed, sourceLimit: 1 };
  await twice(t, () => f.core.getEpisode(input), result => {
    const page = ok(result);
    assert.equal(page.episode.id, f.mixed);
    assert.equal(page.sources.items.length, 1);
    assert.equal(page.sources.exhausted, false);
    const next = ok(f.core.getEpisode({ ...input, sourceCursor: page.sources.nextCursor }));
    assert.deepEqual([page, next].flatMap(value => value.sources.items.map(source => source.messageId)).sort(), ['one', 'two']);
    assert.equal(next.sources.exhausted, true);
    for (const value of [page, next]) assert.ok(!JSON.stringify(value).includes(f.blockedSource.id));
  });
});

test('session next steps advance past a denied newest episode', async t => {
  const f = await episodeFixture(t, { correct: false, protectStep: true });
  const input = { namespace: ns, groups: { nextSteps: true, procedural: false } };
  await twice(t, () => f.core.sessionStartContext(input), result => {
    const group = ok(result).groups.nextSteps;
    assert.equal(group.items.length, 1);
    assert.equal(group.complete, true);
    assert.equal(group.items[0].episodeId, f.visible);
    assert.ok(!JSON.stringify(result).includes(f.blockedSource.id));
  });
});

// Seed repeatable IDs, secrets and wall-clock values before tracing the public
// call. The digest preserves every SQL byte, invocation and bound value.
function deterministicFixture(t) {
  let id = 0;
  t.mock.method(crypto, 'randomUUID', () => '00000000-0000-4000-8000-' + String(++id).padStart(12, '0'));
  t.mock.method(crypto, 'randomBytes', size => Buffer.alloc(size, 23));
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2025-06-01T00:00:00.000Z') });
}

function trace(t, label, read, expected) {
  const statements = [], { prepare, exec } = DatabaseSync.prototype;
  DatabaseSync.prototype.exec = function (sql) {
    statements.push(['exec', sql]);
    return exec.call(this, sql);
  };
  DatabaseSync.prototype.prepare = function (sql) {
    const statement = prepare.call(this, sql);
    return new Proxy(statement, { get(target, name) {
      const value = Reflect.get(target, name, target);
      if (typeof value !== 'function') return value;
      return (...bindings) => {
        if (['get', 'all', 'run', 'iterate'].includes(name)) statements.push([name, sql, bindings]);
        return Reflect.apply(value, target, bindings);
      };
    } });
  };
  let output;
  try { output = ok(read()); }
  finally {
    DatabaseSync.prototype.prepare = prepare;
    DatabaseSync.prototype.exec = exec;
  }
  const digest = createHash('sha256').update(JSON.stringify(statements)).digest('hex');
  t.diagnostic(label + ': ' + statements.length + ' SQL executions, ' + digest);
  assert.deepEqual([statements.length, digest], expected);
  return output;
}

const statementTrace = {
  false: {
    'list initial': [4, '65974c2156fa14020e01db10c747480bdfc7d7fd4ab479c6be5c0771541092b0'],
    'list continued': [4, '34d7dae2989a403a6c807acc320498393643faff3a69a74a0a9adeb7c9c10cd9'],
    'get initial': [13, '2993aea35769c4e65b88101254bcba352317dc0c87386d62f965c35103dc9d84'],
    'get continued': [13, 'ea2597f5386810cf607e84922307f04a573fe5864df2c81e687cf9e5ac3a36b8'],
    'next step': [14, 'ab250d966ee37ee809e06d7f0045f91c1204e1be84006d31c58d1b30d8fbf229'],
  },
  true: {
    'list initial': [13, 'ffaa3b50581445c88e6f063577023bc8ba3665361135a694a1938a859f7bb3ef'],
    'list continued': [13, '28e66dacd42003ca478e0ff04799270c9612c20109108ced45497f8ff086c182'],
    'get initial': [22, 'a62358ff9c359a24a1be04bf21f55c585119e0bca691f3c13622bfff31cfc4a3'],
    'get continued': [22, '1092b4734d8726b86cae3ce31e079d0643acf420959af0d11461cd2162d2e3ba'],
    'next step': [27, '8d4b94ad44ab9f18298d5e464569fae04368702bf53985137ac6fb9afddcd394'],
  },
};

for (const safety of [false, true]) {
  test('Episode and next-step SQL parity with safety ' + safety, async t => {
    deterministicFixture(t);
    const f = await episodeFixture(t, { forget: false, safety });
    const initial = trace(t, 'list initial', () => f.core.listEpisodes(f.range), statementTrace[safety]['list initial']);
    assert.ok(initial.nextCursor);
    trace(t, 'list continued', () => f.core.listEpisodes({ ...f.range, cursor: initial.nextCursor }), statementTrace[safety]['list continued']);
    const input = { namespace: ns, episodeId: f.mixed, sourceLimit: 1 };
    const detail = trace(t, 'get initial', () => f.core.getEpisode(input), statementTrace[safety]['get initial']);
    assert.ok(detail.sources.nextCursor);
    trace(t, 'get continued', () => f.core.getEpisode({ ...input, sourceCursor: detail.sources.nextCursor }), statementTrace[safety]['get continued']);
    trace(t, 'next step', () => f.core.sessionStartContext({ namespace: ns, groups: { nextSteps: true, procedural: false } }), statementTrace[safety]['next step']);
  });
}
