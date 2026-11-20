import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../index.mjs';
import { openDatabase } from '../database.mjs';
import { cardLineageRevision, installedContentLayout } from '../content-safety-schema.mjs';
import { lineageFixture } from '../testing/card-lineage-fixture.mjs';
import { migrateEventTime } from '../testing/receipt-event-time-fixture.mjs';
import { ns, ok, safetyFixture } from '../testing/content-safety-s2h-fixture.mjs';
import { batch, digest, finish, fixture as episodeFixture, ns as episodeNs, register } from '../testing/episode-helpers.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const reviewModel = { contextWindow: 8192, countTokens: () => 1, extract: () => ({
  items: [{ content: 'Synthetic waiting decision', kind: 'decision', confidence: .8, sourceIndices: [0] }],
}) };
const source = { client: 'synthetic', sessionId: 'source-session', eventId: 'source-message',
  role: 'user', excerpt: 'Synthetic old excerpt.' };
const otherSource = { ...source, eventId: 'independent-message' };
const hash = text => createHash('sha256').update(text).digest('hex');
const tokens = row => [
  'rs1:i:' + row.receipt_key,
  'rs1:a:' + hash(JSON.stringify(['receipt-source-address-v1', row.client, row.session_id, row.event_id, row.role])),
];
const fingerprints = (db, namespace = ns) => db.prepare(`SELECT fingerprint FROM suppressed
  WHERE owner_id=? AND scope=? AND project_id=? ORDER BY fingerprint`)
  .all(namespace.ownerId, namespace.scope, namespace.projectId ?? '').map(row => row.fingerprint);
const receipts = (db, id) => db.prepare('SELECT * FROM receipts WHERE memory_id=? ORDER BY id').all(id);
const memory = (db, id) => db.prepare('SELECT * FROM memories WHERE id=?').get(id);
const admit = (core, content, sources, namespace = ns) =>
  ok(core.admit({ namespace, memory: { content, kind: 'fact' }, receipts: sources })).memory;
const review = { model: reviewModel, decisionReview: 'required-v1' };

async function setup(t, physical, lineage) {
  if (lineage) return lineageFixture(t, { base: 33, eventTime: true, options: review });
  let path;
  if (physical === 29) {
    const workspace = createTestWorkspace(t, { prefix: 'legacy-marker-layout-' });
    path = join(workspace.path, 'store.sqlite');
    openDatabase(path, { localControls: true }).close();
  } else {
    const f = safetyFixture(t, 33);
    await migrateEventTime(f);
    path = f.path;
  }
  const core = openMemoryCore({ path, ...review }), db = new DatabaseSync(path);
  t.after(() => { core.close(); db.close(); });
  return { core, db };
}

for (const [physical, lineage] of [[29, false], [53, false], [53, true]]) {
  const cell = `physical ${physical}, Card lineage ${lineage ? 'on' : 'off'}`;
  test(`${cell}: forget and reject write only their scoped receipts`, async t => {
    const { core, db } = await setup(t, physical, lineage);
    const layout = installedContentLayout(db);
    assert.equal(layout.physical, physical);
    assert.equal(layout.suppressionRevision, physical === 53 ? 1 : 0);
    assert.equal(cardLineageRevision(layout), Number(lineage));
    const schema = db.prepare('SELECT type,name,sql FROM sqlite_schema ORDER BY type,name').all();

    const siblingNamespace = { ...ns, projectId: 'independent-project' };
    const target = admit(core, 'Synthetic memory to forget', [source, otherSource]);
    const sibling = admit(core, 'Synthetic surviving memory', [source], siblingNamespace);
    const siblingRow = receipts(db, sibling.id);
    const expected = [memory(db, target.id).fingerprint, ...receipts(db, target.id).flatMap(tokens)];
    ok(core.forget({ namespace: ns, memoryId: target.id, expectedRevision: target.revision }));
    assert.deepEqual(fingerprints(db), expected.toSorted());
    assert.deepEqual(fingerprints(db, siblingNamespace), []);
    assert.deepEqual(receipts(db, sibling.id), siblingRow);

    ok(await core.capture({ namespace: ns, client: 'review', sessionId: 'waiting', eventId: 'captured',
      messages: [{ id: 'decision-source', role: 'user', content: 'Synthetic waiting decision' }] }));
    const [pending] = ok(core.list({ namespace: ns, reviewState: 'awaiting' })).memories;
    const reject = { namespace: ns, memoryId: pending.id, expectedRevision: pending.revision, actionId: 'reject-shared-source' };
    const rejected = [memory(db, pending.id).fingerprint, ...receipts(db, pending.id).flatMap(tokens)];
    const first = ok(core.reject(reject));
    assert.equal(first.forgotten, true);
    assert.deepEqual(ok(core.reject(reject)), first);
    assert.deepEqual(fingerprints(db), [...expected, ...rejected].toSorted());
    assert.deepEqual(receipts(db, pending.id), []);
    assert.deepEqual(db.prepare('SELECT type,name,sql FROM sqlite_schema ORDER BY type,name').all(), schema);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, physical);
  });

  for (const replacement of ['different address', 'same address, reworded', 'identical re-cite']) {
    test(`${cell}: correction with ${replacement}`, async t => {
      const { core, db } = await setup(t, physical, lineage);
      const target = admit(core, 'Synthetic memory to revise', [source, otherSource]);
      const prior = receipts(db, target.id);
      const [oldIdentity, oldAddress] = tokens(prior.find(row => row.event_id === source.eventId));
      const expected = [memory(db, target.id).fingerprint, ...tokens(prior.find(row => row.event_id === otherSource.eventId))];
      const updated = replacement === 'different address' ? { ...source, eventId: 'new-message' } :
        replacement === 'same address, reworded' ? { ...source, excerpt: 'Synthetic revised excerpt.' } : source;
      if (replacement !== 'identical re-cite') expected.push(oldIdentity);
      if (replacement === 'different address') expected.push(oldAddress);
      ok(core.correct({ namespace: ns, memoryId: target.id, expectedRevision: target.revision,
        kind: 'fact', content: 'Synthetic corrected finding', receipt: updated }));
      assert.deepEqual(fingerprints(db), expected.toSorted());
      const [current] = receipts(db, target.id);
      assert.equal(current.event_id, updated.eventId);
      assert.equal(current.excerpt, updated.excerpt);
      assert.ok(prior.every(row => row.id !== current.id), 'the prior receipt incarnation retired');
      if (replacement === 'identical re-cite') assert.equal(current.receipt_key, oldIdentity.slice('rs1:i:'.length));
    });
  }
}

test('non-Raw Episode forget marks the exact linked Memory receipts', t => {
  const f = episodeFixture(t), input = batch(), episode = register(f, input);
  const origin = { client: input.client, sessionId: episode.sessionKey, eventId: input.view.messages[0].id,
    role: 'user', excerpt: input.view.messages[0].content };
  const content = 'Synthetic Episode finding';
  const stored = finish(f, input, [{ content, kind: 'fact', confidence: .8, origin: 'agent-inferred',
    fingerprint: digest(content.toLowerCase()), receipts: [origin], conflictHints: [] }]).memories[0];
  const [prior] = receipts(f.db, stored.id), revision = f.db.prepare('SELECT revision FROM session_episodes WHERE id=?').get(episode.episodeId).revision;
  const expected = [memory(f.db, stored.id).fingerprint, ...tokens(prior)].toSorted();
  assert.deepEqual(fingerprints(f.db, episodeNs), []);
  ok(f.core.forgetEpisode({ namespace: episodeNs, episodeId: episode.episodeId, expectedRevision: revision }));
  assert.deepEqual(fingerprints(f.db, episodeNs), expected);
  assert.deepEqual(receipts(f.db, stored.id), []);
});
