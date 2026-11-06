// Isolated actual-core fixture: preparation cannot consume the synthetic clock.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const mutation = process.argv[2];
assert.ok(mutation === undefined || mutation === 'remove-controller-abort');
let mutatedModules = 0;
if (mutation) registerHooks({ load(url, context, nextLoad) {
  const loaded = nextLoad(url, context);
  if (!url.endsWith('/core/model-call.mjs')) return loaded;
  const source = String(loaded.source);
  const target = 'controller.abort();';
  assert.equal(source.split(target).length, 3, 'both timer and expired-check abort sites');
  mutatedModules++;
  return { ...loaded, source: source.replaceAll(target, '/* test-only missing abort */') };
} });

const realNow = process.hrtime.bigint;
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
const realExec = DatabaseSync.prototype.exec;
let now = 0n;
process.hrtime.bigint = () => now;
const workspace = createTestWorkspace(null, { prefix: 'cairn-classifier-clock-' });
let observed;
let assertion;
try {
  // capture-deadline captures the clock during its first import.
  const [{ openMemoryCore }, { isCoreModelDeadlineSignal }, { rationaleModel }] = await Promise.all([
    import('../contract.mjs'), import('../model-call.mjs'), import('./rationale-model.mjs'),
  ]);
  if (mutation) assert.equal(mutatedModules, 1);
  const namespace = { ownerId: 'classifier-clock-synthetic', scope: 'personal', projectId: null };
  const path = join(workspace.path, 'memory.sqlite');
  const methods = [];
  const timers = new Set();
  let classifySignal;
  let entry;
  let timerFired = 0;
  let preparationDelayCompleted = false;
  let pendingAtExpiry = false;
  const model = rationaleModel(method => methods.push(method));
  let db;
  model.classify = ({ signal }) => {
    methods.push('classify');
    classifySignal = signal;
    entry = { atMs: Number(now / 1_000_000n),
      admission: db.prepare("SELECT state FROM admission_claims WHERE event_id='classify-timeout'").get().state,
      journal: db.prepare("SELECT status FROM capture_initial_classification WHERE event_id='classify-timeout'").get().status,
      receipts: db.prepare('SELECT count(*) AS n FROM receipts').get().n };
    assert.equal(timers.size, 1, 'only the active classifier timer remains');
    const [timer] = timers;
    assert.equal(timer.delay, 1_000, 'the original shared deadline reaches classifier entry');
    queueMicrotask(() => {
      assert.equal(timers.has(timer), true);
      pendingAtExpiry = true;
      now += 1_000_000_000n;
      timers.delete(timer);
      timerFired++;
      timer.callback(...timer.args); // The unmodified callModel timeout callback.
    });
    return new Promise(() => {}); // Still pending when the real timer callback fires.
  };
  const core = openMemoryCore({ path, model, captureDeadlineMs: 1_000,
    captureQualification: 'source-bound-v2', captureRationale: 'source-bound-v1' });
  workspace.defer(() => core.close());
  db = new DatabaseSync(path);
  workspace.defer(() => db.close());
  DatabaseSync.prototype.exec = function(sql, ...args) {
    const value = realExec.call(this, sql, ...args);
    if (preparationDelayCompleted || sql.trim() !== 'COMMIT') return value;
    const admission = this.prepare("SELECT state FROM admission_claims WHERE event_id='classify-timeout'").get();
    if (admission?.state !== 'completed') return value;
    assert.equal(this.prepare("SELECT status FROM capture_initial_classification WHERE event_id='classify-timeout'").get().status,
      'not_started', 'the wall stall follows admission COMMIT, before classification');
    // Exactly the original red probe's boundary, but its clock remains fixed.
    assert.equal(Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_100), 'timed-out');
    preparationDelayCompleted = true;
    return value;
  };
  globalThis.setTimeout = (callback, delay, ...args) => {
    const timer = { callback, delay, args };
    timers.add(timer);
    return timer;
  };
  globalThis.clearTimeout = timer => { timers.delete(timer); };
  const result = await core.capture({ namespace, client: 'deadline-client', eventId: 'classify-timeout',
    sessionId: 'deadline-session', messages: [{ id: 'message-classify-timeout', role: 'user',
      content: 'I chose A because it supports offline work.' }] });
  assert.equal(methods.includes('classify'), true, 'classification began after committed admission');
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(preparationDelayCompleted, true);
  assert.deepEqual(entry, { atMs: 0, admission: 'completed', journal: 'in_flight_or_interrupted', receipts: 1 });
  assert.equal(pendingAtExpiry, true);
  assert.equal(timerFired, 1);
  assert.equal(timers.size, 0);
  assert.equal(result.value.admission.memories.length, 1);
  assert.equal(result.value.classification.status, 'failed');
  assert.equal(result.value.classification.error.code, 'model_timeout');
  assert.equal(result.value.rationale.status, 'failed');
  assert.equal(result.value.rationale.error.code, 'model_timeout');
  assert.equal(methods.includes('relate'), false);
  assert.equal(classifySignal.aborted, true, 'classifier signal aborted after expiry');
  assert.equal(isCoreModelDeadlineSignal(classifySignal), true);
  assert.equal(isCoreModelDeadlineSignal(AbortSignal.abort('model_timeout')), false);
  assert.equal(db.prepare('SELECT count(*) AS n FROM memories').get().n, 1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM receipts').get().n, 1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM rationale_edges').get().n, 0);
  const cold = openMemoryCore({ path });
  workspace.defer(() => cold.close());
  const inspected = cold.inspectAdmission({ namespace, client: 'deadline-client', eventId: 'classify-timeout',
    includeInitialClassification: true });
  assert.equal(inspected.ok, true);
  assert.equal(inspected.value.status, 'completed');
  assert.equal(inspected.value.initialClassification.status, 'failed');
  assert.equal(inspected.value.members[0].filing.status, 'unfiled');
  observed = { methods, entry, timerFired, pendingAtExpiry, preparationDelayCompleted,
    classification: result.value.classification.status, rationale: result.value.rationale.status,
    signalAborted: classifySignal.aborted, signalProvenance: isCoreModelDeadlineSignal(classifySignal),
    coldAdmission: inspected.value.status, coldJournal: inspected.value.initialClassification.status,
    coldFiling: inspected.value.members[0].filing.status, memories: 1, receipts: 1, rationaleEdges: 0 };
} catch (error) {
  if (error?.code !== 'ERR_ASSERTION') throw error;
  assertion = error.message;
  process.exitCode = 2;
} finally {
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
  DatabaseSync.prototype.exec = realExec;
  try { await workspace.cleanup(); }
  finally { process.hrtime.bigint = realNow; }
}
assert.equal(existsSync(workspace.path), false, 'child scratch removed before verdict');
process.stdout.write(`${JSON.stringify({ ...observed, cleanup: true, assertion: assertion ?? null })}\n`);
if (assertion) process.stderr.write(`CLASSIFIER_TIMEOUT_ASSERTION_FAILED:${assertion}\n`);
