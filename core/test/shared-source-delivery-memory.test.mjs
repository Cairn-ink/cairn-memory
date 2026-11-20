import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore, openMemoryStore } from '../index.mjs';
import { openDatabase } from '../database.mjs';
import { installedContentLayout } from '../content-safety-schema.mjs';
import { safetyFixture } from '../testing/content-safety-s2h-fixture.mjs';
import { migrateEventTime } from '../testing/receipt-event-time-fixture.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const namespace = { ownerId: 'synthetic-owner', scope: 'project', projectId: 'primary' };
const otherProject = { ...namespace, projectId: 'other' };
const survivor = 'Synthetic surviving observation';
const retired = 'Synthetic discarded observation';
const excerpt = 'Synthetic shared passage about a unique violet instrument.';
const source = { client: 'synthetic', sessionId: 'shared-session', eventId: 'shared-message', role: 'user', excerpt };
const ref = ({ id: memoryId, revision }) => ({ memoryId, revision });

function ok(result) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
}

async function fixture(t, physical) {
  const full = physical === 53 ? safetyFixture(t, 33) : null;
  const workspace = full?.workspace ?? createTestWorkspace(t, { prefix: 'receipt-delivery-' });
  const path = full?.path ?? join(workspace.path, 'store.sqlite');
  if (full) await migrateEventTime(full);
  else openDatabase(path, { localControls: true }).close();
  const ranked = [], selected = [];
  let count = () => 1, onRank = () => {};
  const model = {
    contextWindow: 8192,
    countTokens: text => count(text),
    extract: () => ({ items: [retired, survivor].map(content => ({ content, kind: 'fact', confidence: .8, sourceIndices: [0] })) }),
    select: ({ input }) => {
      selected.push(input);
      return { refs: input.maps.flatMap(page => page.items.flatMap(item => {
        if (item.type === 'unfiled') return [{ namespaceIndex: page.namespaceIndex, ...item.ref }];
        if (item.ref?.childType === 'memory') return [{ namespaceIndex: page.namespaceIndex,
          memoryId: item.ref.childId, revision: item.ref.childRevision }];
        return [];
      })) };
    },
    rank: ({ input }) => {
      ranked.push(input);
      onRank();
      return { refs: input.candidates.slice(0, input.limit).map(item => ({ namespaceIndex: item.namespaceIndex, ...ref(item.memory) })) };
    },
  };
  const core = openMemoryCore({ path, model }), db = new DatabaseSync(path);
  workspace.defer(() => { core.close(); db.close(); });
  assert.equal(installedContentLayout(db).physical, physical);
  const saved = ok(await core.capture({ namespace, client: source.client, sessionId: source.sessionId,
    eventId: 'organized-batch', messages: [{ id: source.eventId, role: source.role, content: excerpt }] }));
  assert.equal(saved.admission.memories.length, 2);
  const [a, b] = [retired, survivor].map(content => db.prepare('SELECT id,revision FROM memories WHERE content=?').get(content));
  const stored = memory => db.prepare('SELECT * FROM receipts WHERE memory_id=?').all(memory.id);
  assert.equal(stored(a).length, 1);
  assert.equal(stored(b).length, 1);
  assert.equal(stored(b)[0].receipt_key, stored(a)[0].receipt_key);
  assert.equal(stored(b)[0].excerpt, excerpt);
  const get = (memory, overrides) => ok(core.get({ namespace, memoryId: memory.id, ...overrides }));
  const recall = async () => ok(await core.recall({ readSet: [namespace], query: survivor, limit: 6 }));
  const markers = () => db.prepare("SELECT fingerprint FROM suppressed WHERE fingerprint GLOB 'rs1:*' ORDER BY fingerprint").all();
  const forget = () => ok(core.forget({ namespace, memoryId: a.id, expectedRevision: a.revision }));
  const attach = (receipts, target = namespace) => ok(core.admit({ namespace: target,
    memory: { content: survivor, kind: 'fact' }, receipts })).memory;
  return { core, db, a, b, stored, get, recall, forget, attach, markers, ranked, selected, path,
    onCount(callback) { count = callback; }, onRank(callback) { onRank = callback; } };
}

for (const physical of [29, 53]) {
  test(`layout ${physical}: a forgotten sibling withholds shared evidence from detail and recall`, async t => {
    const f = await fixture(t, physical);
    assert.deepEqual(f.markers(), []);
    assert.deepEqual(f.get(f.b).receipts.map(receipt => receipt.excerpt), [excerpt]);
    const before = await f.recall();
    assert.deepEqual(before.memories.find(item => item.memory.id === f.b.id).receipts.map(receipt => receipt.excerpt), [excerpt]);
    const other = f.attach([source], otherProject);
    f.forget();
    assert.equal(f.markers().length, 2);
    const detail = f.get(f.b);
    const recalled = await f.recall();
    const item = recalled.memories.find(value => value.memory.id === f.b.id);
    const rank = f.ranked.at(-1);
    assert.ok(item, 'the surviving Memory stays in recall');
    assert.ok(detail.memory.receiptCount >= 1);
    assert.equal(f.stored(f.b).length, 1);
    assert.deepEqual(f.get(other, { namespace: otherProject }).receipts.map(receipt => receipt.excerpt), [excerpt]);
    assert.equal(item.receipts[0].sessionId, 'withheld');
    assert.equal(item.receipts[0].eventId, 'withheld');
    assert.equal(item.receipts[0].excerpt, '[source not available]');
    assert.deepEqual(detail.receipts, []);
    for (const value of [detail, recalled, rank]) {
      assert.equal(JSON.stringify(value).includes(excerpt), false);
      assert.equal(JSON.stringify(value).includes(retired), false);
    }
  });

  test(`layout ${physical}: the complete Memory snapshot keeps the surviving Memory without its withdrawn source`, async t => {
    const f = await fixture(t, physical);
    const snapshot = () => ok(f.core.sourceSnapshot({ readSet: [namespace] }));
    assert.ok(snapshot().memories.some(item => item.memory.id === f.b.id && item.receipts[0].excerpt === excerpt));
    f.forget();
    const value = snapshot();
    const item = value.memories.find(item => item.memory.id === f.b.id);
    assert.ok(item);
    assert.deepEqual(item.receipts, []);
    assert.equal(JSON.stringify(value).includes(excerpt), false);
  });

  test(`layout ${physical}: plain fetch omits withheld receipt metadata`, async t => {
    const f = await fixture(t, physical);
    const id = f.stored(f.b)[0].id;
    const fetch = () => ok(f.core.fetch({ namespace, refs: [ref(f.b)] }));
    assert.equal(fetch().items[0].receipts[0].id, id);
    f.forget();
    assert.deepEqual(fetch().items[0].receipts, []);
  });

  test(`layout ${physical}: receipt-time lists exclude withdrawn receipt ids`, async t => {
    const f = await fixture(t, physical);
    const id = f.stored(f.b)[0].id;
    f.db.prepare("UPDATE receipts SET created_at='2025-09-03T00:00:00.000Z'").run();
    const list = () => ok(f.core.listMemoriesByTime({ namespace, timeBasis: 'receipt',
      since: '2025-09-01T00:00:00.000Z', until: '2025-10-01T00:00:00.000Z' }));
    assert.ok(list().items.some(item => item.receipt.id === id));
    f.forget();
    assert.equal(JSON.stringify(list()).includes(id), false);
  });

  test(`layout ${physical}: legacy reads withhold an address match without an identity match`, async t => {
    const f = await fixture(t, physical);
    const changed = 'Synthetic alternate excerpt at the same address.';
    f.attach([{ ...source, excerpt: changed }]);
    const legacy = openMemoryStore({ path: f.path });
    t.after(() => legacy.close());
    const scope = legacy.scope({ ownerId: namespace.ownerId, projectId: namespace.projectId });
    const reads = () => [scope.get(f.b.id), scope.list().find(memory => memory.id === f.b.id),
      scope.search('surviving').find(memory => memory.id === f.b.id)];
    for (const memory of reads()) assert.ok(memory.receipts.some(receipt => receipt.excerpt === changed));
    f.forget();
    for (const memory of reads()) assert.deepEqual(memory.receipts, []);
  });

  test(`layout ${physical}: source-scored recall navigation excludes marked excerpts`, async t => {
    const f = await fixture(t, physical);
    const run = () => f.core.recall({ readSet: [namespace], contextMode: 'source-evidence', query: 'violet instrument' });
    ok(await run());
    assert.ok(JSON.stringify(f.selected.at(-1).maps).includes('violet instrument'));
    f.forget();
    const result = await run();
    assert.equal(JSON.stringify(f.selected.at(-1).maps).includes('violet instrument'), false);
    assert.deepEqual(ok(result).memories, []);
  });

  for (const during of ['packing', 'ranking']) {
    test(`layout ${physical}: recall rechecks a marker committed during ${during}`, async t => {
      const f = await fixture(t, physical);
      let committed = false;
      const mark = () => {
        if (committed) return;
        const receipt = f.stored(f.b)[0];
        f.db.prepare('INSERT INTO suppressed VALUES(?,?,?,?)')
          .run(namespace.ownerId, namespace.scope, namespace.projectId, 'rs1:i:' + receipt.receipt_key);
        committed = true;
      };
      if (during === 'packing') f.onCount(text => {
        if (text.includes('"candidates"') && text.includes(excerpt)) mark();
        return 1;
      });
      else f.onRank(mark);
      const result = await f.core.recall({ readSet: [namespace], query: survivor, limit: 6 });
      assert.equal(committed, true);
      if (during === 'packing') assert.equal(f.ranked.length, 0);
      assert.equal(result.ok, false);
      assert.equal(result.error.code, 'revision_conflict');
      assert.equal(JSON.stringify(result).includes(excerpt), false);
    });
  }

  test(`layout ${physical}: receipt pages advance through visible evidence in the same session`, async t => {
    const f = await fixture(t, physical);
    const independent = [
      { ...source, eventId: 'different-message', excerpt: 'Synthetic different message in the same session.' },
      { ...source, sessionId: 'different-session', eventId: 'different-source', excerpt: 'Synthetic unrelated source.' },
    ];
    f.attach(independent);
    const [shared, ...others] = [f.stored(f.b).find(row => row.excerpt === excerpt),
      ...independent.map(receipt => f.stored(f.b).find(row => row.excerpt === receipt.excerpt))];
    f.db.prepare('UPDATE receipts SET created_at=? WHERE id=?').run('2020-01-01T00:00:00.000Z', shared.id);
    for (const [index, row] of others.entries()) {
      f.db.prepare('UPDATE receipts SET created_at=? WHERE id=?').run(`2020-01-0${index + 2}T00:00:00.000Z`, row.id);
    }
    assert.deepEqual(f.get(f.b, { receiptLimit: 1 }).receipts.map(receipt => receipt.id), [shared.id]);
    f.forget();
    const first = f.get(f.b, { receiptLimit: 1 });
    assert.ok(first.nextReceiptCursor);
    const second = f.get(f.b, { receiptLimit: 1, receiptCursor: first.nextReceiptCursor });
    assert.deepEqual(first.receipts.map(receipt => receipt.id), [others[0].id]);
    assert.deepEqual(second.receipts.map(receipt => receipt.id), [others[1].id]);
    assert.equal(second.nextReceiptCursor, null);
  });
}
