import assert from 'node:assert/strict';
import test from 'node:test';
import { openMemoryCore } from '../index.mjs';
import { migrateCardLineage } from '../content-safety-migration.mjs';
import { copySqliteFixture, safetyFixture, quiescence, ns, ok } from '../testing/content-safety-s2h-fixture.mjs';
import { input, interpretation, model, options } from '../testing/episode-capture-helpers.mjs';

for (const layout of [29, 33, 48, 53]) test(`Session Start withdraws any step with a marked anchor on layout ${layout}`, async t => {
  const f = safetyFixture(t, layout === 29 ? 18 : 33);
  if (layout === 29) openMemoryCore({ path: f.path, raw: true, rawSearch: false }).close();
  if (layout === 48) await f.migrate();
  if (layout === 53) {
    copySqliteFixture(f.path, f.backupPath);
    await migrateCardLineage({ path: f.path, backupPath: f.backupPath,
      expected: { storeId: f.storeId, base: 33 }, quiescence });
  }
  const sharedText = 'Synthetic withdrawn next-step evidence';
  const keptText = 'Synthetic independent next-step evidence';
  const core = openMemoryCore({ path: f.path, ...options, model: model({ interpretEpisode(request) {
    const result = interpretation(request);
    const sources = request.input.sources;
    result.nextStep = { value: sources.find(source => source.text === sharedText)?.text ?? keptText,
      anchors: sources.map((source, sourceIndex) =>
      ({ sourceIndex, start: 0, end: source.text.length })) };
    return result;
  } }) });
  f.workspace.defer(() => core.close());
  const db = f.connect();
  f.workspace.defer(() => db.close());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, layout);
  async function capture(sessionId, texts) {
    const { episode } = ok(await core.capture(input(1, sessionId, { namespace: ns, messages: texts.map(([id, content]) =>
      ({ id, role: 'user', content })) })));
    return ok(core.getEpisode({ namespace: ns, episodeId: episode.id }));
  }
  function read() {
    return ok(core.sessionStartContext({ namespace: ns, groups: { nextSteps: true, procedural: false } })).groups.nextSteps.items;
  }
  function donor(detail) {
    const source = detail.sources.items.find(item => item.text === sharedText);
    const memory = ok(core.admit({ namespace: ns, memory: { content: 'Synthetic next-step donor ' + source.messageId, kind: 'fact' },
      receipts: [{ client: detail.episode.client, sessionId: detail.episode.sessionKey,
        eventId: source.messageId, role: source.role, excerpt: source.text }] })).memory;
    return () => ok(core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
  }

  const independent = await capture('independent-step', [['independent-only', keptText]]);
  const [fallback] = read();
  assert.equal(fallback.episodeId, independent.episode.id);
  assert.equal(fallback.nextStep.text, keptText);
  assert.deepEqual(fallback.sources.map(source => source.text), [keptText]);
  assert.deepEqual(fallback.nextStep.anchors.map(anchor => anchor.sourceId), fallback.sources.map(source => source.id));

  const withdrawn = await capture('shared-step', [['shared-only', sharedText]]);
  assert.equal(read()[0].episodeId, withdrawn.episode.id);
  donor(withdrawn)();
  assert.deepEqual(read(), [fallback]);

  const mixed = await capture('mixed-step', [['shared', sharedText], ['independent', keptText]]);
  const hidden = mixed.sources.items.find(source => source.text === sharedText);
  const visible = mixed.sources.items.find(source => source.text === keptText);
  const [before] = read();
  assert.equal(before.episodeId, mixed.episode.id);
  assert.equal(before.nextStep.text, sharedText);
  assert.deepEqual(before.sources.map(source => source.id).sort(), [hidden.id, visible.id].sort());
  assert.deepEqual(before.nextStep.anchors.map(anchor => anchor.sourceId).sort(), [hidden.id, visible.id].sort());
  donor(mixed)();
  const detail = ok(core.getEpisode({ namespace: ns, episodeId: mixed.episode.id }));
  assert.deepEqual(detail.sources.items.map(source => source.id), [visible.id]);
  const after = read();
  assert.ok(!JSON.stringify(after).includes(sharedText), 'Session Start returned the copied withdrawn excerpt');
  assert.deepEqual(after, [fallback]);
});
