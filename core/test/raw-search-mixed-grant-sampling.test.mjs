import test from 'node:test';
import assert from 'node:assert/strict';
import { openRawSearch } from '../raw-search-index.mjs';
import { createFakeEmbedder } from '../context-read-embedder.mjs';
import { assembleThreeLayerContext } from '../context-read-three-layer.mjs';
import { installRawSearchTestClock } from '../testing/raw-search-clock.mjs';
import { safetySourceFixture, searchFixture } from '../testing/raw-search-fixtures.mjs';
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
    sources.push(await savedSource(f, text, { sessionId: 'sampling-' + index }));
  const denied = new Set();
  let callback = () => {};
  const semantic = await searchFixture(f, { embedder: createFakeEmbedder(),
    policy: { family: 'local', maxBatchDocuments: 1, maxRequests: 100, maxConcurrent: 1, maxUsd: 0 },
    setupHost(host) {
      const current = host.authority.isCurrent;
      host.authority.isCurrent = (grant, request) => {
        if (request.method === 'rawSearchSource') {
          const index = sources.findIndex(source => source.conversationId === request.input.candidate?.conversationId);
          callback(index);
          if (denied.has(index)) return null;
        }
        return current(grant, request);
      };
    } });
  let found;
  for (let index = 0; index < 32; index++) {
    await semantic.tick({ maxItems: 128, maxMs: 5000, embeddings: true });
    found = await semantic.search({ query: 'telescope' });
    if (found.semantic.state === 'ready' && found.candidates.length === 2 && found.coverage.status === 'complete') break;
  }
  assert.equal(found.semantic.state, 'ready');
  assert.equal(found.coverage.status, 'complete'); assert.equal(found.candidates.length, 2);
  // Real local native readers share the authority and store; only A embeds.
  const { embedder, policy, ...lexicalOptions } = semantic.options;
  const lexical = await openRawSearch(lexicalOptions);
  f.workspace.defer(() => lexical.close());
  const lex = await lexical.search({ query: 'telescope' }, semantic.host.token);
  assert.equal(lex.semantic.state, 'bm25-only');
  const candidates = [found.candidates.find(c => c.conversationId === sources[0].conversationId),
    lex.candidates.find(c => c.conversationId === sources[1].conversationId)];
  assert.ok(candidates.every(Boolean)); assert.notEqual(candidates[0].proof, candidates[1].proof);
  const handles = [await semantic.prepare(candidates[0]), await lexical.prepare(candidates[1], {}, semantic.host.token)];
  // B validates: the foreign A access callback precedes B's own callback.
  const raw = { coverage: 'included', rawSearch: lexical, items: handles.map((handle, index) => ({
    handle, value: handle.value, key: 'turn-' + index, rank: index + 1,
  })) };
  const args = { prepared: [], counter: { id: 'synthetic-counter', countTokens: () => 1 },
    policy: { id: 'rank-first-whole-v1' }, budget: { maxTokens: 6000, maxItems: 24 }, query: 'telescope',
    readSet: [ns], representation: 'representation-v2-dated', deadlineAt: Infinity, snapshotOf: () => null };
  return { ...f, sources, denied, handles, lexical, raw, args, setCallback(fn) { callback = fn; } };
}

for (const boundary of ['pre-projection', 'final']) {
  test(`known limit: later reader revokes an already sampled grant at ${boundary}`, async t => {
    const f = await fixture(t);
    const assembled = assembleThreeLayerContext(f.args, f.raw);
    assert.equal(assembled.metered.items.length, 2); assert.equal(assembled.validateRaw(), true);
    // A allowed / B denied becomes A denied / B allowed, with no jointly allowed state.
    f.denied.add(1);
    const sampled = [];
    f.setCallback(index => {
      sampled.push(index);
      if (index === 1) { f.denied.add(0); f.denied.delete(1); }
    });
    const result = boundary === 'final' ? assembled.validateRaw() : assembleThreeLayerContext(f.args, f.raw);
    assert.deepEqual(sampled, [0, 1], 'each issuing grant is sampled once, in reviewer order');
    if (boundary === 'final') assert.equal(result, true);
    else {
      assert.equal(result.diagnostics.coverage.raw, 'included'); assert.equal(result.metered.items.length, 2);
      for (const source of f.sources) assert.ok(JSON.stringify(result.metered).includes(source.text));
    }
    // A future joint-authority callback must consciously reverse these acceptance assertions.
    assert.throws(() => f.lexical.revalidate([f.handles[0]]), { code: 'raw_search_unavailable' });
    assert.deepEqual(sampled, [0, 1, 0], 'the immediately following validation samples and refuses A');
    assert.deepEqual(f.lexical.revalidate([f.handles[1]]), [f.handles[1].value]);
  });

  for (const kind of ['forgotten', 'suppressed', 'excluded'])
    test(`stored-state ${kind} in the later reader callback is refused at ${boundary}`, async t => {
      const f = await fixture(t), source = f.sources[0];
      const assembled = assembleThreeLayerContext(f.args, f.raw);
      assert.equal(assembled.metered.items.length, 2); assert.equal(assembled.validateRaw(), true);
      const sampled = [];
      f.setCallback(index => {
        sampled.push(index);
        if (index !== 1) return;
        if (kind === 'forgotten') {
          const memory = f.db.prepare(`SELECT m.id,m.revision FROM memories m JOIN receipts r ON r.memory_id=m.id
            JOIN raw_receipt_lineage l ON l.receipt_id=r.id WHERE l.conversation_id=? LIMIT 1`).get(source.conversationId);
          assert.ok(memory); ok(f.core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
        } else if (kind === 'suppressed') transaction(f.db, () => writeContentSuppressionInside(f.db,
          { namespace: ns, kind: 'raw', key: source.conversationId, matchMode: 'span', messageId: source.messageId,
            start: 0, end: source.text.length, reason: 'purge', actionId: 'synthetic-sampling-suppression' }));
        else f.db.prepare('INSERT INTO raw_source_exclusions VALUES(?,?,?,?,?)')
          .run(source.conversationId, source.messageId, 0, source.text.length, 1);
      });
      const result = boundary === 'final' ? assembled.validateRaw() : assembleThreeLayerContext(f.args, f.raw);
      assert.deepEqual(sampled, [0, 1], 'invalidation occurs after A access and inside B access');
      if (boundary === 'final') assert.equal(result, false);
      else {
        assert.equal(result.diagnostics.coverage.raw, 'partial'); assert.deepEqual(result.metered.items, []);
        assert.equal(JSON.stringify(result).includes('secret'), false);
      }
      assert.throws(() => f.lexical.revalidate([f.handles[0]]), { code: 'raw_search_unavailable' });
    });
}
