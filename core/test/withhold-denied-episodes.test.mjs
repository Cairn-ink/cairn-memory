import { transaction } from '../database.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';
import crypto, { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import assert from 'node:assert/strict';
import { openRawCaptureCore } from '../raw-capture.mjs';
import { migrateCardLineage } from '../content-safety-migration.mjs';
import { attestContentSafety } from '../content-safety-schema.mjs';
import { copySqliteFixture, ns, ok, quiescence, receipt, safetyFixture } from '../testing/content-safety-s2h-fixture.mjs';
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
  return { ...f, core, mixed, visible, tail, blockedSource, range, get, denied };
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

function trace(t, label, read, expected, expectedBytes) {
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
  let envelope;
  try { envelope = read(); }
  finally {
    DatabaseSync.prototype.prepare = prepare;
    DatabaseSync.prototype.exec = exec;
  }
  const digest = createHash('sha256').update(JSON.stringify(statements)).digest('hex');
  t.diagnostic(label + ': ' + statements.length + ' SQL executions, ' + digest);
  const response = createHash('sha256').update(JSON.stringify(envelope)).digest('hex');
  t.diagnostic(label + ' response: ' + response);
  assert.deepEqual([statements.length, digest], expected);
  assert.equal(response, expectedBytes);
  return ok(envelope);
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
    const initial = trace(t, 'list initial', () => f.core.listEpisodes(f.range), statementTrace[safety]['list initial'], responseTrace[safety]['list initial']);
    assert.ok(initial.nextCursor);
    trace(t, 'list continued', () => f.core.listEpisodes({ ...f.range, cursor: initial.nextCursor }), statementTrace[safety]['list continued'], responseTrace[safety]['list continued']);
    const input = { namespace: ns, episodeId: f.mixed, sourceLimit: 1 };
    const detail = trace(t, 'get initial', () => f.core.getEpisode(input), statementTrace[safety]['get initial'], responseTrace[safety]['get initial']);
    assert.ok(detail.sources.nextCursor);
    trace(t, 'get continued', () => f.core.getEpisode({ ...input, sourceCursor: detail.sources.nextCursor }), statementTrace[safety]['get continued'], responseTrace[safety]['get continued']);
    trace(t, 'next step', () => f.core.sessionStartContext({ namespace: ns, groups: { nextSteps: true, procedural: false } }), statementTrace[safety]['next step'], responseTrace[safety]['next step']);
  });
}

function seedLinks(f) {
  const insert = f.db.prepare('INSERT INTO episode_memory_links(id,episode_id,event_id,memory_id,admission_revision,receipt_ids) VALUES(?,?,?,?,?,?)');
  return Array.from({ length: 3 }, (_, index) => {
    const memory = ok(f.core.admit({ namespace: ns, memory: { kind: 'fact', content: 'Synthetic linked memory ' + index },
      receipts: [receipt('linked-' + index)] })).memory;
    const [source] = ok(f.core.get({ namespace: ns, memoryId: memory.id })).receipts;
    insert.run('link-' + index, f.mixed, 'synthetic-event', memory.id, memory.revision, JSON.stringify([source.id]));
    return { memory, source };
  });
}

function suppressLinked(f, links) {
  transaction(f.db, () => {
    for (const { memory } of links) writeContentSuppressionInside(f.db, { namespace: ns, kind: 'memory', key: memory.id,
      reason: 'privacy_erase', actionId: 'suppress-link' });
  });
}

for (const tail of [false, true]) {
  test('Episode links fill a page across ' + (tail ? 'an all-denied tail' : 'a denied prefix'), async t => {
    const f = await episodeFixture(t, { forget: false });
    const links = seedLinks(f);
    const visible = links[tail ? 0 : 2];
    const denied = links.filter(link => link !== visible);
    suppressLinked(f, denied);
    const input = { namespace: ns, episodeId: f.mixed, memoryLimit: 1 };
    await twice(t, () => f.core.getEpisode(input), result => {
      assert.deepEqual(ok(result).memoryLinks, { items: [{ id: tail ? 'link-0' : 'link-2',
        memoryId: visible.memory.id, admissionRevision: visible.memory.revision, receiptIds: [visible.source.id] }],
      exhausted: true, nextCursor: null });
      for (const { memory, source } of denied) {
        for (const needle of [memory.id, memory.content, source.id, source.excerpt]) {
          assert.ok(!JSON.stringify(result).includes(needle), needle);
        }
      }
    });
  });
}

test('Episode keep history withholds an action citing a denied existing source and preserves ordinals', async t => {
  const f = await episodeFixture(t, { forget: false });
  const before = ok(f.get(f.mixed));
  for (let n = 0; n < 3; n++) ok(await f.core.keepEpisode({ namespace: ns, episodeId: f.mixed,
    expectedRevision: before.episode.revision, actionId: 'keep-' + n }));
  const kept = ok(f.get(f.mixed)).keepActions.items;
  assert.deepEqual(kept.map(action => action.ordinal), [1, 2, 3]);
  const safeSource = before.sources.items.find(source => source.messageId === 'one');
  const sources = f.db.prepare('UPDATE episode_keep_actions SET keep_source_ids=? WHERE admission_key=?');
  // Retained history refers to the original source set even after it changes.
  // Keep one denied source row reachable by ID outside the current source set.
  sources.run(JSON.stringify([safeSource.id]), kept[0].actionKey);
  sources.run(JSON.stringify([f.blockedSource.id]), kept[1].actionKey);
  sources.run(JSON.stringify([safeSource.id]), kept[2].actionKey);
  f.db.prepare('UPDATE episode_sources SET episode_id=? WHERE id=?').run(f.visible, f.blockedSource.id);
  transaction(f.db, () => writeContentSuppressionInside(f.db, { namespace: ns, kind: 'memory', key: f.denied.id,
    reason: 'user_forget', actionId: 'suppress-keep-parent' }));
  assert.equal(f.db.prepare('SELECT id FROM episode_sources WHERE id=?').get(f.blockedSource.id).id, f.blockedSource.id);
  const input = { namespace: ns, episodeId: f.mixed, keepLimit: 1 };
  await twice(t, () => f.core.getEpisode(input), result => {
    const first = ok(result).keepActions;
    assert.deepEqual(first.items.map(action => action.ordinal), [1]);
    assert.equal(first.exhausted, false);
    assert.ok(first.nextCursor);
    const next = f.core.getEpisode({ ...input, keepCursor: first.nextCursor });
    const last = ok(next).keepActions;
    assert.deepEqual(last.items.map(action => action.ordinal), [3]);
    assert.equal(last.exhausted, true);
    assert.equal(last.nextCursor, null);
    for (const needle of [f.blockedSource.id, f.blockedSource.text, kept[1].actionKey]) {
      assert.ok(!JSON.stringify([result, next]).includes(needle), needle);
    }
  });
});

test('direct Episode refusal preserves deleted-origin precedence over anchored suppression', async t => {
  const f = await episodeFixture(t, { correct: false });
  assert.equal(f.get(f.mixed).error?.code, 'source_excluded');
  const source = f.db.prepare('SELECT * FROM episode_sources WHERE episode_id=?').get(f.tail);
  f.db.prepare('INSERT INTO episode_sources VALUES(?,?,?,?,?,?,?,?,?,?)').run('deleted-origin-passage',
    f.mixed, source.origin_episode_id, source.event_id, source.message_id, source.digest,
    source.role, source.text, source.truncated, source.ordinal);
  f.db.prepare('UPDATE session_episodes SET deleted=1 WHERE id=?').run(f.tail);
  await twice(t, () => f.get(f.mixed), result => assert.equal(result.error?.code, 'revision_conflict'));
});

test('Episode list advances through repeated denied batches and retains the order of tied times', async t => {
  const f = await episodeFixture(t, { correct: false });
  const seed = f.db.prepare('SELECT * FROM session_episodes WHERE id=?').get(f.mixed);
  const passage = f.db.prepare('SELECT * FROM episode_sources WHERE id=?').get(f.blockedSource.id);
  const fields = Object.keys(seed);
  const episode = f.db.prepare(`INSERT INTO session_episodes(${fields.join(',')}) VALUES(${fields.map(() => '?').join(',')})`);
  const addSource = f.db.prepare('INSERT INTO episode_sources VALUES(?,?,?,?,?,?,?,?,?,?)');
  const stamp = '2025-06-09T00:00:00.000Z';
  const hidden = [];
  for (const id of ['-hidden-0', '-hidden-1', '-hidden-2', '-hidden-3', 'zz-hidden', 'zzz-hidden']) {
    const source = { ...passage, id: id + '-passage', episode_id: id };
    // Only the denied anchor is required to refuse the copied projection.
    const copy = { ...seed, id, session_key: 's1:' + createHash('sha256').update(id).digest('hex'), first_received_at: stamp,
      record: seed.record.replaceAll(passage.id, source.id) };
    episode.run(...fields.map(field => copy[field]));
    addSource.run(...Object.values(source));
    hidden.push(id, source.id);
  }
  f.db.prepare('UPDATE session_episodes SET first_received_at=? WHERE id IN (?,?)').run(stamp, f.visible, f.tail);
  f.db.prepare('UPDATE session_episodes SET deleted=1 WHERE id=?').run(f.mixed);
  const expected = [f.visible, f.tail].sort();
  await twice(t, () => f.core.listEpisodes(f.range), result => {
    const page = ok(result);
    assert.deepEqual(page.items.map(item => item.id), [expected[0]]);
    assert.equal(page.exhausted, false);
    const next = f.core.listEpisodes({ ...f.range, cursor: page.nextCursor });
    assert.deepEqual(ok(next).items.map(item => item.id), [expected[1]]);
    assert.equal(ok(next).exhausted, true);
    assert.equal(ok(next).nextCursor, null);
    for (const needle of hidden) assert.ok(!JSON.stringify([result, next]).includes(needle), needle);
  });
});

for (const safety of [false, true]) {
  test('Episode Memory-link and keep history parity with safety ' + safety, async t => {
    deterministicFixture(t);
    const f = await episodeFixture(t, { forget: false, safety });
    const revision = ok(f.get(f.mixed)).episode.revision;
    for (let n = 0; n < 2; n++) ok(await f.core.keepEpisode({ namespace: ns, episodeId: f.mixed,
      expectedRevision: revision, actionId: 'parity-keep-' + n }));
    seedLinks(f);
    const input = { namespace: ns, episodeId: f.mixed, memoryLimit: 1, keepLimit: 1 };
    const first = trace(t, 'links and keeps', () => f.core.getEpisode(input),
      detailTrace[safety].initial, responseTrace[safety]['links and keeps']);
    assert.ok(first.memoryLinks.nextCursor && first.keepActions.nextCursor);
    trace(t, 'links and keeps continued', () => f.core.getEpisode({ ...input,
      memoryCursor: first.memoryLinks.nextCursor, keepCursor: first.keepActions.nextCursor }),
    detailTrace[safety].continued, responseTrace[safety]['links and keeps continued']);
  });
}

const detailTrace = {
  false: {
    'initial': [19, '8769e8dd831013ae741dcc91ef638e64e99f1ed836ad028034756d5cbabecbb2'],
    'continued': [19, '4f5c4a792de0a2c66c66e872afb6c21ca18c306e9eb8dec1b7697b4ea7de7874']
  },
  true: {
    'initial': [32, 'df9345c426e0ba86a38691cc49e643d569800154c4c81c9242f12ddc5867c12c'],
    'continued': [32, '2d6abbb031b652601595178acb70eadfe912026b4c94a0087291c78d2fcf54f8']
  }
};

const responseTrace = {
  false: {
    'list initial': '4ffcf380e987460f1f16fb830532177741e0556275397b915206b75f2188aee3',
    'list continued': '66555bf0a09b7cee12930a28c086b93946fcddc2ab965928e3a5ade550510dcd',
    'get initial': '23061b2b80cdc362ca452fddd7786fb1ed3d74c62bba0580b2e76c4f0d948993',
    'get continued': '3d0968c7df40a783fa07abfddbe0c24fd58a82454fc3b4825dd431eaa889af16',
    'next step': '69a6d011ee1a30b635823708c16e754020949d603ca94d0524d907d407dfde1c',
    'links and keeps': '1db2e1dc590e772bc9db3a7538f32fd58bdd8ae08d52b7c81824ee3d89179ba9',
    'links and keeps continued': 'a106b1a11d26698e0d3df62d1c4e22c42e2ab9343b2108bb5f253c3a993b301b'
  },
  true: {
    'list initial': 'c6ea7622b63da9346d6486ba66377024504d7836383866a4e1bc2d9db2cff9e3',
    'list continued': 'cf9fd16a2fc8388e63c2aa9ea79b4d6dd7f26e42cf6ed4e29e3aae7bd2baad6e',
    'get initial': '9a0bd360fe3204fa7ede2c6a4e1c6d6ef9b5ae7645d2ee9271bb28ad12bda32e',
    'get continued': '69c8e70c4f6aa151584314b3e7284f64d6b0f2edffd0c4ffeae9a0de398d293c',
    'next step': 'fae8c0162315123c5f803a467302679d67ae38b8a3e63af9d4d5cde13a1c10ce',
    'links and keeps': 'f9144eceed642dc4141c232f4e8ff35a9df254b00fa3d240c8a09302c8853faf',
    'links and keeps continued': 'ab7612fd8cdeae78e3933def18b909156960c5fd6b53f084ca36fb7c31c35423'
  }
};
