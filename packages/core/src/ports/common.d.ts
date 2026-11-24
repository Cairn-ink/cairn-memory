/** Owner of all data: hosted user id, or the local owner. Facts never match across owners. */
export type OwnerId = string;

/**
 * A namespace inside an owner. Hosted: null. Engine: the encoded (scope, projectId) tuple,
 * `${scope}\u0000${projectId ?? ""}` (scope "personal" | "project"), so that UTF-8 byte order
 * (compareUtf8) equals the engine's canonical (scope, projectId) order. null sorts first.
 */
export type Namespace = string | null;

/** Where a write applies: one namespace of one owner. */
export interface Scope {
  owner: OwnerId;
  namespace: Namespace;
}

export type MemoryKind = "fact" | "preference" | "decision" | "instruction" | "context";
export type Role = "user" | "assistant";

/**
 * explicit: saved or edited by the person (MCP save, web, import of saved memories).
 * inferred: extracted from a captured conversation.
 * Derivation from SourceRef.kind: mcp | web | import → explicit; capture | plugin → inferred.
 */
export type Origin = "explicit" | "inferred";

/** Where a memory or capture came from. sessionId null for explicit saves without a session. */
export interface SourceRef {
  kind: "capture" | "mcp" | "web" | "import" | "plugin";
  client: string | null;
  sessionId: string | null;
}

/** Item reference returned by candidate ports and hydrated later. Carries its namespace. */
export interface ItemRef {
  type: "memory" | "raw" | "card";
  id: string;
  namespace: Namespace;
}

/** Integer revision; replaces any (hash, updated_at) token. */
export type Revision = number;

/**
 * Exact sort key: microseconds since the epoch (bigint). Hosted keeps PostgreSQL's µs
 * precision; engine stores use ms * 1000n. All ordering uses this, never the ms fields.
 */
export type SortKeyUs = bigint;

export interface MemoryRow {
  id: string;
  scope: Scope;
  kind: MemoryKind;
  origin: Origin;
  /** Stored, redacted, normalized display text. */
  text: string;
  /** "sha256:<hex>" of the normalized text (cloud normalizer; legacy engine hash looked up separately). */
  textHash: string;
  confidence: number;
  source: SourceRef;
  revision: Revision;
  createdAtMs: number;
  updatedAtMs: number;
  /** Exact ordering key for updatedAt. */
  updatedAtUs: SortKeyUs;
  /** null until embedded (engine embeds after write; a store without a key may never embed). */
  embedding?: { model: string; vector: Float32Array | number[] } | null;
  historical?: boolean;
  /** Explicit read marker when a historical memory has no visible replacement. */
  supersession?: "superseded (replacement no longer available)";
}

/** Evidence link from a memory to its source. */
export interface Receipt {
  client: string;
  sessionId: string;
  messageId: string;
  role: Role;
  occurredAtMs: number | null;
  /** Stored receipt ID, when available. */
  id?: string;
  /** For explicit writes, the saved text. */
  excerpt?: string;
  /** Source event and retention time, when the receipt store preserves them. */
  eventId?: string;
  createdAtMs?: number;
}

/** A content-free diagnostic event (no text, ids, hashes or keys). */
export interface DiagnosticEvent {
  version: 1;
  stage: string;
  layer: string;
  reason: string;
}

/** An abort deadline and an optional content-free observer, passed down from the host. */
export interface CallOptions {
  signal?: AbortSignal;
  deadlineAtMs?: number;
  /** Core passes it to the model adapter and emits its own stages through it. Must not throw. */
  onDiagnostic?: (event: DiagnosticEvent) => void;
}

/** Content-free counters every port may return for diagnostics. Never text, ids or hashes. */
export type Counters = Readonly<Record<string, number>>;
