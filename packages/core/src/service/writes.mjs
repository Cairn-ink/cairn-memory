import { identifier, isWellFormedText, revision, validateDenseArray, validateObject } from "../capture/validate.mjs";
import { NEAR_DUPLICATE_DISTANCE } from "../decisions.mjs";
import { CoreError } from "../errors.mjs";
import { decideWrite, planConflictInsert, planCorrect, planDuplicateMerge, planSupersede, RELATION_LIMIT } from "../memory-policy/index.mjs";
import { addDigest, allDigests, coreDigest, coreFingerprintLabels, fingerprintMemoryPassages, legacyExactMac, passageShingles, textVariants, unkeyedForgetDigests } from "../privacy/fingerprint.mjs";
import { legacyPassageMatcher } from "../privacy/legacy-passages.mjs";
import { collectRedactedSecretValues, PRIVACY_REDACTION_VERSIONS, redactCore, redactHostedCurrent, redactV1 } from "../privacy/redact.mjs";
import { cleanContent, normalizeForHash, prepareCoreText, receiptExcerpt } from "../privacy/text.mjs";
import { blocksMemoryPassage, withholdsAnyPassage } from "../privacy/withholds.mjs";
import { redactAmendmentText } from "../routing/redaction.mjs";
import { factIncarnationBody, validateSuppressionFact } from "../suppression-fact.mjs";
import { entry, entryError, scopeOf, correctRequestDecision, factReference, hostAttachments, hostRequestOf, predecessorOf, saveRequestDecision, spanReference, writeHookResult } from "./entry.mjs";
import { pauseResult } from "./pause.mjs";

/** @import {ClockAndHash, DuplicateQuery, InsertRow, ItemRef, MemoryRow, PassageFingerprint, Receipt, RetainedDigester, SaveOptions, Scope, SourceRef, SuppressionStore, Tx, WritePolicy} from "../ports/index.d.ts" */
/** @import {FingerprintKey} from "../privacy/fingerprint.mjs" */
/** @import {IdentityFact, TextDigest, TextFact, WindowFact} from "../suppression-fact.mjs" */

const memoryKinds = /** @type {const} */ (["fact", "preference", "decision", "instruction", "context"]);
const sourceKinds = /** @type {const} */ (["capture", "mcp", "web", "import", "plugin"]);
const HALF_WINDOW_MS = 30 * 60 * 1_000;
const invalid = () => /** @type {const} */ ({ status: "invalid" });

/** @param {number | undefined} indexRevision */
function reportedIndex(indexRevision) {
  return indexRevision === undefined ? {} : { indexRevision };
}

/** @param {import("../ports/host.d.ts").ExplicitWriteReceipt | undefined} receipt
 * @param {string} text @returns {(Receipt & { excerpt: string })[]}
 */
function explicitReceipts(receipt, text) {
  return receipt ? [{
    client: receipt.client, sessionId: receipt.sessionId, messageId: receipt.eventId ?? receipt.messageId,
    role: receipt.role, occurredAtMs: receipt.occurredAtMs, excerpt: receiptExcerpt(text),
  }] : [];
}

/** @param {unknown} value @param {string} excerpt */
function proceduralSpans(value, excerpt) {
  const { anchors } = validateObject(value, ["anchors"]);
  const boundary = (/** @type {number} */ offset) => !/[\uDC00-\uDFFF]/u.test(excerpt.charAt(offset));
  return validateDenseArray(anchors, 1, 4).map(anchor => {
    const { receiptIndex, start, end } = validateObject(anchor, ["receiptIndex", "start", "end"]);
    if (receiptIndex !== 0 || typeof start !== "number" || typeof end !== "number" ||
        !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= end ||
        end > excerpt.length || !boundary(start) || !boundary(end)) throw new CoreError("invalid_input");
    return { start, end };
  });
}

/** @template {string} T @param {unknown} value @param {readonly T[]} choices */
function enumValue(value, choices) {
  const choice = choices.find(candidate => candidate === value);
  if (choice === undefined) throw new CoreError("invalid_input");
  return choice;
}

/** @param {unknown} value */
export function memoryKindOf(value) {
  return enumValue(value, memoryKinds);
}

/** @param {unknown} value */
function sourceText(value) {
  if (value === null || (isWellFormedText(value) && !value.includes("\0"))) return value;
  throw new CoreError("invalid_input");
}

/** @param {unknown} value @returns {SourceRef} */
export function sourceOf(value) {
  const { kind, client, sessionId } = validateObject(value, ["kind", "client", "sessionId"]);
  return { kind: enumValue(kind, sourceKinds), client: sourceText(client), sessionId: sourceText(sessionId) };
}

/** @param {string} raw @param {string} text @param {FingerprintKey | null} key
 * @returns {Promise<DuplicateQuery>}
 */
async function hashesOf(raw, text, key) {
  const [[core, ...aliases], current] = await Promise.all([
    allDigests(raw, null), key && allDigests(text, key),
  ]);
  const legacy = aliases.at(-1);
  return { textHash: 'sha256:' + core.value, ...(legacy && { legacyHash: 'sha256:' + legacy.value }),
    ...(current && { digests: current }) };
}

/** @param {string} raw @param {string} text @param {FingerprintKey | null} key
 * @param {(text: string) => Promise<string>} sha256Hex
 * @param {readonly RetainedDigester[]} [digesters]
 */
export async function prepareWriteText(raw, text, key, sha256Hex, digesters) {
  const [query, passages] = await Promise.all([
    hashesOf(raw, text, key),
    fingerprintMemoryPassages(raw, text, key, sha256Hex, digesters),
  ]);
  const retained = passages[0].digests.filter(digest => digest.label !== undefined);
  if (retained.length) query.digests = [...(query.digests ?? []), ...retained];
  return { query, passages };
}

/** @param {TextDigest[]} digests @param {MemoryRow} row */
function addStoredExactDigest(digests, row) {
  if (/^sha256:[0-9a-f]{64}$/u.test(row.textHash)) {
    addDigest(digests, { alg: "sha256", value: row.textHash.slice(7), pipeline: "core",
      redactionVersion: PRIVACY_REDACTION_VERSIONS.core, keyId: null });
  }
}

/** @param {MemoryRow} row @returns {Promise<TextFact["text"] | null>} */
async function keylessPredecessorText(row) {
  const raw = cleanContent(row.text);
  const normalized = raw.normalize("NFKC");
  /** @type {Set<string>} */
  const masked = new Set();
  for (const spelling of new Set([row.text, raw, normalized])) collectRedactedSecretValues(spelling, masked);
  const secrets = [...new Set([...masked].map(value => normalizeForHash(cleanContent(value)))
    .filter(value => value.length > 0))];
  // A normalization crossing a redaction boundary cannot be verified by projection.
  if (secrets.length && redactAmendmentText(raw) === null) return null;
  // A redactor can mask one occurrence and leave a copy elsewhere. Inspect every
  // hash input, including the exact historical variants, before it reaches SHA.
  const digests = await unkeyedForgetDigests(raw, prepareCoreText(raw),
    spelling => secrets.every(secret => !normalizeForHash(spelling).includes(secret)));
  if (!secrets.length) addStoredExactDigest(digests, row);
  // With no safe spelling, keyless forget can only suppress identity and lineage.
  return digests.length ? { digests, keyId: null } : null;
}

/** @param {MemoryRow} row @param {FingerprintKey} key @param {"edit" | "forget"} origin
 * @returns {Promise<TextFact["text"]>}
 */
async function predecessorText(row, key, origin) {
  const oldText = prepareCoreText(row.text);
  const cleaned = cleanContent(row.text);
  const heldSecret = [row.text, cleaned.normalize("NFKC")].some(text =>
    redactCore(text) !== text || redactV1(text) !== text || redactHostedCurrent(text) !== text);
  const [digests, legacyMac, shingles] = await Promise.all([
    heldSecret ? coreDigest(row.text, key).then(digest => [digest]) : allDigests(row.text, key),
    legacyExactMac(row.text, key, coreFingerprintLabels),
    passageShingles(row.text, key, coreFingerprintLabels),
  ]);
  const { v1, core } = PRIVACY_REDACTION_VERSIONS;
  addDigest(digests, {
    alg: "hmac", value: legacyMac, pipeline: "core",
    redactionVersion: heldSecret ? v1 : core, keyId: key.id,
  });
  if (!heldSecret) {
    const [canonical] = await allDigests(row.text, null);
    addDigest(digests, canonical);
  }
  if (origin === "forget") {
    if (!heldSecret) addStoredExactDigest(digests, row);
    // The original and the historical redacted spellings must all be matchable
    // for a secret-bearing row, without persisting an unkeyed digest.
    const keyedVariants = await Promise.all(textVariants(row.text, oldText).map(
      async ([variant, , redactionVersion]) => /** @satisfies {TextDigest} */ ({
        alg: "hmac", value: await legacyExactMac(variant, key, coreFingerprintLabels), pipeline: "core",
        redactionVersion, keyId: key.id,
      })));
    for (const digest of keyedVariants) addDigest(digests, digest);
  }
  return {
    digests, shingles, keyId: key.id,
    ...(origin === "forget" && row.embedding && { embedding: Array.from(row.embedding.vector) }),
  };
}

/** @param {Scope} scope @param {MemoryRow} row @param {FingerprintKey | null} key
 * @param {ClockAndHash} clock @param {"edit" | "forget"} origin
 */
export async function predecessorFact({ owner, namespace }, row, key, clock, origin) {
  const text = key === null ? await keylessPredecessorText(row) : await predecessorText(row, key, origin);
  const fact = text ? /** @satisfies {TextFact} */ ({
    owner, namespace, kind: "text", mode: key === null ? "exact" : "full", origin, actionId: "",
    sourceMemory: { id: row.id, createdAtMs: row.createdAtMs },
    text,
  }) : /** @satisfies {IdentityFact} */ ({ owner, namespace, kind: "identity", origin, actionId: "", memoryId: row.id });
  const incarnation = await clock.sha256Hex(factIncarnationBody(fact));
  fact.actionId = origin === "edit" ? "edit:" + row.revision + ":" + incarnation : "forget:" + incarnation;
  validateSuppressionFact(fact);
  return { fact, incarnation };
}

/** @param {MemoryRow} row @param {string} actionId @returns {WindowFact[]} */
export function sourceWindowFacts(row, actionId) {
  const { source, scope, createdAtMs, updatedAtMs } = row;
  if ((source.kind !== "mcp" && source.kind !== "web") || source.sessionId !== null) return [];

  const { owner, namespace } = scope;
  return Array.from(new Set([createdAtMs, updatedAtMs]), time => {
    const fact = /** @satisfies {WindowFact} */ ({
      kind: "window", owner, namespace, actionId, origin: "forget", client: null,
      window: { startMs: time - HALF_WINDOW_MS, endMs: time + HALF_WINDOW_MS },
      anchor: "pm30min",
    });
    validateSuppressionFact(fact);
    return fact;
  });
}

/** @param {import("../ports/index.d.ts").MemoryStore} memories @param {Scope} scope @param {string} id @param {Tx} tx */
export async function scopedRow(memories, scope, id, tx) {
  const row = await memories.get(tx, scope, id);
  return row?.id === id && row.scope?.owner === scope.owner && row.scope.namespace === scope.namespace ? row : null;
}

/** @param {unknown} vector @param {number} dimensions @returns {vector is Float32Array} */
export function validWriteEmbedding(vector, dimensions) {
  return vector instanceof Float32Array && vector.length === dimensions &&
    vector.every(Number.isFinite) && vector.some(component => component !== 0);
}

/** @param {WritePolicy} policy @param {boolean} near @param {string} [editId] */
function decide(policy, near, editId) {
  const matches = policy.matches[0];
  // Unclassified hidden ids could own the hash. Refuse if their match details were omitted.
  if (policy.hiddenIds.some(id => !matches.some(match => match.kind === "stored" && match.id === id))) {
    return /** @type {const} */ ({ status: "suppressed" });
  }
  const eligible = matches.filter(match => match.kind === "stored" && match.id !== editId &&
    (match.match === "exact" || (near && match.distance !== undefined && match.distance <= NEAR_DUPLICATE_DISTANCE)));
  return decideWrite({ ...policy, matches: [eligible] }, 0);
}

/** @param {MemoryRow} row @param {DuplicateQuery} query @param {string} text */
function sameText(row, query, text) {
  return row.textHash === query.textHash ||
    normalizeForHash(prepareCoreText(row.text)) === normalizeForHash(text);
}

/** @param {SuppressionStore} suppressions @param {Tx} tx @param {Scope} scope @param {SourceRef} source
 * @param {Parameters<SuppressionStore["snapshot"]>[2]} candidates
 */
function writeSnapshot(suppressions, tx, scope, source, candidates) {
  if (typeof suppressions?.snapshot !== "function") throw new CoreError("capability_unavailable");
  return suppressions.snapshot(tx, scope, {
    client: source.client ?? undefined, sessionId: source.sessionId ?? undefined, ...candidates,
  });
}

/** @param {Scope} scope @param {readonly TextFact[]} facts */
function scopedPassageFacts(scope, facts) {
  if (facts.some(fact => typeof fact?.owner !== "string")) return null;
  return facts.filter(fact => fact.owner === scope.owner && (fact.namespace ?? null) === scope.namespace);
}

/** @param {import("./index.d.mts").MemoryServiceDeps} deps */
export function writeEmbedding({ storage: { keys, capabilities }, embedder, gate }) {
  /** @param {string} owner @param {readonly string[]} input @param {FingerprintKey | null} key
   * @param {boolean} importing
   */
  async function embedBatch(owner, input, key, importing) {
    if (embedder === null) throw new CoreError("embedding_failed");
    const options = {};
    const texts = input.map(normalizeForHash);
    const { model, dimensions } = embedder;
    try {
      await gate.assertOpen(owner, "dispatch");
    } catch (error) {
      if (importing && entryError(error).kind === "paused") return null;
      throw error;
    }
    let vectors;
    try {
      vectors = await embedder.embed(texts, options);
    } catch (error) {
      if (capabilities.embeddingRequiredOnInsert === true) throw new CoreError("embedding_failed");
      throw error;
    }
    const validBatch = Array.isArray(vectors) && vectors.length <= texts.length;
    const embeddings = texts.map((_, index) => {
      const vector = validBatch ? vectors[index] : undefined;
      if (validWriteEmbedding(vector, dimensions)) return { model, vector };
      if (!importing || capabilities.embeddingRequiredOnInsert === true) throw new CoreError("embedding_failed");
      return null;
    });
    if ((await keys?.userKey?.(owner))?.id !== key?.id) throw new CoreError("fingerprint_key_mismatch");
    return embeddings;
  }

  return {
    /** @param {string} owner @param {string} text @param {FingerprintKey | null} key */
    async embed(owner, text, key) {
      const embedding = (await embedBatch(owner, [text], key, false))?.[0];
      if (!embedding) throw new CoreError("embedding_failed");
      return embedding;
    },
    /** @param {string} owner @param {readonly string[]} texts @param {FingerprintKey | null} key */
    embedImport: (owner, texts, key) => embedBatch(owner, texts, key, true),
  };
}

/** @param {SuppressionStore} suppressions @param {Tx} tx @param {Scope} scope @param {SourceRef} source
 * @param {string} raw @param {PassageFingerprint[]} passages @param {FingerprintKey | null} key
 * @param {TextFact["sourceMemory"]} [edit]
 */
async function withheld(suppressions, tx, scope, source, raw, passages, key, edit) {
  const snapshot = await writeSnapshot(suppressions, tx, scope, source, { passages });
  if (snapshot.blockedSession || snapshot.blockedMessages.length) return true;
  const passagesInSnapshot = snapshot.passages.map(({ fact }) => fact);
  if (passages.length > 1) {
    // The candidate snapshot may omit forget facts needed for multi-passage containment.
    const scoped = await suppressions.snapshot(tx, scope, {});
    for (const { fact } of scoped.passages) {
      if (fact?.origin === "forget") passagesInSnapshot.push(fact);
    }
  }
  const facts = scopedPassageFacts(scope, passagesInSnapshot);
  // The explicit-save shingle exemption does not apply to legacy SHA passages.
  return facts === null || legacyPassageMatcher(scope, passagesInSnapshot)?.(raw) ||
    blocksMemoryPassage(passages, facts, key, undefined, edit ?? undefined);
}

/** @param {SuppressionStore} suppressions @param {Tx} tx @param {Scope} scope @param {SourceRef} source
 * @param {readonly {raw: string, passages: PassageFingerprint[], createdAtMs?: number}[]} batch
 */
export async function fullWriteWithholds(suppressions, tx, scope, source, batch) {
  // A scoped snapshot also supplies containment facts omitted by adapters without row shingles.
  const snapshot = await writeSnapshot(suppressions, tx, scope, source, {
    occurredAtMs: batch.map(({ createdAtMs }) => createdAtMs ?? null),
  });
  const stored = snapshot.passages.map(({ fact }) => fact);
  const facts = scopedPassageFacts(scope, stored);
  const legacyWithholds = legacyPassageMatcher(scope, stored);
  const blocked = new Set(snapshot.blockedMessages);
  return batch.map(({ raw, passages }, i) => snapshot.blockedSession || blocked.has(i) ||
    facts === null || legacyWithholds?.(raw) || withholdsAnyPassage(passages, facts));
}

/** @param {import("./entry.mjs").HookedDeps} deps
 * @returns {Pick<import("../ports/host.d.ts").MemoryService, "save" | "correct">}
 */
export function writeMethods(deps) {
  const { storage, gate, clock, embedder, config, hooks } = deps;
  const { uow, pause, memories, suppressions, keys, fence, capabilities, proceduralTags } = storage;
  const { embed } = writeEmbedding(deps);
  /** @param {string} text */
  const sha256Hex = (text) => clock.sha256Hex(text);

  /** @param {Tx} tx */
  async function paused(tx) {
    return /** @type {const} */ ({ status: "paused", ...reportedIndex(await memories.indexRevision?.(tx)) });
  }

  /** @param {Tx} tx @param {Scope} scope @param {Receipt & { excerpt: string }} receipt */
  async function withheldReceipt(tx, scope, receipt) {
    if (suppressions.receiptWithheld) return suppressions.receiptWithheld(tx, scope, receipt);
    const { client, sessionId, occurredAtMs } = receipt;
    const snapshot = await suppressions.snapshot(tx, scope, { client, sessionId, occurredAtMs: [occurredAtMs] });
    return snapshot.blockedSession || snapshot.blockedMessages.length > 0;
  }

  /** @param {Scope} scope @param {string} id @param {Tx} tx */
  async function visible(scope, id, tx) {
    const refs = await fence.assertVisible(tx, { owner: scope.owner, namespaces: [scope.namespace] },
      [{ type: "memory", id, namespace: scope.namespace }]);
    return refs.some(ref => ref.type === "memory" && ref.id === id && ref.namespace === scope.namespace);
  }

  /** @param {Scope} scope @param {string} id @param {number} revision */
  function deliver(scope, id, revision) {
    return uow.run(scope.owner, { readOnly: true }, async tx => {
      const row = await scopedRow(memories, scope, id, tx);
      if (row === null || row.revision !== revision || !await visible(scope, id, tx)) return null;
      return { ...row, text: prepareCoreText(row.text) };
    });
  }

  return {
    save: entry(async (input, raw, inputSource, inputKind = "fact", options) => {
      /** @type {Scope} */
      let scope;
      let source, kind;
      /** @type {NonNullable<SaveOptions["relations"]>["replaces"]} */
      let replaces;
      /** @type {NonNullable<SaveOptions["relations"]>["contradicts"]} */
      let contradicts;
      try {
        scope = scopeOf(input);
        source = sourceOf(inputSource);
        kind = memoryKindOf(inputKind);
        if (typeof raw !== "string") return invalid();
        const relations = options?.relations;
        if (relations !== undefined) {
          const hints = validateObject(relations, ["replaces", "contradicts"]);
          const targetOf = (/** @type {unknown} */ value) => {
            const { id, expectedRevision } = validateObject(value, ["id", "expectedRevision"]);
            return { id: identifier(id), expectedRevision: revision(expectedRevision) };
          };
          replaces = hints.replaces === undefined ? undefined : targetOf(hints.replaces);
          if (hints.contradicts !== undefined) {
            contradicts = validateDenseArray(hints.contradicts, 1, RELATION_LIMIT).map(targetOf);
            const ids = new Set(contradicts.map(({ id }) => id));
            if (ids.size !== contradicts.length || (replaces && ids.has(replaces.id))) return invalid();
          }
          if (!replaces && !contradicts) return invalid();
        }
      } catch {
        return invalid();
      }

      const supersession = replaces && storage.supersession;
      const conflicts = contradicts && storage.conflicts;
      if ((replaces && !supersession) || (contradicts && !conflicts)) throw new CoreError("capability_unavailable");
      const targets = replaces ? [replaces, ...(contradicts ?? [])] : contradicts ?? [];
      if (embedder === null && capabilities.embeddingRequiredOnInsert === true) {
        throw new CoreError("capability_unavailable");
      }
      const procedural = options?.procedural;
      if (procedural !== undefined && (capabilities.proceduralTags !== true || !proceduralTags)) {
        throw new CoreError("capability_unavailable");
      }
      const text = prepareCoreText(raw);
      const receipts = explicitReceipts(options?.receipt, text);
      if (options?.receipt !== undefined && receipts[0]?.role !== "user") return invalid();
      let spans;
      if (procedural !== undefined) {
        if (receipts.length === 0 || (kind !== "instruction" && kind !== "preference")) return invalid();
        try {
          spans = proceduralSpans(procedural, receipts[0].excerpt);
        } catch {
          return invalid();
        }
      }
      const { owner } = scope;
      const explicit = source.kind === "mcp" || source.kind === "web";
      const saveHooks = explicit ? hooks : undefined;
      if (options?.hostRequest !== undefined && !saveHooks) throw new CoreError("capability_unavailable");
      const request = saveHooks ? hostRequestOf(options?.hostRequest) : null;
      const context = saveHooks && { scope, source, request };
      /** @param {Tx} tx */
      const suppressed = async (tx) => /** @type {const} */ ({
        status: "suppressed", ...reportedIndex(await memories.indexRevision?.(tx)),
      });
      /** @param {Tx} tx */
      async function checkHost(tx) {
        if (!saveHooks || !context) return null;
        const decision = await saveHooks.invoke("beforeSave", tx, context, value => saveRequestDecision(value, request !== null));
        switch (decision.status) {
          case "proceed": return null;
          case "refuse": return suppressed(tx);
          case "conflict": throw new CoreError("event_payload_conflict");
          case "replay": {
            const { status, memory: { id, revision }, indexRevision } = decision.result;
            return { status, id, revision, indexRevision };
          }
        }
      }
      /** @param {{status: "saved" | "duplicate", id: string, revision: number, indexRevision?: number,
       * relations?: { replaced: string | null, contradicts: string[] }}} result */
      async function deliverSave(result) {
        const item = await deliver(scope, result.id, result.revision);
        const index = reportedIndex(result.indexRevision);
        return item ? { status: result.status, item, ...index, ...(result.relations && { relations: result.relations }) }
          : /** @type {const} */ ({ status: "suppressed", ...index });
      }
      const preflight = await uow.run(owner, { pauseLock: true }, async tx => {
        const state = pauseResult(await pause.get(tx, owner));
        if (state.paused) return paused(tx);
        return saveHooks ? (await checkHost(tx)) ?? state : state;
      });
      if ("status" in preflight) return "id" in preflight ? deliverSave(preflight) : preflight;
      await gate.assertOpen(owner, "pre-send");
      if (!text) return invalid();
      const key = await keys?.userKey?.(owner) ?? null;
      const digesters = await keys?.retainedDigesters?.(owner);
      const { query, passages } = await prepareWriteText(raw, text, key, sha256Hex, digesters);
      const embedding = embedder === null ? null : await embed(owner, text, key);
      if (embedding) query.embedding = embedding.vector;
      const tag = spans && { spans, digest: await sha256Hex(receipts[0].excerpt) };
      const mode = explicit ? "hash" : "full";
      const row = /** @type {InsertRow} */ ({
        kind, text, textHash: query.textHash, source, embedding, confidence: 1,
        ...(query.digests && { digests: query.digests }),
        origin: explicit || source.kind === "import" ? "explicit" : "inferred",
      });

      await gate.assertOpen(owner, "post-send");
      // Keep relation errors distinct from the existing receipt-bearing invalid result.
      class InvalidRelation extends CoreError {
        constructor() { super("invalid_input"); }
      }
      const result = await uow.run(owner, { pauseLock: true }, async tx => {
        const state = pauseResult(await pause.get(tx, owner));
        if (state.paused || state.generation !== preflight.generation) return paused(tx);
        if (saveHooks) {
          const host = await checkHost(tx);
          if (host) return host;
        }
        if (keys?.userKeyForWrite && (await keys.userKeyForWrite(tx))?.id !== key?.id) {
          throw new CoreError("fingerprint_key_mismatch");
        }
        let previous = null;
        if (targets.length) {
          const selection = { owner, namespaces: [scope.namespace] };
          const refs = targets.map(({ id }) => /** @satisfies {ItemRef} */ ({ type: "memory", id, namespace: scope.namespace }));
          const visibleRefs = await fence.assertVisible(tx, selection, refs, "read");
          const visibleIds = new Set(visibleRefs.filter(ref => ref.type === "memory" && ref.namespace === scope.namespace)
            .map(ref => ref.id));
          const rows = [];
          for (const { id } of targets) {
            const target = visibleIds.has(id) ? await scopedRow(memories, scope, id, tx) : null;
            if (target === null) return /** @type {const} */ ({ status: "not_found", ...reportedIndex(await memories.indexRevision?.(tx)) });
            rows.push(target);
          }
          for (const [index, target] of rows.entries()) {
            if (target.historical) throw new CoreError("memory_historical");
            if (target.revision !== targets[index].expectedRevision) throw new CoreError("memory_conflict");
          }
          if (replaces) previous = rows[0];
        }
        if ((receipts.length && await withheldReceipt(tx, scope, receipts[0])) ||
            await withheld(suppressions, tx, scope, source, raw, passages, key)) return suppressed(tx);
        const policy = await memories.readWritePolicy(tx, scope, [query], source, mode);
        const decision = decide(policy, capabilities.nearDuplicate === true && embedding !== null);
        if (decision.status === "suppressed") return suppressed(tx);
        let id, written;
        let textHash = row.textHash;
        /** @type {readonly import("../ports/index.d.ts").HostReceipt[]} */
        let priorReceipts = [];
        if (decision.status === "saved") {
          written = await memories.insert(tx, scope, row, receipts, clock.nowMs());
          id = written.id;
        } else {
          const duplicateId = decision.id;
          id = duplicateId;
          const current = await scopedRow(memories, scope, duplicateId, tx);
          const matched = policy.matches[0].some(match => match.kind === "stored" && match.id === duplicateId &&
            match.revision === current?.revision);
          if (current === null || !matched) return suppressed(tx);
          if (targets.length && (current.historical || targets.some(target => target.id === duplicateId))) throw new InvalidRelation();
          if (!await visible(scope, duplicateId, tx)) return suppressed(tx);
          textHash = current.textHash;
          const { merge } = planDuplicateMerge(current, current);
          if (tag && kind !== current.kind) merge.kind = kind;
          if (saveHooks && receipts.length) priorReceipts = await saveHooks.port.priorReceipts(tx, scope, id);
          written = await memories.touchDuplicate(tx, scope, duplicateId, receipts, merge, clock.nowMs());
        }
        if (tag && proceduralTags) {
          const receiptId = written.receiptIds?.[0];
          if (!receiptId) throw new CoreError("internal_error");
          await proceduralTags.write(tx, scope, id, {
            positive: true, origin: "explicit",
            anchors: tag.spans.map(span => ({ receiptId, digest: tag.digest, ...span })),
          });
        }
        const memory = { id, revision: written.revision };
        if (replaces && supersession) {
          try {
            planSupersede(previous, replaces.expectedRevision, textHash, await supersession.incomingCount(tx, scope, id));
            await supersession.record(tx, scope, {
              previous: { id: replaces.id, revision: replaces.expectedRevision }, replacement: memory,
            }, (written.receiptIds ?? []).slice(0, 4), clock.nowMs());
          } catch (error) {
            if (entryError(error).code === "invalid_ref") throw new InvalidRelation();
            throw error;
          }
          await supersession.markHistorical(tx, scope, replaces.id, clock.nowMs());
        }
        if (contradicts && conflicts) {
          const ids = contradicts.map(target => target.id);
          const edgeSource = explicit ? "explicit-hint" : "inferred-hint";
          const existing = await conflicts.list(tx, scope, id);
          const revisions = new Map([[id, memory.revision]]);
          const degreeAfter = new Map();
          let additions = 0;
          for (const { id: targetId, expectedRevision } of contradicts) {
            const alreadyLinked = existing.some(edge => edge.memoryId === targetId &&
              edge.revision === expectedRevision && edge.source === edgeSource);
            const added = alreadyLinked ? 0 : 1;
            additions += added;
            revisions.set(targetId, expectedRevision);
            degreeAfter.set(targetId, (await conflicts.degree(tx, scope, targetId)) + added);
          }
          degreeAfter.set(id, (await conflicts.degree(tx, scope, id)) + additions);
          for (const [left, right] of planConflictInsert(id, ids, degreeAfter)) {
            await conflicts.insert(tx, scope, {
              left: { id: left, revision: /** @type {number} */ (revisions.get(left)) },
              right: { id: right, revision: /** @type {number} */ (revisions.get(right)) },
              relation: "contradicts", source: edgeSource,
            }, clock.nowMs());
          }
        }
        const linked = targets.length
          ? { relations: { replaced: replaces?.id ?? null, contradicts: contradicts?.map(target => target.id) ?? [] } }
          : {};
        if (!saveHooks || !context) {
          return { status: decision.status, id, revision: written.revision,
            ...reportedIndex(await memories.committedIndexRevision?.(tx)), ...linked };
        }
        const attached = receipts.length
          ? hostAttachments(priorReceipts, await saveHooks.port.priorReceipts(tx, scope, id), receipts) : [];
        const saved = { ...context, status: decision.status, memory, receipts: attached };
        await saveHooks.invoke("onSave", tx, saved, writeHookResult);
        const indexRevision = await memories.committedIndexRevision?.(tx);
        if (indexRevision === undefined) throw new CoreError("internal_error");
        if (request) await saveHooks.port.finalizeSave(tx, saved, indexRevision);
        return { status: decision.status, id, revision: written.revision, indexRevision, ...linked };
      }).catch(error => {
        if (receipts.length && !(error instanceof InvalidRelation) && entryError(error).code === "invalid_input") return invalid();
        throw error;
      });

      if (!("id" in result)) return result;
      return deliverSave(result);
    }, invalid),

    correct: entry(async (input, inputId, inputRevision, raw, inputSource, options) => {
      const scope = scopeOf(input);
      const id = identifier(inputId);
      const expectedRevision = revision(inputRevision);
      sourceOf(inputSource);
      if (typeof raw !== "string") throw new CoreError("invalid_input");
      if (options?.receipt !== undefined && options.receipt?.role !== "user") return invalid();
      const { owner } = scope;
      const preflight = await uow.run(owner, { pauseLock: true }, async tx => {
        const state = pauseResult(await pause.get(tx, owner));
        const row = state.paused ? null : await scopedRow(memories, scope, id, tx);
        const previous = row && await visible(scope, id, tx) ? row : null;
        if (previous && previous.revision === expectedRevision && !previous.historical) return { state, previous };
        const status = state.paused ? "paused" : previous ? "conflict" : "not_found";
        const start = await memories.indexRevision?.(tx);
        return /** @type {const} */ ({ status, ...(start === undefined ? {} : { indexRevision: start }) });
      });
      if (preflight.previous === undefined) return preflight;
      const { state: initialState, previous } = preflight;

      await gate.assertOpen(owner, "pre-send");
      const text = prepareCoreText(raw);
      if (!text) throw new CoreError("invalid_text");
      const receipts = options?.receipt ? explicitReceipts(options.receipt, text) : null;
      const key = await keys?.userKey?.(owner) ?? null;
      if (key === null && capabilities.fingerprintKey === true && typeof keys?.userKey === "function") {
        throw new CoreError("fingerprint_unavailable");
      }
      const digesters = await keys?.retainedDigesters?.(owner);
      const { query, passages } = await prepareWriteText(raw, text, key, sha256Hex, digesters);
      const unchanged = sameText(previous, query, text);
      const kindOverride = !unchanged && options?.kind !== undefined ? memoryKindOf(options.kind) : undefined;
      const embedding = unchanged || (embedder === null && capabilities.embeddingRequiredOnInsert !== true)
        ? null : await embed(owner, text, key);
      query.embedding = embedding?.vector;
      const source = previous.source;

      const predecessor = unchanged ? undefined : await predecessorFact(scope, previous, key, clock, "edit");
      const windows = predecessor && config.explicitWindowFence?.enabled === true
        ? await Promise.all(sourceWindowFacts(previous, predecessor.fact.actionId).map(async fact => ({
          fact, incarnation: await sha256Hex(factIncarnationBody(fact)),
        })))
        : [];

      let result, start;
      if (!unchanged) await gate.assertOpen(owner, "post-send");
      try {
        result = await uow.run(owner, { pauseLock: true }, async tx => {
          start = await memories.indexRevision?.(tx);
          const state = pauseResult(await pause.get(tx, owner));
          if (state.paused || state.generation !== initialState.generation) return /** @type {const} */ ({ status: "paused" });
          const current = await scopedRow(memories, scope, id, tx);
          if (current === null || !await visible(scope, id, tx)) return /** @type {const} */ ({ status: "not_found" });
          if (current.revision !== expectedRevision || current.textHash !== previous.textHash ||
              current.text !== previous.text || current.createdAtMs !== previous.createdAtMs || current.historical) {
            return /** @type {const} */ ({ status: "conflict" });
          }
          if (keys?.userKeyForWrite && (await keys.userKeyForWrite(tx))?.id !== key?.id) {
            throw new CoreError("fingerprint_key_mismatch");
          }
          if ((receipts?.length && await withheldReceipt(tx, scope, receipts[0])) ||
              await withheld(suppressions, tx, scope, source, raw, passages, key, { id, createdAtMs: current.createdAtMs })) {
            return /** @type {const} */ ({ status: "suppressed" });
          }
          const policy = await memories.readWritePolicy(tx, scope, [query], source, "full", id);
          const decision = decide(policy, false, id);
          if (decision.status === "suppressed") return decision;
          const plan = planCorrect(current, expectedRevision,
            { textHash: unchanged ? current.textHash : query.textHash, kind: kindOverride ?? current.kind },
            decision.status === "duplicate");
          if (plan.outcome === "unchanged") return /** @type {const} */ ({ status: "unchanged", revision: plan.revision });
          if (!predecessor) throw new CoreError("internal_error");
          const context = hooks && { scope, predecessor: predecessorOf(current) };
          if (hooks && context) {
            const admission = await hooks.invoke("beforeCorrect", tx, context, correctRequestDecision);
            if (admission.status === "refuse") return /** @type {const} */ ({ status: "suppressed" });
          }
          const evidence = hooks && await hooks.port.predecessorEvidence(tx, scope, id);
          const spans = hooks && storage.spanLineage ? await storage.spanLineage.resolveSpans(tx, scope, id) : [];
          /** @type {import("../ports/index.d.ts").HostFactRef[] | undefined} */
          const facts = hooks ? [] : undefined;
          const { kind, origin, confidence, textHash } = plan;
          const now = clock.nowMs();
          const writtenFact = await suppressions.writeFact(tx, predecessor.fact, predecessor.incarnation);
          facts?.push(factReference(predecessor.fact.kind, writtenFact));
          for (const { fact, incarnation } of windows) {
            const written = await suppressions.writeFact(tx, fact, incarnation);
            facts?.push(factReference(fact.kind, written));
          }
          const replaced = await memories.replaceContent(tx, scope, id, expectedRevision,
            { kind, origin, confidence, textHash, text, source, embedding, digests: query.digests }, receipts, now);
          if (replaced.outcome !== "changed") throw new CoreError("internal_error");
          if (capabilities.proceduralTags === true) {
            if (!proceduralTags) throw new CoreError("capability_unavailable");
            await proceduralTags.clear(tx, scope, id);
          }
          if (hooks && context && evidence && facts) {
            const attached = receipts === null ? null : hostAttachments([], receipts.length
              ? await hooks.port.priorReceipts(tx, scope, id) : [], receipts);
            await hooks.invoke("onCorrect", tx, { ...context, ...evidence, facts, status: "saved",
              affectedSessions: [], affectedSpans: spans.map(spanReference),
              replacement: { id, revision: replaced.revision, source }, receipts: attached }, writeHookResult);
          }
          return /** @type {const} */ ({ status: "saved", revision: replaced.revision,
            ...reportedIndex(await memories.committedIndexRevision?.(tx)) });
        });
      } catch (error) {
        const failure = entryError(error);
        const status = ["revision_conflict", "memory_conflict", "memory_historical"].includes(failure.code) ? "conflict"
          : failure.code === "memory_not_found" ? "not_found" : null;
        if (status === null) throw failure;
        return { status, ...(start === undefined ? {} : { indexRevision: start }) };
      }

      const index = reportedIndex(result.status === "saved" ? result.indexRevision : start);
      if (result.status !== "saved" && result.status !== "unchanged") return { ...result, ...index };
      const item = await deliver(scope, id, result.revision);
      return item ? { status: result.status, item, ...index } : { status: "not_found", ...index };
    }),
  };
}
