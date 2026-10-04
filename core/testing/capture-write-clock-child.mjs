// Isolated test process: reach the real write before expiring its deadline.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const [mode, fault] = process.argv.slice(2);
assert.ok(['rationale', 'staged'].includes(mode));
assert.ok(fault === undefined || ['before-target-expiry', 'remove-post-work-check'].includes(fault));
let mutatedModules = 0;
let hook;
const realNow = process.hrtime.bigint;
const prepare = DatabaseSync.prototype.prepare;
let workspace;
let now = 0n;
let active = false;
let reached = 0;
let inside = null;
const calls = [];
const advance = milliseconds => { now += BigInt(milliseconds) * 1_000_000n; };
try {
  if (fault === 'remove-post-work-check') hook = registerHooks({ load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (url !== new URL('../database.mjs', import.meta.url).href) return loaded;
    const source = String(loaded.source);
    const target = '    const result = work();\n    check?.();\n    db.exec("COMMIT");';
    assert.equal(source.split(target).length, 2, 'one transaction post-work check');
    mutatedModules++;
    return { ...loaded, source: source.replace(target, '    const result = work();\n    db.exec("COMMIT");') };
  } });
  // capture-deadline.mjs snapshots this function during the following import.
  process.hrtime.bigint = () => now;
  workspace = createTestWorkspace(null, { prefix: 'cairn-capture-write-clock-' });
  const [{ openMemoryCore }, { rationaleModel }] = await Promise.all([
    import('../contract.mjs'), import('./rationale-model.mjs'),
  ]);
  assert.equal(mutatedModules, fault === 'remove-post-work-check' ? 1 : 0);
  const base = rationaleModel();
  const model = { ...base };
  for (const method of ['extract', 'qualifyCandidates', 'classify', 'relate']) model[method] = request => {
    calls.push(method);
    const result = base[method](request);
    if (fault === 'before-target-expiry' && method === (mode === 'rationale' ? 'relate' : 'qualifyCandidates')) advance(120_001);
    return result;
  };
  const namespace = { ownerId: 'capture-deadline-synthetic', scope: 'personal', projectId: null };
  const path = join(workspace.path, 'memory.sqlite');
  const core = openMemoryCore({ path, model, captureDeadlineMs: 120_000,
    captureQualification: 'source-bound-v2', ...(mode === 'rationale'
      ? { captureRationale: 'source-bound-v1' } : { captureEvidence: 'staged-v1' }) });
  workspace.defer(() => core.close());
  const db = new DatabaseSync(path);
  workspace.defer(() => db.close());
  const count = table => db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
  const fragment = mode === 'rationale' ? 'INSERT INTO rationale_edges' : 'INSERT OR IGNORE INTO receipts';
  DatabaseSync.prototype.prepare = function(sql) {
    const connection = this;
    const statement = prepare.call(this, sql);
    if (!active || !sql.includes(fragment)) return statement;
    return new Proxy(statement, { get(target, property) {
      if (property === 'run') return (...args) => {
        const result = target.run(...args);
        reached++;
        const insideCount = table => connection.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
        inside = { elapsedMs: Number(now / 1_000_000n), memories: insideCount('memories'),
          receipts: insideCount('receipts'), rationaleEdges: insideCount('rationale_edges') };
        advance(120_001); // After actual SQL, before the real transaction COMMIT.
        return result;
      };
      return Reflect.get(target, property, target);
    } });
  };
  active = true;
  const eventId = mode === 'rationale' ? 'rationale-precommit' : 'staged-final';
  const result = await core.capture({ namespace, client: 'deadline-client', eventId, sessionId: 'deadline-session',
    messages: [{ id: `message-${eventId}`, role: 'user', content: mode === 'rationale'
      ? 'I chose A because it supports offline work.' : 'Synthetic staged-final source.' }] });
  active = false;
  const observed = { mode, fault: fault ?? null, mutatedModules, elapsedMs: Number(now / 1_000_000n), calls, reached, inside,
    resultOk: result.ok, errorCode: result.error?.code ?? null,
    classification: result.value?.classification ?? null, rationale: result.value?.rationale ?? null,
    memories: count('memories'), receipts: count('receipts'), qualifications: count('memory_qualifications'),
    rationaleEdges: count('rationale_edges'), initialRows: count('capture_initial_classification'),
    initialStatus: db.prepare('SELECT status FROM capture_initial_classification WHERE event_id=?').get(eventId)?.status ?? null,
    claimState: db.prepare('SELECT state FROM admission_claims WHERE event_id=?').get(eventId)?.state ?? null,
    stagedState: db.prepare('SELECT state FROM staged_capture_evidence WHERE event_id=?').get(eventId)?.state ?? null };
  process.stdout.write(`${JSON.stringify(observed)}\n`);
  assert.equal(reached, 1, 'target SQL must execute exactly once');
  assert.equal(inside.elapsedMs, 0, 'target SQL executes before expiry');
  assert.equal(inside.memories, 1); assert.equal(inside.receipts, 1);
  if (mode === 'rationale') {
    assert.equal(inside.rationaleEdges, 1);
    assert.equal(observed.rationaleEdges, 0, 'rationale edge must roll back');
    assert.equal(result.ok, true);
    assert.equal(observed.classification.status, 'applied');
    assert.equal(observed.rationale.status, 'failed');
    assert.equal(observed.rationale.error.code, 'model_timeout');
    assert.equal(observed.initialStatus, 'applied');
    assert.equal(observed.memories, 1); assert.equal(observed.receipts, 1);
  } else {
    assert.equal(observed.memories, 0, 'staged memory must roll back');
    for (const field of ['receipts', 'qualifications', 'initialRows']) assert.equal(observed[field], 0, field);
    assert.equal(observed.errorCode, 'model_timeout');
    assert.equal(observed.claimState, 'pending');
    assert.notEqual(observed.stagedState, 'admitted');
  }
} catch (error) {
  if (error?.code !== 'ERR_ASSERTION') throw error;
  process.stderr.write(`WRITE_CLOCK_ASSERTION_FAILED:${error.message}\n`);
  process.exitCode = 2;
} finally {
  DatabaseSync.prototype.prepare = prepare;
  process.hrtime.bigint = realNow;
  try { hook?.deregister(); }
  finally {
    if (workspace) {
      await workspace.cleanup();
      assert.equal(existsSync(workspace.path), false, 'owned workspace removed');
      process.stderr.write('WRITE_CLOCK_CLEANUP_COMPLETED:true\n');
    }
  }
}
