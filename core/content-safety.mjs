import { createHash, createHmac } from 'node:crypto';
import { createCardRawSources } from './card-raw-sources.mjs';
import { sourceRef } from './private-card-input.mjs';

const boundary = ns => [ns.ownerId, ns.scope, ns.projectId ?? ''];
const where = 'owner_id=? AND scope=? AND project_id=?';
const sameNamespace = (a, b) => a && b && JSON.stringify(boundary(a)) === JSON.stringify(boundary(b));
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
const policies = {
  retrieval: { admits: (row, type, intent) => type === 'memory' ? memoryReadEligible(row, intent) : row.state === 'confirmed',
    current: intent => intent === 'current' },
  'draft-inspection': { admits: row => row.state === 'draft' },
  'confirmed-review': { admits: row => row.state === 'confirmed' },
};

// S1's only contributor enumeration. S2 replaces this with the durable body set.
export function cardContributorsInside(db, id) {
  const tables = ['card_bindings', 'card_memory_bindings', 'card_raw_bindings'].filter(table =>
    db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
  return tables.flatMap(table => db.prepare(`SELECT source_ref,position FROM ${table} WHERE card_id=?`).all(id))
    .sort((a, b) => a.position - b.position).map(row => JSON.parse(row.source_ref));
}

/** Canonical only: caller owns authorization and the existing transaction/snapshot.
 * Reasons are internal and must never be serialized or used as public errors. */
export function sourceReadSafety(db, { identity, namespace: ns, ref, strict = false, rawBudget }) {
  if (!ref || !sameNamespace(ns, ref.namespace)) return denied('ineligible');
  try { sourceRef(ref, ns, true); } catch { return denied('identity_mismatch'); }
  if (ref.type === 'receipt') {
    const memory = db.prepare(`SELECT id,revision,deleted,currentness,review_state FROM memories WHERE ${where} AND id=?`).get(...boundary(ns), ref.memoryId);
    if (!memory) return denied('missing');
    if (memory.deleted) return denied('user_forget');
    const row = db.prepare('SELECT * FROM receipts WHERE memory_id=? AND id=?').get(ref.memoryId, ref.receiptId);
    if (!row) return denied('missing');
    const source = { client: row.client, sessionId: row.session_id, eventId: row.event_id, role: row.role, excerpt: row.excerpt };
    const key = createHash('sha256').update(JSON.stringify(source)).digest('hex');
    if (key !== row.receipt_key || bind(identity, 'retained-receipt-content-v1',
      [ns, memory.id, ref.memoryRevision, row.id, row.client, row.session_id, row.event_id, row.role, row.excerpt]) !== ref.contentIdentity)
      return denied('identity_mismatch');
    if (strict && !memoryReadEligible(memory)) return denied('ineligible');
    if (strict && memory.revision !== ref.memoryRevision) return denied('identity_mismatch');
    return allowed;
  }
  if (ref.type === 'submitted-note') {
    const row = db.prepare(`SELECT * FROM card_notes WHERE ${where} AND id=?`).get(...boundary(ns), ref.sourceId);
    if (!row) return denied('missing');
    if (row.state === 'deleted') return denied('user_forget');
    if (row.state !== 'available') return denied('ineligible');
    if (row.revision !== ref.revision || bind(identity, 'submitted-note-content-v1',
      [ns, row.id, row.revision, row.text]) !== ref.contentIdentity) return denied('identity_mismatch');
    return allowed;
  }
  if (ref.type === 'raw') {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='raw_conversations'").get() ||
        !db.prepare(`SELECT 1 FROM raw_conversations c JOIN raw_messages m ON m.conversation_id=c.id
          WHERE c.owner_id=? AND c.scope=? AND c.project_id=? AND c.id=? AND m.message_id=?`)
          .get(...boundary(ns), ref.conversationId, ref.messageId)) return denied('missing');
    try { createCardRawSources(db, identity).resolve(ns, ref, rawBudget); return allowed; }
    catch (error) {
      if (error.code === 'source_excluded') return denied('ineligible');
      if (['source_unavailable', 'raw_crypto_unavailable', 'revision_conflict'].includes(error.code)) return denied('identity_mismatch');
      throw error;
    }
  }
  return denied('ineligible');
}

export function contentReadSafety(db, { identity, namespace: ns, ref, method = 'retrieval', intent = 'current',
  currentCardEligible, rawRows, expectedMemoryIdentity, receipts = [] }) {
  if (!ref || !sameNamespace(ns, ref.namespace)) return denied('ineligible');
  const type = ref.type;
  if (!['current', 'history'].includes(intent)) return denied('ineligible');
  if (!['memory', 'card'].includes(type)) return denied('ineligible');
  const columns = type === 'memory' ? 'id,revision,deleted,currentness,review_state' + (expectedMemoryIdentity ? ',content,fingerprint' : '') : 'id,revision,state,body_revision';
  const row = db.prepare(`SELECT ${columns} FROM ${type === 'memory' ? 'memories' : 'private_cards'} WHERE ${where} AND id=?`)
    .get(...boundary(ns), ref.memoryId ?? ref.cardId);
  if (!row) return denied('missing');
  if (row.deleted || row.state === 'deleted') return denied('user_forget');
  if (row.state === 'cancelled') return denied('ineligible');
  if (ref.revision !== row.revision || type === 'card' && ref.bodyRevision !== row.body_revision) return denied('identity_mismatch');
  if (type === 'memory' && expectedMemoryIdentity && memoryContentIdentity(row) !== expectedMemoryIdentity) return denied('identity_mismatch');
  const receiptRows = receipts.length ? new Map(db.prepare(`SELECT * FROM receipts WHERE memory_id=?
    AND id IN (${receipts.map(() => '?').join(',')})`).all(row.id, ...receipts.map(receipt => receipt.id)).map(receipt => [receipt.id, receipt])) : new Map();
  for (const receipt of receipts) {
    const current = receiptRows.get(receipt.id);
    if (!current) return denied('missing');
    const source = { client: current.client, sessionId: current.session_id, eventId: current.event_id, role: current.role, excerpt: current.excerpt };
    if (JSON.stringify(current) !== JSON.stringify(receipt) || createHash('sha256').update(JSON.stringify(source)).digest('hex') !== current.receipt_key)
      return denied('identity_mismatch');
  }
  const policy = policies[contentReadPurpose(method, row)];
  if (!policy.admits(row, type, intent)) return denied('ineligible');
  if (type === 'card') {
    let contributors;
    try { contributors = cardContributorsInside(db, row.id); }
    catch (error) { if (error instanceof SyntaxError) return denied('identity_mismatch'); throw error; }
    if (!contributors.length) return denied('ineligible');
    const raw = createCardRawSources(db, identity);
    for (const source of contributors) {
      const result = sourceReadSafety(db, { identity, namespace: ns, ref: source,
        strict: Boolean(policy.current?.(intent)), rawBudget: source.type === 'raw' ? raw.budget(64000, rawRows ?? 1024) : undefined });
      if (!result.allowed) return result;
    }
  }
  if (type === 'card' && policy.current?.(intent) && !currentCardEligible?.()) return denied('ineligible');
  return allowed;
}
