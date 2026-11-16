import test from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryCore } from '../index.mjs';
import { sourceFixture, savedSource, ns, ok, denied } from '../testing/raw-source-fixtures.mjs';

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

  assert.equal(ok(local.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision })).forgotten, true);

  assert.equal(f.db.prepare('SELECT deleted FROM memories WHERE id=?').get(memory.id).deleted, 1);
  assert.equal(f.db.prepare('SELECT deleted FROM session_episodes WHERE id=?').get(episode.id).deleted, 1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM episode_sources WHERE episode_id=?').get(episode.id).n, 0);
  denied(local.getEpisode({ namespace: ns, episodeId: episode.id }), 'episode_not_found');
});
