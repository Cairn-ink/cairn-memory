import test from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryCore } from '../../../core/contract.mjs';
import { createCommitDispatcher, bindCommitConnection, dispatchCommit, withCommitDelivery, inCommitDelivery } from '../../../core/commit-dispatch.mjs';
import { withContentSuppressionRequest, contentSuppressionRequestInside,
  assertContentSuppressionRequestInside, writeContentSuppressionInside, cachedContentSuppressionRequestInside } from '../../../core/content-suppression-storage.mjs';
import { transaction, readTransaction } from '../../../core/database.mjs';
import { scriptedConsolidator } from '../../../core/testing/engine-card-fixture.mjs';
import { safetyFixture, ns, ok } from '../../../core/testing/content-safety-s2h-fixture.mjs';

async function fixture(t, onBackoff, onAwait) {
  const f = safetyFixture(t); await f.migrate();
  const db = f.connect(), writer = f.connect();
  const host = createCommitDispatcher({ strict: true, onBackoff, onAwait });
  host.open(() => bindCommitConnection(db));
  t.after(() => { if (writer.isTransaction) writer.exec('ROLLBACK'); db.close(); writer.close(); });
  const suppress = () => transaction(writer, () => writeContentSuppressionInside(writer, {
    namespace: ns, kind: 'memory', key: 'synthetic-catalog-source', reason: 'user_forget', actionId: 'synthetic-carry' }));
  return { ...f, db, writer, host, suppress };
}

test('seed: selection epochs survive a BUSY attempt and refuse derived durable rows', async t => {
  let backoffs = 0;
  const f = await fixture(t, () => { backoffs++; f.writer.exec('ROLLBACK'); f.suppress(); });
  f.db.exec('CREATE TABLE synthetic_selection_derivatives(title TEXT)');
  await withContentSuppressionRequest(async () => {
    readTransaction(f.db, () => { contentSuppressionRequestInside(f.db, [ns]); });
    f.writer.exec('BEGIN IMMEDIATE');
    let denied;
    try { await dispatchCommit(f.db, () => transaction(f.db, () => {
      assertContentSuppressionRequestInside(f.db, [ns]);
      f.db.prepare('INSERT INTO synthetic_selection_derivatives VALUES(?)').run('Synthetic selected catalog text');
    })); } catch (error) { denied = error.code; }
    const rows = f.db.prepare('SELECT * FROM synthetic_selection_derivatives').all();
    assert.deepEqual(rows, [], 'R2O_SEED: no selected text may become durable');
    assert.equal(denied, 'evidence_unavailable', 'R2O_SEED');
  });
  assert.ok(backoffs >= 1);
});

test('merge: an outer delivery sees epochs first sampled by the winning read attempt', async t => {
  const f = await fixture(t);
  await withContentSuppressionRequest(async () => {
    await dispatchCommit(f.db, () => readTransaction(f.db, () => { contentSuppressionRequestInside(f.db, [ns]); }));
    f.suppress();
    assert.throws(() => assertContentSuppressionRequestInside(f.db, [ns]),
      error => error.code === 'evidence_unavailable', 'R2O_MERGE');
  });
});

test('failed attempts contribute no scopes to outer delivery', async t => {
  let attempts = 0, backoffs = 0;
  const f = await fixture(t, () => { backoffs++; f.writer.exec('ROLLBACK'); f.suppress(); });
  const other = { ...ns, ownerId: 'synthetic-winning-owner' };
  await withContentSuppressionRequest(async () => {
    f.writer.exec('BEGIN IMMEDIATE');
    await dispatchCommit(f.db, () => {
      contentSuppressionRequestInside(f.db, [++attempts === 1 ? ns : other]);
      return transaction(f.db, () => {});
    });
    assert.doesNotThrow(() => assertContentSuppressionRequestInside(f.db, [ns]), 'R2O_FAILED_ATTEMPT_NOT_MERGED');
    transaction(f.writer, () => writeContentSuppressionInside(f.writer, { namespace: other,
      kind: 'memory', key: 'synthetic-winning-source', reason: 'user_forget', actionId: 'synthetic-winning-forget' }));
    assert.throws(() => assertContentSuppressionRequestInside(f.db, [other]),
      error => error.code === 'evidence_unavailable', 'R2O_MERGE');
  });
  assert.ok(attempts >= 2 && backoffs >= 1);
});

test('merge-back refuses disagreement and never replaces an existing request epoch', async t => {
  const f = await fixture(t);
  await withContentSuppressionRequest(async () => {
    contentSuppressionRequestInside(f.db, [ns]);
    await assert.rejects(async () => dispatchCommit(f.db, () => {
      f.suppress();
      contentSuppressionRequestInside(f.db, [ns], { refresh: true });
    }), error => error.code === 'evidence_unavailable', 'R2O_MERGE_CONFLICT');
    assert.throws(() => assertContentSuppressionRequestInside(f.db, [ns]),
      error => error.code === 'evidence_unavailable', 'R2O_MERGE_NO_OVERWRITE');
  });
});


test('completion failure contributes no epochs or delivery authority to its retry', async t => {
  let returns = 0, attempts = 0, backoffs = 0, failedAuthority;
  const f = await fixture(t, () => { backoffs++; failedAuthority = inCommitDelivery(() => cachedContentSuppressionRequestInside(f.db, ns.ownerId)); f.suppress(); }, ({ point }) => {
    if (point === 'return' && ++returns === 1)
      throw Object.assign(Error('synthetic completion BUSY'), { code: 'ERR_SQLITE_ERROR', errcode: 5 });
  });
  const other = { ...ns, ownerId: 'synthetic-return-winner' };
  await withCommitDelivery(() => withContentSuppressionRequest(async () => {
    await assert.doesNotReject(async () => dispatchCommit(f.db, () => readTransaction(f.db,
      () => { contentSuppressionRequestInside(f.db, [++attempts === 1 ? ns : other]); })), 'R2O_FAILED_RETURN_NOT_MERGED');
    assert.equal(failedAuthority, undefined, 'R2O_FAILED_RETURN_AUTHORITY');
    assert.doesNotThrow(() => assertContentSuppressionRequestInside(f.db, [ns]), 'R2O_FAILED_RETURN_NOT_MERGED');
    transaction(f.writer, () => writeContentSuppressionInside(f.writer, { namespace: other,
      kind: 'memory', key: 'synthetic-return-source', reason: 'user_forget', actionId: 'synthetic-return-forget' }));
    assert.throws(() => assertContentSuppressionRequestInside(f.db, [other]),
      error => error.code === 'evidence_unavailable', 'R2O_MERGE');
  }));
  assert.ok(attempts >= 2 && backoffs >= 1);
});


test('ordinary host maintenance preserves a legacy store first lazy Card generation', { timeout: 20000 }, async t => {
  const f = safetyFixture(t), db = f.connect();
  const model = { ...scriptedConsolidator(), countTokens: () => 1 };
  const legacy = openMemoryCore({ path: f.path, raw: false, model });
  f.workspace.defer(() => legacy.close());
  f.workspace.defer(() => db.close());
  for (let index = 0; index < 8; index++) {
    const content = `Orion milestone ${index}: synthetic implementation evidence marker${index}.`;
    const memory = ok(legacy.admit({ namespace: ns, memory: { content, kind: 'fact' },
      receipts: [{ client: 'synthetic', sessionId: 'legacy-' + index, eventId: 'legacy-' + index,
        role: 'user', excerpt: content }] })).memory;
    db.prepare('UPDATE memories SET created_at=? WHERE id=?').run(
      new Date(Date.UTC(2026, 0, 1 + index * 9)).toISOString(), memory.id);
  }
  await legacy.close();
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 18,
    'control: this is a legacy store before Card organization initialization');
  const host = createCommitDispatcher({ strict: true });
  const core = host.open(() => openMemoryCore({ path: f.path, raw: false, model }));
  f.workspace.defer(() => core.close());
  const envelope = await host.run(() => core.maintainCards({ namespace: ns, budget: { maxMs: 5000 } }));
  assert.equal(envelope.ok, true, 'R2O_LEGACY_LAZY_CARD ' + JSON.stringify(envelope));
  const result = ok(envelope);
  assert.equal(result.state, 'ready', 'R2O_LEGACY_LAZY_CARD');
  assert.equal(result.built.length, 1, 'R2O_LEGACY_LAZY_CARD');
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 23);
  assert.equal(db.prepare("SELECT count(*) n FROM private_cards WHERE state='confirmed'").get().n, 1);
  assert.equal(host.inspectSynchronousWrites().count, 0);
});


test('epochs sampled on another canonical handle use the 5ms attempt budget', { timeout: 10000 }, async t => {
  let started, firstBackoff;
  const f = await fixture(t, () => {
    firstBackoff ??= performance.now() - started;
    assert.ok(f.host.inspectTransactions().every(state => state.isTransaction === false));
    f.writer.exec('ROLLBACK'); f.suppress();
  });
  const selected = f.connect();
  f.host.open(() => bindCommitConnection(selected));
  t.after(() => selected.close());
  await withContentSuppressionRequest(async () => {
    readTransaction(selected, () => { contentSuppressionRequestInside(selected, [ns]); });
    f.writer.exec('BEGIN EXCLUSIVE'); started = performance.now();
    let failure;
    try { await dispatchCommit(f.db, () => transaction(f.db,
      () => assertContentSuppressionRequestInside(selected, [ns]))); }
    catch (error) { failure = error; }
    t.diagnostic('R2O_NATIVE_TIMING ' + JSON.stringify({ firstBackoff, elapsed: performance.now() - started, code: failure?.code }));
    assert.ok(firstBackoff !== undefined && firstBackoff < 1000, 'R2O_SEED_NATIVE_BUDGET ' + firstBackoff);
    assert.equal(failure?.code, 'evidence_unavailable', 'R2O_SEED');
  });
  assert.deepEqual(f.host.inspectBusyTimeouts(), [5000, 5000], 'both canonical timeouts are restored');
});


test('a guard callback cannot advance another selected handle before BEGIN and commit its derivatives', async t => {
  const f = await fixture(t), selected = f.connect();
  f.host.open(() => bindCommitConnection(selected));
  t.after(() => selected.close());
  f.db.exec('CREATE TABLE synthetic_cross_handle_derivatives(title TEXT)');
  await withContentSuppressionRequest(async () => {
    readTransaction(selected, () => { contentSuppressionRequestInside(selected, [ns]); });
    await assert.rejects(async () => dispatchCommit(f.db, () => {
      f.suppress();
      return transaction(f.db, () => {
        f.db.prepare('INSERT INTO synthetic_cross_handle_derivatives VALUES(?)').run('Synthetic selected source text');
      });
    }), error => error.code === 'evidence_unavailable', 'R2O_SEED: recheck every retained handle inside BEGIN');
    assert.deepEqual(f.db.prepare('SELECT * FROM synthetic_cross_handle_derivatives').all(), [], 'R2O_SEED');
  });
});


test('a terminal refused attempt contributes neither epochs nor delivery authority', async t => {
  const f = await fixture(t);
  await withCommitDelivery(() => withContentSuppressionRequest(async () => {
    const result = await dispatchCommit(f.db, () => readTransaction(f.db, () => {
      contentSuppressionRequestInside(f.db, [ns]);
      return { ok: false, error: { code: 'synthetic_refusal', retryable: false } };
    }));
    assert.equal(result.ok, false);
    assert.equal(inCommitDelivery(() => cachedContentSuppressionRequestInside(f.db, ns.ownerId)),
      undefined, 'R2O_FAILED_REFUSAL_AUTHORITY');
    f.suppress();
    assert.doesNotThrow(() => assertContentSuppressionRequestInside(f.db, [ns]), 'R2O_FAILED_REFUSAL_NOT_MERGED');
  }));
});


test('one host request retains winning epochs across separate core facade calls', async t => {
  const f = await fixture(t);
  await f.host.run(async () => {
    await withContentSuppressionRequest(() => dispatchCommit(f.db, () => readTransaction(f.db,
      () => { contentSuppressionRequestInside(f.db, [ns]); })));
    f.suppress();
    assert.throws(() => assertContentSuppressionRequestInside(f.db, [ns]),
      error => error.code === 'evidence_unavailable', 'R2O_HOST_REQUEST_ACCOUNT');
  });
});

for (const operation of ['forget', 'correct']) test(`a host ${operation} acknowledges its own suppression write`, async t => {
  const f = safetyFixture(t, 23); await f.migrate();
  const host = createCommitDispatcher({ strict: true });
  const core = host.open(() => openMemoryCore({ path: f.path, raw: true, model: { countTokens: () => 1 } }));
  f.workspace.defer(() => core.close());
  const memory = ok(await core.admit({ namespace: ns, memory: { content: 'Synthetic write acknowledgement', kind: 'fact' },
    receipts: [{ client: 'synthetic', sessionId: 'ack', eventId: 'ack', role: 'user', excerpt: 'Synthetic write source' }] })).memory;
  const result = await core[operation]({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision,
    ...(operation === 'correct' ? { content: 'Synthetic revised acknowledgement', kind: 'fact',
      receipt: { client: 'synthetic', sessionId: 'ack', eventId: 'correct', role: 'user', excerpt: 'Synthetic revised source' } } : {}) });
  assert.equal(result.ok, true, 'R2O_WRITE_ACK ' + JSON.stringify(result));
  const db = f.connect(); f.workspace.defer(() => db.close());
  const row = db.prepare('SELECT revision,deleted FROM memories WHERE id=?').get(memory.id);
  assert.equal(row.deleted, operation === 'forget' ? 1 : 0);
  assert.equal(row.revision, memory.revision + 1);
});
