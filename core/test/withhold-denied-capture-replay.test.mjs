import test from 'node:test';
import assert from 'node:assert/strict';
import { openRawCaptureCore } from '../raw-capture.mjs';
import { migrateCardLineage } from '../content-safety-migration.mjs';
import { attestContentSafety } from '../content-safety-schema.mjs';
import { copySqliteFixture, ns, ok, quiescence, safetyFixture } from '../testing/content-safety-s2h-fixture.mjs';
import { localPlainPort, request, splitRaw } from '../testing/raw-capture-fixtures.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';

const read = (core, memory) => core.get({ namespace: ns, memoryId: memory.id, includeAwaiting: true });

async function rawFixture(t, extraModel = {}) {
  const f = safetyFixture(t, 33);
  copySqliteFixture(f.path, f.backupPath);
  await migrateCardLineage({ path: f.path, backupPath: f.backupPath,
    expected: { storeId: f.storeId, base: 33 }, quiescence });
  let items;
  const port = localPlainPort();
  const core = openRawCaptureCore({ path: f.path, decisionReview: 'required-v1',
    model: { ...rationaleModel(), extract: () => ({ items }), ...extraModel } },
  { mode: 'raw-v1', lineage: true, port,
    readPolicy: () => ({ generation: 'synthetic', reason: null }) });
  f.workspace.defer(() => core.close());
  const db = f.connect();
  f.workspace.defer(() => db.close());
  attestContentSafety(db);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 53);
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

test('a later Raw turn and a fresh replay of it survive forgetting a previous turn', async t => {
  const f = await rawFixture(t);
  const shared = f.input('shared', ['fact', 'fact']);
  const [forgotten, denied] = ok(ok(await f.core.captureRaw(shared)).interpretation).admission.memories;
  await deny(f, forgotten, [denied]);
  const exact = await f.core.captureRaw(structuredClone(shared));
  const exactCode = exact.error?.code ?? exact.value?.interpretation?.error?.code;
  t.diagnostic('exact recapture: ' + exactCode);
  assert.equal(exactCode, 'evidence_unavailable');
  assert.ok(!JSON.stringify(exact).includes(denied.id));
  const later = f.input('later', ['fact'], { sessionId: shared.sessionId, ordinal: 2 });
  let admittedId;
  await twice(t, () => f.core.captureRaw(structuredClone(later)), result => {
    const interpretation = ok(ok(result).interpretation);
    const memberIds = interpretation.memoryIds ?? interpretation.admission.memories.map(memory => memory.id);
    assert.equal(memberIds.length, 1);
    if (admittedId === undefined) admittedId = interpretation.admission.memories[0].id;
    assert.deepEqual(memberIds, [admittedId]);
    assert.ok(!memberIds.includes(denied.id) && !memberIds.includes(forgotten.id));
    assert.match(ok(read(f.core, { id: memberIds[0] })).memory.content, /synthetic later/);
  });
});
