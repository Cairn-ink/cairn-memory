import { createHash, createHmac } from 'node:crypto';
import { validateContextProductLayout } from './context-product-schema.mjs';
import { createRawSourceRoots } from './raw-source-roots.mjs';
import { createCardRawSources } from './card-raw-sources.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const legacyVersion = row => ['legacy-unresolved-v1', digest(row)];
const revisionVersion = (kind, revision, row) => Number.isSafeInteger(revision) && revision > 0
  ? [kind, revision] : legacyVersion(row);
const boundary = row => [row.owner_id, row.scope, row.project_id];
const sameNamespace = (a, b) => boundary(a).every((value, index) => value === boundary(b)[index]);
const nsFor = row => ({ ownerId: row.owner_id, scope: row.scope, projectId: row.project_id || null });
const grouping = (rows, key) => {
  const map = new Map();
  for (const row of rows) { const id = key(row), list = map.get(id) ?? []; list.push(row); map.set(id, list); }
  return map;
};
const actionKey = row => JSON.stringify([...boundary(row), row.action_id]);
const sqlEffectId = value => typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);
const apiEffectId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const cardTargetStates = { createCardDraft: 'draft', editCardDraft: 'draft', confirmCardDraft: 'confirmed',
  cancelCardDraft: 'cancelled', editKnowledgeCard: 'confirmed', deleteKnowledgeCard: 'deleted' };
// Body-target results have fixed engine semantics. Project them once; never
// recursively interpret result fields or an organization action/target id.
function cardHistory(operation) {
  const result = operation.parsed, revision = result.revision, bodyRevision = result.bodyRevision;
  if (!Object.hasOwn(cardTargetStates, operation.method) || result.id !== operation.target_id ||
      result.state !== cardTargetStates[operation.method] || !Number.isSafeInteger(revision) || revision < 1 ||
      !(bodyRevision === null || Number.isSafeInteger(bodyRevision) && bodyRevision > 0) ||
      result.effectCount !== (['editCardDraft', 'editKnowledgeCard', 'cancelCardDraft', 'deleteKnowledgeCard'].includes(operation.method) ? 1 : 0)) return null;
  return { revision, bodyRevision };
}

// A read-only, budgeted facade also bounds the existing ancestry helpers' reads.
// No live cursor escapes; even .all is iterated/charged before materialization.
function boundedReader(db, limits, check) {
  let rows = 0, bytes = 0, queries = 0;
  const statements = new Map(), results = new Map();
  const charge = value => {
    check();
    if (++rows > limits.scanRows || (bytes += Buffer.byteLength(JSON.stringify(value))) > limits.scanBytes) throw Error();
    return value;
  };
  return { charge, usage: () => ({ scanRows: rows, scanBytes: bytes, preparedStatements: statements.size, queries }), prepare(sql) {
    check();
    if (!/^\s*(SELECT|PRAGMA)\b/i.test(sql)) throw Error();
    if (statements.has(sql)) return statements.get(sql);
    const statement = db.prepare(sql);
    const read = (method, args) => {
      check();
      const key = JSON.stringify([sql, method, args]);
      if (!results.has(key)) {
        // Empty lookups consume cache space too; bound their materialization.
        if ((bytes += Buffer.byteLength(key)) > limits.scanBytes) throw Error();
        queries++;
        if (method === 'get') {
          const row = statement.get(...args); results.set(key, row === undefined ? row : charge(row));
        } else {
          const values = [];
          for (const row of statement.iterate(...args)) values.push(charge(row));
          results.set(key, values);
        }
      }
      check();
      const result = results.get(key);
      return method === 'all' ? result.slice() : result;
    };
    const prepared = { get: (...args) => read('get', args), all: (...args) => read('all', args) };
    statements.set(sql, prepared);
    return prepared;
  } };
}

/** Internal synchronous adapter. Caller owns ONE read transaction and query_only.
 * These layouts retain no historical title/body rows: card_operations contains
 * result receipts, not body payloads. Any future historical provider needs an
 * explicit layout/observation adapter; unknown physical cells never fall back.
 */
export function contentSafetyObservations(native, limits, check) {
  const db = boundedReader(native, limits, check);
  const schemaBase = db.prepare('PRAGMA user_version').get().user_version;
  if (![18, 23, 33].includes(schemaBase) || db.prepare('PRAGMA application_id').get().application_id !== 0x43414952) throw Error();
  const objects = db.prepare('SELECT name,tbl_name FROM sqlite_schema').all();
  const safety = /^(?:content_safety_|content_identity_|content_suppression|owner_suppression_|card_body_|safety_|card_operations_owner_action$)/i;
  if (objects.some(row => safety.test(row.name) || safety.test(row.tbl_name))) throw Error();
  validateContextProductLayout(db);
  const identities = db.prepare('SELECT store_id,cursor_secret FROM store_metadata WHERE singleton=1').all();
  if (identities.length !== 1 || !identities[0].store_id || !/^[0-9a-f]{64}$/.test(identities[0].cursor_secret)) throw Error();
  const { store_id: storeId, cursor_secret: cursorSecret } = identities[0];
  const scan = table => db.prepare(`SELECT * FROM ${table}`).all(); // Names below are internal constants.
  const memories = new Map(scan('memories').map(row => [row.id, row]));
  const receiptRows = scan('receipts'), receipts = new Map(receiptRows.map(row => [row.id, row]));
  const memoryReceipts = grouping(receiptRows, row => row.memory_id);
  scan('suppressed'); // Fingerprints have no identity association by themselves.
  const corrections = grouping(scan('confirmation_supersessions'), row => row.previous_id);
  if (schemaBase === 18) return { schemaBase, observations: [], usage: db.usage() };
  const cards = scan('private_cards'), notes = new Map(scan('card_notes').map(row => [row.id, row]));
  const bindings = grouping(scan('card_bindings'), row => row.card_id);
  const memoryBindings = grouping(scan('card_memory_bindings'), row => row.card_id);
  const operations = scan('card_operations').map(row => ({ ...row, parsed: JSON.parse(row.result) }));
  const effects = scan('card_effects'), cardEffects = grouping(effects.filter(row => row.entity_type === 'card'), row => row.entity_id);
  const actionEffects = grouping(effects, actionKey), actionOperations = grouping(operations, actionKey);
  const cardOperations = grouping(operations.flatMap(operation => {
    check();
    const history = cardHistory(operation);
    return history ? [db.charge({ ...history, owner_id: operation.owner_id, scope: operation.scope,
      project_id: operation.project_id, target_id: operation.target_id })] : [];
  }), row => row.target_id);
  let rawBindings = new Map(), conversations = new Map(), exclusions = new Map(), rawDeletions = new Map();
  let sourceMaps = new Map(), mappedMessages = new Set(), messages = new Map(), fences = new Map();
  let episodeSecret;
  const rawCallerActions = new Set();
  if (schemaBase === 33) {
    rawBindings = grouping(scan('card_raw_bindings'), row => row.card_id);
    conversations = new Map(scan('raw_conversations').map(row => [row.id, row]));
    exclusions = grouping(scan('raw_source_exclusions'), row => JSON.stringify([row.conversation_id, row.message_id]));
    const removed = scan('raw_deletion_effects');
    // A retained Raw writer receipt still owns its action when its operation
    // row or root proof is lost. This is a veto, never contributor evidence.
    for (const row of removed) if (apiEffectId(row.effect_id)) rawCallerActions.add(actionKey(row));
    const deletionKey = row => JSON.stringify([actionKey(row), row.source_type, row.source_id]);
    const rootsDeleted = new Set(removed.filter(row => apiEffectId(row.effect_id) && row.entity_type === row.source_type && row.entity_id === row.source_id).map(deletionKey));
    // These joins stay inside the engine's Raw effect ledger and require its
    // typed root identity. Caller-selected Card action strings are not evidence.
    const verified = removed.filter(row => apiEffectId(row.effect_id) && rootsDeleted.has(deletionKey(row)));
    rawDeletions = grouping(verified.filter(row => row.source_type === 'conversation'), row => row.source_id);
    const maps = scan('raw_source_maps');
    sourceMaps = grouping(maps, row => JSON.stringify([row.conversation_id, row.message_id, row.source_key]));
    mappedMessages = new Set(maps.map(row => JSON.stringify([row.conversation_id, row.message_id])));
    messages = new Map(scan('raw_messages').map(row => [JSON.stringify([row.conversation_id, row.message_id]), row]));
    fences = grouping(scan('raw_session_fences'), row => JSON.stringify([...boundary(row), row.client, row.session_key]));
    episodeSecret = db.prepare('SELECT secret FROM episode_identity WHERE singleton=1').get().secret;
    // Examine every retained canonical source/tombstone provider, including
    // memory-only namespaces, without decrypting Raw text or invoking a writer.
    for (const table of ['raw_receipt_lineage', 'raw_receipt_origins', 'raw_job_sources', 'raw_closed_jobs',
      'episode_keep_actions', 'episode_sources']) scan(table);
    for (const row of scan('raw_deletion_actions')) {
      JSON.parse(row.result);
      // Even a same-key genuine trigger is ambiguous: never authenticate a
      // producer by a caller's string, including across separate ledgers.
      rawCallerActions.add(actionKey(row));
    }
    db.prepare('SELECT conversation_id,message_id,part_index,start,end,saved,digest,length(sealed) AS sealed_length FROM raw_parts').all();
  }
  const roots = schemaBase === 33 ? createRawSourceRoots(db) : null;
  const raw = schemaBase === 33 ? createCardRawSources(db, { storeId, cursorSecret }) : null;
  const ancestry = new Map();
  function receiptAncestry(card, receipt) {
    if (ancestry.has(receipt.id)) return ancestry.get(receipt.id);
    const authority = roots.receipt(nsFor(card), receipt), spans = [];
    const stored = db.prepare('SELECT * FROM raw_receipt_lineage WHERE receipt_id=?').all(receipt.id);
    for (const entry of stored) spans.push({ ref: { conversationId: entry.conversation_id, messageId: entry.message_id,
      span: { start: entry.start, end: entry.end, precision: entry.precision } }, origin: 'raw_receipt_lineage', row: entry });
    // Possible keep roots are candidates, never an authenticated contributor.
    const sessions = [...authority.roots];
    // Match assertSession: expand each original identity once, never its aliases.
    if (authority.independent) sessions.push({ client: receipt.client, sessionKey: receipt.session_id });
    if (!stored.length) for (const root of authority.roots) {
      const conversationId = root.conversationId ?? root.conversation_id;
      if (!conversationId) continue;
      const sourceKey = createHmac('sha256', Buffer.from(episodeSecret, 'hex'))
        .update(JSON.stringify(['raw-source-v1', receipt.role, receipt.excerpt])).digest('hex');
      const maps = sourceMaps.get(JSON.stringify([conversationId, receipt.event_id, sourceKey])) ?? [];
      for (const entry of maps) spans.push({ ref: { conversationId, messageId: receipt.event_id,
        span: { start: entry.start, end: entry.end, precision: entry.precision } }, origin: 'raw_source_maps', row: entry });
      const messageKey = JSON.stringify([conversationId, receipt.event_id]), message = messages.get(messageKey);
      if (!maps.length && !mappedMessages.has(messageKey) && message && message.role === receipt.role) {
        spans.push({ ref: { conversationId, messageId: receipt.event_id,
          span: { start: 0, end: message.total_units, precision: 'whole-message' } }, origin: 'receipts', row: receipt });
      }
    }
    const matchedFences = new Map();
    for (const root of sessions) for (const sessionKey of roots.keys(nsFor(card), root.client, root.sessionKey)) {
      for (const fence of fences.get(JSON.stringify([...boundary(card), root.client, sessionKey])) ?? []) matchedFences.set(digest(fence), fence);
    }
    const result = { spans, fences: [...matchedFences.values()] };
    ancestry.set(receipt.id, result);
    return result;
  }
  const identity = (card, kind, key, version) => ({ storeId, ownerId: card.owner_id, scope: card.scope,
    projectId: card.project_id, kind, key, incarnation: key, version: JSON.stringify(version) });
  const evidence = (origin, row) => ({ origin, digest: digest(row) });
  const observations = [];
  for (const card of cards) {
    check();
    if (card.title === null && card.body === null) continue;
    const textBytes = value => {
      if (value === null) return null;
      const bytes = Buffer.from(value);
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (!Buffer.from(text).equals(bytes)) throw Error();
      return bytes.toString('hex');
    };
    // CAST avoids SQLite's lossy TEXT decoding before strict UTF-8 validation.
    const stored = db.prepare('SELECT hex(CAST(title AS BLOB)) AS title,hex(CAST(body AS BLOB)) AS body FROM private_cards WHERE id=?').get(card.id);
    const observation = { version: 1, body: { identity: identity(card, 'card', card.id, ['card-body-v1', card.body_revision]),
      titleUtf8: card.title === null ? null : textBytes(Buffer.from(stored.title, 'hex')),
      bodyUtf8: card.body === null ? null : textBytes(Buffer.from(stored.body, 'hex')) }, edges: [], suppressionFacts: [], coverage: null };
    db.charge(observation.body);
    const seen = new Set(), factsSeen = new Set(), expandedReceipts = new Set();
    function fact(target, reason, origin, row) {
      const value = { target, reason, evidence: evidence(origin, row) }, key = JSON.stringify(value);
      if (!factsSeen.has(key)) { db.charge(key); factsSeen.add(key); observation.suppressionFacts.push(value); }
    }
    function add(kind, key, version, origin, row, state) {
      const id = identity(card, kind, key, version), proof = evidence(origin, row);
      const token = JSON.stringify([id, proof]);
      if (!seen.has(token)) { db.charge(token); seen.add(token); observation.edges.push({ identity: id, evidence: proof, state }); }
      return id;
    }
    function rawEdge(ref, origin, row) {
      const current = conversations.get(ref.conversationId), exists = Boolean(current && sameNamespace(current, card));
      const id = add('raw', ref.conversationId, legacyVersion(ref), origin, row, { exists, source: ref });
      for (const item of rawDeletions.get(ref.conversationId) ?? []) {
        check();
        if (item.source_type === 'conversation' && item.source_id === ref.conversationId && sameNamespace(item, card)) fact(id, 'purge', 'raw_deletion_effects', item);
      }
      if (exists && ref.messageId && ref.span) {
        const values = exclusions.get(JSON.stringify([ref.conversationId, ref.messageId])) ?? [];
        for (const excluded of values) if (excluded.start < ref.span.end && excluded.end > ref.span.start) fact(id, 'purge', 'raw_source_exclusions', excluded);
      }
      // Verification can establish a present binding's current state, never
      // coverage. Unavailable/missing inputs remain plausible canonical edges.
      if (exists && ref.contentIdentity && ref.span && !observation.suppressionFacts.some(item => item.target === id)) {
        try { raw.resolve(nsFor(card), ref); }
        catch (error) { if (!['source_unavailable', 'source_excluded', 'raw_crypto_unavailable'].includes(error.code)) throw error; }
      }
    }
    function memoryEdge(memoryId, boundRevision, receiptId, origin, row) {
      const memory = memories.get(memoryId), exists = Boolean(memory && sameNamespace(memory, card));
      const id = add('memory', memoryId, revisionVersion('memory-revision-v1', boundRevision, row), origin, row,
        { exists, ...(exists ? { revision: memory.revision, deleted: memory.deleted, fingerprint: memory.fingerprint } : {}) });
      // Legacy deleted=1 does not distinguish explicit forget from nested purge/reject.
      if (exists && memory.deleted === 1) fact(id, 'purge', 'memories', memory);
      if (receiptId) {
        const receipt = receipts.get(receiptId), kept = Boolean(receipt && receipt.memory_id === memoryId && exists);
        add('receipt', receiptId, legacyVersion(row), origin, row, { exists: kept, memoryId, boundRevision: boundRevision ?? null });
        // raw_deletion_effects retains the affected Memory id, but neither its
        // retired revision nor the removed receipt ids. It cannot attribute a
        // later missing receipt to that deletion. Without retained exact Raw
        // ancestry, the missing contributor remains unknown.
        // A newer revision and lost receipts alone also result from Raw erasure.
        // Require retained identity-linked old fingerprint evidence as well.
        if (exists && !kept && memory.revision > boundRevision) for (const old of corrections.get(memoryId) ?? []) {
          const ids = JSON.parse(old.previous_receipt_ids);
          if (!Array.isArray(ids)) throw Error();
          if (old.previous_revision <= boundRevision && ids.includes(receiptId) && old.previous_fingerprint !== memory.fingerprint) {
            fact(id, 'correction_supersession', 'confirmation_supersessions', old);
          }
        }
        if (kept && row?.contentIdentity) {
          const ns = nsFor(card), refDigest = createHmac('sha256', cursorSecret).update(JSON.stringify(['retained-receipt-content-v1',
            [storeId, [ns, memoryId, boundRevision, receipt.id, receipt.client, receipt.session_id, receipt.event_id, receipt.role, receipt.excerpt]]])).digest('base64url');
          // A mismatch cannot erase the positive edge or manufacture a denial.
          if (refDigest !== row.contentIdentity) {
            const edge = observation.edges.find(item => item.identity.kind === 'receipt' && item.identity.key === receiptId);
            edge.state.commitment = 'mismatch';
          }
        }
      }
      // Presentation selection does not narrow the source set of a proven
      // current Memory version. A later revision cannot supply that proof.
      const selectedReceipts = exists && memory.revision === boundRevision ? memoryReceipts.get(memoryId) ?? []
        : receiptId ? [receipts.get(receiptId)].filter(row => row?.memory_id === memoryId) : [];
      if (exists && roots) for (const receipt of selectedReceipts) {
        if (expandedReceipts.has(receipt.id)) continue;
        expandedReceipts.add(receipt.id);
        const lineage = receiptAncestry(card, receipt);
        for (const span of lineage.spans) rawEdge(span.ref, span.origin, span.row);
        for (const fence of lineage.fences) fact(id, 'purge', 'raw_session_fences', fence);
      }
      return id;
    }
    function noteEdge(key, revision, origin, row) {
      const note = notes.get(key), exists = Boolean(note && sameNamespace(note, card));
      const id = add('submitted-note', key, revisionVersion('note-v1', revision, row), origin, row,
        { exists, ...(exists ? { revision: note.revision, state: note.state } : {}) });
      if (exists && note.state === 'deleted') fact(id, 'purge', 'card_notes', note);
      return id;
    }
    function bindingRef(row, type) {
      const ref = JSON.parse(row.source_ref), ns = ref?.namespace;
      if (ref?.type !== type || !ns || ns.ownerId !== card.owner_id || ns.scope !== card.scope ||
          (ns.projectId ?? '') !== card.project_id) throw Error();
      if (type === 'receipt' && (ref.memoryId !== row.memory_id || ref.memoryRevision !== row.memory_revision ||
          ref.receiptId !== row.receipt_id)) throw Error();
      if (type === 'submitted-note' && (ref.sourceId !== row.source_id || !Number.isSafeInteger(ref.revision) || ref.revision < 1)) throw Error();
      if (type === 'raw' && (ref.conversationId !== row.conversation_id || ref.messageId !== row.message_id ||
          ref.span?.start !== row.start || ref.span?.end !== row.end)) throw Error();
      return ref;
    }
    for (const row of bindings.get(card.id) ?? []) {
      const ref = bindingRef(row, 'submitted-note'); noteEdge(ref.sourceId, ref.revision, 'card_bindings', row);
    }
    for (const row of memoryBindings.get(card.id) ?? []) {
      const ref = bindingRef(row, 'receipt'); memoryEdge(ref.memoryId, ref.memoryRevision, ref.receiptId, 'card_memory_bindings', ref);
    }
    for (const row of rawBindings.get(card.id) ?? []) rawEdge(bindingRef(row, 'raw'), 'card_raw_bindings', row);
    // Index body history once, then merge monotonically with effect revisions.
    const history = (cardOperations.get(card.id) ?? []).filter(row => sameNamespace(row, card))
      .sort((a, b) => a.revision - b.revision);
    let historyPosition = 0, atBody;
    const orderedEffects = (cardEffects.get(card.id) ?? []).slice().sort((a, b) => a.revision - b.revision || a.ordinal - b.ordinal);
    for (const effect of orderedEffects) {
      check();
      db.charge(effect.ordinal);
      if (!sameNamespace(effect, card) || effect.kind !== 'evidence_invalidated' ||
          !Number.isSafeInteger(effect.revision) || effect.revision < 1 || effect.revision > card.revision || !Number.isSafeInteger(effect.ordinal) || effect.ordinal < 1) continue;
      while (historyPosition < history.length && history[historyPosition].revision < effect.revision) {
        check(); atBody = history[historyPosition++];
      }
      if (atBody?.bodyRevision !== card.body_revision) continue;
      const revisionEffect = /^memory-revision-(.+)-([1-9][0-9]*)$/.exec(effect.action_id);
      if (revisionEffect && sqlEffectId(effect.effect_id) && !rawCallerActions.has(actionKey(effect))) {
        const memory = memories.get(revisionEffect[1]), revision = Number(revisionEffect[2]);
        if (memory && sameNamespace(memory, card) && Number.isSafeInteger(revision) && revision > 1 && memory.revision >= revision) {
          memoryEdge(memory.id, revision - 1, null, 'card_effects', effect);
        }
      }
      if (!apiEffectId(effect.effect_id)) continue;
      // Only the recorded method/target and its typed source effect establish
      // note-deletion causality. An action string by itself never adds an edge.
      for (const operation of actionOperations.get(actionKey(effect)) ?? []) {
        if (operation.method !== 'deleteSourceNote' || operation.parsed.id !== operation.target_id || operation.parsed.state !== 'deleted') continue;
        const sourceEffect = (actionEffects.get(actionKey(effect)) ?? []).find(item =>
          apiEffectId(item.effect_id) && item.kind === 'evidence_invalidated' && item.entity_type === 'submitted-note' &&
          item.entity_id === operation.target_id && item.revision === operation.parsed.revision);
        // deleteSourceNote emits its dependent Card effects immediately before
        // the terminal note effect and records their exact batch size. This
        // excludes automatic effects from another ledger reusing the string.
        if (!sourceEffect || !Number.isSafeInteger(operation.parsed.effectCount) ||
            effect.ordinal >= sourceEffect.ordinal || sourceEffect.ordinal - effect.ordinal >= operation.parsed.effectCount) continue;
        const id = noteEdge(operation.target_id, sourceEffect.revision - 1, 'card_operations', operation);
        fact(id, 'purge', 'card_effects', sourceEffect);
      }
    }
    observations.push(observation);
  }
  return { schemaBase, observations, usage: db.usage() };
}
