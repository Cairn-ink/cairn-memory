import { CoreError, validateSuppressionFact } from "../../core/src/index.mjs";
import { copyArray, copyKey, copyMessages, copyScope, hostedTime, identifier, jsonbSource, pgText, readInput } from "./capture-input.mjs";
import { checkSourceLineage, createCaptureProofs, filterSources } from "./capture-source.mjs";
import { pauseLockedWrite } from "./capture-lock.mjs";
import { advanceIndex } from "./memory-rows.mjs";
import { MAX_LINEAGE_SESSIONS, MAX_LINEAGE_VERTICES, PROVEN_CLOSURE } from "./raw-lineage-query.mjs";
import { purgeRawText, scrubLedger } from "./raw-purge.mjs";
import { requireLiveRun, runOperation } from "./uow.mjs";

/** @import { Scope } from "../../core/src/ports/common.d.ts" */
/** @import { RawCapture } from "../../core/src/ports/capture.d.ts" */
/** @import { RawStore, SessionLineageStore, ProvenClosure } from "../../core/src/ports/privacy.d.ts" */
/** @import { StoredFact, TextFact } from "../../core/src/suppression-fact.mjs" */
/** @import { Tx } from "../../core/src/ports/unit-of-work.d.ts" */
/** @import { Connection } from "./driver.mjs" */
/** @import { RawOptions } from "./raw-options.d.mts" */
/** @typedef {{client: string, sessionId: string}} Session */
/** @typedef {{message_mac: string, content_mac: string | null}} Proof */
/** @typedef {Connection["query"]} Query */

const ARCHIVE = `INSERT INTO raw_messages
    (id, user_id, client, session_id, message_id, occurred_at, role, content, core_namespace, core_occurred_at_ms)
  SELECT id, $1, $2, $3, message_id, occurred_at, role, content, $4, occurred_ms
  FROM jsonb_to_recordset($5::jsonb) AS batch(
    id text, message_id text, occurred_at timestamptz, role text, content text, occurred_ms bigint)
  ON CONFLICT (user_id, client, session_id, message_id) DO NOTHING RETURNING 1`;

const RECORD = `INSERT INTO capture_raw_lineage (user_id, client, session_id, message_mac, content_mac, core_namespaces)
  SELECT DISTINCT $1, $2, $3, message_mac, content_mac, ARRAY[$4::text]
  FROM jsonb_to_recordset($5::jsonb) AS proof(message_mac text, content_mac text)
  ON CONFLICT (user_id, client, session_id, message_mac, content_mac) DO UPDATE
  SET core_namespaces = array_append(COALESCE(capture_raw_lineage.core_namespaces, ARRAY[NULL]::text[]), $4)
  WHERE capture_raw_lineage.user_id = $1
    AND array_position(COALESCE(capture_raw_lineage.core_namespaces, ARRAY[NULL]::text[]), $4) IS NULL`;

const FENCE = `INSERT INTO capture_raw_fences (user_id, client, session_id, core_namespaces)
  SELECT DISTINCT $1, client, session_id, ARRAY[$2::text]
  FROM jsonb_to_recordset($3::jsonb) AS target(client text, session_id text)
  ON CONFLICT (user_id, client, session_id) DO UPDATE
  SET core_namespaces = array_append(COALESCE(capture_raw_fences.core_namespaces, ARRAY[NULL]::text[]), $2)
  WHERE capture_raw_fences.user_id = $1
    AND array_position(COALESCE(capture_raw_fences.core_namespaces, ARRAY[NULL]::text[]), $2) IS NULL
  RETURNING 1`;

const DELETE = `DELETE FROM raw_messages r
  USING jsonb_to_recordset($3::jsonb) AS target(client text, session_id text)
  WHERE r.user_id = $1 AND r.core_namespace IS NOT DISTINCT FROM $2
    AND (r.client, r.session_id) = (target.client, target.session_id) RETURNING 1`;

/** @param {Session} session */
function copySession(session) {
  return { client: identifier(session?.client), sessionId: identifier(session?.sessionId) };
}

/** @param {Query} query @param {Scope} scope @param {readonly Session[]} sessions @param {string} statement */
async function changeSessions(query, scope, sessions, statement) {
  if (!sessions.length) return 0;
  const target = sessions.map(({ client, sessionId }) => ({ client, session_id: sessionId }));
  return (await query(statement, [scope.owner, scope.namespace, JSON.stringify(target)])).rows.length;
}

/** @param {Query} query @param {Scope} scope @param {Session} session @param {readonly Proof[]} proofs */
async function record(query, scope, { client, sessionId }, proofs) {
  if (proofs.length) await query(RECORD, [scope.owner, client, sessionId, scope.namespace, JSON.stringify(proofs)]);
}

/** @param {RawOptions} options @returns {{ raw: RawCapture & RawStore, sessionLineage: SessionLineageStore }} */
export function createPostgresRawPorts(options) {
  const { lineageSecret, hashSessionKey, fingerprintKeys, allowNonNullNamespace = false } = options ?? {};
  const captureProofs = createCaptureProofs(lineageSecret);
  /** @type {WeakMap<ProvenClosure, {tx: Tx, namespace: Scope["namespace"]}>} */
  const proven = new WeakMap();

  /** @param {Scope} scope */
  function rawScope(scope) {
    if (!allowNonNullNamespace && scope.namespace !== null) throw new CoreError("invalid_input");
    return scope;
  }

  /** @type {RawCapture & RawStore} */
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
          await record(query, scope, capture, proofs);
          await query(`UPDATE capture_events SET raw_lineage_key_id = $7
            WHERE user_id = $1 AND client = $2 AND session_id = $3 AND event_id = $4
              AND core_namespace IS NOT DISTINCT FROM $5 AND core_payload_digest = $6
              AND raw_lineage_key_id IS DISTINCT FROM $7
              AND (SELECT jsonb_agg(jsonb_build_array(message->>'id', message->>'content') ORDER BY ordinal)
                FROM jsonb_array_elements(raw_request->'messages') WITH ORDINALITY AS entry(message, ordinal)) = $8::jsonb`,
          [scope.owner, client, sessionId, eventId, scope.namespace, payloadDigest, "content:" + await captureProofs.keyId(),
            jsonbSource(batch.map(({ id, content }) => [id, content]))]);
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
        const batch = copyMessages(messages);
        for (const { id, content } of batch) {
          identifier(id);
          if (!pgText(content)) throw new CoreError("invalid_input");
        }
        return async (query) => {
          const times = batch.map(({ occurredAtMs }) => occurredAtMs);
          if (!times.length) return { archived: 0 };
          const positions = await filterSources(query, capture, times, await captureProofs(capture, batch), "raw", captureProofs, hashSessionKey);
          if (!positions.length) return { archived: 0 };
          const { scope, client, sessionId } = capture;
          const records = positions.map((index) => {
            const { id, occurredAtMs, role, content } = batch[index];
            const occurred_at = occurredAtMs === null ? null : hostedTime(occurredAtMs);
            return { id: crypto.randomUUID(), message_id: id, role, content, occurred_at,
              occurred_ms: occurred_at === null ? occurredAtMs : null };
          });
          const { rows } = await query(ARCHIVE, [scope.owner, client, sessionId, scope.namespace, JSON.stringify(records)]);
          if (rows.length) await advanceIndex(query, scope.owner);
          return { archived: rows.length };
        };
      });
    },

    fenceSession(tx, scope, session) {
      return pauseLockedWrite(tx, () => {
        const target = rawScope(copyScope(tx, scope));
        const ref = copySession(session);
        return async (query) => {
          if (await changeSessions(query, target, [ref], FENCE)) await advanceIndex(query, target.owner);
        };
      });
    },

    eraseSessions(tx, scope, closure) {
      return pauseLockedWrite(tx, () => {
        const target = rawScope(copyScope(tx, scope));
        const proof = proven.get(closure);
        if (proof?.tx !== tx || proof.namespace !== target.namespace) throw new CoreError("raw_lineage_unavailable");
        return async (query) => {
          if (!closure.length) return { rawDeleted: 0, ledgerBlanked: 0 };
          const fenced = await changeSessions(query, target, closure, FENCE);
          const rawDeleted = await changeSessions(query, target, closure, DELETE);
          const ledgerBlanked = await scrubLedger(query, target, closure);
          if (fenced || rawDeleted || ledgerBlanked) await advanceIndex(query, target.owner);
          return { rawDeleted, ledgerBlanked };
        };
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
          let vertices = 0;
          for (const [client, sessions] of byClient) {
            const { rows: [closure] } = await query(PROVEN_CLOSURE,
              [target.owner, client, target.namespace, [...sessions]]);
            vertices += closure.vertex_count;
            if (closure.exceeded || vertices > MAX_LINEAGE_VERTICES ||
                members.length + closure.session_ids.length > MAX_LINEAGE_SESSIONS) {
              throw new CoreError("lineage_closure_limit");
            }
            for (const sessionId of closure.session_ids) members.push(Object.freeze({ client, sessionId }));
          }
          const closure = /** @type {ProvenClosure} */ (/** @type {unknown} */ (Object.freeze(members)));
          proven.set(closure, { tx, namespace: target.namespace });
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
