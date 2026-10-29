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
  let rows = 0, bytes = 0;
  const charge = value => {
    check();
    if (++rows > limits.scanRows || (bytes += Buffer.byteLength(JSON.stringify(value))) > limits.scanBytes) throw Error();
    return value;
  };
  return { charge, prepare(sql) {
    check();
    if (!/^\s*(SELECT|PRAGMA)\b/i.test(sql)) throw Error();
    const statement = db.prepare(sql);
    return {
      get(...args) { check(); const row = statement.get(...args); return row === undefined ? row : charge(row); },
      all(...args) {
        const values = [];
        for (const row of statement.iterate(...args)) values.push(charge(row));
        check(); return values;
      },
    };
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
  const safety = /^(?:content_safety_|content_identity_|content_suppression|owner_suppression_|card_body_|safety_)/i;
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
  if (schemaBase === 18) return { schemaBase, observations: [] };
  const cards = scan('private_cards'), notes = new Map(scan('card_notes').map(row => [row.id, row]));
  const bindings = grouping(scan('card_bindings'), row => row.card_id);
  const memoryBindings = grouping(scan('card_memory_bindings'), row => row.card_id);
  const operations = scan('card_operations').map(row => ({ ...row, parsed: JSON.parse(row.result) }));
  const effects = scan('card_effects'), cardEffects = grouping(effects.filter(row => row.entity_type === 'card'), row => row.entity_id);
  const actionEffects = grouping(effects, actionKey), actionOperations = grouping(operations, actionKey);
  const cardOperations = grouping(operations, row => row.target_id);
  let rawBindings = new Map(), conversations = new Map(), exclusions = new Map(), deletionEffects = new Map(), rawDeletions = new Map();
  if (schemaBase === 33) {
    rawBindings = grouping(scan('card_raw_bindings'), row => row.card_id);
    conversations = new Map(scan('raw_conversations').map(row => [row.id, row]));
    exclusions = grouping(scan('raw_source_exclusions'), row => JSON.stringify([row.conversation_id, row.message_id]));
    const removed = scan('raw_deletion_effects');
    deletionEffects = grouping(removed, actionKey);
    rawDeletions = grouping(removed.filter(row => row.source_type === 'conversation'), row => row.source_id);
    // Examine every retained canonical source/tombstone provider, including
    // memory-only namespaces, without decrypting Raw text or invoking a writer.
    for (const table of ['raw_messages', 'raw_receipt_lineage', 'raw_receipt_origins', 'raw_source_maps',
      'raw_session_fences', 'raw_job_sources', 'raw_closed_jobs', 'episode_memory_links',
      'episode_keep_actions', 'episode_sources', 'session_episodes']) scan(table);
    for (const row of scan('raw_deletion_actions')) JSON.parse(row.result);
    db.prepare('SELECT conversation_id,message_id,part_index,start,end,saved,digest,length(sealed) AS sealed_length FROM raw_parts').all();
  }
  const roots = schemaBase === 33 ? createRawSourceRoots(db) : null;
  const raw = schemaBase === 33 ? createCardRawSources(db, { storeId, cursorSecret }) : null;
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
    const seen = new Set(), factsSeen = new Set();
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
        if (item.source_type === 'conversation' && item.source_id === ref.conversationId && sameNamespace(item, card)) fact(id, 'privacy_erase', 'raw_deletion_effects', item);
      }
      if (exists && ref.messageId && ref.span) {
        const values = exclusions.get(JSON.stringify([ref.conversationId, ref.messageId])) ?? [];
        for (const excluded of values) if (excluded.start < ref.span.end && excluded.end > ref.span.start) fact(id, 'privacy_erase', 'raw_source_exclusions', excluded);
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
      if (exists && memory.deleted === 1) fact(id, 'user_forget', 'memories', memory);
      if (receiptId) {
        const receipt = receipts.get(receiptId), kept = Boolean(receipt && receipt.memory_id === memoryId && exists);
        add('receipt', receiptId, legacyVersion(row), origin, row, { exists: kept, memoryId, boundRevision: boundRevision ?? null });
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
      if (exists && roots) for (const receipt of memoryReceipts.get(memoryId) ?? []) {
        const authority = roots.receipt(nsFor(card), receipt);
        const stored = db.prepare('SELECT * FROM raw_receipt_lineage WHERE receipt_id=?').all(receipt.id);
        for (const entry of stored) rawEdge({ conversationId: entry.conversation_id, messageId: entry.message_id,
          span: { start: entry.start, end: entry.end, precision: entry.precision } }, 'raw_receipt_lineage', entry);
        for (const root of [...authority.roots, ...(authority.possibleRoots ?? [])]) {
          if (root.conversationId) {
            const maps = db.prepare('SELECT * FROM raw_source_maps WHERE conversation_id=? AND message_id=?').all(root.conversationId, receipt.event_id);
            if (maps.length) for (const entry of maps) rawEdge({ conversationId: root.conversationId, messageId: receipt.event_id,
              span: { start: entry.start, end: entry.end, precision: entry.precision } }, 'raw_source_maps', entry);
            else rawEdge({ conversationId: root.conversationId }, 'receipts', receipt);
          }
          const fences = db.prepare('SELECT * FROM raw_session_fences WHERE owner_id=? AND scope=? AND project_id=? AND client=? AND session_key=?')
            .all(...boundary(card), root.client, root.sessionKey);
          for (const fence of fences) fact(id, 'privacy_erase', 'raw_session_fences', fence);
        }
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
      const memory = effect.action_id.match(/^memory-revision-(.+)-([0-9]+)$/);
      if (memory) memoryEdge(memory[1], null, null, 'card_effects', effect);
      const correction = effect.action_id.match(/^memory-correct-(.+)-([0-9]+)$/);
      if (correction) memoryEdge(correction[1], Number(correction[2]), null, 'card_effects', effect);
      for (const operation of actionOperations.get(actionKey(effect)) ?? []) {
        refs(operation.parsed, 'card_operations', operation);
        if (operation.method === 'deleteSourceNote') {
          const id = noteEdge(operation.target_id, null, 'card_operations', operation);
          if (operation.parsed.id === operation.target_id && operation.parsed.state === 'deleted') fact(id, 'purge', 'card_operations', operation);
        }
      }
      for (const sibling of actionEffects.get(actionKey(effect)) ?? []) if (sibling.entity_type === 'submitted-note') noteEdge(sibling.entity_id, null, 'card_effects', sibling);
      for (const removed of deletionEffects.get(actionKey(effect)) ?? []) {
        if (removed.source_type === 'conversation') rawEdge({ conversationId: removed.source_id }, 'raw_deletion_effects', removed);
        if (removed.entity_type === 'memory') {
          const id = memoryEdge(removed.entity_id, null, null, 'raw_deletion_effects', removed);
          fact(id, 'privacy_erase', 'raw_deletion_effects', removed);
        }
      }
    }
    observations.push(observation);
  }
  return { schemaBase, observations };
}
