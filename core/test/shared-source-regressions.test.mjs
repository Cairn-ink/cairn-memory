import test from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryCore, openMemoryStore } from '../index.mjs';
import { ns, ok, receipt } from '../testing/card-lineage-fixture.mjs';
import { model as episodeModel, input as episodeInput } from '../testing/episode-capture-helpers.mjs';
import { options as episodeOptions } from '../testing/episode-helpers.mjs';
import { survivor, forgotten, message, ordinaryKinds, source, fixture, capture, act, noLeak, hasId } from '../testing/shared-source-fixture.mjs';

const error = (result, code) => assert.deepEqual(result, { ok: false, error: { code, retryable: false } });
const refs = memory => [{ memoryId: memory.id, revision: memory.revision }];

for (const kind of ordinaryKinds) test(`ordinary shared capture refuses incomplete source evidence on ${kind}`, { timeout: 15000 }, async t => {
  const f = await fixture(t, kind), [b, a] = await capture(f);
  const denied = ok(f.core.get({ namespace: ns, memoryId: b.id })).receipts[0].id;
  if (f.db.prepare("SELECT 1 FROM sqlite_master WHERE name='raw_conversations'").get())
    assert.equal(f.db.prepare('SELECT count(*) n FROM raw_conversations').get().n, 0);
  ok(act(f, 'forget', a));
  f.model.countTokens = () => 1;
  const plain = ok(f.core.fetch({ namespace: ns, refs: refs(b) }));
  assert.equal(plain.items[0].memory.id, b.id);
  assert.deepEqual(plain.items[0].receipts, []);
  const values = [f.core.fetch({ namespace: ns, refs: refs(b), contextMode: 'source-evidence' }),
    f.core.sourceSnapshot({ readSet: [ns], limit: 12 }),
    await f.core.recall({ readSet: [ns], query: survivor, contextMode: 'source-evidence' }),
    await f.core.recall({ readSet: [ns], query: survivor, contextMode: 'rationale-evidence' })];
  for (const [index, value] of values.entries()) {
    if (index === 1) {
      assert.equal(value.ok, false);
      assert.equal(JSON.stringify(value).includes('complete-current-admitted'), false);
    } else error(value, 'source_unavailable');
    noLeak(value, 'unavailable source response');
    assert.equal(hasId(value, denied), false);
  }
});

test('empty qualified rank validates every fetched source and keeps clean complete coverage', { timeout: 15000 }, async t => {
  for (const corrupt of [false, true]) {
    const f = await fixture(t, 'fresh-default');
    const text = 'Synthetic qualified reading choice';
    const memory = ok(f.core.admit({ namespace: ns, memory: { content: text, kind: 'preference' },
      receipts: [receipt('synthetic-regression-qualification', text)], qualification: { version: 1,
        slot: { subject: 'Synthetic user', property: 'format', scope: null, applies: null },
        value: 'lists', attribution: 'direct', commitment: 'considered', anchors: [{ receiptIndex: 0,
          start: 0, end: text.length, text, fields: ['subject', 'property', 'value', 'attribution', 'commitment'] }] } })).memory;
    let ranked = false;
    f.model.countTokens = () => 1;
    f.model.rank = () => {
      ranked = true;
      if (corrupt) f.db.prepare("UPDATE receipts SET excerpt='Synthetic corrupt source' WHERE memory_id=?").run(memory.id);
      return { refs: [] };
    };
    const result = await f.core.recall({ readSet: [ns], query: text, includeQualification: true });
    assert.equal(ranked, true);
    if (corrupt) error(result, 'storage_error');
    else {
      const value = ok(result);
      assert.deepEqual(value.memories, []);
      assert.equal(value.coverage, 'complete');
    }
  }
});

test('legacy correction with a reused receipt and legacy forgetting preserve shared withholding', { timeout: 15000 }, async t => {
  for (const operation of ['correct', 'forget']) {
    const f = await fixture(t, 'ordinary-53'), [b, a] = await capture(f);
    const denied = ok(f.core.get({ namespace: ns, memoryId: b.id })).receipts[0].id;
    const store = openMemoryStore({ path: f.path }); t.after(() => store.close());
    const scope = store.scope({ ownerId: ns.ownerId, projectId: ns.projectId });
    if (operation === 'correct') {
      // The same receipt primary key makes delete/reinsert a native UPDATE.
      const result = scope.correct(a.id, { content: 'Synthetic corrected legacy claim', kind: 'fact', receipt: source() }, a.revision);
      assert.equal(result.id, a.id);
      assert.equal(result.revision, a.revision + 1);
      assert.deepEqual(result.receipts, []);
      noLeak(result, 'legacy correction acknowledgement');
    } else assert.equal(scope.forget(a.id, a.revision), true);
    for (const value of [scope.get(b.id), ok(f.core.get({ namespace: ns, memoryId: b.id }))]) {
      assert.equal(value.id ?? value.memory.id, b.id);
      assert.deepEqual(value.receipts, []);
      noLeak(value, 'legacy sibling');
      assert.equal(hasId(value, denied), false);
    }
  }
});

test('Episode deletion forgets its purged Memory and removes shared wording from an independently supported sibling', { timeout: 15000 }, async t => {
  const f = await fixture(t, 'ordinary-53'), [b, a] = await capture(f);
  const supported = ok(f.core.admit({ namespace: ns, memory: { content: survivor, kind: 'fact' },
    receipts: [receipt('synthetic-regression-independent', 'Synthetic independent surviving support')] })).memory;
  const denied = ok(f.core.get({ namespace: ns, memoryId: supported.id })).receipts.find(row => row.excerpt === message).id;
  const episode = openMemoryCore({ path: f.path, privateCards: f.host.options, ...episodeOptions,
    model: episodeModel({ extract: () => ({ items: [{ content: forgotten, kind: 'fact', confidence: .8, sourceIndices: [0] }] }) }) });
  t.after(() => episode.close());
  const captured = ok(await episode.capture(episodeInput(1, 'synthetic-session', { namespace: ns,
    messages: [{ id: 'synthetic-message', role: 'user', content: message }] })));
  assert.equal(captured.admission.memories[0].id, a.id);
  const episodeId = captured.episode.id;
  const revision = f.db.prepare('SELECT revision FROM session_episodes WHERE id=?').get(episodeId).revision;
  assert.equal(ok(episode.forgetEpisode({ namespace: ns, episodeId, expectedRevision: revision })).forgotten, true);
  assert.equal(f.core.get({ namespace: ns, memoryId: a.id }).error?.code, 'memory_not_found');
  const value = ok(f.core.get({ namespace: ns, memoryId: b.id }));
  assert.equal(value.memory.content, survivor);
  assert.deepEqual(value.receipts.map(row => row.excerpt), ['Synthetic independent surviving support']);
  noLeak(value, 'Episode deletion sibling');
  assert.equal(hasId(value, denied), false);
});
