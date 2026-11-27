import { allDigests, coreDigest, CoreError, NEAR_DUPLICATE_DISTANCE, compareUtf8, receiptExcerpt } from "@cairn-ink/core";
import { cosineDistance } from "./cosine.mjs";
import { decodeCursor, encodeCursor, newestFirst } from "./cursor.mjs";
import { createFactMatcher } from "./fact-match.mjs";
import { eraseRelations } from "./memory-relations.mjs";
import { invalidateRationale } from "./rationale.mjs";
import { addKeyedDigest, recordTextReplacement } from "./privacy.mjs";
import { MEMORY_FORGET_RECEIPT, receiptAddressKey, receiptExcerptDenial, receiptIdentityKey } from "./receipt-read-safety.mjs";
import { advanceInspectEpoch, advanceRawInspectEpoch, copyPublicRow, dropMemoryPlacement } from "./unit-of-work.mjs";
import {
  attachReceipts, copyContent, copyDuplicateBatch, copyMerge, copyReceipts, validateLimit, validateMemoryId,
  validateSource, validateTime, writeNamespace, writeTime,
} from "./validation.mjs";

export { writeTime };

/** @typedef {import("@cairn-ink/core/ports").DuplicateQuery} DuplicateQuery */
/** @typedef {import("@cairn-ink/core/ports").MemoryMatch} MemoryMatch */
/** @typedef {import("@cairn-ink/core/ports").MemoryStore} MemoryStore */
/** @import { InsertRow, Receipt, Scope, SourceRef, Tx } from "@cairn-ink/core/ports" */
/** @import { CanonicalQuery } from "./validation.mjs" */
/** @import { StoredReceipt } from "./receipt-read-safety.mjs" */
/** @typedef {ReturnType<typeof copyContent>} CopiedContent */
/** @typedef {import("./unit-of-work.mjs").Row} Row */
/** @typedef {import("./unit-of-work.mjs").Entry} Entry */
/** @typedef {{match: "exact" | "near", distance: number}} MatchQuality */

/** @param {MemoryMatch & MatchQuality} a @param {MemoryMatch & MatchQuality} b */
function matchOrder(a, b) {
  if (a.match !== b.match) return a.match === "exact" ? -1 : 1;
  if (a.distance !== b.distance) return a.distance - b.distance;
  if (a.kind === "prior") return b.kind === "prior" ? b.batchIndex - a.batchIndex : -1;
  if (b.kind === "prior") return 1;
  return newestFirst({ id: a.id, updatedAtUs: a.writeTimeUs }, { id: b.id, updatedAtUs: b.writeTimeUs });
}

/**
 * @param {ReturnType<typeof import("./unit-of-work.mjs").createUnitOfWork>["port"]} port
 * @param {import("@cairn-ink/core/ports").StorageAdapter["capabilities"]} capabilities
 * @param {() => string} newId
 * @param {ReturnType<typeof createFactMatcher>} [matchFacts]
 * @param {import("./privacy.mjs").RingKeys} [ringKeys]
 */
export function createMemoryStore(port, capabilities, newId, matchFacts = createFactMatcher(capabilities.vectorSuppression),
  ringKeys = async () => []) {
  let nearSkippedUnembedded = 0;
  const proceduralTags = capabilities.proceduralTags === true;

  /** @param {InsertRow} row */
  const prepareContent = (row) => copyContent(row, "memory", capabilities.embeddingRequiredOnInsert);

  /** @param {string} owner @param {CopiedContent} content */
  async function rowDigests(owner, content) {
    const keys = await ringKeys(owner);
    const provided = content.digests;
    const digests = provided ? [...provided] : await allDigests(content.text, keys[0]);
    const remaining = provided ? keys : keys.slice(1);
    for (const keyed of await Promise.all(remaining.map((key) => coreDigest(content.text, key)))) {
      addKeyedDigest(digests, keyed);
    }
    return digests;
  }

  /**
   * @param {DuplicateQuery} query @param {DuplicateQuery & {historical?: boolean}} candidate @param {number} nearDistance
   * @returns {MatchQuality | undefined}
   */
  function classify(query, candidate, nearDistance) {
    const exact = candidate.textHash === query.textHash || candidate.textHash === query.legacyHash;
    if (!exact && (candidate.historical || !capabilities.nearDuplicate)) return undefined;
    const a = query.embedding;
    const b = candidate.embedding;
    if (!a || !b || a.length !== b.length) {
      if (exact) return { match: "exact", distance: 0 };
      nearSkippedUnembedded++;
      return undefined;
    }
    const distance = cosineDistance(a, b);
    if (exact) return { match: "exact", distance: distance ?? 0 };
    if (distance !== undefined && distance <= nearDistance) return { match: "near", distance };
  }

  /** @param {Row[]} rows @param {readonly DuplicateQuery[]} batch @param {number} nearDistance */
  function matches(rows, batch, nearDistance) {
    return batch.map((query, i) => {
      /** @type {(MemoryMatch & MatchQuality)[]} */
      const result = [];
      for (const row of rows) {
        const quality = classify(query, {
          textHash: row.textHash, embedding: row.embedding?.vector, historical: row.historical,
        }, nearDistance);
        if (quality) result.push({ kind: "stored", ...quality, id: row.id, revision: row.revision, writeTimeUs: row.updatedAtUs });
      }
      for (let j = 0; j < i; j++) {
        const quality = classify(query, batch[j], nearDistance);
        if (quality) result.push({ kind: "prior", ...quality, batchIndex: j });
      }
      return result.sort(matchOrder);
    });
  }

  /** @param {Map<string, Entry> | undefined} namespace */
  function entriesIn(namespace) {
    return namespace ? [...namespace.values()] : [];
  }

  /** @param {import("./unit-of-work.mjs").State} state @param {Entry} entry
   * @param {StoredReceipt[]} incoming @param {number} createdAtMs
   * @param {boolean} [returnReceiptIds] @param {boolean} [checkReplay]
   */
  async function appendReceipts(state, entry, incoming, createdAtMs, returnReceiptIds = false, checkReplay = false) {
    /** @type {StoredReceipt[] | undefined} */
    const retained = returnReceiptIds && incoming.length ? [] : undefined;
    const receipts = attachReceipts(entry.receipts, incoming, retained, checkReplay);
    for (const receipt of receipts.slice(entry.receipts.length)) {
      if (capabilities.inspect) {
        const position = state.nextInspectReceiptPosition++;
        if (!Number.isSafeInteger(position)) throw new CoreError("internal_error");
        (entry.inspectReceiptPositions ??= new Map()).set(receipt, position);
      }
      if (receipt.excerpt !== undefined && (capabilities.inspect || capabilities.contextRead || returnReceiptIds)) {
        receipt.id = capabilities.inspect ? crypto.randomUUID() : (receipt.id ?? crypto.randomUUID());
        receipt.createdAtMs ??= createdAtMs;
        (entry.receiptKeys ??= new Map()).set(receipt, await receiptIdentityKey(receipt));
      } else if (retained) {
        receipt.id = crypto.randomUUID();
      }
    }
    entry.receipts = receipts;
    return retained?.map(receipt => receipt.id ??= crypto.randomUUID());
  }

  /**
   * @template {InsertRow} T
   * @param {typeof port.writeFromFinish} write
   * @param {(row: T) => CopiedContent} prepareContent
   * @param {boolean} [fromFinish]
   * @returns {{insert: (tx: Tx, scope: Scope, row: T, receipts: readonly Receipt[], nowMs: number) =>
   *   ReturnType<MemoryStore["insert"]>, touchDuplicate: MemoryStore["touchDuplicate"]}}
   */
  function memoryWrites(write, prepareContent, fromFinish = false) {
    return {
      async insert(tx, scope, row, receipts, nowMs) {
        return write(tx, scope, () => {
          const content = prepareContent(row);
          const incoming = copyReceipts(receipts, fromFinish);
          validateTime(nowMs);
          const suppliedCreationTime = row.createdAtMs;
          const createdAtMs = suppliedCreationTime === undefined ? nowMs : suppliedCreationTime;
          if (!Number.isSafeInteger(createdAtMs) || createdAtMs > nowMs) throw new CoreError("invalid_input");
          const namespace = writeNamespace(scope);
          return async (getState, markDirty) => {
            const id = newId();
            if (typeof id !== "string" || !id) throw new CoreError("internal_error");
            const state = getState();
            const { rows } = state;
            const digests = await rowDigests(tx.owner, content);
            let entries = rows.get(namespace);
            if (entries?.has(id)) throw new CoreError("internal_error");
            if (!entries) rows.set(namespace, entries = new Map());
            const created = { id, revision: 1, createdAtMs, ...writeTime(nowMs) };
            /** @type {Entry} */
            const entry = {
              row: { ...content, digests, ...created, scope: { owner: tx.owner, namespace }, historical: false },
              receipts: [],
              textVersions: [{ revision: created.revision, factEpoch: state.epoch ?? 0n }],
            };
            const receiptIds = await appendReceipts(state, entry, incoming, nowMs, proceduralTags && !fromFinish);
            entries.set(id, entry);
            advanceInspectEpoch(state, namespace);
            markDirty();
            return { ...created, ...(receiptIds && { receiptIds }) };
          };
        });
      },

      async touchDuplicate(tx, scope, id, receipts, merge, nowMs) {
        return write(tx, scope, () => {
          const copy = copyMerge(merge);
          validateMemoryId(id);
          validateTime(nowMs);
          const incoming = copyReceipts(receipts, fromFinish);
          const namespace = writeNamespace(scope);
          return async (getState, markDirty) => {
            const state = getState();
            const entry = state.rows.get(namespace)?.get(id);
            if (!entry) throw new CoreError("memory_not_found");
            const previousCount = entry.receipts.length;
            const receiptIds = await appendReceipts(state, entry, incoming, nowMs, proceduralTags && !fromFinish, !fromFinish);
            const { row } = entry;
            let changed = capabilities.receiptAttachAdvancesRevision === true && entry.receipts.length > previousCount;
            const proceduralKindChange = !fromFinish && proceduralTags && copy.kind !== row.kind &&
              (copy.kind === "instruction" || copy.kind === "preference");
            if (!row.historical || proceduralKindChange) {
              const { confidence, kind = row.kind, origin = row.origin } = copy;
              changed ||= confidence !== row.confidence || kind !== row.kind || origin !== row.origin;
              Object.assign(row, { confidence, kind, origin });
            }
            if (changed) row.revision++;
            Object.assign(row, writeTime(nowMs));
            if (changed || incoming.length) invalidateRationale(state, namespace, id);
            advanceInspectEpoch(state, namespace);
            markDirty();
            return { outcome: changed ? "changed" : "touched", revision: row.revision, ...(receiptIds && { receiptIds }) };
          };
        });
      },
    };
  }

  const policyReads = {
    /** @param {Tx} tx @param {Scope} scope @param {() => readonly CanonicalQuery[]} prepareBatch
     * @param {SourceRef} source @param {"hash" | "full"} mode @param {string} [editId]
     */
    readWritePolicy(tx, scope, prepareBatch, source, mode, editId) {
      return port.read(tx, scope, (getState) => {
        const batch = prepareBatch();
        const selection = { owner: tx.owner, namespace: scope.namespace };
        const state = getState();
        const policy = matchFacts(state.facts, selection);
        const namespace = state.rows.get(selection.namespace);
        const entries = entriesIn(namespace).filter(({ row }) => row.id !== editId);
        // The synchronous scan processes only adapter-owned rows and queries.
        const before = nearSkippedUnembedded;
        const duplicates = matches(entries.map(({ row }) => row), batch, NEAR_DUPLICATE_DISTANCE);
        const counters = { nearSkippedUnembedded: nearSkippedUnembedded - before };
        const hidden = new Set(entries.filter(policy.hides).map(({ row }) => row.id));
        const hiddenIds = new Set();
        for (const group of duplicates) {
          for (const match of group) {
            if (match.kind === "stored" && hidden.has(match.id)) hiddenIds.add(match.id);
          }
        }
        const edit = editId === undefined ? undefined : namespace?.get(editId)?.row;
        const sourceMemory = edit && { id: edit.id, createdAtMs: edit.createdAtMs };
        const blockedPositions = [];
        for (const [i, query] of batch.entries()) {
          if (policy.blocks(query, mode, sourceMemory)) blockedPositions.push(i);
        }
        return {
          matches: duplicates,
          hiddenIds: [...hiddenIds].sort(compareUtf8),
          blockedPositions,
          blockedSession: policy.blocksSession(source.client, source.sessionId),
          counters,
        };
      });
    },
  };

  /** @type {MemoryStore} */
  const memories = {
    ...memoryWrites((tx, scope, prepare) => port.write(tx, scope, "conditional", prepare), prepareContent),

    async findDuplicates(tx, scope, queries, options) {
      return port.read(tx, scope, (getState) => {
        const batch = copyDuplicateBatch(queries);
        if (!options || typeof options !== "object" || !Number.isFinite(options.nearDistance) || options.nearDistance < 0 ||
          (options.excludeId !== undefined && typeof options.excludeId !== "string")) throw new CoreError("invalid_input");
        const { nearDistance, excludeId } = options;
        const state = getState();
        const selection = { owner: tx.owner, namespace: scope.namespace };
        const policy = matchFacts(state.facts, selection);
        const rows = entriesIn(state.rows.get(selection.namespace))
          .filter((entry) => entry.row.id !== excludeId && !policy.hides(entry)).map(({ row }) => row);
        return matches(rows, batch, nearDistance);
      });
    },

    async readWritePolicy(tx, scope, batch, source, mode, editId) {
      const { counters: _counters, ...policy } = await policyReads.readWritePolicy(tx, scope, () => {
        const queries = copyDuplicateBatch(batch);
        validateSource(source);
        if ((mode !== "hash" && mode !== "full") ||
          (editId !== undefined && typeof editId !== "string")) throw new CoreError("invalid_input");
        return queries;
      }, source, mode, editId);
      return policy;
    },

    async readRevision(tx, scope, id) {
      return port(tx, scope, false, (state) => {
        const row = state.rows.get(scope.namespace)?.get(id)?.row;
        return row ? { revision: row.revision, textHash: row.textHash } : null;
      });
    },

    async replaceContent(tx, scope, id, expectedRevision, next, receipts, nowMs) {
      return port.write(tx, scope, true, () => {
        const content = prepareContent(next);
        validateTime(nowMs);
        const incoming = receipts === null ? null : copyReceipts(receipts);
        validateMemoryId(id);
        if (!Number.isInteger(expectedRevision)) throw new CoreError("invalid_input");
        const namespace = writeNamespace(scope);
        return async (getState, _markDirty, run) => {
          const state = getState();
          const entries = state.rows.get(namespace);
          const entry = entries?.get(id);
          if (!entry) throw new CoreError("memory_not_found");
          const { row } = entry;
          if (row.revision !== expectedRevision) throw new CoreError("revision_conflict");
          if (row.historical) throw new CoreError("memory_historical");
          if (content.textHash === row.textHash) return { outcome: "unchanged", revision: row.revision };

          const digests = await rowDigests(tx.owner, content);
          const policy = matchFacts(state.facts, { owner: tx.owner, namespace });
          if (entriesIn(entries).some((other) => other.row.id !== id && other.row.textHash === content.textHash &&
            !policy.hides(other))) {
            throw new CoreError("memory_conflict");
          }
          const revision = row.revision + 1;
          recordTextReplacement(state, entry, run.startFactEpoch);
          Object.assign(row, content, { digests, revision, ...writeTime(nowMs) });
          delete row.legacyHash;
          if (incoming !== null) {
            entry.receipts = [];
            entry.inspectReceiptPositions?.clear();
            entry.receiptKeys?.clear();
            await appendReceipts(state, entry, incoming, nowMs);
          }
          delete entry.inspectEvidence;
          invalidateRationale(state, namespace, id);
          advanceInspectEpoch(state, namespace);
          return { outcome: "changed", revision };
        };
      });
    },

    indexRevision: port.indexRevision,
    committedIndexRevision: port.committedIndexRevision,

    async get(tx, scope, id) {
      return port(tx, scope, false, (state) => {
        const row = state.rows.get(scope.namespace)?.get(id)?.row;
        return row ? copyPublicRow(row) : null;
      });
    },

    async erase(tx, scope, id) {
      return port.write(tx, scope, true, () => {
        validateMemoryId(id);
        const namespace = writeNamespace(scope);
        return async (getState) => {
          const state = getState();
          eraseRelations(state, namespace, id);
          const entries = state.rows.get(namespace);
          const entry = entries?.get(id);
          if (!entries || !entry) return false;
          // Hydration also delivers receipt addresses when inspect is disabled.
          for (const receipt of entry.receipts) {
            const address = await receiptAddressKey(namespace, receipt);
            state.receiptDenials.add(address);
            state.receiptDenials.add(MEMORY_FORGET_RECEIPT + address);
            const key = entry.receiptKeys?.get(receipt);
            if (key) state.receiptDenials.add(JSON.stringify([namespace, key]));
          }
          if (entry.receipts.length && state.rawAnchors.size) advanceRawInspectEpoch(state);
          if (capabilities.inspect || capabilities.contextRead) {
            // An explicit save may have retained the full source text without a
            // receipt. Carry a digest of its normalized cutoff through erase.
            if (entry.row.text.length > 800) {
              const excerpt = receiptExcerpt(entry.row.text);
              if (excerpt.length >= 799) state.receiptDenials.add(await receiptExcerptDenial(namespace, excerpt));
            }
          }
          entries.delete(id);
          invalidateRationale(state, namespace, id);
          if (!entries.size) state.rows.delete(namespace);
          dropMemoryPlacement(state.topics.get(namespace), id, { erase: true });
          advanceInspectEpoch(state, namespace);
          return true;
        };
      });
    },

    async exportPage(tx, scope, page) {
      return port(tx, scope, false, (state) => {
        const { cursor, limit } = page;
        validateLimit(limit);
        const after = cursor === null ? null : decodeCursor(cursor);
        const selection = { owner: tx.owner, namespace: scope.namespace };
        const policy = matchFacts(state.facts, selection);
        const rows = entriesIn(state.rows.get(selection.namespace))
          .filter((entry) => (!after || newestFirst(entry.row, after) > 0) && !policy.hides(entry))
          .map(({ row }) => row).sort(newestFirst);
        const items = rows.slice(0, limit).map(copyPublicRow);
        const last = items.at(-1);
        return {
          items,
          nextCursor: last && rows.length > limit ? encodeCursor(last.updatedAtUs, last.id) : null,
        };
      });
    },
  };

  // Finish snapshots its inputs before assigning the internal capture event ID.
  const finishWrites = memoryWrites(port.writeFromFinish, (/** @type {CopiedContent} */ row) => row, true);
  /** @param {Tx} tx @param {Scope} scope @param {readonly CanonicalQuery[]} batch
   * @param {SourceRef} source @param {"hash" | "full"} mode */
  function readWritePolicy(tx, scope, batch, source, mode) {
    return policyReads.readWritePolicy(tx, scope, () => batch, source, mode);
  }
  return { memories, finishWrites, readWritePolicy, counters: () => ({ nearSkippedUnembedded }) };
}
