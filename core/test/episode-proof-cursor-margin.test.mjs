import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { SAFETY_SCHEMA_VERSIONS, resolveContentLayout } from '../content-safety-layout.mjs';
import { openMemoryCore } from '../index.mjs';
import { costFamilyFixture } from '../testing/content-safety-cost-families.mjs';
import { ns } from '../testing/episode-helpers.mjs';

const layouts = [34, 38, 48, 51, 52, 53];
const range = { since: '2026-01-01T00:00:00.000Z', until: '2026-12-31T00:00:00.000Z' };
const cursorOpen = /^(Open(Read|Write|Ephemeral|Autoindex|Pseudo|Dup)|ReopenIdx|SorterOpen|VOpen)$/;
const cursorLimit = 750;

function measure(call) {
  const prepare = DatabaseSync.prototype.prepare;
  const statements = [];
  DatabaseSync.prototype.prepare = function (sql) {
    if (!sql.startsWith('WITH candidates AS MATERIALIZED (')) return prepare.call(this, sql);
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
  };
  try { call(); }
  finally { DatabaseSync.prototype.prepare = prepare; }
  return statements;
}

test('Episode proof cursor margin fixtures cover the suppression layouts', () => {
  assert.deepEqual(layouts, SAFETY_SCHEMA_VERSIONS.filter(physical => resolveContentLayout(physical).suppressionRevision));
});

for (const physical of layouts) {
  test(`Episode proof cursor margin on layout ${physical}`, async t => {
    const layout = resolveContentLayout(physical);
    const fixture = costFamilyFixture(t, layout.base, layout.attestedFeatures ? 'event-time' : 'safety');
    assert.equal((await fixture.migrate()).physical, physical);
    const core = openMemoryCore({ path: fixture.path, model: { contextWindow: 8192, countTokens: () => 1 } });
    fixture.workspace.defer(() => core.close());
    const calls = {
      getEpisode: () => core.getEpisode({ namespace: ns, episodeId: 'missing-episode' }),
      'listEpisodes (event)': () => core.listEpisodes({ namespace: ns, ...range, timeBasis: 'event' }),
      'listEpisodes (receipt)': () => core.listEpisodes({ namespace: ns, ...range, timeBasis: 'receipt' }),
      nextSteps: () => core.sessionStartContext({ namespace: ns, groups: { nextSteps: true, procedural: false } })
    };
    const failures = [];
    for (const [caller, call] of Object.entries(calls)) {
      const statements = measure(call);
      t.diagnostic(JSON.stringify({ physical, caller, statements }));
      const pair = ['fence', 'proof'];
      assert.deepEqual(statements.map(({ kind }) => kind), caller === 'nextSteps' && !statements.some(({ error }) => error)
        ? [...pair, ...pair] : pair, caller);
      for (const { kind, maximum, error } of statements) {
        if (error || !(maximum >= 0 && maximum < cursorLimit)) failures.push(`${caller} ${kind}: ${error ?? maximum}`);
      }
    }
    assert.deepEqual(failures, [], `Episode projection cursor numbers must be below ${cursorLimit}`);
  });
}
