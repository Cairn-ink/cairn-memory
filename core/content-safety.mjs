import { receiptDenialTokens, receiptCoordinateStateInside } from './raw-source-roots.mjs';
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

// Delivery projections below never participate in canonical validation.
export { receiptDenialTokens } from './raw-source-roots.mjs';
export function receiptDenialsInside(db, ns, receipts, memo) {
  // A batch may cover several namespaces, but every token retains the full
  // primary-key boundary. The memo belongs only to the caller's snapshot.
  const batches = Array.isArray(ns) ? ns : [{ namespace: ns, receipts }];
  const cache = memo ? memo.receiptDenials ??= new Map() : new Map();
  const key = (namespace, token) => JSON.stringify([...boundary(namespace), token]);
  const missing = new Map();
  for (const batch of batches) for (const token of receiptDenialTokens(batch.receipts)) {
    const id = key(batch.namespace, token);
    if (!cache.has(id)) missing.set(id, [...boundary(batch.namespace), token]);
  }
  if (missing.size) {
    if (batches.length === 1) {
      const namespace = batches[0].namespace;
      const rows = db.prepare(`SELECT s.fingerprint,1 AS denied FROM json_each(?) w CROSS JOIN suppressed s
WHERE s.owner_id=? AND s.scope=? AND s.project_id=? AND s.fingerprint=w.value`)
        .all(JSON.stringify([...missing.values()].map(value => value[3])), ...boundary(namespace));
      for (const id of missing.keys()) cache.set(id, false);
      for (const row of rows) cache.set(key(namespace, row.fingerprint), true);
    } else {
      const rows = db.prepare(`SELECT s.owner_id,s.scope,s.project_id,s.fingerprint FROM json_each(?) w CROSS JOIN suppressed s
WHERE s.owner_id=json_extract(w.value,'$[0]') AND s.scope=json_extract(w.value,'$[1]')
AND s.project_id=json_extract(w.value,'$[2]') AND s.fingerprint=json_extract(w.value,'$[3]')`)
        .all(JSON.stringify([...missing.values()]));
      for (const id of missing.keys()) cache.set(id, false);
      for (const row of rows) cache.set(JSON.stringify([row.owner_id, row.scope, row.project_id, row.fingerprint]), true);
    }
  }
  return new Set(batches.flatMap(batch => batch.receipts.filter(receipt =>
    receiptDenialTokens([receipt]).some(token => cache.get(key(batch.namespace, token)))).map(receipt => receipt.receipt_key)));
}

// Token-only collection is bounded by the selected Card ids. CROSS JOIN keeps
// each step on its id index even without planner statistics.
export function cardReceiptTokens(db, ns, ids, memo) {
  if (!ids.length) return [];
  const cache = memo ? memo.deliveryCardTokens ??= new Map() : new Map();
  const key = id => JSON.stringify([...boundary(ns), id]);
  const missing = [...new Set(ids)].filter(id => !cache.has(key(id)));
  if (!missing.length) return ids.flatMap(id => cache.get(key(id)));
  // Retain each Card's token rows, including an empty set, in this read memo.
  // Later per-Card delivery checks reuse the snapshot's bounded collection.
  const lineage = hasCardLineage(db) ? ` UNION
    SELECT c.id AS card_id,r.receipt_key,r.client,r.session_id,r.event_id,r.role
    FROM json_each(?) wanted CROSS JOIN private_cards c ON c.id=wanted.value
    CROSS JOIN card_body_sources s ON s.card_id=c.id AND s.body_revision=c.body_revision
      AND s.owner_id=c.owner_id AND s.scope=c.scope AND s.project_id=c.project_id AND s.source_kind='receipt'
    CROSS JOIN receipts r ON r.id=s.source_key CROSS JOIN memories m ON m.id=r.memory_id
    WHERE c.owner_id=? AND c.scope=? AND c.project_id=?
      AND m.owner_id=c.owner_id AND m.scope=c.scope AND m.project_id=c.project_id` : '';
  const selected = JSON.stringify(missing);
  const rows = db.prepare(`SELECT c.id AS card_id,r.receipt_key,r.client,r.session_id,r.event_id,r.role
    FROM json_each(?) wanted CROSS JOIN private_cards c ON c.id=wanted.value
    CROSS JOIN card_memory_bindings b ON b.card_id=c.id CROSS JOIN receipts r ON r.id=b.receipt_id
    CROSS JOIN memories m ON m.id=r.memory_id AND m.id=b.memory_id
    WHERE c.owner_id=? AND c.scope=? AND c.project_id=?
      AND m.owner_id=c.owner_id AND m.scope=c.scope AND m.project_id=c.project_id${lineage}`)
    .all(selected, ...boundary(ns), ...(lineage ? [selected, ...boundary(ns)] : []));
  for (const id of missing) cache.set(key(id), []);
  for (const { card_id, ...row } of rows) cache.get(key(card_id)).push(row);
  return ids.flatMap(id => cache.get(key(id)));
}
export function cardDeliverable(db, ns, id, memo) {
  const cache = memo && (memo.deliveryCardTokens ??= new Map());
  const key = JSON.stringify([...boundary(ns), id]);
  let rows = cache?.get(key);
  if (!rows) {
    rows = cardReceiptTokens(db, ns, [id], memo);
    cache?.set(key, rows);
  }
  return receiptDenialsInside(db, ns, rows, memo).size === 0;
}
export function anchorsDeliverable(db, ns, memoryId, anchors, memo) {
  const rows = anchors.map(anchor => db.prepare('SELECT receipt_key,client,session_id,event_id,role FROM receipts WHERE memory_id=? AND id=?')
    .get(memoryId, anchor.receiptId)).filter(Boolean);
  return receiptDenialsInside(db, ns, rows, memo).size === 0;
}

// Cache only counts and key coordinates, never delivery decisions. Both native
// counters invalidate on local writes or a
// commit from another connection. Recall freshness continues using its base
// Memory/namespace proof. Rollback explicitly clears this cache. Each
// connection retains at most 64 selected Memories.
function receiptCoordinateCache(db, ns, id) {
  const native = contentSafetyConnection(db);
  const version = db.prepare('PRAGMA data_version').get().data_version;
  const changes = db.prepare('SELECT total_changes() AS n FROM store_metadata WHERE singleton=1').get().n;
  const state = receiptCoordinateStateInside(native, version, changes);
  const key = JSON.stringify([...boundary(ns), id]);
  if (!state.memories.has(key)) {
    if (state.memories.size >= 64) state.memories.delete(state.memories.keys().next().value);
    state.memories.set(key, { offsets: new Map() });
  }
  return state.memories.get(key);
}
export function receiptStoredCountInside(db, ns, id) {
  const cached = receiptCoordinateCache(db, ns, id);
  // Keep the prepared statement sequence independent of cache warmth. Only
  // execution is cached; diagnostics must not change the SQL a read prepares.
  const count = db.prepare(`SELECT count(*) AS n FROM receipts r INDEXED BY memory_receipts
    CROSS JOIN memories m ON m.id=r.memory_id WHERE r.memory_id=? AND m.owner_id=? AND m.scope=? AND m.project_id=?`);
  return cached.total ??= count.get(id, ...boundary(ns)).n;
}

// Headers are read in bounded keyset chunks; text is fetched only after the
// shared marker decision. Every pass advances each unfinished Memory's key.
export function receiptDeliverySnapshot(db, entries, memo = createContentReadMemo(db), additional = [], options = {}) {
  const cache = memo.deliveryHeaders ??= new Map(), states = memo.deliveryMemoryStates ??= new Map();
  // Deduplicate and discard cached identities before any count/offset/anchor SQL.
  const pending = new Map();
  for (const entry of entries) {
    const key = JSON.stringify([...boundary(entry.namespace), entry.memoryId]);
    if (!cache.has(key)) pending.set(key, entry);
  }
  const jobs = [], batches = [...additional];
  for (const [key, entry] of pending) {
    const ns = entry.namespace;
    const coordinates = options.positions === false && options.totals === false ? null : receiptCoordinateCache(db, ns, entry.memoryId);
    let after = options.after ?? coordinates?.offsets.get(options.offset);
    if (!after && options.offset > 0) after = db.prepare(`SELECT r.created_at AS createdAt,r.id FROM receipts r INDEXED BY memory_receipts
      CROSS JOIN memories m ON m.id=r.memory_id WHERE r.memory_id=? AND m.owner_id=? AND m.scope=? AND m.project_id=?
      ORDER BY r.created_at,r.id LIMIT 1 OFFSET ?`).get(entry.memoryId, ...boundary(ns), options.offset - 1);
    const total = options.totals === false ? null : coordinates.total;
    const job = { key, namespace: ns, id: entry.memoryId, owner: ns.ownerId, scope: ns.scope, project: ns.projectId ?? '',
      limit: options.limit ?? 101, afterTime: after?.createdAt ?? '', afterId: after?.id ?? '',
      position: options.offset ?? 0, recent: Boolean(options.recent), idOrder: Boolean(options.idOrder), total };
    jobs.push(job);
    job.coordinates = coordinates;
    if (options.includeRecent) jobs.push({ ...job, key: key + ':recent', recent: true, afterTime: '', afterId: '', position: 0 });
  }
  // Prepare on warm and cold reads alike; execute only for missing totals.
  // The recent-order job shares the same physical total and coordinates.
  if (jobs.some(job => job.total !== null)) {
    const count = db.prepare(`SELECT j.value AS input,(SELECT count(*) FROM receipts r INDEXED BY memory_receipts
      CROSS JOIN memories m ON m.id=r.memory_id WHERE r.memory_id=json_extract(j.value,'$.id')
        AND m.owner_id=json_extract(j.value,'$.owner') AND m.scope=json_extract(j.value,'$.scope')
        AND m.project_id=json_extract(j.value,'$.project')) AS n FROM json_each(?) j`);
    const counted = jobs.filter(job => pending.has(job.key) && job.total === undefined);
    if (counted.length) {
      const rows = count.all(JSON.stringify(counted.map(({ key, id, owner, scope, project }) => ({ key, id, owner, scope, project }))));
      const totals = new Map(rows.map(row => [JSON.parse(row.input).key, row.n]));
      for (const job of counted) job.coordinates.total = totals.get(job.key);
      for (const job of jobs) if (job.total === undefined) job.total = job.coordinates.total;
    }
  }
  if (pending.size) {
    // Both anchor kinds start at the same deduplicated, namespace-bound job
    // list. The extra recent-order job never collects the anchors again.
    const inputs = [...pending].map(([key, entry]) => ({ key, id: entry.memoryId,
      owner: entry.namespace.ownerId, scope: entry.namespace.scope, project: entry.namespace.projectId ?? '' }));
    const selected = JSON.stringify(inputs);
    const anchors = db.prepare(`SELECT j.value AS input,q.memory_id,r.receipt_key,r.client,r.session_id,r.event_id,r.role
      FROM json_each(?) j CROSS JOIN qualification_anchors q ON q.memory_id=json_extract(j.value,'$.id')
      CROSS JOIN receipts r ON r.id=q.receipt_id
      CROSS JOIN memories m ON m.id=q.memory_id AND m.id=r.memory_id
      WHERE m.owner_id=json_extract(j.value,'$.owner') AND m.scope=json_extract(j.value,'$.scope')
        AND m.project_id=json_extract(j.value,'$.project') UNION
      SELECT j.value AS input,p.memory_id,r.receipt_key,r.client,r.session_id,r.event_id,r.role
      FROM json_each(?) j CROSS JOIN procedural_tags p ON p.memory_id=json_extract(j.value,'$.id')
      CROSS JOIN json_each(p.anchors) a
      CROSS JOIN receipts r ON r.id=json_extract(a.value,'$.receiptId')
      CROSS JOIN memories m ON m.id=p.memory_id AND m.id=r.memory_id
      WHERE m.owner_id=json_extract(j.value,'$.owner') AND m.scope=json_extract(j.value,'$.scope')
        AND m.project_id=json_extract(j.value,'$.project')`)
      .all(selected, selected);
    const byKey = new Map(inputs.map(input => [input.key, []]));
    for (const { input, memory_id, ...row } of anchors) byKey.get(JSON.parse(input).key).push(row);
    for (const [key, entry] of pending) batches.push({ namespace: entry.namespace, receipts: byKey.get(key) });
  }
  for (const job of jobs) {
    cache.set(job.key, []);
    states.set(job.key, { total: job.total, complete: false, after: options.after, recent: job.recent });
  }
  const uncapped = options.limit === Number.MAX_SAFE_INTEGER, pendingChunks = [];
  let active = jobs;
  do {
    const chunks = [];
    // Direction is engine-owned. Separate index orders avoid a CASE sort that
    // would read the whole Memory before applying its per-chunk bound.
    for (const job of active.filter(job => job.recent && !job.idOrder)) {
      const chunk = Math.min(256, job.limit + 32), headers = [];
      let time = job.afterTime, id = job.afterId;
      while (headers.length < chunk) {
        if (!time) time = db.prepare(`SELECT r.created_at AS time FROM memories m
          CROSS JOIN receipts r INDEXED BY memory_receipts ON r.memory_id=m.id
          WHERE m.id=? AND m.owner_id=? AND m.scope=? AND m.project_id=? AND r.created_at<?
          ORDER BY r.created_at DESC LIMIT 1`).get(job.id, ...boundary(job.namespace), job.beforeTime ?? '\uffff')?.time;
        if (!time) break;
        const page = db.prepare(`SELECT r.id,r.memory_id,r.receipt_key,r.client,r.session_id,r.event_id,r.role,r.created_at
          FROM memories m CROSS JOIN receipts r INDEXED BY memory_receipts ON r.memory_id=m.id
          WHERE m.id=? AND m.owner_id=? AND m.scope=? AND m.project_id=? AND r.created_at=? AND r.id>?
          ORDER BY r.id LIMIT ?`).all(job.id, ...boundary(job.namespace), time, id, chunk - headers.length);
        headers.push(...page);
        if (headers.length === chunk) break;
        job.beforeTime = time; time = ''; id = '';
      }
      chunks.push({ job, headers, ended: headers.length < chunk });
      batches.push({ namespace: job.namespace, receipts: headers });
    }
    for (const direction of ['forward', 'id']) {
      const selected = active.filter(job => (job.idOrder ? 'id' : job.recent ? 'recent' : 'forward') === direction);
      if (!selected.length) continue;
      const index = direction === 'id' ? 'capture_memory_receipts' : 'memory_receipts';
      const order = direction === 'id' ? 'candidate.id' : 'candidate.created_at,candidate.id';
      const keyset = direction === 'id' ? "candidate.id>json_extract(j.value,'$.afterId')" :
        "(candidate.created_at,candidate.id)>(json_extract(j.value,'$.afterTime'),json_extract(j.value,'$.afterId'))";
      // Finite caps read the requested cap plus 32 headers. Uncapped legacy
      // delivery uses 256 headers per pass, with no position/prefix counts.
      const chunk = Math.min(256, (options.limit ?? 101) + 32);
      const inputs = selected.map(({ coordinates, ...job }) => job);
      const rows = db.prepare(`SELECT j.value AS input,r.id,r.memory_id,r.receipt_key,r.client,r.session_id,r.event_id,r.role,r.created_at
        FROM json_each(?) j CROSS JOIN memories m ON m.id=json_extract(j.value,'$.id')
        CROSS JOIN receipts r INDEXED BY sqlite_autoindex_receipts_1 ON r.id IN (SELECT candidate.id FROM receipts candidate INDEXED BY ${index}
          WHERE candidate.memory_id=m.id AND ${keyset} ORDER BY ${order} LIMIT ?)
        WHERE m.owner_id=json_extract(j.value,'$.owner') AND m.scope=json_extract(j.value,'$.scope')
          AND m.project_id=json_extract(j.value,'$.project') AND r.memory_id=m.id`).all(JSON.stringify(inputs), chunk);
      const byKey = new Map(selected.map(job => [job.key, []]));
      for (const { input, ...row } of rows) byKey.get(JSON.parse(input).key).push(row);
      for (let i = 0; i < selected.length; i++) {
        const job = selected[i], headers = byKey.get(job.key);
        headers.sort(direction === 'id' ? (a,b) => a.id.localeCompare(b.id) :
          (a,b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
        chunks.push({ job, headers, ended: headers.length < chunk });
        batches.push({ namespace: job.namespace, receipts: headers });
      }
    }
    // Legacy delivery consumes the whole selected receipt set. Collect its
    // bounded header chunks first, then resolve their union once, even when a
    // Memory has more than one chunk. Its output already requires O(N) space.
    if (uncapped) {
      pendingChunks.push(...chunks);
      active = [];
      for (const { job, headers, ended } of chunks) {
        const last = headers.at(-1);
        if (last) { job.afterTime = last.created_at; job.afterId = last.id; }
        if (!ended) active.push(job);
      }
      if (active.length) continue;
      chunks.length = 0; chunks.push(...pendingChunks);
    }
    // The first chunks of every selected Memory, both orders, Card contributors
    // and anchors share one batched lookup. Refills share one lookup per pass.
    receiptDenialsInside(db, batches, undefined, memo);
    batches.length = 0;
    const next = [];
    for (const { job, headers, ended } of chunks) {
      const delivered = cache.get(job.key), denied = receiptDenialsInside(db, job.namespace, headers, memo);
      for (const header of headers) {
        job.position++;
        if (!denied.has(header.receipt_key) && delivered.length < job.limit) {
          delivered.push({ ...header, position: options.positions === false ? 0 : job.position });
          if (job.coordinates && !job.recent && !job.idOrder && options.positions !== false) {
            const offsets = job.coordinates.offsets;
            if (offsets.size >= 256) offsets.delete(offsets.keys().next().value);
            offsets.set(job.position, { createdAt: header.created_at, id: header.id });
          }
        }
      }
      const last = headers.at(-1);
      if (last) { job.afterTime = last.created_at; job.afterId = last.id; }
      const state = states.get(job.key);
      state.complete = ended && delivered.length < job.limit;
      // Evidence readers need no persistent coordinates or count scan. A
      // fully consumed header keyset already gives its exact physical total;
      // an unfinished one retains unknown omitted coverage, as before.
      if (job.total === null && ended) state.total = job.position;
      if (!uncapped && !ended && delivered.length < job.limit) next.push(job);
    }
    active = next;
    // At most ceil(N/32)+1 passes for N headers in any selected Memory/order;
    // every continuation consumes at least 32 new headers. No prefix recount.
  } while (active.length);
  return memo;
}
export function deliveryReceiptHeaders(db, ns, id, memo) {
  const key=JSON.stringify([...boundary(ns),id]);
  if(!memo.deliveryHeaders?.has(key))receiptDeliverySnapshot(db,[{namespace:ns,memoryId:id}],memo);
  return memo.deliveryHeaders.get(key)??[];
}
export function deliveryReceiptRows(db, ns, id, memo, {limit=101,offset=0,after,recent=false,idOrder=false,cursor=false}={}) {
  let headers=recent&&memo.deliveryHeaders?.has(JSON.stringify([...boundary(ns),id])+':recent')?
    memo.deliveryHeaders.get(JSON.stringify([...boundary(ns),id])+':recent'):deliveryReceiptHeaders(db,ns,id,memo);
  if(recent)headers=[...headers].sort((a,b)=>b.created_at.localeCompare(a.created_at)||a.id.localeCompare(b.id));
  if(idOrder)headers=[...headers].sort((a,b)=>a.id.localeCompare(b.id));
  const selected=headers.filter(row=>(offset===0||row.position>offset)&&(!after||row.created_at>after.createdAt||row.created_at===after.createdAt&&row.id>after.id)).slice(0,limit);
  // The canonical candidate batch already read its first seventeen rows.
  // Reuse those exact rows in this transaction; fetch only identities that a
  // withheld prefix moved beyond that page. No serving proof crosses an await.
  const candidate=memo.evidenceMemories?.get(JSON.stringify([boundary(ns),id]));
  const cached=!cursor&&candidate?JSON.parse(candidate.batch_receipts):[];
  const byId=new Map(cached.map(row=>[row.id,row]));
  const missing=selected.filter(row=>!byId.has(row.id));
  // Selected ids are themselves keyset ordered and capped. Each text read is
  // at most 64 rows and at most cap+1 rows are read for the whole Memory.
  for(let start=0;start<missing.length;start+=64){
    const ids=missing.slice(start,start+64).map(row=>row.id);
    for(const {cursor_row,...row}of db.prepare(`SELECT r.rowid AS cursor_row,r.* FROM json_each(?) wanted
      CROSS JOIN receipts r INDEXED BY sqlite_autoindex_receipts_1 ON r.id=wanted.value WHERE r.memory_id=?`).all(JSON.stringify(ids),id))
      byId.set(row.id,cursor?{cursor_row,...row}:row);
  }
  return selected.map(header=>byId.get(header.id)).filter(Boolean);
}

export function cardDeliverySnapshot(db, refs, memo = createContentReadMemo(db)) {
  const cards=refs.filter(ref=>ref.type==='card'),batches=[];
  const namespaces=new Map(cards.map(ref=>[JSON.stringify(boundary(ref.namespace)),ref.namespace]));
  if(namespaces.size>1){
    // A chunk may span namespaces. Collect its complete boundary tuples in one
    // statement, retaining the same id-first joins as the single-namespace read.
    const cache=memo.deliveryCardTokens??=new Map();
    const wanted=new Map(cards.map(ref=>{const tuple=[...boundary(ref.namespace),ref.cardId];return [JSON.stringify(tuple),tuple];}));
    const missing=[...wanted].filter(([key])=>!cache.has(key));
    if(missing.length){
      const lineage=hasCardLineage(db)?` UNION
        SELECT c.owner_id,c.scope,c.project_id,c.id AS card_id,r.receipt_key,r.client,r.session_id,r.event_id,r.role
        FROM json_each(?) wanted CROSS JOIN private_cards c ON c.id=json_extract(wanted.value,'$[3]')
        CROSS JOIN card_body_sources s ON s.card_id=c.id AND s.body_revision=c.body_revision
          AND s.owner_id=c.owner_id AND s.scope=c.scope AND s.project_id=c.project_id AND s.source_kind='receipt'
        CROSS JOIN receipts r ON r.id=s.source_key CROSS JOIN memories m ON m.id=r.memory_id
        WHERE c.owner_id=json_extract(wanted.value,'$[0]') AND c.scope=json_extract(wanted.value,'$[1]')
          AND c.project_id=json_extract(wanted.value,'$[2]')
          AND m.owner_id=c.owner_id AND m.scope=c.scope AND m.project_id=c.project_id`:'';
      const selected=JSON.stringify(missing.map(([,tuple])=>tuple));
      const rows=db.prepare(`SELECT c.owner_id,c.scope,c.project_id,c.id AS card_id,r.receipt_key,r.client,r.session_id,r.event_id,r.role
        FROM json_each(?) wanted CROSS JOIN private_cards c ON c.id=json_extract(wanted.value,'$[3]')
        CROSS JOIN card_memory_bindings b ON b.card_id=c.id CROSS JOIN receipts r ON r.id=b.receipt_id
        CROSS JOIN memories m ON m.id=r.memory_id AND m.id=b.memory_id
        WHERE c.owner_id=json_extract(wanted.value,'$[0]') AND c.scope=json_extract(wanted.value,'$[1]')
          AND c.project_id=json_extract(wanted.value,'$[2]')
          AND m.owner_id=c.owner_id AND m.scope=c.scope AND m.project_id=c.project_id${lineage}`)
        .all(selected,...(lineage?[selected]:[]));
      for(const [key]of missing)cache.set(key,[]);
      for(const {owner_id,scope,project_id,card_id,...row}of rows)cache.get(JSON.stringify([owner_id,scope,project_id,card_id])).push(row);
    }
  }
  for(const ns of namespaces.values()){
    const ids=cards.filter(ref=>JSON.stringify(boundary(ref.namespace))===JSON.stringify(boundary(ns))).map(ref=>ref.cardId);
    batches.push({namespace:ns,receipts:cardReceiptTokens(db,ns,ids,memo)});
  }
  return receiptDeliverySnapshot(db,[],memo,batches);
}
