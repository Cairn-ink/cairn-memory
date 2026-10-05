// Actual mixed generation/core/guard/kernel/UDS/journal/scorer; controlled native child.
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { disconnectChild, observeDisconnectServer } from '../../experiment-budget/testing/native-settled-disconnect-fixture.mjs';
import { runMixedGeneration } from '../mixed-generation.mjs';
import { scoreMixedGeneration } from '../mixed-scoring.mjs';
import { createMixedResultJournal, inspectMixedResultJournal } from '../mixed-result-journal.mjs';
import { evaluatorRow, fakeMixedHttp, sourceRow, syntheticMixedFixture } from '../testing/mixed-fixture.mjs';
import { syntheticNativeDescriptors } from '../testing/result-journal-fixture.mjs';

test('D3/D5 accounted native disconnect is journaled U and later real arms/case run once', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-mixed-disconnect-' });
  const descriptors = syntheticNativeDescriptors(workspace.path);
  const events = [], resources = [], roots = [], children = [];
  let checkedCairnEntries = 0;
  const fake = fakeMixedHttp(url => {
    if (url.endsWith('/responses/input_tokens') || url.endsWith('/responses')) {
      assert.ok(roots.length > 0);
      assert.ok(roots.every(root => !fs.existsSync(root)), 'native cleanup precedes each later Cairn provider entry');
      assert.ok(children.every(child => child.stdout.readableEnded), 'owned native children close before later work');
      checkedCairnEntries++;
    }
  });
  const fixture = syntheticMixedFixture(null, { ...descriptors,
    sourceCases: [sourceRow('first'), sourceRow('second')],
    armOrders: [['mem0', 'cairn'], ['mem0', 'cairn']], fetchImpl: fake.fetchImpl, workspace });
  observeDisconnectServer(t, events);
  const originalSpawn = childProcess.spawn, originalKill = process.kill;
  const launchMock = t.mock.method(childProcess, 'spawn', function(command, args, options) {
    if (command !== 'bwrap') return originalSpawn.call(this, command, args, options);
    const socket = args[args.indexOf('/case/gateway.sock') - 1];
    assert.ok(socket.endsWith('/gateway.sock'));
    roots.push(dirname(socket));
    const child = disconnectChild(socket, { mode: children.length === 0 ? 'disconnect' : 'healthy', resources });
    children.push(child);
    return child;
  });
  const killMock = t.mock.method(process, 'kill', function(pid, signal) {
    if (pid !== -987654) return originalKill.call(this, pid, signal);
    if (signal === 0) { const error = new Error('synthetic owned group is gone'); error.code = 'ESRCH'; throw error; }
    children.at(-1).stop();
    return true;
  });
  syncBuiltinESMExports();
  try {
    const directory = join(workspace.path, 'journal');
    const resultJournal = createMixedResultJournal({ directory, prepared: fixture.prepared });
    const generation = await runMixedGeneration({ prepared: fixture.prepared, guard: fixture.guard,
      apiKey: 'synthetic-only', cairnStoreRoot: fixture.root, resultJournal });
    t.diagnostic(JSON.stringify({ events, halted: generation.halted,
      arms: generation.cases.map(row => row.arms.map(arm => ({ name: arm.name, status: arm.status, reason: arm.reason }))) }));
    const native = generation.cases[0].arms.find(arm => arm.name === 'mem0');
    assert.equal(generation.halted, false);
    assert.equal(native.status, 'failed');
    assert.equal(native.reason, 'native_response_disconnect');
    assert.equal(native.answer, null);
    assert.equal(native.diagnostics.attempts.requests, 1);
    assert.equal(native.diagnostics.attempts.unknownActualCount, 0);
    assert.equal(generation.cases[0].arms.find(arm => arm.name === 'cairn').status, 'completed');
    assert.ok(generation.cases[1].arms.every(arm => arm.status === 'completed'));
    assert.equal(children.length, 2);
    assert.ok(checkedCairnEntries >= 2, 'both later Cairn arms crossed the cleanup-order assertion');
    assert.ok(roots.every(root => !fs.existsSync(root)), 'all native roots gone before phase return');
    assert.ok(children.every(child => child.stdout.readableEnded));
    assert.ok(fixture.guard.attempts().every(attempt => attempt.outcome === 'succeeded'));
    const scored = await scoreMixedGeneration({ generationReport: generation,
      evaluatorRows: [evaluatorRow('first'), evaluatorRow('second')], referenceRenderings: undefined,
      guard: fixture.guard, apiKey: 'synthetic-only', resultJournal });
    assert.equal(scored.summary.fixedN, 2);
    assert.equal(scored.summary.commonResolvedN, 1);
    assert.equal(scored.summary.perArm.mem0.unresolved, 1);
    assert.equal(scored.summary.perArm.mem0.correct, 1);
    assert.equal(scored.summary.perArm.mem0.incorrect, 0);
    assert.equal(scored.summary.perArm.cairn.correct, 2);
    assert.equal(scored.cases[0].arms.find(arm => arm.name === 'mem0').judgment.attempted, false);
    const observed = inspectMixedResultJournal({ directory });
    assert.deepEqual(observed.phases.generation.completion.report, generation);
    assert.deepEqual(observed.phases.scoring.completion.report, scored);
    assert.deepEqual(observed.phases.generation.arms.map(arm => arm.state), Array(4).fill('terminal'));
    assert.equal(observed.phases.generation.arms[0].result.reason, 'native_response_disconnect');
    assert.equal(fixture.guard.caseOutcomes().scopes.length, 8);
    await Promise.allSettled(children.map(child => child.operation));
    await workspace.cleanup();
    assert.equal(fs.existsSync(workspace.path), false);
  } finally {
    for (const raw of resources) raw.destroy();
    launchMock.mock.restore(); killMock.mock.restore(); syncBuiltinESMExports();
  }
});
