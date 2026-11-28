import { createHmac } from "node:crypto";
import { compareUtf8, CoreError, factBlocksIncoming, factBody, factHidesRow, hasLegacyPassageDigest, validateSuppressionFact } from "../../core/src/index.mjs";
import { decodeJson, readEntry, readReceipts, readSuppressionEpoch } from "./memory-rows.mjs";
import { legacyRawHash, opaqueSessionHash } from "./migrate/raw-privacy.mjs";
import { rawFactPolicy } from "./raw-facts.mjs";
import { allowsRawSession } from "./raw-lineage.mjs";
import { readRawRow } from "./raw-rows.mjs";
import { receiptAddressDenial, receiptIdentityDenial, receiptIdentityKey } from "./receipt-identity.mjs";
import { copyReceipts, digestAliases, invalidInput, scopeKey, sha256 } from "./storage-values.mjs";

/** @import { FactMatchIncoming, FactMatchRow, RawSpanFact, StoredFact, SuppressionFact, TextDigest, TextFact } from "@cairn-ink/core" */
/** @import { DuplicateQuery, Receipt, Scope, SourceRef, SuppressionStore, Tx } from "@cairn-ink/core/ports" */
/** @import { Connection, Port } from "./storage-values.mjs" */
/** @import { Entry } from "./memory-rows.mjs" */
/** @import { StoredReceipt } from "./memory-rows.mjs" */
/** @import { MigratedRawPolicy } from "./migrate/raw-privacy.mjs" */
/** @import { MigratedCaptureControls } from "./migrate/capture-controls.mjs" */
/** @typedef {(scope: Scope, client: string, sessionId: string) => string} SessionHasher */
/** @typedef {NonNullable<TextFact["sourceMemory"]>} Predecessor */

const matchPolicy = { rowShingles: false };
const capture = /** @type {const} */ ({ ...matchPolicy, mode: "capture" });
const capturePassages = /** @type {const} */ ({ mode: "capture", rowShingles: true });
/** @type {WeakMap<Tx, bigint>} */
const firstReplacementEpoch = new WeakMap();
/** @type {WeakMap<StoredFact, Predecessor>} */
const textPredecessors = new WeakMap();

/** @param {object} evidence */
function hasNoShingleEvidence(evidence) {
  return ["keyId", "shingles", "retainedShingles"].every(name => {
    const field = Object.getOwnPropertyDescriptor(evidence, name);
    if (!field) return true;
    if (!Object.hasOwn(field, "value")) return false;
    return field.value == null ||
      (name === "retainedShingles" && Array.isArray(field.value) && field.value.length === 0);
  });
}

/** @param {string} key @param {boolean} [legacy] @returns {SessionHasher} */
export function sessionHasher(key, legacy = false) {
  const secret = Buffer.from(key, "hex");
  return (scope, client, sessionId) =>
    (legacy ? opaqueSessionHash(sessionId) ?? legacyRawHash(key, scope, "episode-v1", client, sessionId) : null) ??
    createHmac("sha256", secret).update(JSON.stringify(["cairn-sqlite-session", ...scopeKey(scope), client, sessionId])).digest("hex");
}

/** @param {SuppressionFact} fact */
export function factSlot(fact) {
  switch (fact.kind) {
    case "identity":
      return JSON.stringify([fact.kind, fact.memoryId, fact.throughRevision ?? null]);
    case "text": {
      const pairs = fact.text.digests.map(({ alg, value }) => alg + ":" + value).sort(compareUtf8);
      return JSON.stringify([fact.kind, fact.mode, pairs, fact.sourceMemory?.id ?? null]);
    }
    case "session":
      return JSON.stringify([fact.kind, fact.session.client,
        "sessionKeyHash" in fact.session ? fact.session.sessionKeyHash : null]);
    case "window":
      return JSON.stringify([fact.kind, fact.client, fact.window.startMs, fact.window.endMs,
        fact.unknownTime ?? null, fact.anchor ?? null]);
    case "rawSpan":
      return JSON.stringify([fact.kind, fact.sessionKeyHash, fact.messageKey, fact.startUtf16, fact.endUtf16]);
  }
}

/** @param {SuppressionFact} input */
function copyFact(input) {
  const fact = validateSuppressionFact(input);
  const { owner, namespace, actionId, origin } = fact;
  const base = { owner, namespace, actionId, origin };
  const { kind } = fact;
  switch (kind) {
    case "identity":
      return { ...base, kind, memoryId: fact.memoryId, throughRevision: fact.throughRevision };
    case "text": {
      const { digests, embedding, shingles, keyId } = fact.text;
      const source = fact.sourceMemory;
      return {
        ...base, kind, mode: fact.mode,
        sourceMemory: source == null ? source : { id: source.id, createdAtMs: source.createdAtMs },
        text: {
          digests: digests.map(({ alg, value, pipeline, redactionVersion, keyId, label }) =>
            ({ alg, value, pipeline, redactionVersion, keyId, label })),
          embedding: embedding == null ? embedding : [...embedding],
          shingles: shingles == null ? shingles : [...shingles],
          keyId,
        },
      };
    }
    case "session": {
      if (!("sessionKeyHash" in fact.session)) return invalidInput();
      const { client, sessionKeyHash } = fact.session;
      return { ...base, kind, session: { client, sessionKeyHash } };
    }
    case "window": {
      const { client, window: { startMs, endMs }, unknownTime, anchor } = fact;
      return { ...base, kind, client, window: { startMs, endMs }, unknownTime, anchor };
    }
    case "rawSpan": {
      const { sessionKeyHash, messageKey, startUtf16, endUtf16, contentDigest } = fact;
      return { ...base, kind, sessionKeyHash, messageKey, startUtf16, endUtf16, contentDigest };
    }
  }
}

/** @param {Connection} db @param {string} owner */
export function advanceSuppressionEpoch(db, owner) {
  const epoch = (readSuppressionEpoch(db, owner) ?? 0n) + 1n;
  db.prepare(`INSERT INTO cairn_suppression_epochs (owner_id, epoch) VALUES (?, ?)
    ON CONFLICT (owner_id) DO UPDATE SET epoch = excluded.epoch`).run(owner, epoch.toString());
  return epoch;
}

/** @param {Connection} db @param {Scope} scope @returns {StoredFact[]} */
export function readFacts(db, scope) {
  const rows = db.prepare(`SELECT fact_id, incarnation, epoch, created_at_ms, action_id, body
    FROM cairn_suppression_facts WHERE owner_id = ? AND namespace_key = ? ORDER BY length(epoch), epoch`)
    .all(...scopeKey(scope));
  return rows.map(row => {
    const { textPredecessor, ...body } = decodeJson(row.body);
    const fact = validateSuppressionFact({ ...body, owner: scope.owner, actionId: decodeJson(row.action_id) });
    if ((fact.namespace ?? null) !== scope.namespace) throw new CoreError("ineligible");
    const stored = {
      fact, factId: String(row.fact_id), incarnation: String(row.incarnation),
      epoch: BigInt(String(row.epoch)), createdAtMs: Number(row.created_at_ms),
    };
    if (textPredecessor) textPredecessors.set(stored, textPredecessor);
    return stored;
  });
}

/** @param {StoredFact} stored @returns {stored is StoredFact<TextFact>} */
const isText = stored => stored.fact.kind === "text";

/** @param {SuppressionFact} fact @returns {fact is TextFact} */
const isReplacement = fact => fact.kind === "text" && (fact.origin === "edit" || fact.origin === "correct");

/** @param {StoredFact} stored @param {Entry["row"]} memory @param {Receipt} receipt @param {SessionHasher} hashSession */
export function isReceiptCorrection(stored, memory, receipt, hashSession) {
  const { fact } = stored;
  if (!isReplacement(fact)) return false;
  const source = textPredecessors.get(stored) ?? fact.sourceMemory;
  if (source) return source.id === memory.id && source.createdAtMs === memory.createdAtMs;
  // Unsourced legacy facts need positive evidence in this memory's retained receipt.
  const { messageId, role, excerpt, occurredAtMs } = receipt;
  return excerpt !== undefined && rawFactPolicy(memory.scope, receipt, [stored], hashSession)
    .purges({ id: messageId, role, content: excerpt, occurredAtMs });
}

/** @param {StoredFact<TextFact>} stored @param {Entry} entry */
function predecessorTextMatch(stored, { row, digests, legacyHash }) {
  const legacy = stored.fact.legacyTextHash;
  if (legacy !== undefined && (legacy === row.textHash || legacy === legacyHash)) return true;
  return factHidesRow({ ...stored, fact: { ...stored.fact, mode: "exact" } },
    { type: "memory", scope: row.scope, memoryId: row.id, revision: row.revision, digests }, matchPolicy);
}

/** @param {Connection} db @param {Tx} tx @param {Entry} entry @param {StoredFact[]} facts */
export function recordTextReplacement(db, tx, entry, facts) {
  const { row: { id, scope, createdAtMs, revision }, textVersions } = entry;
  const since = BigInt(textVersions.at(-1)?.factEpoch ?? "0");
  const first = firstReplacementEpoch.get(tx);
  for (const stored of facts) {
    const { fact, epoch } = stored;
    if (!isReplacement(fact) || textPredecessors.has(stored) || epoch <= since) continue;
    const source = fact.sourceMemory;
    if (source && (source.id !== id || source.createdAtMs !== createdAtMs)) continue;
    if ((source && first !== undefined && epoch >= first) || predecessorTextMatch({ ...stored, fact }, entry) === true) {
      // Store only the predecessor's identity. The fact and its incarnation
      // remain unchanged, and no predecessor text is retained here.
      db.prepare(`UPDATE cairn_suppression_facts SET body = json_set(body, '$.textPredecessor', json(?))
        WHERE owner_id = ? AND namespace_key = ? AND fact_id = ?`)
        .run(JSON.stringify({ id, createdAtMs }), ...scopeKey(scope), stored.factId);
    }
  }
  return [...textVersions, { revision: revision + 1, factEpoch: String(readSuppressionEpoch(db, scope.owner) ?? 0n) }];
}

/** @param {StoredFact[]} facts @param {Entry | undefined} entry @param {{id: string, revision: number}} link */
export function memoryCorrectionEvidence(facts, entry, { id, revision }) {
  const current = entry?.textVersions.at(-1);
  let version;
  for (const candidate of entry?.textVersions ?? []) {
    if (candidate.revision > revision) break;
    version = candidate;
  }
  let hasReplacement = false;
  let unresolvedCorrection = false;
  for (const stored of facts) {
    const { fact, epoch } = stored;
    if (!isReplacement(fact)) continue;
    const textPredecessor = textPredecessors.get(stored);
    const source = textPredecessor ?? fact.sourceMemory;
    if (source && (source.id !== id || (entry && source.createdAtMs !== entry.row.createdAtMs))) continue;
    if (textPredecessor) {
      hasReplacement = true;
      if (!current) unresolvedCorrection = true;
    } else if ((!version || epoch > BigInt(version.factEpoch)) &&
        (!entry || version !== current || predecessorTextMatch({ ...stored, fact }, entry) !== false)) {
      unresolvedCorrection = true;
    }
  }
  const cutoff = hasReplacement ? current?.revision ?? 1 : 1;
  const correctedRevisions = Array.from({ length: cutoff }, (_, index) => index);
  return { correctedRevisions, unresolvedCorrection };
}

/** @param {Connection} db @param {Scope} scope */
export function readLegacyDenials(db, scope) {
  return new Set(db.prepare("SELECT fingerprint FROM cairn_legacy_denials WHERE owner_id = ? AND namespace_key = ?")
    .all(...scopeKey(scope)).map(row => String(row.fingerprint)));
}

/** @param {Connection} db @param {Scope} scope @param {SessionHasher} hashSession
 * @param {ReadonlySet<string>} [forgetFactIds]
 */
export function scopedSuppression(db, scope, hashSession, forgetFactIds) {
  const all = readFacts(db, scope);
  const facts = !forgetFactIds ? all : all.filter(({ fact, factId }) =>
    fact.origin === "forget" && forgetFactIds.has(factId));
  const texts = facts.filter(isText);
  const sessions = facts.filter(({ fact }) => fact.kind === "session");
  const windows = facts.filter(({ fact }) => fact.kind === "window");
  const memoryForgets = new Set(facts.flatMap(({ fact }) => fact.origin === "forget" &&
    (fact.kind === "identity" || (fact.kind === "text" && fact.sourceMemory)) ? [fact.actionId] : []));
  /** @param {RawSpanFact} fact */
  const hidesAttributedMemories = fact => fact.origin !== "forget" || !memoryForgets.has(fact.actionId);
  const hasMemorySpans = facts.some(({ fact }) => fact.kind === "rawSpan" && hidesAttributedMemories(fact));
  const legacy = forgetFactIds ? new Set() : readLegacyDenials(db, scope);
  const hasLegacyReceipts = [...legacy].some(key => key.startsWith("rs1:"));
  const needsReceipts = sessions.length > 0 || hasMemorySpans || hasLegacyReceipts;

  /** @param {readonly TextDigest[]} digests @param {string} [historyHash] */
  const legacyText = (digests, historyHash) => digests.some(digest =>
    digest.alg === "sha256" && digest.value !== historyHash && legacy.has(digest.value));

  /** @param {readonly StoredReceipt[]} [receipts] @param {boolean} [stored] */
  function blocksReceipts(receipts, stored = false) {
    return hasLegacyReceipts && (receipts?.some(({ client, sessionId, messageId, role, legacyReceiptKey, legacy: proof }) =>
      // Stored migration receipts already passed legacy's canonical read.
      // The proof is written at migration and paired with its private column.
      !(stored && legacyReceiptKey !== undefined && proof?.canonicalRead === true) &&
      ((legacyReceiptKey !== undefined && legacy.has("rs1:i:" + legacyReceiptKey)) ||
        legacy.has("rs1:a:" + sha256(JSON.stringify(["receipt-source-address-v1", client, sessionId, messageId, role])))))
      ?? false);
  }

  /** @param {Receipt} receipt @param {string} [key] @param {string} [legacyKey] */
  function hasReceiptDenial(receipt, key, legacyKey) {
    return legacy.has(receiptAddressDenial(receipt)) ||
      (key !== undefined && (legacy.has(receiptIdentityDenial(key)) || legacy.has("rs1:i:" + key))) ||
      blocksReceipts([{ ...receipt, legacyReceiptKey: legacyKey },
        { ...receipt, role: receipt.role === "user" ? "assistant" : "user" }]);
  }

  /** @param {Entry} entry @param {boolean} [definiteOnly] */
  function classify(entry, definiteOnly = false) {
    const { row, legacyHash, historyHash, digests } = entry;
    const aliases = digestAliases({ textHash: row.textHash, legacyHash, digests });
    const receipts = needsReceipts ? readReceipts(db, scope, row.id) : [];
    /** @type {FactMatchRow} */
    const candidate = { type: "memory", scope, memoryId: row.id, revision: row.revision, digests: aliases };
    /** @param {StoredFact} stored @param {FactMatchRow} evidence */
    const matches = (stored, evidence) => {
      const result = factHidesRow(stored, evidence, matchPolicy);
      return definiteOnly ? result === true : result !== false;
    };
    const applicable = facts.filter(stored => {
      const { fact } = stored;
      switch (fact.kind) {
        case "identity":
        case "text":
          return matches(stored, candidate);
        case "session":
          return receipts.some(({ client, sessionId, occurredAtMs }) =>
            matches(stored, { ...candidate, source: {
              client, sessionKeyHash: hashSession(scope, client, sessionId), occurredAtMs,
            } }));
        case "rawSpan": {
          // A span written by Memory forget closes the receipt's source. An
          // independent passage suppression still hides attributed Memories.
          if (!hidesAttributedMemories(fact)) return false;
          const { sessionKeyHash, messageKey } = fact;
          // A capture receipt attributes the full message to the memory.
          return receipts.some(receipt => receipt.messageId === messageKey &&
            hashSession(scope, receipt.client, receipt.sessionId) === sessionKeyHash);
        }
        default:
          return false;
      }
    });
    const retained = row.historical && legacyHash === "sha256:" + historyHash ? historyHash : undefined;
    return { applicable, legacyDenied: legacyText(aliases, retained) || blocksReceipts(receipts, true) };
  }

  /** @param {SourceRef["client"] | undefined} client @param {SourceRef["sessionId"] | undefined} sessionId */
  function blocksSession(client, sessionId) {
    if (client == null || sessionId == null) return false;
    const session = { client, sessionKeyHash: hashSession(scope, client, sessionId) };
    return sessions.some(stored => factBlocksIncoming(stored, { scope, passages: [], session }, capture) !== false);
  }

  return {
    /** @param {Entry} entry */
    hides(entry) {
      if (!facts.length && !legacy.size) return false;
      const { applicable, legacyDenied } = classify(entry);
      return legacyDenied || applicable.length > 0;
    },

    /** @param {Entry} entry */
    definitelyHides(entry) {
      return classify(entry, true).applicable.length > 0;
    },

    /** @param {DuplicateQuery} query @param {"hash" | "full"} mode @param {FactMatchIncoming["sourceMemory"]} sourceMemory */
    blocks(query, mode, sourceMemory) {
      const digests = digestAliases(query);
      return legacyText(digests) || texts.some(stored =>
        factBlocksIncoming(stored, { scope, passages: [{ digests }], sourceMemory },
          mode === "hash" ? { ...matchPolicy, mode: "explicitSave" } : capture) !== false);
    },

    blocksSession,
    blocksReceipts,

    facts,
    legacy,
    hasReceiptDenial,

    /** @param {Receipt} receipt @param {string} [key] @param {string} [legacyKey] */
    withholdsReceipt(receipt, key, legacyKey) {
      const { client, sessionId, messageId, occurredAtMs } = receipt;
      const sessionKeyHash = hashSession(scope, client, sessionId);
      return hasReceiptDenial(receipt, key, legacyKey) || blocksSession(client, sessionId) ||
        facts.some(({ fact }) => fact.kind === "rawSpan" && fact.messageKey === messageId && fact.sessionKeyHash === sessionKeyHash) ||
        windows.some(stored => factBlocksIncoming(stored,
          { scope, passages: [], session: { client, sessionId }, occurredAtMs }, capture) !== false);
    },

    /** @param {Parameters<SuppressionStore["snapshot"]>[2]} candidates */
    snapshot({ client, sessionId, occurredAtMs, passages }) {
      /** @type {number[]} */
      const blockedMessages = [];
      const session = client === undefined ? undefined : { client, sessionId: sessionId ?? "" };
      if (occurredAtMs !== undefined) {
        if (!Array.isArray(occurredAtMs)) throw new CoreError("ineligible");
        for (const [index, time] of occurredAtMs.entries()) {
          if (windows.some(stored => factBlocksIncoming(stored,
            { scope, passages: [], session, occurredAtMs: time }, capture) !== false)) blockedMessages.push(index);
        }
        // This port has no message coordinates with which to exclude a span.
        if (facts.some(({ fact }) => fact.kind === "rawSpan" &&
          (client === undefined || sessionId === undefined ||
            fact.sessionKeyHash === hashSession(scope, client, sessionId)))) throw new CoreError("ineligible");
      }
      let keylessPassages = false;
      if (passages !== undefined) {
        if (!Array.isArray(passages)) throw new CoreError("ineligible");
        for (const passage of passages) {
          if (!Array.isArray(passage?.digests) || !passage.digests.length) throw new CoreError("ineligible");
          if (legacyText(passage.digests)) throw new CoreError("ineligible");
        }
        keylessPassages = passages.length > 0 && passages.every(passage =>
          hasNoShingleEvidence(passage) &&
          passage.digests.every((/** @type {TextDigest} */ digest) => digest?.keyId === null));
      }
      return {
        blockedSession: blocksSession(client, sessionId),
        blockedMessages,
        passages: passages === undefined ? texts : texts.filter(stored => {
          const { text } = stored.fact;
          // The paired keyless profile has exact evidence only. Retained
          // shingles and keyed digests still go through capture containment.
          const rules = keylessPassages && hasNoShingleEvidence(text) &&
            text.digests.every(digest => digest.keyId === null) ? capture : capturePassages;
          const result = factBlocksIncoming(stored, { scope, passages }, rules);
          // Let core handle legacy-only digest domains even on a comparable miss.
          return result !== false || (passages.length > 0 && hasLegacyPassageDigest(stored.fact)) ||
            (text.digests.every(digest => digest.keyId !== null) &&
            text.digests.some(digest => (digest.label ?? digest.pipeline) !== "core"));
        }),
      };
    },

    /** @param {string} id @param {Entry | undefined} entry @returns {StoredFact[] | "ineligible"} */
    factsFor(id, entry) {
      if (!entry) return facts.filter(({ fact }) => fact.kind === "identity" && fact.memoryId === id);
      const { applicable, legacyDenied } = classify(entry);
      // The retained fingerprint has no typed action or origin to return.
      return legacyDenied ? "ineligible" : applicable;
    },
  };
}

/** @param {Port} port @param {SessionHasher} hashSession
 * @param {(db: Connection, tx: Tx) => void} [markDirty]
 * @param {MigratedRawPolicy} [migratedRaw] @param {MigratedCaptureControls} [controls]
 * @param {ReturnType<typeof import("./placement-visibility.mjs").createTitleScrubber>} [scrubTitles]
 * @param {(db: Connection, tx: Tx, scope: Scope, stored: StoredFact<RawSpanFact>) => void} [purgeForgottenSpan]
 * @returns {SuppressionStore}
 */
export function createSuppressionStore(port, hashSession, markDirty, migratedRaw, controls, scrubTitles, purgeForgottenSpan) {
  return {
    writeFact(tx, input, incarnation) {
      return port(tx, input?.owner, { write: true }, db => {
        const fact = copyFact(input);
        if (fact.owner !== tx.owner) throw new CoreError("internal_error");
        if (typeof incarnation !== "string" || !/^[0-9a-f]{64}$/u.test(incarnation)) invalidInput();
        const { owner, namespace = null, actionId } = fact;
        const keys = [...scopeKey({ owner, namespace }), factSlot(fact)];
        const previous = db.prepare(`SELECT fact_id, incarnation, epoch, created_at_ms FROM cairn_suppression_facts
          WHERE owner_id = ? AND namespace_key = ? AND slot = ?`).get(...keys);
        if (previous) {
          if (previous.incarnation !== incarnation) throw new CoreError("fact_conflict");
          return {
            factId: String(previous.fact_id), epoch: BigInt(String(previous.epoch)),
            createdAtMs: Number(previous.created_at_ms), created: false,
          };
        }
        const epoch = advanceSuppressionEpoch(db, owner);
        const createdAtMs = Date.now();
        const inserted = db.prepare(`INSERT INTO cairn_suppression_facts
          (owner_id, namespace_key, slot, fact_id, incarnation, epoch, created_at_ms, action_id, body)
          VALUES (?, ?, ?, lower(hex(randomblob(16))), ?, ?, ?, ?, ?) RETURNING fact_id`)
          .get(...keys, incarnation, epoch.toString(), createdAtMs, JSON.stringify(actionId), factBody(fact));
        const scope = { owner, namespace };
        const factId = String(inserted?.fact_id);
        if (isReplacement(fact) && !firstReplacementEpoch.has(tx)) firstReplacementEpoch.set(tx, epoch);
        if (fact.kind === "rawSpan" && fact.origin === "forget") {
          purgeForgottenSpan?.(db, tx, scope, { fact, factId, epoch, incarnation, createdAtMs });
        }
        scrubTitles?.(db, scope);
        markDirty?.(db, tx);
        return { factId, epoch, createdAtMs, created: true };
      });
    },
    snapshot(tx, scope, candidates) {
      return port(tx, scope?.owner, {}, db => {
        const { client, sessionId } = candidates;
        // Enqueue starts with a session-only snapshot. Explicit Memory writes
        // supply passage or time evidence and have their own authority.
        if (!tx.readOnly && client && sessionId && candidates.passages === undefined && candidates.occurredAtMs === undefined) {
          controls?.assertCapture({ scope, client });
        }
        const result = scopedSuppression(db, scope, hashSession).snapshot(candidates);
        if (client && sessionId && migratedRaw?.blocks(db, scope, { client, sessionId }, [])) result.blockedSession = true;
        return result;
      });
    },
    receiptWithheld(tx, scope, input) {
      return port(tx, scope?.owner, {}, db => {
        const [receipt] = copyReceipts([input]);
        const { client, messageId, occurredAtMs, excerpt } = receipt;
        if (excerpt === undefined) invalidInput();
        const policy = scopedSuppression(db, scope, hashSession);
        if (policy.hasReceiptDenial(receipt, receiptIdentityKey(receipt))) return true;
        const raw = rawFactPolicy(scope, receipt, policy.facts, hashSession);
        const position = { id: messageId, occurredAtMs };
        if (!allowsRawSession(db, scope, client, raw.sessionKeyHash, policy.facts) || raw.refusesSource(position, true) ||
            migratedRaw?.blocksEvent(db, { scope, client, eventId: messageId }) ||
            migratedRaw?.blocks(db, scope, receipt, [position]) ||
            migratedRaw?.blocksSpan(db, scope, receipt, messageId)) return true;
        const session = migratedRaw?.storageSession(db, scope, receipt) ?? receipt;
        const archived = readRawRow(db, scope, session, messageId);
        return archived ? raw.refusesSource(archived.message, true) : false;
      });
    },
    factsFor(tx, scope, { memoryId }) {
      return port(tx, scope?.owner, {}, db => scopedSuppression(db, scope, hashSession)
        .factsFor(memoryId, readEntry(db, scope, memoryId)));
    },
    epoch(tx, owner) {
      return port(tx, owner, {}, db => readSuppressionEpoch(db, owner));
    },
  };
}
