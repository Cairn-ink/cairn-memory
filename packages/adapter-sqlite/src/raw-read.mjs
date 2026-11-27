import { randomUUID } from "node:crypto";
import { compareUtf8, CoreError, tokenizeT1 } from "@cairn-ink/core";
import { rawFactPolicy } from "./raw-facts.mjs";
import { hasRawFence } from "./raw-lineage.mjs";
import { decodeRawRow, rawRows, rawSegment, readRawRow } from "./raw-rows.mjs";
import { rankLexical, readSet, validateLimit } from "./retrieval.mjs";
import { createSnapshotToken, validateSnapshotToken } from "./retrieval-snapshot.mjs";
import { invalidInput, sha256 } from "./storage-values.mjs";
import { readFacts } from "./suppressions.mjs";

/** @import { ItemRef, ListRawMessages, RawCandidates, RawSegment, RetrievalScope, Scope } from "@cairn-ink/core/ports" */
/** @import { RawRow } from "./raw-rows.mjs" */
/** @import { Connection, Port } from "./storage-values.mjs" */
/** @import { SessionHasher } from "./suppressions.mjs" */
/** @import { MigratedRawPolicy } from "./migrate/raw-privacy.mjs" */
/** @import { MigratedCaptureControls } from "./migrate/capture-controls.mjs" */
/** @typedef {Pick<RawSegment, "occurredAtMs"> & {ref: {id: string}}} PageKey */

const decoder = new TextDecoder("utf-8", { fatal: true });
const encode = (/** @type {unknown[]} */ payload) => Buffer.from(JSON.stringify(payload)).toString("base64url");

/** @param {string} cursor */
function decode(cursor) {
  try {
    if (typeof cursor !== "string" || !/^[A-Za-z0-9_-]+$/u.test(cursor)) throw new CoreError("invalid_cursor");
    const payload = JSON.parse(decoder.decode(Buffer.from(cursor, "base64url")));
    if (!Array.isArray(payload) || payload.length !== 4 || encode(payload) !== cursor) throw new CoreError("invalid_cursor");
    const [token, binding, occurredAtMs, id] = payload;
    validateSnapshotToken(token);
    if (typeof binding !== "string" || typeof id !== "string" || !id ||
        (occurredAtMs !== null && !Number.isSafeInteger(occurredAtMs))) throw new CoreError("invalid_cursor");
    return { token, binding, occurredAtMs, ref: { id } };
  } catch {
    throw new CoreError("invalid_cursor");
  }
}

/** @param {PageKey} a @param {PageKey} b */
function pageOrder(a, b) {
  const x = a.occurredAtMs;
  const y = b.occurredAtMs;
  return (x === y ? 0 : x === null ? 1 : y === null ? -1 : x - y) || compareUtf8(a.ref.id, b.ref.id);
}

/** @param {Scope} scope @param {string} id */
function refAddress({ owner, namespace }, id) {
  try {
    const address = JSON.parse(id);
    if (!Array.isArray(address) || address.length !== 5 || JSON.stringify(address) !== id) return null;
    const [refOwner, refNamespace, client, sessionId, messageId] = address;
    if (refOwner !== owner || refNamespace !== namespace ||
        typeof client !== "string" || typeof sessionId !== "string" || typeof messageId !== "string") return null;
    return { client, sessionId, messageId };
  } catch {
    return null;
  }
}

/** @param {Port} port @param {SessionHasher} hashSession @param {string} storeKey
 * @param {MigratedRawPolicy} [migratedRaw] @param {MigratedCaptureControls} [controls] */
export function createRawReads(port, hashSession, storeKey, migratedRaw, controls) {
  const stateToken = createSnapshotToken(storeKey);
  const binding = randomUUID();

  /** @param {Connection} db @param {Scope} scope @param {RetrievalScope} selection */
  function visibility(db, scope, { clients, window }) {
    if (controls && !controls.rawReadable(scope)) return () => false;
    const facts = readFacts(db, scope);
    /** @type {Map<string, ReturnType<typeof rawFactPolicy> | null>} */
    const sessions = new Map();
    return (/** @type {RawRow} */ row) => {
      if (clients && !clients.includes(row.client)) return false;
      const time = row.message.occurredAtMs;
      if (window && (time === null ||
          (window.sinceMs !== undefined && time < window.sinceMs) ||
          (window.untilMs !== undefined && time >= window.untilMs))) return false;
      const key = JSON.stringify([row.client, row.sessionId]);
      let policy = sessions.get(key);
      if (policy === undefined) {
        const candidate = rawFactPolicy(scope, row, facts, hashSession);
        policy = (migratedRaw
          ? migratedRaw.blocksSession(db, scope, row, [])
          : hasRawFence(db, scope, candidate.sessionKeyHash)) ? null : candidate;
        sessions.set(key, policy);
      }
      return policy !== null && !policy.hides(row.message) && !migratedRaw?.blocksUuid(db, scope, row, row.message.id);
    };
  }

  /** @param {Connection} db @param {RetrievalScope} selection */
  function* visibleRows(db, selection) {
    for (const namespace of selection.namespaces) {
      if (namespace === "") continue;
      const scope = { owner: selection.owner, namespace };
      const visible = visibility(db, scope, selection);
      for (const record of rawRows(db, scope)) {
        const row = decodeRawRow(record);
        if (visible(row)) yield rawSegment(scope, row, 0);
      }
    }
  }

  /** @type {RawCandidates & ListRawMessages} */
  const reads = {
    raw(tx, scope, query, intent, options) {
      return port(tx, scope?.owner, {}, db => {
        const selection = readSet(tx.owner, scope);
        if (typeof query !== "string" || (intent !== "search" && intent !== "context") ||
            !options || typeof options !== "object") invalidInput();
        const { limit, offset } = options;
        validateLimit(limit);
        if (offset !== undefined && (!Number.isSafeInteger(offset) || offset < 0)) invalidInput();
        const terms = tokenizeT1(query);
        const documents = terms.length === 0 ? [] : Array.from(visibleRows(db, selection), row => ({ ...row, text: row.content }));
        const pool = rankLexical(documents, terms, offset === undefined ? limit : 100);
        const coverage = { complete: true };
        if (offset === undefined) return { segments: pool, coverage };
        const members = documents.map(({ ref }) => ref.id).sort();
        const state = sha256(JSON.stringify([members, pool]));
        return { segments: pool.slice(offset, offset + limit), coverage, page: { state, hasMore: offset + limit < pool.length } };
      });
    },

    listRaw(tx, scope, page) {
      return port(tx, scope?.owner, {}, db => {
        const selection = readSet(tx.owner, scope);
        if (!page || typeof page !== "object") invalidInput();
        const { limit, cursor } = page;
        validateLimit(limit);
        const after = cursor === null ? null : decode(cursor);
        const token = stateToken(db, selection);
        if (after && (after.token !== token || after.binding !== binding)) throw new CoreError("cursor_stale");
        const rows = Array.from(visibleRows(db, selection))
          .filter(row => !after || pageOrder(row, after) > 0).sort(pageOrder);
        const items = rows.slice(0, limit);
        const last = items.at(-1);
        const nextCursor = last && rows.length > limit ? encode([token, binding, last.occurredAtMs, last.ref.id]) : null;
        return { items, nextCursor };
      });
    },
  };

  /** @param {Connection} db @param {RetrievalScope} selection @param {readonly ItemRef[]} refs */
  function visibleRawRows(db, selection, refs) {
    /** @type {Map<Scope["namespace"], ReturnType<typeof visibility>>} */
    const policies = new Map();
    /** @type {Map<string, RawSegment>} */
    const found = new Map();
    for (const { type, id, namespace } of refs) {
      if (type !== "raw" || namespace === "" || !selection.namespaces.includes(namespace) || found.has(id)) continue;
      const scope = { owner: selection.owner, namespace };
      const address = refAddress(scope, id);
      if (!address) continue;
      const row = readRawRow(db, scope, address, address.messageId);
      if (!row) continue;
      let visible = policies.get(namespace);
      if (!visible) {
        visible = visibility(db, scope, selection);
        policies.set(namespace, visible);
      }
      if (visible(row)) found.set(id, rawSegment(scope, row, 0));
    }
    return [...found.values()];
  }

  return { reads, visibleRawRows };
}
