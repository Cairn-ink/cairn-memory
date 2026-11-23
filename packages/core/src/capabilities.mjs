import { CoreError } from "./errors.mjs";

// Optional features an adapter may or may not provide. Core checks a flag before using an
// optional port; a missing capability degrades to a defined result, never to an error,
// unless the caller explicitly requires it (then: capability_unavailable).
export const CAPABILITIES = Object.freeze([
  "nearDuplicate", // vector near-duplicate collapse on write (distance NEAR_DUPLICATE_DISTANCE)
  "embeddingRequiredOnInsert", // inserts and content replacements require an embedding
  "vectorSuppression", // forget hides vector neighbours within SUPPRESSION_DISTANCE
  "shingleSuppression", // keyed 4-char shingle containment withholds passages
  "fingerprintKey", // a per-owner fingerprint key is configured (HMAC facts, shingles)
  "orderedCapture", // causal stream + reconcile (supersede/correct from capture)
  "stagedEvidence", // staged capture evidence claims
  "rationaleEdges", // receipt-anchored rationale proposals
  "placement", // MOC placement journal
  "relations", // card relations and MOC rank
  "cards", // cards and card lineage
  "documentCards", // document card storage and invalidation
  "documentCardSearch", // lexical and vector candidates for document cards
  "quantityLedger", // quantity rows and invalidation
  "episodes", // episode capture (parked: SQLite only, not in core)
  "spanLineage", // span-level raw receipt lineage (engine): resolveSpans
  "sessionLineage", // session-level message-MAC lineage with keyed content proofs (hosted)
  "rawSpans", // RawSpanFact suppression facts (engine now; hosted after the cutover)
  "rawArchive", // raw conversation archive and raw search
  "rawWindowHide", // window suppressions over raw
  "supersession", // supersession records and historical state
  "conflictEdges", // memory conflict edges
  "semanticRetrieval", // vector candidates for recall
  "forgetLog", // cutover-only forget log (Postgres, removed after cutover)
]);

/** @param {Partial<Record<string, boolean>>} flags */
export function capabilities(flags) {
  /** @type {Record<string, boolean>} */
  const out = {};
  for (const name of CAPABILITIES) out[name] = flags[name] === true;
  for (const name of Object.keys(flags)) {
    if (!CAPABILITIES.includes(name)) throw new CoreError("invalid_input");
  }
  return Object.freeze(out);
}

/**
 * @param {Readonly<Record<string, boolean>>} caps
 * @param {string} name
 */
export function requireCapability(caps, name) {
  if (!CAPABILITIES.includes(name)) throw new CoreError("invalid_input");
  if (caps[name] !== true) throw new CoreError("capability_unavailable");
}

/** Optional StorageAdapter members and the capability that must be true exactly when present. */
export const OPTIONAL_PORTS = Object.freeze({
  vector: "semanticRetrieval",
  raw: "rawArchive",
  staged: "stagedEvidence",
  placement: "placement",
  rationale: "rationaleEdges",
  relations: "relations",
  causal: "orderedCapture",
  supersession: "supersession",
  conflicts: "conflictEdges",
  forgetLog: "forgetLog",
  sessionLineage: "sessionLineage",
  spanLineage: "spanLineage",
  documentCards: "documentCards",
  documentCardCandidates: "documentCardSearch",
  quantityLedger: "quantityLedger",
});

/**
 * Checked at adapter registration, both directions: a present optional port requires its
 * flag, and a true flag requires its port.
 * @param {{ capabilities: Readonly<Record<string, boolean>> } & Record<string, unknown>} adapter
 */
export function assertAdapterCapabilities(adapter) {
  const caps = adapter.capabilities;
  for (const [member, flag] of Object.entries(OPTIONAL_PORTS)) {
    if ((adapter[member] != null) !== (caps[flag] === true)) throw new CoreError("capability_unavailable");
  }
  if (caps.documentCardSearch === true && caps.documentCards !== true) throw new CoreError("capability_unavailable");
}
