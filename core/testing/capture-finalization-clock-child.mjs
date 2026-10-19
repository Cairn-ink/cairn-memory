// Process-local clock and loader mutation; all capture/storage code is real.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const [mode, mutation] = process.argv.slice(2);
assert.ok(mode === 'rationale' || mode === 'staged');
assert.ok(mutation === undefined || mutation === 'remove-post-work-check');
assert.ok(process.argv.length <= 4);
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

const workspace = createTestWorkspace(null, { prefix: 'cairn-finalization-clock-' });
const realNow = process.hrtime.bigint;
const prepare = DatabaseSync.prototype.prepare;
let now = 0n;
let observed;
let assertion;
try {
  process.hrtime.bigint = () => now;
  // capture-deadline captures the monotonic function at its first import.
  const [{ openMemoryCore }, { rationaleModel }] = await Promise.all([
    import('../contract.mjs'), import('./rationale-model.mjs'),
  ]);
  if (mutation) assert.equal(mutatedModules, 1, 'the exact loader mutation was installed');
  const namespace = { ownerId: 'finalization-clock-synthetic', scope: 'personal', projectId: null };
  const eventId = `${mode}-precommit`;
  const path = join(workspace.path, 'memory.sqlite');
  const methods = [];
  const model = rationaleModel(method => methods.push(method));
  if (mode === 'rationale') model.classify = ({ input }) => {
    methods.push('classify');
    return { items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [],
      newL1: { title: 'Synthetic finalization topic', parentL2Ids: [] } })) };
  };
  const core = openMemoryCore({ path, model, captureDeadlineMs: 600,
    captureQualification: 'source-bound-v2', ...(mode === 'rationale'
      ? { captureRationale: 'source-bound-v1' } : { captureEvidence: 'staged-v1' }) });
  workspace.defer(() => core.close());
  const db = new DatabaseSync(path);
  workspace.defer(() => db.close());
  const snapshot = connection => {
    const count = table => connection.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
    return { memories: count('memories'), receipts: count('receipts'),
      qualifications: count('memory_qualifications'), anchors: count('qualification_anchors'),
      rationaleEdges: count('rationale_edges'), mocs: count('mocs'),
      journal: connection.prepare('SELECT status FROM capture_initial_classification WHERE event_id=?')
        .get(eventId)?.status ?? null,
      admission: connection.prepare('SELECT state FROM admission_claims WHERE event_id=?').get(eventId)?.state ?? null,
      staged: connection.prepare('SELECT state FROM staged_capture_evidence WHERE event_id=?').get(eventId)?.state ?? null,
      filing: connection.prepare('SELECT filing_status FROM memories').get()?.filing_status ?? null };
  };
  let reached = 0;
  let inside;
  let finalInside;
  let beforeMs;
  let afterMs;
  const fragment = mode === 'rationale' ? 'INSERT INTO rationale_edges' : 'INSERT OR IGNORE INTO receipts';
  DatabaseSync.prototype.prepare = function(sql) {
    const connection = this;
    const statement = prepare.call(this, sql);
    const targetSql = sql.includes(fragment);
    const finalSql = mode === 'staged' && sql.includes('INSERT INTO capture_initial_classification');
    if (!targetSql && !finalSql) return statement;
    return new Proxy(statement, { get(target, property) {
      if (property === 'run') return (...args) => {
        const result = target.run(...args); // Actual write precedes observation and clock advance.
        if (targetSql) {
          reached++;
          beforeMs = Number(now / 1_000_000n);
          inside = snapshot(connection);
          now += 601_000_000n;
          afterMs = Number(now / 1_000_000n);
        }
        if (finalSql) finalInside = snapshot(connection);
        return result;
      };
      return Reflect.get(target, property, target);
    } });
  };
  const source = mode === 'rationale' ? 'I chose A because it supports offline work.' : 'Synthetic staged-final source.';
  const result = await core.capture({ namespace, client: 'deadline-client', eventId, sessionId: 'deadline-session',
    messages: [{ id: `message-${eventId}`, role: 'user', content: source }] });
  // A fresh connection independently sees only committed writes after capture.
  const cold = new DatabaseSync(path);
  workspace.defer(() => cold.close());
  const durable = snapshot(cold);
  const sourceMatches = cold.prepare('SELECT excerpt FROM receipts').get()?.excerpt === source;
  observed = { mode, mutatedModules, methods, reached, beforeMs, afterMs, inside,
    finalInside: finalInside ?? null, durable, sourceMatches, ok: result.ok,
    errorCode: result.error?.code ?? null,
    classification: result.value?.classification?.status ?? null,
    rationale: result.value?.rationale?.status ?? null,
    rationaleError: result.value?.rationale?.error?.code ?? null };
  assert.equal(reached, 1, 'target INSERT executed exactly once');
  assert.equal(beforeMs, 0, 'earlier capture work cannot consume the controlled budget');
  assert.equal(afterMs, 601, 'deadline crosses only after the actual target INSERT');
  assert.equal(inside.memories, 1, 'memory write visible inside guarded transaction');
  assert.equal(inside.receipts, 1, 'receipt write visible inside guarded transaction');
  assert.ok(methods.includes('extract'));
  assert.ok(methods.includes('qualifyCandidates'));
  if (mode === 'rationale') {
    assert.equal(inside.rationaleEdges, 1, 'rationale edge visible before post-work check');
    assert.equal(inside.journal, 'applied');
    assert.equal(inside.filing, 'filed');
    assert.equal(inside.mocs, 1);
    assert.ok(methods.includes('relate'));
    // A removed post-work check commits the observed edge and fails here.
    assert.equal(durable.rationaleEdges, 0, 'rationale edges must roll back');
    assert.equal(result.ok, true);
    assert.equal(result.value.classification.status, 'applied');
    assert.equal(result.value.rationale.status, 'failed');
    assert.equal(result.value.rationale.error.code, 'model_timeout');
    assert.equal(durable.memories, 1);
    assert.equal(durable.receipts, 1);
    assert.equal(durable.mocs, 1);
    assert.equal(durable.filing, 'filed');
    assert.equal(durable.journal, 'applied');
    assert.equal(durable.admission, 'completed');
    assert.equal(sourceMatches, true);
  } else {
    assert.deepEqual(finalInside, { memories: 1, receipts: 1, qualifications: 1, anchors: 1,
      rationaleEdges: 0, mocs: 0, journal: 'not_started', admission: 'completed',
      staged: 'admitted', filing: 'unfiled' }, 'qualified evidence and final journal written before post-work check');
    // A removed post-work check commits admission/anchors and fails here.
    assert.equal(durable.memories, 0, 'staged admission memories must roll back');
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'model_timeout');
    for (const field of ['receipts', 'qualifications', 'anchors']) assert.equal(durable[field], 0, field);
    assert.equal(durable.journal, null);
    assert.equal(durable.admission, 'pending');
    assert.equal(durable.staged, 'failed');
    assert.equal(sourceMatches, false);
  }
} catch (error) {
  if (error?.code !== 'ERR_ASSERTION') throw error;
  assertion = error.message;
  process.exitCode = 2;
} finally {
  DatabaseSync.prototype.prepare = prepare;
  try { await workspace.cleanup(); }
  finally { process.hrtime.bigint = realNow; }
}
assert.equal(existsSync(workspace.path), false, 'child scratch removed before verdict');
process.stdout.write(`${JSON.stringify({ ...observed, cleanup: true, assertion: assertion ?? null })}\n`);
if (assertion) process.stderr.write(`FINALIZATION_ROLLBACK_ASSERTION_FAILED:${assertion}\n`);
