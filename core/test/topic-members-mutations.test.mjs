import assert from 'node:assert/strict';
import test from 'node:test';
import { memberFixture, smallHierarchy, namespace, overview, collectMembers, expected, ok } from '../testing/topic-members-fixture.mjs';
import { STORAGE_BUSY_TIMEOUT_MS } from '../database.mjs';
import { rawOverviewFixture, namespace as rawNamespace } from '../testing/topic-overview-raw29-fixture.mjs';

const base = { namespace, selection: { type: 'unfiled' }, accessRevision: 'g' };
const stale = { ok: false, error: { code: 'cursor_stale' } };
for (const mode of ['DELETE', 'WAL']) {
  for (const change of ['correct', 'forget', 'supersede', 'filed-filed', 'filed-unfiled', 'unfiled-filed', 'edge', 'review']) {
    test(`E1M-04 E1M-08 ${mode} ${change} invalidates emitting and work-only cursors before replay`, async t => {
      const f = memberFixture(t, { mode }), h = smallHierarchy(f), reader = f.reader();
      const issued = await overview(reader), root = issued.items.find(n => n.id === h.root.id);
      const input = { ...base, selection: expected(root), limit: 1 };
      const emitting = ok(await reader.readTopicMembers(input)); assert.equal(emitting.items.length, 1); assert.ok(emitting.nextCursor);
      const replayInput = { ...input, cursor: emitting.nextCursor };
      ok(await reader.readTopicMembers(replayInput));
      const workReader = f.reader(), workInput = { ...input, workLimit: 16 };
      const work = ok(await workReader.readTopicMembers(workInput)); assert.equal(work.status, 'partial');
      let successor;
      if (change === 'correct') ok(f.core.correct({ namespace, memoryId: h.a.id, expectedRevision: h.a.revision,
        content: 'Corrected synthetic', kind: 'instruction', receipt: { client: 'manual', sessionId: 'correct', eventId: 'correct', role: 'user', excerpt: 'Correction.' } }));
      if (change === 'forget') ok(f.core.forget({ namespace, memoryId: h.a.id, expectedRevision: h.a.revision }));
      if (change === 'supersede') successor = ok(f.core.supersede({ namespace, memoryId: h.a.id, expectedRevision: h.a.revision,
        replacement: { content: 'Replacement synthetic', kind: 'fact' }, receipts: [{ client: 'manual', sessionId: 'replace', eventId: 'replace', role: 'user', excerpt: 'Replacement.' }] }));
      if (change === 'filed-filed') {
        const before = f.memory(h.a).revision;
        f.place(namespace, [{ memoryId: h.a.id, parentIds: [h.l2.id] }]);
        assert.equal(f.memory(h.a).revision, before, 'membership fence cannot rely on Memory revision');
      }
      if (change === 'filed-unfiled') f.place(namespace, [{ memoryId: h.a.id, parentIds: [] }]);
      if (change === 'unfiled-filed') f.place(namespace, [{ memoryId: h.u.id, parentIds: [h.l1.id] }]);
      if (change === 'edge') {
        // A new L2 is linked to an existing child via the public API.
        const row = f.admit('new-root-source');
        const newRoot = f.place(namespace, [{ memoryId: row.id, parentIds: [], newL1: { title: 'extra', parentL2Ids: [], newL2Title: 'other root' } }]).createdMocs.find(n => n.level === 'L2');
        const current = await overview(f.reader());
        const child = current.items.find(n => n.id === h.l1.id);
        ok(f.core.linkMocs({ namespace, parentId: newRoot.id, expectedParentRevision: newRoot.revision,
          childId: child.id, expectedChildRevision: child.revision, expectedIndexRevision: current.snapshot.indexRevision }));
      }
      if (change === 'review') {
        // Existing public review API is tested separately below; direct malformed/visibility fixture uses the same epoch fence.
        f.db.prepare("UPDATE memories SET review_state='awaiting' WHERE id=?").run(h.a.id);
        f.db.prepare('UPDATE namespace_epochs SET epoch=epoch+1 WHERE owner_id=?').run(namespace.ownerId);
      }
      assert.deepEqual(await reader.readTopicMembers(replayInput), stale);
      assert.deepEqual(await workReader.readTopicMembers({ ...workInput, cursor: work.nextCursor }), stale);
      const fresh = await overview(reader), node = fresh.items.find(n => n.id === root.id);
      const refs = await collectMembers(reader, { ...base, selection: expected(node), expectedSnapshot: fresh.snapshot });
      assert.equal(refs.items.length, node.descendantCounts.total);
      if (['correct', 'forget', 'supersede', 'filed-unfiled', 'review'].includes(change)) assert.equal(refs.items.some(row => row.id === h.a.id), false);
      const unfiled = await collectMembers(reader, { ...base, expectedSnapshot: fresh.snapshot });
      assert.equal(unfiled.items.length, fresh.totals.unfiled.total);
      if (change === 'correct') assert.equal(unfiled.items.find(row => row.id === h.a.id).kind, 'instruction');
    });
  }
  test(`E1M-04 E1M-05 ${mode} no-op and other namespace keep cursors; initial/replacement rebuild fences`, async t => {
    const f = memberFixture(t, { mode }), h = smallHierarchy(f), reader = f.reader();
    let input = { ...base, limit: 1, workLimit: 16 }, first = ok(await reader.readTopicMembers(input));
    f.place(namespace, [{ memoryId: h.a.id, parentIds: [h.l1.id] }]);
    f.admit('unrelated', 'fact', { ...namespace, scope: 'project', projectId: 'other' });
    assert.equal((await reader.readTopicMembers({ ...input, cursor: first.nextCursor })).ok, true);
    first = ok(await reader.readTopicMembers(input));
    let epoch = (await overview(reader)).snapshot.indexRevision;
    let building = ok(f.core.rebuildIndex({ namespace, expectedIndexRevision: epoch, limit: 1 }));
    assert.equal(building.exhausted, false);
    assert.deepEqual(await reader.readTopicMembers({ ...input, cursor: first.nextCursor }), stale);
    assert.equal((await reader.readTopicMembers(base)).error.code, 'index_unavailable');
    while (!building.exhausted) building = ok(f.core.rebuildIndex({ namespace, expectedIndexRevision: epoch, limit: 1, cursor: building.nextCursor }));
    const issued = await overview(reader); epoch = issued.snapshot.indexRevision;
    input = { ...base, limit: 1, expectedSnapshot: issued.snapshot, workLimit: 16 };
    first = ok(await reader.readTopicMembers(input));
    const continuation = { ...input, cursor: first.nextCursor }, cached = await reader.readTopicMembers(continuation);
    building = ok(f.core.rebuildIndex({ namespace, expectedIndexRevision: epoch, limit: 1 }));
    assert.equal(building.exhausted, false);
    assert.deepEqual(await reader.readTopicMembers(continuation), cached, 'replacement staging retains active authority');
    while (!building.exhausted) building = ok(f.core.rebuildIndex({ namespace, expectedIndexRevision: epoch, limit: 1, cursor: building.nextCursor }));
    assert.deepEqual(await reader.readTopicMembers(continuation), stale);
    assert.notEqual((await overview(reader)).snapshot.generation, issued.snapshot.generation);
  });
}

test('E1M-04 public retained source deletion invalidates members and removes last support', async t => {
  const f = rawOverviewFixture(t, { matching: true }); f.db.exec(`PRAGMA busy_timeout=${STORAGE_BUSY_TIMEOUT_MS}`);
  const a = await f.capture('a', 'one'), b = await f.capture('a', 'two');
  assert.equal(a.id, b.id);
  const reader = f.reader(), input = { ...base, namespace: rawNamespace, workLimit: 16 };
  const first = ok(await reader.readTopicMembers(input));
  await f.remove(a.conversationId);
  assert.deepEqual(await reader.readTopicMembers({ ...input, cursor: first.nextCursor }), stale);
  assert.equal((await collectMembers(reader, { ...input, workLimit: 5000 })).items.length, 1);
  await f.remove(b.conversationId, 'remove-last');
  assert.equal((await collectMembers(reader, { ...input, workLimit: 5000 })).items.length, 0);
});

test('E1M-04 public awaiting-to-confirmed transition invalidates both cursor kinds and exposes current confirmed revision', async t => {
  const {rationaleModel}=await import('../testing/rationale-model.mjs');
  const f=memberFixture(t,{coreOptions:{decisionReview:'required-v1',model:{...rationaleModel(),extract:()=>({items:[{content:'Synthetic pending decision',kind:'decision',confidence:.8,sourceIndices:[0]}]})}}});
  smallHierarchy(f);f.admit('second-unfiled');
  ok(await f.core.capture({namespace,client:'scripted',sessionId:'review',eventId:'review',messages:[{id:'review',role:'user',content:'Synthetic pending decision'}]}));
  const waiting=ok(f.core.list({namespace,reviewState:'awaiting'})).memories[0];assert.ok(waiting);
  const reader=f.reader(),input={...base,limit:1},first=ok(await reader.readTopicMembers(input));
  const workReader=f.reader(),workInput={...input,workLimit:16},work=ok(await workReader.readTopicMembers(workInput));
  const confirmed=ok(f.core.confirm({namespace,memoryId:waiting.id,expectedRevision:waiting.revision,actionId:'confirm',receipt:{client:'person',sessionId:'review',eventId:'confirm',role:'user',excerpt:'I confirm this decision.'}}));
  assert.deepEqual(await reader.readTopicMembers({...input,cursor:first.nextCursor}),stale);
  assert.deepEqual(await workReader.readTopicMembers({...workInput,cursor:work.nextCursor}),stale);
  const result=await collectMembers(reader,base);
  assert.equal(result.items.find(row=>row.id===waiting.id).revision,confirmed.memory.revision);
});
