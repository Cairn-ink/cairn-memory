// Isolated fixture: advance the original budget at a real SQLite boundary.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const [parent, mode = 'journal'] = process.argv.slice(2);
assert.ok(['journal', 'remove-post-work-check', 'expire-before-admission'].includes(mode));
const workspace = createTestWorkspace(null, { parent, prefix: 'journal-clock-child-' });
const realNow = process.hrtime.bigint;
const prepare = DatabaseSync.prototype.prepare;
let now = 0n, mutatedModules = 0, reached = 0, advanced = 0, inside;
let core, db;
process.hrtime.bigint = () => now;
if (mode === 'remove-post-work-check') registerHooks({ load(url, context, nextLoad) {
  const loaded = nextLoad(url, context);
  if (!url.endsWith('/core/database.mjs')) return loaded;
  const source = String(loaded.source);
  const target = '    const result = work();\n    check?.();\n    db.exec("COMMIT");';
  assert.equal(source.split(target).length, 2, 'one transaction post-work check');
  mutatedModules++;
  return { ...loaded, source: source.replace(target,
    '    const result = work();\n    db.exec("COMMIT");') };
} });

try {
  // The deadline captures the monotonic function at import time, after override.
  const { openMemoryCore } = await import('../contract.mjs');
  assert.equal(mutatedModules, mode === 'remove-post-work-check' ? 1 : 0);
  const path = join(workspace.path, 'memory.sqlite');
  const namespace = { ownerId: 'capture-deadline-synthetic', scope: 'personal', projectId: null };
  let classified = 0;
  core = openMemoryCore({ path, captureDeadlineMs: 600, model: {
    contextWindow: 8192, countTokens: () => 1,
    extract: ({ input }) => ({ items: [{ content: input.messages[0].content,
      kind: 'fact', confidence: 0.8, sourceIndices: [0] }] }),
    classify: () => { classified++; return { items: [] }; },
  } });
  workspace.defer(() => core?.close());
  db = new DatabaseSync(path);
  workspace.defer(() => db?.close());
  const read = connection => ({
    memories: connection.prepare('SELECT count(*) n FROM memories').get().n,
    receipts: connection.prepare('SELECT count(*) n FROM receipts').get().n,
    journal: connection.prepare("SELECT status FROM capture_initial_classification WHERE event_id='journal-begin'").get()?.status ?? null,
    claim: connection.prepare("SELECT state FROM admission_claims WHERE event_id='journal-begin'").get()?.state ?? null,
  });
  DatabaseSync.prototype.prepare = function(sql) {
    const connection = this;
    const statement = prepare.call(this, sql);
    const journalUpdate = sql.includes("SET status='in_flight_or_interrupted'");
    const preAdmission = mode === 'expire-before-admission' && sql.includes('INSERT INTO capture_initial_classification');
    if (!journalUpdate && !preAdmission) return statement;
    return new Proxy(statement, { get(target, property) {
      if (property === 'run') return (...args) => {
        const result = target.run(...args);
        if (journalUpdate) reached++;
        inside = read(connection);
        advanced++;
        now += 601_000_000n; // Only after the selected real SQL, before COMMIT.
        return result;
      };
      return Reflect.get(target, property, target);
    } });
  };
  const result = await core.capture({ namespace, client: 'deadline-client',
    eventId: 'journal-begin', sessionId: 'deadline-session',
    messages: [{ id: 'message-journal-begin', role: 'user', content: 'Synthetic journal-begin source.' }] });
  DatabaseSync.prototype.prepare = prepare;
  core.close(); core = undefined;
  db.close(); db = undefined;
  const cold = new DatabaseSync(path);
  workspace.defer(() => cold.close());
  const observed = { mode, reached, advanced, classified, inside, after: read(cold),
    ok: result.ok, error: result.error ?? null, classification: result.value?.classification ?? null };
  process.stdout.write(`${JSON.stringify(observed)}\n`);
  assert.equal(advanced, 1, 'clock advances at exactly one selected SQL site');
  assert.equal(classified, 0, 'classifier never runs after expiry');
  assert.deepEqual(inside, { memories: 1, receipts: 1,
    journal: mode === 'expire-before-admission' ? 'not_started' : 'in_flight_or_interrupted', claim: 'completed' });
  if (mode === 'expire-before-admission') {
    assert.equal(reached, 0, 'journal begin must not run before admission commits');
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'model_timeout');
    assert.deepEqual(observed.after, { memories: 0, receipts: 0, journal: null, claim: 'pending' });
  } else {
    assert.equal(reached, 1, 'journal UPDATE executed once');
    assert.equal(result.ok, true, 'committed admission remains a successful envelope');
    assert.equal(result.value.classification.status, 'failed');
    assert.equal(result.value.classification.error.code, 'model_timeout');
    assert.equal(observed.after.memories, 1);
    assert.equal(observed.after.receipts, 1);
    assert.equal(observed.after.claim, 'completed');
    assert.equal(observed.after.journal, 'not_started', 'journal begin mutation must roll back');
  }
} catch (error) {
  if (error?.code !== 'ERR_ASSERTION') throw error;
  process.stderr.write(`JOURNAL_ROLLBACK_ASSERTION_FAILED:${error.message}\n`);
  process.exitCode = 2;
} finally {
  DatabaseSync.prototype.prepare = prepare;
  process.hrtime.bigint = realNow;
  await workspace.cleanup();
}
