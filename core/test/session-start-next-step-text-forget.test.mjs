import assert from 'node:assert/strict';
import test from 'node:test';
import { openMemoryCore } from '../index.mjs';
import { migrateCardLineage } from '../content-safety-migration.mjs';
import { copySqliteFixture, safetyFixture, quiescence, ns, ok, receipt } from '../testing/content-safety-s2h-fixture.mjs';
import { input, interpretation, model, options } from '../testing/episode-capture-helpers.mjs';

const passage = 'Review the synthetic planting schedule';
const independent = 'An independent source about the meeting agenda';
const earlierText = 'Send the agenda to the group';
const short = '盆🌱栽';
const contained = `Tomorrow: ${passage}.`;
const containingShort = `Review ${short} tomorrow.`;
const otherOwner = { ...ns, ownerId: 'another-owner' };
const otherProject = { ...ns, projectId: 'another-project' };

async function fixture(t, layout, stepText) {
  const f = safetyFixture(t, layout === 29 ? 18 : 33);
  if (layout === 29) await openMemoryCore({ path: f.path, raw: true, rawSearch: false }).close();
  if (layout === 48) await f.migrate();
  if (layout === 53) {
    copySqliteFixture(f.path, f.backupPath);
    await migrateCardLineage({ path: f.path, backupPath: f.backupPath,
      expected: { storeId: f.storeId, base: 33 }, quiescence });
  }
  const port = model({ interpretEpisode(request) {
    const result = interpretation(request);
    const sources = request.input.sources;
    const sourceIndex = sources.findIndex(source => source.text === independent);
    result.nextStep = { value: sources.length === 1 ? earlierText : stepText,
      anchors: [{ sourceIndex, start: 0, end: sources[sourceIndex].text.length }] };
    return result;
  } });
  const core = openMemoryCore({ path: f.path, ...options, model: port });
  f.workspace.defer(() => core.close());
  const db = f.connect();
  f.workspace.defer(() => db.close());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, layout);

  async function capture(sessionId, texts) {
    return ok(await core.capture(input(1, sessionId, { namespace: ns, messages: texts.map(([id, content]) =>
      ({ id, role: 'user', content })) }))).episode.id;
  }
  function read() {
    const calls = port.calls.length;
    const { items } = ok(core.sessionStartContext({ namespace: ns,
      groups: { nextSteps: true, procedural: false } })).groups.nextSteps;
    assert.equal(port.calls.length, calls);
    return items;
  }
  function forget(content, namespace = ns, source = receipt('independent-donor', content)) {
    const { memory } = ok(core.admit({ namespace, memory: { content, kind: 'fact' }, receipts: [source] }));
    assert.equal(ok(core.forget({ namespace, memoryId: memory.id, expectedRevision: memory.revision })).forgotten, true);
    assert.equal(suppressed(content, namespace), true);
  }
  function suppressed(content, namespace = ns) {
    return ok(core.isSuppressed({ namespace, content })).suppressed;
  }
  const detail = episodeId => ok(core.getEpisode({ namespace: ns, episodeId }));
  return { capture, detail, forget, read, suppressed, path: f.path, db, workspace: f.workspace };
}

for (const layout of [29, 33, 48, 53]) {
  for (const fallback of [true, false]) {
    test(`layout ${layout}: exact retired receipt text withdraws a step with only an independent anchor (${fallback ? 'fallback' : 'empty'})`, async t => {
      const f = await fixture(t, layout, passage);
      let earlier;
      if (fallback) {
        const earlierId = await f.capture('earlier', [['earlier-source', independent]]);
        [earlier] = f.read();
        assert.equal(earlier.episodeId, earlierId);
        assert.equal(earlier.nextStep.text, earlierText);
      }
      const episodeId = await f.capture('quoted', [['quoted-source', passage], ['independent-source', independent]]);
      const [before] = f.read();
      assert.equal(before.episodeId, episodeId);
      assert.equal(before.nextStep.text, passage);
      assert.deepEqual(before.sources.map(source => source.text), [independent]);
      assert.deepEqual(before.nextStep.anchors.map(anchor => anchor.sourceId), before.sources.map(source => source.id));

      const { episode, sources } = f.detail(episodeId);
      const source = sources.items.find(item => item.text === passage);
      f.forget('Synthetic donor with a different Memory body', ns, { client: episode.client, sessionId: episode.sessionKey,
        eventId: source.messageId, role: source.role, excerpt: source.text });
      assert.equal(f.suppressed(passage), false);
      assert.deepEqual(f.detail(episodeId).sources.items.map(item => item.text), [independent]);
      assert.deepEqual(f.read(), fallback ? [earlier] : []);
    });
  }

  test(`layout ${layout}: an address-only match leaves independently anchored text intact`, async t => {
    const f = await fixture(t, layout, passage);
    const episodeId = await f.capture('quoted', [['quoted-source', passage], ['independent-source', independent]]);
    const [before] = f.read();
    const { episode, sources } = f.detail(episodeId);
    const source = sources.items.find(item => item.text === passage);
    f.forget('Synthetic donor with a different Memory body', ns, { client: episode.client, sessionId: episode.sessionKey,
      eventId: source.messageId, role: source.role, excerpt: 'Different text at the same receipt address' });
    const after = f.detail(episodeId);
    assert.deepEqual(after.sources.items.map(item => item.text), [independent]);
    assert.equal(JSON.stringify(f.read()), JSON.stringify([{ ...before, revision: after.episode.revision }]));
  });

  for (const { name, text, fact, namespace = ns, withdraw } of [
    { name: 'normalized exact Memory text', text: passage, fact: passage.toUpperCase(), withdraw: true },
    { name: 'embedded Memory text', text: contained, fact: passage, withdraw: false },
    { name: 'unrelated text', text: earlierText, fact: passage, withdraw: false },
    { name: 'another owner', text: passage, fact: passage, namespace: otherOwner, withdraw: false },
    { name: 'another project', text: passage, fact: passage, namespace: otherProject, withdraw: false },
    { name: 'exact three-code-point text', text: short, fact: short, withdraw: true },
    { name: 'embedded three-code-point text', text: containingShort, fact: short, withdraw: false },
  ]) {
    test(`layout ${layout}: ${name}`, async t => {
      const f = await fixture(t, layout, text);
      const episodeId = await f.capture('step', [['classification-source', 'Synthetic classification evidence'],
        ['independent-source', independent]]);
      const before = f.read();
      assert.equal(before[0].episodeId, episodeId);
      assert.equal(before[0].nextStep.text, text);
      assert.deepEqual(before[0].sources.map(source => source.text), [independent]);
      f.forget(fact, namespace);
      assert.equal(f.suppressed(text), withdraw, 'Session Start follows the existing Memory write matcher');
      const after = f.read();
      if (withdraw) assert.deepEqual(after, []);
      else assert.equal(JSON.stringify(after), JSON.stringify(before));
    });
  }
}

for (const layout of [29, 53]) {
  test(`layout ${layout}: a local Raw hide window leaves independently anchored text intact`, async t => {
    const f = await fixture(t, layout, passage);
    const local = openMemoryCore({ path: f.path, raw: true, rawSearch: false });
    f.workspace.defer(() => local.close());
    const episodeId = await f.capture('step', [['classification-source', passage], ['independent-source', independent]]);
    const before = f.read();
    const content = 'Synthetic Memory with an unrelated source';
    const { memory } = ok(local.admit({ namespace: ns, memory: { content, kind: 'fact' }, receipts: [receipt('raw-window')] }));
    assert.equal(ok(local.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision })).forgotten, true);
    const receivedAt = Date.parse(f.detail(episodeId).episode.firstReceivedAt);
    assert.ok(f.db.prepare(`SELECT 1 FROM local_raw_hide_windows WHERE owner_id=? AND scope=? AND project_id=?
      AND start_ms<=? AND end_ms>=?`).get(ns.ownerId, ns.scope, ns.projectId, receivedAt, receivedAt));
    assert.equal(f.suppressed(passage), false);
    assert.equal(JSON.stringify(f.read()), JSON.stringify(before));
  });
}
