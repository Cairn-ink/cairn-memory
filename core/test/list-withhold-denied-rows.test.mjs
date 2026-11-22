import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { openMemoryCore } from '../index.mjs';
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

async function rawFixture(t) {
  const f = safetyFixture(t, 33);
  copySqliteFixture(f.path, f.backupPath);
  await migrateCardLineage({ path: f.path, backupPath: f.backupPath,
    expected: { storeId: f.storeId, base: 33 }, quiescence });
  let items;
  const core = openRawCaptureCore({ path: f.path, decisionReview: 'required-v1',
    model: { ...rationaleModel(), extract: () => ({ items }) } },
  { mode: 'raw-v1', lineage: true, port: localPlainPort(),
    readPolicy: () => ({ generation: 'synthetic', reason: null }) });
  f.workspace.defer(() => core.close());
  const db = f.connect();
  f.workspace.defer(() => db.close());
  attestContentSafety(db);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 53);
  async function capture(event, kinds) {
    items = kinds.map((kind, i) => ({ kind, content: `Synthetic ${event} memory ${i}`, confidence: .8, sourceIndices: [0] }));
    const [raw] = splitRaw(items.map(item => item.content).join('. '), { id: event });
    const captured = ok(await core.captureRaw(request(raw, { namespace: ns, sessionId: event })));
    return ok(captured.interpretation).admission.memories;
  }
  return { core, db, capture };
}

async function deniedFixture(t, kinds = ['fact']) {
  const f = await rawFixture(t);
  const [forgotten, ...denied] = await f.capture('shared', ['fact', ...kinds]);
  assert.equal(denied.length, kinds.length);
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

// Each group shares a timestamp. Groups appear newest first.
function order(f, ...groups) {
  const update = f.db.prepare('UPDATE memories SET updated_at=? WHERE id=?');
  for (const [i, group] of groups.entries()) {
    const stamp = new Date(Date.UTC(2026, 0, 20 - i)).toISOString();
    for (const memory of group) assert.equal(update.run(stamp, memory.id).changes, 1);
  }
  const ids = groups.flatMap(group => group.map(memory => memory.id).sort());
  assert.deepEqual(f.db.prepare('SELECT id FROM memories WHERE deleted=0 ORDER BY updated_at DESC, id ASC')
    .all().map(row => row.id), ids);
  return ids;
}

function list(f, options) {
  const page = ok(f.core.list({ namespace: ns, ...options }));
  for (const { id } of [f.forgotten, ...f.denied]) assert.ok(!JSON.stringify(page).includes(id));
  assert.equal(page.nextCursor === null, page.exhausted);
  return page;
}

const ids = page => page.memories.map(memory => memory.id);

function pagingFixture(f) {
  const [a, b, c, d] = [1, 2, 3, 4].map(number => add(f.core, `visible-${number}`));
  const [denied] = f.denied;
  return order(f, [a], [denied], [b, c], [d]).filter(id => id !== denied.id);
}

test('1. A large page contains all visible rows in order', async t => {
  const f = await deniedFixture(t);
  const expected = pagingFixture(f);
  const page = list(f, { limit: 20 });
  assert.deepEqual(ids(page), expected);
  assert.equal(page.exhausted, true);
});

test('2. Limits one and two page through the same order without gaps or duplicates', async t => {
  const f = await deniedFixture(t);
  const expected = pagingFixture(f);
  for (const limit of [1, 2]) {
    const seen = [];
    let cursor;
    for (let offset = 0; offset < expected.length; offset += limit) {
      const page = list(f, { limit, cursor });
      const delivered = expected.slice(offset, offset + limit);
      assert.deepEqual(ids(page), delivered);
      assert.equal(page.exhausted, offset + limit >= expected.length);
      if (page.nextCursor) {
        const payload = JSON.parse(Buffer.from(page.nextCursor.split('.')[0], 'base64url').toString());
        assert.deepEqual(payload.a, { id: page.memories.at(-1).id, updatedAt: page.memories.at(-1).updatedAt });
      }
      seen.push(...ids(page));
      cursor = page.nextCursor;
    }
    assert.equal(new Set(seen).size, seen.length);
    assert.deepEqual(seen, expected);
  }
});

for (const later of [false, true]) {
  test(`3. Denied lookahead with ${later ? 'a later visible row' : 'no later visible row'}`, async t => {
    const f = await deniedFixture(t);
    const first = add(f.core, 'visible-first');
    const rest = later ? [[add(f.core, 'visible-later')]] : [];
    order(f, [first], f.denied, ...rest);
    const page = list(f, { limit: 1 });
    assert.deepEqual(ids(page), [first.id]);
    assert.equal(page.exhausted, !later);
    if (later) {
      const next = list(f, { limit: 1, cursor: page.nextCursor });
      assert.deepEqual(ids(next), [rest[0][0].id]);
      assert.equal(next.exhausted, true);
    }
  });
}

test('4. Consecutive denied rows span multiple full batches', async t => {
  const f = await deniedFixture(t, ['fact', 'fact', 'fact', 'fact']);
  const first = add(f.core, 'visible-first');
  const last = add(f.core, 'visible-last');
  order(f, [first], f.denied, [last]);
  const page = list(f, { limit: 1 });
  assert.deepEqual(ids(page), [first.id]);
  assert.equal(page.exhausted, false);
  const next = list(f, { limit: 1, cursor: page.nextCursor });
  assert.deepEqual(ids(next), [last.id]);
  assert.equal(next.exhausted, true);
});

test('5. An entirely denied namespace returns an empty exhausted page', async t => {
  const f = await deniedFixture(t, ['fact', 'fact']);
  assert.deepEqual(list(f, { limit: 1 }), { memories: [], exhausted: true, nextCursor: null });
});

test('6. Refill preserves the states and statuses filters', async t => {
  const f = await deniedFixture(t);
  const first = add(f.core, 'visible-first'), last = add(f.core, 'visible-last');
  const historical = add(f.core, 'historical'), filed = add(f.core, 'filed');
  f.db.prepare("UPDATE memories SET currentness='historical' WHERE id=?").run(historical.id);
  f.db.prepare("UPDATE memories SET filing_status='filed' WHERE id=?").run(filed.id);
  order(f, [first], f.denied, [historical], [last], [filed]);
  const filters = { limit: 1, states: ['active'], statuses: ['unfiled'] };
  const page = list(f, filters);
  assert.deepEqual(ids(page), [first.id]);
  const next = list(f, { ...filters, cursor: page.nextCursor });
  assert.deepEqual(ids(next), [last.id]);
  assert.equal(next.exhausted, true);
});

test('6. Refill preserves the awaiting review filter', async t => {
  const f = await deniedFixture(t, ['decision']);
  const [first, last] = await f.capture('independent-decisions', ['decision', 'decision']);
  const distractor = add(f.core, 'visible-outside-review');
  assert.equal(ok(read(f.core, first)).memory.reviewState, 'awaiting');
  order(f, [first], f.denied, [distractor], [last]);
  const filters = { limit: 1, reviewState: 'awaiting' };
  const page = list(f, filters);
  assert.deepEqual(ids(page), [first.id]);
  const next = list(f, { ...filters, cursor: page.nextCursor });
  assert.deepEqual(ids(next), [last.id]);
  assert.equal(next.exhausted, true);
});

test('7. A write between pages still makes the cursor stale', async t => {
  const f = await deniedFixture(t);
  const first = add(f.core, 'visible-first'), second = add(f.core, 'visible-second');
  order(f, [first], [second], f.denied);
  const page = list(f, { limit: 1 });
  assert.deepEqual(ids(page), [first.id]);
  add(f.core, 'write-between-pages');
  const stale = f.core.list({ namespace: ns, limit: 1, cursor: page.nextCursor });
  assert.equal(stale.ok, false, JSON.stringify(stale));
  assert.equal(stale.error.code, 'cursor_stale');
});

function traceList(core, input) {
  const statements = [], prepare = DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.prepare = function(sql) {
    const statement = prepare.call(this, sql);
    return new Proxy(statement, { get(target, name) {
      const value = Reflect.get(target, name, target);
      if (typeof value !== 'function') return value;
      return (...bindings) => {
        if (['get', 'all', 'run', 'iterate'].includes(name)) statements.push({ sql, name, bindings });
        return Reflect.apply(value, target, bindings);
      };
    } });
  };
  try { return { page: ok(core.list({ namespace: ns, ...input })), statements }; }
  finally { DatabaseSync.prototype.prepare = prepare; }
}

for (const raw of [false, true]) {
  test(`Parity: one page query per list call on a ${raw ? 'Raw' : 'legacy'} store with no denied rows`, async t => {
    const workspace = raw ? null : createTestWorkspace(t);
    const { core } = raw ? await rawFixture(t) : { core: openMemoryCore({ path: join(workspace.path, 'store.sqlite') }) };
    if (workspace) workspace.defer(() => core.close());
    add(core, 'first');
    add(core, 'second');
    const first = traceList(core, { limit: 1 });
    assert.equal(first.page.exhausted, false);
    const second = traceList(core, { limit: 1, cursor: first.page.nextCursor });
    assert.equal(second.page.exhausted, true);
    const [last] = first.page.memories;
    for (const [index, call] of [first, second].entries()) {
      const queries = call.statements.filter(({ sql }) => sql.includes('ORDER BY updated_at DESC, id ASC LIMIT ?'));
      assert.equal(queries.length, 1);
      assert.equal(queries[0].name, 'all');
      assert.deepEqual(queries[0].bindings, [ns.ownerId, ns.scope, ns.projectId, 'filed', 'unfiled',
        ...(index ? [last.updatedAt, last.updatedAt, last.id] : []), 2]);
    }
    t.diagnostic(`Page query counts: 1, 1. Prepared executions per public list call: ${first.statements.length}, ${second.statements.length}.`);
  });
}
