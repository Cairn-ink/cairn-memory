import test from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryCore } from '../index.mjs';
import { lineageFixture, lineageHost, ns, ok, receipt } from '../testing/card-lineage-fixture.mjs';
import { safetyFixture } from '../testing/content-safety-s2h-fixture.mjs';
import { model, input as episodeInput, setup } from '../testing/episode-capture-helpers.mjs';
import { options } from '../testing/episode-helpers.mjs';

const survivor = 'Synthetic retained Episode signal';
const forgotten = 'Synthetic forgotten Episode wording';
const text = survivor + '. ' + forgotten + '.';

for (const kind of ['fresh', 'base33', 'package48', 'lineage53'])
for (const operation of ['forget', 'correct', 'reject'])
for (const linked of [false, true])
test(`Episode source and receipt withholding ${kind} ${operation}, linked=${linked}`, async t => {
  const items = [{ content: survivor, kind: 'fact', confidence: .8, sourceIndices: [0] }];
  const target = { content: forgotten, kind: operation === 'reject' ? 'decision' : 'fact', confidence: .8, sourceIndices: [0] };
  if (linked) items.push(target);
  const config = { ...options, decisionReview: 'required-v1', model: model({ extract: () => ({ items }) }) };
  let f;
  if (kind === 'lineage53') f = await lineageFixture(t, { base: 33, options: config });
  else if (kind === 'fresh') f = setup(t, { extract: () => ({ items }) }, { decisionReview: 'required-v1' });
  else {
    f = safetyFixture(t, 33);
    if (kind === 'package48') await f.migrate();
    const host = lineageHost();
    f.core = openMemoryCore({ path: f.path, privateCards: host.options, ...config });
    f.db = f.connect();
    t.after(() => { f.core.close(); f.db.close(); });
  }
  const input = episodeInput(1, 'synthetic-shared-episode', { namespace: ns,
    messages: [{ id: 'synthetic-shared-message', role: 'user', content: text }] });
  const captured = ok(await f.core.capture(input)), episodeId = captured.episode.id;
  const b = captured.admission.memories[0];
  const saved = ok(f.core.get({ namespace: ns, memoryId: b.id })).receipts[0];
  let a = captured.admission.memories[1];
  if (!linked) {
    // Use the Episode receipt's origin coordinates through ordinary capture,
    // so this Memory has the same message address but no Episode link.
    const ordinary = openMemoryCore({ path: f.path, decisionReview: 'required-v1',
      model: model({ extract: () => ({ items: [target] }) }) });
    t.after(() => ordinary.close());
    a = ok(await ordinary.capture({ namespace: ns, client: saved.client, sessionId: saved.sessionId,
      eventId: 'synthetic-unlinked-batch', messages: [{ id: saved.eventId, role: saved.role, content: saved.excerpt }] })).admission.memories[0];
  }
  const withheldIds = [b, a].flatMap(memory => f.db.prepare('SELECT id FROM receipts WHERE memory_id=?').all(memory.id).map(row => row.id));
  const request = { namespace: ns, episodeId, sourceLimit: 16, memoryLimit: 50 };
  assert.ok(ok(f.core.getEpisode(request)).sources.items.some(source => source.text === text));
  const action = { namespace: ns, memoryId: a.id, expectedRevision: a.revision };
  ok(operation === 'correct' ? f.core.correct({ ...action, content: 'Synthetic corrected Episode claim', kind: 'fact',
    receipt: receipt('synthetic-episode-correction') }) : f.core[operation]({ ...action,
    ...(operation === 'reject' ? { actionId: 'synthetic-episode-rejection' } : {}) }));
  // This line exposes getEpisode on lineage-enabled stores; it has no separate
  // getEpisodeWithLineage method. Exercise that actual public composition.
  const result = f.core.getEpisode(request), value = ok(result), serialized = JSON.stringify(result);
  assert.equal(serialized.includes(forgotten), false);
  assert.equal(serialized.includes(text), false);
  for (const id of withheldIds) assert.equal(serialized.includes(id), false, 'withheld receipt id anywhere in the response');
  assert.equal(value.episode.id, episodeId);
  assert.equal(value.sources.items.length, 0);
  const link = value.memoryLinks.items.find(link => link.memoryId === b.id);
  assert.ok(link, 'the surviving Memory link remains');
  assert.deepEqual(link.receiptIds, []);
  const memory = ok(f.core.get({ namespace: ns, memoryId: b.id }));
  assert.equal(memory.memory.content, survivor);
  assert.equal(memory.memory.revision, b.revision);
});
