import { createHash, createHmac } from 'node:crypto';
import { fail } from './validation.mjs';
import { rawSourceKey } from './raw-source-input.mjs';

const boundary = ns => [ns.ownerId, ns.scope, ns.projectId ?? ''];
const partKey = row => JSON.stringify([row.conversation_id,row.message_id,row.part_index]);
const columns = `conversation_id,message_id,part_index,start,end,byte_count,digest,event_id,saved,reason,format,key_version,length(sealed) AS sealed_length`;
const sameSpan = (a,b) => a.conversation_id === b.conversationId && a.message_id === b.messageId && a.start < b.span.end && a.end > b.span.start;
const mutations = new WeakMap();

/** One source mutation, including nested Memory cascades, invalidates each Card once. */
export function createRawCardInvalidation(db) {
  let available;
  const enabled = () => available === true || (available = Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE name='card_raw_bindings'").get()));
  function collect(ns, values) {
    if (!enabled()) return;
    const context = mutations.get(db);
    if (!context || !db.isTransaction) fail('raw_transaction_required');
    for (const value of values) {
      const rows = db.prepare(`SELECT DISTINCT c.id,c.revision FROM card_raw_bindings b JOIN private_cards c ON c.id=b.card_id
        WHERE c.owner_id=? AND c.scope=? AND c.project_id=? AND c.state IN ('draft','confirmed') AND b.conversation_id=?
        ${value.messageId ? 'AND b.message_id=? AND b.start<? AND b.end>?' : ''} ORDER BY c.id LIMIT 129`)
        .all(...boundary(ns),value.conversationId,...(value.messageId ? [value.messageId,value.end,value.start] : []));
      if (rows.length > 128) fail('dependency_limit_reached');
      for (const row of rows) if (!context.cards.has(row.id)) context.cards.set(row.id,row.revision);
    }
  }
  function mutate(ns, actionId, work) {
    if (!enabled()) return work();
    if (!db.isTransaction) fail('raw_transaction_required');
    const owner = !mutations.has(db);
    if (owner) mutations.set(db,{ namespace: boundary(ns),actionId,cards: new Map() });
    const context = mutations.get(db);
    try {
      if (JSON.stringify(context.namespace) !== JSON.stringify(boundary(ns))) fail('raw_transaction_required');
      const result = work();
      if (owner) {
        let changed = false;
        for (const [id,revision] of context.cards) {
          const row = db.prepare('SELECT state,revision FROM private_cards WHERE id=?').get(id);
          // Existing receipt revision triggers may already have invalidated a
          // mixed-support Card in this same callback-free source transaction.
          if (!row || !['draft','confirmed'].includes(row.state) || row.revision !== revision) continue;
          const timestamp = new Date().toISOString();
          db.prepare(`UPDATE private_cards SET revision=revision+1,updated_at=?,
            title=CASE WHEN state='draft' THEN NULL ELSE title END,body=CASE WHEN state='draft' THEN NULL ELSE body END,
            state=CASE WHEN state='draft' THEN 'cancelled' ELSE state END WHERE id=?`).run(timestamp,id);
          db.prepare(`INSERT INTO card_effects VALUES(lower(hex(randomblob(16))),?,?,?,?,?,?,?,?,
            (SELECT coalesce(max(ordinal),0)+1 FROM card_effects))`)
            .run(...boundary(ns),'evidence_invalidated','card',id,revision+1,context.actionId);
          changed = true;
        }
        if (changed) db.prepare(`INSERT INTO card_epochs VALUES(?,?,?,2) ON CONFLICT(owner_id,scope,project_id)
          DO UPDATE SET generation=generation+1`).run(...boundary(ns));
      }
      return result;
    } finally { if (owner) mutations.delete(db); }
  }
  return { collect,mutate };
}

/** Canonical metadata only. No port, source plaintext or host callback is used. */
export function createCardRawSources(db, identity) {
  const bind = (purpose, value) => createHmac('sha256', identity.cursorSecret)
    .update(JSON.stringify([purpose,[identity.storeId,value]])).digest('base64url');
  let available;
  const enabled = () => available === true || (available = Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE name='card_raw_bindings'").get()));
  const budget = (bytes = 64000, rows = 1024) => ({ bytes, rows, scanned: 0, used: 0, parts: new Map(), payloads: new Map() });
  function metadata(ns, anchor, state) {
    if (!enabled()) fail('source_unavailable');
    const row = db.prepare(`SELECT c.client,c.session_key,c.revision,m.ordinal,m.role,m.occurred_at,m.total_units,m.total_bytes
      FROM raw_conversations c JOIN raw_messages m ON m.conversation_id=c.id WHERE c.owner_id=? AND c.scope=? AND c.project_id=?
      AND c.id=? AND m.message_id=?`).get(...boundary(ns), anchor.conversationId, anchor.messageId);
    if (!row || anchor.span.end > row.total_units || anchor.span.precision === 'whole-message' &&
        (anchor.span.start !== 0 || anchor.span.end !== row.total_units)) fail('source_unavailable');
    if (anchor.expectedRevision !== undefined && row.revision !== anchor.expectedRevision) fail('revision_conflict');
    if (db.prepare(`SELECT 1 FROM raw_source_exclusions WHERE conversation_id=? AND message_id=? AND start<? AND end>?`)
      .get(anchor.conversationId, anchor.messageId, anchor.span.end, anchor.span.start)) fail('source_excluded');
    return row;
  }
  function parts(anchor, state) {
    const selected = []; let next = anchor.span.start;
    while (next < anchor.span.end) {
      const cached = [...state.parts.values()].filter(part => sameSpan(part, anchor)).sort((a,b) => a.start-b.start);
      const known = cached.find(part => part.start <= next && part.end > next);
      if (known) { selected.push(known); next = known.end; continue; }
      // Seek only an uncovered interval. Extending a cached anchor left/right
      // or bridging cached islands must not scan/charge the covered rows again.
      const stop = Math.min(anchor.span.end,cached.find(part => part.start > next)?.start ?? anchor.span.end);
      const first = selected.length ? { start: next } : db.prepare(`SELECT start FROM raw_parts INDEXED BY raw_source_part_start
        WHERE conversation_id=? AND message_id=? AND start<=? ORDER BY start DESC LIMIT 1`)
        .get(anchor.conversationId, anchor.messageId, next);
      if (!first) fail('source_unavailable');
      const rows = db.prepare(`SELECT ${columns} FROM raw_parts INDEXED BY raw_source_part_start
        WHERE conversation_id=? AND message_id=? AND start>=? AND start<? ORDER BY start LIMIT ?`)
        .all(anchor.conversationId,anchor.messageId,first.start,stop,state.rows-state.scanned+1);
      if (rows.length > state.rows-state.scanned) fail('source_budget_exceeded');
      state.scanned += rows.length;
      for (const part of rows) {
        if (!part.saved || part.start > next || part.end <= next || !Number.isSafeInteger(part.byte_count) ||
            part.byte_count < 1 || part.byte_count > 16000 || part.end-part.start > 4000) fail('source_unavailable');
        const overhead = part.format === 'local-plain-v1' ? 0 : part.format === 'envelope-aes-256-gcm-v1' ? 28 : null;
        if (overhead === null || part.sealed_length !== part.byte_count+overhead) fail('raw_crypto_unavailable');
        if (state.used+part.byte_count > state.bytes) fail('source_budget_exceeded');
        state.used += part.byte_count; state.parts.set(partKey(part),part);
        selected.push(part); next = part.end;
      }
      if (next < stop) fail('source_unavailable');
    }
    return selected;
  }
  function inspect(ns, anchor, state = budget()) {
    const message = metadata(ns, anchor, state), selected = parts(anchor, state);
    const manifest = selected.map(part => {
      const key = partKey(part);
      const sealed = state.payloads.get(key) ?? db.prepare('SELECT sealed FROM raw_parts WHERE conversation_id=? AND message_id=? AND part_index=?')
        .get(part.conversation_id,part.message_id,part.part_index)?.sealed;
      if (!sealed || sealed.length !== part.sealed_length) fail('raw_crypto_unavailable');
      state.payloads.set(key,Buffer.from(sealed));
      return { ...part, fingerprint: createHash('sha256').update(sealed).digest('hex') };
    });
    const { revision, ...immutable } = message;
    return { message, parts: selected, manifest: { message: immutable, parts: manifest } };
  }
  const refFor = (ns, anchor, view) => ({ type: 'raw', namespace: { ...ns }, conversationId: anchor.conversationId,
    messageId: anchor.messageId, span: { ...anchor.span }, contentIdentity: bind('raw-source-content-v1', [ns,rawSourceKey(anchor),anchor.span.precision,view.manifest]) });
  function resolve(ns, ref, state = budget()) {
    const view = inspect(ns, ref, state);
    if (refFor(ns, ref, view).contentIdentity !== ref.contentIdentity) fail('source_unavailable');
    return view;
  }
  function checkFanout(refs, cardId) {
    for (const id of new Set(refs.filter(ref => ref.type === 'raw').map(ref => ref.conversationId))) {
      const rows = db.prepare(`SELECT DISTINCT c.id FROM card_raw_bindings b JOIN private_cards c ON c.id=b.card_id
        WHERE b.conversation_id=? AND c.state IN ('draft','confirmed') AND c.id!=? LIMIT 128`).all(id,cardId);
      if (rows.length >= 128) fail('dependency_limit_reached');
    }
  }
  const bindingId = ref => bind('raw-card-binding-v1', [ref.namespace,rawSourceKey(ref)]);
  const refs = id => enabled() ? db.prepare('SELECT source_ref,position FROM card_raw_bindings WHERE card_id=?').all(id) : [];
  function put(id, refs) {
    if (!enabled()) return;
    db.prepare('DELETE FROM card_raw_bindings WHERE card_id=?').run(id);
    const insert = db.prepare('INSERT INTO card_raw_bindings VALUES(?,?,?,?,?,?,?,?)');
    refs.forEach((ref,position) => { if (ref.type === 'raw') insert.run(id,bindingId(ref),ref.conversationId,ref.messageId,
      ref.span.start,ref.span.end,JSON.stringify(ref),position); });
  }
  return { enabled, budget, inspect, refFor, resolve, checkFanout, bindingId, refs, put, bind };
}
