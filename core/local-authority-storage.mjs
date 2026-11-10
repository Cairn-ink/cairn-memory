import { createLocalUuidFence } from './local-authority-uuid.mjs';
import { randomUUID, createHmac, createHash } from 'node:crypto';
import { transaction, isStorageBusy } from './database.mjs';
import { localControlInput } from './local-authority-input.mjs';
import { rawBoundary } from './raw-input.mjs';
import { createRawControlStorage } from './raw-control-storage.mjs';
import { fail } from './validation.mjs';

const where = 'owner_id=? AND scope=? AND project_id=? AND client=?';
export function createLocalAuthorityStorage(db) {
  const storeId = db.prepare('SELECT store_id FROM store_metadata WHERE singleton=1').get().store_id;
  const raw = createRawControlStorage(db);
  const read = (ns,client) => db.prepare(`SELECT * FROM local_capture_controls WHERE ${where}`).get(...rawBoundary(ns),client);
  function value(ns,client) {
    const row = read(ns,client);
    return { storeId, targetId: row?.target_id ?? null, client, revision: row?.revision ?? 0,
      automaticCaptureEnabled: row?.automatic_capture_enabled === 1, consentGeneration: row?.consent_generation ?? 'initial',
      rawNoticeVersion: row?.raw_notice_version ?? null };
  }
  function get(input) { const { namespace,client } = localControlInput(input); return value(namespace,client); }
  function set(input) {
    const request = localControlInput(input,true), { namespace: ns,client,targetId,automaticCaptureEnabled,rawNoticeVersion } = request;
    return transaction(db, () => {
      const before = value(ns,client);
      if (request.expectedStoreId !== storeId || request.expectedRevision !== before.revision ||
          before.targetId !== null && before.targetId !== targetId) fail('revision_conflict');
      if (before.targetId !== null && before.automaticCaptureEnabled === automaticCaptureEnabled && before.rawNoticeVersion === rawNoticeVersion) return before;
      const generation = before.targetId === null || before.automaticCaptureEnabled !== automaticCaptureEnabled ? randomUUID() : before.consentGeneration;
      db.prepare(`INSERT INTO local_capture_controls VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_id,scope,project_id,client)
        DO UPDATE SET revision=excluded.revision,automatic_capture_enabled=excluded.automatic_capture_enabled,
        consent_generation=excluded.consent_generation,raw_notice_version=excluded.raw_notice_version`)
        .run(...rawBoundary(ns),client,targetId,before.revision+1,Number(automaticCaptureEnabled),generation,rawNoticeVersion);
      if (before.automaticCaptureEnabled && !automaticCaptureEnabled) raw.closePendingInside({ ownerId: ns.ownerId,namespace: ns,client,reason:'capture_barrier' });
      else if (before.rawNoticeVersion !== null && rawNoticeVersion === null) raw.closePendingInside({ ownerId: ns.ownerId,namespace: ns,client,reason:'notice_required' });
      return value(ns,client);
    });
  }
  function check(snapshot, ns, client) {
    if (JSON.stringify(rawBoundary(ns)) !== JSON.stringify(rawBoundary(snapshot.namespace)) || client !== snapshot.client || snapshot.storeId !== storeId) fail('revision_conflict');
    const current = value(ns,client);
    if (!current.automaticCaptureEnabled) fail('capture_disabled');
    const namespace = db.prepare('SELECT generation,paused,enabled FROM episode_controls WHERE owner_id=? AND scope=? AND project_id=?').get(...rawBoundary(ns));
    if (namespace?.paused || namespace?.enabled === 0) fail('capture_disabled');
    const revision = db.prepare('SELECT revision FROM raw_capture_controls WHERE owner_id=? AND client=?').get(ns.ownerId,client)?.revision ?? 0;
    if (current.targetId !== snapshot.targetId || current.revision !== snapshot.expectedControlRevision ||
        current.consentGeneration !== snapshot.expectedConsentGeneration || (namespace?.generation ?? 'initial') !== snapshot.expectedNamespaceGeneration || revision !== snapshot.expectedRawRevision) fail('revision_conflict');
    return current;
  }
  return Object.freeze({ get,set,check });
}

export const LOCAL_RAW_LEGACY_EVENT_LIMIT = 4096;
export const LOCAL_RAW_HIDE_WINDOW_MS = 30 * 60 * 1000;

/** Private local selection only. Every mutation joins its caller's transaction. */
export function createLocalRawPrivacyStorage(db) {
  const uuid = createLocalUuidFence(db);
  const nsWhere = 'owner_id=? AND scope=? AND project_id=?';
  const raw = createRawControlStorage(db);
  const secret = db.prepare('SELECT secret FROM episode_identity WHERE singleton=1').get().secret;
  const hashSession = (ns, client, session) => 's1:' + createHmac('sha256', Buffer.from(secret, 'hex'))
    .update(JSON.stringify(['episode-v1', ...rawBoundary(ns), client, session])).digest('hex');
  const required = () => { if (!db.isTransaction) fail('raw_transaction_required'); };
  const finiteTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
  const anyWindow = ns => db.prepare(`SELECT 1 FROM local_raw_hide_windows WHERE ${nsWhere} LIMIT 1`).get(...rawBoundary(ns));
  function intersects(ns, start, end) {
    // Windows are disjoint. Only the immediate predecessor can overlap: one
    // indexed seek and one row, independent of the number/age of windows.
    const row = db.prepare(`SELECT end_ms FROM local_raw_hide_windows WHERE ${nsWhere} AND start_ms<=?
      ORDER BY start_ms DESC LIMIT 1`).get(...rawBoundary(ns), end);
    return Boolean(row && row.end_ms >= start);
  }
  function fenceInside(ns, client, session) {
    required();
    db.prepare('INSERT OR IGNORE INTO raw_session_fences VALUES(?,?,?,?,?)').run(...rawBoundary(ns), client, session);
    uuid.enqueueInside(ns,client,session);
    raw.closePendingInside({ ownerId: ns.ownerId, namespace: ns, client, sessionKey: session, reason: 'capture_barrier' });
  }
  function addWindowInside(ns, start, end) {
    required();
    // Coalesce overlapping windows, retaining only owner/namespace and range.
    // No receipt, memory, action or session identity enters this table.
    const rows = db.prepare(`SELECT start_ms,end_ms FROM local_raw_hide_windows WHERE ${nsWhere} AND start_ms<=? AND end_ms>=?`)
      .all(...rawBoundary(ns), end, start);
    for (const row of rows) {
      start = Math.min(start, row.start_ms); end = Math.max(end, row.end_ms);
      db.prepare(`DELETE FROM local_raw_hide_windows WHERE ${nsWhere} AND start_ms=?`).run(...rawBoundary(ns), row.start_ms);
    }
    db.prepare('INSERT INTO local_raw_hide_windows VALUES(?,?,?,?,?)').run(...rawBoundary(ns), start, end);
  }
  function hideMemoryInside(ns, memory) {
    required();
    // Snapshot is taken under the very same write transaction as correction or
    // forgetting, before any receipt deletion. Never read receipt text.
    const receipts = db.prepare('SELECT client,session_id,created_at FROM receipts WHERE memory_id=?').all(memory.id);
    const anchors = receipts.map(row => finiteTime(row.created_at)).filter(value => value !== null);
    // A broken receipt clock must not prevent forgetting. Retain every valid
    // receipt anchor and conservatively add both memory clocks on any gap.
    if (anchors.length !== receipts.length || !receipts.length)
      anchors.push(...[memory.created_at, memory.updated_at].map(finiteTime).filter(value => value !== null));
    if (!anchors.length) fail('local_raw_hide_anchor_missing');
    try {
      for (const anchor of anchors) addWindowInside(ns, anchor - LOCAL_RAW_HIDE_WINDOW_MS, anchor + LOCAL_RAW_HIDE_WINDOW_MS);
      for (const receipt of receipts) {
        if (!['claude-code','codex'].includes(receipt.client) || !receipt.session_id || receipt.session_id === 'explicit-tool') continue;
        // Persist only hashed keys, never a real client's session ID. If the
        // receipt already carries a stored key, conservatively cover both forms.
        const sessions = [hashSession(ns, receipt.client, receipt.session_id)];
        if (/^s1:[a-f0-9]{64}$/.test(receipt.session_id)) sessions.push(receipt.session_id);
        for (const session of new Set(sessions))
          fenceInside(ns, receipt.client, session);
      }
      // Compatibility scans only conversations without a range row. Once
      // filled, forget uses the range index and never revisits their messages.
      const missing = db.prepare(`SELECT c.client,c.session_key FROM raw_conversations c
        LEFT JOIN local_raw_session_ranges r ON r.owner_id=c.owner_id AND r.scope=c.scope AND r.project_id=c.project_id
          AND r.client=c.client AND r.session_key=c.session_key
        WHERE c.owner_id=? AND c.scope=? AND c.project_id=? AND r.session_key IS NULL`).all(...rawBoundary(ns));
      for (const session of missing) saveRangeInside(ns, session.client, session.session_key, legacyRange(ns, session.client, session.session_key));
      const matches = new Map();
      for (const anchor of anchors) {
        const sessions = db.prepare(`SELECT client,session_key FROM local_raw_session_ranges
          WHERE ${nsWhere} AND unknown_time=0 AND min_ms<=? AND max_ms>=?
          UNION ALL SELECT client,session_key FROM local_raw_session_ranges WHERE ${nsWhere} AND unknown_time=1`)
          .all(...rawBoundary(ns), anchor + LOCAL_RAW_HIDE_WINDOW_MS, anchor - LOCAL_RAW_HIDE_WINDOW_MS, ...rawBoundary(ns));
        for (const session of sessions) matches.set(JSON.stringify([session.client,session.session_key]), session);
      }
      for (const session of matches.values()) fenceInside(ns, session.client, session.session_key);
    } catch (error) {
      if (isStorageBusy(error)) throw error;
      fail('local_raw_privacy_write_failed');
    }
  }
  function readRange(ns, client, session) {
    return db.prepare(`SELECT min_ms,max_ms,unknown_time FROM local_raw_session_ranges WHERE ${where} AND session_key=?`)
      .get(...rawBoundary(ns), client, session);
  }
  function legacyRange(ns, client, session) {
    const conversation = db.prepare(`SELECT id FROM raw_conversations WHERE ${where} AND session_key=?`)
      .get(...rawBoundary(ns), client, session);
    const range = { min_ms: null, max_ms: null, unknown_time: 0 };
    if (!conversation) return range;
    // Old engines persisted receive-time fallbacks indistinguishably from real
    // event times. Preserve stored endpoints but conservatively mark unknown.
    range.unknown_time = 1;
    for (const row of db.prepare('SELECT occurred_at FROM raw_messages WHERE conversation_id=?').all(conversation.id))
      extendRange(range, finiteTime(row.occurred_at));
    return range;
  }
  function extendRange(range, time) {
    if (time === null) range.unknown_time = 1;
    else { range.min_ms = range.min_ms === null ? time : Math.min(range.min_ms, time);
      range.max_ms = range.max_ms === null ? time : Math.max(range.max_ms, time); }
  }
  function unionRange(ns, client, session, messages) {
    const range = { ...(readRange(ns, client, session) ?? legacyRange(ns, client, session)) };
    for (const message of messages) extendRange(range, finiteTime(message.occurredAt));
    return range;
  }
  function saveRangeInside(ns, client, session, range) {
    required();
    db.prepare(`INSERT INTO local_raw_session_ranges VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(owner_id,scope,project_id,client,session_key) DO UPDATE SET
      min_ms=excluded.min_ms,max_ms=excluded.max_ms,unknown_time=excluded.unknown_time`)
      .run(...rawBoundary(ns), client, session, range.min_ms, range.max_ms, range.unknown_time);
  }
  function recordRangeInside(ns, client, session, messages) {
    saveRangeInside(ns, client, session, unionRange(ns, client, session, messages));
  }
  function arrivalBlocked(ns, client, session, messages) {
    if (uuid.matches(ns,client,messages)) return true;
    const range = unionRange(ns, client, session, messages);
    return range.unknown_time ? Boolean(anyWindow(ns)) : range.min_ms !== null && intersects(ns, range.min_ms, range.max_ms);
  }
  function fenceArrivalInside(ns, client, session, messages) {
    required();
    const ready = uuid.advanceInside();
    const fenced = db.prepare(`SELECT 1 FROM raw_session_fences WHERE ${where} AND session_key=?`).get(...rawBoundary(ns),client,session);
    if (!fenced && !arrivalBlocked(ns, client, session, messages)) return ready ? false : 'storage_busy';
    uuid.rememberInside(ns,client,messages);
    fenceInside(ns, client, session);
    return 'conversation_deleted';
  }
  function fenceArrival(ns, client, session, messages) {
    // Never throw within this transaction: its only writes are the terminal
    // fence and closing pre-existing reservations. Refusal follows COMMIT.
    const reason = transaction(db, () => fenceArrivalInside(ns, client, session, messages));
    if (reason) fail(reason);
  }
  function assertModeInside(ns, client, session, interpretation, bind = false) {
    const args = [...rawBoundary(ns), client, session];
    const prior = db.prepare(`SELECT interpretation FROM local_raw_session_modes WHERE ${where} AND session_key=?`).get(...args);
    if (prior && prior.interpretation !== interpretation) fail('raw_session_mode_conflict');
    if (!prior) {
      // One-time classification of pre-existing sessions uses the same
      // authenticated empty-projection domain as Raw search. Empty eligible IDs
      // alone also occur in engine mode and must never be treated as host mode.
      const conversation = db.prepare(`SELECT id FROM raw_conversations WHERE ${where} AND session_key=?`).get(...args);
      // The unique conversation key proves fresh sessions have no legacy events.
      const legacy = conversation ? db.prepare(`SELECT event_id,first_message_ids,eligible_message_ids,projection_digest,binding_digest
        FROM raw_capture_events WHERE ${where} AND session_key=? ORDER BY event_id LIMIT ?`).all(...args, LOCAL_RAW_LEGACY_EVENT_LIMIT + 1) : [];
      if (legacy.length > LOCAL_RAW_LEGACY_EVENT_LIMIT) fail('raw_session_mode_history_limit');
      for (const event of legacy) {
        let host;
        try {
          const first = JSON.parse(event.first_message_ids), eligible = JSON.parse(event.eligible_message_ids);
          host = Array.isArray(eligible) && eligible.length === 0 && event.projection_digest === createHash('sha256')
            .update(JSON.stringify(['raw-capture-host-empty-v1',session,event.event_id,first,event.binding_digest])).digest('hex');
        } catch { fail('raw_session_mode_conflict'); }
        if ((host ? 'host' : 'engine') !== interpretation) fail('raw_session_mode_conflict');
      }
    }
    if (bind && !prior) {
      required();
      db.prepare('INSERT INTO local_raw_session_modes VALUES(?,?,?,?,?,?)').run(...args, interpretation);
    }
  }
  return { fenceInside, beforeDelete:uuid.beforeDelete, hideMemoryInside, arrivalBlocked, fenceArrivalInside, fenceArrival, recordRangeInside, assertModeInside };
}
