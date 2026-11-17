import nodeTest from "node:test";
import assert from "node:assert/strict";
import { openMemoryCore } from "../index.mjs";
import { ns, ok, receipt } from "../testing/card-lineage-fixture.mjs";
import { transaction } from "../database.mjs";
import { receiptDenialTokens } from "../content-safety.mjs";
import { survivor, forgotten, message, ordinaryKinds, isLookup, source, otherOwner, key, noLeak, hasId, trace, fixture, capture, act, markers, originalRow } from "../testing/shared-source-fixture.mjs";
// A pending adapter/worker call must fail the case within the file budget.
const test=(name,run)=>nodeTest(name,{timeout:15000},run);

for (const kind of ordinaryKinds) test(`denial is durable before a sibling exists ${kind}`, async t => {
  const f = await fixture(t, kind);
  f.model.items = [{ content: forgotten, kind: 'fact', confidence: .8, sourceIndices: [0] }];
  const [a] = await capture(f);
  ok(await act(f, 'forget', a));
  assert.equal(markers(f).length, 2);
  const reopened = openMemoryCore({ path: f.path, model: f.model });
  t.after(() => reopened.close());
  f.model.items = [{ content: survivor, kind: 'fact', confidence: .8, sourceIndices: [0] }];
  const captured = ok(await reopened.capture({ namespace: ns, client: 'synthetic', sessionId: 'synthetic-session',
    eventId: 'synthetic-later-batch', messages: [{ id: 'synthetic-message', role: 'user', content: forgotten + '. Another window.' }] }));
  noLeak(captured, 'reopened capture result');
  const b = captured.admission.memories[0];
  assert.equal(f.db.prepare('SELECT count(*) n FROM receipts WHERE memory_id=?').get(b.id).n, 1);
  assert.deepEqual(ok(reopened.get({ namespace: ns, memoryId: b.id })).receipts, []);
  for (const patch of [{ client: 'synthetic-other-client' }, { role: 'assistant' }, { sessionId: 'synthetic-other-session' }, { eventId: 'synthetic-other-message' }]) {
    const memory = ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic independent ' + Object.keys(patch)[0], kind: 'fact' },
      receipts: [{ ...source(), ...patch }] })).memory;
    assert.equal(ok(f.core.get({ namespace: ns, memoryId: memory.id })).receipts[0].excerpt, message);
  }
});

test('denial tokens are portable, message-addressed, and disjoint from Memory fingerprints', () => {
  const row = { receipt_key: key(source()), client: 'synthetic', session_id: 'synthetic-session',
    event_id: 'synthetic-message', role: 'user' };
  const tokens = receiptDenialTokens([row, row]);
  assert.equal(tokens.length, 2);
  assert.ok(tokens.every(token => !/^[0-9a-f]{64}$/.test(token)));
  assert.equal(tokens[1], 'rs1:a:' + key(['receipt-source-address-v1', row.client, row.session_id, row.event_id, row.role]));
  for (const field of ['client', 'session_id', 'event_id', 'role']) assert.notEqual(
    receiptDenialTokens([{ ...row, [field]: row[field] + '-other' }])[1], tokens[1]);
});

for (const kind of ordinaryKinds) test(`owner re-key preserves source denial ${kind}`, async t => {
  const f = await fixture(t, kind), [b, a] = await capture(f);
  ok(await act(f, 'forget', a));
  const retained = markers(f);
  if (kind === 'ordinary-53' || kind === 'ordinary-48') {
    // Native identity guards deliberately refuse in-place owner updates.
    // Compare real independent stores instead of bypassing those guards.
    const separate = await fixture(t, kind);
    const other = [f, separate].map(store => ({ store,
      b: ok(store.core.admit({ namespace: otherOwner, memory: { content: survivor, kind: 'fact' }, receipts: [source()] })).memory,
      a: ok(store.core.admit({ namespace: otherOwner, memory: { content: forgotten, kind: 'fact' }, receipts: [source()] })).memory,
    }));
    const original = f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').get(b.id);
    for (const { store, b: sibling, a: target } of other) {
      const own = store.db.prepare('SELECT * FROM receipts WHERE memory_id=?').get(target.id);
      assert.deepEqual(receiptDenialTokens([own]), receiptDenialTokens([original]), 'owner/store independent bytes');
      assert.equal(ok(store.core.get({ namespace: otherOwner, memoryId: sibling.id })).receipts[0].excerpt, message,
        'another owner denial is neither needed nor consulted');
      const forgotten = await store.core.forget({ namespace: otherOwner, memoryId: target.id, expectedRevision: target.revision });
      ok(forgotten);
      assert.deepEqual(markers(store, otherOwner), retained, 'same fingerprints, each in its own owner boundary');
      const measured = await trace(() => store.core.get({ namespace: otherOwner, memoryId: sibling.id }));
      assert.deepEqual(ok(measured.result).receipts, []);
      for (const row of measured.rows.filter(isLookup)) {
        if(row.sql.startsWith('SELECT s.owner_id')) assert.ok(JSON.parse(row.args[0]).every(tuple=>
          JSON.stringify(tuple.slice(0,3))===JSON.stringify([otherOwner.ownerId,otherOwner.scope,otherOwner.projectId??''])));
        else assert.deepEqual(row.args.slice(1), [otherOwner.ownerId, otherOwner.scope, otherOwner.projectId]);
      }
      assert.ok(measured.rows.some(isLookup), 'withholding performs the scoped lookup');
    }
    assert.deepEqual(markers(separate), [], 'other store never required the first owner rows');
    return;
  }
  // Receipts have no owner column: their unchanged memory_id points to the
  // re-keyed parent. A host moves the complete account boundary together.
  transaction(f.db, () => {
    f.db.prepare('UPDATE memories SET owner_id=? WHERE owner_id=?').run(otherOwner.ownerId, ns.ownerId);
    f.db.prepare('UPDATE suppressed SET owner_id=? WHERE owner_id=?').run(otherOwner.ownerId, ns.ownerId);
  });
  assert.deepEqual(markers(f, otherOwner), retained);
  assert.deepEqual(markers(f), []);
  assert.deepEqual(ok(f.core.get({ namespace: otherOwner, memoryId: b.id })).receipts, []);
  assert.equal(f.core.get({ namespace: ns, memoryId: b.id }).error?.code, 'memory_not_found');
  const oldList = f.core.list({ namespace: ns, limit: 20 });
  noLeak(oldList, 'old owner after re-key');
  assert.equal(hasId(oldList, b.id), false, 'old owner cannot list the moved Memory');
  const moved = ok(f.core.admit({ namespace: otherOwner, memory: { content: 'Synthetic moved signal', kind: 'fact' }, receipts: [source('Different window')] })).memory;
  assert.deepEqual(ok(f.core.get({ namespace: otherOwner, memoryId: moved.id })).receipts, []);
  const old = ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic new account signal', kind: 'fact' }, receipts: [source()] })).memory;
  assert.equal(ok(f.core.get({ namespace: ns, memoryId: old.id })).receipts[0].excerpt, message);
});

for (const kind of ordinaryKinds) test(`markers never suppress unrelated text ${kind}`, async t => {
  const f = await fixture(t, kind);
  const unrelated = 'Synthetic text with unrelated fingerprint';
  const real = 'Synthetic real suppressed fingerprint';
  const realMemory = ok(f.core.admit({ namespace: ns,
    memory: { content: real, kind: 'fact' }, receipts: [receipt('synthetic-real-fingerprint')] })).memory;
  ok(f.core.forget({ namespace: ns, memoryId: realMemory.id, expectedRevision: realMemory.revision }));
  const before = [unrelated, real].map(content => f.core.isSuppressed({ namespace: ns, content }));
  assert.deepEqual(before.map(result => ok(result).suppressed), [false, true]);
  for (let index = 0; index < 40; index++) for (const token of receiptDenialTokens([{ receipt_key: key(index), client: 'synthetic',
    session_id: 'synthetic-session', event_id: 'synthetic-' + index, role: 'user' }])) {
    assert.ok(token.startsWith('rs1:'));
    // A colon and an r cannot occur in the alphabet of any 64-hex value.
    assert.equal(/^[0-9a-f]{64}$/.test(token), false);
    f.db.prepare('INSERT INTO suppressed VALUES(?,?,?,?)').run(ns.ownerId, ns.scope, ns.projectId, token);
  }
  assert.deepEqual([unrelated, real].map(content => f.core.isSuppressed({ namespace: ns, content })), before,
    'the production forgotten-text read is identical with many marker rows');
  const measured = await trace(() => f.core.admit({ namespace: ns,
    memory: { content: unrelated, kind: 'fact' },
    receipts: [receipt('synthetic-fingerprint-control')] }));
  const memory = ok(measured.result).memory, row = originalRow(f, memory);
  assert.match(row.fingerprint, /^[0-9a-f]{64}$/);
  const suppression = measured.rows.find(entry => /^SELECT 1 FROM suppressed WHERE /.test(entry.sql));
  assert.ok(suppression, 'admission executes its real exact fingerprint lookup');
  assert.deepEqual(suppression.args, [ns.ownerId, ns.scope, ns.projectId, row.fingerprint]);
  const lookup = f.db.prepare(suppression.sql);
  for (const value of [row.fingerprint, '0'.repeat(64), 'f'.repeat(64)])
    assert.equal(lookup.get(ns.ownerId, ns.scope, ns.projectId, value), undefined, 'markers never match fingerprint lookup');
  f.model.items = [{ content: 'Synthetic captured unrelated fingerprint', kind: 'fact', confidence: .8, sourceIndices: [0] }];
  const [captured] = await capture(f, 'synthetic-unrelated-capture', 'Synthetic unrelated source');
  assert.ok(captured, 'capture admission also succeeds among marker rows');
  const suppressed = 'a'.repeat(64);
  f.db.prepare('INSERT INTO suppressed VALUES(?,?,?,?)').run(ns.ownerId, ns.scope, ns.projectId, suppressed);
  assert.ok(lookup.get(ns.ownerId, ns.scope, ns.projectId, suppressed), 'real content suppression still matches');
  assert.equal(ok(f.core.get({ namespace: ns, memoryId: memory.id })).memory.content, row.content);
});

for (const kind of ordinaryKinds) test(`host owner erasure deletes source markers ${kind}`, async t => {
  const f = await fixture(t, kind), [, a] = await capture(f);
  ok(await act(f, 'forget', a));
  f.db.prepare('INSERT INTO suppressed VALUES(?,?,?,?)').run(otherOwner.ownerId, ns.scope, ns.projectId, 'rs1:a:' + '0'.repeat(64));
  assert.equal(markers(f).length, 2);
  // The engine has no account-deletion facade. Exercise the host's owner-keyed
  // logical deletion of Memory, receipt and suppressed data on this connection.
  transaction(f.db, () => {
    f.db.prepare('DELETE FROM receipts WHERE memory_id IN (SELECT id FROM memories WHERE owner_id=?)').run(ns.ownerId);
    f.db.prepare('DELETE FROM memories WHERE owner_id=?').run(ns.ownerId);
    f.db.prepare('DELETE FROM suppressed WHERE owner_id=?').run(ns.ownerId);
  });
  assert.equal(f.db.prepare('SELECT count(*) n FROM suppressed WHERE owner_id=?').get(ns.ownerId).n, 0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM memories WHERE owner_id=?').get(ns.ownerId).n, 0);
  assert.equal(markers(f, otherOwner).length, 1);
});
