// Isolated test process: freeze monotonic time, but leave model-call timers real.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const [mutation, ...extra] = process.argv.slice(2);
assert.equal(extra.length, 0);
assert.ok(mutation === undefined || mutation === 'reuse-first-deadline');
const realNow = process.hrtime.bigint;
let now = 0n;
let hook;
let mutatedModules = 0;
let stage = 'setup';
let workspace;
const observed = { mutation: mutation ?? null, firstChecksPassed: false };
try {
  workspace = createTestWorkspace(null, { prefix: 'cairn-capture-independence-' });
  workspace.defer(() => { process.hrtime.bigint = realNow; });
  if (mutation) {
    hook = registerHooks({ load(url, context, nextLoad) {
      const loaded = nextLoad(url, context);
      if (url !== new URL('../capture-deadline.mjs', import.meta.url).href) return loaded;
      const source = String(loaded.source);
      const target = 'export function createCaptureDeadline(milliseconds) {';
      assert.equal(source.split(target).length, 2, 'one capture deadline factory');
      mutatedModules++;
      return { ...loaded, source: source.replace(target, 'function freshCaptureDeadline(milliseconds) {')
        + '\nlet firstDeadline;\nexport function createCaptureDeadline(milliseconds) {\n'
        + '  return firstDeadline ??= freshCaptureDeadline(milliseconds);\n}\n' };
    } });
    workspace.defer(() => hook.deregister());
  }
  // capture-deadline.mjs snapshots this function during the dynamic import.
  process.hrtime.bigint = () => now;
  const [{ openMemoryCore }, { isCoreModelDeadlineSignal }] = await Promise.all([
    import('../contract.mjs'), import('../model-call.mjs'),
  ]);
  assert.equal(mutatedModules, mutation ? 1 : 0, 'exact intended module mutation');
  let release;
  let firstSignal;
  let secondSignal;
  let secondSignalInitiallyAborted;
  let classifySignal;
  let extractCalls = 0;
  let classifyCalls = 0;
  let abortEvents = 0;
  const model = { contextWindow: 8192, countTokens: () => 1,
    extract: ({ input, signal }) => {
      extractCalls++;
      if (extractCalls === 1) {
        firstSignal = signal;
        firstSignal.addEventListener('abort', () => { abortEvents++; }, { once: true });
        assert.equal(now, 0n, 'first model dispatch starts before deadline expiry');
        now = 1_001_000_000n; // Expire only after actual model dispatch.
        return new Promise(resolve => { release = resolve; });
      }
      secondSignal = signal;
      secondSignalInitiallyAborted = signal.aborted;
      return { items: [{ content: input.messages[0].content, kind: 'fact',
        confidence: 0.8, sourceIndices: [0] }] };
    },
    classify: ({ input, signal }) => {
      classifyCalls++;
      classifySignal = signal;
      return { items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) };
    },
  };
  const path = join(workspace.path, 'memory.sqlite');
  const core = openMemoryCore({ path, model, captureDeadlineMs: 1_000 });
  workspace.defer(() => core.close());
  const db = new DatabaseSync(path);
  workspace.defer(() => db.close());
  const namespace = { ownerId: 'capture-independence-synthetic', scope: 'personal', projectId: null };
  const input = eventId => ({ namespace, client: 'deadline-client', eventId,
    sessionId: 'deadline-session', messages: [{ id: `message-${eventId}`, role: 'user',
      content: `Synthetic ${eventId} source.` }] });
  const counts = () => Object.fromEntries([['memories', 'memories'], ['receipts', 'receipts'],
    ['initialRows', 'capture_initial_classification']].map(([field, table]) =>
    [field, db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n]));
  stage = 'first-timeout';
  // The unresolved adapter promise can lose this race only to the real timer.
  const first = await core.capture(input('stalled'));
  assert.equal(first.error?.code, 'model_timeout', 'stalled extraction genuinely times out');
  assert.equal(extractCalls, 1); assert.equal(abortEvents, 1);
  assert.equal(firstSignal.aborted, true); assert.equal(isCoreModelDeadlineSignal(firstSignal), true);
  assert.equal(isCoreModelDeadlineSignal(AbortSignal.abort('model_timeout')), false);
  assert.deepEqual(counts(), { memories: 0, receipts: 0, initialRows: 0 });
  assert.equal(classifyCalls, 0);
  stage = 'late-result';
  release({ items: [{ content: 'Late synthetic answer.', kind: 'fact', confidence: 0.8, sourceIndices: [0] }] });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  const afterLate = counts();
  assert.deepEqual(afterLate, { memories: 0, receipts: 0, initialRows: 0 });
  assert.equal(classifyCalls, 0, 'late extraction must not classify');
  Object.assign(observed, { mutatedModules, firstChecksPassed: true, firstErrorCode: first.error.code,
    firstSignalAborted: firstSignal.aborted, firstSignalBranded: isCoreModelDeadlineSignal(firstSignal),
    externalSignalBranded: isCoreModelDeadlineSignal(AbortSignal.abort('model_timeout')), afterLate });
  stage = 'second-independence';
  const second = await core.capture(input('later')); // Same core, fixed time 1001.
  Object.assign(observed, { elapsedMs: Number(now / 1_000_000n), extractCalls, classifyCalls,
    secondErrorCode: second.error?.code ?? null, secondSignalFresh: !!secondSignal && secondSignal !== firstSignal,
    secondSignalInitiallyAborted: secondSignalInitiallyAborted ?? null,
    classificationStatus: second.value?.classification.status ?? null, finalCounts: counts() });
  assert.equal(second.ok, true, 'fresh same-core capture must succeed');
  assert.equal(now, 1_001_000_000n, 'second invocation clock stays fixed');
  assert.equal(extractCalls, 2); assert.equal(classifyCalls, 1);
  assert.notEqual(secondSignal, firstSignal); assert.equal(secondSignalInitiallyAborted, false);
  assert.notEqual(classifySignal, firstSignal); assert.equal(classifySignal.aborted, false);
  assert.equal(second.value.classification.status, 'applied');
  assert.deepEqual(counts(), { memories: 1, receipts: 1, initialRows: 1 });
  const receipt = db.prepare('SELECT event_id,role,excerpt,memory_id FROM receipts').get();
  assert.equal(receipt.event_id, 'message-later'); assert.equal(receipt.role, 'user');
  assert.equal(receipt.excerpt, 'Synthetic later source.');
  assert.equal(receipt.memory_id, second.value.admission.memories[0].id);
  const inspected = core.inspectAdmission({ namespace, client: 'deadline-client', eventId: 'later',
    includeInitialClassification: true });
  assert.equal(inspected.ok, true); assert.equal(inspected.value.status, 'completed');
  assert.equal(inspected.value.initialClassification.status, 'applied');
  observed.initialStatus = db.prepare('SELECT status FROM capture_initial_classification WHERE event_id=?')
    .get('later').status;
  assert.equal(observed.initialStatus, 'applied');
} catch (error) {
  if (error?.code !== 'ERR_ASSERTION') throw error;
  process.stderr.write(`INDEPENDENCE_ASSERTION_FAILED:${stage}:${error.message}\n`);
  process.exitCode = 2;
} finally {
  if (workspace) {
    await workspace.cleanup();
    assert.equal(existsSync(workspace.path), false, 'owned workspace removed');
    process.stderr.write('INDEPENDENCE_CLOCK_CLEANUP_COMPLETED:true\n');
  }
  process.stdout.write(`${JSON.stringify(observed)}\n`);
}
