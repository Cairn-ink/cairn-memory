import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { openMemoryCore } from '../index.mjs';
import { sourceFixture, savedSource, ns as rawNamespace } from '../testing/raw-source-fixtures.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const ns = { ownerId: 'synthetic-safety', scope: 'personal', projectId: null };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const receipt = (eventId, excerpt) => ({ client: 'synthetic', sessionId: 'safety', eventId, role: 'user', excerpt });
function fixture(t) {
  const workspace = createTestWorkspace(t, { prefix: 'safety-callbacks-' }), path = join(workspace.path, 'canonical.sqlite');
  let callback = null, fired = false, mutationError = null;
  const core = openMemoryCore({ path, model: { countTokens(text) {
    if (callback && text.startsWith('{"ok":true,"value":')) { const work = callback; callback = null; fired = true; try { work(); } catch (error) { mutationError = error; } }
    return 1;
  } } }); workspace.defer(() => core.close());
  const db = new DatabaseSync(path); db.exec('PRAGMA busy_timeout=5000;PRAGMA foreign_keys=ON'); workspace.defer(() => db.close());
  return { core, db, arm(work) { callback = work; fired = false; mutationError = null; }, fired() { if (mutationError) throw mutationError; return fired; },
    admit(id) { return ok(core.admit({ namespace: ns, memory: { content: 'OldInterpretation'+id, kind: 'fact' },
      receipts: [receipt(id, 'OldExcerpt'+id)] })).memory; } };
}
function mutate(f, memory, kind) {
  if (kind === 'forget') return ok(f.core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
  if (kind === 'correct') return ok(f.core.correct({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision,
    content: 'NewInterpretation', kind: 'fact', receipt: receipt('new', 'NewExcerpt') }));
  if (kind === 'receipt-loss') return f.db.prepare('DELETE FROM receipts WHERE memory_id=?').run(memory.id);
  return f.db.prepare("UPDATE memories SET content='ChangedWithoutEpoch' WHERE id=?").run(memory.id);
}
function history(f, memory) {
  ok(f.core.supersede({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision,
    replacement: { content: 'Replacement'+memory.id, kind: 'fact' }, receipts: [receipt('replacement'+memory.id, 'ReplacementExcerpt')] }));
  return { ...memory, revision: memory.revision + 1 };
}
const ref = memory => ({ memoryId: memory.id, revision: memory.revision });
const hidden = response => {
  assert.equal(response.ok, false, JSON.stringify(response));
  assert.equal(JSON.stringify(response).includes('OldInterpretation'), false);
  assert.equal(JSON.stringify(response).includes('OldExcerpt'), false);
  for (const reason of ['user_forget', 'identity_mismatch', 'correction_supersession']) assert.equal(JSON.stringify(response).includes(reason), false);
};
async function receiptRemovalFixture(t, view) {
  let callback = null, fired = false, mutationError = null;
  const f = sourceFixture(t, { deletion: true, model: { countTokens(text) {
    if (callback && text.startsWith('{\"ok\":true,\"value\":')) { const work = callback; callback = null; fired = true; try { work(); } catch (error) { mutationError = error; } }
    return 1;
  }, extract: () => ({ items: [{ content: 'Synthetic shared raw interpretation', kind: 'fact', confidence: .8, sourceIndices: [0] }] }) } });
  f.db.exec('PRAGMA busy_timeout=5000');
  const source = await savedSource(f, 'Synthetic removable source');
  let memory = ok(f.core.admit({ namespace: rawNamespace, memory: { content: 'Synthetic shared raw interpretation', kind: 'fact' },
    receipts: [receipt('independent', 'Independent surviving excerpt')] })).memory;
  if (view === 'historical') {
    ok(f.core.supersede({ namespace: rawNamespace, memoryId: memory.id, expectedRevision: memory.revision,
      replacement: { content: 'Replacement raw interpretation', kind: 'fact' }, receipts: [receipt('replacement', 'Replacement source')] }));
    memory = { ...memory, revision: memory.revision + 1 };
  }
  const remove = () => {
    const revision = f.db.prepare('SELECT revision FROM raw_conversations WHERE id=?').get(source.conversationId).revision;
    const result = ok(f.core.deleteConversation({ namespace: rawNamespace, conversationId: source.conversationId, expectedRevision: revision, actionId: 'remove' }));
    assert.equal(result.retainedMemories, 1); assert.equal(result.removedReceipts, 1);
  };
  return { f, memory, arm() { callback = remove; }, fired() { if (mutationError) throw mutationError; return fired; } };
}
for (const view of ['current', 'historical']) for (const mode of [undefined, 'source-evidence']) {
  for (const resume of [false, true]) test(`S1 final legacy ${view}/${mode ?? 'ordinary'} ${resume ? 'cursor' : 'first'} fence covers every field`, async t => {
    for (const kind of ['forget', ...(view === 'current' ? ['correct'] : []), 'receipt-loss', 'content-without-epoch']) {
      const f = fixture(t), first = f.admit('first'), second = f.admit('second');
      const memories = view === 'historical' ? [history(f, first), history(f, second)] : [first, second];
      const input = { namespace: ns, refs: memories.map(ref), view, ...(mode ? { contextMode: mode } : {}) };
      const cursor = resume ? ok(f.core.fetch(input)).nextCursor : undefined;
      if (resume) assert.ok(cursor);
      const target = memories[Number(resume)], epoch = f.db.prepare('SELECT epoch FROM namespace_epochs').get().epoch;
      f.arm(() => mutate(f, target, kind));
      const result = f.core.fetch({ ...input, ...(cursor ? { cursor } : {}) });
      assert.equal(f.fired(), true, kind); hidden(result);
      if (kind === 'content-without-epoch' || kind === 'receipt-loss') assert.equal(f.db.prepare('SELECT epoch FROM namespace_epochs').get().epoch, epoch);
    }
    const removed = await receiptRemovalFixture(t, view), input = { namespace: rawNamespace, refs: [ref(removed.memory)], view, ...(mode ? { contextMode: mode } : {}) };
    removed.arm(); hidden(removed.f.core.fetch(input)); assert.equal(removed.fired(), true);
  });
}

test('S1 complete source snapshots revalidate the entire population and private interpretation identity after callbacks', async t => {
  for (const kind of ['forget', 'correct', 'receipt-loss', 'content-without-epoch']) {
    const f = fixture(t), first = f.admit('first'); f.admit('second');
    const before = ok(f.core.sourceSnapshot({ readSet: [ns] })); assert.equal(before.coverage, 'complete-current-admitted');
    f.arm(() => mutate(f, first, kind));
    const result = f.core.sourceSnapshot({ readSet: [ns] });
    assert.equal(f.fired(), true, kind); hidden(result);
    assert.equal(Object.hasOwn(result, 'value'), false);
  }
  const removed = await receiptRemovalFixture(t, 'current'); removed.arm();
  hidden(removed.f.core.sourceSnapshot({ readSet: [rawNamespace] })); assert.equal(removed.fired(), true);
});

test('S1 ordinary receipt-page resume refuses a content-only mutation after final counting in both views', t => {
  for (const view of ['current', 'historical']) {
    const f = fixture(t); let memory;
    for (let i = 0; i < 102; i++) memory = ok(f.core.admit({ namespace: ns, memory: { content: 'OldInterpretationPaged', kind: 'fact' },
      receipts: [receipt('page-'+i, 'OldExcerpt'+i)] })).memory;
    if (view === 'historical') memory = history(f, memory);
    const input = { namespace: ns, refs: [ref(memory)], view }, first = ok(f.core.fetch(input));
    assert.equal(first.items[0].receipts.length, 100); assert.ok(first.nextCursor);
    f.arm(() => mutate(f, memory, 'content-without-epoch'));
    hidden(f.core.fetch({ ...input, cursor: first.nextCursor })); assert.equal(f.fired(), true);
  }
});
