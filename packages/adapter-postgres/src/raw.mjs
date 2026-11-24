import { CoreError, validateSuppressionFact } from "../../core/src/index.mjs";
import {
  copyArray, copyKey, copyMessages, copyScope, decodeOutboxMessages, decodeRequest, hostedTime, identifier, pgText, readInput,
} from "./capture-input.mjs";
import { checkSourceLineage, createCaptureProofs, filterSources } from "./capture-source.mjs";
import { pauseLockedWrite } from "./capture-lock.mjs";
import { namespaceKey } from "./memory-input.mjs";
import { advanceIndex } from "./memory-rows.mjs";
import { readVisibilityFacts } from "./memory-visibility.mjs";
import { createImportTextFilter, copyWithheldPositions, rawSpanFilter } from "./raw-import.mjs";
import { LATE_PROVEN_CLOSURE, MAX_LINEAGE_SESSIONS, MAX_LINEAGE_VERTICES, PROVEN_CLOSURE } from "./raw-lineage-query.mjs";
import { purgeRawText, scrubLedger } from "./raw-purge.mjs";
import { requireLiveRun, runOperation } from "./uow.mjs";

/** @import { Scope } from "../../core/src/ports/common.d.ts" */
/** @import { CaptureMessage, RawCapture } from "../../core/src/ports/capture.d.ts" */
/** @import { RawStore, SessionLineageStore, ProvenClosure } from "../../core/src/ports/privacy.d.ts" */
/** @import { StoredFact, TextFact } from "../../core/src/suppression-fact.mjs" */
/** @import { Tx } from "../../core/src/ports/unit-of-work.d.ts" */
/** @import { Connection } from "./driver.mjs" */
/** @import { RawOptions } from "./raw-options.d.mts" */
/** @typedef {{client: string, sessionId: string}} Session */
/** @typedef {{message_mac: string, content_mac: string | null}} Proof */
/** @typedef {Connection["query"]} Query */
/** @typedef {Omit<Required<RawCapture>, "archive"> & RawStore & {
 *   archive: (...args: Parameters<RawCapture["archive"]>) => Promise<{ archived: number, withheld?: number }>,
 * }} PostgresRaw */

const ARCHIVE = `INSERT INTO raw_messages
    (id, user_id, client, session_id, message_id, occurred_at, role, content)
  SELECT id, $1, $2, $3, message_id, occurred_at, role, content
  FROM jsonb_to_recordset($4::jsonb) AS batch(
    id text, message_id text, occurred_at timestamptz, role text, content text)
  ON CONFLICT (user_id, client, session_id, message_id) DO NOTHING RETURNING 1`;

const RECORD = `INSERT INTO capture_raw_lineage (user_id, client, session_id, message_mac, content_mac)
  SELECT DISTINCT $1, $2, $3, message_mac, content_mac
  FROM jsonb_to_recordset($4::jsonb) AS proof(message_mac text, content_mac text)
  ON CONFLICT (user_id, client, session_id, message_mac, content_mac) DO NOTHING`;

const FENCE = `INSERT INTO capture_raw_fences (user_id, client, session_id)
  SELECT DISTINCT $1, client, session_id
  FROM jsonb_to_recordset($2::jsonb) AS target(client text, session_id text)
  ON CONFLICT (user_id, client, session_id) DO NOTHING RETURNING 1`;

const SUPPRESS = `INSERT INTO suppressions (id, user_id, kind, client, session_id, origin)
  SELECT target.id, $1, 'session', target.client, target.session_id, 'forget'
  FROM jsonb_to_recordset($2::jsonb) AS target(id text, client text, session_id text)
  WHERE NOT EXISTS (
    SELECT 1 FROM suppressions s WHERE s.user_id = $1
      AND (s.client, s.session_id) = (target.client, target.session_id)
      AND s.kind = 'session' AND s.origin = 'forget'
  ) RETURNING 1`;

const DELETE = `DELETE FROM raw_messages r
  USING jsonb_to_recordset($2::jsonb) AS target(client text, session_id text)
  WHERE r.user_id = $1
    AND (r.client, r.session_id) = (target.client, target.session_id) RETURNING 1`;

const LOCK_ARCHIVE_OUTBOX = `SELECT raw_request, core_outbox_metadata FROM capture_events
  WHERE user_id = $1 AND client = $2 AND session_id = $3 AND event_id = $4
    AND core_namespace IS NULL AND (core_admitted OR core_payload_digest IS NULL) FOR UPDATE`;

/** @param {Session} session */
function copySession(session) {
  return { client: identifier(session?.client), sessionId: identifier(session?.sessionId) };
}

/** @param {Query} query @param {Scope} scope @param {readonly Session[]} sessions @param {string} statement */
async function changeSessions(query, scope, sessions, statement) {
  if (!sessions.length) return 0;
  const target = sessions.map(({ client, sessionId }) => ({ client, session_id: sessionId,
    ...(statement === SUPPRESS && { id: crypto.randomUUID() }) }));
  return (await query(statement, [scope.owner, JSON.stringify(target)])).rows.length;
}

/** @param {Query} query @param {Scope} scope @param {readonly Session[]} sessions */
async function erase(query, scope, sessions) {
  const fenced = await changeSessions(query, scope, sessions, FENCE);
  const suppressed = await changeSessions(query, scope, sessions, SUPPRESS);
  const rawDeleted = await changeSessions(query, scope, sessions, DELETE);
  const ledgerBlanked = sessions.length ? await scrubLedger(query, scope, sessions) : 0;
  if (fenced || suppressed || rawDeleted || ledgerBlanked) await advanceIndex(query, scope.owner);
  return { rawDeleted, ledgerBlanked };
}

/** @param {Query} query @param {Scope} scope @param {Session} session @param {readonly Proof[]} proofs */
async function record(query, scope, { client, sessionId }, proofs) {
  if (!proofs.length) return;
  await query(RECORD, [scope.owner, client, sessionId, JSON.stringify(proofs)]);
  if (!proofs.some(({ content_mac }) => content_mac !== null)) return;
  // A bare Raw fence can hide a fork, but only a session suppression propagates erasure.
  const { rows: [closure] } = await query(LATE_PROVEN_CLOSURE, [scope.owner, client, [sessionId]]);
  if (closure.exceeded) throw new CoreError("lineage_closure_limit");
  if (closure.session_ids) {
    await erase(query, scope, closure.session_ids.map((/** @type {string} */ id) => ({ client, sessionId: id })));
  }
}

/** @param {Query} query @param {Scope} scope @param {Session} ref */
async function rawSession(query, scope, ref) {
  if (ref.client === "mcp" || !ref.sessionId.startsWith("mcp-save:")) return ref;
  const { rows } = await query(`SELECT DISTINCT source_kind = 'mcp' AS explicit_save FROM memories
    WHERE user_id = $1 AND core_namespace IS NULL AND source_client = $2 AND source_session_id = $3`,
  [scope.owner, ref.client, ref.sessionId]);
  if (rows.length > 1) throw new CoreError("raw_lineage_unavailable");
  return rows[0]?.explicit_save ? { ...ref, client: "mcp" } : ref;
}

/** @param {Scope} scope */
function rawScope(scope) {
  namespaceKey(scope.namespace, false);
  return scope;
}

/** @param {readonly CaptureMessage[]} messages */
function copyArchiveMessages(messages) {
  const batch = copyMessages(messages);
  for (const { id, content } of batch) {
    identifier(id);
    if (!pgText(content)) throw new CoreError("invalid_input");
  }
  return batch;
}

/** @param {CaptureMessage} message @param {string | null} occurred_at */
function archiveRecord({ id, role, content }, occurred_at) {
  return { id: crypto.randomUUID(), message_id: id, role, content, occurred_at };
}

/** @param {Query} query @param {{scope: Scope} & Session} source @param {ReturnType<typeof archiveRecord>[]} records */
async function archiveRecords(query, { scope, client, sessionId }, records) {
  if (!records.length) return 0;
  const { rows } = await query(ARCHIVE, [scope.owner, client, sessionId, JSON.stringify(records)]);
  if (rows.length) await advanceIndex(query, scope.owner);
  return rows.length;
}

/** @param {RawOptions} options @returns {{ raw: PostgresRaw, sessionLineage: SessionLineageStore }} */
export function createPostgresRawPorts(options) {
  const { lineageSecret, hashSessionKey, fingerprintKeys } = options ?? {};
  const captureProofs = createCaptureProofs(lineageSecret);
  /** @type {WeakMap<ProvenClosure, {tx: Tx, sessions: readonly Session[]}>} */
  const proven = new WeakMap();
  /** @type {WeakMap<Tx, Map<string, Session>>} */
  const resolvedSessions = new WeakMap();

  /** @type {PostgresRaw} */
  const raw = {
    recordLineage(tx, key, messages) {
      return pauseLockedWrite(tx, () => {
        const capture = copyKey(tx, key);
        rawScope(capture.scope);
        const batch = copyMessages(messages);
        return async (query) => {
          if (!batch.length) return;
          const proofs = await captureProofs(capture, batch);
          if (proofs === null) throw new CoreError("fingerprint_unavailable");
          const { scope, client, sessionId, eventId, payloadDigest } = capture;
          const params = [scope.owner, client, sessionId, eventId, payloadDigest, "content:" + await captureProofs.keyId()];
          const identity = `user_id = $1 AND client = $2 AND session_id = $3 AND event_id = $4
            AND core_namespace IS NULL AND core_payload_digest = $5 AND raw_lineage_key_id IS DISTINCT FROM $6`;
          const { rows: [outbox] } = await query(`SELECT raw_request, core_outbox_metadata
            FROM capture_events WHERE ${identity} FOR UPDATE`, params);
          if (outbox) {
            const stored = decodeOutboxMessages(outbox.raw_request, outbox.core_outbox_metadata);
            if (stored.length === batch.length && batch.every(({ id, content }, index) =>
              stored[index].id === id && stored[index].content === content)) {
              await query(`UPDATE capture_events SET raw_lineage_key_id = $6 WHERE ${identity}`, params);
            }
          }
          await record(query, scope, capture, proofs);
        };
      });
    },

    async archiveAllowed(tx, key) {
      requireLiveRun(tx);
      const capture = readInput(() => {
        const copy = copyKey(tx, key);
        rawScope(copy.scope);
        return copy;
      });
      return runOperation(tx, async (query) =>
        await checkSourceLineage(query, capture, captureProofs, hashSessionKey) === "allowed");
    },

    archive(tx, key, messages) {
      return pauseLockedWrite(tx, () => {
        const capture = copyKey(tx, key);
        rawScope(capture.scope);
        const batch = copyArchiveMessages(messages);
        return async (query) => {
          const times = batch.map(({ occurredAtMs }) => occurredAtMs);
          // An unrepresentable time cannot be archived as an unknown time.
          const hostedTimes = times.map((time) => time === null ? null : hostedTime(time) ?? undefined);
          const withheld = hostedTimes.filter((time) => time === undefined).length;
          const result = { archived: 0, ...(withheld > 0 && { withheld }) };
          if (!times.length) return result;
          let positions = await filterSources(query, capture, times, await captureProofs(capture, batch), "raw", captureProofs, hashSessionKey);
          if (!positions.length) return result;
          const { scope, client, sessionId, eventId } = capture;
          const { rows: [outbox] } = await query(LOCK_ARCHIVE_OUTBOX, [scope.owner, client, sessionId, eventId]);
          if (outbox) {
            const { messages: stored } = decodeRequest(outbox.raw_request);
            const metadata = decodeRequest(outbox.core_outbox_metadata);
            const eligible = new Set(stored.flatMap((/** @type {{id: string, content: string}} */ { id, content }, /** @type {number} */ index) =>
              content ? [JSON.stringify([metadata?.[index]?.id ?? id, content])] : []));
            positions = positions.filter((index) => {
              const { id, content } = batch[index];
              return eligible.has(JSON.stringify([id, content]));
            });
          }
          const facts = await readVisibilityFacts(query, scope.owner, { rawSpans: true });
          const spanBlocked = rawSpanFilter(facts, capture, hashSessionKey);
          const records = positions.flatMap((index) => {
            const occurred_at = hostedTimes[index];
            if (occurred_at === undefined || spanBlocked(batch[index])) return [];
            return [archiveRecord(batch[index], occurred_at)];
          });
          return { ...result, archived: await archiveRecords(query, capture, records) };
        };
      });
    },

    importArchive(tx, scope, session, messages, options) {
      return pauseLockedWrite(tx, () => {
        const source = { scope: rawScope(copyScope(tx, scope)), ...copySession(session) };
        const batch = copyArchiveMessages(messages);
        const withheld = copyWithheldPositions(options, batch.length);
        return async (query) => {
          const counts = { archived: 0, existing: 0, withheld: batch.length };
          if (!batch.length) return counts;
          const times = batch.map(({ occurredAtMs }) => occurredAtMs);
          const proofs = await captureProofs(source, batch);
          const positions = await filterSources(query, source, times, proofs, "import", captureProofs, hashSessionKey);
          if (!positions.length) return counts;

          const facts = await readVisibilityFacts(query, source.scope.owner, { rawSpans: true });
          const spanBlocked = rawSpanFilter(facts, source, hashSessionKey);
          const textBlocked = createImportTextFilter(facts, source.scope, fingerprintKeys);
          const records = [];
          for (const position of positions) {
            if (withheld.has(position)) continue;
            const message = batch[position];
            const { content, occurredAtMs } = message;
            const occurredAt = occurredAtMs === null ? null : hostedTime(occurredAtMs);
            if ((occurredAtMs !== null && occurredAt === null) || spanBlocked(message) || await textBlocked(content)) continue;
            records.push(archiveRecord(message, occurredAt));
          }
          const archived = await archiveRecords(query, source, records);
          return { archived, existing: records.length - archived, withheld: batch.length - records.length };
        };
      });
    },

    fenceSession(tx, scope, session) {
      return pauseLockedWrite(tx, () => {
        const target = rawScope(copyScope(tx, scope));
        const ref = copySession(session);
        return async (query) => {
          const physical = resolvedSessions.get(tx)?.get(JSON.stringify([ref.client, ref.sessionId])) ??
            await rawSession(query, target, ref);
          if (await changeSessions(query, target, [physical], FENCE)) await advanceIndex(query, target.owner);
        };
      });
    },

    eraseSessions(tx, scope, closure) {
      return pauseLockedWrite(tx, () => {
        const target = rawScope(copyScope(tx, scope));
        const proof = proven.get(closure);
        if (proof?.tx !== tx) throw new CoreError("raw_lineage_unavailable");
        return (query) => erase(query, target, proof.sessions);
      });
    },

    purgeWithheld(tx, scope, facts) {
      return pauseLockedWrite(tx, () => {
        const target = rawScope(copyScope(tx, scope));
        const selected = copyArray(facts).flatMap((stored) => {
          const fact = stored.fact;
          if (fact.kind !== "text" || fact.owner !== target.owner || (fact.namespace ?? null) !== target.namespace) return [];
          const snap = validateSuppressionFact(JSON.parse(JSON.stringify(fact)));
          return snap.kind === "text" && snap.owner === target.owner && (snap.namespace ?? null) === target.namespace
            ? [/** @type {StoredFact<TextFact>} */ ({ fact: snap })] : [];
        });
        return async (query) => {
          const result = await purgeRawText(query, target, selected, fingerprintKeys);
          if (result.rawDeleted || result.ledgerBlanked) await advanceIndex(query, target.owner);
          return result;
        };
      });
    },

    deleteConversation(tx, scope, session) {
      return pauseLockedWrite(tx, () => {
        const target = rawScope(copyScope(tx, scope));
        const ref = copySession(session);
        return async (query) => {
          const rawDeleted = await changeSessions(query, target, [ref], DELETE);
          if (rawDeleted) await advanceIndex(query, target.owner);
          return { rawDeleted };
        };
      });
    },
  };

  /** @type {SessionLineageStore} */
  const sessionLineage = {
    recordAnchors(tx, scope, session, anchors) {
      return pauseLockedWrite(tx, () => {
        const target = rawScope(copyScope(tx, scope));
        const ref = copySession(session);
        const mac = /^[0-9a-f]{64}$/u;
        const proofs = copyArray(anchors).map(({ messageMac, contentMac }) => {
          if (typeof messageMac !== "string" || !mac.test(messageMac) ||
              (contentMac !== null && (typeof contentMac !== "string" || !mac.test(contentMac)))) {
            throw new CoreError("invalid_input");
          }
          return { message_mac: messageMac, content_mac: contentMac };
        });
        return (query) => record(query, target, ref, proofs);
      });
    },

    provenClosure(tx, scope, roots) {
      return pauseLockedWrite(tx, () => {
        const target = rawScope(copyScope(tx, scope));
        /** @type {Map<string, Set<string>>} */
        const byClient = new Map();
        for (const { client, sessionId } of copyArray(roots).map(copySession)) {
          const sessions = byClient.get(client) ?? new Set();
          sessions.add(sessionId);
          byClient.set(client, sessions);
        }
        return async (query) => {
          const members = [];
          /** @type {Map<string, Session>} */
          const physical = new Map();
          /** @type {Map<string, Session>} */
          const resolved = new Map(resolvedSessions.get(tx));
          let vertices = 0;
          for (const [client, sessions] of byClient) {
            /** @type {Map<string, string[]>} */
            const captureClients = new Map();
            for (const sessionId of sessions) {
              const ref = await rawSession(query, target, { client, sessionId });
              const group = captureClients.get(ref.client) ?? [];
              group.push(ref.sessionId);
              captureClients.set(ref.client, group);
            }
            for (const [captureClient, roots] of captureClients) {
              const { rows: [closure] } = await query(PROVEN_CLOSURE, [target.owner, captureClient, roots]);
              vertices += closure.vertex_count;
              if (closure.exceeded || vertices > MAX_LINEAGE_VERTICES ||
                  members.length + closure.session_ids.length > MAX_LINEAGE_SESSIONS) {
                throw new CoreError("lineage_closure_limit");
              }
              for (const sessionId of closure.session_ids) {
                // Core validates the closure against the memory's source client.
                members.push(Object.freeze({ client, sessionId }));
                const ref = { client: captureClient, sessionId };
                physical.set(JSON.stringify([captureClient, sessionId]), ref);
                const logical = JSON.stringify([client, sessionId]);
                const previous = resolved.get(logical);
                if (previous && previous.client !== captureClient) throw new CoreError("raw_lineage_unavailable");
                resolved.set(logical, ref);
              }
            }
          }
          const closure = /** @type {ProvenClosure} */ (/** @type {unknown} */ (Object.freeze(members)));
          proven.set(closure, { tx, sessions: [...physical.values()] });
          resolvedSessions.set(tx, resolved);
          return closure;
        };
      });
    },

    async isFenced(tx, scope, session) {
      requireLiveRun(tx);
      const source = readInput(() => ({ scope: rawScope(copyScope(tx, scope)), ...copySession(session) }));
      try {
        const verdict = await runOperation(tx, (query) => checkSourceLineage(query, source, captureProofs, hashSessionKey, false));
        const proof = verdict === "unknown" || verdict === "session-unknown" ? "unknown" :
          verdict === "id-only" ? verdict : "proven";
        return { fenced: verdict !== "allowed", proof };
      } catch {
        return { fenced: true, proof: "unknown" };
      }
    },
  };

  return { raw, sessionLineage };
}
