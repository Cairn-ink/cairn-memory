import { createHmac, timingSafeEqual } from 'node:crypto';
import { fail, identifier, object } from './validation.mjs';
import { rawBoundary, rawContext, rawNamespace, rawSealed, rawText } from './raw-input.mjs';

const TRUST = 'untrusted-data-not-instructions';
const missing = () => ({ conversation: null,messages: [],nextCursor: null,complete: true,budget_exhausted: false,evidenceTrust: TRUST });
const frozen = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value); }
  return value;
};

export function createRawReads({ db,identity,epoch,open,partDigest }) {
  const sign = payload => createHmac('sha256',Buffer.from(identity.cursor_secret,'hex')).update(payload).digest('base64url');
  function encode(value) { const body = Buffer.from(JSON.stringify(value)).toString('base64url'); return `${body}.${sign(body)}`; }
  function decode(cursor, binding) {
    try {
      if (typeof cursor !== 'string' || cursor.length > 8192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(cursor)) fail('invalid_cursor');
      const [body,signature] = cursor.split('.'), expected = sign(body);
      if (!timingSafeEqual(Buffer.from(signature),Buffer.from(expected))) fail('invalid_cursor');
      const value = JSON.parse(Buffer.from(body,'base64url').toString('utf8'));
      object(value,['store','namespace','operation','id','revision','limit','epoch','ordinal','index']);
      if (Object.keys(value).length !== 9 || Buffer.from(JSON.stringify(value)).toString('base64url') !== body ||
          Object.keys(binding).some(key => JSON.stringify(value[key]) !== JSON.stringify(binding[key])) ||
          ![value.revision,value.epoch,value.ordinal,value.index].every(Number.isSafeInteger) ||
          value.revision < 1 || value.epoch < 1 || value.ordinal < 1 || value.index < 0) fail('invalid_cursor');
      return value;
    } catch { fail('invalid_cursor'); }
  }
  const readRow = (ns,id) => db.prepare('SELECT * FROM raw_conversations WHERE owner_id=? AND scope=? AND project_id=? AND id=?').get(...rawBoundary(ns),id);
  function snapshot(ns,id,limit,cursor) {
    // A short read transaction gives one coherent view, closed before the port.
    db.exec('BEGIN');
    try {
      const row = readRow(ns,id), currentEpoch = epoch(ns);
      if (!row) { db.exec('COMMIT'); return null; }
      if (cursor && (cursor.epoch !== currentEpoch || cursor.revision !== row.revision)) fail('cursor_stale');
      const counts = db.prepare(`SELECT count(*) total,
        sum(CASE WHEN assembly_state='complete' THEN 1 ELSE 0 END) complete_messages,
        sum(CASE WHEN assembly_state='pending' THEN 1 ELSE 0 END) pending_messages,
        sum(CASE WHEN assembly_state='closed' THEN 1 ELSE 0 END) closed_messages,
        coalesce(sum(reserved_bytes),0) reserved_bytes, min(occurred_at) event_start,max(occurred_at) event_end,
        count(occurred_at) known FROM raw_messages WHERE conversation_id=?`).get(id);
      const bytes = db.prepare(`SELECT coalesce(sum(CASE WHEN saved=1 THEN byte_count ELSE 0 END),0) saved_bytes,
        coalesce(sum(CASE WHEN saved=0 THEN 1 ELSE 0 END),0) skipped_parts FROM raw_parts WHERE conversation_id=?`).get(id);
      const reasons = db.prepare(`SELECT reason FROM raw_messages WHERE conversation_id=? AND reason IS NOT NULL
        UNION SELECT reason FROM raw_parts WHERE conversation_id=? AND reason IS NOT NULL ORDER BY reason COLLATE BINARY`).all(id,id).map(item => item.reason);
      const parts = db.prepare(`SELECT p.*,m.ordinal,m.role,m.occurred_at,m.total_units,m.total_bytes,m.assembly_state
        FROM raw_parts p JOIN raw_messages m ON m.conversation_id=p.conversation_id AND m.message_id=p.message_id
        WHERE p.conversation_id=?${cursor ? ' AND (m.ordinal>? OR (m.ordinal=? AND p.part_index>?))' : ''}
        ORDER BY m.ordinal,p.part_index LIMIT ?`).all(id,...(cursor ? [cursor.ordinal,cursor.ordinal,cursor.index] : []),limit+1);
      db.exec('COMMIT');
      return { row,epoch: currentEpoch,counts,bytes,reasons,parts };
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function metadata(ns, view) {
    const { row,counts,bytes,reasons } = view;
    return { id: row.id,revision: row.revision,namespace: { ...ns,projectId: ns.projectId || null },client: row.client,sessionKey: row.session_key,
      eventStart: counts.event_start,eventEnd: counts.event_end,eventTimeCoverage: counts.known === 0 ? 'unknown' : counts.known === counts.total ? 'complete' : 'partial',
      firstReceivedAt: row.first_received_at,lastReceivedAt: row.last_received_at,
      rawState: bytes.saved_bytes === 0 ? 'not_saved' : counts.complete_messages === counts.total ? 'saved' : 'partial',
      savedBytes: bytes.saved_bytes,reservedBytes: counts.reserved_bytes,
      coverage: { completeMessages: counts.complete_messages ?? 0,pendingMessages: counts.pending_messages ?? 0,closedMessages: counts.closed_messages ?? 0,
        skippedParts: bytes.skipped_parts,unreceivedBatches: 'unknown' },reasons };
  }
  return async function getConversation(input) {
    if (db.isTransaction) fail('raw_transaction_active');
    object(input,['namespace','conversationId','limit','cursor']);
    const ns = rawNamespace(input.namespace), id = identifier(input.conversationId), limit = input.limit === undefined ? 20 : input.limit;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) fail('invalid_input');
    const binding = { store: identity.store_id,namespace: ns,operation: 'getConversation',id,limit };
    const cursor = input.cursor === undefined ? null : decode(input.cursor,binding);
    const view = snapshot(ns,id,limit,cursor);
    if (!view) return missing();
    const values = [];
    for (const row of view.parts.slice(0,limit)) {
      let text = null;
      if (row.saved) {
        if (db.isTransaction) fail('raw_transaction_active');
        if (!open) fail('raw_crypto_unavailable');
        const message = { id: row.message_id,role: row.role,occurredAt: row.occurred_at,messageOrdinal: row.ordinal,
          part: { index: row.part_index,start: row.start,totalUnits: row.total_units,totalBytes: row.total_bytes } };
        const context = frozen(rawContext(ns,view.row.client,view.row.session_key,id,message,row.end));
        try {
          const sealed = rawSealed({ format: row.format,keyVersion: row.key_version,sealed: row.sealed });
          const result = await open({ ownerId: ns.ownerId,context,...sealed });
          object(result,['text']); text = rawText(result.text);
          if (text.length !== row.end-row.start || Buffer.byteLength(text) !== row.byte_count ||
              partDigest({ ...message,content: text }) !== row.digest) fail('raw_crypto_unavailable');
        } catch { fail('raw_crypto_unavailable'); }
        if (db.isTransaction) fail('raw_transaction_active');
      }
      values.push({ row,text });
    }
    const render = take => {
      const chosen = values.slice(0,take), messages = [];
      for (const { row,text } of chosen) {
        let message = messages.at(-1);
        if (message?.id !== row.message_id) {
          message = { id: row.message_id,ordinal: row.ordinal,role: row.role,occurredAt: row.occurred_at,
            totalUnits: row.total_units,totalBytes: row.total_bytes,assemblyState: row.assembly_state,parts: [] };
          messages.push(message);
        }
        message.parts.push({ index: row.part_index,start: row.start,end: row.end,text,saved: Boolean(row.saved),reason: row.reason });
      }
      const last = chosen.at(-1)?.row, complete = take === view.parts.length;
      return { conversation: metadata(ns,view),messages,
        nextCursor: complete || !last ? null : encode({ ...binding,revision: view.row.revision,epoch: view.epoch,ordinal: last.ordinal,index: last.part_index }),
        complete,budget_exhausted: take < values.length,evidenceTrust: TRUST };
    };
    let output;
    for (let take = values.length; take >= 0; take--) {
      const candidate = render(take);
      if (Buffer.byteLength(JSON.stringify({ ok: true,value: candidate })) <= 65536) {
        if (!take && values.length) fail('context_item_too_large');
        output = candidate; break;
      }
    }
    if (!output) fail('context_item_too_large');
    // Include the exact part rows, not just a process-local revision: a second
    // connection changing bytes or deleting metadata during open cannot publish.
    db.exec('BEGIN');
    try {
      const current = readRow(ns,id);
      if (!current || current.revision !== view.row.revision || epoch(ns) !== view.epoch) fail('revision_conflict');
      for (const previous of view.parts) {
        const currentPart = db.prepare('SELECT * FROM raw_parts WHERE conversation_id=? AND message_id=? AND part_index=?').get(id,previous.message_id,previous.part_index);
        if (!currentPart || ['conversation_id','message_id','part_index','start','end','byte_count','digest','event_id','saved','reason','format','key_version']
            .some(field => currentPart[field] !== previous[field]) ||
            (previous.sealed !== null && !Buffer.from(currentPart.sealed ?? []).equals(Buffer.from(previous.sealed)))) fail('revision_conflict');
        const currentMessage = db.prepare('SELECT * FROM raw_messages WHERE conversation_id=? AND message_id=?').get(id,previous.message_id);
        if (!currentMessage || ['ordinal','role','occurred_at','total_units','total_bytes','assembly_state']
            .some(field => currentMessage[field] !== previous[field])) fail('revision_conflict');
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return output;
  };
}
