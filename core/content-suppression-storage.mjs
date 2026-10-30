import { createHash, createHmac, randomUUID } from 'node:crypto';
import { bindContentSafetyConnection, contentSafetyBudgetError, installedContentLayout } from './content-safety-schema.mjs';
import { fail, identifier } from './validation.mjs';

const boundary = ns => [ns.ownerId, ns.scope, ns.projectId ?? ''];
const reasons = new Set(['user_forget', 'correction_supersession', 'purge', 'privacy_erase', 'account_erasure']);
export const suppressionEpoch = row => (BigInt(row.epoch_hi) << 32n) + BigInt(row.epoch_lo);
export function requireSuppressionTransaction(db) {
  if (!db.isTransaction) fail('storage_error');
}
export function reserveContentIdentityInside(db, ns, kind, key, incarnation = key, origin = 'writer') {
  requireSuppressionTransaction(db);
  const values = [...boundary(ns), kind, key, incarnation];
  const previous = db.prepare(`SELECT incarnation FROM content_identity_reservations
    WHERE owner_id=? AND scope=? AND project_id=? AND kind=? AND stable_key=?`).get(...values.slice(0, 5));
  if (previous) {
    if (previous.incarnation !== incarnation) fail('unsupported_database');
    return;
  }
  db.prepare('INSERT INTO content_identity_reservations VALUES(?,?,?,?,?,?,?)').run(...values, origin);
}
/** Trusted internal seam. The caller owns the canonical tombstone transaction.
 * Retried causal actions retain their original epoch and first recorded time. */
export function writeContentSuppressionInside(db, { namespace: ns, kind, key = '', matchMode = 'incarnation',
  sourceVersion = '*', messageId = '', start = 0, end = 0, reason, actionId,
  recordedAt = new Date().toISOString(), origin = 'writer' }, installing = false) {
  requireSuppressionTransaction(db);
  if (!installing && !installedContentLayout(db).suppressionRevision) return null;
  if (!reasons.has(reason)) fail('invalid_input');
  identifier(ns.ownerId); identifier(actionId);
  if (ns.scope === 'project') identifier(ns.projectId);
  if (!['owner','namespace'].includes(matchMode)) identifier(key);
  if (matchMode === 'span') {
    identifier(messageId);
    if (![start,end].every(Number.isSafeInteger) || start < 0 || end <= start) fail('invalid_input');
  }
  const incarnation = ['owner', 'namespace'].includes(matchMode) ? '' : key;
  const target = [...boundary(ns), kind, key, incarnation, matchMode, sourceVersion, messageId, start, end, reason, actionId];
  const secret = db.prepare('SELECT store_id,cursor_secret FROM store_metadata WHERE singleton=1').get();
  const factId = createHmac('sha256', Buffer.from(secret.cursor_secret, 'hex'))
    .update(JSON.stringify(['content-suppression-s2h-v1', secret.store_id, target])).digest('hex');
  const previous = db.prepare('SELECT * FROM content_suppressions WHERE owner_id=? AND fact_id=?').get(ns.ownerId, factId);
  if (previous) {
    const fields = ['owner_id','scope','project_id','kind','stable_key','incarnation','match_mode','source_version',
      'message_key','span_start','span_end','reason','action_id'];
    if (fields.some((field, i) => previous[field] !== target[i]) || previous.evidence_origin !== origin) fail('unsupported_database');
    return { factId, epoch: suppressionEpoch(previous) };
  }
  if (!['owner', 'namespace'].includes(matchMode)) {
    reserveContentIdentityInside(db, ns, kind, key, incarnation, origin);
    if (matchMode === 'span') reserveContentIdentityInside(db, ns, 'raw-message', JSON.stringify([key, messageId]), key, origin);
  }
  db.prepare(`INSERT INTO owner_suppression_epochs SELECT ?,0,0
    WHERE NOT EXISTS(SELECT 1 FROM owner_suppression_epochs WHERE owner_id=?)`).run(ns.ownerId, ns.ownerId);
  const current = db.prepare('SELECT epoch_hi,epoch_lo FROM owner_suppression_epochs WHERE owner_id=?').get(ns.ownerId);
  const epoch = suppressionEpoch(current) + 1n;
  if (epoch > 0xffffffffffffffffn) fail('storage_error');
  db.prepare(`INSERT INTO content_suppressions(owner_id,fact_id,epoch_hi,epoch_lo,scope,project_id,kind,stable_key,
    incarnation,match_mode,source_version,message_key,span_start,span_end,reason,action_id,recorded_at,evidence_origin,cleanup_status,cleanup_attempt)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',0)`).run(ns.ownerId, factId, Number(epoch >> 32n), Number(epoch & 0xffffffffn),
    ...target.slice(1, 11), reason, actionId, recordedAt, origin);
  return { factId, epoch };
}
export function suppressOwnerInside(db, { ownerId, reason, actionId, recordedAt }) {
  return writeContentSuppressionInside(db, { namespace: { ownerId, scope: 'owner', projectId: '' },
    kind: 'owner', matchMode: 'owner', reason, actionId, recordedAt });
}
export function suppressReceiptsInside(db, ns, memoryId, options, ids) {
  requireSuppressionTransaction(db);
  if (!installedContentLayout(db).suppressionRevision) return;
  const rows = db.prepare('SELECT id FROM receipts WHERE memory_id=?').all(memoryId);
  for (const row of rows) if (!ids || ids.includes(row.id)) writeContentSuppressionInside(db,
    { namespace: ns, kind: 'receipt', key: row.id, ...options });
}

// Internal observation fence: every fact insert advances the monotone hi:lo
// binding, independently of canonical tombstones and namespace epochs. Cleanup
// retains the fact and does not advance it. Legacy cells return null.
export function contentSuppressionFenceInside(db, ownerId) {
  if (!installedContentLayout(db).suppressionRevision) return null;
  const row = db.prepare('SELECT epoch_hi,epoch_lo FROM owner_suppression_epochs WHERE owner_id=?').get(ownerId);
  return row ? `${row.epoch_hi}:${row.epoch_lo}` : '0:0';
}

const ineligibleFact = Object.freeze({ reason: 'ineligible' });
const factColumns = 'fact_id,match_mode,source_version,reason,message_key,span_start,span_end,epoch_hi,epoch_lo';
const noAncestor = ',0 AS ancestry,NULL AS ancestor_owner,NULL AS ancestor_scope,NULL AS ancestor_project,NULL AS message_id,NULL AS start,NULL AS end';

// Matching for the internal B3 observation. A missing bound version or uncertain
// ancestry makes the observation incomplete; S2h-1 serving reads remain on S1.
function factMatch(fact, { kind, revision, version, messageId, start, end }) {
  if (['owner','namespace','incarnation'].includes(fact.match_mode)) return true;
  if (fact.match_mode === 'version') {
    if (version === undefined) return 'ineligible';
    const bound = JSON.parse(fact.source_version), tag = { memory: 'memory-revision-v1', 'submitted-note': 'note-v1' }[kind];
    if (tag && (bound.length !== 2 || bound[0] !== tag || !Number.isSafeInteger(bound[1]) || bound[1] < 1)) return 'ineligible';
    return JSON.stringify(bound) === version;
  }
  if (fact.match_mode === 'revision-through') {
    const bound = JSON.parse(fact.source_version);
    if (bound.length !== 2 || bound[0] !== 'memory-revision-through-v1' || !Number.isSafeInteger(bound[1]) || bound[1] < 1) fail('unsupported_database');
    if (!Number.isSafeInteger(revision)) return 'ineligible';
    return revision <= bound[1];
  }
  if (fact.match_mode === 'span') {
    if (![fact.span_start,fact.span_end].every(Number.isSafeInteger)) return 'ineligible';
    return messageId === fact.message_key && start < fact.span_end && end > fact.span_start;
  }
  return false;
}
function* matchingContentSuppressionsInside(db, ns, target, layout, ordered = false) {
  if (!layout.suppressionRevision) return;
  const { kind, key } = target;
  // Three indexed direct ranges, plus the same receipt -> Raw ancestry that the
  // predicate has always followed. SQL orders duplicates together, so a digest
  // needs no retained fact set, temporary table or additional handle.
  let sql = `SELECT ${factColumns}${noAncestor} FROM content_suppressions INDEXED BY content_suppression_target
    WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(?,'owner','','owner','','')
    UNION ALL SELECT ${factColumns}${noAncestor} FROM content_suppressions INDEXED BY content_suppression_target
    WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(?,?,?,'namespace','','')
    UNION ALL SELECT ${factColumns}${noAncestor} FROM content_suppressions INDEXED BY content_suppression_target
    WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(?,?,?,?,?,?)`;
  const values = [ns.ownerId, ...boundary(ns), ...boundary(ns), kind ?? '', key ?? '', key ?? ''];
  if (layout.rawLineage && ['memory','receipt'].includes(kind)) {
    sql += ` UNION ALL SELECT ${factColumns.split(',').map(column => 'f.' + column).join(',')},1,
      c.owner_id,c.scope,c.project_id,l.message_id,l.start,l.end
      FROM raw_receipt_lineage l JOIN receipts r ON r.id=l.receipt_id
      LEFT JOIN raw_conversations c ON c.id=l.conversation_id
      LEFT JOIN content_suppressions f INDEXED BY content_suppression_target
        ON (f.owner_id,f.scope,f.project_id,f.kind,f.stable_key,f.incarnation)=(?,?,?,'raw',l.conversation_id,l.conversation_id)
      WHERE ${kind === 'memory' ? 'r.memory_id' : 'r.id'}=?`;
    values.push(...boundary(ns),key);
  }
  sql += ordered ? ' ORDER BY epoch_hi,epoch_lo,fact_id' : ' ORDER BY ancestry,epoch_hi,epoch_lo,fact_id';
  const statement = db.prepare(sql);
  const rows = typeof statement.iterate === 'function' ? statement.iterate(...values) : statement.all(...values);
  for (const fact of rows) {
    if (fact.ancestry && (fact.ancestor_owner !== ns.ownerId || fact.ancestor_scope !== ns.scope || fact.ancestor_project !== (ns.projectId ?? ''))) {
      yield ineligibleFact; continue;
    }
    if (fact.fact_id === null) continue;
    const match = factMatch(fact, fact.ancestry ? { kind:'raw',messageId:fact.message_id,start:fact.start,end:fact.end } : target);
    if (match === 'ineligible') yield ineligibleFact;
    else if (match) yield fact;
  }
}
/** Internal, synchronous and snapshot-local. The caller owns the transaction.
 * Memo reuse is limited to S1's prepared reader; observations are never cached
 * across mutable ancestry or fact writes. No database handle or durable state is
 * allocated. A supplied charged reader owns every statement, including attestation. */
export function memorySuppressionObservationInside(db, ns, { memoryId, revision }, { memo, reader } = {}) {
  try {
    requireSuppressionTransaction(db);
    const read = reader ?? memo?.db ?? db;
    if (read !== db) bindContentSafetyConnection(read,db);
    if (!read.isTransaction) fail('storage_error');
    const layout = installedContentLayout(read);
    if (!layout.suppressionRevision) return { complete:true,suppressed:false,capability:'none' };
    const digest = createHash('sha256').update('[');
    let matchedCount = 0, matchedEpoch = null, factId = null, reason = null;
    for (const fact of matchingContentSuppressionsInside(read,ns,{kind:'memory',key:memoryId,revision,
      version:JSON.stringify(['memory-revision-v1',revision])},layout,true)) {
      if (!fact.fact_id) return { complete:false,cause:'unavailable' };
      if (fact.fact_id === factId) continue;
      if (matchedCount) digest.update(',');
      digest.update(JSON.stringify([fact.epoch_hi,fact.epoch_lo,fact.fact_id]));
      matchedCount++; matchedEpoch = String(suppressionEpoch(fact)); factId = fact.fact_id; reason = fact.reason;
    }
    return { complete:true,suppressed:matchedCount > 0,matchedCount,matchedEpoch,factId,reason,
      matchedSetDigest:digest.update(']').digest('base64url') };
  } catch (error) {
    return { complete:false,cause:contentSafetyBudgetError(error) ? 'budget' : 'unavailable' };
  }
}

// Allocate only against live keys and permanent referenced reservations. This
// deliberately creates no lifetime registry entry for an ordinary capture.
export function allocateContentKey(db, ns, kind) {
  const table = { memory: 'memories', receipt: 'receipts', 'submitted-note': 'card_notes', card: 'private_cards', raw: 'raw_conversations' }[kind];
  if (!table) fail('invalid_input');
  const safety = installedContentLayout(db).suppressionRevision;
  for (let attempt = 0; attempt < 32; attempt++) {
    const key = randomUUID();
    if (db.prepare(`SELECT 1 FROM ${table} WHERE id=?`).get(key)) continue;
    if (safety && db.prepare(`SELECT 1 FROM content_identity_reservations
      WHERE owner_id=? AND scope=? AND project_id=? AND kind=? AND stable_key=?`).get(...boundary(ns), kind, key)) continue;
    return key;
  }
  fail('storage_error');
}
