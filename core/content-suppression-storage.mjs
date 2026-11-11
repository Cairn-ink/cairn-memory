import { purgeUnreadableMemoryRelations } from './memory-relations-erasure.mjs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { bindContentSafetyConnection, cachedContentLayout, contentSafetyConnection, contentSafetyBudgetError, installedContentLayout, withContentSafetyLayoutInside } from './content-safety-schema.mjs';
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
  const relationLayout=cachedContentLayout(db);
  if(!installing && relationLayout?.relationsRevision && ['owner','namespace','memory','receipt','raw'].includes(kind)){
    purgeUnreadableMemoryRelations(db,ns,matchMode==='owner');
  }
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

// Internal traversal fence: facts can advance without any canonical tombstone
// or namespace epoch. Cached content must retain and compare this binding.
// Canonical monotone hi:lo fence: every fact insert advances it. Cleanup does
// not advance it, because every cleanup state denies. Legacy cells return null.
export function contentSuppressionFenceInside(db, ownerId) {
  if (!installedContentLayout(db).suppressionRevision) return null;
  const row = db.prepare('SELECT epoch_hi,epoch_lo FROM owner_suppression_epochs WHERE owner_id=?').get(ownerId);
  return row ? `${row.epoch_hi}:${row.epoch_lo}` : '0:0';
}

// Mutation acknowledgement validation observes canonical post-state while
// considering only facts that preceded this operation. Normal serving and B3
// observations use the unbounded enumerator unchanged.
const factCeilings = new AsyncLocalStorage();
export function withContentSuppressionCeilingsInside(db, ceilings, work, terminalAncestors) {
  return factCeilings.run({native:contentSafetyConnection(db),ceilings,terminalAncestors},work);
}
function aboveFactCeiling(db, ns, fact) {
  const context=factCeilings.getStore();
  return context?.native===contentSafetyConnection(db) && context.ceilings.has(ns.ownerId) &&
    (suppressionEpoch(fact)>context.ceilings.get(ns.ownerId)||context.terminalAncestors?.has(fact.fact_id));
}
const requestFacts = new AsyncLocalStorage();
const requestAccount = new AsyncLocalStorage();
const readMemoFacts = new WeakMap();
const servingWrites = new AsyncLocalStorage();
export const withoutContentSuppressionReadCacheInside = (db, work) => servingWrites.run(contentSafetyConnection(db), work);
export function registerContentSuppressionReadMemoInside(reader) {
  readMemoFacts.set(reader, new Map());
  return reader;
}
function servingFacts(db, ns) {
  // A host callback can enter a writer while its read request is still alive.
  // Post-state acknowledgements must see the pre-write epoch's complete facts,
  // never that outer request's provisional (possibly empty) read set.
  if (factCeilings.getStore()?.native === contentSafetyConnection(db) || servingWrites.getStore() === contentSafetyConnection(db)) return undefined;
  const snapshot = requestFacts.getStore(), native = contentSafetyConnection(db);
  const request = snapshot?.native === native && snapshot.owner === ns.ownerId ? snapshot : cachedContentSuppressionRequestInside(db, ns.ownerId);
  if (request) return request;
  if (hasContentSuppressionRequestInside(db)) return contentSuppressionRequestInside(db, [ns]);
  const owners = readMemoFacts.get(db);
  if (!owners) return undefined;
  if (!owners.has(ns.ownerId)) owners.set(ns.ownerId, contentSuppressionRequestInside(db, [ns]));
  return owners.get(ns.ownerId);
}

export const withContentSuppressionRequest = (work, { fresh = false } = {}) => requestAccount.getStore() && !fresh
  ? work() : requestAccount.run({ selected: new Map(), facts: new Map(), reads: new Map() }, work);

// An abandoned operation attempt must not seed the next snapshot's denial
// memo. Keep its request account, but load this connection's facts on demand.
export function resetContentSuppressionRequestInside(db) {
  const account=requestAccount.getStore(),native=contentSafetyConnection(db);
  account?.selected.delete(native);account?.facts.delete(native);account?.reads.delete(native);
}

// A serving request may span canonical snapshots. Its denial set is provisional
// until the independent delivery fence agrees. No state survives the request.
export const hasContentSuppressionRequestInside = db => Boolean(requestAccount.getStore()) &&
  (!db || servingWrites.getStore() !== contentSafetyConnection(db));
export const cachedContentSuppressionRequestInside = (db, owner) => {
  if (servingWrites.getStore() === contentSafetyConnection(db)) return undefined;
  const owners = requestAccount.getStore()?.reads.get(contentSafetyConnection(db));
  return owner === undefined ? owners?.values().next().value : owners?.get(owner);
};
const coversNamespace = (state, ns) => state.owner === ns.ownerId && (state.epoch === '0:0' || state.readSet.some(selected =>
  selected.scope === 'owner' || JSON.stringify(boundary(selected)) === JSON.stringify(boundary(ns))));
export function contentSuppressionRequestInside(db, readSet, { refresh = false, defer = false } = {}) {
  const native = contentSafetyConnection(db), account = requestAccount.getStore(), owner = readSet[0].ownerId;
  if (defer && account) {
    const selected = account.selected.get(native) ?? [];
    account.selected.set(native, [...new Map([...selected, ...readSet].map(ns => [JSON.stringify(boundary(ns)), ns])).values()]);
    return;
  }
  let owners = account?.reads.get(native);
  const primary = owners?.get(owner);
  if (primary && !refresh && readSet.every(ns => coversNamespace(primary, ns))) return primary;
  const layout = !refresh && owners?.size ? owners.values().next().value.layout : installedContentLayout(db);
  let epoch = primary && !refresh ? primary.epoch : '0:0';
  if (layout.suppressionRevision && (!primary || refresh)) {
    const row = db.prepare('SELECT epoch_hi,epoch_lo FROM owner_suppression_epochs WHERE owner_id=?').get(owner);
    if (row) epoch = `${row.epoch_hi}:${row.epoch_lo}`;
  }
  let ownerSets = account?.facts.get(native);
  if (!ownerSets) { ownerSets = new Map(); account?.facts.set(native, ownerSets); }
  const scopes = readSet.map(ns => JSON.stringify(boundary(ns))).sort();
  const key = JSON.stringify([owner, epoch, scopes]);
  let facts = ownerSets.get(key);
  if (!ownerSets.has(key)) {
    facts = [];
    if (layout.suppressionRevision && epoch !== '0:0') {
      if (readSet.some(ns => ns.scope === 'owner')) {
        facts = db.prepare(`SELECT * FROM content_suppressions INDEXED BY content_suppression_window
          WHERE owner_id=? ORDER BY epoch_hi,epoch_lo LIMIT 4097`).all(owner);
      } else {
        facts = db.prepare(`SELECT * FROM content_suppressions INDEXED BY content_suppression_target
          WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(?,'owner','','owner','','') LIMIT 4097`).all(owner);
        for (const ns of readSet) {
          if (facts.length > 4096) break;
          facts.push(...db.prepare(`SELECT * FROM content_suppressions INDEXED BY content_suppression_target
            WHERE (owner_id,scope,project_id)=(?,?,?) LIMIT ?`).all(...boundary(ns),4097-facts.length));
        }
      }
      if (facts.length > 4096) facts = null;
    }
    ownerSets.set(key, facts);
  }
  const state = { native, owner, epoch, readSet, layout, facts };
  readMemoFacts.get(db)?.set(owner, state);
  if (!owners) { owners = new Map(); account?.reads.set(native, owners); }
  // New scoped views retain the original delivery epoch. Only metadata-only
  // delivery builders may explicitly refresh after their final authority sample.
  if (!primary || refresh) owners.set(owner, state);
  if (!account?.selected.has(native)) account?.selected.set(native, readSet);
  return state;
}
export function contentSuppressionRequestFenceInside(db, owner) {
  const state = cachedContentSuppressionRequestInside(db, owner);
  return state?.owner === owner ? state.layout.suppressionRevision ? state.epoch : null
    : contentSuppressionFenceInside(db, owner);
}
export function assertContentSuppressionRequestInside(db, readSet) {
  const states = [...new Set(readSet.map(ns => ns.ownerId))].map(owner => cachedContentSuppressionRequestInside(db, owner)).filter(Boolean);
  if (!states.length) return;
  // A fresh header and owner epochs after host callbacks fence every retained decision.
  const layout = installedContentLayout(db);
  for (const state of states) {
    if (layout !== state.layout) fail('evidence_unavailable');
    if (!layout.suppressionRevision) continue;
    const row = db.prepare('SELECT epoch_hi,epoch_lo FROM owner_suppression_epochs WHERE owner_id=?').get(state.owner);
    if ((row ? `${row.epoch_hi}:${row.epoch_lo}` : '0:0') !== state.epoch) fail('evidence_unavailable');
  }
}
export function inContentSuppressionRequestInside(db, work, fallbackReadSet) {
  const native = contentSafetyConnection(db), account = requestAccount.getStore();
  if (requestFacts.getStore()?.native === native) return work();
  const readSet = account?.selected.get(native) ?? fallbackReadSet;
  return readSet ? withContentSuppressionReadInside(db, readSet, () => work()) : work();
}
// One bounded owner set per request and epoch; a larger set uses indexed seeks.
export function withContentSuppressionReadInside(db, readSet, work) {
  const state = cachedContentSuppressionRequestInside(db, readSet[0].ownerId);
  if (state) {
    const view=contentSuppressionRequestInside(db,readSet),invoke=()=>requestFacts.run(view,()=>work(view));
    return db.isTransaction ? withContentSafetyLayoutInside(db,invoke,view.layout) : invoke();
  }
  return withContentSafetyLayoutInside(db, () => {
    const snapshot = contentSuppressionRequestInside(db, readSet);
    return requestFacts.run(snapshot, () => work(snapshot));
  });
}
// This is only a negative fact-set proof. Canonical S1 validation still runs for
// every delivered decision, including Raw lineage on Raw-capable stores.
export function contentSuppressionMayMatchInside(db, ns, target) {
  const state = servingFacts(db, ns);
  if (!state || state.native !== contentSafetyConnection(db) || !coversNamespace(state, ns) || !state.facts) return true;
  return state.facts.some(f => f.owner_id === ns.ownerId && (f.scope === 'owner' ||
    f.scope === ns.scope && f.project_id === (ns.projectId ?? '') &&
    (target.kind === 'card' || f.kind === 'namespace' || f.kind === target.kind && f.stable_key === target.key ||
      state.layout.rawLineage && ['memory','receipt'].includes(target.kind) && f.kind === 'raw')));
}
const ineligibleFact = Object.freeze({ reason: 'ineligible' });
const factColumns = 'fact_id,match_mode,source_version,reason,message_key,span_start,span_end,epoch_hi,epoch_lo';
const noAncestor = ',0 AS ancestry,NULL AS ancestor_owner,NULL AS ancestor_scope,NULL AS ancestor_project,NULL AS message_id,NULL AS start,NULL AS end';

// One matching rule for the serving predicate and the B3 observation. A missing
// bound version or uncertain ancestry is a denial, never a negative observation.
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
// Mutation validation uses the same mode matcher for same-transaction audit exemptions.
export function contentSuppressionTargetMatches(fact, ns, target) {
  return fact.owner_id===ns.ownerId && (fact.scope==='owner'||fact.scope===ns.scope&&fact.project_id===(ns.projectId??'')) &&
    (['owner','namespace'].includes(fact.match_mode)||fact.kind===target.kind&&fact.stable_key===target.key) && factMatch(fact,target)===true;
}
// This batch belongs to one synchronous lexical filter in its existing
// canonical snapshot. Only the SQL row enumeration is shared; S1 and the
// suppression matcher below still decide every candidate independently.
const candidateBatches = new AsyncLocalStorage();
export function withMemoryCandidateBatchInside(db, refs, work) {
  if (!refs.length) return work([]);
  const layout = cachedContentLayout(db);
  const columns = factColumns.split(',');
  const ancestorColumns = ['ancestry','ancestor_owner','ancestor_scope','ancestor_project','message_id','start','end'];
  let facts = `SELECT ${factColumns}${noAncestor} FROM content_suppressions INDEXED BY content_suppression_target
    WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(c.owner_id,'owner','','owner','','')
    UNION ALL SELECT ${factColumns}${noAncestor} FROM content_suppressions INDEXED BY content_suppression_target
    WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(c.owner_id,c.scope,c.project_id,'namespace','','')
    UNION ALL SELECT ${factColumns}${noAncestor} FROM content_suppressions INDEXED BY content_suppression_target
    WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(c.owner_id,c.scope,c.project_id,'memory',c.id,c.id)`;
  if (layout.rawLineage) facts += ` UNION ALL SELECT ${columns.map(column=>'f.'+column).join(',')},1,
    ac.owner_id,ac.scope,ac.project_id,l.message_id,l.start,l.end
    FROM raw_receipt_lineage l JOIN receipts r ON r.id=l.receipt_id
    LEFT JOIN raw_conversations ac ON ac.id=l.conversation_id
    LEFT JOIN content_suppressions f INDEXED BY content_suppression_target
      ON (f.owner_id,f.scope,f.project_id,f.kind,f.stable_key,f.incarnation)=(c.owner_id,c.scope,c.project_id,'raw',l.conversation_id,l.conversation_id)
    WHERE r.memory_id=c.id`;
  const ancestry = layout.rawLineage ? `EXISTS(SELECT 1 FROM receipts ar
    JOIN raw_receipt_lineage al ON al.receipt_id=ar.id
    LEFT JOIN raw_conversations ac ON ac.id=al.conversation_id
    WHERE ar.memory_id=m.id AND (ac.owner_id IS NOT m.owner_id
      OR ac.scope IS NOT m.scope OR ac.project_id IS NOT m.project_id))` : '0';
  // One JSON parameter avoids a parameter/chunk limit. Ranked product reads
  // have at most 24 candidates; checkEach can also batch the full posting set.
  const rows = db.prepare(`WITH candidates AS (
    SELECT CAST(key AS INTEGER) position,json_extract(value,'$[0]') owner_id,
      json_extract(value,'$[1]') scope,json_extract(value,'$[2]') project_id,
      json_extract(value,'$[3]') id FROM json_each(?)
    ) SELECT c.position,m.id,m.owner_id,m.scope,m.project_id,m.revision,m.deleted,m.currentness,m.review_state,
      ${ancestry} AS invalid_raw_ancestry,
      (SELECT json_group_array(json_object(${[...columns,...ancestorColumns].map(column=>"'"+column+"',"+column).join(',')}))
        FROM (${facts} ORDER BY ancestry,epoch_hi,epoch_lo,fact_id)) AS suppression_rows
    FROM candidates c LEFT JOIN memories m ON (m.owner_id,m.scope,m.project_id,m.id)=(c.owner_id,c.scope,c.project_id,c.id)
    ORDER BY c.position`).all(JSON.stringify(refs.map(ref=>[...boundary(ref.namespace),ref.memoryId])));
  const byTarget = new Map(rows.map((row,i)=>[JSON.stringify([...boundary(refs[i].namespace),refs[i].memoryId]),JSON.parse(row.suppression_rows)]));
  return candidateBatches.run({native:contentSafetyConnection(db),byTarget},()=>work(rows));
}
function* matchingContentSuppressionsInside(db, ns, target, layout, ordered = false) {
  if (!layout.suppressionRevision) return;
  const { kind, key } = target;
  const memo=ordered ? null : servingFacts(db, ns);
  // B3 always enumerates canonical ancestry. Serving can prove an empty fact
  // intersection only after its S1 decision has checked canonical lineage.
  if (!ordered && memo?.native === contentSafetyConnection(db) && memo.owner === ns.ownerId &&
      memo.facts?.length === 0 && coversNamespace(memo, ns) && (!layout.rawLineage || !['memory','receipt'].includes(kind) || target.ancestryChecked)) return;
  if (!ordered && (!layout.rawLineage || target.ancestryChecked) && !contentSuppressionMayMatchInside(db, ns, target)) return;
  if(memo?.native===contentSafetyConnection(db) && memo.owner===ns.ownerId && memo.readSet.some(n=>JSON.stringify(boundary(n))===JSON.stringify(boundary(ns))) && memo.facts &&
      !(layout.rawLineage && ['memory','receipt'].includes(kind) && (!target.ancestryChecked || memo.facts.some(f=>f.kind==='raw')))) {
    const facts=memo.facts.filter(f=>f.scope==='owner'||f.scope===ns.scope&&f.project_id===(ns.projectId??'')&&
      (f.kind==='namespace'||f.kind===kind&&f.stable_key===(key??'')&&f.incarnation===(key??'')))
      .sort((a,b)=>a.epoch_hi-b.epoch_hi||a.epoch_lo-b.epoch_lo);
    for(const fact of facts){if(!ordered&&aboveFactCeiling(db,ns,fact))continue;const match=factMatch(fact,target);if(match==='ineligible')yield ineligibleFact;else if(match)yield fact;}
    return;
  }
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
  const batch = !ordered && kind === 'memory' ? candidateBatches.getStore() : null;
  const batched = batch?.native === contentSafetyConnection(db) ? batch.byTarget.get(JSON.stringify([...boundary(ns),key])) : undefined;
  const statement = batched === undefined ? db.prepare(sql) : null;
  const rows = batched ?? (typeof statement.iterate === 'function' ? statement.iterate(...values) : statement.all(...values));
  for (const fact of rows) {
    if (fact.ancestry && (fact.ancestor_owner !== ns.ownerId || fact.ancestor_scope !== ns.scope || fact.ancestor_project !== (ns.projectId ?? ''))) {
      yield ineligibleFact; continue;
    }
    if (fact.fact_id === null || !ordered && aboveFactCeiling(db,ns,fact)) continue;
    const match = factMatch(fact, fact.ancestry ? { kind:'raw',messageId:fact.message_id,start:fact.start,end:fact.end } : target);
    if (match === 'ineligible') yield ineligibleFact;
    else if (match) yield fact;
  }
}
export function contentSuppressionReasonInside(db, ns, target = {}) {
  if (!(cachedContentLayout(db) ?? installedContentLayout(db)).suppressionRevision) return null;
  const state = servingFacts(db, ns);
  const layout = state?.native === contentSafetyConnection(db) ? state.layout : cachedContentLayout(db) ?? installedContentLayout(db);
  if (!layout.suppressionRevision) return null;
  for (const fact of matchingContentSuppressionsInside(db,ns,target,state?.native === contentSafetyConnection(db) ? layout : installedContentLayout(db))) return fact.reason;
  return null;
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
