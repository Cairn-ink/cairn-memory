import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../../../../core/index.mjs';
import { transaction } from '../../../../core/database.mjs';
import { contentReadSafety } from '../../../../core/content-safety.mjs';
import { attestContentSafety } from '../../../../core/content-safety-schema.mjs';
import { migrateReceiptEventTime, migrateCardLineage } from '../../../../core/content-safety-migration.mjs';
import { writeContentSuppressionInside } from '../../../../core/content-suppression-storage.mjs';
import { safetyFixture, copySqliteFixture, quiescence, ns } from '../../../../core/testing/content-safety-s2h-fixture.mjs';
import { sql, ok, forgottenText, callerText, correction, rows, writtenRows, noEcho } from './survivor-correction.mjs';

export function ownReceiptFact(f, reason = 'privacy_erase') {
  sql(f.path, db => transaction(db, () => writeContentSuppressionInside(db, {
    namespace: f.namespace, kind: 'receipt', key: f.receipt.id,
    reason, actionId: 'independent-own-fact' })));
  assert.ok(sql(f.path, db => db.prepare("SELECT count(*) n FROM content_suppressions WHERE kind='receipt' AND stable_key=?")
    .get(f.receipt.id)).n >= 1, 'the survivor really has an own-receipt marker');
}

export function oldDecision(f) {
  return sql(f.path, db => {
    attestContentSafety(db);
    return contentReadSafety(db, { namespace: f.namespace, intent: 'history',
      ref: { type: 'memory', namespace: f.namespace, memoryId: f.survivor.id, revision: f.survivor.revision } });
  });
}

// installedContentLayout's first statement calls WeakSet.has before any cache
// return or SQL. Observe its direct helper caller, including on legacy layouts.
// The native isTransaction accessor need not be configurable or on a prototype.
export async function traceCorrection(t, run, allowed = true) {
  const prototype = DatabaseSync.prototype, prepare = prototype.prepare;
  const has = WeakSet.prototype.has;
  assert.equal(typeof has, 'function');
  const statements = [], helperStatements = []; let helperEntries = 0;
  WeakSet.prototype.has = function (...args) {
    if (/at installedContentLayout[^\n]*\n\s*at memoryCorrectionDenialsInside\b/.test(new Error().stack)) helperEntries++;
    return Reflect.apply(has, this, args);
  };
  prototype.prepare = function (query, ...args) {
    statements.push(query);
    if (new Error().stack.includes('at memoryCorrectionDenialsInside')) helperStatements.push(query);
    return Reflect.apply(prepare, this, [query, ...args]);
  };
  let result;
  try { result = await run(); }
  finally {
    prototype.prepare = prepare;
    WeakSet.prototype.has = has;
  }
  assert.ok(statements.length > 0, 'the correction SQL was observed');
  if (allowed) {
    assert.equal(helperEntries, 0, 'the new helper is never called on the old allow path');
    assert.deepEqual(helperStatements, [], 'no statement from typed enumeration runs on the allow path');
    assert.equal(statements.some(query => /^SELECT kind,match_mode FROM content_suppressions/.test(query)), false);
    assert.equal(statements.some(query => query.includes('ORDER BY epoch_hi,epoch_lo,fact_id')), false,
      'the helper\'s ordered typed enumeration is absent');
  } else {
    assert.ok(helperEntries > 0, 'this control exercised the deny-only helper');
    assert.ok(helperStatements.some(query => /^SELECT kind,match_mode FROM content_suppressions/.test(query)));
  }
  t.diagnostic((allowed ? 'ALLOW_PATH_TRACE ' : 'DENY_PATH_TRACE ') + JSON.stringify({ case: t.name,
    helperEntries, helperStatements, statements }));
  return result;
}

export async function hostedPair(t, options, operation, ownReceipt = false) {
  const f = safetyFixture(t, 33);
  if (options.layout === 48) await f.migrate();
  if (options.layout === 53) {
    copySqliteFixture(f.path, f.backupPath);
    await (options.cardLineage ? migrateCardLineage : migrateReceiptEventTime)({ path: f.path, backupPath: f.backupPath,
      expected: { storeId: f.storeId, base: 33 }, quiescence });
  }
  // Hosted public admissions cite one message; no captureRaw, local authority,
  // local Raw privacy, Raw port or ingestion is configured.
  const core = openMemoryCore({ path: f.path }); f.workspace.defer(() => core.close());
  const sourceReceipt = { client: 'synthetic-hosted', sessionId: 'shared-session', eventId: 'shared-message',
    role: 'user', excerpt: 'Hosted source message evidence.' };
  const admit = content => ok(core.admit({ namespace: ns, memory: { content, kind: 'context' }, receipts: [sourceReceipt] })).memory;
  const victim = admit(forgottenText), survivor = admit('synthetic retained hosted survivor');
  const receipt = sql(f.path, db => db.prepare('SELECT * FROM receipts WHERE memory_id=?').get(survivor.id));
  const layout = sql(f.path, db => {
    assert.equal(db.prepare('SELECT count(*) n FROM raw_messages').get().n, 0);
    assert.equal(db.prepare('SELECT count(*) n FROM raw_receipt_lineage').get().n, 0);
    return attestContentSafety(db);
  });
  ok(await core[operation]({ namespace: ns, memoryId: victim.id, expectedRevision: victim.revision,
    ...(operation === 'correct' ? { content: 'Hosted sibling replacement.', kind: 'context', receipt: {
      ...sourceReceipt, eventId: 'sibling-replacement', excerpt: 'Explicit sibling replacement evidence.' } } : {}) }));
  const pair = { ...f, namespace: ns, core, survivor, receipt, sourceReceipt, layout,
    needles: [forgottenText, 'forgetneedle', survivor.content] };
  if (ownReceipt) ownReceiptFact(pair);
  assert.deepEqual(oldDecision(pair), { allowed: true }, 'main\'s outcome: receipt-less Memory preflight allows');
  return pair;
}

export async function correctHostedAndScan(t, f, source) {
  const receipt = { ...f.sourceReceipt, ...(source === 'different' ? {
    eventId: 'different-message', excerpt: 'A different caller supplied message.' } : {}) };
  const before = rows(f);
  const result = await traceCorrection(t, () => f.core.correct(correction(f, callerText, { receipt })));
  noEcho(result, f.needles);
  noEcho(writtenRows(before, rows(f)), f.needles);
  const memory = ok(result).memory;
  assert.equal(memory.id, f.survivor.id, 'the same Memory address survives');
  assert.equal(memory.revision, f.survivor.revision + 1);
  assert.equal(memory.content, callerText);
  const stored = sql(f.path, db => db.prepare('SELECT client,session_id,event_id,role,excerpt FROM receipts WHERE memory_id=?').all(memory.id));
  assert.deepEqual(stored.map(row => ({ ...row })), [{ client: receipt.client, session_id: receipt.sessionId,
    event_id: receipt.eventId, role: receipt.role, excerpt: receipt.excerpt }]);
  for (const read of [() => f.core.get({ namespace: f.namespace, memoryId: memory.id }),
    () => f.core.list({ namespace: f.namespace, limit: 50 }),
    () => f.core.fetch({ namespace: f.namespace, refs: [{ memoryId: memory.id, revision: memory.revision }] })]) {
    const value = await read(); noEcho(value, f.needles); ok(value);
  }
}
