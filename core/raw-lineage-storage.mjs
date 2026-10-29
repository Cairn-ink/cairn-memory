import { createHmac } from 'node:crypto';
import { fail } from './validation.mjs';
import { createRawSourceRoots } from './raw-source-roots.mjs';
import { createRawCardInvalidation } from './card-raw-sources.mjs';

const boundary = ns => [ns.ownerId, ns.scope, ns.projectId || ''];
/** Schema-presence driven: current option-off writers enforce retained fences. */
export function createRawLineageStorage(db, { readMemo } = {}) {
  const roots = createRawSourceRoots(db, { readMemo });
  const rawCards = createRawCardInvalidation(db);
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
  function assertReceipts(ns, receipts, readExisting = false) {
    if (!enabled()) return;
    for (const receipt of receipts) {
      roots.assertSession(ns, receipt.client, receipt.sessionId, readExisting);
      assertAnchors(anchors(ns, receipt));
    }
  }
  // Canonical readers and qualified automatic dedup inspect original anchor rows.
  // The admission transaction owns all reads; no Raw body is opened or rewritten.
  function assertStoredReceipts(ns, receipts, { readExisting = false } = {}) {
    if (!db.isTransaction) fail('raw_transaction_required');
    const required = ['raw_conversations','raw_messages','raw_source_maps','raw_receipt_lineage',
      'raw_receipt_origins','raw_source_exclusions','raw_deletion_actions','raw_session_fences',
      'raw_job_sources','episode_identity','session_episodes','episode_messages','episode_sources',
      'episode_memory_links','episode_keep_actions'];
    const tables = readExisting && readMemo?.get('lineage-tables') || new Set(db.prepare(`SELECT name FROM sqlite_master WHERE type='table'
      AND name IN (${required.map(() => '?').join(',')})`).all(...required).map(row => row.name));
    if (readExisting) readMemo?.set('lineage-tables', tables);
    if (!['raw_conversations','raw_source_maps','raw_receipt_lineage','raw_deletion_actions'].some(name => tables.has(name))) return;
    const deletion = tables.has('raw_deletion_actions') || tables.has('raw_job_sources');
    const inspected = readExisting && !deletion ? required.filter(name => !['raw_deletion_actions','raw_job_sources'].includes(name)) : required;
    if (inspected.some(name => !tables.has(name))) fail('raw_lineage_unavailable');
    for (const receipt of receipts) {
      const stored = db.prepare(`SELECT l.conversation_id AS conversationId,l.message_id AS messageId,l.start,l.end,l.precision,
        c.owner_id,c.scope,c.project_id,c.client,c.session_key,m.role,m.total_units
        FROM raw_receipt_lineage l LEFT JOIN raw_conversations c ON c.id=l.conversation_id
        LEFT JOIN raw_messages m ON m.conversation_id=l.conversation_id AND m.message_id=l.message_id
        WHERE l.receipt_id=?`).all(receipt.id);
      for (const anchor of stored) {
        if (anchor.owner_id !== ns.ownerId || anchor.scope !== ns.scope || anchor.project_id !== (ns.projectId || '') ||
            anchor.role !== receipt.role || anchor.messageId !== receipt.event_id ||
            !Number.isSafeInteger(anchor.total_units) || !Number.isSafeInteger(anchor.start) ||
            !Number.isSafeInteger(anchor.end) || anchor.start < 0 || anchor.end <= anchor.start || anchor.end > anchor.total_units ||
            !['exact','whole-message'].includes(anchor.precision) ||
            anchor.precision === 'whole-message' && (anchor.start !== 0 || anchor.end !== anchor.total_units)) fail('raw_lineage_unavailable');
        roots.assertSession(ns, anchor.client, anchor.session_key, readExisting);
      }
      assertAnchors(stored);
      // A proven empty source session and absent keep links are reusable root facts.
      if (readExisting && readMemo && !stored.length) {
        const key = JSON.stringify(['memory-links', receipt.memory_id]);
        if (!readMemo.has(key)) readMemo.set(key, Boolean(db.prepare('SELECT 1 FROM episode_memory_links WHERE memory_id=? LIMIT 1').get(receipt.memory_id)));
        if (!readMemo.get(key) && roots.emptySession(ns, receipt) &&
            db.prepare('SELECT kind FROM raw_receipt_origins WHERE receipt_id=?').get(receipt.id)?.kind !== 'derived') {
          roots.assertSession(ns, receipt.client, receipt.session_id, true); continue;
        }
      }
      const authority = roots.receipt(ns, receipt, readExisting);
      // Pre-Raw receipts retain their ordinary read contract; this does not classify them.
      if (readExisting && authority.unknown && !authority.legacyKeep && !stored.length &&
          !db.prepare("SELECT 1 FROM raw_receipt_origins WHERE receipt_id=? AND kind='derived'").get(receipt.id) &&
          !db.prepare(`SELECT 1 FROM episode_memory_links l JOIN json_each(l.receipt_ids) r
            WHERE l.memory_id=? AND r.value=? LIMIT 1`).get(receipt.memory_id, receipt.id)) {
        assertReceipts(ns, [{ client: receipt.client, sessionId: receipt.session_id,
          eventId: receipt.event_id, role: receipt.role, excerpt: receipt.excerpt }], true);
        continue;
      }
      if (authority.unknown || authority.legacyKeep && authority.roots.length !== 1) fail('raw_lineage_unavailable');
      if (authority.independent) roots.assertSession(ns, receipt.client, receipt.session_id, readExisting);
      for (const root of authority.roots) {
        roots.assertSession(ns, root.client, root.sessionKey, readExisting);
        const episodeId = root.episodeId ?? root.episode_id;
        if (episodeId) {
          const episode = db.prepare(`SELECT deleted FROM session_episodes WHERE owner_id=? AND scope=? AND project_id=?
            AND id=? AND client=? AND session_key=?`).get(...boundary(ns), episodeId, root.client, root.sessionKey);
          if (!episode) fail('raw_lineage_unavailable');
          if (episode.deleted) fail('conversation_deleted');
        }
        if (!stored.length) assertAnchors(anchors(ns, { client: root.client, sessionId: root.sessionKey,
          eventId: receipt.event_id, role: receipt.role, excerpt: receipt.excerpt }));
      }
    }
  }
  function attach(ns, receiptId, receipt, origin) {
    if (!enabled()) return;
    const values = anchors(ns, receipt);
    assertAnchors(values);
    const insert = db.prepare('INSERT OR IGNORE INTO raw_receipt_lineage VALUES(?,?,?,?,?,?)');
    let changed = 0;
    for (const anchor of values) changed += insert.run(receiptId, anchor.conversationId, anchor.messageId,
      anchor.start, anchor.end, anchor.precision).changes;
    const kind = values.length ? 'derived' : origin === 'independent' ? 'independent' : 'unknown';
    const previous = db.prepare('SELECT kind FROM raw_receipt_origins WHERE receipt_id=?').get(receiptId)?.kind;
    db.prepare(`INSERT INTO raw_receipt_origins VALUES(?,?) ON CONFLICT(receipt_id) DO UPDATE SET
      kind=CASE WHEN excluded.kind='derived' OR raw_receipt_origins.kind='derived' THEN 'derived'
        ELSE raw_receipt_origins.kind END`).run(receiptId, kind);
    return changed > 0 || previous === undefined || previous !== kind && kind === 'derived';
  }
  function excludeMemory(ns, memoryId) {
    if (!enabled()) return;
    if (!db.isTransaction) fail('raw_transaction_required');
    // An opted-in schema may serve ordinary-only namespaces too. There is no
    // retained Raw to exclude there; missing legacy keep proof must not turn
    // ordinary correction/forgetting into a new provenance-repair requirement.
    if (!db.prepare('SELECT 1 FROM raw_conversations WHERE owner_id=? AND scope=? AND project_id=? LIMIT 1')
      .get(...boundary(ns))) return;
    // Resolve before any receipt/source purge; historical Memory is included.
    const receipts = db.prepare('SELECT * FROM receipts WHERE memory_id=?').all(memoryId);
    const values = receipts.flatMap(receipt => {
      const stored = db.prepare(`SELECT conversation_id AS conversationId,message_id AS messageId,start,end,precision
        FROM raw_receipt_lineage WHERE receipt_id=?`).all(receipt.id);
      if (stored.length) return stored;
      const authority = roots.receipt(ns,receipt);
      if (authority.legacyKeep) {
        if (authority.unknown) fail('raw_lineage_unavailable');
        return authority.roots.flatMap(root => anchors(ns,{ client: root.client,sessionId: root.sessionKey,
          eventId: receipt.event_id,role: receipt.role,excerpt: receipt.excerpt }));
      }
      return anchors(ns, { client: receipt.client, sessionId: receipt.session_id,
        eventId: receipt.event_id, role: receipt.role, excerpt: receipt.excerpt });
    });
    if (!values.length) return;
    return rawCards.mutate(ns,'source-exclusion-'+memoryId,() => {
      rawCards.collect(ns,values);
      db.prepare(`INSERT INTO raw_exclusion_clocks VALUES(?,?,?,1) ON CONFLICT(owner_id,scope,project_id)
        DO UPDATE SET generation=generation+1`).run(...boundary(ns));
      const generation = db.prepare('SELECT generation FROM raw_exclusion_clocks WHERE owner_id=? AND scope=? AND project_id=?')
        .get(...boundary(ns)).generation;
      const insert = db.prepare('INSERT OR IGNORE INTO raw_source_exclusions VALUES(?,?,?,?,?)');
      for (const anchor of values) insert.run(anchor.conversationId, anchor.messageId, anchor.start, anchor.end, generation);
    });
  }
  function filter(ns, receipts) {
    if (!enabled()) return receipts.map((_, index) => index);
    return receipts.flatMap((receipt, index) => {
      try { assertReceipts(ns, [receipt]); return [index]; }
      catch (error) { if (error.code === 'source_excluded') return []; throw error; }
    });
  }
  return { register, attach, assertReceipts, assertStoredReceipts, excludeMemory, filter, enabled };
}
