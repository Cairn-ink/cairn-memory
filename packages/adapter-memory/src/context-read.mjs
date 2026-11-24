import { allDigests, canonicalKey, compareUtf8, CoreError, coreDigest, createBM25 } from "@cairn-ink/core";

/** @import { ContextEvidenceRow, ContextIndexObservation, ContextReadSelection, ContextReadSet, ContextReadStore,
  Counters, InspectReceipt, Receipt, Scope, Tx } from "@cairn-ink/core/ports" */
/** @import { Entry, State } from "./unit-of-work.mjs" */
/** @typedef {{ binding: string, index: ReturnType<typeof createBM25<ReturnType<typeof documentsFor>[number]>>,
 * ids: ReadonlySet<string>, observation: ContextIndexObservation }} Publication */

const MAX_PROJECTIONS = 8;

/** @param {State} state @param {ContextReadSet} readSet @param {ContextReadSelection} selection */
function canonicalBinding(state, readSet, { types }) {
  const memory = types.includes("memory");
  return JSON.stringify(readSet.namespaces.map(namespace => {
    if (!memory) return [namespace];
    const facts = [...state.facts.values()].filter(({ fact }) => (fact.namespace ?? null) === namespace);
    return [namespace, state.contextEpochs.get(namespace) ?? 1, facts.at(-1)?.epoch.toString() ?? "0"];
  }));
}

/** @param {State} state @param {ContextReadSet} readSet @param {ContextReadSelection} selection
 * @param {ReturnType<typeof import("./fact-match.mjs").createFactMatcher>} matchFacts */
function documentsFor(state, readSet, selection, matchFacts) {
  if (!selection.types.includes("memory")) return [];
  return readSet.namespaces.flatMap(namespace => {
    const scope = { owner: readSet.owner, namespace };
    const policy = matchFacts(state.facts, scope);
    const rows = state.rows.get(namespace);
    return rows ? [...rows.values()].filter(entry => eligible(entry, selection.intent, policy)).map(({ row }) => ({
      ref: { type: /** @type {const} */ ("memory"), namespace, id: row.id },
      qualified: { type: /** @type {const} */ ("memory"), scope, id: row.id, revision: row.revision },
      text: row.text,
    })) : [];
  });
}

/** @param {Entry} entry @param {ContextReadSelection["intent"]} intent
 * @param {ReturnType<ReturnType<typeof import("./fact-match.mjs").createFactMatcher>>} policy */
function eligible(entry, intent, policy) {
  return (intent === "history" || !entry.row.historical) && !policy.hides(entry);
}

/** @param {Receipt} receipt @returns {receipt is InspectReceipt} */
function retained(receipt) {
  return receipt.id !== undefined && receipt.excerpt !== undefined &&
    receipt.eventId !== undefined && receipt.createdAtMs !== undefined;
}

/** @param {ContextReadSet} readSet @param {ContextReadSelection} selection */
function projectionKey(readSet, { types, intent }) {
  return JSON.stringify([readSet.owner, readSet.namespaces, types, intent]);
}

/** @param {ReturnType<typeof import("./unit-of-work.mjs").createUnitOfWork>} work
 * @param {ReturnType<typeof import("./fact-match.mjs").createFactMatcher>} matchFacts
 * @param {import("./privacy.mjs").RingKeys} ringKeys
 * @param {ReturnType<typeof import("./raw.mjs").createRawPorts>["sourceVisible"]} [rawSourceVisible]
 * @returns {ContextReadStore} */
export function createContextReadStore({ port, uow, enableContextEpochs, readTokenIdentity }, matchFacts, ringKeys, rawSourceVisible) {
  enableContextEpochs();
  /** @type {Map<string, Publication>} */
  const projections = new Map();
  /** @type {WeakMap<Tx, Map<string, Publication | undefined>>} */
  const observations = new WeakMap();
  let incarnation = 0;

  /** @param {State} state @param {Tx} tx @param {ContextReadSet} readSet @param {ContextReadSelection} selection */
  function observed(state, tx, readSet, selection) {
    const key = projectionKey(readSet, selection);
    let selections = observations.get(tx);
    if (!selections) observations.set(tx, selections = new Map());
    if (!selections.has(key)) {
      const current = projections.get(key);
      selections.set(key, current?.binding === canonicalBinding(state, readSet, selection) ? current : undefined);
    }
    return selections.get(key);
  }

  /** @param {State} state @param {Scope} scope @param {Entry} entry
   * @param {ReturnType<ReturnType<typeof import("./fact-match.mjs").createFactMatcher>>} policy */
  async function receiptEvidence(state, scope, entry, policy) {
    const ordered = [...entry.receipts].sort((a, b) =>
      (a.createdAtMs ?? 0) - (b.createdAtMs ?? 0) || compareUtf8(a.id ?? "", b.id ?? ""));
    const prefix = ordered.slice(0, 17);
    /** @type {InspectReceipt[]} */
    const receipts = [];
    let visible = 0;
    const useDigests = policy.textFacts.length > 0;
    const keys = useDigests ? await ringKeys(scope.owner) : [];
    for (const receipt of prefix) {
      if (!retained(receipt)) continue;
      const digests = useDigests ? await allDigests(receipt.excerpt) : [];
      for (const key of keys) digests.push(await coreDigest(receipt.excerpt, key));
      if (policy.withholdsRaw(receipt, digests)) continue;
      const { client, sessionId, messageId } = receipt;
      if (state.rawFences.has(JSON.stringify([scope.namespace, client, sessionId]))) continue;
      const rawKey = JSON.stringify([scope.owner, scope.namespace, client, sessionId, messageId]);
      if (state.rawConflicts.has(rawKey) ||
          (rawSourceVisible && !await rawSourceVisible(state, scope, receipt))) continue;
      visible++;
      if (receipts.length < 16) receipts.push(receipt);
    }
    const exhausted = prefix.length > 16;
    /** @type {import("@cairn-ink/core/ports").ContextReceiptCoverage} */
    const receiptCoverage = { status: exhausted || visible < prefix.length ? "budget_exhausted" : "complete",
      included: receipts.length, omitted: exhausted ? null : prefix.length - visible };
    return { receipts, receiptCoverage };
  }

  return {
    maintenanceAvailable: true,
    identity: readTokenIdentity,
    async prepareLexical(readSet, selection, { signal }) {
      return uow.run(readSet.owner, { readOnly: true }, tx => port(tx, readSet, false, state => {
        if (signal?.aborted) throw new CoreError("index_unavailable");
        const key = projectionKey(readSet, selection);
        const binding = canonicalBinding(state, readSet, selection);
        const prior = projections.get(key);
        /** @type {Counters} */
        const idle = { canonicalRows: 0, sidecarRows: 0, textRows: 0, textUnits: 0, transformed: 0, removed: 0 };
        if (prior?.binding === binding) return idle;

        const documents = documentsFor(state, readSet, selection, matchFacts);
        const byType = Object.fromEntries(selection.types.map(type => {
          const count = type === "memory" ? documents.length : 0;
          return [type, { eligible: count, indexed: count }];
        }));
        const previous = prior?.observation.maintenance.progress?.sequence ?? 0;
        const sequence = previous + 1;
        const phase = selection.types.includes("card") ? 4 : 1;
        const progress = { phase, checkpoint: sequence, sequence, baseSequence: previous };
        /** @type {ContextIndexObservation} */
        const observation = { indexState: JSON.stringify([binding, sequence, progress.checkpoint, ++incarnation]),
          ready: true, byType, maintenance: {
            available: true, state: "ready", buildState: prior ? "ready" : "rebuilt", reason: prior ? null : "missing", progress,
          } };
        if (!prior && projections.size >= MAX_PROJECTIONS) {
          const oldest = projections.keys().next().value;
          if (oldest !== undefined) projections.delete(oldest);
        }
        const ids = new Set(documents.map(canonicalKey));
        projections.set(key, { binding, index: createBM25(documents), ids, observation });
        return {
          canonicalRows: documents.length,
          sidecarRows: prior?.ids.size ?? 0,
          textRows: documents.length,
          textUnits: documents.reduce((sum, { text }) => sum + text.length, 0),
          transformed: documents.length,
          removed: prior ? [...prior.ids].filter(id => !ids.has(id)).length : 0,
        };
      }));
    },
    async observeIndex(tx, readSet, selection) {
      return port(tx, readSet, false, state => structuredClone(observed(state, tx, readSet, selection)?.observation ?? {
        indexState: "", ready: false, byType: {}, maintenance: {
          available: true, state: "rebuilding", buildState: "rebuilding", reason: null, progress: null,
        },
      }));
    },
    async lexical(tx, readSet, selection, query, depth, { signal }) {
      return port(tx, readSet, false, state => {
        const publication = observed(state, tx, readSet, selection);
        if (!publication || signal?.aborted) throw new CoreError("index_unavailable");
        const { rows, matched } = publication.index.searchWithCount(query, depth);
        return structuredClone({ rows: rows.map(({ qualified: ref, score }) => ({ ref, score })), matched });
      });
    },
    async snapshotState(tx, readSet, types) {
      return port(tx, readSet, false, state => readSet.namespaces.map(namespace => ({
        memory: state.contextEpochs.get(namespace) ?? 1, ...(types.includes("card") && { card: 1 }),
      })));
    },
    async evidence(tx, readSet, refs, intent) {
      return port(tx, readSet, false, async state => {
        if (refs.some(({ scope }) => scope.owner !== readSet.owner || !readSet.namespaces.includes(scope.namespace))) {
          throw new CoreError("authority_required");
        }
        /** @type {(ContextEvidenceRow | null)[]} */
        const rows = [];
        for (const ref of refs) {
          const { scope, id, type } = ref;
          const entry = type === "memory" ? state.rows.get(scope.namespace)?.get(id) : undefined;
          const policy = matchFacts(state.facts, scope);
          if (!entry || !eligible(entry, intent, policy)) {
            rows.push(null);
            continue;
          }
          const { revision, text, historical, kind, confidence, origin } = entry.row;
          rows.push({
            type: "memory", ref: { type: "memory", scope, id, revision }, text,
            metadata: {
              state: historical ? "historical" : "active", reviewState: "none", filing: { status: "unfiled" },
              kind, confidence, origin,
            },
            qualification: null,
            attribution: { status: "unassessed", commitment: "unknown" },
            sourceAccess: historical ? "unavailable-for-noncurrent-memory" : "available",
            ...await receiptEvidence(state, scope, entry, policy),
          });
        }
        return structuredClone(rows);
      });
    },
  };
}
