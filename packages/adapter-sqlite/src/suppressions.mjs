import { createHmac } from "node:crypto";
import { compareUtf8, CoreError, factBlocksIncoming, factBody, factHidesRow, validateSuppressionFact } from "@cairn-ink/core";
import { decodeJson, readEntry, readReceipts } from "./memory-rows.mjs";
import { legacyRawHash } from "./migrate/raw-privacy.mjs";
import { digestAliases, invalidInput, ownerKey, scopeKey, sha256 } from "./storage-values.mjs";

/** @import { FactMatchIncoming, FactMatchRow, StoredFact, SuppressionFact, TextDigest, TextFact } from "@cairn-ink/core" */
/** @import { DuplicateQuery, Receipt, Scope, SourceRef, SuppressionStore, Tx } from "@cairn-ink/core/ports" */
/** @import { Connection, Port } from "./storage-values.mjs" */
/** @import { Entry } from "./memory-rows.mjs" */
/** @import { MigratedRawPolicy } from "./migrate/raw-privacy.mjs" */
/** @typedef {(scope: Scope, client: string, sessionId: string) => string} SessionHasher */

const matchPolicy = { rowShingles: false };
const capture = /** @type {const} */ ({ ...matchPolicy, mode: "capture" });
const capturePassages = /** @type {const} */ ({ mode: "capture", rowShingles: true });

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
    (legacy ? legacyRawHash(key, scope, "episode-v1", client, sessionId) : null) ??
    createHmac("sha256", secret).update(JSON.stringify(["cairn-sqlite-session", ...scopeKey(scope), client, sessionId])).digest("hex");
}

/** @param {SuppressionFact} fact */
function factSlot(fact) {
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
function readEpoch(db, owner) {
  const row = db.prepare("SELECT epoch FROM cairn_suppression_epochs WHERE owner_id = ?").get(ownerKey(owner));
  return row ? BigInt(String(row.epoch)) : null;
}

/** @param {Connection} db @param {string} owner */
export function advanceSuppressionEpoch(db, owner) {
  const epoch = (readEpoch(db, owner) ?? 0n) + 1n;
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
    const fact = validateSuppressionFact({ ...decodeJson(row.body), owner: scope.owner, actionId: decodeJson(row.action_id) });
    if ((fact.namespace ?? null) !== scope.namespace) throw new CoreError("ineligible");
    return {
      fact, factId: String(row.fact_id), incarnation: String(row.incarnation),
      epoch: BigInt(String(row.epoch)), createdAtMs: Number(row.created_at_ms),
    };
  });
}

/** @param {StoredFact} stored @returns {stored is StoredFact<TextFact>} */
const isText = stored => stored.fact.kind === "text";

/** @param {Connection} db @param {Scope} scope */
export function readLegacyDenials(db, scope) {
  return new Set(db.prepare("SELECT fingerprint FROM cairn_legacy_denials WHERE owner_id = ? AND namespace_key = ?")
    .all(...scopeKey(scope)).map(row => String(row.fingerprint)));
}

/** @param {Connection} db @param {Scope} scope @param {SessionHasher} hashSession */
export function scopedSuppression(db, scope, hashSession) {
  const facts = readFacts(db, scope);
  const texts = facts.filter(isText);
  const sessions = facts.filter(({ fact }) => fact.kind === "session");
  const windows = facts.filter(({ fact }) => fact.kind === "window");
  const hasSpans = facts.some(({ fact }) => fact.kind === "rawSpan");
  const legacy = readLegacyDenials(db, scope);
  const hasLegacyReceipts = [...legacy].some(key => key.startsWith("rs1:"));

  /** @param {readonly TextDigest[]} digests @param {string} [historyHash] */
  const legacyText = (digests, historyHash) => digests.some(digest =>
    digest.alg === "sha256" && digest.value !== historyHash && legacy.has(digest.value));

  /** @param {ReadonlyArray<Receipt & { legacyReceiptKey?: string }>} [receipts] */
  function blocksReceipts(receipts) {
    return hasLegacyReceipts && (receipts?.some(({ client, sessionId, messageId, role, legacyReceiptKey }) =>
      (legacyReceiptKey !== undefined && legacy.has("rs1:i:" + legacyReceiptKey)) ||
      legacy.has("rs1:a:" + sha256(JSON.stringify(["receipt-source-address-v1", client, sessionId, messageId, role]))))
      ?? false);
  }

  /** @param {Entry} entry */
  function classify(entry) {
    const { row, legacyHash, historyHash, digests } = entry;
    const aliases = digestAliases({ textHash: row.textHash, legacyHash, digests });
    const receipts = sessions.length || hasSpans || hasLegacyReceipts ? readReceipts(db, scope, row.id) : [];
    /** @type {FactMatchRow} */
    const candidate = { type: "memory", scope, memoryId: row.id, revision: row.revision, digests: aliases };
    const applicable = facts.filter(stored => {
      switch (stored.fact.kind) {
        case "identity":
        case "text":
          return factHidesRow(stored, candidate, matchPolicy) !== false;
        case "session":
          return receipts.some(({ client, sessionId, occurredAtMs }) =>
            factHidesRow(stored, { ...candidate, source: {
              client, sessionKeyHash: hashSession(scope, client, sessionId), occurredAtMs,
            } }, matchPolicy) !== false);
        case "rawSpan": {
          const { sessionKeyHash, messageKey } = stored.fact;
          // A capture receipt attributes the full message to the memory.
          return receipts.some(receipt => receipt.messageId === messageKey &&
            hashSession(scope, receipt.client, receipt.sessionId) === sessionKeyHash);
        }
        default:
          return false;
      }
    });
    const retained = row.historical && legacyHash === "sha256:" + historyHash ? historyHash : undefined;
    return { applicable, legacyDenied: legacyText(aliases, retained) || blocksReceipts(receipts) };
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

    /** @param {DuplicateQuery} query @param {"hash" | "full"} mode @param {FactMatchIncoming["sourceMemory"]} sourceMemory */
    blocks(query, mode, sourceMemory) {
      const digests = digestAliases(query);
      return legacyText(digests) || texts.some(stored =>
        factBlocksIncoming(stored, { scope, passages: [{ digests }], sourceMemory },
          mode === "hash" ? { ...matchPolicy, mode: "explicitSave" } : capture) !== false);
    },

    blocksSession,
    blocksReceipts,

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
          return result !== false || (text.digests.every(digest => digest.keyId !== null) &&
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
 * @param {MigratedRawPolicy} [migratedRaw] @returns {SuppressionStore}
 */
export function createSuppressionStore(port, hashSession, markDirty, migratedRaw) {
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
        markDirty?.(db, tx);
        return { factId: String(inserted?.fact_id), epoch, createdAtMs, created: true };
      });
    },
    snapshot(tx, scope, candidates) {
      return port(tx, scope?.owner, {}, db => {
        const result = scopedSuppression(db, scope, hashSession).snapshot(candidates);
        const { client, sessionId } = candidates;
        if (client && sessionId && migratedRaw?.blocks(db, scope, { client, sessionId }, [])) result.blockedSession = true;
        return result;
      });
    },
    factsFor(tx, scope, { memoryId }) {
      return port(tx, scope?.owner, {}, db => scopedSuppression(db, scope, hashSession)
        .factsFor(memoryId, readEntry(db, scope, memoryId)));
    },
    epoch(tx, owner) {
      return port(tx, owner, {}, db => readEpoch(db, owner));
    },
  };
}
