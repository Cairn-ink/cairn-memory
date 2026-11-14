import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLocalRawWorker } from '../../../integrations/client/raw/local-worker.mjs';
import { workerFixture } from '../../../integrations/client/test/fixtures/local-worker-workspace.mjs';
import { captureReply } from '../../local/capture.mjs';
import { createLocalSharedRuntime } from '../local-shared-runtime.mjs';
import { safetyFixture } from '../../../core/testing/content-safety-s2h-fixture.mjs';
import { rationaleModel } from '../../../core/testing/rationale-model.mjs';
import { writeContentSuppressionInside, suppressReceiptsInside } from '../../../core/content-suppression-storage.mjs';
import { ns, counter, connect, call, ok } from './local-shared-support.mjs';

test('D1 refused shared capture retains every other item for the identical retry', { timeout: 15000 }, async t => {
  const f = safetyFixture(t, 33); await f.migrate();
  const holder = f.connect(); let armed = false, backoffs = 0, victim;
  const forgotten = 'Synthetic forgotten capture item';
  const retained = ['Synthetic retained copper item', 'Synthetic retained telescope item'];
  const exec = DatabaseSync.prototype.exec;
  t.mock.method(DatabaseSync.prototype, 'exec', function(sql) {
    if (armed && this !== holder && sql === 'BEGIN IMMEDIATE' && new Error().stack.includes('finishAdmission')) {
      armed = false; holder.exec('BEGIN IMMEDIATE');
    }
    return Reflect.apply(exec, this, [sql]);
  });
  const model = rationaleModel(method => { if (method === 'extract') armed = backoffs === 0; });
  const host = createLocalSharedRuntime({ path: f.path, namespace: ns, model, contextCounter: counter, client: 'codex', sessionId: 'synthetic-reclaim-conversation', rawSearch: false,
    captureQualification: 'source-bound-v2', captureEvidence: 'staged-v1' }, { strict: true, onBackoff() {
    backoffs++;
    assert.equal(holder.isTransaction, true);
    assert.ok(host.inspectTransactions().every(state => !state.isTransaction));
    const options = { reason: 'user_forget', actionId: 'synthetic-reclaim-forget' };
    holder.prepare('INSERT OR IGNORE INTO suppressed SELECT owner_id,scope,project_id,fingerprint FROM memories WHERE id=?').run(victim.id);
    writeContentSuppressionInside(holder, { namespace: ns, kind: 'memory', key: victim.id, ...options });
    suppressReceiptsInside(holder, ns, victim.id, options);
    holder.prepare('UPDATE memories SET content=NULL,deleted=1,revision=revision+1 WHERE id=?').run(victim.id);
    holder.prepare('DELETE FROM receipts WHERE memory_id=?').run(victim.id);
    holder.prepare(`UPDATE namespace_epochs SET epoch=epoch+1 WHERE owner_id=? AND scope=? AND project_id=?`)
      .run(ns.ownerId, ns.scope, '');
    holder.exec('COMMIT');
  } });
  t.after(async () => { if (holder.isTransaction) holder.exec('ROLLBACK'); await host.close(); holder.close(); });
  const { client } = await connect(t, host);
  victim = ok(await call(client, 'remember_memory', { content: forgotten, kind: 'context' })).memory;
  const input = { batchId: 'synthetic-reclaim-batch', messages: [forgotten, ...retained].map(content => ({ role: 'user', content })) };
  const first = await call(client, 'capture_memory', input);
  assert.deepEqual(first, { ok: false, error: { code: 'evidence_unavailable', retryable: false }, evidenceTrust: 'untrusted-data-not-instructions' });
  assert.ok(backoffs >= 1, 'real writer lock reached BUSY');
  assert.equal(holder.prepare('SELECT count(*) n FROM memories WHERE deleted=0').get().n, 0,
    'the refused window admits none of the other items');
  const raw = holder.prepare('SELECT message_id,saved,byte_count FROM raw_parts ORDER BY message_id,part_index').all();
  const staged = holder.prepare('SELECT state,payload,payload_bytes FROM staged_capture_evidence WHERE event_id=?').get(input.batchId);
  t.diagnostic('R2O3_RECLAIM_ROWS ' + JSON.stringify({ raw, staged }));
  const retry = await call(client, 'capture_memory', input);
  t.diagnostic('R2O3_RECLAIM_RETRY ' + JSON.stringify(retry));
  const NativeDate = Date, expiredAt = Date.now() + 130000;
  globalThis.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [expiredAt])); }
    static now() { return expiredAt; }
  };
  let expired;
  try { expired = await call(client, 'capture_memory', input); }
  finally { globalThis.Date = NativeDate; }
  t.diagnostic('R2O3_RECLAIM_EXPIRED ' + JSON.stringify({ expired,
    claim: holder.prepare('SELECT state,lease_expires_at FROM admission_claims WHERE event_id=?').get(input.batchId),
    staged: holder.prepare('SELECT state,payload_bytes FROM staged_capture_evidence WHERE event_id=?').get(input.batchId),
    live: holder.prepare('SELECT content FROM memories WHERE deleted=0').all() }));
  assert.equal(raw.length, 3, 'Raw parts survive the refused capture');
  assert.ok(raw.every(row => row.saved === 1 && row.byte_count > 0));
  assert.ok(staged?.payload && staged.payload_bytes > 0, 'R2O3_CAPTURE_RECLAIM staged evidence stays intact');
  for (const text of retained) assert.ok(staged.payload.includes(text), 'R2O3_CAPTURE_RECLAIM other staged item retained');
  assert.equal(retry.ok, true, 'R2O3_CAPTURE_RECLAIM ' + JSON.stringify(retry));
  assert.ok(retry.value.admission, 'R2O3_CAPTURE_RECLAIM identical retry must admit retained items: ' + JSON.stringify(retry));
  assert.deepEqual(retry.value.admission.memories.map(row => row.content).sort(), [...retained].sort(), 'R2O3_CAPTURE_RECLAIM');
  assert.deepEqual(holder.prepare('SELECT content FROM memories WHERE deleted=0 ORDER BY content').all().map(row => row.content),
    [...retained].sort(), 'R2O3_CAPTURE_RECLAIM durable rows contain every other item');
  assert.equal(holder.prepare('SELECT count(*) n FROM memories WHERE content=?').get(forgotten).n, 0);
});

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
