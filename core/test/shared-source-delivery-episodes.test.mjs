import assert from 'node:assert/strict';
import test from 'node:test';
import { openMemoryCore } from '../index.mjs';
import { lineageFixture, ns, ok, receipt } from '../testing/card-lineage-fixture.mjs';
import { interpretation, model, input, options } from '../testing/episode-capture-helpers.mjs';

const hidden = 'Synthetic withdrawn episode source text';
const kept = 'Synthetic independent episode source text';

test('Episode detail withholds source text and receipt references while retaining its Memory link', async t => {
  const port = model({ extract: () => ({ items: [
    { content: 'Synthetic retained episode Memory', kind: 'fact', confidence: .8, sourceIndices: [0] },
  ] }), interpretEpisode(request) {
    const value = interpretation(request);
    const index = request.input.sources.findIndex(source => source.text === kept);
    assert.ok(index >= 0);
    value.gist.anchors = [{ sourceIndex: index, start: 0, end: kept.length }];
    return value;
  } });
  const f = await lineageFixture(t, { base: 33, eventTime: true, options: { ...options, model: port } });
  const captured = ok(await f.core.capture(input(1, 'shared-episode', { namespace: ns,
    messages: [{ id: 'shared-message', role: 'user', content: hidden }, { id: 'independent-message', role: 'user', content: kept }] })));
  const b = captured.admission.memories[0];
  const original = ok(f.core.get({ namespace: ns, memoryId: b.id })).receipts[0];
  const ordinary = openMemoryCore({ path: f.path });
  t.after(() => ordinary.close());
  const a = ok(ordinary.admit({ namespace: ns, memory: { content: 'Synthetic discarded episode Memory', kind: 'fact' },
    receipts: [{ client: original.client, sessionId: original.sessionId, eventId: original.eventId, role: original.role, excerpt: original.excerpt }] })).memory;
  const detail = () => ok(f.core.getEpisode({ namespace: ns, episodeId: captured.episode.id, sourceLimit: 16, memoryLimit: 20 }));
  assert.deepEqual(detail().sources.items.map(source => source.text).sort(), [hidden, kept].sort());
  ok(ordinary.forget({ namespace: ns, memoryId: a.id, expectedRevision: a.revision }));
  const value = detail();
  assert.equal(JSON.stringify(value).includes(hidden), false);
  assert.deepEqual(value.sources.items.map(source => source.text), [kept]);
  assert.deepEqual(value.memoryLinks.items.find(link => link.memoryId === b.id).receiptIds, []);
});

test('rationale separates withheld evidence from the stored graph', async t => {
  const f = await lineageFixture(t, { base: 33, eventTime: true });
  const shared = { ...receipt('shared-rationale'), excerpt: hidden };
  const add = (content, receipts) => ok(f.core.admit({ namespace: ns, memory: { content, kind: 'fact' }, receipts })).memory;
  const a = add('Synthetic discarded premise', [shared]);
  const b = add('Synthetic surviving premise', [shared, { ...receipt('other-rationale'), excerpt: kept }]);
  const inspect = () => ok(f.core.getRationale({ namespace: ns, memoryId: b.id, revision: b.revision }));
  assert.ok(JSON.stringify(inspect()).includes(hidden));
  ok(f.core.forget({ namespace: ns, memoryId: a.id, expectedRevision: a.revision }));
  const value = inspect();
  assert.ok(JSON.stringify(value).includes(kept));
  assert.equal(JSON.stringify(value).includes(hidden), false);
});
