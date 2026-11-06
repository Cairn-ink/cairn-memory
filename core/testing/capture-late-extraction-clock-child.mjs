// Isolated process: bind the monotonic clock before the real core imports it.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { mock } from 'node:test';
import { setImmediate as checkpoint } from 'node:timers/promises';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const realNow = process.hrtime.bigint;
let now = 0n;
process.hrtime.bigint = () => now;
mock.timers.enable({ apis: ['setTimeout'] });
const workspace = createTestWorkspace(null, { prefix: 'cairn-late-extraction-clock-' });
try {
  const [{ openMemoryCore }, { isCoreModelDeadlineSignal }] = await Promise.all([
    import('../contract.mjs'), import('../model-call.mjs'),
  ]);
  const namespace = { ownerId: 'late-extraction-synthetic', scope: 'personal', projectId: null };
  const input = eventId => ({ namespace, client: 'deadline-client', eventId,
    sessionId: 'deadline-session', messages: [{ id: `message-${eventId}`,
      role: 'user', content: `Synthetic ${eventId} source.` }] });
  let release;
  let savedSignal;
  let classifyCalls = 0;
  let started;
  const entered = new Promise(resolve => { started = resolve; });
  const model = { contextWindow: 8192, countTokens: () => 1,
    extract: ({ input: request, signal }) => {
      if (request.messages[0].content.includes('stalled')) {
        savedSignal = signal;
        return new Promise(resolve => { release = resolve; started(); });
      }
      return { items: [{ content: request.messages[0].content, kind: 'fact',
        confidence: 0.8, sourceIndices: [0] }] };
    },
    classify: ({ input: request }) => {
      classifyCalls++;
      return { items: request.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) };
    },
  };
  const path = join(workspace.path, 'memory.sqlite');
  const core = openMemoryCore({ path, model, captureDeadlineMs: 1_000 });
  workspace.defer(() => core.close());
  const db = new DatabaseSync(path);
  workspace.defer(() => db.close());
  const count = table => db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
  const pending = core.capture(input('stalled'));
  // Scheduling and SQLite before adapter entry do not consume this fixture's
  // budget. Cross the deadline only once the pending extraction actually exists.
  await entered;
  assert.equal(savedSignal.aborted, false);
  assert.equal(isCoreModelDeadlineSignal(savedSignal), false);
  now += 1_001_000_000n;
  mock.timers.tick(1_001);
  assert.equal((await pending).error.code, 'model_timeout');
  assert.equal(savedSignal.aborted, true);
  assert.equal(isCoreModelDeadlineSignal(savedSignal), true);
  assert.equal(isCoreModelDeadlineSignal(AbortSignal.abort('model_timeout')), false);
  assert.equal(count('memories'), 0);
  assert.equal(count('receipts'), 0);
  release({ items: [{ content: 'Late synthetic answer.', kind: 'fact',
    confidence: 0.8, sourceIndices: [0] }] });
  // Drain the late provider's microtasks before inspecting durable state.
  await checkpoint();
  assert.equal(count('memories'), 0);
  assert.equal(count('receipts'), 0);
  assert.equal(classifyCalls, 0);
  const later = await core.capture(input('later'));
  assert.equal(later.ok, true, JSON.stringify(later));
  assert.equal(later.value.classification.status, 'applied');
  assert.equal(classifyCalls, 1);
  assert.equal(count('memories'), 1);
  assert.equal(count('receipts'), 1);
  process.stdout.write(JSON.stringify({ timeout: true, aborted: savedSignal.aborted,
    privateProvenance: isCoreModelDeadlineSignal(savedSignal), classifyCalls,
    memories: count('memories'), receipts: count('receipts') }) + '\n');
} finally {
  try { await workspace.cleanup(); }
  finally { mock.timers.reset(); process.hrtime.bigint = realNow; }
}
