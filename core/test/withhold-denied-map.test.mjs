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

const add = (core, label) => ok(core.admit({ namespace: ns,
  memory: { content: 'Synthetic independent memory ' + label, kind: 'fact' },
  receipts: [receipt(label)] })).memory;
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

async function deniedFixture(t, kinds = ['fact'], setup) {
  const f = await rawFixture(t);
  const [forgotten, ...denied] = await f.capture('shared', ['fact', ...kinds]);
  assert.equal(denied.length, kinds.length);
  await setup?.(f, forgotten, denied);
  return deny(f, forgotten, denied);
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

test('map retains visible rows and fills pages across a denied memory', async t => {
  deterministicFixture(t);
  const f = await deniedFixture(t);
  const [visible] = await f.capture('visible-map', ['fact']);
  const another = add(f.core, 'map tail');
  const ids = [visible.id, another.id].sort();
  for (const limit of [1, 20]) {
    const input = { namespace: ns, limit };
    await twice(t, () => f.core.map(input), result => {
      const page = ok(result);
      assert.deepEqual(page.items.map(item => item.ref.memoryId), ids.slice(0, limit));
      assert.equal(page.exhausted, limit !== 1);
      assert.doesNotMatch(JSON.stringify(page), new RegExp(f.denied[0].id));
      if (limit === 1) {
        const next = ok(f.core.map({ ...input, cursor: page.nextCursor }));
        assert.deepEqual([page, next].flatMap(value => value.items.map(item => item.ref.memoryId)).sort(), ids);
        assert.equal(next.exhausted, true);
      }
    });
  }
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

const mapTrace = {
  false: [
    [8, 'e0e669afbbbd653beebc2990eeef519a56d99bf1c0872798bc9d1ab6c5a4207d'],
    [8, '8fce4f540885bc479356e167482595f3ed3339de05f82457ad71d8cc2814dddc'],
  ],
  true: [
    [19, 'e651a7623b8f7ba1ddf4a72fbf8d35164b9151900f39b7270b5ab5fef3657cec'],
    [19, 'fefb08b655f5e5a35cc28b47ed25ffb6ae7397d343f4f6d861247709dceb8843'],
  ],
};

for (const safety of [false, true]) {
  test('map SQL parity with safety ' + safety, async t => {
    deterministicFixture(t);
    const f = await rawFixture(t, {}, safety);
    await f.capture('visible', ['fact', 'fact']);
    const input = { namespace: ns, limit: 1 };
    const page = trace(t, 'initial', () => f.core.map(input), mapTrace[safety][0], responseTrace[safety].initial);
    assert.ok(page.nextCursor);
    trace(t, 'continued', () => f.core.map({ ...input, cursor: page.nextCursor }), mapTrace[safety][1], responseTrace[safety].continued);
  });
}

test('map cursors retain their physical anchor across withheld rows', async t => {
  deterministicFixture(t);
  const f = await deniedFixture(t);
  const denied = f.denied[0];
  const a = add(f.core, 'first visible');
  const b = add(f.core, 'second visible');
  assert.deepEqual(f.db.prepare("SELECT id FROM memories WHERE deleted=0 ORDER BY id").all().map(row => row.id),
    [denied.id, a.id, b.id]);
  const input = { namespace: ns, limit: 1 };
  await twice(t, () => f.core.map(input), result => {
    const first = ok(result);
    assert.deepEqual(first.items.map(item => item.ref.memoryId), [a.id]);
    assert.equal(first.exhausted, false);
    const [body] = first.nextCursor.split('.');
    const cursor = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    assert.deepEqual(Object.keys(cursor).sort(), ['a', 'b', 'e', 'f', 'h', 'l', 'n', 'o', 'p', 's', 'v']);
    assert.deepEqual(cursor.a, { offset: 2 });
    const legacyBody = Buffer.from(JSON.stringify({ ...cursor, a: { offset: 2 } })).toString('base64url');
    const legacyCursor = legacyBody + '.' + crypto.createHmac('sha256', '17'.repeat(32))
      .update(legacyBody).digest('base64url');
    const second = ok(f.core.map({ ...input, cursor: first.nextCursor }));
    assert.deepEqual(ok(f.core.map({ ...input, cursor: legacyCursor })), second);
    assert.deepEqual(second.items.map(item => item.ref.memoryId), [b.id]);
    assert.equal(second.exhausted, true);
    assert.equal(second.nextCursor, null);
    for (const page of [first, second]) {
      assert.deepEqual(Object.keys(page).sort(), ['exhausted', 'indexRevision', 'invalidRefs', 'items', 'nextCursor', 'truncatedBy']);
      assert.deepEqual(page.invalidRefs, []);
    }
    assert.ok(!JSON.stringify([result, second, cursor]).includes(denied.id));
  });
});

function recallTopics(f, hidden, visible) {
  const topics = f.db.prepare(`INSERT INTO mocs(id,owner_id,scope,project_id,level,title,canonical_title,revision,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,1,?,?)`);
  const placement = f.db.prepare('INSERT INTO moc_memory_refs(moc_id,memory_id,moc_revision,memory_revision) VALUES(?,?,?,?)');
  const title = f.db.prepare('INSERT INTO moc_title_sources VALUES(?,?,?)');
  const edge = f.db.prepare('INSERT INTO moc_edges(parent_id,child_id,parent_revision,child_revision) VALUES(?,?,1,1)');
  const stamp = '2025-06-01T00:00:00.000Z';
  f.db.prepare("UPDATE memories SET filing_status='filed' WHERE id IN (?,?)").run(hidden.id, visible.id);
  const records = [
    ['hidden-topic', 1, hidden], ['visible-topic', 1, visible],
    ['empty-ancestor', 2, hidden], ['visible-ancestor', 2, visible],
  ];
  for (const [id, level, memory] of records) {
    topics.run(id, ns.ownerId, ns.scope, ns.projectId, level, 'Synthetic ' + id, id, stamp, stamp);
    title.run(id, memory.id, memory.revision);
    if (level === 1) placement.run(id, memory.id, 1, memory.revision);
  }
  edge.run('empty-ancestor', 'hidden-topic');
  edge.run('visible-ancestor', 'hidden-topic');
  edge.run('visible-ancestor', 'visible-topic');
}

for (const level of ['root', 'child']) {
  test('public recall map omits empty topics and ancestors from the ' + level + ' page', async t => {
    deterministicFixture(t);
    const f = await rawFixture(t);
    const hidden = add(f.core, 'protected placement');
    const visible = add(f.core, 'independent placement');
    recallTopics(f, hidden, visible);
    const root = { namespace: ns, purpose: 'recall', limit: 1 };
    const child = { ...root, parentRef: { mocId: 'visible-ancestor', revision: 1 } };
    const topic = item => item.moc?.id ?? (item.ref?.childType === 'moc' ? item.ref.childId : null);
    assert.ok(ok(f.core.map({ ...child, limit: 20 })).items.some(item => topic(item) === 'hidden-topic'));
    transaction(f.db, () => writeContentSuppressionInside(f.db, { namespace: ns, kind: 'memory', key: hidden.id,
      reason: 'privacy_erase', actionId: 'suppress-placement' }));
    const input = level === 'root' ? root : child;
    const expected = level === 'root' ? ['visible-topic', 'visible-ancestor', 'visible-topic'] : ['visible-topic', 'visible-topic'];
    await twice(t, () => f.core.map(input), first => {
      const seen = [];
      let result = first;
      for (let i = 0; i < 10; i++) {
        const page = ok(result);
        assert.equal(page.items.length, 1);
        assert.deepEqual(page.invalidRefs, []);
        const envelope = JSON.stringify(result);
        for (const needle of ['hidden-topic', 'empty-ancestor', hidden.id]) assert.ok(!envelope.includes(needle), needle);
        const id = topic(page.items[0]);
        if (id) seen.push(id);
        if (page.exhausted) {
          assert.equal(page.nextCursor, null);
          assert.deepEqual(seen, expected);
          return;
        }
        assert.ok(page.nextCursor);
        result = f.core.map({ ...input, cursor: page.nextCursor });
      }
      assert.fail('recall map did not exhaust');
    });
  });
}

for (const safety of [false, true]) {
  test('root and child recall topic parity with safety ' + safety, async t => {
    deterministicFixture(t);
    const f = await rawFixture(t, {}, safety);
    recallTopics(f, add(f.core, 'first placement'), add(f.core, 'second placement'));
    const input = { namespace: ns, purpose: 'recall', limit: 1 };
    for (const [label, options] of [['root', input], ['child', { ...input,
      parentRef: { mocId: 'visible-ancestor', revision: 1 } }]]) {
      const first = trace(t, label, () => f.core.map(options), topicTrace[safety][label], responseTrace[safety][label]);
      assert.ok(first.nextCursor);
      trace(t, label + ' continued', () => f.core.map({ ...options, cursor: first.nextCursor }),
        topicTrace[safety][label + ' continued'], responseTrace[safety][label + ' continued']);
    }
  });
}

const topicTrace = {
  false: {
    'root': [10, 'f545ef6163dbf39e6ce214a0892174933e3f1c843cd8ca9c9736ee4322d3b414'],
    'root continued': [10, 'fba0cfa242b6d69ead8c1dff28f52eaa616b347a630b29cd908e61904a72eb91'],
    'child': [13, '3788dabe4d714a9dbc091f6782c8cdee5946ab04da6f9e8b7bbdee634f632e20'],
    'child continued': [13, '769bfc79e6468aee29edc6aac340f156bd15b7297c798edfa7b26126525def31']
  },
  true: {
    'root': [21, 'c6b8c14bd105a4e2da89a7fd71660802341a09b15d029ab068aa82dc4dacd987'],
    'root continued': [21, 'f42a59f54340fc7f4a48c441ae79f3ea408320ffbe48c4663b5989682a534a34'],
    'child': [24, '8a611dca908bc84d379198f4e2efa21a2076ebbe6ce24fbf2dedfae30e2dc67e'],
    'child continued': [24, '8c621b3fc5c0906392b4e85badabdda4ba535c95c29f84545bd42828b457492d']
  }
};

const responseTrace = {
  false: {
    'initial': '59b8cd6786ce2257c7b204bbf0fd0705e5f498b81e65fabef2941cc790639bb7',
    'continued': '3719eb419bdae743d19f6a1dd6f082b1ec4f9c72b3cab8a9526dc2039c7bebff',
    'root': 'ff6c8cdfebef5fe8e582438a5eebfda2d9afe450e30b7e5423357326bfb2a779',
    'root continued': '7f26ff60f6598f230f71fbb41970f3d2307daf3c12985aa4025b31a81030996a',
    'child': 'cf5adc1d8a7f86c05d1b33bf5eb7ea13ce8320b3ae7a1356e13e72c1534c1606',
    'child continued': '077ed81a6e869c411781bb17bbc536d5d93b121d9660a24ad00413ce8315c0cf'
  },
  true: {
    'initial': 'f61283eca8fcad3b0f90f9de991e7d870635ee763600abe77f503a93bdd88a2a',
    'continued': '81fef514eefb12dbd47b6403b84d6500ecfac796f123f067dde06d5aec414fae',
    'root': '6b614b9232fa7a0b8de10a16cd36936e381de4addd8b40c6c1c9b9c00e784acb',
    'root continued': '1412c364dc7c11272e0f53e81c4403b2ba59bd587af29f00805d397c6bc9cba1',
    'child': '79b9b034163107e472b94f6d30e07049e23e4f6b590a30b033f85fd94af41c54',
    'child continued': '838f3a9656160c767a2995005d5ab5c3f84a6fe0ca81236ccc4255eaf7805693'
  }
};
