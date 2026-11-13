import test from 'node:test';
import assert from 'node:assert/strict';
import { engineCardFixture, scriptedConsolidator, ns, ok } from '../testing/engine-card-fixture.mjs';
import { lineageFixture, lineageHost } from '../testing/card-lineage-fixture.mjs';
import { localPlainPort, request, splitRaw } from '../testing/raw-capture-fixtures.mjs';
import { openRawCaptureCore } from '../raw-capture.mjs';
import { createEngineCardStorage } from '../engine-card-storage.mjs';
import { validateConsolidation } from '../engine-card-output.mjs';

async function fixture(t, sealed, { raw = false, review = false } = {}) {
  const model = scriptedConsolidator(({ input }) => ({
    currentState: [{ text: 'Synthetic shared evidence remains recorded.', memoryIds: input.memories.map(memory => memory.id) }],
    timeline: [], contradictions: [],
  }));
  model.extract = () => ({ items: review ? [{ content: 'Synthetic proposed choice.', kind: 'decision',
    confidence: 0.8, sourceIndices: [0] }] : [] });
  const options = { model, ...(review ? { decisionReview: 'required-v1' } : {}) };
  const author = lineageHost();
  const f = sealed
    ? await lineageFixture(t, { base: raw ? 33 : 23, raw, options })
    : engineCardFixture(t, { ...options, ...(raw ? { privateCards: author.options } : {}) });
  assert.equal(Boolean(f.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='card_body_provenance'").get()), sealed);
  if (raw && !sealed) {
    const core = openRawCaptureCore({ path: f.path, privateCards: author.options, ...options }, {
      mode: 'raw-v1', sources: true, deletion: true, port: localPlainPort(),
      readPolicy: () => ({ generation: 'synthetic', reason: null }),
    });
    f.workspace.defer(() => core.close());
    return { ...f, core, model };
  }
  return { ...f, model };
}

const receipt = (label, excerpt) => ({ client: 'synthetic', sessionId: 'synthetic-' + label,
  eventId: 'synthetic-' + label, role: 'user', excerpt });
function admit(f, label, receipts) {
  const content = `Synthetic evidence ${label}.`;
  return ok(f.core.admit({ namespace: ns, memory: { content, kind: 'fact' },
    receipts: receipts ?? [receipt(label, content)] })).memory;
}
const memoryRow = (f, id) => f.db.prepare('SELECT revision,content,updated_at,deleted FROM memories WHERE id=?').get(id);
const rowBytes = row => Buffer.from(JSON.stringify(row), 'utf8');
const cardRow = (f, id) => f.db.prepare('SELECT state,title,body FROM private_cards WHERE id=?').get(id);
const forget = (f, id, revision) => {
  assert.equal(ok(f.core.forget({ namespace: ns, memoryId: id, expectedRevision: revision })).forgotten, true);
};
function purged(f, card) {
  assert.deepEqual({ ...cardRow(f, card.id) }, { state: 'deleted', title: null, body: null });
}

// Use the canonical commit seam, as in the other purge tests, so the exact
// two/three-Memory shapes do not need extra sources to trigger maintenance.
async function cards(f, groups) {
  const storage = createEngineCardStorage({ db: f.db, ready() {}, upgrade: true,
    identity: f.db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get() });
  const snapshot = storage.snapshot(ns, 512, () => {}).memories;
  const built = [];
  for (const [index, group] of groups.entries()) {
    const memories = group.map(memory => snapshot.find(source => source.id === memory.id));
    assert.ok(memories.every(Boolean), 'all intended sources are eligible');
    const output = await f.model.consolidate({ input: { memories } });
    const value = validateConsolidation(output, memories, f.model);
    assert.ok(value);
    const card = storage.commit(ns, { key: 'moc:synthetic-part-' + index, memories }, value,
      '2026-06-01T00:00:00.000Z', () => {});
    assert.ok(card);
    assert.equal(cardRow(f, card.id).state, 'confirmed');
    assert.equal(typeof cardRow(f, card.id).title, 'string');
    assert.equal(cardRow(f, card.id).body, value.body);
    assert.deepEqual(f.db.prepare('SELECT DISTINCT memory_id FROM card_memory_bindings WHERE card_id=? ORDER BY memory_id')
      .all(card.id).map(row => row.memory_id), group.map(memory => memory.id).sort());
    built.push(card);
  }
  assert.deepEqual(storage.cards(ns).map(card => [card.id, card.status]).sort(),
    built.map(card => [card.id, 'current']).sort());
  return built;
}

for (const sealed of [false, true]) {
  test(`forget preserves a shared-Card sibling byte-for-byte and both pre-read revisions succeed: sealed=${sealed}`, async t => {
    const f = await fixture(t, sealed), a = admit(f, 'A'), b = admit(f, 'B');
    const [card] = await cards(f, [[a, b]]);
    const beforeA = memoryRow(f, a.id), beforeB = memoryRow(f, b.id);
    const calls = f.model.calls.length;
    forget(f, a.id, beforeA.revision);
    assert.deepEqual(rowBytes(memoryRow(f, b.id)), rowBytes(beforeB),
      'sibling revision, content, updated_at and deleted remain byte-equal');
    purged(f, card);
    forget(f, b.id, beforeB.revision);
    assert.equal(f.model.calls.length, calls);
  });

  test(`three pre-read revisions survive sequential forget across two Cards sharing a Memory: sealed=${sealed}`, async t => {
    const f = await fixture(t, sealed), a = admit(f, 'A'), b = admit(f, 'B'), c = admit(f, 'C');
    const built = await cards(f, [[a, b], [b, c]]);
    const order = [b, a, c], before = order.map(memory => memoryRow(f, memory.id));
    const calls = f.model.calls.length;
    // Forget the shared source first: both Cards purge in that transaction.
    for (const [index, memory] of order.entries()) {
      forget(f, memory.id, before[index].revision);
      for (let remaining = index + 1; remaining < order.length; remaining++) {
        assert.deepEqual(rowBytes(memoryRow(f, order[remaining].id)), rowBytes(before[remaining]),
          'every not-yet-forgotten sibling retains its originally read row');
      }
      for (const card of built) purged(f, card);
    }
    assert.equal(f.model.calls.length, calls);
  });

  test(`conversation deletion preserves an unrelated Card sibling; receipt removal increments a retained Memory revision exactly once (existing behaviour): sealed=${sealed}`, async t => {
    const f = await fixture(t, sealed, { raw: true });
    const part = splitRaw('Synthetic evidence A. Synthetic evidence C.', { id: 'synthetic-message' })[0];
    const captured = ok(await f.core.captureRaw(request(part, { namespace: ns, client: 'codex',
      sessionId: 'synthetic-source', eventId: 'synthetic-capture' })));
    assert.deepEqual(ok(captured.interpretation).admission.memories, []);
    const source = excerpt => ({ client: 'codex', sessionId: 'synthetic-source',
      eventId: part.id, role: 'user', excerpt });
    const a = admit(f, 'A', [source('Synthetic evidence A.')]);
    const b = admit(f, 'B');
    const c = admit(f, 'C', [source('Synthetic evidence C.'), receipt('independent', 'Synthetic evidence C.')]);
    const [card] = await cards(f, [[a, b, c]]);
    const beforeA = memoryRow(f, a.id), beforeB = memoryRow(f, b.id), beforeC = memoryRow(f, c.id);
    const retainedReceipt = f.db.prepare("SELECT * FROM receipts WHERE memory_id=? AND client='synthetic'").get(c.id);
    assert.ok(retainedReceipt);
    assert.equal(f.db.prepare("SELECT count(*) n FROM receipts WHERE memory_id=? AND client='codex'").get(b.id).n, 0);
    assert.equal(f.db.prepare('SELECT count(*) n FROM receipts WHERE memory_id=?').get(c.id).n, 2);
    const conversationId = captured.raw.conversationId;
    const expectedRevision = f.db.prepare('SELECT revision FROM raw_conversations WHERE id=?').get(conversationId).revision;
    const calls = f.model.calls.length;
    const result = ok(f.core.deleteConversation({ namespace: ns, conversationId, expectedRevision,
      actionId: 'synthetic-delete' }));
    assert.deepEqual([result.forgottenMemories, result.retainedMemories, result.removedReceipts], [1, 1, 2]);
    const afterA = memoryRow(f, a.id);
    assert.equal(afterA.revision, beforeA.revision + 1);
    assert.equal(afterA.content, null);
    assert.equal(afterA.deleted, 1);
    assert.deepEqual(rowBytes(memoryRow(f, b.id)), rowBytes(beforeB));
    const afterC = memoryRow(f, c.id);
    assert.equal(afterC.revision, beforeC.revision + 1, 'one receipt-removal revision, with no extra Card-purge bump');
    assert.equal(afterC.content, beforeC.content);
    assert.equal(afterC.deleted, 0);
    assert.deepEqual(f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').all(c.id), [retainedReceipt]);
    purged(f, card);
    assert.equal(f.model.calls.length, calls);
  });

  test(`reject of an awaiting Memory preserves every other Memory revision: sealed=${sealed}`, async t => {
    const f = await fixture(t, sealed, { review: true }), a = admit(f, 'A'), b = admit(f, 'B');
    await cards(f, [[a, b]]);
    ok(await f.core.capture({ namespace: ns, client: 'synthetic', sessionId: 'synthetic-review',
      eventId: 'synthetic-proposal', messages: [{ id: 'synthetic-proposal', role: 'user', content: 'Synthetic proposed choice.' }] }));
    const awaiting = ok(f.core.list({ namespace: ns, reviewState: 'awaiting' })).memories;
    assert.equal(awaiting.length, 1);
    const target = awaiting[0];
    assert.equal(target.reviewState, 'awaiting');
    const others = () => f.db.prepare('SELECT * FROM memories WHERE id!=? ORDER BY id').all(target.id);
    const before = others(), calls = f.model.calls.length;
    assert.equal(before.length, 2);
    assert.equal(ok(f.core.reject({ namespace: ns, memoryId: target.id, expectedRevision: target.revision,
      actionId: 'synthetic-reject' })).forgotten, true);
    assert.deepEqual(others(), before, 'all other stored Memory rows, including revisions, remain identical');
    const rejected = memoryRow(f, target.id);
    assert.equal(rejected.deleted, 1);
    assert.equal(rejected.content, null);
    assert.equal(rejected.revision, target.revision + 1);
    assert.equal(f.model.calls.length, calls);
  });
}
