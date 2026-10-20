// Test-only child: expire the monotonic clock after a real rationale edge INSERT.
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
const workspace = createTestWorkspace(null, { prefix: 'cairn-rationale-clock-', parent });
const prepare = DatabaseSync.prototype.prepare;
let reached = 0, inside;
try {
  const [{ openMemoryCore }, { rationaleModel }] = await Promise.all([
    import('../contract.mjs'), import('./rationale-model.mjs'),
  ]);
  if (mutation) assert.equal(mutatedModules, 1);
  const path = join(workspace.path, 'memory.sqlite');
  const core = openMemoryCore({ path, model: rationaleModel(), captureDeadlineMs: 600,
    captureQualification: 'source-bound-v2', captureRationale: 'source-bound-v1' });
  workspace.defer(() => core.close());
  const db = new DatabaseSync(path);
  workspace.defer(() => db.close());
  const count = (connection, table) => connection.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
  const snapshot = connection => ({
    edges: count(connection, 'rationale_edges'), memories: count(connection, 'memories'),
    receipts: count(connection, 'receipts'),
    claim: connection.prepare("SELECT state FROM admission_claims WHERE event_id='rationale-precommit'").get()?.state ?? null,
    journal: connection.prepare("SELECT status FROM capture_initial_classification WHERE event_id='rationale-precommit'").get()?.status ?? null,
  });
  DatabaseSync.prototype.prepare = function(sql) {
    const connection = this, statement = prepare.call(this, sql);
    if (!sql.includes('INSERT INTO rationale_edges')) return statement;
    return new Proxy(statement, { get(target, property) {
      if (property === 'run') return (...args) => {
        const result = target.run(...args);
        reached++;
        inside = snapshot(connection);
        now += 601_000_000n;
        return result;
      };
      return Reflect.get(target, property, target);
    } });
  };
  const result = await core.capture({
    namespace: { ownerId: 'rationale-clock-synthetic', scope: 'personal', projectId: null },
    client: 'deadline-client', eventId: 'rationale-precommit', sessionId: 'deadline-session',
    messages: [{ id: 'message-rationale-precommit', role: 'user',
      content: 'I chose A because it supports offline work.' }],
  });
  const observed = { reached, inside, after: snapshot(db),
    classification: result.value?.classification?.status ?? null,
    rationale: result.value?.rationale?.status ?? null,
    rationaleErrorCode: result.value?.rationale?.error?.code ?? null };
  process.stdout.write(`${JSON.stringify(observed)}\n`);
  assert.equal(reached, 1, 'actual rationale edge insertion reached once');
  assert.deepEqual(inside, { edges: 1, memories: 1, receipts: 1,
    claim: 'completed', journal: 'applied' });
  assert.equal(result.ok, true, 'admission remains successful');
  assert.equal(observed.classification, 'applied');
  // The mutation must fail here after the same real edge/setup observations.
  assert.equal(observed.after.edges, 0, 'rationale edge must roll back');
  assert.deepEqual(observed.after, { edges: 0, memories: 1, receipts: 1,
    claim: 'completed', journal: 'applied' });
  assert.equal(observed.rationale, 'failed');
  assert.equal(observed.rationaleErrorCode, 'model_timeout');
} catch (error) {
  if (error?.code === 'ERR_ASSERTION') {
    process.stderr.write(`RATIONALE_ROLLBACK_ASSERTION_FAILED:${error.message}\n`);
    process.exitCode = 2;
  } else throw error;
} finally {
  DatabaseSync.prototype.prepare = prepare;
  process.hrtime.bigint = realNow;
  await workspace.cleanup();
}
