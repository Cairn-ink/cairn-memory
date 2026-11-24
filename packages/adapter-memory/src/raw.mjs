import { allDigests, cleanContent, compareUtf8, CoreError, coreDigest, factHidesRow, tokenizeT1,
  legacyExactMac, PRIVACY_REDACTION_VERSIONS, withholdsAnyPassage } from "@cairn-ink/core";
import { fingerprintMemoryPassages } from "../../core/src/privacy/fingerprint.mjs";
import { requiresLegacyMacDomain } from "../../core/src/privacy/withholds.mjs";
import { prepareMessageContent } from "../../core/src/service/capture.mjs";
import { decodePayload, encodePayload } from "./cursor.mjs";
import { addKeyedDigest, validateFact } from "./privacy.mjs";
import { invalidateRationaleSources } from "./rationale.mjs";
import { receiptAddressKey } from "./receipt-read-safety.mjs";
import { withinWindow } from "./retrieval-window.mjs";
import { rankLexical, stateToken, validateToken } from "./retrieval.mjs";
import { advanceRawInspectEpoch } from "./unit-of-work.mjs";
import { admissionScope, copyCaptureMessages, copyReadScope, guardCaptureScope, snapshotArray, validateLimit,
  writeNamespace } from "./validation.mjs";

/** @import { FactMatchPolicy, FactMatchRow, StoredFact, TextDigest, TextFact } from "@cairn-ink/core" */
/** @import { CaptureKey, CaptureMessage, FingerprintKeyProvider, ItemRef, Namespace, RawSegment, RetrievalScope, Scope, StorageAdapter, Tx } from "@cairn-ink/core/ports" */
/** @import { IssuedRun, State } from "./unit-of-work.mjs" */
/** @typedef {Omit<RawSegment, "score">} RawEntry */
/** @typedef {Pick<RawEntry, "client" | "sessionId">} Session */
/** @typedef {Pick<RawEntry, "client" | "sessionId" | "messageId" | "occurredAtMs" | "content">} RawEvidence */
/** @typedef {Pick<RawEntry, "occurredAtMs"> & {ref: {id: string}}} PageKey */
/** @typedef {{id: string, digest: string | null}} CaptureProof */
/** @typedef {{namespace: Namespace, sessionId: string, messages: Map<string, Set<CaptureProof["digest"]>>}} AnchorSession */

const encoder = new TextEncoder();

/** @param {Namespace} namespace @param {Session} session */
function sessionSlot(namespace, { client, sessionId }) {
  return JSON.stringify([namespace, client, sessionId]);
}

/** @param {Scope} scope @param {Session} session @param {string} id */
function rawId({ owner, namespace }, { client, sessionId }, id) {
  return JSON.stringify([owner, namespace, client, sessionId, id]);
}

/** @param {Scope} scope @param {Session} session @param {CaptureMessage} message @returns {RawEntry} */
function rawEntry(scope, session, { id, role, content, occurredAtMs }) {
  const { client, sessionId } = session;
  return {
    ref: { type: "raw", namespace: scope.namespace, id: rawId(scope, session, id) },
    client, sessionId, messageId: id, role, content, occurredAtMs,
  };
}

/** @param {State} state @param {Namespace} namespace
 * @param {(key: CaptureKey, message: CaptureMessage) => boolean | Promise<boolean>} matches
 */
async function blankCaptureMessages(state, namespace, matches) {
  let blanked = 0;
  for (const { key, messages } of state.claims.values()) {
    if (key.scope.namespace !== namespace || !messages) continue;
    for (const message of messages) {
      if (message.content !== "" && await matches(key, message)) {
        message.content = "";
        blanked++;
      }
    }
  }
  return blanked;
}

/** @param {readonly CaptureMessage[]} messages */
function copyRawMessages(messages) {
  const copied = copyCaptureMessages(messages);
  if (copied.some(({ id }) => id.length === 0)) throw new CoreError("invalid_input");
  return copied;
}

/** @param {unknown} options @param {number} length @returns {Set<number>} */
function copyWithheldPositions(options, length) {
  if (options === undefined) return new Set();
  try {
    if (options === null || typeof options !== "object") throw new CoreError("invalid_input");
    const prototype = Object.getPrototypeOf(options);
    const keys = Reflect.ownKeys(options);
    const slot = Object.getOwnPropertyDescriptor(options, "withheld");
    if ((prototype !== Object.prototype && prototype !== null) || keys.length !== (slot ? 1 : 0) ||
        (slot && (keys[0] !== "withheld" || !Object.hasOwn(slot, "value"))) ||
        ("withheld" in options) !== (slot !== undefined) ||
        !Object.is(slot?.value, Reflect.get(options, "withheld"))) throw new CoreError("invalid_input");
    if (!slot) return new Set();
    const positions = snapshotArray(slot.value, { maxLength: length });
    const withheld = new Set(positions);
    if (withheld.size !== positions.length || positions.some((position) =>
      !Number.isSafeInteger(position) || position < 0 || position >= length)) throw new CoreError("invalid_input");
    return withheld;
  } catch {
    throw new CoreError("invalid_input");
  }
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
 * @param {FingerprintKeyProvider} keys
 * @param {import("./privacy.mjs").RingKeys} ringKeys
 * @param {import("@cairn-ink/core").FingerprintLabels} labels
 * @param {FactMatchPolicy["hashSessionKey"]} [hashSessionKey]
 * @param {boolean} [rationaleEdges]
 */
export function createRawPorts({ port, runSeed }, keys, ringKeys, labels, hashSessionKey, rationaleEdges = false) {
  const cursorBinding = crypto.randomUUID();
  const policy = { hashSessionKey, rowShingles: false };
  let rawKeyConflict = 0;
  let rawArchiveRefused = 0;
  const proofSecret = crypto.getRandomValues(new Uint8Array(32));
  /** @type {CryptoKey | undefined} */
  let proofKey;

  /** @param {State} state @param {string} id */
  function recordRationaleConflict(state, id) {
    if (!rationaleEdges || state.rawConflicts.has(id)) return false;
    state.rawConflicts.add(id);
    return true;
  }

  /** @param {Scope} scope @param {string} client @param {readonly Pick<CaptureMessage, "id" | "content">[]} messages
   * @returns {Promise<CaptureProof[] | null>}
   */
  async function captureProofs({ owner }, client, messages) {
    try {
      const key = messages.some(({ content }) => content !== "") ?
        proofKey ??= await crypto.subtle.importKey("raw", proofSecret,
          { name: "HMAC", hash: "SHA-256" }, false, ["sign"]) : undefined;
      return await Promise.all(messages.map(async ({ id, content }) => {
        if (content === "") return { id, digest: null };
        if (!key) throw new CoreError("fingerprint_unavailable");
        const input = encoder.encode(JSON.stringify(["raw-lineage-content-v1", owner, client, id, content]));
        const bytes = await crypto.subtle.sign("HMAC", key, input);
        const digest = Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
        return { id, digest };
      }));
    } catch {
      return null;
    }
  }

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

  /** @param {Pick<State, "facts">} state @param {Scope} scope */
  function scopedFacts(state, { owner, namespace }) {
    return [...state.facts.values()].filter(({ fact }) => fact.owner === owner && (fact.namespace ?? null) === namespace);
  }

  /** @param {RawEvidence} row @param {Scope} scope @param {string} sessionKeyHash @param {TextDigest[]} [digests]
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

  /** @param {AnchorSession} anchor @param {readonly CaptureProof[]} proofs */
  function matchesAnchor(anchor, proofs) {
    return proofs.some(({ id, digest }) => {
      const recorded = anchor.messages.get(id);
      // Either scrubbed slot leaves only its ID available for comparison.
      return recorded !== undefined && (digest === null || recorded.has(null) || recorded.has(digest));
    });
  }

  /** @param {State} state @param {Scope} scope @param {Session} session
   * @param {readonly CaptureProof[] | null | undefined} proofs
   */
  function lineageFenced(state, scope, session, proofs) {
    if (proofs == null || state.rawFences.has(sessionSlot(scope.namespace, session))) return true;
    const sessions = state.rawAnchors.get(session.client);
    if (!sessions) return false;
    for (const anchor of sessions.values()) {
      if (anchor.sessionId === session.sessionId) continue;
      if (matchesAnchor(anchor, proofs)) {
        const sourceScope = { owner: scope.owner, namespace: anchor.namespace };
        const source = { client: session.client, sessionId: anchor.sessionId };
        if (!allowsArchive(state, sourceScope, source, scopedFacts(state, sourceScope))) return true;
      }
    }
    return false;
  }

  /** @param {Tx} tx @param {TextFact[]} facts */
  function importTextFilter(tx, facts) {
    const legacyKeyUnavailable = facts.some(requiresLegacyMacDomain);
    /** @type {ReturnType<FingerprintKeyProvider["userKey"]> | undefined} */
    let key;
    /** @type {ReturnType<NonNullable<FingerprintKeyProvider["retainedDigesters"]>> | undefined} */
    let retained;
    return async (/** @type {string} */ content) => {
      if (!facts.length) return false;
      try {
        const prepared = prepareMessageContent(cleanContent(content));
        const digesters = await (retained ??= keys.retainedDigesters?.(tx.owner));
        if (!digesters?.length && (legacyKeyUnavailable || !prepared)) return legacyKeyUnavailable;
        const activeKey = await (key ??= keys.userKeyForWrite ? keys.userKeyForWrite(tx) : keys.userKey(tx.owner));
        const evidence = await fingerprintMemoryPassages(content, prepared, activeKey, undefined, digesters);
        return withholdsAnyPassage(evidence, facts);
      } catch {
        return true;
      }
    };
  }

  /** @param {Scope} scope @param {StoredFact[]} facts */
  function readEvidence(scope, facts) {
    const useDigests = facts.some(({ fact }) => fact.kind === "text");
    const useSpans = facts.some(({ fact }) => fact.kind === "rawSpan");
    /** @type {ReturnType<typeof ringKeys> | undefined} */
    let keys;
    return async (/** @type {RawEvidence} */ row) => {
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

  /** @param {State} state @param {Scope} scope
   * @param {import("@cairn-ink/core/ports").DocumentCardSourceMessage} source */
  async function sourceVisible(state, scope, source) {
    const row = state.rawRows.get(rawId(scope, source, source.messageId));
    if (!row || state.rawFences.has(sessionSlot(scope.namespace, source))) return false;
    const facts = scopedFacts(state, scope);
    if (!facts.length) return true;
    const candidate = await readEvidence(scope, facts)(row);
    return facts.every((stored) => factHidesRow(stored, candidate, policy) === false);
  }

  /** @param {Pick<State, "facts" | "rawFences" | "rawRows">} state @param {RetrievalScope} selection */
  async function visibleRows(state, selection) {
    const byNamespace = new Map(selection.namespaces.map((namespace) => {
      const scope = { owner: selection.owner, namespace };
      const facts = scopedFacts(state, scope);
      return [namespace, { facts, project: readEvidence(scope, facts) }];
    }));
    const clients = selection.clients && new Set(selection.clients);
    const eligible = [...state.rawRows.values()].filter((row) =>
      byNamespace.has(row.ref.namespace) && (!clients || clients.has(row.client)) &&
      withinWindow(selection.window, row.occurredAtMs) &&
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

  /** @param {State} state @param {Scope} scope @param {Session & {messageId: string}} receipt */
  async function findVisibleSource(state, scope, receipt) {
    const id = rawId(scope, receipt, receipt.messageId);
    const row = state.rawRows.get(id);
    if (!row || state.rawConflicts.has(id)) return undefined;
    const [visible] = await visibleRows({ ...state, rawRows: new Map([[id, row]]) },
      { owner: scope.owner, namespaces: [scope.namespace] });
    return visible;
  }

  /** @param {State} state @param {Scope} scope @param {RawEvidence & Pick<RawEntry, "role">} archived */
  async function sourceLineageVisible(state, scope, archived) {
    const { client, sessionId, messageId, role, content } = archived;
    const roots = state.rawAnchors.get(client);
    if (!roots) return true;
    const proofs = await captureProofs(scope, client, [{ id: messageId, content }]);
    if (!proofs) return false;
    for (const root of roots.values()) {
      if (root.namespace === scope.namespace && root.sessionId === sessionId) continue;
      if (!matchesAnchor(root, proofs)) continue;
      const target = { owner: scope.owner, namespace: root.namespace };
      const source = { client, sessionId: root.sessionId, messageId };
      const row = await findVisibleSource(state, target, source);
      if (!row?.content || row.role !== role ||
          (state.receiptDenials.size && state.receiptDenials.has(await receiptAddressKey(target.namespace, source)))) return false;
    }
    return true;
  }

  /** @param {State} state @param {Scope} scope @param {import("@cairn-ink/core/ports").Receipt} receipt
   * @param {string} [admittedContent] */
  async function receiptSourcesVisible(state, scope, receipt, admittedContent) {
    const { client, sessionId, messageId, role } = receipt;
    const roots = state.rawAnchors.get(client);
    const id = rawId(scope, receipt, messageId);
    if (!state.rawRows.has(id)) {
      const slot = sessionSlot(scope.namespace, receipt);
      if (state.rawFences.has(slot) || state.rawConflicts.has(id)) return false;
      if (admittedContent !== undefined) {
        const source = { ...receipt, content: admittedContent };
        const facts = scopedFacts(state, scope);
        const candidate = await readEvidence(scope, facts)(source);
        return facts.every(stored => factHidesRow(stored, candidate, policy) === false) &&
          sourceLineageVisible(state, scope, source);
      }
      if (roots?.has(slot)) return false;
      // Without the archived turn, the excerpt cannot disambiguate matching IDs.
      for (const root of roots?.values() ?? []) if (root.messages.has(messageId)) return false;
      for (const row of state.rawRows.values()) {
        if (row.ref.namespace === scope.namespace && row.client === client && row.sessionId === sessionId) return false;
      }
      return true;
    }
    const archived = await findVisibleSource(state, scope, receipt);
    if (!archived?.content || archived.role !== role ||
        (admittedContent !== undefined && admittedContent !== archived.content)) return false;
    return sourceLineageVisible(state, scope, archived);
  }

  /** @param {State} state @param {RetrievalScope} selection @param {readonly ItemRef[]} refs */
  async function visibleRawRefs(state, selection, refs) {
    /** @type {State["rawRows"]} */
    const rawRows = new Map();
    for (const ref of refs) {
      if (ref.type !== "raw") continue;
      const row = state.rawRows.get(ref.id);
      if (row && row.ref.namespace === ref.namespace) rawRows.set(ref.id, row);
    }
    if (!rawRows.size) return [];
    const { facts, rawFences } = state;
    const rows = await visibleRows({ facts, rawFences, rawRows }, selection);
    return rows.map(({ ref }) => ({ ...ref }));
  }

  /** @param {Tx} tx @param {Scope} scope @param {() => Session[]} prepare @param {boolean} [eraseLedger] */
  function deleteSessions(tx, scope, prepare, eraseLedger = false) {
    return port.write(tx, scope, "conditional", () => {
      const namespace = writeNamespace(scope);
      const slots = new Set(prepare().map((session) => sessionSlot(namespace, session)));
      return async (getState, _markDirty, run) => {
        const state = getState();
        const deleted = [];
        for (const [id, row] of state.rawRows) {
          if (slots.has(sessionSlot(row.ref.namespace, row))) {
            state.rawRows.delete(id);
            state.rawConflicts.delete(id);
            state.receiptDenials.add(await receiptAddressKey(namespace, row));
            deleted.push(row);
          }
        }
        await invalidateRationaleSources(state, namespace, deleted);
        const ledgerBlanked = eraseLedger ? await blankCaptureMessages(state, namespace,
          (key) => slots.has(sessionSlot(namespace, key))) : 0;
        if (deleted.length || ledgerBlanked) advanceRawInspectEpoch(state);
        if (deleted.length) advanceRevision(run);
        if (ledgerBlanked) run.stateWritten = true;
        return { rawDeleted: deleted.length, ledgerBlanked };
      };
    });
  }

  /** @satisfies {NonNullable<StorageAdapter["raw"]>} */
  const raw = {
    async recordLineage(tx, key, messages) {
      const scope = admissionScope(tx, key);
      return port.write(tx, scope, "conditional", () => {
        const { scope: selection, client, sessionId } = scope.copyKey();
        const copied = copyCaptureMessages(messages);
        return async (getState, _markDirty, run) => {
          if (!copied.length) return;
          const state = getState();
          const { rawAnchors } = state;
          const proofs = await captureProofs(selection, client, copied);
          if (proofs === null) throw new CoreError("fingerprint_unavailable");
          const sessions = rawAnchors.get(client) ?? new Map();
          const slot = sessionSlot(selection.namespace, { client, sessionId });
          const anchor = sessions.get(slot) ?? { namespace: selection.namespace, sessionId, messages: new Map() };
          for (const { id, digest } of proofs) {
            const recorded = anchor.messages.get(id) ?? new Set();
            if (recorded.has(digest)) continue;
            recorded.add(digest);
            anchor.messages.set(id, recorded);
            advanceRawInspectEpoch(state);
            run.stateWritten = true;
          }
          sessions.set(slot, anchor);
          rawAnchors.set(client, sessions);
        };
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
        const entries = copyRawMessages(messages).map((message) => rawEntry(scope, admission, message));
        return async (getState, markDirty, run) => {
          if (!entries.length) return { archived: 0 };
          const state = getState();
          const facts = scopedFacts(state, scope);
          const allowed = allowsArchive(state, scope, admission, facts);
          const refusalFacts = facts.filter(({ fact }) => fact.kind === "window" || fact.kind === "rawSpan");
          const hash = allowed && refusalFacts.some(({ fact }) => fact.kind === "rawSpan") ? await spanSessionHash(admission) : "";
          let archived = 0;
          let newConflict = false;
          for (const entry of entries) {
            const previous = state.rawRows.get(entry.ref.id);
            if (previous && previous.content !== entry.content) {
              rawKeyConflict++;
              if (recordRationaleConflict(state, entry.ref.id)) newConflict = true;
            }
            const candidate = evidence(entry, scope, hash);
            if (!allowed || refusalFacts.some((stored) => {
              const { fact } = stored;
              if (fact.kind !== "rawSpan") return factHidesRow(stored, candidate, policy) === true;
              // Use the saved bounds so admission depends only on the message identity.
              const { startUtf16, endUtf16 } = fact;
              return factHidesRow(stored, { ...candidate, startUtf16, endUtf16 }, policy) !== false;
            })) {
              rawArchiveRefused++;
              continue;
            }
            if (previous) continue;
            state.rawRows.set(entry.ref.id, entry);
            archived++;
          }
          if (newConflict || archived) advanceRawInspectEpoch(state);
          if (newConflict && !archived) markDirty();
          if (archived) advanceRevision(run);
          return { archived };
        };
      });
    },
    async importArchive(tx, scope, session, messages, options) {
      const guarded = guardCaptureScope(tx, () => scope);
      return port.write(tx, guarded, "conditional", () => {
        const selection = guarded.copyScope();
        const admission = copySession(session);
        const copied = copyRawMessages(messages);
        const withheld = copyWithheldPositions(options, copied.length);
        return async (getState, _markDirty, run) => {
          const counts = { archived: 0, existing: 0, withheld: 0 };
          if (!copied.length) return counts;
          const state = getState();
          const facts = scopedFacts(state, selection);
          if (!allowsArchive(state, selection, admission, facts) ||
              lineageFenced(state, selection, admission, await captureProofs(selection, admission.client, copied))) {
            return { ...counts, withheld: copied.length };
          }
          const windows = facts.filter(({ fact }) => fact.kind === "window");
          const spans = facts.filter(({ fact }) => fact.kind === "rawSpan");
          const texts = facts.map(({ fact }) => fact).filter((fact) => fact.kind === "text");
          const textBlocked = importTextFilter(tx, texts);
          const hash = spans.length ? await spanSessionHash(admission).catch(() => "") : "";
          counts.withheld = withheld.size;
          for (let position = 0; position < copied.length; position++) {
            if (withheld.has(position)) continue;
            const entry = rawEntry(selection, admission, copied[position]);
            const { id } = entry.ref;
            const previous = state.rawRows.get(id);
            const candidate = evidence(entry, selection, hash);
            if (windows.some((stored) => factHidesRow(stored, candidate, policy) !== false) ||
                spans.some((stored) => stored.fact.kind === "rawSpan" && factHidesRow(stored, {
                  ...candidate, startUtf16: stored.fact.startUtf16, endUtf16: stored.fact.endUtf16,
                }, policy) !== false) || await textBlocked(entry.content)) {
              counts.withheld++;
            } else if (previous) {
              counts.existing++;
              if (previous.content !== entry.content && recordRationaleConflict(state, id)) {
                // The rationale guard changed, while the Raw index stayed the same.
                advanceRawInspectEpoch(state);
                run.stateWritten = true;
              }
            } else {
              state.rawRows.set(id, entry);
              counts.archived++;
            }
          }
          if (counts.archived) {
            advanceRawInspectEpoch(state);
            advanceRevision(run);
          }
          return counts;
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
          const state = getState();
          const { rawFences } = state;
          if (rawFences.has(slot)) return;
          rawFences.add(slot);
          advanceRawInspectEpoch(state);
          advanceRevision(run);
        };
      });
    },
    async deleteConversation(tx, scope, session) {
      const { rawDeleted } = await deleteSessions(tx, scope, () => [copySession(session)]);
      return { rawDeleted };
    },
    async eraseSessions(tx, scope, closure) {
      return deleteSessions(tx, scope, () => snapshotArray(closure).map(copySession), true);
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
          const deleted = [];
          const hasEdges = state.rationale.has(target.namespace);
          let rawDeleted = 0;
          for (const [id, row] of state.rawRows) {
            if (row.ref.namespace === target.namespace && await matches(row)) {
              state.rawRows.delete(id);
              state.rawConflicts.delete(id);
              state.receiptDenials.add(await receiptAddressKey(target.namespace, row));
              if (hasEdges) deleted.push(row);
              rawDeleted++;
            }
          }
          /** @param {RawEvidence} row */
          async function matches(row) {
            const candidate = await project(row);
            return candidates.some((stored) => factHidesRow(stored, candidate, policy) === true);
          }
          await invalidateRationaleSources(state, target.namespace, deleted);
          const ledgerBlanked = await blankCaptureMessages(state, target.namespace,
            ({ client, sessionId }, { id, content, occurredAtMs }) =>
              matches({ client, sessionId, messageId: id, content, occurredAtMs }));
          if (rawDeleted || ledgerBlanked) advanceRawInspectEpoch(state);
          if (rawDeleted) advanceRevision(run);
          if (ledgerBlanked) run.stateWritten = true;
          return { rawDeleted, ledgerBlanked };
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

  return { raw, findVisibleSource, visibleRawRefs, captureProofs, lineageFenced, sourceVisible, sourceLineageVisible,
    receiptSourcesVisible, seedClientlessRaw,
    counters: () => ({ rawKeyConflict, rawArchiveRefused }) };
}
