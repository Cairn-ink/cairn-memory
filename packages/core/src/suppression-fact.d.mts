export type FactKind = "identity" | "text" | "session" | "window" | "rawSpan";
export type FactOrigin = "forget" | "correct" | "edit" | "backfill" | "import";
/** exact: digest match only. full: digests + shingles + vector neighbours, where the store is capable. */
export type FactMode = "exact" | "full";
/** Which normalize/redact pipeline produced a digest. Old facts keep every variant forever. */
export type DigestPipeline = "core" | "hosted-v1" | "engine-legacy";

export declare const FACT_KINDS: readonly FactKind[];
export declare const FACT_ORIGINS: readonly FactOrigin[];
export declare const FACT_MODES: readonly FactMode[];
export declare const DIGEST_PIPELINES: readonly DigestPipeline[];

interface TextDigestValue {
  /** Lowercase hex, 64 chars. */
  value: string;
  pipeline: DigestPipeline;
  /** Redactor version this digest was computed under (1 = frozen v1). */
  redactionVersion: number;
}

/** One text digest. A labelled MAC uses its explicit signing domain. An old MAC uses its pipeline as the label. */
export type TextDigest = TextDigestValue & (
  | { alg: "sha256" | "hmac"; keyId: string | null; label?: undefined }
  | { alg: string; keyId: string; label: string }
);

interface FactBase {
  owner: string;
  /** Engine namespace; hosted uses null. */
  namespace?: string | null;
  /** Action that produced the fact (one action may produce several facts). */
  actionId: string;
  origin: FactOrigin;
}

/** Hides a memory id. throughRevision absent = every revision (forget); N = revisions ≤ N (correct/edit). */
export interface IdentityFact extends FactBase {
  kind: "identity";
  memoryId: string;
  throughRevision?: number;
}

/** Withholds a passage wherever it appears. Holds no plaintext. Matching is the UNION of all digests. */
export interface TextFact extends FactBase {
  kind: "text";
  mode: FactMode;
  text: {
    /** Non-empty, deduped by (alg, value) for old digests and by domain and value for labelled MACs. */
    digests: readonly TextDigest[];
    /** Keyed 4-char shingle MACs (hex), when the store has a fingerprint key. */
    shingles?: string[] | null;
    /** Embedding of the forgotten text, for vector-neighbour suppression. */
    embedding?: number[] | null;
    keyId?: string | null;
  };
  /** Edit-origin facts scope their exemption to this memory (id + creation time). */
  sourceMemory?: { id: string; createdAtMs: number } | null;
}

/** A session reference: hosted stores the client id; local stores only a keyed hash. */
export type SessionRef =
  | { client: string; sessionId: string }
  | { client: string; sessionKeyHash: string };

/** Blocks all later capture and hides raw for the session. Local adapters refuse a plaintext sessionId. */
export interface SessionFact extends FactBase {
  kind: "session";
  session: SessionRef;
}

/**
 * Hides raw in the half-open window [startMs, endMs). client null = all clients.
 * unknownTime: also fence every session with unknown time (local). anchor "pm30min": the
 * window is ±30 min around an anchor (local hide).
 */
export interface WindowFact extends FactBase {
  kind: "window";
  client: string | null;
  window: { startMs: number; endMs: number };
  unknownTime?: true;
  anchor?: "pm30min";
}

/** A forgotten span of one raw message (capability rawSpans; engine now, hosted after cutover). */
export interface RawSpanFact extends FactBase {
  kind: "rawSpan";
  sessionKeyHash: string;
  messageKey: string;
  startUtf16: number;
  endUtf16: number;
  contentDigest: string;
}

export type SuppressionFact = IdentityFact | TextFact | SessionFact | WindowFact | RawSpanFact;

/** A stored fact with its permanent identity and epoch. */
export interface StoredFact<F extends SuppressionFact = SuppressionFact> {
  fact: F;
  factId: string;
  /** Canonical digest of factIncarnationBody (the body without owner/actionId and without a text embedding), computed by core. */
  incarnation: string;
  /** Owner epoch after this fact; advances by exactly 1 per new fact. */
  epoch: bigint;
  createdAtMs: number;
}

/** Throws invalid_input / invalid_window; never inspects content. */
export declare function validateSuppressionFact(fact: unknown): SuppressionFact;
/** Canonical JSON of the fact body without owner and actionId (keys sorted; text digests sorted by alg then value as UTF-8 bytes; other arrays as given). */
export declare function factBody(fact: SuppressionFact): string;
/** What the incarnation hashes: factBody without a text fact's embedding (not repeatable across providers). */
export declare function factIncarnationBody(fact: SuppressionFact): string;
