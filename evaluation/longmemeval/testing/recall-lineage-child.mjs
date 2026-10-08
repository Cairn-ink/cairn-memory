// Synthetic owned subprocess only. Never execute a native case or provider.
import assert from 'node:assert/strict';
import crypto, { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { openMemoryCore } from '../../../core/contract.mjs';
import { MemoryStoreError } from '../../../core/validation.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { runMixedGeneration } from '../mixed-generation.mjs';
import { createMixedResultJournal, inspectMixedResultJournal } from '../mixed-result-journal.mjs';
import { fakeMixedHttp, sourceRow, syntheticMixedFixture } from './mixed-fixture.mjs';
import { syntheticNativeDescriptors } from './result-journal-fixture.mjs';

const [mode, parent] = process.argv.slice(2);
assert.ok(['default', 'v1', 'v2', 'export-fault', 'ingestion-failure', 'assertion-failure',
  'later-open-failure', 'deferred-close-failure'].includes(mode));
const workspace = createTestWorkspace(null, { prefix: 'cairn-lineage-child-', parent });
const originalRandomBytes = crypto.randomBytes;
let output, faults = 0, nativeSkipped = 0, checkpoint = 'setup';
let openedStores = 0, closeAttempts = 0, closedStores = 0, intentionalCloseFailures = 0, cleanupFailed = false;
const closeStore = (core, index) => {
  closeAttempts++;
  assert.equal(core.close().ok, true);
  closedStores++;
  if (mode === 'deferred-close-failure' && index === 1) {
    intentionalCloseFailures++;
    throw Error('PRIVATE_N27_CLOSE_ERROR_CANARY');
  }
};
try {
  const descriptors = syntheticNativeDescriptors(workspace.path);
  const rows = [sourceRow('lineage-child-0'), sourceRow('lineage-child-1')];
  const fake = fakeMixedHttp((_url, body) => {
    if (mode === 'ingestion-failure' && _url.endsWith('/responses')
      && body.text?.format?.name === 'cairn_extract') {
      return Response.json({ object: 'response', model: body.model, status: 'completed',
        error: null, incomplete_details: null, output: [{ type: 'message', role: 'assistant',
          status: 'completed', content: [{ type: 'output_text', text: JSON.stringify({
            items: [{ content: 'PRIVATE_N27_INVALID_SOURCE_CANARY', kind: 'fact',
              confidence: 0.9, sourceIndices: [999] }],
          }) }] }], usage: { input_tokens: 100, output_tokens: 5, total_tokens: 105 } });
    }
    // Fault only after the genuine fake answer invocation, before export.
    // Isolated process, not a production injection seam or shared-test patch.
    if (mode === 'export-fault' && body.messages) {
      crypto.randomBytes = function(size, ...args) {
        if (size === 32) {
          faults++;
          crypto.randomBytes = originalRandomBytes;
          syncBuiltinESMExports();
          throw Error('PRIVATE_N27_RNG_ERROR_CANARY');
        }
        return Reflect.apply(originalRandomBytes, this, [size, ...args]);
      };
      syncBuiltinESMExports();
    }
  }, { cairnMemory: true });
  const fixture = syntheticMixedFixture(null, { ...descriptors, sourceCases: rows,
    armOrders: rows.map(() => ['cairn', 'mem0']), fetchImpl: fake.fetchImpl,
    comparisonProfile: 'indexed-evidence-v1', workspace });
  const nativeScopes = new Set(fixture.prepared.roster.map(row =>
    row.arms.find(arm => arm.name === 'mem0').scopeId));
  const guard = { ...fixture.guard, withCaseScope(identity, operation) {
    return fixture.guard.withCaseScope(identity, nativeScopes.has(identity.caseId)
      ? handle => { nativeSkipped++; handle.revoke(); return null; } : operation);
  } };
  const resultJournal = createMixedResultJournal({ directory: join(workspace.path, 'journal'),
    prepared: fixture.prepared });
  checkpoint = 'generation';
  const report = await runMixedGeneration({ prepared: fixture.prepared, guard,
    apiKey: 'PRIVATE_N27_KEY_CANARY', cairnStoreRoot: fixture.root, resultJournal,
    ...(mode === 'default' ? {} : { recallWitness: mode === 'v1' ? 'bounded-v1' : 'bounded-lineage-v2' }) });
  checkpoint = 'report';
  assert.equal(report.halted, false);
  const retained = inspectMixedResultJournal({ directory: join(workspace.path, 'journal') });
  const arms = report.cases.map(row => row.arms.find(arm => arm.name === 'cairn'));
  assert.equal(nativeSkipped, 2);
  for (const arm of arms) {
    if (mode === 'ingestion-failure') {
      assert.equal(arm.status, 'failed');
      assert.equal(arm.reason, 'ingestion_incomplete');
      assert.equal(arm.answer, null);
    } else {
      assert.equal(arm.status, 'completed');
      assert.equal(arm.reason, null);
      assert.equal(arm.answer.text, 'Synthetic memory fact.');
    }
    assert.deepEqual(retained.phases.generation.arms.find(item =>
      item.result?.scope?.ordinal === arm.scope.ordinal).result.diagnostics.recallWitness,
    arm.diagnostics.recallWitness, 'unchanged journal roundtrip retains diagnostic');
  }
  const witnesses = arms.map(arm => arm.diagnostics.recallWitness);
  checkpoint = 'witness';
  let joinedRefs = 0, joinedReceipts = 0;
  if (mode === 'default') assert.ok(witnesses.every(value => value === undefined));
  else {
    assert.ok(witnesses.every(value => value.closed && value.disposed));
    if (mode === 'v1') assert.ok(witnesses.every(value => value.version === 1
      && !Object.hasOwn(value, 'lineage')));
    else if (mode === 'export-fault') {
      checkpoint = 'export-fault';
      assert.equal(faults, 2);
      assert.ok(witnesses.every(value => value.version === 2));
      for (const witness of witnesses) {
        // reportSnapshot deliberately returns null-prototype records. Compare
        // the exact observable own-data shape, not a plain literal's prototype.
        assert.deepEqual(Object.keys(witness.lineage).sort(), ['reason', 'status', 'version']);
        assert.equal(witness.lineage.version, 2);
        assert.equal(witness.lineage.status, 'unavailable');
        assert.equal(witness.lineage.reason, 'export_failed');
      }
    } else if (mode === 'ingestion-failure') {
      for (const witness of witnesses) {
        assert.equal(witness.lineage.status, 'available');
        assert.equal(witness.lineage.summary.recallOutcome, 'unknown');
        assert.equal(witness.lineage.summary.observation, 'unknown');
        assert.equal(witness.lineage.final.outcome, 'unknown');
        assert.equal(witness.lineage.final.observation, 'not-run');
        assert.equal(witness.lineage.events.length, 0);
        assert.equal(witness.lineage.identities.length, 0);
        assert.equal(JSON.stringify(witness.lineage).includes('PRIVATE_N27_INVALID_SOURCE_CANARY'), false);
      }
      assert.ok(fake.calls.every(call => call.body.text?.format?.name === 'cairn_extract'));
    } else {
      checkpoint = 'salt';
      assert.equal(new Set(witnesses.map(value => value.lineage.salt)).size, 2);
      const paths = readdirSync(fixture.root).filter(name => name.startsWith('mixed-cairn-')).sort()
        .map(name => join(fixture.root, name, 'store.db'));
      if (mode === 'deferred-close-failure') paths.push(join(workspace.path, 'cleanup-extra.db'));
      checkpoint = 'open';
      const stores = [];
      for (const [index, path] of paths.entries()) {
        const core = openMemoryCore({ path,
          ...(mode === 'later-open-failure' && index === 1 ? { modelCallTimeoutMs: 0 } : {}) });
        workspace.defer(() => closeStore(core, index));
        openedStores++;
        stores.push(core);
      }
      {
        checkpoint = 'join';
        for (const [index, arm] of (mode === 'deferred-close-failure' ? [] : arms).entries()) {
          const lineage = arm.diagnostics.recallWitness.lineage;
          assert.equal(lineage.status, 'available');
          assert.equal(lineage.final.outcome, 'completed');
          assert.ok(lineage.events.some(event => event.stage === 'rank'));
          for (const provenance of arm.diagnostics.provenance) {
            const matches = stores.map(core => core.get({ namespace: rows[index].namespace,
              memoryId: provenance.memoryId })).filter(value => value.ok);
            assert.equal(matches.length, 1);
            const detail = matches[0].value;
            const association = JSON.stringify([0, detail.memory.id, detail.memory.revision]);
            // Independent literal encoding, not the production digest helper.
            const digest = (kind, key) => createHash('sha256').update(JSON.stringify([
              'cairn.recall-witness.identity.v2', lineage.salt, kind, key,
            ]), 'utf8').digest('hex');
            const reference = lineage.identities.find(row => row.digest === digest('ref', `ref:${association}`));
            const receipt = lineage.identities.find(row => row.digest === digest('receipt',
              `receipt:${association}:${provenance.receiptId}`));
            assert.ok(reference && lineage.final.refs.includes(reference.token));
            assert.ok(receipt && lineage.final.receipts.includes(receipt.token));
            joinedRefs++; joinedReceipts++;
          }
          const text = JSON.stringify(lineage);
          for (const canary of ['Synthetic memory fact.', 'What synthetic fact?', 'mixed-synthetic',
            'GENERATED_SUMMARY_POISON', 'PRIVATE_N27_KEY_CANARY',
            ...arm.diagnostics.provenance.flatMap(row => [row.memoryId, row.receiptId])]) {
            assert.equal(text.includes(canary), false);
          }
        }
      }
    }
  }
  checkpoint = 'output';
  output = { mode, faults, nativeSkipped,
    expectedResourceFailure: ['later-open-failure', 'deferred-close-failure'].includes(mode),
    completedCairn: mode === 'ingestion-failure' ? 0 : arms.length,
    failedCairn: mode === 'ingestion-failure' ? arms.length : 0, answerMatched: mode !== 'ingestion-failure',
    witnessDisposed: witnesses.map(value => value?.disposed ?? null),
    lineage: witnesses.map(value => value?.lineage ?? null), joinedRefs, joinedReceipts,
    routes: fake.calls.map(call => ({ route: call.route,
      stage: call.body.text?.format?.name ?? 'answer' })) };
  if (mode === 'assertion-failure') assert.fail('intentional_owned_child_failure');
} catch (error) {
  process.exitCode = 1;
  output = { mode, checkpoint, faults, intentionalFailure: mode === 'assertion-failure',
    expectedResourceFailure: ['later-open-failure', 'deferred-close-failure'].includes(mode),
    constructorRejected: mode === 'later-open-failure' && checkpoint === 'open' &&
      error instanceof MemoryStoreError && error.code === 'invalid_input' };
} finally {
  crypto.randomBytes = originalRandomBytes;
  syncBuiltinESMExports();
  try { await workspace.cleanup(); }
  catch { cleanupFailed = true; process.exitCode = 1; }
}
console.log(JSON.stringify({ ...output, openedStores, closeAttempts, closedStores,
  intentionalCloseFailures, cleanupFailed, remainingOwnedEntries: readdirSync(parent).length }));
