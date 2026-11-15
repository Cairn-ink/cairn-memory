import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setup, sql } from './fixtures/forget-episode.mjs';
import { copySqliteFixture } from '../../../core/testing/content-safety-s2h-fixture.mjs';
const child = fileURLToPath(new URL('./fixtures/forget-episode-reference.mjs', import.meta.url));
for (const layout of [29, 33]) for (const operation of ['forget', 'correct']) for (const noEpisodes of [true, false])
  test('legacy reference parity ' + layout + ' ' + operation + (noEpisodes ? ' without Episodes' : ' except Episode withholding'), { timeout: 120000 }, async t => {
    const f = await setup(t, { layout, noEpisodes, noCards: true });
    await f.close();
    sql(f.path, db => db.exec('PRAGMA wal_checkpoint(TRUNCATE)'));
    const results = [];
    for (const mode of ['reference', 'current']) {
      const path = join(f.workspace.path, mode + '.sqlite'); copySqliteFixture(f.path, path);
      const run = spawnSync(process.execPath, [child, path, mode, operation, f.target.id, String(f.target.revision)],
        { encoding: 'utf8', env: { NODE_NO_WARNINGS: '1' }, timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
      assert.equal(run.status, 0, 'reference child exit code: ' + run.status + ' ' + run.stderr);
      assert.equal(run.signal, null);
      results.push(JSON.parse(run.stdout));
    }
    const [reference, current] = results;
    assert.equal(reference.result.ok, true);
    assert.equal(current.result.ok, true);
    if (noEpisodes) {
      assert.equal(JSON.stringify(current.result), JSON.stringify(reference.result), 'identical result bytes');
      assert.equal(current.digest, reference.digest, 'identical database bytes');
    } else {
      // Episode invalidation advances its existing namespace epoch; no new result field is introduced.
      const withoutEpoch = result => { const copy = structuredClone(result); delete copy.value.indexRevision; return JSON.stringify(copy); };
      assert.equal(withoutEpoch(current.result), withoutEpoch(reference.result), 'only Episode epoch advancement may change the acknowledgement');
      for (const table of Object.keys(reference.tables)) {
        if (['session_episodes', 'episode_sources', 'episode_events', 'namespace_epochs'].includes(table)) continue;
        assert.equal(JSON.stringify(current.tables[table]), JSON.stringify(reference.tables[table]), table + ' bytes match the reference operation');
      }
      const decode = rows => rows.map(JSON.parse);
      assert.ok(decode(reference.tables.session_episodes).every(row => row.deleted === 0));
      assert.equal(decode(current.tables.session_episodes).filter(row => row.deleted === 1).length, 1);
    }
  });
