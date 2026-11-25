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
 * phase: number, last_id: string, eligible: number, total_length: number, published: 0 | 1, rebuilt: 0 | 1 }} Generation */
/** @typedef {{ ref: ItemRef, qualified: ContextReadRef,
 * length: number, frequencies: Map<string, number> }} Match */
/** @typedef {NonNullable<DocumentCardStore<StoredDocumentCardRecord>["visibilityInputs"]>} LoadCards */
/** @typedef {{canonicalRows: number, sidecarRows: number, textRows: number, textUnits: number,
 * transformed: number, removed: number}} Metrics */
/** @typedef {{ref: ItemRef, revision: number, text: string}} CardDocument */

const MAX_ROWS = 1024;
const MAX_TEXT_UNITS = 2_000_000;
const CARD_STATES = ["draft", "confirmed", "cancelled", "deleted"];

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
  return /** @type {Generation | undefined} */ (db.prepare("SELECT * FROM cairn_context_publications WHERE projection = ?").get(key));
}

/** @param {Generation | undefined} prior @param {string} captured @returns {Generation} */
function startGeneration(prior, captured) {
  return prior?.fence === captured ? prior : {
    fence: captured, incarnation: prior?.incarnation ?? randomUUID(), sequence: (prior?.sequence ?? 0) + 1,
    base_sequence: prior?.published ? prior.sequence : prior?.base_sequence ?? 0,
    checkpoint: prior?.checkpoint ?? 0, phase: 0, last_id: "", eligible: 0, total_length: 0,
    published: 0, rebuilt: prior ? 0 : 1,
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
      state.last_id, state.eligible, state.total_length, state.published, state.rebuilt);
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
    /** @param {number} limit */
    sweep(limit) {
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

  /** @param {ReturnType<typeof documentWriter>} documents @param {Generation} state @param {Metrics} metrics */
  function sweep(documents, state, metrics) {
    const removed = documents.sweep(MAX_ROWS - metrics.canonicalRows - metrics.removed);
    metrics.removed += removed;
    metrics.sidecarRows += removed;
    state.published = documents.hasOld() ? 0 : 1;
  }

  /** @param {Connection} db @param {ContextReadSet} readSet @param {ContextReadSelection} selection
   * @param {Epochs} epochs @param {() => boolean} stopped */
  function reconcile(db, readSet, selection, epochs, stopped) {
    const metrics = { canonicalRows: 0, sidecarRows: 0, textRows: 0, textUnits: 0, transformed: 0, removed: 0 };
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
   * @param {Metrics} metrics @param {() => boolean} stopped */
  async function reconcileCards(tx, readSet, selection, metrics, stopped) {
    if (!loadCards || stopped() || metrics.canonicalRows + metrics.removed >= MAX_ROWS || metrics.textUnits >= MAX_TEXT_UNITS) return;
    const key = cardProjectionKey(readSet, selection);
    const batch = await port(tx, readSet.owner, {}, db => {
      const captured = cardFence(db, readSet, contextEpochs(db, readSet)), prior = generation(db, key);
      if (published(prior, captured)) return null;
      const state = startGeneration(prior, captured);
      const rows = db.prepare(`SELECT id, revision, title, body FROM cairn_document_cards
        WHERE ${exactScope} AND state = 'active' AND id > ? ORDER BY id LIMIT ?`);
      /** @type {{scope: Scope, candidates: CardDocument[]}[]} */
      const pages = [];
      let textUnits = metrics.textUnits;
      while (state.phase < readSet.namespaces.length && !stopped() && textUnits < MAX_TEXT_UNITS) {
        const limit = MAX_ROWS - metrics.canonicalRows - metrics.removed;
        if (limit === 0) break;
        const namespace = readSet.namespaces[state.phase], scope = { owner: readSet.owner, namespace };
        const candidates = [];
        let examined = 0, ended = true;
        for (const row of rows.iterate(...scopeKey(scope), state.last_id, limit)) {
          examined++;
          metrics.canonicalRows++;
          if (stopped() || textUnits >= MAX_TEXT_UNITS) {
            ended = false;
            break;
          }
          const id = String(row.id);
          const text = documentCardSearchText({ title: String(row.title), body: String(row.body) });
          candidates.push({ ref: { type: /** @type {const} */ ("card"), namespace, id },
            revision: Number(row.revision), text });
          state.last_id = id;
          textUnits += text.length;
        }
        if (candidates.length) pages.push({ scope, candidates });
        if (!ended || examined === limit) break;
        state.phase++;
        state.last_id = "";
      }
      return { state, pages };
    });
    if (!batch) return;
    const { state, pages } = batch;
    /** @type {{scope: Scope, rows: CardDocument[]}[]} */
    const eligible = [];
    for (const { scope, candidates } of pages) {
      if (stopped()) return;
      const inputs = await loadCards(tx, scope, candidates.map(({ ref }) => ref));
      const byId = new Map(candidates.map(({ ref }, i) => [ref.id, inputs[i]]));
      const { rows } = await visibleDocumentCardRows(candidates, ref => stopped() ? null : byId.get(ref.id) ?? null);
      eligible.push({ scope, rows });
    }
    if (stopped()) return;
    // The same write transaction pins both the scan and the visibility inputs.
    await port(tx, readSet.owner, { write: true }, db => {
      state.checkpoint++;
      saveGeneration(db, key, state);
      const documents = documentWriter(db, key, state);
      for (const { scope, rows } of eligible) {
        const [, ns] = scopeKey(scope);
        for (const { ref, revision, text } of rows) indexText(documents, state, metrics, ns, ref.id, revision, text);
      }
      if (state.phase === readSet.namespaces.length && !stopped()) sweep(documents, state, metrics);
      saveGeneration(db, key, state);
    });
  }

  /** @type {ContextReadStore["observeIndex"]} */
  async function observeIndex(tx, readSet, selection) {
    return port(tx, readSet.owner, {}, db => {
      const epochs = contextEpochs(db, readSet);
      const memory = generation(db, projectionKey(readSet, selection));
      const memoryReady = published(memory, fence(epochs, readSet, selection));
      const cards = readsCards(selection);
      const card = cards ? generation(db, cardProjectionKey(readSet, selection)) : undefined;
      const cardReady = cards && published(card, cardFence(db, readSet, epochs));
      const ready = memoryReady && (!cards || cardReady);
      const current = memoryReady && cards ? card : memory;
      /** @type {ContextIndexObservation["maintenance"]} */
      const maintenance = { available: true, state: "rebuilding", buildState: "rebuilding", reason: null, progress: null };
      if (current) maintenance.progress = { phase: current.phase, checkpoint: current.checkpoint,
        sequence: current.sequence, baseSequence: current.base_sequence };
      if (!ready || !current) return { ready: false, indexState: "", byType: {}, maintenance };
      maintenance.state = "ready";
      maintenance.buildState = current.rebuilt ? "rebuilt" : "ready";
      maintenance.reason = current.rebuilt ? "missing" : null;
      const byType = Object.fromEntries(selection.types.map(type => {
        const count = type === "memory" ? memory.eligible : card?.eligible ?? 0;
        return [type, { eligible: count, indexed: count }];
      }));
      return { ready, byType, maintenance, indexState: sha256(JSON.stringify(card ?
        [publicationStamp(memory), publicationStamp(card)] : publicationStamp(memory))) };
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
        if (!published(card, cardFence(db, readSet, epochs))) throw new CoreError("index_unavailable");
        const cards = search(db, readSet.owner, cardKey, card, terms, depth, stopped, true);
        memory.ranked.push(...cards.ranked);
        memory.ranked.sort((a, b) => b.score - a.score || compareCanonical(a, b));
        if (memory.ranked.length > depth) memory.ranked.length = depth;
        memory.matched += cards.matched;
      }
      return { rows: memory.ranked.map(({ qualified: ref, score }) => ({ ref, score })), matched: memory.matched };
    });
  }
  return { reconcile, reconcileCards, observeIndex, lexical };
}
