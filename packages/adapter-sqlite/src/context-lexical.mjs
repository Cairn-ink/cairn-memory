import { createHmac, randomUUID } from "node:crypto";
import { compareCanonical, CoreError, scoreBM25, termFrequencies, tokenizeT1 } from "@cairn-ink/core";
import { documentCardSearchText, visibleDocumentCardRows } from "@cairn-ink/core/routing";
import { contextDeadline, contextEpochs, namespaceCardGenerations } from "./context-read-state.mjs";
import { decodeEntry, decodeJson, LIVE_SCOPE, MEMORY_COLUMNS } from "./memory-rows.mjs";
import { exactScope } from "./placement-visibility.mjs";
import { scopeKey, sha256 } from "./storage-values.mjs";
import { scopedSuppression } from "./suppressions.mjs";

/** @import { ContextIndexObservation, ContextReadRef, ContextReadSelection, ContextReadSet, ContextReadStore,
 * DocumentCardStore, ItemRef, Scope, StoredDocumentCardRecord, Tx } from "@cairn-ink/core/ports" */
/** @import { Connection, Port } from "./storage-values.mjs" */
/** @import { SessionHasher } from "./suppressions.mjs" */
/** @typedef {ReturnType<typeof contextEpochs>} Epochs */
/** @typedef {{ fence: string, incarnation: string, sequence: number, base_sequence: number, checkpoint: number,
 * phase: number, last_id: string, eligible: number, total_length: number, published: 0 | 1, rebuilt: 0 | 1,
 * pendingRemovals: number }} Generation */
/** @typedef {{ ref: ItemRef, qualified: ContextReadRef,
 * length: number, frequencies: Map<string, number> }} Match */
/** @typedef {NonNullable<DocumentCardStore<StoredDocumentCardRecord>["visibilityInputs"]>} LoadCards */
/** @typedef {{canonicalRows: number, sidecarRows: number, textRows: number, textUnits: number,
 * transformed: number, removed: number}} Metrics */

const MAX_ROWS = 1024;
const MAX_TEXT_UNITS = 2_000_000;
// Bound the posting work left for a foreground mixed read and its commit.
const MIXED_CARD_TEXT_UNITS = 64_000;
const CARD_STATES = ["draft", "confirmed", "cancelled", "deleted"];
// Canonical UUIDs and imported IDs cannot start with this control character.
const CHECKPOINT_PREFIX = "\x1f";

/** @returns {Metrics} */
function maintenanceMetrics() {
  return { canonicalRows: 0, sidecarRows: 0, textRows: 0, textUnits: 0, transformed: 0, removed: 0 };
}

/** @param {ContextReadSet} readSet @param {ContextReadSelection} selection */
function projectionKey({ owner, namespaces }, { types, intent }) {
  return sha256(JSON.stringify(["candidate-text-v1", "hr1-t1-v1", owner, namespaces, types, intent]));
}

/** @param {ContextReadSet} readSet @param {ContextReadSelection} selection */
function cardProjectionKey({ owner, namespaces }, { intent }) {
  return sha256(JSON.stringify(["document-card-text-v1", "hr1-t1-v1", owner, namespaces, intent]));
}

/** @param {Epochs} epochs @param {ContextReadSet} readSet @param {ContextReadSelection} selection */
function fence({ canonical, suppression }, { accessGenerations }, { types }) {
  return sha256(JSON.stringify([accessGenerations, ...(types.includes("memory") ? [canonical, suppression] : [])]));
}

/** @param {Connection} db @param {ContextReadSet} readSet @param {Epochs} epochs */
function cardFence(db, readSet, { canonical, suppression, raw }) {
  // Raw and inherited lineage can change across namespaces. Each changing card
  // operation advances both the owner revision and its namespace generation.
  const nonCardRevision = db.prepare(`SELECT COALESCE((SELECT revision FROM cairn_index_revisions WHERE owner_id = ?), 0)
    - COALESCE((SELECT SUM(generation) FROM cairn_document_card_generations WHERE owner_id = ?), 0) AS revision`)
    .get(readSet.owner, readSet.owner)?.revision;
  return sha256(JSON.stringify([readSet.accessGenerations, canonical, suppression, raw, nonCardRevision,
    namespaceCardGenerations(db, readSet)]));
}

/** @param {Connection} db @param {string} key */
function generation(db, key) {
  const row = /** @type {Omit<Generation, "pendingRemovals"> | undefined} */ (
    db.prepare("SELECT * FROM cairn_context_publications WHERE projection = ?").get(key)
  );
  if (!row) return undefined;
  const [last_id, pendingRemovals] = row.last_id.startsWith(CHECKPOINT_PREFIX)
    ? /** @type {[string, number]} */ (decodeJson(row.last_id.slice(1)))
    : [row.last_id, 0];
  return { ...row, last_id, pendingRemovals };
}

/** @param {string} id @param {number} pendingRemovals */
function lexicalCheckpoint(id, pendingRemovals) {
  return pendingRemovals ? CHECKPOINT_PREFIX + JSON.stringify([id, pendingRemovals]) : id;
}

/** @param {Connection} db @param {string} namespaceKey @param {string} id */
export function eraseContextDocuments(db, namespaceKey, id) {
  const removed = db.prepare("DELETE FROM cairn_context_documents WHERE namespace_key = ? AND id = ? RETURNING projection")
    .all(namespaceKey, id);
  // Terms cascade with the documents. Preserve only a count for the next reconciliation.
  const update = db.prepare("UPDATE cairn_context_publications SET last_id = ? WHERE projection = ?");
  for (const { projection } of removed) {
    const key = String(projection), prior = generation(db, key);
    if (!prior) throw new CoreError("storage_error");
    update.run(lexicalCheckpoint(prior.last_id, prior.pendingRemovals + 1), key);
  }
}

/** @param {Generation | undefined} prior @param {string} captured @returns {Generation} */
function startGeneration(prior, captured) {
  return prior?.fence === captured ? prior : {
    fence: captured, incarnation: prior?.incarnation ?? randomUUID(), sequence: (prior?.sequence ?? 0) + 1,
    base_sequence: prior?.published ? prior.sequence : prior?.base_sequence ?? 0,
    checkpoint: prior?.checkpoint ?? 0, phase: 0, last_id: "", eligible: 0, total_length: 0,
    published: 0, rebuilt: prior ? 0 : 1, pendingRemovals: prior?.pendingRemovals ?? 0,
  };
}

/** @param {Generation | undefined} state @param {string} captured @returns {state is Generation & { published: 1 }} */
function published(state, captured) {
  return state?.published === 1 && state.fence === captured;
}

/** @param {Generation} state */
function publicationStamp({ fence, sequence, checkpoint, incarnation }) {
  return [fence, sequence, checkpoint, incarnation];
}

/** @param {Connection} db @param {string} key @param {Generation} state */
function saveGeneration(db, key, state) {
  db.prepare(`INSERT INTO cairn_context_publications VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (projection) DO UPDATE SET fence = excluded.fence, sequence = excluded.sequence,
    base_sequence = excluded.base_sequence, checkpoint = excluded.checkpoint, phase = excluded.phase,
    last_id = excluded.last_id, eligible = excluded.eligible, total_length = excluded.total_length,
    published = excluded.published, rebuilt = excluded.rebuilt`)
    .run(key, state.fence, state.incarnation, state.sequence, state.base_sequence, state.checkpoint, state.phase,
      lexicalCheckpoint(state.last_id, state.pendingRemovals), state.eligible, state.total_length, state.published, state.rebuilt);
}

/** @param {Connection} db @param {string} key @param {Generation} state */
function documentWriter(db, key, state) {
  const insert = db.prepare("INSERT INTO cairn_context_documents VALUES (?, ?, ?, ?, ?, ?)");
  const terms = db.prepare(`INSERT INTO cairn_context_terms (projection, namespace_key, id, term, frequency)
    SELECT ?, ?, ?, key, value FROM json_each(?)`);
  const remove = db.prepare("DELETE FROM cairn_context_documents WHERE projection = ? AND namespace_key = ? AND id = ?");
  return {
    /** @param {string} ns @param {string} id @param {number} revision @param {number} length @param {string} postings */
    put(ns, id, revision, length, postings) {
      const replaced = Number(remove.run(key, ns, id).changes);
      insert.run(key, ns, id, revision, state.sequence, length);
      terms.run(key, ns, id, postings);
      return replaced;
    },
    /** @param {number} limit @param {{ used: number, stopped: () => boolean, allowFirst: boolean }} [budget] */
    sweep(limit, budget) {
      if (budget) {
        const next = db.prepare(`SELECT namespace_key, id, token_length
          FROM cairn_context_documents WHERE projection = ? AND sequence < ? LIMIT 1`);
        let { used } = budget, removed = 0;
        for (let i = 0; i < limit; i++) {
          if ((!budget.allowFirst || i > 0) && budget.stopped()) break;
          const row = next.get(key, state.sequence);
          if (!row) break;
          const cost = 1 + Number(row.token_length);
          if (used > 0 && used + cost > MIXED_CARD_TEXT_UNITS) break;
          removed += Number(remove.run(key, String(row.namespace_key), String(row.id)).changes);
          used += cost;
        }
        return removed;
      }
      return Number(db.prepare(`DELETE FROM cairn_context_documents WHERE (projection, namespace_key, id) IN (
        SELECT projection, namespace_key, id FROM cairn_context_documents WHERE projection = ? AND sequence < ? LIMIT ?
      )`).run(key, state.sequence, limit).changes);
    },
    hasOld() {
      return Boolean(db.prepare("SELECT 1 FROM cairn_context_documents WHERE projection = ? AND sequence < ? LIMIT 1")
        .get(key, state.sequence));
    },
  };
}

/** @param {Port} port @param {SessionHasher} hashSession @param {string} storeKey @param {() => number} monotonicMs
 * @param {LoadCards} [loadCards] */
export function createContextLexical(port, hashSession, storeKey, monotonicMs, loadCards) {
  const secret = Buffer.from(storeKey, "hex");
  /** @param {string} term */
  const termKey = term => createHmac("sha256", secret).update("context-term-v1\0").update(term).digest("hex");

  /** @param {ContextReadSelection} selection */
  const readsCards = selection => Boolean(loadCards) && selection.types.includes("card");

  /** @param {ReturnType<typeof documentWriter>} documents @param {Generation} state @param {Metrics} metrics
   * @param {string} ns @param {string} id @param {number} revision @param {string} text */
  function indexText(documents, state, metrics, ns, id, revision, text) {
    metrics.textRows++;
    metrics.textUnits += text.length;
    const { length, frequencies } = termFrequencies(text);
    const postings = Object.fromEntries([...frequencies].map(([term, frequency]) => [termKey(term), frequency]));
    metrics.sidecarRows += documents.put(ns, id, revision, length, JSON.stringify(postings));
    metrics.transformed++;
    state.eligible++;
    state.total_length += length;
  }

  /** @param {ReturnType<typeof documentWriter>} documents @param {Generation} state @param {Metrics} metrics
   * @param {{ used: number, stopped: () => boolean, allowFirst: boolean }} [cardBudget] */
  function sweep(documents, state, metrics, cardBudget) {
    const budget = MAX_ROWS - metrics.canonicalRows - metrics.removed;
    const removed = documents.sweep(budget, cardBudget);
    const erased = Math.min(state.pendingRemovals, budget - removed);
    state.pendingRemovals -= erased;
    metrics.removed += removed + erased;
    metrics.sidecarRows += removed + erased;
    state.published = state.pendingRemovals || documents.hasOld() ? 0 : 1;
  }

  /** @param {Connection} db @param {ContextReadSet} readSet @param {ContextReadSelection} selection
   * @param {Epochs} epochs @param {() => boolean} stopped */
  function reconcile(db, readSet, selection, epochs, stopped) {
    const metrics = maintenanceMetrics();
    const key = projectionKey(readSet, selection), captured = fence(epochs, readSet, selection);
    const prior = generation(db, key);
    if (published(prior, captured) || stopped()) return metrics;

    // Match the legacy generation lifecycle. A resumed scan keeps its
    // sequence. A new fence starts a generation from the last publication.
    const state = startGeneration(prior, captured);
    state.checkpoint++;
    saveGeneration(db, key, state);
    const documents = documentWriter(db, key, state);
    // Each namespace contributes a Memory stream and four Card state
    // streams when selected. Disabled Card streams have no rows to scan.
    const streams = readSet.namespaces.flatMap(namespace => selection.types.flatMap(type =>
      type === "card" ? CARD_STATES.map(() => null) : [{ namespace }]));
    const budget = () => MAX_ROWS - metrics.canonicalRows - metrics.removed;
    const rows = db.prepare(`SELECT ${MEMORY_COLUMNS} FROM cairn_memories WHERE ${LIVE_SCOPE} AND id > ?
      ${selection.intent === "current" ? "AND historical = 0" : ""} ORDER BY id LIMIT ?`);
    while (state.phase < streams.length && budget() > 0 && !stopped()) {
      const stream = streams[state.phase];
      if (stream) {
        const scope = { owner: readSet.owner, namespace: stream.namespace };
        const coordinates = scopeKey(scope);
        const policy = scopedSuppression(db, scope, hashSession);
        const maximum = budget();
        let examined = 0, ended = true;
        for (const record of rows.iterate(...coordinates, state.last_id, maximum)) {
          examined++;
          metrics.canonicalRows++;
          if (stopped() || metrics.textUnits >= MAX_TEXT_UNITS) {
            ended = false;
            break;
          }
          const entry = decodeEntry(scope, record);
          const { id, revision, text } = entry.row;
          state.last_id = id;
          if (policy.hides(entry)) continue;
          indexText(documents, state, metrics, coordinates[1], id, revision, text);
        }
        if (!ended || examined === maximum) break;
      }
      state.phase++;
      state.last_id = "";
    }
    if (state.phase === streams.length && !stopped()) sweep(documents, state, metrics);
    saveGeneration(db, key, state);
    return metrics;
  }

  /** @param {Tx} tx @param {ContextReadSet} readSet @param {ContextReadSelection} selection
   * @param {() => boolean} stopped @param {boolean} bounded @param {AbortSignal} [signal] */
  async function reconcileCards(tx, readSet, selection, stopped, bounded, signal) {
    const metrics = maintenanceMetrics();
    if (!loadCards || signal?.aborted || (!bounded && stopped())) return metrics;
    const key = cardProjectionKey(readSet, selection);
    const textLimit = bounded ? MIXED_CARD_TEXT_UNITS : MAX_TEXT_UNITS;
    const state = await port(tx, readSet.owner, { write: true }, db => {
      const captured = cardFence(db, readSet, contextEpochs(db, readSet)), prior = generation(db, key);
      if (published(prior, captured)) return null;
      const state = startGeneration(prior, captured);
      state.checkpoint++;
      // A first publication row is required by the posting foreign key.
      if (!prior) saveGeneration(db, key, state);
      return state;
    });
    if (!state) return metrics;

    let textUnits = 0;
    const needsFirstUnit = () => bounded && metrics.canonicalRows === 0;
    while (state.phase < readSet.namespaces.length && metrics.canonicalRows < MAX_ROWS && textUnits < textLimit &&
        !signal?.aborted && (needsFirstUnit() || !stopped())) {
      const namespace = readSet.namespaces[state.phase], scope = { owner: readSet.owner, namespace };
      const coordinates = scopeKey(scope);
      const row = await port(tx, readSet.owner, {}, db => db.prepare(`SELECT id, revision, title, body
        FROM cairn_document_cards WHERE ${exactScope} AND state = 'active' AND id > ? ORDER BY id LIMIT 1`)
        .get(...coordinates, state.last_id));
      if (!row) {
        state.phase++;
        state.last_id = "";
        continue;
      }
      const text = documentCardSearchText({ title: String(row.title), body: String(row.body) });
      // An oversized card runs alone. Check the allowance between cards so
      // each admitted row finishes visibility and posting work in this transaction.
      if (bounded && textUnits > 0 && textUnits + text.length > textLimit) break;
      const id = String(row.id), revision = Number(row.revision);
      /** @type {ItemRef} */
      const ref = { type: "card", namespace, id };
      const [input] = await loadCards(tx, scope, [ref]);
      const { rows } = await visibleDocumentCardRows([{ ref }], () => input ?? null);
      if (rows.length) {
        await port(tx, readSet.owner, { write: true }, db => {
          const ns = coordinates[1];
          // A fresh visibility verdict allows the same revision's postings to carry forward.
          const carried = bounded ? db.prepare(`UPDATE cairn_context_documents SET sequence = ?
            WHERE projection = ? AND namespace_key = ? AND id = ? AND revision = ? RETURNING token_length`)
            .get(state.sequence, key, ns, id, revision) : undefined;
          if (carried) {
            metrics.sidecarRows++;
            state.eligible++;
            state.total_length += Number(carried.token_length);
          } else indexText(documentWriter(db, key, state), state, metrics, ns, id, revision, text);
        });
      }
      metrics.canonicalRows++;
      textUnits += text.length;
      state.last_id = id;
    }
    // Keep the cursor and the completed posting writes in the same transaction,
    // including when the last card used the remainder of the allowance.
    await port(tx, readSet.owner, { write: true }, db => {
      if (state.phase === readSet.namespaces.length && !signal?.aborted && (bounded || !stopped())) {
        sweep(documentWriter(db, key, state), state, metrics, bounded ? {
          used: textUnits, stopped, allowFirst: needsFirstUnit(),
        } : undefined);
      }
      saveGeneration(db, key, state);
    });
    return metrics;
  }

  /** @type {ContextReadStore["observeIndex"]} */
  async function observeIndex(tx, readSet, selection) {
    return port(tx, readSet.owner, {}, db => {
      const epochs = contextEpochs(db, readSet);
      const memory = generation(db, projectionKey(readSet, selection));
      const memoryReady = published(memory, fence(epochs, readSet, selection));
      const cards = readsCards(selection);
      const card = cards ? generation(db, cardProjectionKey(readSet, selection)) : undefined;
      const capturedCardFence = cards ? cardFence(db, readSet, epochs) : null;
      const cardReady = capturedCardFence !== null && published(card, capturedCardFence);
      const cardPending = cards && !cardReady;
      const current = memoryReady && cards ? card : memory;
      /** @type {ContextIndexObservation["maintenance"]} */
      const maintenance = { available: true, state: "rebuilding", buildState: "rebuilding", reason: null, progress: null };
      if (current) maintenance.progress = { phase: current.phase, checkpoint: current.checkpoint,
        sequence: current.sequence, baseSequence: current.base_sequence };
      if (!memoryReady) return { ready: false, indexState: "", byType: {}, maintenance };
      if (!cardPending && current) {
        maintenance.state = "ready";
        maintenance.buildState = current.rebuilt ? "rebuilt" : "ready";
        maintenance.reason = current.rebuilt ? "missing" : null;
      }
      const byType = Object.fromEntries(selection.types.filter(type => type !== "card" || !cardPending).map(type => {
        const count = type === "memory" ? memory.eligible : card?.eligible ?? 0;
        return [type, { eligible: count, indexed: count }];
      }));
      const stamp = publicationStamp(memory);
      const binding = cards ? [stamp, cardReady ? publicationStamp(card) : ["rebuilding", capturedCardFence]] : stamp;
      return { ready: true, byType, maintenance, ...(cardPending && { cardPending: true }),
        indexState: sha256(JSON.stringify(binding)) };
    });
  }

  /** @param {Connection} db @param {string} owner @param {string} key @param {Generation} current
   * @param {string[]} terms @param {number} depth @param {() => boolean} stopped @param {boolean} cards */
  function search(db, owner, key, current, terms, depth, stopped, cards) {
    const byTerm = db.prepare(`SELECT d.namespace_key, d.id, d.revision, d.token_length, frequency${cards ? ", c.body_revision" : ""}
      FROM cairn_context_terms JOIN cairn_context_documents d USING (projection, namespace_key, id)
      ${cards ? `JOIN cairn_document_cards c ON c.owner_id = ? AND c.namespace_key = d.namespace_key
        AND c.id = d.id AND c.revision = d.revision AND c.state = 'active'` : ""}
      WHERE projection = ? AND term = ?`);
    const keys = cards ? [owner, key] : [key];
    /** @type {Map<string, Match>} */
    const matches = new Map();
    const df = new Map();
    for (const term of terms) {
      let count = 0;
      for (const row of byTerm.iterate(...keys, term)) {
        if (stopped()) throw new CoreError("index_unavailable");
        const address = JSON.stringify([row.namespace_key, row.id]);
        let doc = matches.get(address);
        if (!doc) {
          const namespace = /** @type {Scope["namespace"]} */ (decodeJson(row.namespace_key));
          const id = String(row.id), scope = { owner, namespace }, revision = Number(row.revision);
          const qualified = cards
            ? { type: /** @type {const} */ ("card"), scope, id, revision, bodyRevision: Number(row.body_revision) }
            : { type: /** @type {const} */ ("memory"), scope, id, revision };
          doc = { ref: { namespace, id, type: qualified.type }, qualified,
            length: Number(row.token_length), frequencies: new Map() };
          matches.set(address, doc);
        }
        doc.frequencies.set(term, Number(row.frequency));
        count++;
      }
      df.set(term, count);
    }
    const ranked = [];
    const stats = { N: current.eligible, totalLength: current.total_length, df };
    for (const doc of matches.values()) {
      if (stopped()) throw new CoreError("index_unavailable");
      const score = scoreBM25(terms, doc, stats);
      if (score === null) continue;
      ranked.push({ ref: doc.ref, qualified: doc.qualified, score });
      ranked.sort((a, b) => b.score - a.score || compareCanonical(a, b));
      if (ranked.length > depth) ranked.pop();
    }
    return { ranked, matched: matches.size };
  }

  /** @type {ContextReadStore["lexical"]} */
  async function lexical(tx, readSet, selection, query, depth, options) {
    return port(tx, readSet.owner, {}, db => {
      const stopped = contextDeadline(options, monotonicMs), epochs = contextEpochs(db, readSet);
      const key = projectionKey(readSet, selection), current = generation(db, key);
      if (!published(current, fence(epochs, readSet, selection)) || options.signal?.aborted) {
        throw new CoreError("index_unavailable");
      }
      const terms = [...new Set(tokenizeT1(query))].map(termKey);
      const memory = search(db, readSet.owner, key, current, terms, depth, stopped, false);
      if (readsCards(selection)) {
        const cardKey = cardProjectionKey(readSet, selection), card = generation(db, cardKey);
        if (published(card, cardFence(db, readSet, epochs))) {
          const cards = search(db, readSet.owner, cardKey, card, terms, depth, stopped, true);
          memory.ranked.push(...cards.ranked);
          memory.ranked.sort((a, b) => b.score - a.score || compareCanonical(a, b));
          if (memory.ranked.length > depth) memory.ranked.length = depth;
          memory.matched += cards.matched;
        }
      }
      return { rows: memory.ranked.map(({ qualified: ref, score }) => ({ ref, score })), matched: memory.matched };
    });
  }
  return { reconcile, reconcileCards, observeIndex, lexical };
}
