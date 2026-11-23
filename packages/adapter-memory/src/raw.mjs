import { allDigests, compareUtf8, CoreError, coreDigest, factHidesRow, tokenizeT1 } from "@cairn-ink/core";
import { decodePayload, encodePayload } from "./cursor.mjs";
import { addKeyedDigest, validateFact } from "./privacy.mjs";
import { rankLexical, stateToken, validateToken } from "./retrieval.mjs";
import { admissionScope, copyCaptureMessages, copyReadScope, snapshotArray, validateLimit, writeNamespace } from "./validation.mjs";

/** @import { FactMatchPolicy, FactMatchRow, StoredFact, TextDigest } from "@cairn-ink/core" */
/** @import { CaptureMessage, Namespace, RawSegment, RetrievalScope, Scope, StorageAdapter, Tx } from "@cairn-ink/core/ports" */
/** @import { IssuedRun, State } from "./unit-of-work.mjs" */
/** @typedef {Omit<RawSegment, "score">} RawEntry */
/** @typedef {Pick<RawEntry, "client" | "sessionId">} Session */
/** @typedef {Pick<RawEntry, "occurredAtMs"> & {ref: {id: string}}} PageKey */

const encoder = new TextEncoder();

/** @param {Namespace} namespace @param {Session} session */
function sessionSlot(namespace, { client, sessionId }) {
  return JSON.stringify([namespace, client, sessionId]);
}

/** @param {Scope} scope @param {Session} session @param {CaptureMessage} message @returns {RawEntry} */
function rawEntry({ owner, namespace }, { client, sessionId }, { id, role, content, occurredAtMs }) {
  return {
    ref: { type: "raw", namespace, id: JSON.stringify([owner, namespace, client, sessionId, id]) },
    client, sessionId, messageId: id, role, content, occurredAtMs,
  };
}

/** @param {PageKey} a @param {PageKey} b */
function pageOrder(a, b) {
  const x = a.occurredAtMs;
  const y = b.occurredAtMs;
  return (x === y ? 0 : x === null ? 1 : y === null ? -1 : x - y) || compareUtf8(a.ref.id, b.ref.id);
}

/** @param {string} cursor */
function decodePage(cursor) {
  const [token, binding, time, id, ...extra] = decodePayload(cursor);
  if (extra.length || typeof token !== "string" || typeof binding !== "string" ||
      (time !== null && (typeof time !== "number" || !Number.isSafeInteger(time))) ||
      typeof id !== "string" || !id) throw new CoreError("invalid_cursor");
  validateToken(token);
  return { token, binding, occurredAtMs: time, ref: { id } };
}

/** @param {Session} session @returns {Session} */
function copySession(session) {
  if (!session || typeof session !== "object") throw new CoreError("invalid_input");
  const { client, sessionId } = session;
  if (typeof client !== "string" || !client || typeof sessionId !== "string" || !sessionId) {
    throw new CoreError("invalid_input");
  }
  return { client, sessionId };
}

/** @param {StoredFact} stored @returns {StoredFact} */
function copyStoredFact(stored) {
  if (!stored || typeof stored !== "object") throw new CoreError("invalid_input");
  const { fact, factId, incarnation, epoch, createdAtMs } = stored;
  if (typeof factId !== "string" || !factId || typeof incarnation !== "string" ||
      typeof epoch !== "bigint" || !Number.isSafeInteger(createdAtMs)) throw new CoreError("invalid_input");
  return { fact: structuredClone(validateFact(fact)), factId, incarnation, epoch, createdAtMs };
}

/** @param {IssuedRun} run */
function advanceRevision(run) {
  // Raw mutations contribute one revision apiece, including when batched in one run.
  run.state.indexRevision++;
  run.stateWritten = true;
}

/** @param {RawSegment} segment @returns {RawSegment} */
function publicSegment(segment) {
  return { ...segment, ref: { ...segment.ref } };
}

/**
 * @param {ReturnType<typeof import("./unit-of-work.mjs").createUnitOfWork>} work
 * @param {import("./privacy.mjs").RingKeys} ringKeys
 * @param {FactMatchPolicy["hashSessionKey"]} [hashSessionKey]
 */
export function createRawPorts({ port, runSeed }, ringKeys, hashSessionKey) {
  const cursorBinding = crypto.randomUUID();
  const policy = { hashSessionKey, rowShingles: false };
  let rawKeyConflict = 0;
  let rawArchiveRefused = 0;

  /** @param {Session} session */
  async function spanSessionHash({ client, sessionId }) {
    if (hashSessionKey) {
      try {
        return hashSessionKey(client, sessionId) ?? "";
      } catch {
        return "";
      }
    }
    const bytes = await crypto.subtle.digest("SHA-256", encoder.encode(JSON.stringify([client, sessionId])));
    return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  /** @param {State} state @param {Scope} scope */
  function scopedFacts(state, { owner, namespace }) {
    return [...state.facts.values()].filter(({ fact }) => fact.owner === owner && (fact.namespace ?? null) === namespace);
  }

  /** @param {RawEntry} row @param {Scope} scope @param {string} sessionKeyHash @param {TextDigest[]} [digests]
   * @returns {Extract<FactMatchRow, {type: "raw"}>}
   */
  function evidence(row, scope, sessionKeyHash, digests) {
    const { client, sessionId, messageId, occurredAtMs, content } = row;
    return { type: "raw", scope, source: { client, sessionId, occurredAtMs }, sessionKeyHash,
      messageKey: messageId, startUtf16: 0, endUtf16: content.length, digests };
  }

  /** @param {State} state @param {Scope} scope @param {Session} session @param {StoredFact[]} facts */
  function allowsArchive(state, scope, session, facts) {
    if (state.rawFences.has(sessionSlot(scope.namespace, session))) return false;
    const row = { type: /** @type {const} */ ("raw"), scope, source: session,
      sessionKeyHash: "", messageKey: "", startUtf16: 0, endUtf16: 0 };
    return !facts.some((stored) => stored.fact.kind === "session" && factHidesRow(stored, row, policy) !== false);
  }

  /** @param {Scope} scope @param {StoredFact[]} facts */
  function readEvidence(scope, facts) {
    const useDigests = facts.some(({ fact }) => fact.kind === "text");
    const useSpans = facts.some(({ fact }) => fact.kind === "rawSpan");
    /** @type {ReturnType<typeof ringKeys> | undefined} */
    let keys;
    return async (/** @type {RawEntry} */ row) => {
      const hash = useSpans ? await spanSessionHash(row) : "";
      if (!useDigests) return evidence(row, scope, hash);
      const [digests, ownerKeys] = await Promise.all([
        allDigests(row.content, null), keys ??= ringKeys(scope.owner),
      ]);
      for (const keyed of await Promise.all(ownerKeys.map((key) => coreDigest(row.content, key)))) {
        addKeyedDigest(digests, keyed);
      }
      return evidence(row, scope, hash, digests);
    };
  }

  /** @param {State} state @param {RetrievalScope} selection */
  async function visibleRows(state, selection) {
    const byNamespace = new Map(selection.namespaces.map((namespace) => {
      const scope = { owner: selection.owner, namespace };
      const facts = scopedFacts(state, scope);
      return [namespace, { facts, project: readEvidence(scope, facts) }];
    }));
    const clients = selection.clients && new Set(selection.clients);
    const eligible = [...state.rawRows.values()].filter((row) =>
      byNamespace.has(row.ref.namespace) && (!clients || clients.has(row.client)) &&
      !state.rawFences.has(sessionSlot(row.ref.namespace, row)));
    const rows = [];
    for (const row of eligible) {
      const match = byNamespace.get(row.ref.namespace);
      if (!match) continue;
      if (match.facts.length) {
        const candidate = await match.project(row);
        if (match.facts.some((stored) => factHidesRow(stored, candidate, policy) !== false)) continue;
      }
      rows.push(row);
    }
    return rows;
  }

  /** @param {Tx} tx @param {Scope} scope @param {() => Session[]} prepare */
  function deleteSessions(tx, scope, prepare) {
    return port.write(tx, scope, "conditional", () => {
      const namespace = writeNamespace(scope);
      const slots = new Set(prepare().map((session) => sessionSlot(namespace, session)));
      return (getState, _markDirty, run) => {
        const state = getState();
        let rawDeleted = 0;
        for (const [id, row] of state.rawRows) {
          if (slots.has(sessionSlot(row.ref.namespace, row))) {
            state.rawRows.delete(id);
            rawDeleted++;
          }
        }
        if (rawDeleted) advanceRevision(run);
        return { rawDeleted };
      };
    });
  }

  /** @type {NonNullable<StorageAdapter["raw"]>} */
  const raw = {
    async recordLineage(tx, key, messages) {
      const scope = admissionScope(tx, key);
      return port.write(tx, scope, "conditional", () => {
        scope.copyKey();
        copyCaptureMessages(messages);
        return () => {};
      });
    },
    async archiveAllowed(tx, key) {
      const scope = admissionScope(tx, key);
      return port.read(tx, scope, (getState) => {
        const admission = scope.copyKey();
        const state = getState();
        return allowsArchive(state, admission.scope, admission, scopedFacts(state, admission.scope));
      });
    },
    async archive(tx, key, messages) {
      const guarded = admissionScope(tx, key);
      return port.write(tx, guarded, "conditional", () => {
        const admission = guarded.copyKey();
        const { scope } = admission;
        const entries = copyCaptureMessages(messages).map((message) => rawEntry(scope, admission, message));
        return async (getState, _markDirty, run) => {
          if (!entries.length) return { archived: 0 };
          const state = getState();
          const facts = scopedFacts(state, scope);
          const allowed = allowsArchive(state, scope, admission, facts);
          const refusalFacts = facts.filter(({ fact }) => fact.kind === "window" || fact.kind === "rawSpan");
          const hash = allowed && refusalFacts.some(({ fact }) => fact.kind === "rawSpan") ? await spanSessionHash(admission) : "";
          let archived = 0;
          for (const entry of entries) {
            const previous = state.rawRows.get(entry.ref.id);
            if (previous && previous.content !== entry.content) rawKeyConflict++;
            const candidate = evidence(entry, scope, hash);
            if (!allowed || refusalFacts.some((stored) => factHidesRow(stored, candidate, policy) === true)) {
              rawArchiveRefused++;
              continue;
            }
            if (previous) continue;
            state.rawRows.set(entry.ref.id, entry);
            archived++;
          }
          if (archived) advanceRevision(run);
          return { archived };
        };
      });
    },
    async raw(tx, scope, query, intent, options) {
      return port.read(tx, scope, async (getState) => {
        const selection = copyReadScope(tx.owner, scope);
        if (typeof query !== "string" || (intent !== "search" && intent !== "context") ||
            !options || typeof options !== "object") throw new CoreError("invalid_input");
        const { limit } = options;
        validateLimit(limit);
        const terms = tokenizeT1(query);
        const coverage = { complete: true };
        if (terms.length === 0) return { segments: [], coverage };
        const rows = await visibleRows(getState(), selection);
        const documents = rows.map((row) => ({ ...row, text: row.content }));
        return { segments: rankLexical(documents, terms, limit).map(publicSegment), coverage };
      });
    },
    async listRaw(tx, scope, page) {
      return port.read(tx, scope, async (getState) => {
        const selection = copyReadScope(tx.owner, scope);
        if (!page || typeof page !== "object") throw new CoreError("invalid_input");
        const { cursor, limit } = page;
        validateLimit(limit);
        const after = cursor === null ? null : decodePage(cursor);
        const state = getState();
        const token = stateToken(selection, state.indexRevision);
        if (after && (after.token !== token || after.binding !== cursorBinding)) throw new CoreError("cursor_stale");
        const rows = (await visibleRows(state, selection)).filter((row) => !after || pageOrder(row, after) > 0).sort(pageOrder);
        const items = rows.slice(0, limit).map((row) => publicSegment({ ...row, score: 0 }));
        const last = items.at(-1);
        return { items, nextCursor: last && rows.length > limit ?
          encodePayload([token, cursorBinding, last.occurredAtMs, last.ref.id]) : null };
      });
    },
    async fenceSession(tx, scope, session) {
      return port.write(tx, scope, "conditional", () => {
        const slot = sessionSlot(writeNamespace(scope), copySession(session));
        return (getState, _markDirty, run) => {
          const { rawFences } = getState();
          if (rawFences.has(slot)) return;
          rawFences.add(slot);
          advanceRevision(run);
        };
      });
    },
    async deleteConversation(tx, scope, session) {
      return deleteSessions(tx, scope, () => [copySession(session)]);
    },
    async eraseSessions(tx, scope, closure) {
      const { rawDeleted } = await deleteSessions(tx, scope, () => snapshotArray(closure).map(copySession));
      return { rawDeleted, ledgerBlanked: 0 };
    },
    async purgeWithheld(tx, scope, facts) {
      return port.write(tx, scope, "conditional", () => {
        const target = { owner: tx.owner, namespace: writeNamespace(scope) };
        const candidates = snapshotArray(facts).map(copyStoredFact).filter(({ fact }) =>
          (fact.kind === "text" || fact.kind === "rawSpan") && fact.owner === target.owner &&
          (fact.namespace ?? null) === target.namespace);
        const project = readEvidence(target, candidates);
        return async (getState, _markDirty, run) => {
          if (!candidates.length) return { rawDeleted: 0, ledgerBlanked: 0 };
          const state = getState();
          let rawDeleted = 0;
          for (const [id, row] of state.rawRows) {
            if (row.ref.namespace !== target.namespace) continue;
            const candidate = await project(row);
            if (candidates.some((stored) => factHidesRow(stored, candidate, policy) === true)) {
              state.rawRows.delete(id);
              rawDeleted++;
            }
          }
          if (rawDeleted) advanceRevision(run);
          return { rawDeleted, ledgerBlanked: 0 };
        };
      });
    },
  };

  /** @param {Scope} scope @param {string} sessionId @param {CaptureMessage} message */
  async function seedClientlessRaw(scope, sessionId, message) {
    await runSeed(scope.owner, (tx) => port.write(tx, scope, "conditional", () => {
      const target = { owner: tx.owner, namespace: writeNamespace(scope) };
      const [copy] = copyCaptureMessages([message]);
      const row = rawEntry(target, { client: "", sessionId }, copy);
      return (getState, _markDirty, run) => {
        getState().rawRows.set(row.ref.id, row);
        advanceRevision(run);
      };
    }));
  }

  return { raw, seedClientlessRaw, counters: () => ({ rawKeyConflict, rawArchiveRefused }) };
}
