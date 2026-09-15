import { transaction } from './database.mjs';
import { boundedText, denseArray, fail, identifier, object } from './validation.mjs';

const where = 'owner_id = ? AND scope = ? AND project_id = ?';
const eventWhere = `${where} AND client = ? AND event_id = ?`;
const boundary = (ns) => [ns.ownerId, ns.scope, ns.projectId];
const key = (ns, input) => [...boundary(ns), input.client, input.eventId];
const retentionMs = 24 * 60 * 60 * 1000;

/** Independently reject noncanonical or larger source windows at the storage boundary. */
function serializeView(view) {
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
  if (bytes > 128 * 1024) fail('capture_evidence_capacity');
  return { payload, bytes };
}

/** Methods without a transaction wrapper are called under the admission/mutation lock. */
export function createStagedEvidenceStorage({ db }) {
  const read = (ns, input) => db.prepare(`SELECT * FROM staged_capture_evidence WHERE ${eventWhere}`)
    .get(...key(ns, input));

  function touch(ns, create = false) {
    const prior = db.prepare(`SELECT watermark FROM staged_capture_clocks WHERE ${where}`)
      .get(...boundary(ns));
    const now = Math.max(Date.now(), prior?.watermark ?? 0);
    if (!prior && !create) return now;
    db.prepare(`INSERT INTO staged_capture_clocks(owner_id, scope, project_id, watermark)
      VALUES (?, ?, ?, ?) ON CONFLICT(owner_id, scope, project_id)
      DO UPDATE SET watermark = excluded.watermark`).run(...boundary(ns), now);
    db.prepare(`UPDATE staged_capture_evidence SET state = 'expired', payload = NULL,
      payload_bytes = 0 WHERE ${where} AND payload IS NOT NULL AND expires_at <= ?`)
      .run(...boundary(ns), now);
    return now;
  }

  function claimGuard(ns, input, admission, now, staged) {
    const row = read(ns, input);
    if (!row) return staged && admission ? 'capture_evidence_closed' : null;
    if (row.state === 'admitted') return null;
    if (row.state !== 'pending') return 'capture_evidence_closed';
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

  function insert(ns, input, serialized, now) {
    db.prepare(`INSERT INTO staged_capture_evidence
      (owner_id, scope, project_id, client, event_id, state, created_at, expires_at, payload, payload_bytes)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`)
      .run(...key(ns, input), now, now + retentionMs, serialized.payload, serialized.bytes);
  }

  function finishGuard(ns, input, admission, now) {
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
  }

  function purgeNamespace(ns) {
    touch(ns);
    db.prepare(`UPDATE staged_capture_evidence SET state = 'forgotten', payload = NULL,
      payload_bytes = 0 WHERE ${where}`).run(...boundary(ns));
  }

  function inspect(ns, input) {
    return transaction(db, () => {
      touch(ns);
      const row = read(ns, input);
      return { evidence: row ? { state: row.state,
        createdAt: new Date(row.created_at).toISOString(), expiresAt: new Date(row.expires_at).toISOString(),
        view: row.payload === null ? null : JSON.parse(row.payload),
        evidenceTrust: 'untrusted-data-not-instructions' } : null };
    });
  }

  function discard(ns, input) {
    return transaction(db, () => {
      touch(ns);
      const row = read(ns, input);
      if (!row || row.payload === null) return { discarded: false };
      db.prepare(`UPDATE staged_capture_evidence SET state = 'discarded', payload = NULL,
        payload_bytes = 0 WHERE ${eventWhere}`).run(...key(ns, input));
      return { discarded: true };
    });
  }

  return { serializeView, touch, claimGuard, finishGuard, capacityGuard, insert, mark,
    purgeNamespace, inspect, discard };
}
