// Pinned Phase 0 decisions. Changing any value is a Phase 0 change request.

/** Product decision: near-duplicate threshold, both stores (cosine distance). */
export const NEAR_DUPLICATE_DISTANCE = 0.08;
/** Forget hides vector neighbours within this cosine distance (stores with vectorSuppression). */
export const SUPPRESSION_DISTANCE = 0.2;
/** A passage is withheld when at least this share of a fact's 4-char shingles match. */
export const CONTAINMENT_THRESHOLD = 0.6;
/**
 * Plugin-recall floor: keep a vector-only row only if distance <= this. Direct search: off.
 * Applied AFTER fusion (ranks and scores come from the unfiltered lists); a row present in
 * the lexical pool is always kept.
 */
export const VECTOR_ONLY_FLOOR = 0.45;

/**
 * Fusion presets. The hosted preset reproduces today's hosted SQL exactly: the tie-break
 * (updatedAt desc, then id desc, on the exact microsecond sort key) applies to BOTH channel
 * rankings and to the fused order; offset paging runs over the fused union (≤ 100).
 * The retrieval module owns the fusion math and the full list of engine presets (rrf-k60-d12-moc-v1, rrf-k10,
 * compact presets); the values below are the two cut-over defaults.
 */
export const FUSION_PRESETS = Object.freeze({
  hosted: Object.freeze({ k: 60, lexicalWeight: 0.5, vectorWeight: 1, pool: 50, tieBreak: Object.freeze(["updatedAt:desc", "id:desc"]) }),
  "rrf-k60-d12": Object.freeze({ k: 60, depth: 12, weights: Object.freeze([0.45, 0.45]), unionMaximum: 24, tieBreak: "canonical" }),
});
/** Product decision: ranking changes wait for the quality benchmark; hosted cuts over on the hosted preset. */
export const DEFAULT_FUSION_PRESET = Object.freeze({ hosted: "hosted", local: "rrf-k60-d12" });

/**
 * Lineage closure bounds (forget and admission use the same values). New specification from
 * the hosted lineage-closure work; not yet in the shipped hosted service.
 */
export const LINEAGE_CLOSURE_MAX_SESSIONS = 1000;
export const LINEAGE_CLOSURE_MAX_VERTICES = 20000;

/** Extraction request slice (messages per model call). */
export const EXTRACTION_SLICE = 24;
/** Tool responses are refused, not truncated, above this size. */
export const MAX_TOOL_RESPONSE_BYTES = 262144;
/** Frozen redactor version numbers recorded on text facts. */
export const REDACTION_VERSIONS = Object.freeze({ v1: 1, current: 2 });

/**
 * Product decision: same forget rules everywhere. Without a fingerprint key a store falls back
 * to exact + lineage only (no shingles, no HMAC); the local switch ships only after a
 * measured impact check. Hosted keeps session-level / message-MAC lineage until after the
 * cutover; span-level receipts for hosted come later.
 */
export const FORGET_POLICY = Object.freeze({
  withKey: Object.freeze(["exact", "hmac", "shingles", "vector", "lineage"]),
  withoutKey: Object.freeze(["exact", "lineage"]),
});
