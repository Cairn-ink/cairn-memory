import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createTestWorkspace } from './workspace.mjs';
import { rationaleModel } from '../../core/testing/rationale-model.mjs';
import { ns } from '../../adapters/mcp/test/local-shared-support.mjs';
import { atWallTime, stagedShape, reclaimStagedLifecycle } from '../../adapters/mcp/test/local-shared-capture-reclaim-support.mjs';

const stagedRow = (db, eventId) => db.prepare('SELECT state,payload,payload_bytes,created_at,expires_at FROM staged_capture_evidence WHERE event_id=?').get(eventId);

// Establish main's actual successful/abandon lifecycle, including its expiry
// sweep. Staged-v1 payloads remain inspectable until the 24-hour deadline;
// admission consumes the pending state, not the retained source bytes.
async function ordinaryMainStaging(t, abandoned) {
  const w = createTestWorkspace(t, { prefix: 'reclaim-main-' });
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const archive = join(w.path, 'main.tar');
  for (const [program, args] of [['git', ['archive', '--output', archive, '39ae9111']], ['tar', ['-xf', archive, '-C', w.path]]]) {
    const child = spawnSync(program, args, { cwd: root, encoding: 'utf8' });
    t.diagnostic('R2O5_STAGED_MAIN_COMMAND ' + JSON.stringify({ program, args, rc: child.status }));
    assert.equal(child.status, 0, child.stderr);
  }
  const { openMemoryCore } = await import(pathToFileURL(join(w.path, 'core/contract.mjs')));
  const model = rationaleModel();
  if (abandoned) model.extract = () => { throw Error('synthetic extraction failure'); };
  const path = join(w.path, 'ordinary.sqlite');
  const core = openMemoryCore({ path, raw: false, model, captureQualification: 'source-bound-v2', captureEvidence: 'staged-v1' });
  w.defer(() => core.close());
  const key = { namespace: ns, client: 'synthetic', eventId: 'ordinary-stage' };
  const result = await core.capture({ ...key, sessionId: 'ordinary',
    messages: [{ id: 'source', role: 'user', content: 'Synthetic ordinary staged source' }] });
  assert.equal(result.ok, !abandoned, JSON.stringify(result));
  const db = new DatabaseSync(path); w.defer(() => db.close());
  const before = stagedRow(db, key.eventId);
  assert.equal(before.state, abandoned ? 'failed' : 'admitted');
  assert.ok(before.payload);
  await atWallTime(before.created_at + 130000, () => core.inspectCaptureEvidence(key));
  const afterLease = stagedRow(db, key.eventId);
  await atWallTime(before.expires_at + 1, () => core.inspectCaptureEvidence(key));
  const afterExpiry = stagedRow(db, key.eventId);
  assert.deepEqual(stagedShape(afterExpiry), { state: 'expired', readable: false, bytes: 0, retentionMs: 86400000 });
  t.diagnostic('R2O5_STAGED_MAIN ' + JSON.stringify({ abandoned, before: stagedShape(before),
    afterLease: stagedShape(afterLease), afterExpiry: stagedShape(afterExpiry) }));
  return { before, afterLease, afterExpiry };
}

for (const recovery of ['retry', 'no-retry']) test(`released staged capture matches archived 39ae9111: ${recovery}`,
  { timeout: 15000 }, async t => {
    const main = await ordinaryMainStaging(t, recovery === 'no-retry');
    const actual = await reclaimStagedLifecycle(t, recovery);
    if (recovery === 'no-retry') {
      assert.equal(actual.afterLease.payload !== null, main.afterLease.payload !== null, 'R2O5_STAGED_ABANDON_MAIN');
      assert.deepEqual(stagedShape(actual.afterExpiry), stagedShape(main.afterExpiry), 'R2O5_STAGED_ABANDON_PURGED');
    } else {
      assert.equal(actual.afterRetry.state, main.before.state, 'R2O5_STAGED_RETRY_CONSUMED');
      assert.equal(actual.afterRetry.payload !== null, main.before.payload !== null, 'R2O5_STAGED_RETRY_CONSUMED');
      assert.deepEqual(stagedShape(actual.afterExpiry), stagedShape(main.afterExpiry), 'R2O5_STAGED_RETRY_PURGED');
    }
  });
