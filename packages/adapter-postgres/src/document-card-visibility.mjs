import { CoreError, factHidesRow } from "../../core/src/index.mjs";
import { documentCardVisible } from "../../core/src/routing/index.mjs";
import { HOSTED_FINGERPRINT_LABELS } from "./fingerprint-labels.mjs";
import { hasRawFence } from "./capture-source.mjs";
import { selectMemory, readReceipts } from "./memory-rows.mjs";
import { matchesRowFact, readVisibility, readVisibilityFacts, rowFactCandidate, rowVisibilityPolicy } from "./memory-visibility.mjs";
import { rawSpanFilter } from "./raw-import.mjs";
import { RAW_READ_COLUMNS, RAW_READ_FILTER, decodeRawSegment } from "./raw-read.mjs";
import { rawTextDefinitelyWithheld } from "./raw-purge.mjs";
import { conversationSessions, rawSession } from "./raw-session.mjs";
import { createRawVisibility } from "./raw-visibility.mjs";

/** @import { FingerprintKey, StoredFact, TextFact } from "../../core/src/index.mjs" */
/** @import { FactMatchRow } from "../../core/src/index.mjs" */
/** @import { DocumentCardSourceMessage, Receipt, Scope } from "../../core/src/ports/index.d.ts" */
/** @import { DocumentCardMemoryState, DocumentCardVisibilityInput } from "../../core/src/routing/visibility.mjs" */
/** @import { CardWrite, Links } from "./document-card-rows.mjs" */
/** @import { MemoryEntry, Query } from "./memory-rows.mjs" */
/** @import { RawReadOptions } from "./raw-visibility.mjs" */
/** @typedef {Partial<RawReadOptions> & {
 *   sessionKey?: (client: string, sessionId: string) => string,
 *   fingerprintKey?: (owner: string) => FingerprintKey | null | Promise<FingerprintKey | null>,
 * }} DocumentCardOptions */

const MISSING_RAW = "missing_raw";

/** @param {CardWrite} card */
function bindings(card) {
  return [...(card.sourceMessage ? [card.sourceMessage] : []), ...card.sentences.map(sentence => sentence.source)];
}

/** @param {StoredFact[]} facts @returns {StoredFact<TextFact>[]} */
function textFacts(facts) {
  return /** @type {StoredFact<TextFact>[]} */ (facts.filter(({ fact }) => fact.kind === "text"));
}

/** @param {StoredFact[]} facts @param {Links[number]} link @param {MemoryEntry | null} entry */
function hasCorrection(facts, link, entry) {
  return facts.some(({ fact }) => fact.kind === "text" && (fact.origin === "edit" || fact.origin === "correct") &&
    (!fact.sourceMemory || (fact.sourceMemory.id === link.id &&
      (!entry || fact.sourceMemory.createdAtMs === entry.memory.createdAtMs))));
}

/** @param {StoredFact} stored @param {FactMatchRow} row @param {readonly Receipt[]} receipts
 * @param {MemoryEntry["memory"]} memory @param {ReturnType<typeof rowVisibilityPolicy>} policy */
function definitelyHidesMemory(stored, row, receipts, memory, policy) {
  const { fact } = stored;
  if (fact.kind === "session") {
    const sources = receipts.length ? receipts : [memory.source];
    return sources.some(({ client, sessionId }) => client !== null && sessionId !== null &&
      factHidesRow(stored, { ...row, source: { client, sessionId } }, policy) === true);
  }
  if (fact.kind === "window") return !receipts.length && [memory.createdAtMs, memory.updatedAtMs].some(occurredAtMs =>
    factHidesRow(stored, { ...row, source: { client: memory.source.client ?? "", occurredAtMs } }, policy) === true);
  if (fact.kind === "text" && fact.legacyTextHash !== undefined) {
    if (memory.textHash === "sha256:" + fact.legacyTextHash) return true;
    if (fact.mode === "exact") return false;
  }
  return factHidesRow(stored, row, policy) === true;
}

/** @param {DocumentCardOptions} options */
export function createCardVisibility({
  sessionKey = (client, sessionId) => JSON.stringify([client, sessionId]),
  hashSessionKey, lineageSecret, fingerprintKey, fingerprintKeys, onLineageOverflow,
}) {
  /** @param {string} owner */
  async function readKeys(owner) {
    const keys = await fingerprintKeys?.(owner) ?? [];
    const active = fingerprintKey ? await fingerprintKey(owner) : keys[0] ?? null;
    return { active, keys: active ? [active, ...keys.filter(key => key.id !== active.id)] : keys };
  }
  const rawVisibility = lineageSecret === undefined ? null : createRawVisibility({
    lineageSecret, hashSessionKey, onLineageOverflow, fingerprintKeys: async owner => (await readKeys(owner)).keys,
  });

  /** @param {Query} query @param {Scope} scope @param {{actionId: string, factIds: readonly string[]}} [action] */
  function reader(query, scope, action) {
    const owner = scope.owner;
    const actionIds = new Set(action?.factIds);
    /** @type {Promise<StoredFact[]> | undefined} */
    let allFacts;
    const facts = () => allFacts ??= readVisibilityFacts(query, owner, { rawSpans: true })
      .then(rows => rows.filter(({ fact }) => fact.namespace == null));
    const selected = async () => (await facts()).filter(({ fact, factId }) => !action ||
      (actionIds.has(factId) && fact.origin === "forget"));
    /** @type {Map<string, Promise<MemoryEntry | null>>} */
    const memories = new Map();
    /** @type {Map<string, Promise<boolean | null | typeof MISSING_RAW>>} */
    const verdicts = new Map();
    /** @type {ReturnType<typeof readKeys> | undefined} */
    let keys;
    /** @type {ReturnType<NonNullable<typeof rawVisibility>> | undefined} */
    let raw;
    /** @type {ReturnType<typeof readVisibility> | undefined} */
    let memoryVisibility;

    /** @param {string} id */
    function memory(id) {
      let entry = memories.get(id);
      if (!entry) memories.set(id, entry = selectMemory(query, owner, null, id));
      return entry;
    }

    /** @param {DocumentCardSourceMessage} source */
    async function sourceVerdict(source) {
      const physical = await rawSession(query, scope, source);
      const related = await conversationSessions(query, scope, source);
      const address = [owner, related.map(({ client }) => client), source.sessionId, source.messageId];
      const { rows } = await query(`SELECT ${RAW_READ_COLUMNS} FROM raw_messages r
        WHERE r.user_id = $1 AND r.client = ANY($2::text[]) AND r.session_id = $3 AND r.message_id = $4`, address);

      if (action) {
        if (!rows.length) return null;
        const scoped = await selected();
        for (const row of rows) {
          const message = decodeRawSegment(row);
          if (!message.content || message.role !== "user") continue;
          const { client, sessionId, messageId, content, occurredAtMs } = message;
          if (scoped.some(stored => stored.fact.kind !== "text" && factHidesRow(stored, {
            type: "raw", scope, source: { client, sessionId, occurredAtMs },
            messageKey: messageId, sessionKeyHash: hashSessionKey?.(client, sessionId) ?? "",
            startUtf16: 0, endUtf16: content.length,
          }, { hashSessionKey }) === true)) return true;
          if (await definitelyWithheld(content, scoped)) return true;
        }
        return rows.some(row => row.client === physical.client && row.role === "user" && row.content) ? false : null;
      }

      const { rows: tombstones } = await query(`SELECT 1 FROM core_memory_receipts
        WHERE user_id = $1 AND client = ANY($2::text[]) AND session_id = $3 AND message_id = $4
          AND forgotten_at IS NOT NULL LIMIT 1`, address);
      if (tombstones.length || await hasRawFence(query, { ...source, scope })) return true;
      const policy = await facts();
      for (const { client, sessionId } of related) {
        if (policy.some(stored => stored.fact.kind === "session" && factHidesRow(stored, {
          type: "raw", scope, source: { client, sessionId }, messageKey: source.messageId,
          sessionKeyHash: "", startUtf16: 0, endUtf16: 0,
        }, { hashSessionKey }) !== false)) return true;
        if (!rows.length && rawSpanFilter(policy, { scope, client, sessionId }, hashSessionKey)({ id: source.messageId })) {
          return true;
        }
      }
      const physicalPresent = rows.some(row => row.client === physical.client);
      if (!rawVisibility) return rows.length === 0 ? MISSING_RAW : physicalPresent ? true : null;
      const visibility = await (raw ??= rawVisibility(query, owner, null));
      const withheldSessions = /** @type {{client: string, session_id: string}[]} */ (JSON.parse(visibility.sessions));
      if (related.some(ref => visibility.withheldClients.includes(ref.client) || withheldSessions.some(session =>
        session.client === ref.client && session.session_id === ref.sessionId))) return true;
      if (!physicalPresent) return rows.length === 0 ? MISSING_RAW : null;
      const { rows: allowed } = await query(`SELECT ${RAW_READ_COLUMNS} FROM raw_messages r
        WHERE ${RAW_READ_FILTER} AND r.client = ANY($8::text[]) AND r.session_id = $9 AND r.message_id = $10`,
      [owner, null, false, null, null, visibility.withheldClients, visibility.sessions, ...address.slice(1)]);
      if (allowed.length !== rows.length || allowed.some(row => row.role !== "user" || !row.content)) return true;
      return (await visibility.visibleBatch(allowed.map(decodeRawSegment))).length !== rows.length;
    }

    /** @param {DocumentCardSourceMessage} source */
    function sourceEvidence(source) {
      const key = JSON.stringify([source.client, source.sessionId, source.messageId]);
      let result = verdicts.get(key);
      if (!result) {
        result = sourceVerdict(source).catch(error => {
          if (error instanceof CoreError && error.code === "raw_lineage_unavailable") return action ? null : true;
          throw error;
        });
        verdicts.set(key, result);
      }
      return result;
    }

    /** @param {DocumentCardSourceMessage} source */
    async function withheld(source) {
      const verdict = await sourceEvidence(source);
      return verdict === MISSING_RAW ? null : verdict;
    }

    /** @param {string} content @param {StoredFact[]} policy */
    async function definitelyWithheld(content, policy) {
      const text = textFacts(policy);
      if (!text.length) return false;
      const { keys: available } = await (keys ??= readKeys(owner));
      return rawTextDefinitelyWithheld(content, undefined,
        available.flatMap(key => [{ key, pipeline: "core" }, { key, pipeline: "hosted-v1" }]), text, scope);
    }

    /** @param {string} memoryId */
    async function erasedMemoryText(memoryId) {
      const policy = (await facts()).filter(({ fact }) =>
        fact.kind === "text" && fact.origin === "forget" && fact.sourceMemory?.id === memoryId);
      return (/** @type {string} */ content) => definitelyWithheld(content, policy);
    }

    /** @param {Links[number]} link */
    async function correction(link) {
      const entry = await memory(link.id);
      const revision = entry?.memory.revision;
      const evidence = hasCorrection(await facts(), link, entry);
      const corrected = evidence && (revision === undefined || link.revision < revision);
      return { correctedRevisions: revision !== undefined && (link.revision === 0 || corrected) ? [link.revision] : [],
        unresolvedCorrection: corrected && revision === undefined };
    }

    /** @param {Links[number]} link @returns {Promise<DocumentCardMemoryState>} */
    async function memoryState(link) {
      const entry = await memory(link.id);
      const revision = entry?.memory.revision;
      const policy = await selected();
      if (policy.some(({ fact }) => fact.kind === "identity" && fact.memoryId === link.id &&
          (fact.throughRevision == null || (revision !== undefined && revision <= fact.throughRevision)))) {
        return { status: "forgotten" };
      }
      if (!entry) return { status: !action && hasCorrection(policy, link, null) ? "suppressed" : "unknown" };
      if (action && policy.length) {
        const row = await rowFactCandidate(entry, policy);
        const receipts = (await readReceipts(query, owner, [link.id])).get(link.id) ?? [];
        const matchPolicy = rowVisibilityPolicy(hashSessionKey);
        if (policy.some(fact => definitelyHidesMemory(fact, row, receipts, entry.memory, matchPolicy))) {
          return { status: "suppressed" };
        }
        if (policy.some(fact => matchesRowFact(fact, row, receipts, matchPolicy, entry.memory))) return { status: "unknown" };
      } else if (!action) {
        const visibility = await (memoryVisibility ??= readVisibility(query, owner, hashSessionKey));
        if ((await visibility.check([entry]))[0].hidden || (link.revision < entry.memory.revision &&
            policy.some(({ fact }) => fact.kind === "text" && fact.origin === "forget" &&
              fact.sourceMemory?.id === link.id && fact.sourceMemory.createdAtMs === entry.memory.createdAtMs))) {
          return { status: "suppressed" };
        }
      }
      const { historical, text: content, createdAtMs: date } = entry.memory;
      return { status: historical ? "historical" : "visible", revision: entry.memory.revision, content, date,
        ...await correction(link) };
    }

    /** @param {CardWrite} card @param {boolean} [requireRaw] @returns {Promise<DocumentCardVisibilityInput>} */
    async function input(card, requireRaw = true) {
      const { id, origin, sourceMessage, title, body, sourceMemories } = card;
      const policy = await selected();
      const text = textFacts(policy);
      const verdicts = [];
      for (const source of bindings(card)) verdicts.push(await sourceEvidence(source));
      const blocked = verdicts.includes(true) || (sourceMessage !== null &&
        (await definitelyWithheld(title, policy) || await definitelyWithheld(body, policy)));
      const sourceWithheld = blocked ? true :
        verdicts.includes(null) || (requireRaw && verdicts.includes(MISSING_RAW)) ? null : false;
      /** @type {Map<string, DocumentCardMemoryState>} */
      const memoryStates = new Map();
      for (const link of sourceMemories) memoryStates.set(link.id, await memoryState(link));
      const active = text.length ? (await (keys ??= readKeys(owner))).active : null;
      return { card: { id, scope, origin, sourceMessage, title, body, sourceMemories,
        canonicalSessionKey: sourceMessage ? sessionKey(sourceMessage.client, sourceMessage.sessionId) : null },
        requestedScope: scope, memoryStates, sourceWithheld, textFacts: text.map(({ fact }) => fact),
        fingerprintKey: active, ...(active && { legacyFingerprint: { key: active, labels: HOSTED_FINGERPRINT_LABELS } }) };
    }

    /** @param {CardWrite} card */
    async function visible(card) {
      const evidence = await input(card);
      if (!card.sourceMessage && evidence.sourceWithheld !== false) return false;
      return (await documentCardVisible(evidence)).visible;
    }

    /** @param {CardWrite} card */
    async function stored(card) {
      // Draft records can predate Raw or the linked memories. Delivery requires
      // the stricter verdict even when the store can return a draft.
      const evidence = await input(card);
      if (evidence.sourceWithheld === true) return false;
      if (card.sourceMessage === null && !(await documentCardVisible({
        ...evidence, card: { ...evidence.card, sourceMemories: [] },
      })).visible) return false;
      return card.sourceMemories.every(({ id, revision }) => {
        const state = evidence.memoryStates.get(id);
        if (!state || state.status === "unknown") return revision > 0;
        if (state.status !== "visible" && state.status !== "historical") return false;
        return state.revision >= revision && !state.unresolvedCorrection && !state.correctedRevisions.includes(revision) &&
          (card.sourceMessage !== null || (state.status === "visible" && state.revision === revision));
      });
    }

    return { input, visible, stored, withheld, memory, correction, erasedMemoryText };
  }

  return reader;
}
