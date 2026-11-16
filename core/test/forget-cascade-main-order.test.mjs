import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { sourceFixture, savedSource, ns, ok, denied } from '../testing/raw-source-fixtures.mjs';

const normalizeSql = sql => sql.replace(/\s+/g, ' ').trim();
// Expanded from invalidateMemoryEpisodesInside's nsWhere and selection SQL.
const memoryEpisodeSelection = 'SELECT id FROM session_episodes WHERE owner_id=? AND scope=? AND project_id=?'
  + ' AND client=? AND session_key=? AND deleted=0';

function tracePrepared(run) {
  const prototype = DatabaseSync.prototype, prepare = prototype.prepare;
  const statements = [], perMemorySelections = [];
  prototype.prepare = function (query, ...args) {
    const sql = normalizeSql(query);
    statements.push(sql);
    // The cascade's planner and cleanup use identical SQL. Attribute matches
    // to the per-memory helper so the cascade's own Episode handling is allowed.
    if (sql === memoryEpisodeSelection && new Error().stack.includes('invalidateMemoryEpisodesInside'))
      perMemorySelections.push(sql);
    return Reflect.apply(prepare, this, [query, ...args]);
  };
  let result;
  try { result = run(); }
  finally { prototype.prepare = prepare; }
  assert.ok(statements.length > 0, 'the mutation SQL was observed');
  return { result, statements, perMemorySelections };
}

async function cascadeFixture(t) {
  const f = sourceFixture(t, { kind: 'episode', model: {
    extract: () => ({ items: ['north', 'south'].map(direction => ({
      content: 'Synthetic remembered '+direction+' choice.', kind: 'fact',
      confidence: .8, sourceIndices: [0],
    })) }),
  } });
  const source = await savedSource(f, 'Synthetic source for two remembered choices.', {
    client: 'claude-code', sessionId: 'source',
    episodeContext: { clientLabel: 'Synthetic', generation: 'initial', origin: 'ordinary' },
  });
  // Each case opens a fresh local handle and traces its first mutation.
  const local = openMemoryCore({ path: f.path, raw: true, rawSearch: false });
  f.workspace.defer(() => local.close());
  const memories = f.db.prepare(`SELECT DISTINCT m.id,m.revision FROM memories m
    JOIN receipts r ON r.memory_id=m.id JOIN raw_receipt_lineage l ON l.receipt_id=r.id
    WHERE l.conversation_id=? AND m.deleted=0 ORDER BY m.id`).all(source.conversationId);
  assert.equal(memories.length, 2, 'two live Memories have receipts from the source conversation');
  const episode = f.db.prepare(`SELECT e.id,e.revision,e.deleted FROM session_episodes e
    JOIN raw_conversations c ON c.client=e.client AND c.session_key=e.session_key
    WHERE c.id=?`).get(source.conversationId);
  assert.ok(episode);
  assert.equal(episode.deleted, 0);
  assert.ok(f.db.prepare('SELECT count(*) n FROM episode_sources WHERE episode_id=?').get(episode.id).n > 0);
  assert.deepEqual(f.db.prepare('SELECT memory_id FROM episode_memory_links WHERE episode_id=? ORDER BY memory_id')
    .all(episode.id).map(row => row.memory_id), memories.map(row => row.id), 'both Memories are linked to the source Episode');
  return { ...f, local, source, memories, episode };
}

for (const operation of ['deleteConversation', 'forgetEpisode']) {
  test(`local ${operation} cascades without per-memory Episode selection`, async t => {
    const f = await cascadeFixture(t);
    const trace = tracePrepared(() => operation === 'deleteConversation'
      ? f.local.deleteConversation({ namespace: ns, conversationId: f.source.conversationId,
        expectedRevision: f.source.expectedConversationRevision, actionId: 'synthetic-delete' })
      : f.local.forgetEpisode({ namespace: ns, episodeId: f.episode.id, expectedRevision: f.episode.revision }));
    const result = ok(trace.result);
    if (operation === 'deleteConversation') assert.equal(result.forgottenMemories, 2);
    else assert.equal(result.forgotten, true);
    assert.equal(trace.perMemorySelections.length, 0, 'a cascade never selects Episodes through the per-memory helper');
    assert.ok(trace.statements.includes(memoryEpisodeSelection), 'the cascade still prepares its own Episode selection');
    for (const memory of f.memories)
      assert.equal(f.db.prepare('SELECT deleted FROM memories WHERE id=?').get(memory.id).deleted, 1);
    assert.equal(f.db.prepare('SELECT 1 FROM raw_conversations WHERE id=?').get(f.source.conversationId), undefined);
    assert.equal(f.db.prepare('SELECT deleted FROM session_episodes WHERE id=?').get(f.episode.id).deleted, 1);
    assert.equal(f.db.prepare('SELECT count(*) n FROM episode_sources WHERE episode_id=?').get(f.episode.id).n, 0);
    denied(f.local.getEpisode({ namespace: ns, episodeId: f.episode.id }), 'episode_not_found');
  });
}

test('local user forget still removes the Episode named by its Memory receipt', async t => {
  const f = sourceFixture(t, { kind: 'episode', model: {
    extract: () => ({ items: [{ content: 'Synthetic remembered choice.', kind: 'fact',
      confidence: .8, sourceIndices: [0] }] }),
  } });
  const source = await savedSource(f, 'Synthetic source for a remembered choice.', {
    client: 'claude-code', sessionId: 'source',
    episodeContext: { clientLabel: 'Synthetic', generation: 'initial', origin: 'ordinary' },
  });
  const local = openMemoryCore({ path: f.path, raw: true, rawSearch: false });
  f.workspace.defer(() => local.close());
  const memory = f.db.prepare('SELECT id,revision FROM memories WHERE deleted=0').get();
  const episode = f.db.prepare(`SELECT e.id,e.deleted FROM session_episodes e
    JOIN raw_conversations c ON c.client=e.client AND c.session_key=e.session_key
    WHERE c.id=?`).get(source.conversationId);
  assert.ok(memory);
  assert.ok(episode);
  assert.equal(episode.deleted, 0);
  assert.ok(f.db.prepare('SELECT count(*) n FROM episode_sources WHERE episode_id=?').get(episode.id).n > 0);

  const trace = tracePrepared(() => local.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
  assert.equal(ok(trace.result).forgotten, true);
  assert.ok(trace.statements.includes(memoryEpisodeSelection), 'user forget prepares the exact Episode selection SQL');
  assert.ok(trace.perMemorySelections.length > 0, 'the positive control observes the per-memory helper selection');

  assert.equal(f.db.prepare('SELECT deleted FROM memories WHERE id=?').get(memory.id).deleted, 1);
  assert.equal(f.db.prepare('SELECT deleted FROM session_episodes WHERE id=?').get(episode.id).deleted, 1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM episode_sources WHERE episode_id=?').get(episode.id).n, 0);
  denied(local.getEpisode({ namespace: ns, episodeId: episode.id }), 'episode_not_found');
});
