import { createHmac } from 'node:crypto';
import { fail } from './validation.mjs';

const boundary = ns => [ns.ownerId, ns.scope, ns.projectId || ''];
/** Schema-presence driven: current option-off writers enforce retained fences. */
export function createRawLineageStorage(db) {
  let available;
  const enabled = () => available === true || (available = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE name='raw_source_maps'").get()));
  const digest = value => createHmac('sha256', Buffer.from(db.prepare('SELECT secret FROM episode_identity WHERE singleton=1').get().secret, 'hex'))
    .update(JSON.stringify(value)).digest('hex');
  const sourceKey = receipt => digest(['raw-source-v1', receipt.role, receipt.excerpt]);
  const sessionKey = (ns, client, session) => 's1:' + digest(['episode-v1', ...boundary(ns), client, session]);

  function register(conversationId, maps) {
    if (!enabled()) return;
    if (!db.isTransaction) fail('raw_transaction_required');
    const insert = db.prepare('INSERT OR IGNORE INTO raw_source_maps VALUES(?,?,?,?,?,?)');
    for (const map of maps) for (const entry of map.entries) insert.run(conversationId, map.messageId,
      sourceKey({ role: map.role, excerpt: entry.excerpt }), entry.start, entry.end, entry.precision);
  }

  function anchors(ns, receipt) {
    if (!enabled()) return [];
    const hashed = sessionKey(ns, receipt.client, receipt.sessionId);
    const rows = db.prepare(`SELECT c.id,m.total_units,m.role FROM raw_conversations c JOIN raw_messages m ON m.conversation_id=c.id
      WHERE c.owner_id=? AND c.scope=? AND c.project_id=? AND c.client=? AND c.session_key IN (?,?) AND m.message_id=?`)
      .all(...boundary(ns), receipt.client, receipt.sessionId, hashed, receipt.eventId);
    if (rows.length > 1) fail('raw_lineage_unavailable');
    if (!rows.length) return [];
    const row = rows[0];
    if (row.role !== receipt.role) fail('event_payload_conflict');
    const maps = db.prepare('SELECT start,end,precision FROM raw_source_maps WHERE conversation_id=? AND message_id=? AND source_key=?')
      .all(row.id, receipt.eventId, sourceKey(receipt));
    const known = db.prepare('SELECT 1 FROM raw_source_maps WHERE conversation_id=? AND message_id=?').get(row.id, receipt.eventId);
    if (!maps.length && known) fail('raw_lineage_unavailable');
    return (maps.length ? maps : [{ start: 0, end: row.total_units, precision: 'whole-message' }])
      .map(span => ({ conversationId: row.id, messageId: receipt.eventId, ...span }));
  }

  function assertAnchors(values) {
    for (const anchor of values) if (db.prepare(`SELECT 1 FROM raw_source_exclusions WHERE conversation_id=? AND message_id=?
      AND start<? AND end>?`).get(anchor.conversationId, anchor.messageId, anchor.end, anchor.start)) fail('source_excluded');
  }
  function assertReceipts(ns, receipts) {
    if (!enabled()) return;
    for (const receipt of receipts) assertAnchors(anchors(ns, receipt));
  }
  function attach(ns, receiptId, receipt, origin) {
    if (!enabled()) return;
    const values = anchors(ns, receipt);
    assertAnchors(values);
    const insert = db.prepare('INSERT OR IGNORE INTO raw_receipt_lineage VALUES(?,?,?,?,?,?)');
    for (const anchor of values) insert.run(receiptId, anchor.conversationId, anchor.messageId,
      anchor.start, anchor.end, anchor.precision);
    const kind = values.length ? 'derived' : origin === 'independent' ? 'independent' : 'unknown';
    db.prepare(`INSERT INTO raw_receipt_origins VALUES(?,?) ON CONFLICT(receipt_id) DO UPDATE SET
      kind=CASE WHEN excluded.kind='derived' OR raw_receipt_origins.kind='derived' THEN 'derived'
        ELSE raw_receipt_origins.kind END`).run(receiptId, kind);
  }
  function excludeMemory(ns, memoryId) {
    if (!enabled()) return;
    if (!db.isTransaction) fail('raw_transaction_required');
    // Resolve before any receipt/source purge; historical Memory is included.
    const receipts = db.prepare('SELECT * FROM receipts WHERE memory_id=?').all(memoryId);
    const values = receipts.flatMap(receipt => {
      const stored = db.prepare(`SELECT conversation_id AS conversationId,message_id AS messageId,start,end,precision
        FROM raw_receipt_lineage WHERE receipt_id=?`).all(receipt.id);
      return stored.length ? stored : anchors(ns, { client: receipt.client, sessionId: receipt.session_id,
        eventId: receipt.event_id, role: receipt.role, excerpt: receipt.excerpt });
    });
    if (!values.length) return;
    db.prepare(`INSERT INTO raw_exclusion_clocks VALUES(?,?,?,1) ON CONFLICT(owner_id,scope,project_id)
      DO UPDATE SET generation=generation+1`).run(...boundary(ns));
    const generation = db.prepare('SELECT generation FROM raw_exclusion_clocks WHERE owner_id=? AND scope=? AND project_id=?')
      .get(...boundary(ns)).generation;
    const insert = db.prepare('INSERT OR IGNORE INTO raw_source_exclusions VALUES(?,?,?,?,?)');
    for (const anchor of values) insert.run(anchor.conversationId, anchor.messageId, anchor.start, anchor.end, generation);
  }
  function filter(ns, receipts) {
    if (!enabled()) return receipts.map((_, index) => index);
    return receipts.flatMap((receipt, index) => {
      try { assertReceipts(ns, [receipt]); return [index]; }
      catch (error) { if (error.code === 'source_excluded') return []; throw error; }
    });
  }
  return { register, attach, assertReceipts, excludeMemory, filter, enabled };
}
