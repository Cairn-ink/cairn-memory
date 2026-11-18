import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { beginContentWriteSafety } from '../../../core/content-write-safety.mjs';
import { registerContentWriteGuard } from '../../../core/content-write-context.mjs';
import { transaction } from '../../../core/database.mjs';
import { contentSafetyFacade } from '../../../core/content-safety-boundary.mjs';
import { readSqliteFixture } from '../../../core/testing/content-safety-s2h-fixture.mjs';
import { setup, sql, range, ok } from './fixtures/forget-episode.mjs';

// A checkpoint before each refusal makes both the main database and its WAL
// comparable without a connection-close checkpoint disguising rollback writes.
function checkpoint(path) { sql(path, db => db.exec('PRAGMA wal_checkpoint(TRUNCATE)')); }
function bytes(path) {
  return Object.fromEntries(['', '-wal'].map(suffix => [suffix,
    existsSync(path + suffix) ? readSqliteFixture(path + suffix) : Buffer.alloc(0)]));
}
const origin = (f, independent = false) => f.episodes.find(row =>
  JSON.parse(row.record).gist.includes(independent ? 'independent' : 'forgetneedle'));
function fence(db, row) {
  db.prepare('INSERT OR IGNORE INTO raw_session_fences VALUES(?,?,?,?,?)')
    .run(row.owner_id, row.scope, row.project_id, row.client, row.session_key);
}
async function inject(f, operation, work) {
  let validations = 0;
  registerContentWriteGuard((db, context) => {
    const state = beginContentWriteSafety(db, context);
    if (!state) return state;
    return { ...state, validate(result) {
      if (context.method === operation) { validations++; work(db); }
      state.validate(result);
    } };
  });
  try { return { result: await f.act(operation), validations }; }
  finally { registerContentWriteGuard(beginContentWriteSafety); }
}
for (const operation of ['forget', 'correct']) for (const control of [
  'forged fence', 'unrelated session fence', 'retained record without invalidation', 'another operation fenced the same session first'
]) test(operation + ' commit refuses ' + control + ' without changing bytes', { concurrency: false }, async t => {
  const f = await setup(t, { layout: 53 }), target = origin(f), other = origin(f, true);
  const source = sql(f.path, db => db.prepare('SELECT * FROM episode_sources WHERE episode_id=? LIMIT 1').get(other.id));
  assert.ok(source);
  if (control.startsWith('another')) {
    // An independently committed operation owns this fence before forget begins.
    sql(f.path, db => fence(db, other));
  }
  checkpoint(f.path);
  const before = bytes(f.path);
  const { result, validations } = await inject(f, operation, db => {
    if (control === 'forged fence') {
      // The operation has invalidated its real target. A fabricated fence cannot
      // authorize a still-current second Episode under the same public method.
      fence(db, other);
      db.prepare('UPDATE session_episodes SET revision=revision+1 WHERE id=?').run(other.id);
    } else if (control === 'unrelated session fence') {
      fence(db, other);
      db.prepare('UPDATE session_episodes SET revision=revision+1 WHERE id=?').run(other.id);
      assert.notEqual(other.session_key, target.session_key);
    } else {
      if (!control.startsWith('another')) fence(db, other);
      // A retained anchor in a changed canonical JSON record must be re-resolved.
      db.prepare('UPDATE session_episodes SET revision=revision+1 WHERE id=?').run(other.id);
    }
  });
  assert.equal(validations, 1, 'the actual commit guard sees the attempted write');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'conversation_deleted', 'retain the existing fence error');
  assert.deepEqual(bytes(f.path), before, 'refusal leaves database and WAL byte-unchanged');
});
for (const layout of [29, 33, 48, 53]) for (const operation of ['forget', 'correct'])
  test('atomic rollback at fence write ' + layout + ' ' + operation, { concurrency: false }, async t => {
    const f = await setup(t, { layout });
    sql(f.path, db => db.exec(`CREATE TRIGGER reject_test_fence BEFORE INSERT ON raw_session_fences
      BEGIN SELECT RAISE(ABORT,'synthetic_fence_refusal'); END`));
    checkpoint(f.path); const before = bytes(f.path);
    const result = await f.act(operation);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'local_raw_privacy_write_failed');
    assert.deepEqual(bytes(f.path), before, 'Episode invalidation rolls back together with the fence');
    const page = ok(await f.core.listEpisodes({ namespace: f.namespace, ...range, timeBasis: 'receipt' }));
    assert.equal(page.items.length, f.episodes.length);
  });

for (const layout of [48, 53]) for (const operation of ['forget', 'correct'])
  test(operation + ' commit cannot trust a prior fence on the same session ' + layout, { concurrency: false }, async t => {
    const f = await setup(t, { layout }), target = origin(f);
    sql(f.path, db => fence(db, target));
    const db = new DatabaseSync(f.path); t.after(() => db.close());
    checkpoint(f.path); const before = bytes(f.path);
    let mutations = 0;
    const api = contentSafetyFacade({ [operation]() { return transaction(db, () => {
      mutations++;
      db.prepare('UPDATE session_episodes SET revision=revision+1 WHERE id=?').run(target.id);
      return {};
    }); } }, { check() {}, failure: error => ({ ok: false, error: { code: error.code } }) });
    const result = api[operation]({ namespace: f.namespace });
    assert.equal(mutations, 1, 'the denial occurs at commit, after the attempted mutation');
    assert.equal(result.error?.code, 'conversation_deleted');
    assert.deepEqual(bytes(f.path), before);
  });
