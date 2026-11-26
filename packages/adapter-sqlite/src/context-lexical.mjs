import { createHmac, randomUUID } from "node:crypto";
import { compareCanonical, CoreError, scoreBM25, termFrequencies, tokenizeT1 } from "@cairn-ink/core";
import { contextDeadline, contextEpochs } from "./context-read-state.mjs";
import { decodeEntry, decodeJson, LIVE_SCOPE, MEMORY_COLUMNS } from "./memory-rows.mjs";
import { scopeKey, sha256 } from "./storage-values.mjs";
import { scopedSuppression } from "./suppressions.mjs";

/** @import { ContextIndexObservation, ContextMemoryRef, ContextReadSelection, ContextReadSet, ContextReadStore, Scope } from "@cairn-ink/core/ports" */
/** @import { Connection, Port } from "./storage-values.mjs" */
/** @import { SessionHasher } from "./suppressions.mjs" */
/** @typedef {ReturnType<typeof contextEpochs>} Epochs */
/** @typedef {{ fence: string, incarnation: string, sequence: number, base_sequence: number, checkpoint: number,
 * phase: number, last_id: string, eligible: number, total_length: number, published: 0 | 1, rebuilt: 0 | 1,
 * pendingRemovals: number }} Generation */
/** @typedef {{ ref: {type: "memory", namespace: Scope["namespace"], id: string}, qualified: ContextMemoryRef,
 * length: number, frequencies: Map<string, number> }} Match */

const MAX_ROWS = 1024;
const MAX_TEXT_UNITS = 2_000_000;
const CARD_STATES = ["draft", "confirmed", "cancelled", "deleted"];
// Canonical UUIDs and imported IDs cannot start with this control character.
const CHECKPOINT_PREFIX = "\x1f";

/** @param {ContextReadSet} readSet @param {ContextReadSelection} selection */
function projectionKey({ owner, namespaces }, { types, intent }) {
  return sha256(JSON.stringify(["candidate-text-v1", "hr1-t1-v1", owner, namespaces, types, intent]));
}

/** @param {Epochs} epochs @param {ContextReadSet} readSet @param {ContextReadSelection} selection */
function fence({ canonical, suppression }, { accessGenerations }, { types }) {
  return sha256(JSON.stringify([accessGenerations, ...(types.includes("memory") ? [canonical, suppression] : [])]));
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

/** @param {Port} port @param {SessionHasher} hashSession @param {string} storeKey @param {() => number} monotonicMs */
export function createContextLexical(port, hashSession, storeKey, monotonicMs) {
  const secret = Buffer.from(storeKey, "hex");
  /** @param {string} term */
  const termKey = term => createHmac("sha256", secret).update("context-term-v1\0").update(term).digest("hex");

  /** @param {Connection} db @param {ContextReadSet} readSet @param {ContextReadSelection} selection
   * @param {Epochs} epochs @param {() => boolean} stopped */
  function reconcile(db, readSet, selection, epochs, stopped) {
    const metrics = { canonicalRows: 0, sidecarRows: 0, textRows: 0, textUnits: 0, transformed: 0, removed: 0 };
    const key = projectionKey(readSet, selection), captured = fence(epochs, readSet, selection);
    const prior = generation(db, key);
    if ((prior?.published && prior.fence === captured) || stopped()) return metrics;

    // Match the legacy generation lifecycle. A resumed scan keeps its
    // sequence. A new fence starts a generation from the last publication.
    /** @type {Generation} */
    const state = prior?.fence === captured ? prior : {
      fence: captured, incarnation: prior?.incarnation ?? randomUUID(), sequence: (prior?.sequence ?? 0) + 1,
      base_sequence: prior?.published ? prior.sequence : prior?.base_sequence ?? 0,
      checkpoint: prior?.checkpoint ?? 0, phase: 0, last_id: "", eligible: 0, total_length: 0,
      published: 0, rebuilt: prior ? 0 : 1, pendingRemovals: prior?.pendingRemovals ?? 0,
    };
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
          metrics.textRows++;
          metrics.textUnits += text.length;
          const { length, frequencies } = termFrequencies(text);
          const postings = Object.fromEntries([...frequencies].map(([term, frequency]) => [termKey(term), frequency]));
          metrics.sidecarRows += documents.put(coordinates[1], id, revision, length, JSON.stringify(postings));
          metrics.transformed++;
          state.eligible++;
          state.total_length += length;
        }
        if (!ended || examined === maximum) break;
      }
      state.phase++;
      state.last_id = "";
    }
    if (state.phase === streams.length && !stopped()) {
      metrics.removed = documents.sweep(budget());
      const erased = Math.min(state.pendingRemovals, budget());
      state.pendingRemovals -= erased;
      metrics.removed += erased;
      metrics.sidecarRows += metrics.removed;
      state.published = state.pendingRemovals || documents.hasOld() ? 0 : 1;
    }
    saveGeneration(db, key, state);
    return metrics;
  }

  /** @type {ContextReadStore["observeIndex"]} */
  async function observeIndex(tx, readSet, selection) {
    return port(tx, readSet.owner, {}, db => {
      const current = generation(db, projectionKey(readSet, selection));
      const ready = current?.published === 1 && current.fence === fence(contextEpochs(db, readSet), readSet, selection);
      /** @type {ContextIndexObservation["maintenance"]} */
      const maintenance = { available: true, state: "rebuilding", buildState: "rebuilding", reason: null, progress: null };
      if (current) maintenance.progress = { phase: current.phase, checkpoint: current.checkpoint,
        sequence: current.sequence, baseSequence: current.base_sequence };
      if (!ready) return { ready, indexState: "", byType: {}, maintenance };
      maintenance.state = "ready";
      maintenance.buildState = current.rebuilt ? "rebuilt" : "ready";
      maintenance.reason = current.rebuilt ? "missing" : null;
      const byType = Object.fromEntries(selection.types.map(type => {
        const count = type === "memory" ? current.eligible : 0;
        return [type, { eligible: count, indexed: count }];
      }));
      return { ready, byType, maintenance, indexState: sha256(JSON.stringify([
        current.fence, current.sequence, current.checkpoint, current.incarnation,
      ])) };
    });
  }

  /** @type {ContextReadStore["lexical"]} */
  async function lexical(tx, readSet, selection, query, depth, options) {
    return port(tx, readSet.owner, {}, db => {
      const stopped = contextDeadline(options, monotonicMs);
      const key = projectionKey(readSet, selection), current = generation(db, key);
      if (!current?.published || current.fence !== fence(contextEpochs(db, readSet), readSet, selection) || options.signal?.aborted) {
        throw new CoreError("index_unavailable");
      }
      const terms = [...new Set(tokenizeT1(query))].map(termKey);
      const byTerm = db.prepare(`SELECT namespace_key, id, revision, token_length, frequency
        FROM cairn_context_terms JOIN cairn_context_documents USING (projection, namespace_key, id)
        WHERE projection = ? AND term = ?`);
      /** @type {Map<string, Match>} */
      const matches = new Map();
      const df = new Map();
      for (const term of terms) {
        let count = 0;
        for (const row of byTerm.iterate(key, term)) {
          if (stopped()) throw new CoreError("index_unavailable");
          const address = JSON.stringify([row.namespace_key, row.id]);
          let doc = matches.get(address);
          if (!doc) {
            const namespace = /** @type {Scope["namespace"]} */ (decodeJson(row.namespace_key));
            const id = String(row.id), type = /** @type {const} */ ("memory");
            doc = { ref: { namespace, id, type },
              qualified: { scope: { owner: readSet.owner, namespace }, id, type, revision: Number(row.revision) },
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
      return { rows: ranked.map(({ qualified: ref, score }) => ({ ref, score })), matched: matches.size };
    });
  }
  return { reconcile, observeIndex, lexical };
}
