import test from 'node:test';
import assert from 'node:assert/strict';
import { openRawCaptureCore } from '../raw-capture.mjs';
import { transaction } from '../database.mjs';
import { memoryRelationEligible } from '../memory-relations-safety.mjs';
import { installMemoryThreadLayout } from '../testing/install-memory-thread-layout.mjs';
import { ns, ok } from '../testing/raw-capture-fixtures.mjs';
import { legacyFixture, consumer, opposite } from '../testing/raw-deletion-review-fixtures.mjs';

for (const client of ['codex', 'claude-code']) for (const change of ['forget', 'replace', 'replace-lineage-only']) {
  test(`legacy keep proof loss erases stored relations and times: ${client} ${change}`, async t => {
    const f = await legacyFixture(t, client);
    const core = openRawCaptureCore({ path: f.path }, { mode: 'off',
      ...(change === 'replace-lineage-only' ? { lineage: true } : { deletion: true }),
      readPolicy: () => { throw Error('Synthetic deletion must not consult policy'); } });
    f.workspace.defer(() => core.close());
    const admit = content => ok(core.admit({ namespace: ns, memory: { content, kind: 'fact' },
      receipts: [{ client: 'manual', sessionId: 'synthetic', eventId: content, role: 'user', excerpt: content }] })).memory;
    const peer = admit('Synthetic independent peer'), other = admit('Synthetic independent control');
    installMemoryThreadLayout(f.path);
    const memory = f.db.prepare('SELECT * FROM memories WHERE id=?').get(f.memoryId);
    assert.equal(transaction(f.db, () => memoryRelationEligible(f.db, ns,
      { type: 'memory', namespace: ns, memoryId: memory.id, revision: memory.revision })), true);
    const receipts = f.db.prepare('SELECT * FROM receipts WHERE memory_id=? ORDER BY id').all(memory.id);
    const edge = f.db.prepare(`INSERT INTO memory_relations
      (id,from_memory_id,from_revision,to_memory_id,to_revision,relation,confidence,decided_by,reason,created_at)
      VALUES(?,?,?,?,?,'refines',1,'llm','Synthetic retained reason','now')`);
    edge.run('affected', peer.id, peer.revision, memory.id, memory.revision);
    edge.run('control', peer.id, peer.revision, other.id, other.revision);
    const time = f.db.prepare('INSERT INTO memory_relation_times VALUES(?,?,?,?)');
    time.run(memory.id, memory.revision, '2026-01-01T00:00:00.000Z', receipts[0].id);
    time.run(peer.id, peer.revision, '2026-01-01T00:00:00.000Z',
      f.db.prepare('SELECT id FROM receipts WHERE memory_id=?').get(peer.id).id);
    const controls = [f.db.prepare("SELECT * FROM memory_relations WHERE id='control'").get(),
      f.db.prepare('SELECT * FROM memory_relation_times WHERE memory_id=?').get(peer.id)];
    assert.equal(f.db.prepare('SELECT count(*) n FROM raw_conversations').get().n, 0);
    if (change === 'replace-lineage-only') assert.equal(f.db.prepare(
      "SELECT count(*) n FROM sqlite_schema WHERE name='raw_deletion_actions'").get().n, 0);
    if (change === 'forget') {
      const episode = ok(core.getEpisode({ namespace: ns, episodeId: f.consumer })).episode;
      ok(core.forgetEpisode({ namespace: ns, episodeId: f.consumer, expectedRevision: episode.revision }));
    } else consumer(f, f.runtime, { client: opposite(client), eventId: 'synthetic-replacement', own: true });
    assert.deepEqual(f.db.prepare('SELECT * FROM memories WHERE id=?').get(memory.id), memory,
      'source proof loss leaves the memory revision unchanged');
    assert.deepEqual(f.db.prepare('SELECT * FROM receipts WHERE memory_id=? ORDER BY id').all(memory.id), receipts);
    assert.equal(f.db.prepare('SELECT count(*) n FROM memory_relations WHERE from_memory_id=? OR to_memory_id=?')
      .get(memory.id, memory.id).n, 0, 'incident edge and its reason are physically erased');
    assert.equal(f.db.prepare('SELECT count(*) n FROM memory_relation_times WHERE memory_id=?').get(memory.id).n,
      0, 'relation time is physically erased');
    assert.deepEqual([f.db.prepare("SELECT * FROM memory_relations WHERE id='control'").get(),
      f.db.prepare('SELECT * FROM memory_relation_times WHERE memory_id=?').get(peer.id)], controls);
  });
}

for (const change of ['forget', 'replace']) test(`source proof mutation and relation cleanup roll back together: ${change}`, async t => {
  const f = await legacyFixture(t, 'codex');
  const core = openRawCaptureCore({ path: f.path }, { mode: 'off', deletion: true,
    readPolicy: () => { throw Error('Synthetic deletion must not consult policy'); } });
  f.workspace.defer(() => core.close());
  const peer = ok(core.admit({ namespace: ns, memory: { content: 'Synthetic independent peer', kind: 'fact' },
    receipts: [{ client: 'manual', sessionId: 'synthetic', eventId: 'peer', role: 'user', excerpt: 'Synthetic peer' }] })).memory;
  installMemoryThreadLayout(f.path);
  const memory = f.db.prepare('SELECT * FROM memories WHERE id=?').get(f.memoryId);
  const receipt = f.db.prepare('SELECT id FROM receipts WHERE memory_id=?').get(memory.id);
  f.db.prepare(`INSERT INTO memory_relations
    (id,from_memory_id,from_revision,to_memory_id,to_revision,relation,confidence,decided_by,reason,created_at)
    VALUES('affected',?,?,?,?,'refines',1,'llm','Synthetic retained reason','now')`)
    .run(peer.id, peer.revision, memory.id, memory.revision);
  f.db.prepare('INSERT INTO memory_relation_times VALUES(?,?,?,?)')
    .run(memory.id, memory.revision, '2026-01-01T00:00:00.000Z', receipt.id);
  const snapshot = () => ['episode_sources', 'memories', 'receipts', 'memory_relations', 'memory_relation_times']
    .map(table => [table, f.db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()]);
  const retained = snapshot();
  f.db.exec(`CREATE TRIGGER synthetic_cleanup_abort BEFORE DELETE ON memory_relation_times
    BEGIN SELECT RAISE(ABORT,'synthetic cleanup abort'); END;`);
  if (change === 'forget') {
    const episode = ok(core.getEpisode({ namespace: ns, episodeId: f.consumer })).episode;
    const result = core.forgetEpisode({ namespace: ns, episodeId: f.consumer, expectedRevision: episode.revision });
    assert.equal(result.ok, false); assert.equal(result.error.code, 'storage_error');
    assert.equal(ok(core.getEpisode({ namespace: ns, episodeId: f.consumer })).episode.revision, episode.revision);
  } else assert.throws(() => consumer(f, f.runtime, { client: 'claude-code', eventId: 'synthetic-replacement', own: true }),
    /synthetic cleanup abort/);
  assert.deepEqual(snapshot(), retained, 'source rows, retained support, edges and times share the failed transaction');
});
