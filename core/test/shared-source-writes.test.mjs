import nodeTest from "node:test";
import assert from "node:assert/strict";
import { ns, ok, receipt } from "../testing/card-lineage-fixture.mjs";
import { contentSafetyFacade } from "../content-safety-boundary.mjs";
import { transaction } from "../database.mjs";
import { receiptDenialTokens } from "../content-safety.mjs";
import { forgotten, message, kinds, operations, insertSQL, receiptSQL, isLookup, otherNamespace, otherOwner, trace, fixture, capture, act, markers, originalRow } from "../testing/shared-source-fixture.mjs";
// A pending adapter/worker call must fail the case within the file budget.
const test=(name,run)=>nodeTest(name,{timeout:15000},run);

for (const kind of kinds) for (const operation of operations) test(`shared source ${operation} statement additions and rollback ${kind}`, async t => {
  const f = await fixture(t, kind, operation), [, a] = await capture(f);
  const failed = await trace(() => act(f, operation, a), sql => {
    if (sql === insertSQL) throw Error('synthetic rollback');
  });
  assert.equal(failed.result.ok, false);
  assert.equal(failed.rows.filter(row => row.sql === insertSQL).length, 1, 'rollback occurs after marker insert');
  assert.deepEqual(markers(f), [], 'rollback retains no source denial');
  const measured = await trace(() => act(f, operation, a));
  ok(measured.result);
  const added = measured.rows.filter(row => row.sql === insertSQL || row.sql === receiptSQL);
  const packaged = kind.endsWith('-53') || kind === 'ordinary-48';
  const reusedRootRead = kind === 'ordinary-33' || kind === 'raw-33';
  assert.deepEqual(added.map(row => row.sql), reusedRootRead ? [insertSQL] : [receiptSQL, insertSQL]);
  assert.equal(added.length - Number(packaged), packaged || reusedRootRead ? 1 : 2,
    'reuse an existing receipt scan; add a receipt read only where main has none');
  if (reusedRootRead) assert.ok(measured.rows.some(row => row.sql === 'SELECT * FROM receipts WHERE memory_id=?'));
  assert.equal(measured.rows.filter(row => row.sql === 'SELECT id FROM receipts WHERE memory_id=?').length, 0);
  assert.equal(measured.rows.filter(row => row.sql === insertSQL)[0].args[3] &&
    JSON.parse(measured.rows.find(row => row.sql === insertSQL).args[3]).length, 2);
  assert.equal(measured.rows.some(isLookup), false, 'no evidence lookup for simple terminal acknowledgement');
  if (operation === 'forget') for (const input of [{ memoryId: a.id }, { memoryId: 'synthetic-missing' }]) {
    const repeated = await trace(() => f.core.forget({ namespace: ns, expectedRevision: a.revision, ...input }));
    ok(repeated.result);
    assert.equal(repeated.rows.some(row => row.sql === insertSQL || row.sql === receiptSQL), false);
  }
});

for (const operation of operations) test(`missing/stale targets add no denial ${operation}`, async t => {
  const f = await fixture(t, 'ordinary-53', operation), [, a] = await capture(f);
  const result = await trace(() => act(f, operation, { ...a, revision: a.revision + 1 }));
  assert.equal(result.result.error?.code, 'revision_conflict');
  assert.equal(result.rows.some(row => row.sql === insertSQL), false);
  const missing = await trace(() => act(f, operation, { ...a, id: 'synthetic-missing' }));
  assert.equal(missing.rows.some(row => row.sql === insertSQL), false);
  if (operation === 'reject') {
    ok(await act(f, 'reject', a));
    const rows = markers(f), repeat = await trace(() => act(f, 'reject', a));
    ok(repeat.result); assert.deepEqual(markers(f), rows);
    assert.equal(repeat.rows.some(row => row.sql === insertSQL), false);
  }
});

test('package verifier refuses unrelated marker inserts without gating canonical output', async t => {
  const f = await fixture(t, 'ordinary-53');
  const api = contentSafetyFacade({ forget() { return transaction(f.db, () => {
    f.db.prepare('INSERT INTO suppressed VALUES(?,?,?,?)').run(ns.ownerId, ns.scope, ns.projectId, 'rs1:i:' + '0'.repeat(64));
    return { ok: true, value: { forgotten: true } };
  }); } }, { check() {}, failure: error => ({ ok: false, error: { code: error.code } }) });
  assert.equal(api.forget({ namespace: ns }).error?.code, 'evidence_unavailable');
  assert.deepEqual(markers(f), []);
  const [, a] = await capture(f);
  let injected = false;
  const forged = await trace(() => act(f, 'forget', a), (sql, args, writer) => {
    if (sql === insertSQL && !injected) {
      injected = true;
      writer.prepare('INSERT INTO suppressed VALUES(?,?,?,?)').run(ns.ownerId, ns.scope, ns.projectId, 'rs1:a:' + '0'.repeat(64));
    }
  });
  assert.equal(forged.result.error?.code, 'evidence_unavailable');
  assert.deepEqual(markers(f), []);
  ok(await act(f, 'forget', a));
  const retained = f.db.prepare('SELECT * FROM receipts WHERE excerpt=?').get(message);
  const exposed = contentSafetyFacade({ admit() { return transaction(f.db, () => ({
    memory: { id: retained.memory_id }, deduplicated: false, insertedReceiptIds: [retained.id],
  })); } }, { check() {}, failure: error => ({ ok: false, error: { code: error.code } }) });
  const before = markers(f);
  assert.deepEqual(exposed.admit({ namespace: ns }), { memory: { id: retained.memory_id }, deduplicated: false, insertedReceiptIds: [retained.id] },
    'canonical output validation does not consult delivery markers');
  assert.deepEqual(markers(f), before, 'canonical output acceptance grants no marker insertion authority');
});

for (const kind of ['ordinary-53', 'ordinary-48']) for (const mutation of ['other-receipt', 'namespace', 'owner', 'fingerprint', 'malformed', 'update', 'remove'])
test(`package verifier rolls back ${mutation} during forget ${kind}`, async t => {
  const f = await fixture(t, kind), [b, a] = await capture(f);
  const independentMemory = ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic unrelated target', kind: 'fact' },
    receipts: [receipt('synthetic-other-target')] })).memory;
  const other = f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').get(independentMemory.id);
  const own = f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').get(a.id);
  const token = receiptDenialTokens([own])[1], retained = 'rs1:a:' + '1'.repeat(64);
  f.db.prepare('INSERT INTO suppressed VALUES(?,?,?,?)').run(ns.ownerId, ns.scope, ns.projectId, retained);
  const before = f.db.prepare('SELECT * FROM suppressed ORDER BY owner_id,scope,project_id,fingerprint').all();
  const memoryBefore = originalRow(f, a);
  let injected = false;
  const forged = await trace(() => act(f, 'forget', a), (sql, args, writer) => {
    if (sql !== insertSQL || injected) return;
    injected = true;
    if (mutation === 'update') writer.prepare('UPDATE suppressed SET fingerprint=? WHERE fingerprint=?').run('rs1:a:' + '2'.repeat(64), retained);
    else if (mutation === 'remove') writer.prepare('DELETE FROM suppressed WHERE fingerprint=?').run(retained);
    else writer.prepare('INSERT INTO suppressed VALUES(?,?,?,?)').run(
      mutation === 'owner' ? otherOwner.ownerId : ns.ownerId, ns.scope,
      mutation === 'namespace' ? otherNamespace.projectId : ns.projectId,
      mutation === 'other-receipt' ? receiptDenialTokens([other])[0] : mutation === 'fingerprint' ? '3'.repeat(64)
        : mutation === 'malformed' ? 'rs1:a:invalid' : token);
  });
  assert.equal(injected, true);
  assert.equal(forged.result.error?.code, 'evidence_unavailable');
  assert.deepEqual(f.db.prepare('SELECT * FROM suppressed ORDER BY owner_id,scope,project_id,fingerprint').all(), before);
  assert.deepEqual(originalRow(f, a), memoryBefore);
  assert.equal(ok(f.core.get({ namespace: ns, memoryId: b.id })).receipts[0].excerpt, message);
});
