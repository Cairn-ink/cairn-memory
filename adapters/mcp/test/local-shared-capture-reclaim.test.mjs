import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLocalRawWorker } from '../../../integrations/client/raw/local-worker.mjs';
import { workerFixture } from '../../../integrations/client/test/fixtures/local-worker-workspace.mjs';
import { captureReply } from '../../local/capture.mjs';
import { reclaimStagedLifecycle } from './local-shared-capture-reclaim-support.mjs';

// CI is shallow: historical parity belongs in the tools/testing qualification.
for (const recovery of ['retry', 'no-retry']) test(`D1 refused shared capture staged lifecycle: ${recovery}`,
  { timeout: 15000 }, t => reclaimStagedLifecycle(t, recovery));

test('D1 real local client retains its offset and pending projection on the mapped refusal', async t => {
  const f = workerFixture(t), executable = join(f.workspace.path, 'synthetic-refusal-node.mjs');
  const reply = captureReply({ ok: false, error: { code: 'evidence_unavailable', retryable: false } }, {});
  assert.deepEqual(reply, { status: 409, body: { error: 'local_capture_failed' } });
  writeFileSync(executable, `#!${process.execPath}\nif(process.argv[2]==='--version')process.stdout.write(process.version+'\\n');\nelse{process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(${JSON.stringify(JSON.stringify(reply) + '\n')}));}\n`, { mode: 0o700 });
  const worker = createLocalRawWorker({ ...f.options, nodeExecutable: executable, env: {} });
  assert.equal((await worker.initialize({ ...f.context, start: 'beginning' })).status, 'ready');
  const before = f.cursor(), refused = await worker.run(f.context), after = f.cursor();
  assert.equal(refused.status, 'blocked'); assert.equal(refused.reason, 'capture_refused');
  assert.equal(after.offset, before.offset, 'R2O3_CLIENT_CURSOR refusal cannot advance the transcript watermark');
  assert.equal(after.pending.state, 'blocked');
  assert.ok(after.pending.projection.range.end > after.offset);
  const durable = readFileSync(f.cursorPath());
  assert.equal((await worker.run(f.context)).status, 'blocked');
  assert.deepEqual(readFileSync(f.cursorPath()), durable, 'the exact refused projection remains durable');
  t.diagnostic('R2O3_CLIENT_CURSOR offset unchanged; pending blocked; next ordinary run remains blocked');
});
