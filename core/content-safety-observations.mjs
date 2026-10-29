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
  const cardOperations = grouping(operations, row => row.target_id);
  let rawBindings = new Map(), conversations = new Map(), exclusions = new Map(), rawDeletions = new Map(), memoryDeletions = new Map();
  let sourceMaps = new Map(), mappedMessages = new Set(), messages = new Map(), fences = new Map();
  let episodeSecret;
  if (schemaBase === 33) {
    rawBindings = grouping(scan('card_raw_bindings'), row => row.card_id);
    conversations = new Map(scan('raw_conversations').map(row => [row.id, row]));
    exclusions = grouping(scan('raw_source_exclusions'), row => JSON.stringify([row.conversation_id, row.message_id]));
    const removed = scan('raw_deletion_effects');
    const deletionKey = row => JSON.stringify([actionKey(row), row.source_type, row.source_id]);
    const rootsDeleted = new Set(removed.filter(row => row.entity_type === row.source_type && row.entity_id === row.source_id).map(deletionKey));
    // These joins stay inside the engine's Raw effect ledger and require its
    // typed root identity. Caller-selected Card action strings are not evidence.
    const verified = removed.filter(row => rootsDeleted.has(deletionKey(row)));
    rawDeletions = grouping(verified.filter(row => row.source_type === 'conversation'), row => row.source_id);
    memoryDeletions = grouping(verified.filter(row => row.entity_type === 'memory'), row => row.entity_id);
    const maps = scan('raw_source_maps');
    sourceMaps = grouping(maps, row => JSON.stringify([row.conversation_id, row.message_id, row.source_key]));
    mappedMessages = new Set(maps.map(row => JSON.stringify([row.conversation_id, row.message_id])));
    messages = new Map(scan('raw_messages').map(row => [JSON.stringify([row.conversation_id, row.message_id]), row]));
    fences = grouping(scan('raw_session_fences'), row => JSON.stringify([...boundary(row), row.client, row.session_key]));
    episodeSecret = db.prepare('SELECT secret FROM episode_identity WHERE singleton=1').get().secret;
    // Examine every retained canonical source/tombstone provider, including
    // memory-only namespaces, without decrypting Raw text or invoking a writer.
    for (const table of ['raw_receipt_lineage', 'raw_receipt_origins', 'raw_job_sources', 'raw_closed_jobs', 'episode_memory_links',
      'episode_keep_actions', 'episode_sources', 'session_episodes']) scan(table);
    for (const row of scan('raw_deletion_actions')) JSON.parse(row.result);
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
    const sessions = [...authority.roots, ...(authority.possibleRoots ?? [])];
    if (authority.independent) for (const sessionKey of roots.keys(nsFor(card), receipt.client, receipt.session_id)) {
      sessions.push({ client: receipt.client, sessionKey });
    }
    if (!stored.length) for (const root of [...authority.roots, ...(authority.possibleRoots ?? [])]) {
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
        // A missing bound receipt + retired Memory revision identifies the
        // affected contributor even when the deletion and Card effects have
        // different action ids. A fresh, surviving receipt does not match.
        if (!kept && Number.isSafeInteger(boundRevision) && (!exists || memory.revision > boundRevision)) {
          for (const removed of memoryDeletions.get(memoryId) ?? []) if (sameNamespace(removed, card)) {
            fact(id, 'purge', 'raw_deletion_effects', removed);
            if (removed.source_type === 'conversation') rawEdge({ conversationId: removed.source_id }, 'raw_deletion_effects', removed);
          }
        }
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
      const selectedReceipts = receiptId ? [receipts.get(receiptId)].filter(row => row?.memory_id === memoryId)
        : memoryReceipts.get(memoryId) ?? [];
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
    function refs(value, origin, row, depth = 0) {
      check();
      if (!value || typeof value !== 'object') return;
      if (depth > 32) throw Error();
      db.charge(null);
      if (['receipt', 'memory', 'submitted-note', 'raw', 'card'].includes(value.type) && value.namespace &&
          (value.namespace.ownerId !== card.owner_id || value.namespace.scope !== card.scope ||
            (value.namespace.projectId ?? '') !== card.project_id)) throw Error();
      if (value.type === 'receipt' && typeof value.memoryId === 'string' && typeof value.receiptId === 'string') memoryEdge(value.memoryId, value.memoryRevision, value.receiptId, origin, value);
      else if (value.type === 'memory' && typeof value.memoryId === 'string') memoryEdge(value.memoryId, value.revision, null, origin, value);
      else if (value.type === 'submitted-note' && typeof value.sourceId === 'string') noteEdge(value.sourceId, value.revision, origin, value);
      else if (value.type === 'raw' && typeof value.conversationId === 'string') rawEdge(value, origin, value);
      else if (value.type === 'card' && typeof value.cardId === 'string') {
        const source = cards.find(item => item.id === value.cardId && sameNamespace(item, card));
        const id = add('card', value.cardId, ['card-body-v1', value.bodyRevision], origin, row, { exists: Boolean(source) });
        if (source?.state === 'deleted' || source?.state === 'cancelled') fact(id, 'purge', 'private_cards', source);
      }
      for (const item of Object.values(value)) if (item && typeof item === 'object') refs(item, origin, row, depth + 1);
    }
    for (const row of bindings.get(card.id) ?? []) { noteEdge(row.source_id, null, 'card_bindings', row); refs(JSON.parse(row.source_ref), 'card_bindings', row); }
    for (const row of memoryBindings.get(card.id) ?? []) { memoryEdge(row.memory_id, row.memory_revision, row.receipt_id, 'card_memory_bindings', row); refs(JSON.parse(row.source_ref), 'card_memory_bindings', row); }
    for (const row of rawBindings.get(card.id) ?? []) { rawEdge({ conversationId: row.conversation_id, messageId: row.message_id,
      span: { start: row.start, end: row.end } }, 'card_raw_bindings', row); refs(JSON.parse(row.source_ref), 'card_raw_bindings', row); }
    for (const operation of cardOperations.get(card.id) ?? []) if (sameNamespace(operation, card)) refs(operation.parsed, 'card_operations', operation);
    for (const effect of cardEffects.get(card.id) ?? []) if (sameNamespace(effect, card)) {
      if (effect.kind !== 'evidence_invalidated') continue;
      // Only the recorded method/target and its typed source effect establish
      // note-deletion causality. An action string by itself never adds an edge.
      for (const operation of actionOperations.get(actionKey(effect)) ?? []) {
        if (operation.method !== 'deleteSourceNote' || operation.parsed.id !== operation.target_id || operation.parsed.state !== 'deleted') continue;
        const sourceEffect = (actionEffects.get(actionKey(effect)) ?? []).find(item =>
          item.kind === 'evidence_invalidated' && item.entity_type === 'submitted-note' &&
          item.entity_id === operation.target_id && item.revision === operation.parsed.revision);
        // deleteSourceNote emits its dependent Card effects immediately before
        // the terminal note effect and records their exact batch size. This
        // excludes automatic effects from another ledger reusing the string.
        if (!sourceEffect || !Number.isSafeInteger(operation.parsed.effectCount) ||
            effect.ordinal >= sourceEffect.ordinal || sourceEffect.ordinal - effect.ordinal >= operation.parsed.effectCount) continue;
        const id = noteEdge(operation.target_id, null, 'card_operations', operation);
        fact(id, 'purge', 'card_effects', sourceEffect);
      }
    }
    observations.push(observation);
  }
  return { schemaBase, observations, usage: db.usage() };
}
