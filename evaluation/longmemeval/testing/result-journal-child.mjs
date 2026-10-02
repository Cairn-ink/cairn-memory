// The exact interruption seam is shared by the retained RED and corrected GREEN.
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { readFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { runMixedGeneration } from '../mixed-generation.mjs';
import { scoreMixedGeneration } from '../mixed-scoring.mjs';
import { evaluatorRow, fakeMixedHttp, sourceRow, syntheticMixedFixture } from './mixed-fixture.mjs';
import { syntheticNativeDescriptors, syntheticScoringGeneration } from './result-journal-fixture.mjs';

const [parent, phase = 'generation', native = 'synthetic', observations = 'omitted',
  sourceOptionsJson = '{}'] = process.argv.slice(2);
const sourceOptions = JSON.parse(sourceOptionsJson);
const originalSpawn = childProcess.spawn;
childProcess.spawn = (...args) => {
  const child = originalSpawn(...args);
  if (args[0] === 'bwrap' && child.pid) {
    let startTime = null;
    try {
      const stat = readFileSync(`/proc/${child.pid}/stat`, 'utf8');
      startTime = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
    } catch (error) { if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error; }
    process.send({ kind: 'native_group', pid: child.pid, startTime });
  }
  return child;
};
syncBuiltinESMExports();
const workspace = createTestWorkspace(null, { prefix: 'journal-child-', parent });
const descriptors = syntheticNativeDescriptors(workspace.path, native === 'native');
const fake = fakeMixedHttp();
const fixture = syntheticMixedFixture(null, { ...descriptors, sourceCases: [sourceRow()],
  armOrders: [sourceOptions.order ?? ['cairn', 'mem0']], fetchImpl: fake.fetchImpl, workspace,
  ...(sourceOptions.comparisonProfile === undefined ? {} : { comparisonProfile: sourceOptions.comparisonProfile }),
  ...(sourceOptions.sourceHistoryPolicy === undefined ? {} : { sourceHistoryPolicy: sourceOptions.sourceHistoryPolicy }) });
let journalModule;
try { journalModule = await import('../mixed-result-journal.mjs'); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
const directory = join(workspace.path, 'journal');
const resultJournal = process.env.CAIRN_MIXED_JOURNAL_BASELINE === '1' ? undefined
  : journalModule?.createMixedResultJournal({ directory, prepared: fixture.prepared });
const original = fixture.guard.withCaseScope;
let completed;
const guard = { ...fixture.guard, withCaseScope: async (identity, callback) => {
  const scopes = fixture.guard.caseOutcomes().scopes;
  const targetOrdinal = phase === 'generation' ? 1 : 3;
  if (scopes.length === targetOrdinal) {
    assert.equal(scopes.at(-1).status, 'completed');
    assert.ok(completed);
    process.send({ checkpoint: phase, directory, actual: completed,
      completedScopes: scopes.length, dispatches: fake.calls.length });
    await new Promise(() => {});
  }
  const outcome = await original.call(fixture.guard, identity, callback);
  if (identity.phase === phase && outcome.status === 'completed') {
    completed = phase === 'generation' ? outcome.value?.answer?.text : outcome.value;
  }
  return outcome;
} };
try {
  const generation = phase === 'scoring' && native !== 'native'
    ? await syntheticScoringGeneration(fixture, guard, resultJournal)
    : await runMixedGeneration({ prepared: fixture.prepared, guard,
    apiKey: 'JOURNAL_KEY_CANARY', cairnStoreRoot: fixture.root,
    ...(observations === 'enabled' ? { phaseTiming: 'bounded-tail-v1', recallWitness: 'bounded-v1' } : {}),
    ...(resultJournal ? { resultJournal } : {}) });
  if (phase === 'scoring') await scoreMixedGeneration({ generationReport: generation,
    evaluatorRows: [evaluatorRow()], referenceRenderings: undefined,
    guard, apiKey: 'JOURNAL_KEY_CANARY', ...(resultJournal ? { resultJournal } : {}) });
  throw new Error('interruption_checkpoint_not_reached');
} finally { await workspace.cleanup(); }
