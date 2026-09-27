import { hasEpisodes } from './episode-schema.mjs';
import { transaction } from './database.mjs';
import { boundedText, denseArray, fail, identifier, object } from './validation.mjs';

const where = 'owner_id = ? AND scope = ? AND project_id = ?';
const eventWhere = `${where} AND client = ? AND event_id = ?`;
const boundary = (ns) => [ns.ownerId, ns.scope, ns.projectId];
const key = (ns, input) => [...boundary(ns), input.client, input.eventId];
const retentionMs = 24 * 60 * 60 * 1000;

/** Independently reject noncanonical or larger source windows at the storage boundary. */
function serializeView(view, episode = false) {
  object(view, ['messages', 'retainedSourceWindow']);
  const messages = denseArray(view.messages, 1, 24).map((message) => {
    object(message, ['id', 'role', 'content']);
    const id = identifier(message.id);
    if (!['user', 'assistant'].includes(message.role) ||
      typeof message.content !== 'string' || !message.content.isWellFormed() ||
      boundedText(message.content, 800) !== message.content) fail('invalid_input');
    return { id, role: message.role, content: message.content };
  });
  if (new Set(messages.map(({ id }) => id)).size !== messages.length) fail('invalid_input');
  object(view.retainedSourceWindow, ['maxUnitsPerMessage', 'truncatedMessageIndices']);
  const { maxUnitsPerMessage, truncatedMessageIndices } = view.retainedSourceWindow;
  const indices = denseArray(truncatedMessageIndices, 0, messages.length);
  if (maxUnitsPerMessage !== 800 || indices.some((index, position) =>
    !Number.isInteger(index) || index < 0 || index >= messages.length ||
    (position > 0 && index <= indices[position - 1]))) fail('invalid_input');
  const payload = JSON.stringify({ messages,
    retainedSourceWindow: { maxUnitsPerMessage, truncatedMessageIndices: [...indices] } });
  const bytes = Buffer.byteLength(payload, 'utf8');
  if (!episode && bytes > 128 * 1024) fail('capture_evidence_capacity');
  return { payload, bytes };
}

/** Methods without a transaction wrapper are called under the admission/mutation lock. */
export function createStagedEvidenceStorage({ db }) {
  let episodes;
  const read = (ns, input) => db.prepare(`SELECT * FROM staged_capture_evidence WHERE ${eventWhere}`)
    .get(...key(ns, input));

  function touch(ns, create = false, wallTime = Date.now()) {
    const prior = db.prepare(`SELECT watermark FROM staged_capture_clocks WHERE ${where}`)
      .get(...boundary(ns));
    const now = Math.max(wallTime, prior?.watermark ?? 0);
    if (!prior && !create) return now;
    db.prepare(`INSERT INTO staged_capture_clocks(owner_id, scope, project_id, watermark)
      VALUES (?, ?, ?, ?) ON CONFLICT(owner_id, scope, project_id)
      DO UPDATE SET watermark = excluded.watermark`).run(...boundary(ns), now);
    if (episodes && hasEpisodes(db)) for (const row of db.prepare(`SELECT client,event_id FROM staged_capture_evidence WHERE ${where} AND event_mode='episode-v1' AND payload IS NOT NULL AND expires_at<=?`).all(...boundary(ns), now)) {
      episodes.gap(ns, { client: row.client, eventId: row.event_id }, 'expired');
    }
    db.prepare(`UPDATE staged_capture_evidence SET state = 'expired', payload = NULL,
      payload_bytes = 0 WHERE ${where} AND payload IS NOT NULL AND expires_at <= ?`)
      .run(...boundary(ns), now);
    return now;
  }

  function admissionTime(ns, input, create = false) {
    // Called after acquiring the admission write lock. Payload expiry always
    // advances monotonically; unrelated admission leases retain wall-clock time.
    const wallTime = Date.now();
    const watermark = touch(ns, create, wallTime);
    return create || read(ns, input) ? watermark : wallTime;
  }

  function claimGuard(ns, input, admission, now, staged) {
    const denied = episodes?.guard(ns, input); if (denied) return denied;
    const row = read(ns, input);
    if (!row && episodes?.event(ns, input)?.staging === 'not-staged') return null;
    if (!row) return staged && admission ? 'capture_evidence_closed' : null;
    if (row.state === 'admitted' || row.state === 'released') return null;
    if (row.state !== 'pending') return 'capture_evidence_closed';
    if (row.event_mode === 'episode-v1' && ['reserved','pending'].includes(admission?.state)) return null;
    if (admission.lease_expires_at <= now) {
      db.prepare(`UPDATE staged_capture_evidence SET state = 'failed' WHERE ${eventWhere}`)
        .run(...key(ns, input));
      return 'capture_evidence_closed';
    }
    return null;
  }

  function capacityGuard(ns, serialized) {
    const usage = db.prepare(`SELECT count(*) AS count, coalesce(sum(payload_bytes), 0) AS bytes
      FROM staged_capture_evidence WHERE ${where} AND payload IS NOT NULL`).get(...boundary(ns));
    if (usage.count >= 64 || usage.bytes + serialized.bytes > 1024 * 1024) {
      return 'capture_evidence_capacity';
    }
    return null;
  }

  function insert(ns, input, serialized, now, mode = 'staged-v1') {
    db.prepare(`INSERT INTO staged_capture_evidence
      (owner_id, scope, project_id, client, event_id, state, created_at, expires_at, payload, payload_bytes)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`)
      .run(...key(ns, input), now, now + retentionMs, serialized.payload, serialized.bytes);
    if (mode === 'episode-v1') db.prepare(`UPDATE staged_capture_evidence SET event_mode='episode-v1' WHERE ${eventWhere}`).run(...key(ns, input));
  }

  function finishGuard(ns, input, admission, now) {
    const denied = episodes?.guard(ns, input); if (denied) return denied;
    const row = read(ns, input);
    if (!row) return null;
    if (row.state !== 'pending') return 'capture_evidence_closed';
    if (admission?.lease_expires_at <= now) {
      mark(ns, input, 'failed');
      return 'capture_evidence_closed';
    }
    return null;
  }

  function mark(ns, input, state) {
    db.prepare(`UPDATE staged_capture_evidence SET state = ? WHERE ${eventWhere} AND state = 'pending'`)
      .run(state, ...key(ns, input));
    if (state === 'admitted') releaseCompleted(ns, input);
  }

  function purgeNamespace(ns) {
    touch(ns);
    if (hasEpisodes(db)) db.prepare(`UPDATE episode_events SET gap='forgotten' WHERE ${where}`).run(...boundary(ns));
    db.prepare(`UPDATE staged_capture_evidence SET state = 'forgotten', payload = NULL,
      payload_bytes = 0${hasEpisodes(db) ? ', release_reason = NULL' : ''} WHERE ${where}`).run(...boundary(ns));
  }

  function inspect(ns, input) {
    return transaction(db, () => {
      touch(ns);
      const row = read(ns, input);
      const bypass = episodes?.event(ns, input);
      if (!row && bypass) return { evidence: { state: bypass.gap === 'forgotten' ? 'forgotten' : 'not-staged',
        view: null, expiresAt: null, createdAt: bypass.created_at, reason: 'capacity',
        admission: bypass.admission, gap: bypass.gap, evidenceTrust: 'untrusted-data-not-instructions' } };
      return { evidence: row ? { state: row.state,
        createdAt: new Date(row.created_at).toISOString(), expiresAt: row.state === 'released' ? null : new Date(row.expires_at).toISOString(),
        ...(row.event_mode === 'episode-v1' ? { releaseReason: row.release_reason, disposition: !!row.disposition, admission: bypass?.admission, gap: bypass?.gap } : {}),
        view: row.payload === null ? null : JSON.parse(row.payload),
        evidenceTrust: 'untrusted-data-not-instructions' } : null };
    });
  }

  function discard(ns, input) {
    return transaction(db, () => {
      touch(ns);
      const row = read(ns, input);
      if (!row || row.payload === null) return { discarded: false };
      if (row.event_mode === 'episode-v1') episodes.gap(ns,input,'discarded');
      db.prepare(`UPDATE staged_capture_evidence SET state = 'discarded', payload = NULL,
        payload_bytes = 0 WHERE ${eventWhere}`).run(...key(ns, input));
      return { discarded: true };
    });
  }

  function releaseCompleted(ns, input) {
    if (!hasEpisodes(db)) return;
    db.prepare(`UPDATE staged_capture_evidence SET state='released',payload=NULL,payload_bytes=0,release_reason='interpreted'
      WHERE ${eventWhere} AND event_mode='episode-v1' AND disposition=1 AND state='admitted'`)
      .run(...key(ns, input));
  }

  function episodeCapacity(ns, serialized) {
    if (serialized.bytes > 128 * 1024) return false;
    // Expiry was already pruned under the registration lock; complete normal releases first.
    db.prepare(`UPDATE staged_capture_evidence SET state='released',payload=NULL,payload_bytes=0,release_reason='interpreted'
      WHERE ${where} AND event_mode='episode-v1' AND disposition=1 AND state='admitted'`).run(...boundary(ns));
    if (!capacityGuard(ns, serialized)) return true;
    const eligible = db.prepare(`SELECT s.client,s.event_id FROM staged_capture_evidence s
      JOIN admission_claims a USING(owner_id,scope,project_id,client,event_id)
      WHERE s.owner_id=? AND s.scope=? AND s.project_id=? AND s.event_mode='episode-v1'
        AND s.payload IS NOT NULL AND a.state='completed'
      ORDER BY s.created_at,s.client COLLATE BINARY,s.event_id COLLATE BINARY`).all(...boundary(ns));
    for (const row of eligible) {
      const input = { client: row.client, eventId: row.event_id };
      db.prepare(`UPDATE staged_capture_evidence SET state='released',payload=NULL,payload_bytes=0,release_reason='capacity'
        WHERE ${eventWhere}`).run(...key(ns, input));
      episodes.gap(ns, input, 'capacity');
      if (!capacityGuard(ns, serialized)) return true;
    }
    return false;
  }

  return { setEpisodes(value) { episodes = value; }, episodeCapacity, releaseCompleted, serializeView, touch, admissionTime, claimGuard, finishGuard, capacityGuard, insert, mark,
    purgeNamespace, inspect, discard };
}
