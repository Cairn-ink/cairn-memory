import { performance } from 'node:perf_hooks';
import { fail } from './validation.mjs';

// Used only in an existing bounded receipt read. The probe returns no source
// data and avoids a second statement for candidates with no stored Raw time.
export const receiptSourceTimeProbe = `EXISTS(SELECT 1 FROM raw_receipt_lineage l
  CROSS JOIN raw_messages m ON m.conversation_id=l.conversation_id AND m.message_id=l.message_id
  WHERE l.receipt_id=r.id AND m.occurred_at IS NOT NULL)`;

export function receiptSourceRows(db, memoryId, probeRaw, cachedRows, cachedMemory) {
  if (cachedRows) {
    if (!probeRaw) return cachedRows;
    const timed = new Set(JSON.parse(cachedMemory?.source_time_receipts ?? '[]'));
    return cachedRows.map(row => timed.has(row.id) ? { ...row, source_time_available: 1 } : row);
  }
  return probeRaw ? db.prepare(`SELECT r.*,${receiptSourceTimeProbe} AS source_time_available
    FROM receipts r WHERE memory_id=? ORDER BY created_at,id LIMIT 16`).all(memoryId)
    : db.prepare('SELECT * FROM receipts WHERE memory_id=? ORDER BY created_at,id LIMIT 16').all(memoryId);
}

const date = instant => instant.slice(0, 16) + 'Z';
export function sourceDateFields(source, representation) {
  return representation !== 'representation-v2-dated' ? {} : source.date ? { date: source.date }
    : source.dates?.length ? { dates: source.dates } : {};
}

// Entries contain only the receipt rows admitted by the canonical projection,
// in its current synchronous authority/validation transaction. No Raw search,
// crypto or host callback participates. One statement serves the whole read,
// including multiple namespaces; neither a receipt id nor a message id alone
// can cross the namespace join. Null Raw times never become capture times.
export function resolveMemorySourceDates(db, entries, deadlineAt) {
  const wanted = entries.flatMap(({ item, rows }) => rows.filter(row => row.source_time_available)
    .map(row => [row.id, item.ref.memoryId, item.ref.namespace.ownerId,
      item.ref.namespace.scope, item.ref.namespace.projectId ?? '']));
  if (wanted.length && performance.now() >= deadlineAt) return false;
  const times = new Map();
  if (wanted.length) {
    if (!db.isTransaction) fail('raw_transaction_required');
    const found = db.prepare(`WITH wanted AS (SELECT value FROM json_each(?))
      SELECT DISTINCT r.id,m.occurred_at FROM wanted w
      CROSS JOIN receipts r ON r.id=json_extract(w.value,'$[0]') AND r.memory_id=json_extract(w.value,'$[1]')
      CROSS JOIN memories parent ON parent.id=r.memory_id AND parent.owner_id=json_extract(w.value,'$[2]')
        AND parent.scope=json_extract(w.value,'$[3]') AND parent.project_id=json_extract(w.value,'$[4]')
      CROSS JOIN raw_receipt_lineage l ON l.receipt_id=r.id
      CROSS JOIN raw_conversations c ON c.id=l.conversation_id AND c.owner_id=parent.owner_id
        AND c.scope=parent.scope AND c.project_id=parent.project_id
      CROSS JOIN raw_messages m ON m.conversation_id=c.id AND m.message_id=l.message_id
        AND m.message_id=r.event_id AND m.role=r.role
      WHERE m.occurred_at IS NOT NULL LIMIT 4097`).all(JSON.stringify(wanted));
    if (performance.now() >= deadlineAt) return false;
    if (found.length > 4096) fail('context_item_too_large');
    for (const row of found) {
      if (!times.has(row.id)) times.set(row.id, new Set());
      times.get(row.id).add(row.occurred_at);
    }
  }
  for (const { item, rows } of entries) {
    const instants = new Set();
    item.sources = item.sources.map((source, index) => {
      const row = rows[index], raw = times.get(row.id);
      // Retain the existing stored receipt-event-time path on non-Raw stores.
      const values = raw?.size ? [...raw].sort() : row.occurred_at ? [row.occurred_at] : [];
      values.forEach(value => instants.add(value));
      const dates = [...new Set(values.map(date))];
      return { ...source, ...(dates.length === 1 ? { date: dates[0] } : dates.length ? { dates } : {}) };
    });
    const ordered = [...instants].sort();
    item.date = ordered.length === 1 ? date(ordered[0]) : null;
    if (ordered.length) item.sortDate = date(ordered[0]);
  }
  return true;
}
