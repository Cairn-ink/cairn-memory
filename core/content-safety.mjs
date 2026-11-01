import { createHash, createHmac } from 'node:crypto';
import { createCardRawSources } from './card-raw-sources.mjs';
import { createRawLineageStorage } from './raw-lineage-storage.mjs';
import { sourceRef } from './private-card-input.mjs';

const boundary = ns => [ns.ownerId, ns.scope, ns.projectId ?? ''];
const where = 'owner_id=? AND scope=? AND project_id=?';
const sameNamespace = (a, b) => a && b && JSON.stringify(boundary(a)) === JSON.stringify(boundary(b));
export const CONTENT_SAFETY_POLICY_REVISION = 'content-safety-s1-v1';
export const CONTENT_SUPPRESSION_REASONS = Object.freeze(['user_forget', 'correction_supersession', 'purge', 'privacy_erase', 'account_erasure']);
/** @typedef {{allowed:true}|{allowed:false,reason:'user_forget'|'correction_supersession'|'purge'|'privacy_erase'|'account_erasure'|'missing'|'identity_mismatch'|'ineligible'}} SafetyResult */
export const memoryContentIdentity = row => createHash('sha256').update(JSON.stringify([row.content, row.fingerprint])).digest('hex');
const allowed = Object.freeze({ allowed: true });
const denied = reason => ({ allowed: false, reason });
const bind = (identity, purpose, value) => createHmac('sha256', identity.cursorSecret)
  .update(JSON.stringify([purpose, [identity.storeId, value]])).digest('base64url');

// Trusted core method dispatch only. No public input selects a purpose.
export function contentReadPurpose(method, row) {
  return ['getCard', 'listCards', 'confirmCardDraft'].includes(method)
    ? row?.state === 'draft' ? 'draft-inspection' : 'confirmed-review' : 'retrieval';
}
export const memoryReadEligible = (row, intent = 'current') => Boolean(row && !row.deleted &&
  (intent === 'history' || row.currentness === 'current' && row.review_state !== 'awaiting'));
const legacyRetrieval = new Set(['fetch', 'get', 'list', 'search', 'map', 'sessionStartContext', 'listMemoriesByTime']);
const policies = {
  retrieval: { admits: (row, type, intent, method) => type === 'memory' ? memoryReadEligible(row, intent) &&
    (!legacyRetrieval.has(method) || row.review_state !== 'awaiting') : row.state === 'confirmed',
    current: intent => intent === 'current' },
  'draft-inspection': { admits: row => row.state === 'draft' },
  'confirmed-review': { admits: row => row.state === 'confirmed' },
};

// Explicitly scoped to one synchronous canonical read; never retain across awaits.
export function createContentReadMemo(db) {
  const statements = new Map();
  const read = { get isTransaction() { return db.isTransaction; }, prepare(sql) {
    if (!statements.has(sql)) statements.set(sql, db.prepare(sql));
    return statements.get(sql);
  } };
  return { db: read, sources: new Map(), memories: new Map(), receipts: new Map(), contributors: new Map(), lineage: createRawLineageStorage(read, { readMemo: new Map() }) };
}
export function receiptReadSafety(db, { namespace, receipt, memo }) {
  const key = JSON.stringify([namespace, receipt]);
  if (memo?.receipts.has(key)) return memo.receipts.get(key);
  const source = { client: receipt.client, sessionId: receipt.session_id, eventId: receipt.event_id, role: receipt.role, excerpt: receipt.excerpt };
  if (createHash('sha256').update(JSON.stringify(source)).digest('hex') !== receipt.receipt_key) return denied('identity_mismatch');
  const remember = result => { memo?.receipts.set(key, result); return result; };
  try {
    const lineage = memo?.lineage ?? createRawLineageStorage(db);
    const enabled = memo ? memo.lineageEnabled ??= lineage.enabled() : lineage.enabled();
    if (enabled) lineage.assertStoredReceipts(namespace, [receipt], { readExisting: true });
    return remember(allowed);
  } catch (error) {
    if (['source_excluded', 'conversation_deleted'].includes(error.code)) return remember(denied('purge'));
    if (error.code === 'raw_lineage_unavailable') return remember(denied('ineligible'));
    throw error;
  }
}

export function anchoredReadSafety(db, { namespace, memoryId, anchors, memo = createContentReadMemo(db) }) {
  for (const anchor of anchors) {
    const receipt = memo.db.prepare('SELECT * FROM receipts WHERE memory_id=? AND id=?').get(memoryId, anchor.receiptId);
    if (!receipt) return denied('missing');
    if (createHash('sha256').update(receipt.excerpt).digest('hex') !== (anchor.receiptDigest ?? anchor.digest)) return denied('identity_mismatch');
    const result = receiptReadSafety(db, { namespace, receipt, memo });
    if (!result.allowed) return result;
  }
  return allowed;
}

function memorySuppression(db, ns, row, boundRevision) {
  // Forget also serves rejection/episode deletion; its old state is not causal proof.
  if (row.deleted) return 'purge';
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='card_effects'").get()) return null;
  const prefix = 'memory-correct-' + row.id + '-';
  // Public action ids cannot establish a generated Memory writer's cause.
  const actions = db.prepare(`SELECT DISTINCT action_id FROM card_effects e WHERE ${where} AND kind='evidence_invalidated'
    AND action_id LIKE ? AND NOT EXISTS(SELECT 1 FROM card_operations o WHERE o.owner_id=e.owner_id
      AND o.scope=e.scope AND o.project_id=e.project_id AND o.action_id=e.action_id)`)
    .all(...boundary(ns), prefix + '%').filter(value =>
      !db.prepare("SELECT 1 FROM sqlite_master WHERE name='raw_deletion_actions'").get() ||
      !db.prepare(`SELECT 1 FROM raw_deletion_actions WHERE ${where} AND action_id=?`).get(...boundary(ns), value.action_id));
  return actions.some(value => value.action_id.startsWith(prefix) && Number(value.action_id.slice(prefix.length)) >= boundRevision)
    ? 'correction_supersession' : null;
}

// S1's only contributor enumeration. S2 replaces this with the durable body set.
export function cardContributorsInside(db, id, memo) {
  if (memo?.contributors.has(id)) return memo.contributors.get(id);
  db = memo?.db ?? db;
  const tables = memo?.bindingTables ?? ['card_bindings', 'card_memory_bindings', 'card_raw_bindings'].filter(table =>
    db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
  if (memo) memo.bindingTables = tables;
  const values = tables.flatMap(table => db.prepare(`SELECT source_ref,position FROM ${table} WHERE card_id=?`).all(id))
    .sort((a, b) => a.position - b.position).map(row => JSON.parse(row.source_ref));
  memo?.contributors.set(id, values);
  return values;
}

/** Canonical only: caller owns authorization and the existing transaction/snapshot.
 * Reasons are internal and must never be serialized or used as public errors. */
export function sourceReadSafety(db, { identity, namespace: ns, ref, strict = false, rawBudget, memo }) {
  if (!ref || !sameNamespace(ns, ref.namespace)) return denied('ineligible');
  try { sourceRef(ref, ns, true); } catch { return denied('identity_mismatch'); }
  db = memo?.db ?? db;
  const key = JSON.stringify(ref), cached = memo?.sources.get(key);
  if (cached) {
    if (!cached.result.allowed) return cached.result;
    if (strict && cached.memory && !memoryReadEligible(cached.memory)) return denied('ineligible');
    if (strict && cached.memory && cached.memory.revision !== ref.memoryRevision) return denied('identity_mismatch');
    return cached.result;
  }
  const remember = (result, value, memory) => { memo?.sources.set(key, { result, value, memory }); return result; };
  if (ref.type === 'receipt') {
    const memoryKey = JSON.stringify([ns, ref.memoryId]);
    const memory = memo?.memories.has(memoryKey) ? memo.memories.get(memoryKey) :
      db.prepare(`SELECT id,revision,deleted,currentness,review_state FROM memories WHERE ${where} AND id=?`).get(...boundary(ns), ref.memoryId);
    memo?.memories.set(memoryKey, memory);
    if (!memory) return denied('missing');
    if (memory.deleted) return denied(memorySuppression(db, ns, memory, ref.memoryRevision));
    const row = db.prepare('SELECT * FROM receipts WHERE memory_id=? AND id=?').get(ref.memoryId, ref.receiptId);
    if (!row) return denied(memorySuppression(db, ns, memory, ref.memoryRevision) ?? 'missing');
    if (bind(identity, 'retained-receipt-content-v1',
      [ns, memory.id, ref.memoryRevision, row.id, row.client, row.session_id, row.event_id, row.role, row.excerpt]) !== ref.contentIdentity)
      return denied('identity_mismatch');
    const lineage = receiptReadSafety(db, { namespace: ns, receipt: row, memo });
    if (!lineage.allowed) return remember(lineage);
    if (strict && !memoryReadEligible(memory)) return denied('ineligible');
    if (strict && memory.revision !== ref.memoryRevision) return denied('identity_mismatch');
    return remember(allowed, { text: row.excerpt, byte_count: Buffer.byteLength(row.excerpt, 'utf8') }, memory);
  }
  if (ref.type === 'submitted-note') {
    const row = db.prepare(`SELECT * FROM card_notes WHERE ${where} AND id=?`).get(...boundary(ns), ref.sourceId);
    if (!row) return denied('missing');
    if (row.state === 'deleted') return denied('purge');
    if (row.state !== 'available') return denied('ineligible');
    if (row.revision !== ref.revision || bind(identity, 'submitted-note-content-v1',
      [ns, row.id, row.revision, row.text]) !== ref.contentIdentity) return denied('identity_mismatch');
    return remember(allowed, row);
  }
  if (ref.type === 'raw') {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='raw_conversations'").get() ||
        !db.prepare(`SELECT 1 FROM raw_conversations c JOIN raw_messages m ON m.conversation_id=c.id
          WHERE c.owner_id=? AND c.scope=? AND c.project_id=? AND c.id=? AND m.message_id=?`)
          .get(...boundary(ns), ref.conversationId, ref.messageId)) {
      const deleted = db.prepare("SELECT 1 FROM sqlite_master WHERE name='raw_deletion_effects'").get() &&
        db.prepare(`SELECT 1 FROM raw_deletion_effects WHERE ${where} AND entity_type='conversation' AND entity_id=? LIMIT 1`).get(...boundary(ns), ref.conversationId);
      return denied(deleted ? 'purge' : 'missing');
    }
    try { return remember(allowed, createCardRawSources(db, identity).resolve(ns, ref, rawBudget)); }
    catch (error) {
      if (error.code === 'source_excluded') return denied('purge');
      if (['source_unavailable', 'raw_crypto_unavailable', 'revision_conflict'].includes(error.code)) return denied('identity_mismatch');
      throw error;
    }
  }
  return denied('ineligible');
}

export function contentReadSafety(db, { identity, namespace: ns, ref, method = 'retrieval', intent = 'current',
  currentCardEligible, rawRows, expectedMemoryIdentity, receipts = [], memo }) {
  db = memo?.db ?? db;
  if (!ref || !sameNamespace(ns, ref.namespace)) return denied('ineligible');
  const type = ref.type;
  if (!['current', 'history'].includes(intent)) return denied('ineligible');
  if (!['memory', 'card'].includes(type)) return denied('ineligible');
  const columns = type === 'memory' ? 'id,revision,deleted,currentness,review_state' + (expectedMemoryIdentity ? ',content,fingerprint' : '') : 'id,revision,state,body_revision';
  const row = db.prepare(`SELECT ${columns} FROM ${type === 'memory' ? 'memories' : 'private_cards'} WHERE ${where} AND id=?`)
    .get(...boundary(ns), ref.memoryId ?? ref.cardId);
  if (!row) return denied('missing');
  if (row.deleted) return denied(memorySuppression(db, ns, row, ref.revision));
  if (['deleted', 'cancelled'].includes(row.state)) return denied('purge');
  if (ref.revision !== row.revision || type === 'card' && ref.bodyRevision !== row.body_revision)
    return denied(type === 'memory' ? memorySuppression(db, ns, row, ref.revision) ?? 'identity_mismatch' : 'identity_mismatch');
  if (type === 'memory' && expectedMemoryIdentity && memoryContentIdentity(row) !== expectedMemoryIdentity) return denied('identity_mismatch');
  const receiptRows = receipts.length ? new Map(db.prepare(`SELECT * FROM receipts WHERE memory_id=?
    AND id IN (${receipts.map(() => '?').join(',')})`).all(row.id, ...receipts.map(receipt => receipt.id)).map(receipt => [receipt.id, receipt])) : new Map();
  for (const receipt of receipts) {
    const current = receiptRows.get(receipt.id);
    if (!current) return denied('missing');
    const lineage = receiptReadSafety(db, { namespace: ns, receipt: current, memo });
    if (!lineage.allowed) return lineage;
    if (JSON.stringify(current) !== JSON.stringify(receipt))
      return denied('identity_mismatch');
  }
  const policy = policies[contentReadPurpose(method, row)];
  if (!policy.admits(row, type, intent, method)) return denied('ineligible');
  if (type === 'card') {
    let contributors;
    try { contributors = cardContributorsInside(db, row.id, memo); }
    catch (error) { if (error instanceof SyntaxError) return denied('identity_mismatch'); throw error; }
    if (!contributors.length) return denied('ineligible');
    const raw = createCardRawSources(db, identity);
    for (const source of contributors) {
      const result = sourceReadSafety(db, { identity, namespace: ns, ref: source,
        strict: Boolean(policy.current?.(intent)), memo, rawBudget: source.type === 'raw' ? raw.budget(64000, rawRows ?? 1024) : undefined });
      if (!result.allowed) return result;
    }
  }
  if (type === 'card' && policy.current?.(intent) && !currentCardEligible?.()) return denied('ineligible');
  return allowed;
}
