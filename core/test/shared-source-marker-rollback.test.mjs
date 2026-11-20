import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../index.mjs';
import { openDatabase, readTransaction, transaction } from '../database.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { dispatchSynchronousCommit } from '../commit-dispatch.mjs';
import { withContentWriteOperation } from '../content-write-context.mjs';
import { fingerprint } from '../validation.mjs';
import { receiptCoordinateStateInside, receiptDenialTokens } from '../raw-source-roots.mjs';
import { migrateEventTime } from '../testing/receipt-event-time-fixture.mjs';
import { ns, ok, safetyFixture } from '../testing/content-safety-s2h-fixture.mjs';

const source = { client: 'synthetic', sessionId: 'source-run', eventId: 'message-one',
  role: 'user', excerpt: 'Synthetic original source' };
const revisedContent = 'Synthetic revised finding';
const replacement = { ...source, eventId: 'message-two', excerpt: 'Synthetic replacement source' };
const error = code => ({ ok: false, error: { code, retryable: false } });

async function setup(t) {
  const f = safetyFixture(t, 33);
  await migrateEventTime(f);
  const core = openMemoryCore({ path: f.path }), db = f.connect();
  f.workspace.defer(() => { core.close(); db.close(); });
  const target = ok(core.admit({ namespace: ns, memory: { content: 'Synthetic finding', kind: 'fact' },
    receipts: [source] })).memory;
  const prior = db.prepare('SELECT * FROM receipts WHERE memory_id=?').get(target.id);
  const state = () => db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all().map(({ name }) => [name, db.prepare('SELECT * FROM "' + name + '"').all()]);
  const correct = (receipt = replacement) => core.correct({ namespace: ns, memoryId: target.id,
    expectedRevision: target.revision, content: revisedContent, kind: 'fact', receipt });
  const forget = () => core.forget({ namespace: ns, memoryId: target.id, expectedRevision: target.revision });
  return { db, path: f.path, prior, target, correct, forget, state };
}

for (const writer of ['correct', 'forget']) for (const mode of ['ABORT', 'ROLLBACK']) {
  test(`${writer}: SQLite RAISE(${mode}) discards markers and receipt coordinate state`, async t => {
    const f = await setup(t), before = f.state();
    f.db.exec(`CREATE TRIGGER synthetic_writer_failure BEFORE DELETE ON receipts
      BEGIN SELECT RAISE(${mode},'synthetic original writer error'); END`);
    const runtime = createMemoryRuntime({ path: f.path });
    t.after(() => runtime.close());
    const execute = () => dispatchSynchronousCommit(runtime, () => withContentWriteOperation(writer, [ns], () =>
      writer === 'forget' ? runtime.forget(ns, f.target.id, f.target.revision)
        : runtime.correct(ns, f.target.id, { content: revisedContent, fingerprint: fingerprint(revisedContent),
          kind: 'fact', receipts: [replacement] }, f.target.revision)));
    let writerDb, pendingCoordinates, nativeError, wroteBeforeFailure = false;
    const prepare = DatabaseSync.prototype.prepare;
    const hook = t.mock.method(DatabaseSync.prototype, 'prepare', function (sql) {
      const stmt = prepare.call(this, sql);
      if (sql !== 'DELETE FROM receipts WHERE memory_id = ?') return stmt;
      const run = stmt.run.bind(stmt);
      stmt.run = (...args) => {
        assert.equal(this.isTransaction, true);
        writerDb = this;
        pendingCoordinates = receiptCoordinateStateInside(this, 1, 1);
        pendingCoordinates.memories.set(f.target.id, { offsets: new Map([[f.prior.id, 5]]) });
        wroteBeforeFailure = prepare.call(this, "SELECT count(*) AS n FROM suppressed WHERE fingerprint LIKE 'rs1:%'").get().n === 2;
        try { return run(...args); }
        catch (error) { nativeError = error; throw error; }
      };
      return stmt;
    });
    try {
      assert.throws(execute, error => {
        assert.equal(error, nativeError, 'the original SQLite exception wins');
        assert.equal(error.code, 'ERR_SQLITE_ERROR');
        assert.equal(error.message, 'synthetic original writer error');
        return true;
      });
    }
    finally { hook.mock.restore(); f.db.exec('DROP TRIGGER synthetic_writer_failure'); }
    assert.equal(wroteBeforeFailure, true, 'the aborted transaction had stored both markers');
    assert.equal(writerDb.isTransaction, false);
    const fresh = receiptCoordinateStateInside(writerDb, 1, 1);
    assert.notEqual(fresh, pendingCoordinates, 'identical version and change counters start with a fresh memo');
    assert.equal(fresh.memories.size, 0);
    assert.deepEqual(f.state(), before);
    ok(f[writer]());
  });
}

for (const kind of ['identity retained by exact re-cite', 'address retained by rewording', 'foreign fingerprint']) {
  test(`native correction rejects an injected ${kind} before commit`, async t => {
    const f = await setup(t), before = f.state(), [identity, address] = receiptDenialTokens([f.prior]);
    const forged = kind.startsWith('identity') ? identity : kind.startsWith('address') ? address : 'f'.repeat(64);
    const incoming = kind.startsWith('address') ? { ...source, excerpt: 'Synthetic rewording' } : source;
    let injections = 0;
    const prepare = DatabaseSync.prototype.prepare;
    const hook = t.mock.method(DatabaseSync.prototype, 'prepare', function (sql) {
      const stmt = prepare.call(this, sql);
      if (!sql.startsWith('UPDATE memories SET content = ?')) return stmt;
      const run = stmt.run.bind(stmt);
      stmt.run = (...args) => {
        const result = run(...args);
        if (args.at(-1) === f.target.id) {
          assert.equal(this.isTransaction, true);
          prepare.call(this, 'INSERT INTO suppressed VALUES(?,?,?,?)')
            .run(ns.ownerId, ns.scope, ns.projectId ?? '', forged);
          injections++;
        }
        return result;
      };
      return stmt;
    });
    try { assert.deepEqual(f.correct(incoming), error('evidence_unavailable')); }
    finally { hook.mock.restore(); }
    assert.equal(injections, 1);
    assert.deepEqual(f.state(), before);
    ok(f.correct(incoming));
  });
}

for (const [name, begin, run] of [
  ['reader', 'BEGIN', readTransaction],
  ['immediate writer', 'BEGIN IMMEDIATE', transaction],
  ['deferred writer', 'BEGIN', (db, work) => transaction(db, work, undefined, { deferred: true })],
]) {
  test(`${name} preserves an error thrown after BEGIN and resets the connection`, t => {
    const db = openDatabase(':memory:');
    t.after(() => db.close());
    db.exec('CREATE TABLE begin_probe (value TEXT)');
    const stale = receiptCoordinateStateInside(db, 1, 1);
    stale.memories.set('synthetic-memory', { offsets: new Map() });
    const original = Error('instrumentation failed after BEGIN');
    const exec = db.exec.bind(db);
    const hook = t.mock.method(db, 'exec', sql => {
      const result = exec(sql);
      if (sql === begin) {
        assert.equal(db.isTransaction, true);
        if (name !== 'reader') exec("INSERT INTO begin_probe VALUES ('discarded')");
        throw original;
      }
      return result;
    });
    try {
      assert.throws(() => run(db, () => assert.fail('work ran after the BEGIN error')), error => error === original);
    } finally { hook.mock.restore(); }
    assert.equal(db.isTransaction, false);
    assert.equal(db.prepare('PRAGMA query_only').get().query_only, 0);
    const fresh = receiptCoordinateStateInside(db, 1, 1);
    assert.notEqual(fresh, stale);
    assert.equal(fresh.memories.size, 0);
    assert.equal(run(db, () => db.prepare('SELECT count(*) AS n FROM begin_probe').get().n), 0);
  });
}
