import { createHmac } from 'node:crypto';
import { fail } from './validation.mjs';

const where = 'owner_id=? AND scope=? AND project_id=?';
const boundary = ns => [ns.ownerId, ns.scope, ns.projectId || ''];
const receiptValue = row => ({ client: row.client, sessionId: row.session_id,
  eventId: row.event_id, role: row.role, excerpt: row.excerpt });

/** Source-session authority shared by deletion, admission and option-off writers. */
export function createRawSourceRoots(db) {
  let available;
  const enabled = () => available === true || (available = Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE name='raw_deletion_actions'").get()));
  const hashSession = (ns, client, value) => 's1:' + createHmac('sha256', Buffer.from(
    db.prepare('SELECT secret FROM episode_identity WHERE singleton=1').get().secret, 'hex'))
    .update(JSON.stringify(['episode-v1', ...boundary(ns), client, value])).digest('hex');
  const keys = (ns, client, value) => [value, hashSession(ns, client, value)];
  function assertSession(ns, client, value) {
    if (!enabled()) return;
    for (const session of keys(ns, client, value)) if (db.prepare(
      `SELECT 1 FROM raw_session_fences WHERE ${where} AND client=? AND session_key=?`)
      .get(...boundary(ns), client, session)) fail('conversation_deleted');
  }
  function resolve(ns, value) {
    if (!enabled()) return [];
    const sessions = keys(ns, value.client, value.sessionId), found = new Map();
    const add = row => {
      const root = found.get(row.session_key) ?? { client: value.client, sessionKey: row.session_key };
      if (row.conversation_id) root.conversationId = row.conversation_id;
      if (row.episode_id) root.episodeId = row.episode_id;
      found.set(row.session_key, root);
    };
    for (const session of sessions) {
      const raw = db.prepare(`SELECT c.id AS conversation_id,c.session_key FROM raw_conversations c
        JOIN raw_messages m ON m.conversation_id=c.id WHERE c.owner_id=? AND c.scope=? AND c.project_id=?
        AND c.client=? AND c.session_key=? AND m.message_id=?`).get(...boundary(ns), value.client, session, value.eventId);
      if (raw) add(raw);
      const episode = db.prepare(`SELECT e.id AS episode_id,e.session_key FROM session_episodes e
        WHERE e.owner_id=? AND e.scope=? AND e.project_id=? AND e.client=? AND e.session_key=? AND e.deleted=0
        AND (EXISTS(SELECT 1 FROM episode_messages m WHERE m.episode_id=e.id AND m.message_id=?)
          OR EXISTS(SELECT 1 FROM episode_sources s WHERE s.origin_episode_id=e.id AND s.message_id=?))`)
        .get(...boundary(ns), value.client, session, value.eventId, value.eventId);
      if (episode) add(episode);
      if (db.prepare(`SELECT 1 FROM raw_job_sources WHERE ${where} AND source_client=? AND session_key=? AND message_id=?`)
        .get(...boundary(ns), value.client, session, value.eventId)) add({ session_key: session });
    }
    if (found.size > 1) fail('raw_lineage_unavailable');
    return [...found.values()];
  }
  function receipt(ns, row) {
    const stored = db.prepare(`SELECT DISTINCT c.id AS conversationId,c.client,c.session_key AS sessionKey
      FROM raw_receipt_lineage l JOIN raw_conversations c ON c.id=l.conversation_id
      WHERE l.receipt_id=? AND c.owner_id=? AND c.scope=? AND c.project_id=?`).all(row.id, ...boundary(ns));
    const values = stored.length ? stored : resolve(ns, receiptValue(row));
    // Existing real receipt IDs can prove older batch-based episode receipts.
    if (!values.length) {
      const linked = db.prepare(`SELECT DISTINCT e.id AS episode_id,e.client,e.session_key FROM episode_memory_links l
        JOIN session_episodes e ON e.id=l.episode_id JOIN json_each(l.receipt_ids) r
        WHERE e.owner_id=? AND e.scope=? AND e.project_id=? AND e.deleted=0 AND r.value=?
          AND e.client=? AND e.session_key IN (?,?)`).all(...boundary(ns), row.id, row.client,
        ...keys(ns, row.client, row.session_id).slice(0,2));
      for (const item of linked) values.push({ client: item.client, sessionKey: item.session_key, episodeId: item.episode_id });
      if (new Set(values.map(item => item.sessionKey)).size > 1) fail('raw_lineage_unavailable');
    }
    const independent = !values.length && db.prepare('SELECT kind FROM raw_receipt_origins WHERE receipt_id=?')
      .get(row.id)?.kind === 'independent';
    return { roots: values, independent, unknown: !values.length && !independent };
  }
  function memoryRoots(ns, id) {
    const roots = new Map();
    for (const row of db.prepare('SELECT * FROM receipts WHERE memory_id=?').all(id)) {
      for (const root of receipt(ns, row).roots) roots.set(root.client + ':' + root.sessionKey, root);
    }
    return [...roots.values()];
  }
  function touchMemory(ns, id, incoming) {
    if (!enabled()) return;
    const roots = memoryRoots(ns, id);
    if (incoming) roots.push(...resolve(ns, incoming));
    for (const root of new Map(roots.map(root => [root.client + ':' + root.sessionKey, root])).values()) {
      db.prepare(`UPDATE raw_conversations SET revision=revision+1 WHERE ${where} AND client=? AND session_key=?`)
        .run(...boundary(ns), root.client, root.sessionKey);
      db.prepare(`UPDATE session_episodes SET revision=revision+1 WHERE ${where} AND client=? AND session_key=? AND deleted=0`)
        .run(...boundary(ns), root.client, root.sessionKey);
    }
  }
  function mutateSources(ns, sources, work) {
    if (!enabled()) return work();
    if (!db.isTransaction) fail('raw_transaction_required');
    const affected = new Map();
    for (const source of sources) {
      const sessions = keys(ns, source.client, source.sessionId);
      // Raw/episode registration and trusted jobs can all resolve an old receipt
      // without adding one. Compare authority across the actual SQL mutation,
      // before any new message ledger/map can obscure the transition.
      const receipts = db.prepare(`SELECT r.* FROM receipts r JOIN memories m ON m.id=r.memory_id
        WHERE m.owner_id=? AND m.scope=? AND m.project_id=? AND m.deleted=0 AND r.client=? AND r.event_id=?`)
        .all(...boundary(ns), source.client, source.eventId);
      for (const row of receipts) if (keys(ns, row.client, row.session_id).some(key => sessions.includes(key)) && !affected.has(row.id)) {
        affected.set(row.id, { row, before: JSON.stringify(receipt(ns, row)) });
      }
    }
    const result = work();
    const changed = new Set();
    for (const { row, before } of affected.values()) if (JSON.stringify(receipt(ns, row)) !== before) changed.add(row.memory_id);
    for (const id of changed) touchMemory(ns, id);
    return result;
  }
  function bindJob(ns, input, sources) {
    if (!enabled() || !sources) return;
    return mutateSources(ns, sources, () => {
      const insert = db.prepare('INSERT OR IGNORE INTO raw_job_sources VALUES(?,?,?,?,?,?,?,?)');
      for (const source of sources) {
        assertSession(ns, source.client, source.sessionId);
        const values = resolve(ns, source);
        const session = values[0]?.sessionKey ?? hashSession(ns, source.client, source.sessionId);
        insert.run(...boundary(ns), input.client, input.eventId, source.client, session, source.eventId);
      }
    });
  }
  function jobGuard(ns, input) {
    if (!enabled()) return null;
    if (db.prepare(`SELECT 1 FROM raw_closed_jobs WHERE ${where} AND client=? AND event_id=?`)
      .get(...boundary(ns), input.client, input.eventId)) return 'conversation_deleted';
    const rows = db.prepare(`SELECT source_client,session_key FROM raw_job_sources WHERE ${where} AND client=? AND event_id=?`)
      .all(...boundary(ns), input.client, input.eventId);
    for (const row of rows) {
      try { assertSession(ns, row.source_client, row.session_key); }
      catch (error) { if (error.code === 'conversation_deleted') return error.code; throw error; }
    }
    return null;
  }
  return { enabled, hashSession, keys, resolve, receipt, memoryRoots, touchMemory, mutateSources, bindJob, jobGuard, assertSession };
}
