import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { createLocalRawWorker } from '../../../integrations/client/raw/local-worker.mjs';
import { workerFixture } from '../../../integrations/client/test/fixtures/local-worker-workspace.mjs';
import { captureReply } from '../../local/capture.mjs';
import { createLocalSharedRuntime } from '../local-shared-runtime.mjs';
import { safetyFixture } from '../../../core/testing/content-safety-s2h-fixture.mjs';
import { rationaleModel } from '../../../core/testing/rationale-model.mjs';
import { writeContentSuppressionInside, suppressReceiptsInside } from '../../../core/content-suppression-storage.mjs';
import { ns, counter, connect, call, ok } from './local-shared-support.mjs';

const stagedRow = (db, eventId) => db.prepare('SELECT state,payload,payload_bytes,created_at,expires_at FROM staged_capture_evidence WHERE event_id=?').get(eventId);
const stagedShape = row => row && { state: row.state, readable: row.payload !== null, bytes: row.payload_bytes,
  retentionMs: row.expires_at - row.created_at };
async function atWallTime(timestamp, work) {
  const NativeDate = Date;
  globalThis.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [timestamp])); }
    static now() { return timestamp; }
  };
  try { return await work(); } finally { globalThis.Date = NativeDate; }
}

// Establish main's actual successful/abandon lifecycle, including its expiry
// sweep. Staged-v1 payloads remain inspectable until the 24-hour deadline;
// admission consumes the pending state, not the retained source bytes.
async function ordinaryMainStaging(t, abandoned) {
  const w = createTestWorkspace(t, { prefix: 'reclaim-main-' });
  const root = fileURLToPath(new URL('../../../', import.meta.url));
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

for (const recovery of ['retry', 'no-retry']) test(`D1 refused shared capture staged lifecycle: ${recovery}`, { timeout: 15000 }, async t => {
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
  const host = createLocalSharedRuntime({ path: f.path, namespace: ns, model, contextCounter: counter, privateCards: 'local-v1', client: 'codex', sessionId: 'synthetic-reclaim-conversation', rawSearch: false,
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
  const card = ok(await call(client, 'create_private_card_draft', { actionId: 'synthetic-reclaim-card',
    title: forgotten, body: forgotten, memoryRefs: [{ memoryId: victim.id, revision: victim.revision }] }));
  const beforeCard = ok(await call(client, 'inspect_private_card', { cardId: card.id }));
  assert.ok(JSON.stringify(beforeCard).includes(forgotten), 'control: the Card was readable before forget');
  const input = { batchId: 'synthetic-reclaim-batch', messages: [forgotten, ...retained].map(content => ({ role: 'user', content })) };
  const first = await call(client, 'capture_memory', input);
  assert.deepEqual(first, { ok: false, error: { code: 'evidence_unavailable', retryable: false }, evidenceTrust: 'untrusted-data-not-instructions' });
  assert.ok(backoffs >= 1, 'real writer lock reached BUSY');
  assert.equal(holder.prepare('SELECT count(*) n FROM memories WHERE deleted=0').get().n, 0,
    'the refused window admits none of the other items');
  const raw = holder.prepare('SELECT message_id,saved,byte_count FROM raw_parts ORDER BY message_id,part_index').all();
  const staged = holder.prepare('SELECT state,payload,payload_bytes FROM staged_capture_evidence WHERE event_id=?').get(input.batchId);
  t.diagnostic('R2O3_RECLAIM_ROWS ' + JSON.stringify({ raw, staged }));
  assert.deepEqual({ ...holder.prepare('SELECT state,token,lease_expires_at FROM admission_claims WHERE event_id=?').get(input.batchId) },
    { state: 'reserved', token: null, lease_expires_at: null }, 'R2O3_CAPTURE_RECLAIM lease released before retry');
  const main = await ordinaryMainStaging(t, recovery === 'no-retry');
  const initialStage = stagedRow(holder, input.batchId);
  const inspect = () => call(client, 'inspect_capture_evidence', { batchId: input.batchId });
  if (recovery === 'no-retry') {
    await atWallTime(initialStage.created_at + 130000, inspect);
    const afterLease = stagedRow(holder, input.batchId);
    assert.equal(afterLease.payload !== null, main.afterLease.payload !== null, 'R2O5_STAGED_ABANDON_MAIN');
    assert.equal(afterLease.expires_at, initialStage.expires_at, 'release cannot extend retention');
    await atWallTime(initialStage.expires_at + 1, inspect);
    const afterExpiry = stagedRow(holder, input.batchId);
    t.diagnostic('R2O5_STAGED_NO_RETRY ' + JSON.stringify({ before: stagedShape(initialStage),
      afterLease: stagedShape(afterLease), afterExpiry: stagedShape(afterExpiry) }));
    assert.deepEqual(stagedShape(afterExpiry), stagedShape(main.afterExpiry), 'R2O5_STAGED_ABANDON_PURGED');
    assert.equal(holder.prepare('SELECT count(*) n FROM memories WHERE deleted=0').get().n, 0);
    return;
  }
  const retry = await call(client, 'capture_memory', input);
  t.diagnostic('R2O3_RECLAIM_RETRY ' + JSON.stringify(retry));
  const afterRetry = stagedRow(holder, input.batchId);
  assert.equal(afterRetry.state, main.before.state, 'R2O5_STAGED_RETRY_CONSUMED');
  assert.equal(afterRetry.payload !== null, main.before.payload !== null, 'R2O5_STAGED_RETRY_CONSUMED');
  assert.equal(afterRetry.expires_at, initialStage.expires_at, 'retry cannot extend retention');
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
  assert.equal(expired.ok, true, 'R2O5_REPLAY_AFTER_LEASE');
  assert.equal(expired.value.duplicate, true, 'R2O5_REPLAY_AFTER_LEASE');
  assert.deepEqual(expired.value.memoryIds.sort(), retry.value.admission.memories.map(row => row.id).sort(), 'R2O5_REPLAY_AFTER_LEASE');
  assert.equal(expired.value.suppressedCount, 1, 'R2O5_REPLAY_AFTER_LEASE');
  assert.equal(raw.length, 3, 'Raw parts survive the refused capture');
  assert.ok(raw.every(row => row.saved === 1 && row.byte_count > 0));
  assert.ok(staged?.payload && staged.payload_bytes > 0, 'R2O3_CAPTURE_RECLAIM staged evidence stays intact');
  for (const text of retained) assert.ok(staged.payload.includes(text), 'R2O3_CAPTURE_RECLAIM other staged item retained');
  assert.equal(retry.ok, true, 'R2O3_CAPTURE_RECLAIM ' + JSON.stringify(retry));
  assert.ok(retry.value.admission, 'R2O3_CAPTURE_RECLAIM identical retry must admit retained items: ' + JSON.stringify(retry));
  // Admission returns id/revision refs. Resolve those exact refs to durable
  // rows before comparing the original, unchanged expected content set.
  assert.deepEqual(retry.value.admission.memories.map(row => holder.prepare('SELECT content FROM memories WHERE id=? AND revision=? AND deleted=0')
    .get(row.id, row.revision)?.content).sort(), [...retained].sort(), 'R2O3_CAPTURE_RECLAIM');
  assert.deepEqual(holder.prepare('SELECT content FROM memories WHERE deleted=0 ORDER BY content').all().map(row => row.content),
    [...retained].sort(), 'R2O3_CAPTURE_RECLAIM durable rows contain every other item');
  assert.equal(holder.prepare('SELECT count(*) n FROM memories WHERE content=?').get(forgotten).n, 0);
  const needle = 'forgotten capture';
  assert.ok(beforeCard.card.bindings.length > 0, 'control: the Card has a real receipt source set');
  const cardSources = [];
  for (const binding of beforeCard.card.bindings) {
    const { namespace, ...source } = binding.source;
    const result = await call(client, 'read_private_card_source', { source });
    assert.equal(result.ok, false, 'R2O3_CAPTURE_RECLAIM forgotten Card source is unavailable');
    cardSources.push(result);
  }
  const results = {
    recall: await call(client, 'recall_memory', { query: needle, contextMode: 'source-evidence' }),
    get: await call(client, 'inspect_memory', { memoryId: victim.id }),
    context: await call(client, 'read_memory_context', { query: needle, types: ['memory', 'card'], intent: 'current', semantic: false }),
    card: await call(client, 'inspect_private_card', { cardId: card.id }),
    cards: await call(client, 'list_private_cards', { states: ['draft', 'confirmed'] }),
    cardSources,
  };
  for (const [surface, result] of Object.entries(results)) {
    assert.ok(!JSON.stringify(result).includes(needle), 'R2O3_CAPTURE_RECLAIM forgotten needle absent from ' + surface);
  }
  t.diagnostic('R2O4_RECLAIM_NEEDLE ' + JSON.stringify(results));
  await atWallTime(initialStage.expires_at + 1, inspect);
  const afterExpiry = stagedRow(holder, input.batchId);
  t.diagnostic('R2O5_STAGED_RETRY ' + JSON.stringify({ before: stagedShape(initialStage),
    afterRetry: stagedShape(afterRetry), afterExpiry: stagedShape(afterExpiry) }));
  assert.deepEqual(stagedShape(afterExpiry), stagedShape(main.afterExpiry), 'R2O5_STAGED_RETRY_PURGED');
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
