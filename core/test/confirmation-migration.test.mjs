import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { captureEpisodeParity } from '../testing/episode-parity.mjs';
import { bytes, readOutputs } from '../testing/confirmation-parity.mjs';
import { openDatabase as oldOpen } from '../testing/confirmation-v17-database.mjs';

// Frozen actual v17 opener from the recorded main base, with only relative imports relocated.
const root = new URL('../../', import.meta.url).pathname;
function baseline(t) {
  const ws = createTestWorkspace(t, { prefix: 'cf1-migration-' });
  const old = { openSeedDatabase({ path }) {
    const db = oldOpen(path);
    let closed = false;
    const close = () => { if (!closed) { db.close(); closed = true; } };
    ws.defer(close);
    return { seed() {
      db.exec(`INSERT INTO memories(id,owner_id,scope,project_id,fingerprint,content,kind,origin,confidence,revision,created_at,updated_at)
        VALUES('synthetic','parity','personal','','synthetic','Synthetic prior decision','decision','explicit',1,1,
          '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
        INSERT INTO namespace_epochs VALUES('parity','personal','',3);`);
    }, close };
  } };
  return { ws, old };
}
const tables = db => Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
  .map(({ name }) => [name, db.prepare('SELECT * FROM ' + name).all()]));

test('CF1 eager v17 migration preserves old values, revisions and epoch; actual older opener refuses v18', t => {
  const { ws, old } = baseline(t); const path = join(ws.path, 'store.sqlite');
  const seedDb = old.openSeedDatabase({ path }); seedDb.seed(); seedDb.close();
  const db = new DatabaseSync(path); ws.defer(() => db.close());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 17);
  const before = tables(db);
  openMemoryCore({ path }).close();
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 18);
  const after = tables(db);
  for (const [name, rows] of Object.entries(before)) {
    assert.deepEqual(after[name].map(row => Object.fromEntries(Object.keys(rows[0] ?? {}).map(key => [key, row[key]]))),
      rows.map(row => ({ ...row })));
  }
  assert.equal(db.prepare('SELECT review_state FROM memories').get().review_state, 'none');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  const schema = db.prepare('SELECT * FROM sqlite_master ORDER BY name').all();
  assert.throws(() => old.openSeedDatabase({ path }), { code: 'unsupported_database' });
  assert.deepEqual(db.prepare('SELECT * FROM sqlite_master ORDER BY name').all(), schema);
  openMemoryCore({ path, decisionReview: 'required-v1' }).close();
  assert.deepEqual(db.prepare('SELECT * FROM sqlite_master ORDER BY name').all(), schema);
});

test('CF1 injected late migration failure rolls back column, views, triggers, rows and schema version', t => {
  const { ws, old } = baseline(t);
  for (const enabled of [false, true]) for (const collision of ['review_hidden_episodes', 'index_read_edges']) {
    const path = join(ws.path, `rollback-${enabled}-${collision}.sqlite`);
    const seedDb = old.openSeedDatabase({ path }); seedDb.seed(); seedDb.close();
    const db = new DatabaseSync(path); ws.defer(() => db.close());
    // Fail both after the new column/ledger and late in reader/trigger replacement.
    if (collision === 'index_read_edges') db.exec('DROP VIEW index_read_edges');
    db.exec(`CREATE TABLE ${collision}(precious TEXT); INSERT INTO ${collision} VALUES('retain')`);
    const schema = db.prepare('SELECT * FROM sqlite_master ORDER BY name').all(), before = tables(db);
    assert.throws(() => openMemoryCore({ path, ...(enabled ? { decisionReview: 'required-v1' } : {}) }));
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 17);
    assert.deepEqual(db.prepare('SELECT * FROM sqlite_master ORDER BY name').all(), schema);
    assert.deepEqual(tables(db), before);
    old.openSeedDatabase({ path }).close();
  }
});

test('CF1 option-off bytes match frozen main baseline on existing capture fixtures and reader outputs', async t => {
  const { ws } = baseline(t);
  const fixture = JSON.parse(readFileSync(new URL('../testing/confirmation-v17-parity.json', import.meta.url), 'utf8'));
  assert.equal(fixture.base, 'c558593bd7dc4700a09235aeb8ebbd93184a0ea4');
  for (const [i, { config, capture, reads }] of fixture.cases.entries()) {
    const path = join(ws.path, `parity-${i}.sqlite`);
    assert.equal(bytes(await captureEpisodeParity(root, path, config)), bytes(capture));
    assert.equal(await readOutputs(openMemoryCore, path), reads);
  }
});
