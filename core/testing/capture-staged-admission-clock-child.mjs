// Test-only child: expire the monotonic clock after the real receipt INSERT.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const [parent, mutation] = process.argv.slice(2);
assert.equal(typeof parent, 'string', 'parent owns child scratch on timeout');
assert.ok(mutation === undefined || mutation === 'remove-post-work-check');
let mutatedModules = 0;
if (mutation) registerHooks({ load(url, context, nextLoad) {
  const loaded = nextLoad(url, context);
  if (!url.endsWith('/core/database.mjs')) return loaded;
  const source = String(loaded.source);
  const target = '    const result = work();\n    check?.();\n    db.exec("COMMIT");';
  assert.equal(source.split(target).length, 2, 'one transaction post-work check');
  mutatedModules++;
  return { ...loaded, source: source.replace(target,
    '    const result = work();\n    db.exec("COMMIT");') };
} });

const realNow = process.hrtime.bigint;
let now = 0n;
process.hrtime.bigint = () => now;
const workspace = createTestWorkspace(null, { prefix: 'cairn-staged-admission-clock-', parent });
const prepare = DatabaseSync.prototype.prepare;
let reached = 0, insideReceipt, insideCompleted;
try {
  // The deadline module snapshots hrtime at import; all setup remains at zero.
  const [{ openMemoryCore }, { rationaleModel }] = await Promise.all([
    import('../contract.mjs'), import('./rationale-model.mjs'),
  ]);
  if (mutation) assert.equal(mutatedModules, 1);
  const path = join(workspace.path, 'memory.sqlite');
  const core = openMemoryCore({ path, model: rationaleModel(), captureDeadlineMs: 600,
    captureQualification: 'source-bound-v2', captureEvidence: 'staged-v1' });
  workspace.defer(() => core.close());
  const db = new DatabaseSync(path);
  workspace.defer(() => db.close());
  const count = (connection, table) => connection.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
  const state = (connection, table) => connection.prepare(
    `SELECT state FROM ${table} WHERE event_id='staged-final'`).get()?.state ?? null;
  const snapshot = connection => ({
    memories: count(connection, 'memories'), receipts: count(connection, 'receipts'),
    journal: count(connection, 'capture_initial_classification'),
    qualifications: count(connection, 'memory_qualifications'),
    anchors: count(connection, 'qualification_anchors'),
    claim: state(connection, 'admission_claims'), staged: state(connection, 'staged_capture_evidence'),
  });
  DatabaseSync.prototype.prepare = function(sql) {
    const connection = this, statement = prepare.call(this, sql);
    const receipt = sql.includes('INSERT OR IGNORE INTO receipts');
    const journal = sql.includes('INSERT INTO capture_initial_classification');
    if (!receipt && !journal) return statement;
    return new Proxy(statement, { get(target, property) {
      if (property === 'run') return (...args) => {
        const result = target.run(...args);
        if (receipt) {
          reached++;
          insideReceipt = snapshot(connection);
          now += 601_000_000n;
        } else insideCompleted = snapshot(connection);
        return result;
      };
      return Reflect.get(target, property, target);
    } });
  };
  const result = await core.capture({
    namespace: { ownerId: 'staged-clock-synthetic', scope: 'personal', projectId: null },
    client: 'deadline-client', eventId: 'staged-final', sessionId: 'deadline-session',
    messages: [{ id: 'message-staged-final', role: 'user', content: 'Synthetic staged-final source.' }],
  });
  const observed = { reached, insideReceipt, insideCompleted, after: snapshot(db),
    errorCode: result.error?.code ?? null };
  process.stdout.write(`${JSON.stringify(observed)}\n`);
  assert.equal(reached, 1, 'actual receipt insertion reached once');
  assert.deepEqual(insideReceipt, { memories: 1, receipts: 1, journal: 0,
    qualifications: 0, anchors: 0, claim: 'pending', staged: 'pending' });
  assert.deepEqual(insideCompleted, { memories: 1, receipts: 1, journal: 1,
    qualifications: 1, anchors: 1, claim: 'completed', staged: 'admitted' });
  // This must be the mutation control's first failure, after all setup proofs.
  assert.equal(observed.after.memories, 0, 'staged memory must roll back');
  for (const name of ['receipts', 'journal', 'qualifications', 'anchors']) {
    assert.equal(observed.after[name], 0, `${name} must roll back`);
  }
  assert.equal(observed.after.claim, 'pending');
  assert.notEqual(observed.after.staged, 'admitted');
  assert.equal(result.ok, false);
  assert.equal(observed.errorCode, 'model_timeout');
} catch (error) {
  if (error?.code === 'ERR_ASSERTION') {
    process.stderr.write(`STAGED_ADMISSION_ROLLBACK_ASSERTION_FAILED:${error.message}\n`);
    process.exitCode = 2;
  } else throw error;
} finally {
  DatabaseSync.prototype.prepare = prepare;
  process.hrtime.bigint = realNow;
  await workspace.cleanup();
}
