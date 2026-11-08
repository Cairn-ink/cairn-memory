import { contentSuppressionReasonInside, registerContentSuppressionReadMemoInside, cachedContentSuppressionRequestInside } from './content-suppression-storage.mjs';
import { bindContentSafetyConnection, cachedContentLayout, contentSafetyConnection } from './content-safety-schema.mjs';
import { createHash, createHmac } from 'node:crypto';
import { createCardRawSources } from './card-raw-sources.mjs';
import { createRawLineageStorage } from './raw-lineage-storage.mjs';
import { sourceRef } from './private-card-input.mjs';
import { hasCardLineage, loadCardBodyContributorsInside } from './card-lineage.mjs';

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

// A synchronous decision may validate distinct contributors, but must never
// re-enter the same typed identity through an eligibility/lineage callback.
const activeReadDecisions = new WeakMap();
function withReadDecision(db, key, work) {
  const native = contentSafetyConnection(db), identity = JSON.stringify(key);
  let active = activeReadDecisions.get(native);
  if (!active) { active = new Set(); activeReadDecisions.set(native, active); }
  if (active.has(identity)) throw Object.assign(new Error('content_safety_reentry'), { code: 'storage_error', contentSafetyReentry: true });
  active.add(identity);
  try { return work(); }
  finally { active.delete(identity); if (!active.size) activeReadDecisions.delete(native); }
}

// Explicitly scoped to one synchronous canonical read; never retain across awaits.
export function createContentReadMemo(db) {
  const statements = new Map();
  const read = registerContentSuppressionReadMemoInside(bindContentSafetyConnection({ get isTransaction() { return db.isTransaction; }, prepare(sql) {
    if (!statements.has(sql)) statements.set(sql, db.prepare(sql));
    return statements.get(sql);
  } }, db));
  return { db: read, sources: new Map(), memories: new Map(), receipts: new Map(), contributors: new Map(), lineage: createRawLineageStorage(read, { readMemo: new Map() }) };
}
// Carry the fact stage's ancestry proof in the existing canonical row read.
// This preserves uncertain-origin refusal without a statement per candidate on
// zero-fact Raw-capable cells. Legacy SQL and B3 observation SQL are unchanged.
function rawAncestryColumn(db, table) {
  const layout = cachedContentLayout(db);
  return layout?.suppressionRevision && layout.rawLineage ? `,EXISTS(
    SELECT 1 FROM receipts ar JOIN raw_receipt_lineage al ON al.receipt_id=ar.id
    LEFT JOIN raw_conversations ac ON ac.id=al.conversation_id
    WHERE ar.memory_id=${table}.id AND (ac.owner_id IS NOT ${table}.owner_id
      OR ac.scope IS NOT ${table}.scope OR ac.project_id IS NOT ${table}.project_id)) AS invalid_raw_ancestry` : '';
}
// Canonical S1 receipt validation is also part of a source-ref decision. It
// cannot invoke a serving entry; its memo is distinct from completed decisions.
function canonicalReceiptReadSafety(db, { namespace, receipt, memo, rawTargets = [], rawAncestryEmpty = false }) {
  const key = JSON.stringify([namespace, receipt]);
  const cache = memo && (memo.canonicalReceipts ??= new Map());
  if (cache?.has(key)) { const entry = cache.get(key); rawTargets.push(...entry.rawTargets); return entry.result; }
  const remember = result => { cache?.set(key, { result, rawTargets: [...rawTargets] }); return result; };
  const source = { client: receipt.client, sessionId: receipt.session_id, eventId: receipt.event_id, role: receipt.role, excerpt: receipt.excerpt };
  if (createHash('sha256').update(JSON.stringify(source)).digest('hex') !== receipt.receipt_key) return remember(denied('identity_mismatch'));
  try {
    // Only a canonical row projection may supply this conservative proof:
    // no stored/derived/kept ancestry, possible source session or session fence.
    // Receipt identity was checked above; a possible root retains full S1.
    if (rawAncestryEmpty === true && memo && db.isTransaction) return remember(allowed);
    const lineage = memo?.lineage ?? createRawLineageStorage(db);
    const enabled = memo ? memo.lineageEnabled ??= lineage.enabled() : lineage.enabled();
    if (enabled) lineage.assertStoredReceipts(namespace, [receipt], { readExisting: true, rawTargets });
    return remember(allowed);
  } catch (error) {
    if (['source_excluded', 'conversation_deleted'].includes(error.code)) return remember(denied('purge'));
    if (error.code === 'raw_lineage_unavailable') return remember(denied('ineligible'));
    throw error;
  }
}
export function receiptReadSafety(db, options) {
  return withReadDecision(db, ['receipt', boundary(options.namespace ?? {}), options.receipt?.id], () => {
    const { namespace, receipt, memo } = options;
    const key = JSON.stringify([namespace, receipt]);
    if (memo?.receipts.has(key)) return memo.receipts.get(key);
    const rawTargets = [];
    let result = canonicalReceiptReadSafety(db, { ...options, rawTargets });
    if (result.allowed) {
      const fact = contentSuppressionReasonInside(memo?.db ?? db, namespace, { kind: 'receipt', key: receipt.id, ancestryChecked: true }) ??
        rawSuppression(memo?.db ?? db, namespace, rawTargets);
      if (fact) result = denied(fact);
    }
    memo?.receipts.set(key, result);
    const state = result.allowed ? cachedContentSuppressionRequestInside(db, namespace.ownerId) : null;
    if (state && result.allowed) (state.completed ??= new Set()).add(JSON.stringify([...boundary(namespace),'receipt',receipt.id,null]));
    return result;
  });
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

// Canonical lineage hands off data only. The fact stage never re-enters S1.
function rawSuppression(db, ns, targets) {
  for (const anchor of targets) {
    const fact = contentSuppressionReasonInside(db, ns, { kind: 'raw', key: anchor.conversationId,
      messageId: anchor.messageId, start: anchor.start, end: anchor.end });
    if (fact) return fact;
  }
  return null;
}
function sourceSuppression(db, ns, ref, rawTargets, ancestryChecked) {
  if (ref.type === 'receipt') return contentSuppressionReasonInside(db, ns, { kind: 'memory', key: ref.memoryId, ancestryChecked, revision: ref.memoryRevision, version: JSON.stringify(['memory-revision-v1', ref.memoryRevision]) }) ??
    contentSuppressionReasonInside(db, ns, { kind: 'receipt', key: ref.receiptId, ancestryChecked: true }) ?? rawSuppression(db, ns, rawTargets);
  return contentSuppressionReasonInside(db, ns, { kind: ref.type, key: ref.sourceId ?? ref.conversationId,
    revision: ref.revision, version: ref.type === 'submitted-note' ? JSON.stringify(['note-v1', ref.revision]) : undefined, messageId: ref.messageId, start: ref.span?.start, end: ref.span?.end });
}

/** Canonical only: caller owns authorization and the existing transaction/snapshot.
 * Reasons are internal and must never be serialized or used as public errors. */
export function sourceReadSafety(db, { identity, namespace: ns, ref, strict = false, rawBudget, memo, rawMutableRevision = true }) {
  const decision = ref?.type === 'raw' ? ['raw', boundary(ns ?? {}), ref.conversationId, ref.messageId,
    ref.span?.start, ref.span?.end, ref.span?.precision] :
    [ref?.type, boundary(ns ?? {}), ref?.receiptId ?? ref?.sourceId];
  return withReadDecision(db, decision, () => {
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
    const rawTargets = [];
    const remember = (result, value, memory) => {
      if (result.allowed) { const fact = memory?.invalid_raw_ancestry ? 'ineligible' : sourceSuppression(db, ns, ref, rawTargets, memory && Object.hasOwn(memory, 'invalid_raw_ancestry')); if (fact) result = denied(fact); }
      memo?.sources.set(key, { result, value, memory });
      const state = cachedContentSuppressionRequestInside(db, ns.ownerId);
      if (state && result.allowed) {
        (state.sourcesChecked ??= new Set()).add(key);
        state.sourcesChecked.add(JSON.stringify(sourceRef(ref,ns,true)));
        const completed = state.completed ??= new Set();
        if (ref.type === 'receipt') {
          completed.add(JSON.stringify([...boundary(ns),'memory',ref.memoryId,ref.memoryRevision]));
          completed.add(JSON.stringify([...boundary(ns),'receipt',ref.receiptId,null]));
        } else if (ref.type === 'submitted-note') completed.add(JSON.stringify([...boundary(ns),ref.type,ref.sourceId,ref.revision]));
      }
      return result;
    };
    if (ref.type === 'receipt') {
      const memoryKey = JSON.stringify([ns, ref.memoryId]);
      const memory = memo?.memories.has(memoryKey) ? memo.memories.get(memoryKey) :
        db.prepare(`SELECT id,revision,deleted,currentness,review_state${rawAncestryColumn(db, 'memories')} FROM memories WHERE ${where} AND id=?`).get(...boundary(ns), ref.memoryId);
      memo?.memories.set(memoryKey, memory);
      if (!memory) return denied('missing');
      if (memory.deleted) return denied(memorySuppression(db, ns, memory, ref.memoryRevision));
      const row = db.prepare('SELECT * FROM receipts WHERE memory_id=? AND id=?').get(ref.memoryId, ref.receiptId);
      if (!row) return denied(memorySuppression(db, ns, memory, ref.memoryRevision) ?? 'missing');
      if (bind(identity, 'retained-receipt-content-v1',
        [ns, memory.id, ref.memoryRevision, row.id, row.client, row.session_id, row.event_id, row.role, row.excerpt]) !== ref.contentIdentity)
        return denied('identity_mismatch');
      const lineage = canonicalReceiptReadSafety(db, { namespace: ns, receipt: row, memo, rawTargets });
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
      try { return remember(allowed, createCardRawSources(db, identity, { mutableRevision: rawMutableRevision }).resolve(ns, ref, rawBudget)); }
      catch (error) {
        if (error.code === 'source_excluded') return denied('purge');
        if (['source_unavailable', 'raw_crypto_unavailable', 'revision_conflict'].includes(error.code)) return denied('identity_mismatch');
        throw error;
      }
    }
    return denied('ineligible');
  });
}

function canonicalContentReadSafety(db, { identity, namespace: ns, ref, method = 'retrieval', intent = 'current',
  currentCardEligible, rawRows, expectedMemoryIdentity, receipts = [], memo, factObservation, selectedMemory, selectedReceipts }) {
  db = memo?.db ?? db;
  if (!ref || !sameNamespace(ns, ref.namespace)) return denied('ineligible');
  const type = ref.type;
  if (!['current', 'history'].includes(intent)) return denied('ineligible');
  if (!['memory', 'card'].includes(type)) return denied('ineligible');
  const columns = type === 'memory' ? 'id,revision,deleted,currentness,review_state' + (expectedMemoryIdentity ? ',content,fingerprint' : '') : 'id,revision,state,body_revision';
  const row = type === 'memory' && selectedMemory ? selectedMemory : db.prepare(`SELECT ${columns}${type === 'memory' ? rawAncestryColumn(db, 'memories') : ''} FROM ${type === 'memory' ? 'memories' : 'private_cards'} WHERE ${where} AND id=?`)
    .get(...boundary(ns), ref.memoryId ?? ref.cardId);
  if (!row) return denied('missing');
  if (type === 'memory' && selectedMemory && (row.id !== ref.memoryId || !sameNamespace(ns,{ownerId:row.owner_id,scope:row.scope,projectId:row.project_id}))) return denied('identity_mismatch');
  if (factObservation) { factObservation.ancestryChecked = Object.hasOwn(row, 'invalid_raw_ancestry'); factObservation.invalidAncestry = row.invalid_raw_ancestry; }
  if (row.deleted) return denied(memorySuppression(db, ns, row, ref.revision));
  if (['deleted', 'cancelled'].includes(row.state)) return denied('purge');
  if (ref.revision !== row.revision || type === 'card' && ref.bodyRevision !== row.body_revision)
    return denied(type === 'memory' ? memorySuppression(db, ns, row, ref.revision) ?? 'identity_mismatch' : 'identity_mismatch');
  if (type === 'memory' && expectedMemoryIdentity && memoryContentIdentity(row) !== expectedMemoryIdentity) return denied('identity_mismatch');
  // Only an existing canonical batch SELECT in this synchronous snapshot may
  // supply receipt rows, just as selectedMemory supplies its parent row.
  const receiptRows = receipts.length ? new Map((selectedMemory && memo && db.isTransaction && selectedReceipts ?
    selectedReceipts.filter(receipt=>receipt.memory_id===row.id) : db.prepare(`SELECT * FROM receipts WHERE memory_id=?
    AND id IN (${receipts.map(() => '?').join(',')})`).all(row.id, ...receipts.map(receipt => receipt.id))).map(receipt => [receipt.id, receipt])) : new Map();
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
    if (hasCardLineage(db)) {
      try {
        const lineage = loadCardBodyContributorsInside(db,identity,ns,row.id,{
          current:Boolean(policy.current?.(intent)),
          validateSource:source=>sourceReadSafety(db,{identity,namespace:ns,ref:source,memo}).allowed });
        if (memo) (memo.cardBodies ??= new Map()).set(row.id,lineage);
      } catch (error) {
        if (['source_unavailable','source_excluded','raw_crypto_unavailable','source_budget_exceeded','invalid_input','revision_conflict'].includes(error.code) || error instanceof SyntaxError) return denied('ineligible');
        throw error;
      }
      if (factObservation) factObservation.ancestryChecked = true;
    } else {
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
    // Every contributor has already completed the canonical source decision
    // and its fact stage in this snapshot. The Card fact stage needs only its
    // own identity; repeating contributor SQL would revalidate the same proof.
    if (factObservation) factObservation.ancestryChecked = true;
    }
  }
  if (type === 'card' && policy.current?.(intent) && !currentCardEligible?.()) return denied('ineligible');
  return allowed;
}

/** The Memory/Card entry owns one canonical decision followed by one fact check.
 * The memo belongs to one synchronous read snapshot, including denied decisions. */
export function contentReadSafety(db, options) {
  return withReadDecision(db, [options.ref?.type, boundary(options.namespace ?? {}), options.ref?.memoryId ?? options.ref?.cardId], () => {
    const { namespace, ref, memo } = options;
    let policy = 0;
    if (memo && typeof options.currentCardEligible === 'function') {
      const callbacks = memo.policyCallbacks ??= new WeakMap();
      if (!callbacks.has(options.currentCardEligible)) callbacks.set(options.currentCardEligible, memo.nextPolicy = (memo.nextPolicy ?? 0) + 1);
      policy = callbacks.get(options.currentCardEligible);
    }
    const key = JSON.stringify([namespace, ref, options.method, options.intent,
      options.rawRows, options.expectedMemoryIdentity, options.receipts, policy]);
    const decisions = memo && (memo.decisions ??= new Map());
    if (decisions?.has(key)) return decisions.get(key);
    const factObservation = {};
    let result = canonicalContentReadSafety(db, { ...options, factObservation });
    if (result.allowed) {
      const fact = factObservation.invalidAncestry ? 'ineligible' : contentSuppressionReasonInside(memo?.db ?? db, namespace, { kind: ref.type, ancestryChecked: factObservation.ancestryChecked,
        key: ref.memoryId ?? ref.cardId, revision: ref.revision,
        version: ref.type === 'memory' ? JSON.stringify(['memory-revision-v1', ref.revision]) : undefined });
      if (fact) result = denied(fact);
    }
    decisions?.set(key, result);
    const state = result.allowed ? cachedContentSuppressionRequestInside(db, namespace.ownerId) : null;
    if (state && result.allowed && memo?.retainOutputDecisions !== false) (state.completed ??= new Set()).add(JSON.stringify([
      ...boundary(namespace), ref.type, ref.memoryId ?? ref.cardId, ref.revision]));
    return result;
  });
}
