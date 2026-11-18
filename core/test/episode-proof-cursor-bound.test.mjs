import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { call as mcpCall, episodeHost } from '../../adapters/mcp/test/fixtures/episode-server.mjs';
import { SAFETY_SCHEMA_VERSIONS, resolveContentLayout } from '../content-safety-layout.mjs';
import { openMemoryCore } from '../index.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { costFamilyFixture } from '../testing/content-safety-cost-families.mjs';
import { batch, draft, ns, ok, register } from '../testing/episode-helpers.mjs';

const layouts = new Map([
  [34, 'legacy base 18'], [38, 'legacy base 23'], [48, 'legacy base 33 with Raw lineage'],
  [51, 'attested base 18'], [52, 'attested base 23'], [53, 'attested base 33 with Raw lineage']
]);
const range = { since: '2026-01-01T00:00:00.000Z', until: '2026-12-31T00:00:00.000Z' };
const cursorOpen = /^(Open(Read|Write|Ephemeral|Autoindex|Pseudo|Dup)|ReopenIdx|SorterOpen|VOpen)$/;

export async function checkEpisodeProofCursors(t, physical) {
  const layout = resolveContentLayout(physical);
  const fixture = costFamilyFixture(t, layout.base, layout.attestedFeatures ? 'event-time' : 'safety');
  assert.equal((await fixture.migrate()).physical, physical);
  const core = openMemoryCore({ path: fixture.path, model: { contextWindow: 8192, countTokens: () => 1 } });
  t.after(() => core.close());
  const calls = {
    getEpisode: () => core.getEpisode({ namespace: ns, episodeId: 'missing-episode' }),
    'listEpisodes (event)': () => core.listEpisodes({ namespace: ns, ...range }),
    'listEpisodes (receipt)': () => core.listEpisodes({ namespace: ns, ...range, timeBasis: 'receipt' }),
    nextSteps: () => core.sessionStartContext({ namespace: ns, groups: { nextSteps: true, procedural: false } })
  };
  const prepare = DatabaseSync.prototype.prepare;
  const failures = [];
  for (const [name, call] of Object.entries(calls)) {
    const statements = [];
    DatabaseSync.prototype.prepare = function (sql) {
      if (sql.startsWith('WITH candidates AS MATERIALIZED (')) {
        const kind = sql.includes('headers AS MATERIALIZED (') ? 'fence' : 'proof';
        try {
          const statement = prepare.call(this, sql);
          const bytecode = prepare.call(this, `EXPLAIN ${sql}`).all();
          // EXPLAIN is a lower bound: SQLite can allocate cursors that emit no opcode.
          const maximum = Math.max(...bytecode.flatMap(({ opcode, p1, p2 }) =>
            opcode === 'OpenDup' ? [p1, p2] : cursorOpen.test(opcode) ? [p1] : []));
          statements.push({ kind, maximum });
          return statement;
        } catch (error) {
          statements.push({ kind, error: `${error.code}: ${error.message}` });
          throw error;
        }
      }
      return prepare.call(this, sql);
    };
    try { call(); }
    finally { DatabaseSync.prototype.prepare = prepare; }
    const pair = ['fence', 'proof'];
    assert.deepEqual(statements.map(({ kind }) => kind), name === 'nextSteps' && !statements.some(s => s.error)
      ? [...pair, ...pair] : pair, name);
    t.diagnostic(`${name}: ${JSON.stringify(statements)}`);
    for (const { kind, maximum, error } of statements) {
      if (error || !(maximum >= 0 && maximum < 1000)) failures.push(`${name} ${kind}: ${error ?? maximum}`);
    }
  }
  assert.deepEqual(failures, [], 'Episode projection cursor bounds');
}

test('Episode proof cursor fixtures cover the suppression layouts', () => {
  assert.deepEqual([...layouts.keys()], SAFETY_SCHEMA_VERSIONS.filter(physical => resolveContentLayout(physical).suppressionRevision));
});

for (const physical of SAFETY_SCHEMA_VERSIONS.filter(physical => resolveContentLayout(physical).suppressionRevision)) {
  test(`Episode proof cursor bound on layout ${physical} (${layouts.get(physical)})`, t => checkEpisodeProofCursors(t, physical));
}

test('Episode proof read and forget entry points on an attested Raw lineage layout', async t => {
  const fixture = costFamilyFixture(t, 33, 'event-time');
  await fixture.migrate();
  const db = fixture.connect();
  const runtime = createMemoryRuntime({ path: fixture.path, sessionEpisodes: { mode: 'episode-v1' } });
  const core = openMemoryCore({ path: fixture.path, model: { contextWindow: 8192, countTokens: () => 1 } });
  t.after(() => { core.close(); runtime.close(); db.close(); });
  const publish = name => {
    const input = { ...batch(name, 'Synthetic source for ' + name, name), client: 'codex' };
    const registered = register({ runtime }, input);
    const { commit, writer } = draft({ runtime }, registered, input);
    commit.result.nextStep.value = 'Review ' + name;
    runtime.commitEpisodeDraft(ns, commit);
    runtime.releaseEpisodeWriter(ns, { episodeId: registered.episodeId, token: writer.token });
    return registered.episodeId;
  };
  const older = publish('older');
  const newest = publish('newest');
  const time = db.prepare('UPDATE session_episodes SET first_received_at=? WHERE id=?');
  time.run('2026-06-02T00:00:00.000Z', newest);
  time.run('2026-06-01T00:00:00.000Z', older);
  const get = { namespace: ns, episodeId: newest };
  let revision;
  await t.test('getEpisode', () => {
    const detail = ok(core.getEpisode(get));
    revision = detail.episode.revision;
    assert.equal(detail.episode.id, newest);
    assert.deepEqual(detail.sources.items.map(source => source.text), ['Synthetic source for newest']);
  });
  await t.test('listEpisodes', () => {
    const input = { namespace: ns, ...range, timeBasis: 'receipt', client: 'codex', limit: 1 };
    const first = ok(core.listEpisodes(input));
    assert.deepEqual(first.items.map(item => item.id), [newest]);
    assert.equal(typeof first.nextCursor, 'string');
    const second = ok(core.listEpisodes({ ...input, cursor: first.nextCursor }));
    assert.deepEqual(second.items.map(item => item.id), [older]);
    assert.equal(second.nextCursor, null);
  });
  await t.test('nextSteps', () => {
    const context = ok(core.sessionStartContext({ namespace: ns, groups: { nextSteps: true, procedural: false } }));
    assert.deepEqual(context.groups.nextSteps.items.map(item => [item.episodeId, item.nextStep.text]), [[newest, 'Review newest']]);
  });
  await t.test('client-scoped forgetEpisode', async subtest => {
    const host = await episodeHost(subtest, fixture.path, { home: fixture.workspace.path, ns, readClient: 'codex' });
    const forgotten = await mcpCall(host, 'forget_session_episode', { episodeId: newest, expectedRevision: revision });
    assert.deepEqual(ok(forgotten), { forgotten: true });
    assert.equal(core.getEpisode(get).error.code, 'episode_not_found');
  });
});
