import { identifier, isWellFormedText, revision, validateObject } from "../capture/validate.mjs";
import { NEAR_DUPLICATE_DISTANCE } from "../decisions.mjs";
import { CoreError } from "../errors.mjs";
import { decideWrite, planCorrect, planDuplicateMerge } from "../memory-policy/index.mjs";
import { addDigest, allDigests, coreDigest, coreFingerprintLabels, fingerprintMemoryPassages, legacyExactMac, passageShingles } from "../privacy/fingerprint.mjs";
import { PRIVACY_REDACTION_VERSIONS, redactCore, redactHostedCurrent, redactV1 } from "../privacy/redact.mjs";
import { cleanContent, normalizeForHash, prepareCoreText } from "../privacy/text.mjs";
import { blocksMemoryPassage, requiresLegacyMacDomain, withholdsAnyPassage } from "../privacy/withholds.mjs";
import { factIncarnationBody, validateSuppressionFact } from "../suppression-fact.mjs";
import { entry, entryError, scopeOf } from "./entry.mjs";
import { pauseResult } from "./pause.mjs";

/** @import {ClockAndHash, DuplicateQuery, InsertRow, MemoryRow, PassageFingerprint, Scope, SourceRef, SuppressionStore, Tx, WritePolicy} from "../ports/index.d.ts" */
/** @import {FingerprintKey} from "../privacy/fingerprint.mjs" */
/** @import {TextDigest, TextFact} from "../suppression-fact.mjs" */

const memoryKinds = /** @type {const} */ (["fact", "preference", "decision", "instruction", "context"]);
const sourceKinds = /** @type {const} */ (["capture", "mcp", "web", "import", "plugin"]);
const invalid = () => /** @type {const} */ ({ status: "invalid" });

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

/** @param {string} raw @param {string} text @param {FingerprintKey | null} key @returns {Promise<DuplicateQuery>} */
async function hashesOf(raw, text, key) {
  const [[core, ...aliases], digests] = await Promise.all([
    allDigests(raw, null), key && allDigests(text, key),
  ]);
  const legacy = aliases.at(-1);
  return { textHash: 'sha256:' + core.value, ...(legacy && { legacyHash: 'sha256:' + legacy.value }),
    ...(digests && { digests }) };
}

/** @param {string} raw @param {string} text @param {FingerprintKey | null} key
 * @param {(text: string) => Promise<string>} sha256Hex
 */
export async function prepareWriteText(raw, text, key, sha256Hex) {
  const query = await hashesOf(raw, text, key);
  const passages = await fingerprintMemoryPassages(raw, text, key, sha256Hex);
  return { query, passages };
}

/** @param {string} raw @param {string} text */
function textVariants(raw, text) {
  const original = cleanContent(raw);
  const { v1, hostedCurrent, core } = PRIVACY_REDACTION_VERSIONS;
  /** @type {Array<[string, TextDigest["pipeline"], number]>} */
  const variants = [
    [original, "hosted-v1", v1],
    [redactV1(original), "hosted-v1", v1],
    [redactHostedCurrent(original), "hosted-v1", hostedCurrent],
    [text, "core", core],
    // Hosted capture derives its stored V1 evidence after capture normalization.
    [redactV1(original.normalize("NFKC")), "hosted-v1", v1],
  ];
  return variants;
}

/** @param {Scope} scope @param {MemoryRow} row @param {FingerprintKey} key
 * @param {ClockAndHash} clock @param {"edit" | "forget"} origin
 */
export async function predecessorFact({ owner, namespace }, row, key, clock, origin) {
  const oldText = prepareCoreText(row.text);
  const heldSecret = [row.text, cleanContent(row.text).normalize("NFKC")].some(text =>
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
    if (!heldSecret && /^sha256:[0-9a-f]{64}$/u.test(row.textHash)) {
      addDigest(digests, { alg: "sha256", value: row.textHash.slice(7), pipeline: "core",
        redactionVersion: core, keyId: null });
    }
    // The original and the historical redacted spellings must all be matchable
    // for a secret-bearing row, without persisting an unkeyed digest.
    const keyedVariants = await Promise.all(textVariants(row.text, oldText).map(
      async ([variant, , redactionVersion]) => /** @satisfies {TextDigest} */ ({
        alg: "hmac", value: await legacyExactMac(variant, key, coreFingerprintLabels), pipeline: "core",
        redactionVersion, keyId: key.id,
      })));
    for (const digest of keyedVariants) addDigest(digests, digest);
  }
  const fact = /** @satisfies {TextFact} */ ({
    owner, namespace, kind: "text", mode: "full", origin, actionId: "",
    sourceMemory: { id: row.id, createdAtMs: row.createdAtMs },
    text: {
      digests, shingles, keyId: key.id,
      ...(origin === "forget" && row.embedding && { embedding: Array.from(row.embedding.vector) }),
    },
  });
  const incarnation = await clock.sha256Hex(factIncarnationBody(fact));
  fact.actionId = origin === "edit" ? "edit:" + row.revision + ":" + incarnation : "forget:" + incarnation;
  validateSuppressionFact(fact);
  return { fact, incarnation };
}

/** @param {import("../ports/index.d.ts").MemoryStore} memories @param {Scope} scope @param {string} id @param {Tx} tx */
export async function scopedRow(memories, scope, id, tx) {
  const row = await memories.get(tx, scope, id);
  return row?.id === id && row.scope?.owner === scope.owner && row.scope.namespace === scope.namespace ? row : null;
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
  const scoped = facts.filter(fact => fact.owner === scope.owner && (fact.namespace ?? null) === scope.namespace);
  return scoped.some(requiresLegacyMacDomain) ? null : scoped;
}

/** @param {import("./index.d.mts").MemoryServiceDeps} deps */
export function writeEmbedding({ storage: { keys, capabilities }, embedder, gate }) {
  /** @param {string} owner @param {readonly string[]} input @param {FingerprintKey | null} key
   * @param {boolean} importing
   */
  async function embedBatch(owner, input, key, importing) {
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
      if (vector instanceof Float32Array && vector.length === dimensions &&
          vector.every(Number.isFinite) && vector.some(component => component !== 0)) return { model, vector };
      if (!importing || capabilities.embeddingRequiredOnInsert === true) throw new CoreError("embedding_failed");
      return null;
    });
    if ((await keys.userKey(owner))?.id !== key?.id) throw new CoreError("fingerprint_key_mismatch");
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
 * @param {PassageFingerprint[]} passages @param {FingerprintKey | null} key
 * @param {TextFact["sourceMemory"]} [edit]
 */
async function withheld(suppressions, tx, scope, source, passages, key, edit) {
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
  return facts === null || blocksMemoryPassage(passages, facts, key, undefined, edit ?? undefined);
}

/** @param {SuppressionStore} suppressions @param {Tx} tx @param {Scope} scope @param {SourceRef} source
 * @param {readonly {passages: PassageFingerprint[], createdAtMs?: number}[]} batch
 */
export async function fullWriteWithholds(suppressions, tx, scope, source, batch) {
  // A scoped snapshot also supplies containment facts omitted by adapters without row shingles.
  const snapshot = await writeSnapshot(suppressions, tx, scope, source, {
    occurredAtMs: batch.map(({ createdAtMs }) => createdAtMs ?? null),
  });
  const facts = scopedPassageFacts(scope, snapshot.passages.map(({ fact }) => fact));
  const blocked = new Set(snapshot.blockedMessages);
  return batch.map(({ passages }, i) => snapshot.blockedSession || blocked.has(i) ||
    facts === null || withholdsAnyPassage(passages, facts));
}

/** @param {import("./index.d.mts").MemoryServiceDeps} deps
 * @returns {Pick<import("../ports/host.d.ts").MemoryService, "save" | "correct">}
 */
export function writeMethods(deps) {
  const { storage, gate, clock } = deps;
  const { uow, pause, memories, suppressions, keys, fence, capabilities } = storage;
  const { embed } = writeEmbedding(deps);
  /** @param {string} text */
  const sha256Hex = (text) => clock.sha256Hex(text);

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
    save: entry(async (input, raw, inputSource, inputKind = "fact") => {
      let scope, source, kind;
      try {
        scope = scopeOf(input);
        source = sourceOf(inputSource);
        kind = memoryKindOf(inputKind);
        if (typeof raw !== "string") return invalid();
      } catch {
        return invalid();
      }

      const { owner } = scope;
      const preflight = await uow.run(owner, { pauseLock: true }, async tx => pauseResult(await pause.get(tx, owner)));
      if (preflight.paused) return { status: "paused" };
      await gate.assertOpen(owner, "pre-send");
      const text = prepareCoreText(raw);
      if (!text) return invalid();
      const key = await keys.userKey(owner);
      const { query, passages } = await prepareWriteText(raw, text, key, sha256Hex);
      const embedding = await embed(owner, text, key);
      query.embedding = embedding.vector;
      const explicit = source.kind === "mcp" || source.kind === "web";
      const mode = explicit ? "hash" : "full";
      const row = /** @type {InsertRow} */ ({
        kind, text, textHash: query.textHash, source, embedding, confidence: 1,
        ...(query.digests && { digests: query.digests }),
        origin: explicit || source.kind === "import" ? "explicit" : "inferred",
      });

      await gate.assertOpen(owner, "post-send");
      const result = await uow.run(owner, { pauseLock: true }, async tx => {
        const state = pauseResult(await pause.get(tx, owner));
        if (state.paused || state.generation !== preflight.generation) return /** @type {const} */ ({ status: "paused" });
        if (await withheld(suppressions, tx, scope, source, passages, key)) return /** @type {const} */ ({ status: "suppressed" });
        const policy = await memories.readWritePolicy(tx, scope, [query], source, mode);
        const decision = decide(policy, capabilities.nearDuplicate === true);
        if (decision.status === "suppressed") return decision;
        if (decision.status === "saved") {
          const { id, revision } = await memories.insert(tx, scope, row, [], clock.nowMs());
          return { status: decision.status, id, revision };
        }
        const { id } = decision;
        const current = await scopedRow(memories, scope, id, tx);
        const matched = policy.matches[0].some(match => match.kind === "stored" && match.id === id &&
          match.revision === current?.revision);
        if (current === null || !matched || !await visible(scope, id, tx)) {
          return /** @type {const} */ ({ status: "suppressed" });
        }
        const { merge } = planDuplicateMerge(current, current);
        const { revision } = await memories.touchDuplicate(tx, scope, id, [], merge, clock.nowMs());
        return { status: decision.status, id, revision };
      });

      if (result.status === "paused" || result.status === "suppressed") return result;
      const item = await deliver(scope, result.id, result.revision);
      return item ? { status: result.status, item } : { status: "suppressed" };
    }, invalid),

    correct: entry(async (input, inputId, inputRevision, raw, inputSource) => {
      const scope = scopeOf(input);
      const id = identifier(inputId);
      const expectedRevision = revision(inputRevision);
      sourceOf(inputSource);
      if (typeof raw !== "string") throw new CoreError("invalid_input");
      const { owner } = scope;
      const { state: preflight, previous } = await uow.run(owner, { pauseLock: true }, async tx => {
        const state = pauseResult(await pause.get(tx, owner));
        const row = state.paused ? null : await scopedRow(memories, scope, id, tx);
        const previous = row && await visible(scope, id, tx) ? row : null;
        return { state, previous };
      });
      if (preflight.paused) return { status: "paused" };
      if (!previous) return { status: "not_found" };
      if (previous.revision !== expectedRevision || previous.historical) return { status: "conflict" };

      await gate.assertOpen(owner, "pre-send");
      const text = prepareCoreText(raw);
      if (!text) throw new CoreError("invalid_text");
      const key = await keys.userKey(owner);
      if (key === null) throw new CoreError("fingerprint_unavailable");
      const { query, passages } = await prepareWriteText(raw, text, key, sha256Hex);
      const unchanged = sameText(previous, query, text);
      const embedding = unchanged ? null : await embed(owner, text, key);
      query.embedding = embedding?.vector;
      const source = previous.source;

      const predecessor = unchanged ? undefined : await predecessorFact(scope, previous, key, clock, "edit");

      let result;
      if (!unchanged) await gate.assertOpen(owner, "post-send");
      try {
        result = await uow.run(owner, { pauseLock: true }, async tx => {
          const state = pauseResult(await pause.get(tx, owner));
          if (state.paused || state.generation !== preflight.generation) return /** @type {const} */ ({ status: "paused" });
          const current = await scopedRow(memories, scope, id, tx);
          if (current === null || !await visible(scope, id, tx)) return /** @type {const} */ ({ status: "not_found" });
          if (current.revision !== expectedRevision || current.textHash !== previous.textHash ||
              current.text !== previous.text || current.createdAtMs !== previous.createdAtMs || current.historical) {
            return /** @type {const} */ ({ status: "conflict" });
          }
          if (await withheld(suppressions, tx, scope, source, passages, key, { id, createdAtMs: current.createdAtMs })) {
            return /** @type {const} */ ({ status: "suppressed" });
          }
          const policy = await memories.readWritePolicy(tx, scope, [query], source, "full", id);
          const decision = decide(policy, false, id);
          if (decision.status === "suppressed") return decision;
          const plan = planCorrect(current, expectedRevision,
            { textHash: unchanged ? current.textHash : query.textHash, kind: current.kind }, decision.status === "duplicate");
          if (plan.outcome === "unchanged") return /** @type {const} */ ({ status: "unchanged", revision: plan.revision });
          if (!predecessor) throw new CoreError("internal_error");
          const { kind, origin, confidence, textHash } = plan;
          const now = clock.nowMs();
          await suppressions.writeFact(tx, predecessor.fact, predecessor.incarnation);
          const replaced = await memories.replaceContent(tx, scope, id, expectedRevision,
            { kind, origin, confidence, textHash, text, source, embedding, digests: query.digests }, null, now);
          if (replaced.outcome !== "changed") throw new CoreError("internal_error");
          return /** @type {const} */ ({ status: "saved", revision: replaced.revision });
        });
      } catch (error) {
        const failure = entryError(error);
        if (["revision_conflict", "memory_conflict", "memory_historical"].includes(failure.code)) return { status: "conflict" };
        if (failure.code === "memory_not_found") return { status: "not_found" };
        throw failure;
      }

      if (result.status !== "saved" && result.status !== "unchanged") return result;
      const item = await deliver(scope, id, result.revision);
      return item ? { status: result.status, item } : { status: "not_found" };
    }),
  };
}
