import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createLocalRawSearch } from '../local-raw-search.mjs';
import { createFakeEmbedder } from '../context-read-embedder.mjs';
import { assembleThreeLayerContext } from '../context-read-three-layer.mjs';
import { installRawSearchTestClock, rawSearchTestWait } from '../testing/raw-search-clock.mjs';
import { safetySourceFixture } from '../testing/raw-search-fixtures.mjs';
import { savedSource, ns, ok } from '../testing/raw-source-fixtures.mjs';
import { transaction } from '../database.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';

test.beforeEach(installRawSearchTestClock);
async function fixture(t) {
  const f = safetySourceFixture(t, { model: { extract: ({ input }) => ({ items: input.messages.map(message => ({
    content: message.content, kind: 'fact', confidence: 1, sourceIndices: [message.index],
  })) }) } });
  const sources = [];
  for (const [index, text] of ['telescope secret amber', 'telescope secret birch'].entries())
    sources.push(await savedSource(f, text, { sessionId: 'validation-' + index }));
  const manager = createLocalRawSearch(f.path, f.port, { embedder: createFakeEmbedder(),
    policy: { family: 'local', maxBatchDocuments: 1, maxRequests: 100, maxConcurrent: 1 } });
  f.workspace.defer(() => manager.close());
  let found;
  for (let index = 0; index < 32; index++) {
    await rawSearchTestWait(1010);
    ok(await manager.methods.maintainRawSearch({ namespace: ns }));
    found = ok(await manager.methods.searchRaw({ namespace: ns, query: 'telescope' }));
    if (found.semantic.state === 'ready' && found.candidates.length === 2) break;
  }
  assert.equal(found.semantic.state, 'ready'); assert.equal(found.candidates.length, 2);
  const port = manager.contextPort([ns]);
  const semantic = await port.search({ query: 'telescope' });
  const lexical = await port.search({ query: 'telescope', semantic: false });
  const candidates = [semantic.candidates.find(c => c.conversationId === sources[0].conversationId),
    lexical.candidates.find(c => c.conversationId === sources[1].conversationId)];
  assert.ok(candidates.every(Boolean)); assert.notEqual(candidates[0].proof, candidates[1].proof);
  const batch = await port.prepareMany(candidates);
  assert.equal(batch.complete, true); assert.ok(batch.handles.every(Boolean));
  const raw = { coverage: 'included', rawSearch: port, items: batch.handles.map((handle, index) => ({
    handle, value: handle.value, key: 'turn-' + index, rank: index + 1,
  })) };
  const args = { prepared: [], counter: { id: 'synthetic-counter', countTokens: () => 1 },
    policy: { id: 'rank-first-whole-v1' }, budget: { maxTokens: 6000, maxItems: 24 }, query: 'telescope',
    readSet: [ns], representation: 'representation-v2-dated', deadlineAt: Infinity, snapshotOf: () => null };
  return { ...f, sources, manager, port, handles: batch.handles, raw, args };
}

test('mixed readers refuse a set with no permitting canonical snapshot', async t => {
  const f = await fixture(t), [a, b] = f.sources;
  const assembled = assembleThreeLayerContext(f.args, f.raw);
  assert.equal(assembled.metered.items.length, 2); assert.equal(assembled.validateRaw(), true);
  const exec = DatabaseSync.prototype.exec; let bReader, identify = true, changed = false;
  DatabaseSync.prototype.exec = function(sql) {
    if (identify && sql === 'BEGIN') bReader = this;
    return exec.call(this, sql);
  };
  t.after(() => { DatabaseSync.prototype.exec = exec; });
  f.port.revalidate([f.handles[1]]); identify = false; assert.ok(bReader);
  const original = f.db.prepare('SELECT sealed FROM raw_parts WHERE conversation_id=? AND message_id=? AND part_index=0')
    .get(b.conversationId, b.messageId).sealed;
  f.db.prepare('UPDATE raw_parts SET sealed=? WHERE conversation_id=? AND message_id=? AND part_index=0')
    .run(Buffer.from('invalid'), b.conversationId, b.messageId);
  DatabaseSync.prototype.exec = function(sql) {
    if (!changed && this === bReader && sql === 'BEGIN') {
      assert.equal(this.isTransaction, false); changed = true;
      transaction(f.db, () => {
        f.db.prepare('INSERT INTO raw_source_exclusions VALUES(?,?,?,?,?)').run(a.conversationId, a.messageId, 0, a.text.length, 1);
        f.db.prepare('UPDATE raw_parts SET sealed=? WHERE conversation_id=? AND message_id=? AND part_index=0')
          .run(original, b.conversationId, b.messageId);
      });
    }
    return exec.call(this, sql);
  };
  const allowed = assembled.validateRaw();
  assert.equal(changed, true, 'the write commits after the first reader and before the second reader snapshot');
  assert.throws(() => f.port.revalidate([f.handles[0]]));
  assert.equal(allowed, false, 'separate permitting reader snapshots cannot permit the combined set');
});

for (const boundary of ['pre-projection', 'final']) for (const kind of ['forgotten', 'suppressed', 'excluded', 'denied'])
  test(`mixed-reader ${kind} is refused at ${boundary}`, async t => {
    const f = await fixture(t), source = f.sources[0];
    let assembled;
    if (boundary === 'final') {
      assembled = assembleThreeLayerContext(f.args, f.raw);
      assert.equal(assembled.metered.items.length, 2); assert.equal(assembled.validateRaw(), true);
    }
    if (kind === 'forgotten') {
      const memory = f.db.prepare(`SELECT m.id,m.revision FROM memories m JOIN receipts r ON r.memory_id=m.id
        JOIN raw_receipt_lineage l ON l.receipt_id=r.id WHERE l.conversation_id=? LIMIT 1`).get(source.conversationId);
      assert.ok(memory); ok(f.core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
    } else if (kind === 'suppressed') transaction(f.db, () => writeContentSuppressionInside(f.db,
      { namespace: ns, kind: 'raw', key: source.conversationId, matchMode: 'span', messageId: source.messageId,
        start: 0, end: source.text.length, reason: 'purge', actionId: 'synthetic-validation-suppression' }));
    else if (kind === 'excluded') f.db.prepare('INSERT INTO raw_source_exclusions VALUES(?,?,?,?,?)')
      .run(source.conversationId, source.messageId, 0, source.text.length, 1);
    else await f.manager.close();
    if (boundary === 'final') assert.equal(assembled.validateRaw(), false);
    else {
      const refused = assembleThreeLayerContext(f.args, f.raw);
      assert.equal(refused.diagnostics.coverage.raw, 'partial'); assert.deepEqual(refused.metered.items, []);
      assert.equal(JSON.stringify(refused).includes('secret'), false);
    }
  });
