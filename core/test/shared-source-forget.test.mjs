import nodeTest from "node:test";
import assert from "node:assert/strict";
import { ns, ok, receipt } from "../testing/card-lineage-fixture.mjs";
import { survivor, forgotten, message, independent, ordinaryKinds, operations, source, otherNamespace, otherOwner, noLeak, hasId, fixture, capture, act, markers, memoryRef, originalRow, reads } from "../testing/shared-source-fixture.mjs";
// A pending adapter/worker call must fail the case within the file budget.
const test=(name,run)=>nodeTest(name,{timeout:15000},run);

for (const kind of ordinaryKinds) for (const operation of operations) for (const extra of [false, true])
test(`shared source ${kind} ${operation}, independent=${extra}`, async t => {
  const f = await fixture(t, kind, operation);
  let [b, a] = await capture(f);
  if (extra) b = ok(f.core.admit({ namespace: ns, memory: { content: survivor, kind: 'fact' },
    receipts: [receipt('synthetic-independent', independent)] })).memory;
  const before = originalRow(f, b);
  const deniedReceipt = f.db.prepare('SELECT * FROM receipts WHERE memory_id=? AND excerpt=?').get(b.id, message);
  let oldRef;
  if (f.call) oldRef = ok(await f.call('fetchEvidence', { intent: 'current', refs: [memoryRef(b)] }))
    .items[0].provenance.sources.find(ref => ref.receiptId === deniedReceipt.id);
  ok(await act(f, operation, a));
  assert.deepEqual(originalRow(f, b), before, 'B statement, revision and all stored Memory fields unchanged');
  assert.equal(markers(f).length, 2);
  assert.ok(markers(f).every(token => /^rs1:[ia]:[0-9a-f]{64}$/.test(token)), 'content-free disjoint domains');
  const values = await reads(f, b, extra ? [independent] : []);
  for (const value of Object.values(values)) assert.equal(hasId(value, deniedReceipt.id), false, 'denied reference omitted');
  if (oldRef) {
    const empty = ok(await f.call('getSource', { source: oldRef }));
    assert.deepEqual(empty, { source: null, parts: [], coverage: { status: 'complete', completeness: oldRef.completeness,
      conversationCoverage: 'unknown', included: 0, omitted: 0 }, nextCursor: null });
    noLeak(empty, 'saved source reference');assert.equal(hasId(empty, deniedReceipt.id), false);
  }
});

for (const kind of ordinaryKinds) for (const operation of operations)
test(`shared source replay and isolation ${kind} ${operation}`, async t => {
  const f = await fixture(t, kind, operation), [b, a] = await capture(f);
  const others = [otherNamespace, otherOwner].map(namespace => ({ namespace,
    memory: ok(f.core.admit({ namespace, memory: { content: survivor, kind: 'fact' }, receipts: [source()] })).memory }));
  ok(await act(f, operation, a));
  const tokens = markers(f);
  f.model.items = [{ content: 'Synthetic newly extracted signal', kind: 'fact', confidence: .8, sourceIndices: [0] }];
  const [newMemory] = await capture(f, 'synthetic-new-batch', forgotten + '. Different excerpt window.');
  assert.equal(f.db.prepare('SELECT count(*) n FROM receipts WHERE memory_id=?').get(newMemory.id).n, 1, 'capture stores the denied attachment');
  assert.deepEqual(ok(f.core.get({ namespace: ns, memoryId: newMemory.id })).receipts, [], 'address denies a changed window');
  f.model.items = [{ content: survivor, kind: 'fact', confidence: .8, sourceIndices: [0] }];
  const [attached] = await capture(f, 'synthetic-attachment', forgotten + '. Another excerpt window.');
  assert.equal(attached.id, b.id, 'attaching denied evidence succeeds');
  assert.deepEqual(ok(f.core.get({ namespace: ns, memoryId: b.id })).receipts, []);
  assert.deepEqual(markers(f), tokens, 'capture adds no marker/provenance writes');
  for (const { namespace, memory } of others) {
    assert.equal(ok(f.core.get({ namespace, memoryId: memory.id })).receipts[0].excerpt, message);
    assert.deepEqual(markers(f, namespace), []);
  }
  const unrelated = ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic unrelated fingerprint', kind: 'fact' },
    receipts: [receipt('synthetic-unrelated')] })).memory;
  assert.equal(ok(f.core.get({ namespace: ns, memoryId: unrelated.id })).memory.revision, unrelated.revision);
  const late = ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic later sibling', kind: 'fact' }, receipts: [source()] })).memory;
  assert.deepEqual(ok(f.core.get({ namespace: ns, memoryId: late.id })).receipts, [], 'denial predates this sibling');
});
