import { createHmac, randomUUID } from 'node:crypto';
import { transaction } from './database.mjs';
import { rawNamespace, rawBoundary } from './raw-input.mjs';
import { fail, identifier, object, revision } from './validation.mjs';

const where = 'owner_id=? AND scope=? AND project_id=?';
const publicNs = ns => ({ ...ns, projectId: ns.projectId || null });
const same = (a, b) => a.client === b.client && a.sessionKey === b.sessionKey;
const size = value => Buffer.byteLength(JSON.stringify({ ok: true, value }));

/** One model-free live-source plan for preview, conversation delete and old episode delete. */
export function createRawDeletionStorage({ db, roots, episodes, forgetMutation, removeReceipts, advanceEpoch }) {
  const key = Buffer.from(db.prepare('SELECT cursor_secret FROM store_metadata WHERE singleton=1').get().cursor_secret, 'hex');
  const hash = value => createHmac('sha256', key).update(JSON.stringify(value)).digest('base64url');
  const target = (ns, id) => db.prepare(`SELECT * FROM raw_conversations WHERE ${where} AND id=?`).get(...rawBoundary(ns), id);
  const rootOf = row => ({ client: row.client, sessionKey: row.session_key });
  function input(value, action = false) {
    object(value, ['namespace','conversationId','expectedRevision', ...(action ? ['actionId'] : [])]);
    const ns = rawNamespace(value.namespace);
    identifier(value.conversationId); revision(value.expectedRevision);
    if (action) identifier(value.actionId);
    if (!roots.enabled()) fail('unsupported_database');
    return ns;
  }
  function pending(ns, root) {
    const selected = [];
    const rows = db.prepare(`SELECT a.*,s.payload FROM admission_claims a LEFT JOIN staged_capture_evidence s
      USING(owner_id,scope,project_id,client,event_id) WHERE a.owner_id=? AND a.scope=? AND a.project_id=?`)
      .all(...rawBoundary(ns));
    rows.push(...db.prepare(`SELECT a.*,NULL AS payload FROM episode_keep_actions a WHERE ${where}
      AND keep_state IN ('pending','retryable')`).all(...rawBoundary(ns)).map(row => ({ ...row, keep: true })));
    for (const row of rows) {
      if (row.state === 'completed' && row.payload === null) continue;
      let bindings = db.prepare(`SELECT source_client AS client,session_key AS sessionKey FROM raw_job_sources
        WHERE ${where} AND client=? AND event_id=?`).all(...rawBoundary(ns), row.client, row.event_id);
      if (!bindings.length) {
        const raw = db.prepare(`SELECT client,session_key AS sessionKey FROM raw_capture_events WHERE ${where} AND client=? AND event_id=?`)
          .get(...rawBoundary(ns), row.client, row.event_id);
        const episode = db.prepare(`SELECT e.client,e.session_key AS sessionKey FROM episode_events v JOIN session_episodes e ON e.id=v.episode_id
          WHERE v.owner_id=? AND v.scope=? AND v.project_id=? AND v.client=? AND v.event_id=?`)
          .get(...rawBoundary(ns), row.client, row.event_id);
        bindings = [raw ?? episode].filter(Boolean);
        if (row.keep) bindings = db.prepare(`SELECT DISTINCT e.client,e.session_key AS sessionKey FROM json_each(?) j
          JOIN episode_sources s ON s.id=j.value JOIN session_episodes e ON e.id=s.origin_episode_id`)
          .all(row.keep_source_ids);
      }
      const active = row.payload != null || row.keep || row.state !== 'completed' && row.lease_expires_at > Date.now();
      if (!bindings.length && active && row.client === root.client) fail('raw_lineage_unavailable');
      if (bindings.some(value => same(value, root))) selected.push(row);
    }
    return selected;
  }
  function planInside(ns, root) {
    const memories = [];
    const rows = db.prepare(`SELECT r.*,m.id AS memory_id FROM receipts r JOIN memories m ON m.id=r.memory_id
      WHERE m.owner_id=? AND m.scope=? AND m.project_id=? AND m.deleted=0 ORDER BY m.id,r.id`).all(...rawBoundary(ns));
    const byMemory = new Map();
    for (const row of rows) {
      const values = byMemory.get(row.memory_id) ?? []; values.push(row); byMemory.set(row.memory_id, values);
    }
    for (const [id, receipts] of byMemory) {
      const possible = receipts.filter(receipt => receipt.client === root.client &&
        roots.keys(ns, receipt.client, receipt.session_id).includes(root.sessionKey) || db.prepare(`SELECT 1 FROM raw_receipt_lineage l
          JOIN raw_conversations c ON c.id=l.conversation_id WHERE l.receipt_id=? AND c.owner_id=? AND c.scope=? AND c.project_id=?
          AND c.client=? AND c.session_key=?`).get(receipt.id, ...rawBoundary(ns), root.client, root.sessionKey));
      const removed = possible.filter(receipt => roots.receipt(ns, receipt).roots.some(value => same(value, root)));
      if (!removed.length) continue;
      const remaining = receipts.filter(receipt => !removed.some(item => item.id === receipt.id));
      if (remaining.some(receipt => roots.receipt(ns, receipt).unknown)) fail('raw_lineage_unavailable');
      memories.push({ id, receiptIds: removed.map(receipt => receipt.id), forget: !remaining.length });
    }
    const episodeIds = new Set(db.prepare(`SELECT id FROM session_episodes WHERE ${where} AND client=? AND session_key=? AND deleted=0`)
      .all(...rawBoundary(ns), root.client, root.sessionKey).map(row => row.id));
    for (const memory of memories) for (const row of db.prepare('SELECT episode_id FROM episode_memory_links WHERE memory_id=?').all(memory.id)) episodeIds.add(row.episode_id);
    const queue = [...episodeIds];
    while (queue.length) for (const row of db.prepare('SELECT DISTINCT episode_id FROM episode_sources WHERE origin_episode_id=?').all(queue.pop())) {
      if (!episodeIds.has(row.episode_id)) { episodeIds.add(row.episode_id); queue.push(row.episode_id); }
    }
    const liveEpisodes = [...episodeIds].filter(id => db.prepare(`SELECT 1 FROM session_episodes WHERE ${where} AND id=? AND deleted=0`).get(...rawBoundary(ns), id));
    return { memories, episodeIds: liveEpisodes, jobs: pending(ns, root), counts: {
      forgottenMemories: memories.filter(memory => memory.forget).length,
      retainedMemories: memories.filter(memory => !memory.forget).length,
      removedReceipts: memories.reduce((sum, memory) => sum + memory.receiptIds.length, 0), invalidatedEpisodes: liveEpisodes.length } };
  }
  function preview(value) {
    const ns = input(value);
    return transaction(db, () => {
      const row = target(ns, value.conversationId); if (!row) fail('conversation_not_found');
      if (row.revision !== value.expectedRevision) fail('revision_conflict');
      return { conversationId: row.id, revision: row.revision, ...planInside(ns, rootOf(row)).counts };
    });
  }
  function closeJobs(ns, jobs) {
    for (const row of jobs) {
      db.prepare('INSERT OR IGNORE INTO raw_closed_jobs VALUES(?,?,?,?,?)').run(...rawBoundary(ns), row.client, row.event_id);
      if (row.keep) db.prepare(`UPDATE episode_keep_actions SET token=NULL,lease_expires_at=NULL,state='reserved',
        keep_state='failed',keep_error_code='capture_evidence_closed' WHERE ${where} AND client=? AND event_id=?`)
        .run(...rawBoundary(ns), row.client, row.event_id);
      // A pending claim requires a token and nonnull expiry; reserved/completed
      // claims require null lease fields. Expire ownership without breaking
      // either representation. raw_closed_jobs is the durable retry fence.
      else db.prepare(`UPDATE admission_claims SET lease_expires_at=0 WHERE ${where} AND client=? AND event_id=? AND state='pending'`)
        .run(...rawBoundary(ns), row.client, row.event_id);
      db.prepare(`UPDATE staged_capture_evidence SET state='forgotten',payload=NULL,payload_bytes=0,disposition=0
        WHERE ${where} AND client=? AND event_id=?`).run(...rawBoundary(ns), row.client, row.event_id);
      db.prepare(`DELETE FROM raw_job_sources WHERE ${where} AND client=? AND event_id=?`).run(...rawBoundary(ns), row.client, row.event_id);
    }
  }
  function effect(ns, source, type, id, actionId) {
    db.prepare(`INSERT INTO raw_deletion_effects(effect_id,owner_id,scope,project_id,source_type,source_id,entity_type,entity_id,action_id)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(randomUUID(), ...rawBoundary(ns), source.type, source.id, type, id, actionId);
  }
  function cascade(ns, row, source, actionId) {
    const root = rootOf(row), plan = planInside(ns, root);
    db.prepare('INSERT OR IGNORE INTO raw_session_fences VALUES(?,?,?,?,?)').run(...rawBoundary(ns), root.client, root.sessionKey);
    closeJobs(ns, plan.jobs);
    db.prepare(`DELETE FROM raw_job_sources WHERE ${where} AND source_client=? AND session_key=?`)
      .run(...rawBoundary(ns), root.client, root.sessionKey);
    for (const memory of plan.memories) {
      if (memory.forget) forgetMutation(ns, memory.id);
      else removeReceipts(ns, memory.id, memory.receiptIds);
    }
    for (const id of plan.episodeIds) episodes.invalidateSources(ns, id);
    const origins = db.prepare(`SELECT id FROM session_episodes WHERE ${where} AND client=? AND session_key=? AND deleted=0`)
      .all(...rawBoundary(ns), root.client, root.sessionKey);
    for (const origin of origins) episodes.deleteSourceEpisode(ns, origin.id);
    let finalRevision = row.revision + 1;
    if (source.type === 'conversation') {
      finalRevision = target(ns, row.id).revision + 1;
      const saved = db.prepare('SELECT coalesce(sum(byte_count),0) n FROM raw_parts WHERE conversation_id=? AND saved=1').get(row.id).n;
      const reserved = db.prepare('SELECT coalesce(sum(reserved_bytes),0) n FROM raw_messages WHERE conversation_id=?').get(row.id).n;
      if (saved || reserved) db.prepare('UPDATE raw_owner_usage SET saved_bytes=saved_bytes-?,reserved_bytes=reserved_bytes-?,revision=revision+1 WHERE owner_id=?')
        .run(saved, reserved, ns.ownerId);
      for (const table of ['raw_receipt_lineage','raw_source_maps','raw_source_exclusions','raw_capture_events','raw_events','raw_parts','raw_messages']) {
        db.prepare(`DELETE FROM ${table} WHERE conversation_id=?`).run(row.id);
      }
      db.prepare('DELETE FROM raw_conversations WHERE id=?').run(row.id);
    }
    effect(ns, source, source.type, source.id, actionId);
    for (const memory of plan.memories) effect(ns, source, 'memory', memory.id, actionId);
    for (const id of plan.episodeIds) if (!(source.type === 'episode' && source.id === id)) effect(ns, source, 'episode', id, actionId);
    advanceEpoch(ns);
    return { conversationId: row.id, revision: finalRevision, ...plan.counts, actionId,
      effectCount: 1 + plan.memories.length + plan.episodeIds.filter(id => !(source.type === 'episode' && source.id === id)).length };
  }
  function remove(value) {
    const ns = input(value, true), binding = hash(['delete-conversation-v1', ns, value.conversationId, value.expectedRevision]);
    return transaction(db, () => {
      const previous = db.prepare(`SELECT * FROM raw_deletion_actions WHERE ${where} AND action_id=?`).get(...rawBoundary(ns), value.actionId);
      if (previous) { if (previous.payload_binding !== binding) fail('event_payload_conflict'); return JSON.parse(previous.result); }
      const row = target(ns, value.conversationId); if (!row) fail('conversation_not_found');
      if (row.revision !== value.expectedRevision) fail('revision_conflict');
      const result = cascade(ns, row, { type: 'conversation', id: row.id }, value.actionId);
      db.prepare('INSERT INTO raw_deletion_actions VALUES(?,?,?,?,?,?)').run(...rawBoundary(ns), value.actionId, binding, JSON.stringify(result));
      return result;
    });
  }
  function forgetEpisode(ns, value) {
    return transaction(db, () => {
      const row = db.prepare(`SELECT * FROM session_episodes WHERE ${where} AND id=? AND deleted=0`).get(...rawBoundary(ns), value.episodeId);
      if (!row) fail('episode_not_found');
      if (row.revision !== revision(value.expectedRevision)) fail('revision_conflict');
      const raw = db.prepare(`SELECT * FROM raw_conversations WHERE ${where} AND client=? AND session_key=?`)
        .get(...rawBoundary(ns), row.client, row.session_key);
      const actionId = 'episode-delete:' + hash([ns, row.id, row.revision]);
      cascade(ns, raw ?? row, { type: raw ? 'conversation' : 'episode', id: raw?.id ?? row.id }, actionId);
      return { forgotten: true };
    });
  }
  function list(value) {
    object(value, ['namespace','limit','cursor']); const ns = rawNamespace(value.namespace), limit = value.limit ?? 20;
    if (!roots.enabled()) fail('unsupported_database');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) fail('invalid_input');
    return transaction(db, () => {
      const binding = { namespace: ns, operation: 'listRawEffects', limit };
      let high = db.prepare('SELECT coalesce(max(ordinal),0) n FROM raw_deletion_effects').get().n, after = 0;
      if (value.cursor !== undefined) {
        try {
          if (typeof value.cursor !== 'string' || value.cursor.length > 8192) fail('invalid_cursor');
          const [body, signature, extra] = value.cursor.split('.'), parsed = JSON.parse(Buffer.from(body, 'base64url').toString());
          if (extra !== undefined || hash(['raw-effects-v1', body]) !== signature || JSON.stringify(parsed.binding) !== JSON.stringify(binding) ||
            !Number.isSafeInteger(parsed.high) || !Number.isSafeInteger(parsed.after) || parsed.after < 0 || parsed.high < parsed.after) fail('invalid_cursor');
          high = parsed.high; after = parsed.after;
        } catch { fail('invalid_cursor'); }
      }
      let rows = db.prepare(`SELECT * FROM raw_deletion_effects WHERE ${where} AND ordinal>? AND ordinal<=? ORDER BY ordinal LIMIT ?`)
        .all(...rawBoundary(ns), after, high, limit + 1);
      let complete = rows.length <= limit; rows = rows.slice(0, limit);
      while (true) {
        const effects = rows.map(row => ({ effectId: row.effect_id, namespace: publicNs(ns), kind: 'withdraw_pending',
          source: { type: row.source_type, id: row.source_id }, entity: { type: row.entity_type, id: row.entity_id }, actionId: row.action_id }));
        const body = Buffer.from(JSON.stringify({ binding, high, after: rows.at(-1)?.ordinal ?? after })).toString('base64url');
        const result = { effects, coverage: { status: complete ? 'complete' : 'budget_exhausted', included: rows.length, omitted: complete ? 0 : null },
          nextCursor: complete ? null : body + '.' + hash(['raw-effects-v1', body]) };
        if (size(result) <= 65536) return result;
        complete = false; rows.pop(); if (!rows.length) fail('context_item_too_large');
      }
    });
  }
  return { preview, remove, forgetEpisode, list, planInside };
}
