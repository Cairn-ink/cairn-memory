import assert from 'node:assert/strict';
import test from 'node:test';
import { openMemoryCore } from '../index.mjs';
import { migrateCardLineage } from '../content-safety-migration.mjs';
import { copySqliteFixture, safetyFixture, quiescence, ns, ok } from '../testing/content-safety-s2h-fixture.mjs';
import { input, interpretation, model, options } from '../testing/episode-capture-helpers.mjs';

for (const layout of [33, 48, 53]) test(`Session Start filters marked anchors and looks past an entirely withheld step on layout ${layout}`, async t => {
  const f = safetyFixture(t, 33);
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
    result.nextStep = { value: 'Synthetic follow-up', anchors: request.input.sources.map((source, sourceIndex) =>
      ({ sourceIndex, start: 0, end: source.text.length })) };
    return result;
  } }) });
  f.workspace.defer(() => core.close());
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

  await capture('independent-step', [['independent-only', keptText]]);
  const mixed = await capture('mixed-step', [['shared', sharedText], ['independent', keptText]]);
  const hidden = mixed.sources.items.find(source => source.text === sharedText);
  const visible = mixed.sources.items.find(source => source.text === keptText);
  const [before] = read();
  assert.equal(before.episodeId, mixed.episode.id);
  assert.equal(before.sources.length, 2);
  donor(mixed)();
  const detail = ok(core.getEpisode({ namespace: ns, episodeId: mixed.episode.id }));
  assert.deepEqual(detail.sources.items.map(source => source.id), [visible.id]);
  assert.deepEqual(read(), [{ ...before, revision: detail.episode.revision,
    nextStep: { ...before.nextStep, anchors: before.nextStep.anchors.filter(anchor => anchor.sourceId === visible.id) },
    sources: before.sources.filter(source => source.id === visible.id) }]);
  assert.ok(!JSON.stringify(read()).includes(hidden.id));
  assert.ok(!JSON.stringify(read()).includes(sharedText));

  const withdrawn = await capture('shared-step', [['shared-only', sharedText]]);
  assert.equal(read()[0].episodeId, withdrawn.episode.id);
  donor(withdrawn)();
  assert.equal(read()[0].episodeId, mixed.episode.id);
  assert.deepEqual(read()[0].sources.map(source => source.id), [visible.id]);
});
