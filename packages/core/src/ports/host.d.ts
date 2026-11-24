import type { Capabilities } from "../capabilities.mjs";
import type { ErrorCode } from "../errors.mjs";
import type { CallOptions, Counters, MemoryKind, MemoryRow, Namespace, Origin, OwnerId, Receipt, Revision, Role, Scope, SortKeyUs, SourceRef } from "./common.d.ts";
import type { CaptureMessage } from "./capture.d.ts";
import type { StoredDocumentCardRecord } from "./document-card.d.ts";
import type { RawSegment, RetrievalScope } from "./retrieval.d.ts";
import type { Tx } from "./unit-of-work.d.ts";
import type { StorageAdapter } from "./index.d.ts";

export interface SessionStartGroup {
  /** Hosted v1: commitments is disabled, the other groups are enabled. */
  enabled: boolean;
  items: MemoryRow[];
  returned: number;
  complete: boolean;
  budgetExhausted: boolean;
}

/** Published session-start v1 (hosted wire: SessionContext). Packed by core with o200k counting. */
export interface SessionContext {
  framing: string;
  namespace: Namespace;
  /** Hosted wire: integer index revision. */
  indexRevision: number;
  groups: {
    nextSteps: SessionStartGroup;
    commitments: SessionStartGroup;
    background: SessionStartGroup;
    procedural: SessionStartGroup;
  };
}

export interface ImportMemory {
  text: string;
  kind: MemoryKind;
  createdAtMs?: number;
}

export interface ImportRawSession {
  client: string;
  sessionId: string;
  messages: CaptureMessage[];
}

export interface ImportResult {
  imported: number;
  duplicate: number;
  suppressed: number;
  invalid: number;
}

export interface Layer {
  status: "ok" | "not_searched" | "unavailable";
  count: number;
  code?: ErrorCode;
}

interface FindOptions {
  limit?: number;
  kinds?: ("memory" | "card" | "raw")[];
  clients?: string[];
  sinceMs?: number;
  untilMs?: number;
}

interface FindResult {
  memories: MemoryRow[];
  cards: [];
  raw: RawSegment[];
  layers: { memory: Layer; card: Layer; raw: Layer };
}

export type ContextReadType = "memory" | "card";
export type ContextReadIntent = "current" | "history";
export type InspectState = "active" | "historical";

/** Trusted selection supplied by the host, with access generations aligned to namespaces. */
export interface ContextReadSet extends Pick<RetrievalScope, "owner" | "namespaces"> {
  readonly accessGenerations: readonly number[];
}

export interface ContextReadSelection {
  types: readonly ContextReadType[];
  intent: ContextReadIntent;
}

export interface ContextReadQuery extends ContextReadSelection {
  query: string;
  semantic?: boolean;
  deadlineMs?: number;
}

export interface FindCandidatesInput extends ContextReadQuery {
  limit?: number;
  cursor?: string;
}

export interface ContextMemoryRef {
  type: "memory";
  scope: Scope;
  id: string;
  revision: Revision;
}

export interface ContextCardRef {
  type: "card";
  scope: Scope;
  id: string;
  revision: Revision;
  bodyRevision: Revision;
}

export type ContextReadRef = ContextMemoryRef | ContextCardRef;

export type FetchEvidenceInput = {
  refs: readonly ContextReadRef[];
  intent: ContextReadIntent;
  /** Aligned compact-ref prefixes. Null entries came from qualified refs. */
  fences?: readonly (string | null)[];
  snapshot?: never;
  responseByteLimit?: number;
} | {
  snapshot: string;
  refs?: never;
  intent?: never;
  fences?: never;
  responseByteLimit?: number;
};

export type ContextAssemblyPolicy = "rank-first-whole-v1" | "coverage-first-v1" | "rank-first-first-source-v1";
export type ContextAssemblyRepresentation = "representation-v2-dated" | "representation-v2";
export interface ReadContextInput extends ContextReadQuery {
  budget?: { maxTokens?: number; maxItems?: number };
  policy?: { id: ContextAssemblyPolicy };
  representation?: ContextAssemblyRepresentation;
  /** Use the separately qualified Raw channel. Defaults to true. */
  raw?: boolean;
}

export interface ContextReadChannel {
  state: "ready" | "unavailable" | "disabled" | "absent" | "timeout";
  causes: readonly ("unavailable" | "disabled" | "absent" | "timeout")[];
}

export interface ContextReadMaintenance {
  available: boolean;
  state: "ready" | "rebuilding";
  buildState: "ready" | "rebuilt" | "rebuilding";
  reason: "missing" | "corrupt" | "wrong-store" | "incompatible" | null;
  progress: { phase: number; checkpoint: number; sequence: number; baseSequence: number } | null;
}

export interface ContextReadCoverage {
  status: "complete" | "unavailable";
  byType: Partial<Record<ContextReadType, {
    eligible: number | null;
    indexed: number | null;
    embedded: number | null;
    scanned: number | null;
    embeddedFraction: number | null;
    scannedFraction: number | null;
  }>>;
  freshness: "current" | "unverified";
  maintenance: ContextReadMaintenance;
  depths: { lexical: number; semantic: number };
  omitted: { lexical: number | null; semantic: number | null; horizon: number | null };
  stops: { deadline: boolean; budget: boolean };
}

export interface ContextCandidateDiagnostics {
  channels: { lexical: ContextReadChannel; semantic: ContextReadChannel };
  coverage: ContextReadCoverage;
  trace: {
    requested: "lexical" | "hybrid";
    effective: "lexical";
    family: "local";
    preset: "rrf-k60-d12";
    embedder: null;
    tokenizer: "hr1-t1-v1";
    representation: "candidate-text-v1";
    timings: { maintenanceMs: number; lexicalMs: number; semanticPreflightMs: number; embeddingMs: number; fusionMs: number };
    maintenance?: Counters;
  };
}

export interface FindCandidatesResult extends ContextCandidateDiagnostics {
  version: "context-read-v1";
  items: readonly {
    ref: ContextReadRef;
    rank: number;
    fusionScore: null;
    channels: { lexical: { rank: number; rawScore: number }; semantic: null };
  }[];
  nextCursor: string | null;
}

/** Bounded adjunct data already qualified by the store, such as filing and support details. */
export type ContextReadData = null | boolean | number | string | readonly ContextReadData[] |
  { readonly [key: string]: ContextReadData };
export type ContextReadFields = Readonly<Record<string, ContextReadData>>;

export interface InspectMemoryMetadata {
  id: string;
  scope: Scope;
  revision: Revision;
  kind: MemoryKind;
  origin: Origin;
  confidence: number;
  state: InspectState;
  filing: { status: "filed" | "unfiled" };
  reviewState?: string;
  receiptCount: number;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface InspectReceipt extends Receipt {
  id: string;
  excerpt: string;
  /** Legacy alias for the source message ID. */
  eventId: string;
  /** Receipt insertion time, distinct from the source event time. */
  createdAtMs: number;
}

export interface InspectListInput {
  memoryId?: never;
  states?: readonly InspectState[];
  limit?: number;
  cursor?: string;
  includeQualification?: never;
  receiptLimit?: never;
  receiptCursor?: never;
}

export interface InspectItemInput {
  memoryId: string;
  includeQualification?: boolean;
  receiptLimit?: number;
  receiptCursor?: string;
  states?: never;
  limit?: never;
  cursor?: never;
}

export interface InspectListResult {
  mode: "list";
  memories: readonly InspectMemoryMetadata[];
  nextCursor: string | null;
  exhausted: boolean;
}

export interface InspectItemEvidence {
  memory: InspectMemoryMetadata & { text: string };
  receipts: readonly InspectReceipt[];
  placements: readonly ContextReadFields[];
  conflicts: readonly ContextReadFields[];
  qualification?: ContextReadFields | null;
  procedural?: {
    tagRevision: Revision;
    procedural: boolean;
    origin: Origin | null;
    anchors: readonly { receiptId: string; digest: string; start: number; end: number }[];
  } | null;
  supersession?: ContextReadFields;
}

export interface InspectItemResult extends InspectItemEvidence {
  mode: "item";
  nextReceiptCursor: string | null;
  exhausted: boolean;
}

export interface ContextMemoryMetadata {
  state: InspectState;
  reviewState: string;
  filing: InspectMemoryMetadata["filing"];
  kind: MemoryKind;
  origin: Origin;
  confidence: number;
}

export interface ContextReceiptIdentity {
  scope: Scope;
  memoryId: string;
  memoryRevision: Revision;
  receiptId: string;
}

export interface ContextReceiptSource extends ContextReceiptIdentity {
  type: "receipt";
  contentIdentity: string;
  completeness: "excerpt-only";
}

export interface ContextReceiptCoverage {
  status: "complete" | "budget_exhausted";
  included: number;
  omitted: number | null;
}

export interface ContextMemoryEvidence extends ContextMemoryMetadata {
  type: "memory";
  ref: ContextMemoryRef;
  text: string;
  qualification: ContextReadFields | null;
  provenance: {
    sources: readonly ContextReceiptSource[];
    sourceAccess: "available" | "unavailable-for-noncurrent-memory";
    receiptMetadata: readonly Omit<ContextReceiptIdentity, "scope">[];
    completeness: "excerpt-only";
    conversationCoverage: "unknown";
    meaning: "unassessed";
    attribution: { status: string; commitment: string };
    corroboration: "not-assessed";
    coverage: ContextReceiptCoverage;
  };
}

export interface ContextCardEvidence {
  type: "card";
  ref: ContextCardRef;
  title: string;
  body: string;
  state: string;
  support: ContextReadFields;
  origin: string;
  qualification: ContextReadFields;
  provenance: ContextReadFields;
  bindings: readonly ContextReadFields[];
  triggerMemoryRefs: readonly ContextMemoryRef[];
  builtAt?: string;
  clusterKey?: string;
  status?: string;
  sourceRevisions?: ContextReadData;
}

export interface FetchEvidenceResult {
  items: readonly (ContextMemoryEvidence | ContextCardEvidence)[];
  snapshot: string;
}

export type ContextCompactRef = {
  ns: number;
  id: string;
  rev: Revision;
  f: string;
} & ({ type: "memory"; bodyRev?: never } | { type: "card"; bodyRev: Revision });

export type ContextAssemblySource = {
  index: number;
  date?: string;
  dates?: readonly string[];
  memory?: ContextCompactRef;
} & ({ role: Role; excerpt: string } | { role: Role; sameAsBody: true } |
  { sameAs: { item: number; source: number } } | { role: Role });

export interface ContextAssemblyRawExcerpt {
  ref: { ns: number; type: "raw"; conversationId: string; messageId: string };
  role: Role;
  occurredAt?: string;
  date?: string;
  start: number;
  end: number;
}

export type ContextRawCoverage = "included" | "partial" | "unavailable" | "unsupported_store" | "lexical_unsupported";

export type ContextAssemblyItem = {
  ref: ContextCompactRef;
  rank: number;
  date?: string;
  body: string;
  metadata?: ContextReadFields;
  sources: readonly ContextAssemblySource[];
  sourceAccess?: "unavailable-for-noncurrent-memory" | "unsupported";
  sourcesComplete?: false;
  evidence?: readonly (ContextAssemblyRawExcerpt & ({ body: string } | { sameAsBody: true }))[];
} | (ContextAssemblyRawExcerpt & { layer: "Raw"; body: string });

export interface ContextAssemblyValue {
  framing: string;
  items: readonly ContextAssemblyItem[];
}

export interface ContextAssemblyDiagnostics {
  version: "context-read-v1";
  policy: { id: ContextAssemblyPolicy };
  representation: ContextAssemblyRepresentation;
  counter: { id: "tiktoken-o200k_base" };
  items: readonly {
    ref: ContextReadRef;
    metadata: ContextMemoryMetadata | ContextReadFields;
    body?: { tokens: number };
    sources?: readonly ({
      index: number;
      kind: "sameAsBody" | "concrete";
      tokens: number;
    } | { index: number; kind: "sameAs"; item: number; source: number })[];
  }[];
  budget: { maxTokens: number; maxItems: number; used: number };
  omitted: { items: number; bodies: number; sources: number; unavailable: number; oversized: number };
  dedup: { sources: number; body: number };
  stops: { budget: boolean; items: boolean; deadline: boolean };
  trace: { timings: { assemblyMs: number }; counterCalls: number };
  coverage: { raw: ContextRawCoverage };
  candidates: ContextCandidateDiagnostics & { count: number };
}

export interface ReadContextResult {
  assembly: ContextAssemblyValue;
  diagnostics: ContextAssemblyDiagnostics;
  snapshot: string | null;
}

export type ContextReadErrorCode = ErrorCode;
export interface ContextReadError extends Error {
  code: ContextReadErrorCode;
  retryable: boolean;
  /** Candidate diagnostics for a refused find or context read. */
  diagnostics?: ContextCandidateDiagnostics;
}

/** Host-injected, synchronous tokenizer for the exact formatted Context Read block. */
export interface ContextReadTokenCounter {
  count(text: string): number;
}

/** Pure synchronous formatter for the exact block the host delivers. */
export type ContextReadBlockFormatter = (value: ContextAssemblyValue) => string;

/** Context Read and inspect share this store identity and key, independent of model and fingerprint keys. */
export interface ReadTokenIdentity {
  storeId: string;
  /** Raw HMAC-SHA256 bytes or an HMAC-SHA256 CryptoKey with sign and verify usages. */
  cursorKey: Uint8Array | CryptoKey;
}

interface ReadIdentityPort {
  identity(tx: Tx): Promise<ReadTokenIdentity>;
}

export interface ContextIndexObservation {
  /** Binding for the ready publication, including its canonical and suppression fences. */
  indexState: string;
  ready: boolean;
  byType: Partial<Record<ContextReadType, { eligible: number; indexed: number }>>;
  maintenance: ContextReadMaintenance;
}

export type ContextEvidenceRow = {
  type: "memory";
  ref: ContextMemoryRef;
  metadata: ContextMemoryMetadata;
  text: string;
  qualification: ContextReadFields | null;
  attribution: ContextMemoryEvidence["provenance"]["attribution"];
  sourceAccess: ContextMemoryEvidence["provenance"]["sourceAccess"];
  receipts: readonly (InspectReceipt & {
    sourceTimesMs?: readonly number[];
    rawTurns?: readonly ContextRawRef[];
  })[];
  receiptCoverage: ContextReceiptCoverage;
} | {
  type: "card";
  item: ContextCardEvidence;
  lineageStamp: readonly [bodyRevision: Revision, provenanceRevision: Revision, bodyDigest: string, provenanceDigest: string] | null;
};

export interface ContextRawRef {
  scope: Scope;
  conversationId: string;
  messageId: string;
}

export interface ContextRawTurn extends ContextRawRef {
  role: Role;
  occurredAtMs: number | null;
  ranges: readonly { start: number; text: string }[];
  /** Adapter witness for the exact visible slot and ranges. */
  witness: string;
}

export interface ContextRawReadStore {
  search(tx: Tx, readSet: ContextReadSet, query: string, options: CallOptions & {
    limit: number;
    lexicalOnly: boolean;
  }): Promise<{ turns: readonly ContextRawTurn[]; coverage: ContextRawCoverage }>;
  revalidate(tx: Tx, readSet: ContextReadSet, turns: readonly ContextRawTurn[]): Promise<boolean>;
}

/** Optional adapter port for bounded index observations and qualified evidence. */
export interface ContextReadStore extends ReadIdentityPort {
  readonly maintenanceAvailable: boolean;
  /** Run ahead of the read transaction. Returns actual content-free work metrics. */
  prepareLexical?(readSet: ContextReadSet, selection: ContextReadSelection, options: CallOptions): Promise<Counters>;
  observeIndex(tx: Tx, readSet: ContextReadSet, selection: ContextReadSelection): Promise<ContextIndexObservation>;
  lexical(tx: Tx, readSet: ContextReadSet, selection: ContextReadSelection, query: string, depth: number,
    options: CallOptions): Promise<{ rows: readonly { ref: ContextReadRef; score: number }[]; matched: number | null }>;
  /** Namespace generations in read-set order. Coverage of Card state is required when requested. */
  snapshotState(tx: Tx, readSet: ContextReadSet, types: readonly ContextReadType[]): Promise<
    readonly { memory: number; card?: number; lineage?: string }[]
  >;
  /** One slot per ref. Null means missing or denied. Visible rows carry their actual revisions.
   * Withhold unsafe receipts and any qualification they anchor inside this read transaction. */
  evidence(tx: Tx, readSet: ContextReadSet, refs: readonly ContextReadRef[],
    intent: ContextReadIntent): Promise<readonly (ContextEvidenceRow | null)[]>;
  readonly raw?: ContextRawReadStore;
}

export type InspectReceiptAnchor = { row: number } | { createdAtMs: number; createdAtUs?: SortKeyUs; id: string };

/** Optional adapter port for inspect-only ordering, counts and receipt paging. */
export interface InspectStore extends ReadIdentityPort {
  /** Returns up to limit + 1 visible rows, in updated time descending and ID ascending order. */
  list(tx: Tx, scope: Scope, page: {
    states: readonly InspectState[];
    limit: number;
    after?: { updatedAtUs: SortKeyUs; id: string };
    expectedEpoch?: number;
  }): Promise<{ epoch: number; rows: readonly (InspectMemoryMetadata & { updatedAtUs: SortKeyUs })[] }>;
  /** Returns up to limit visible receipts in ascending creation time and ID order.
   * A changed epoch or lost receipt anchor throws cursor_stale.
   */
  item(tx: Tx, scope: Scope, memoryId: string, page: {
    limit: number;
    after?: InspectReceiptAnchor;
    expectedEpoch?: number;
    includeQualification: boolean;
  }): Promise<{ epoch: number; item: InspectItemEvidence | null; nextAnchor: InspectReceiptAnchor | null }>;
}

/** Proposed optional registration flags. Omitted flags are false on older adapters. */
export interface ReadContractCapabilities {
  readonly contextRead?: boolean;
  readonly inspect?: boolean;
  readonly contextRawRead?: boolean;
}

export interface ReadContractStorage<Card extends StoredDocumentCardRecord = StoredDocumentCardRecord> extends StorageAdapter<Card> {
  readonly capabilities: StorageAdapter<Card>["capabilities"] & ReadContractCapabilities;
  readonly contextRead?: ContextReadStore;
  readonly inspect?: InspectStore;
}


/** The host supplies the source identity. Core uses the event or message ID as Receipt.messageId. */
type ExplicitWriteReceipt = Pick<Receipt, "client" | "sessionId" | "occurredAtMs" | "excerpt"> &
  { role: "user" } &
  ({ messageId: string; eventId?: never } | { eventId: string; messageId?: never });

interface SaveOptions {
  receipt?: ExplicitWriteReceipt;
  /** Requires proceduralTags. Offsets refer to the explicit receipt excerpt. */
  procedural?: { anchors: readonly { receiptIndex: 0; start: number; end: number }[] };
}

interface CorrectOptions {
  kind?: MemoryKind;
  receipt?: ExplicitWriteReceipt;
}

type ForgetResult =
  { status: "forgotten"; removedSimilar: number; indexRevision?: number } |
  { status: "not_found"; indexRevision?: number };

/**
 * The facade used by the MCP host, plugin, web client and the hosted service.
 * On write results, indexRevision reflects changes committed by that run. Older implementations may omit it.
 */
export interface MemoryService {
  findCandidates?(readSet: ContextReadSet, input: FindCandidatesInput, options?: CallOptions): Promise<FindCandidatesResult>;
  fetchEvidence?(readSet: ContextReadSet, input: FetchEvidenceInput, options?: CallOptions): Promise<FetchEvidenceResult>;
  readContext?(readSet: ContextReadSet, input: ReadContextInput, options?: CallOptions): Promise<ReadContextResult>;
  inspect?(scope: Scope, input: InspectListInput | InspectItemInput, options?: CallOptions): Promise<InspectListResult | InspectItemResult>;
  enqueueCapture(scope: Scope, capture: { client: string; sessionId: string; eventId: string; messages: CaptureMessage[] }): Promise<{ status: "accepted" | "duplicate" | "paused" | "blocked" }>;
  /** Throws capability_unavailable if procedural options are supplied without proceduralTags. */
  save(scope: Scope, text: string, source: SourceRef, kind?: MemoryKind, options?: SaveOptions): Promise<
    { status: "saved" | "duplicate"; item: MemoryRow; indexRevision?: number } |
    { status: "suppressed" | "paused" | "invalid"; indexRevision?: number }
  >;
  correct(scope: Scope, id: string, expectedRevision: Revision, text: string, source: SourceRef, options?: CorrectOptions): Promise<
    { status: "saved" | "unchanged"; item: MemoryRow; indexRevision?: number } |
    { status: "suppressed" | "paused" | "not_found" | "conflict"; indexRevision?: number }
  >;
  /** The optional guard compares the memory row revision. */
  forget(scope: Scope, id: string, source: SourceRef, options: { expectedRevision?: Revision }): Promise<
    ForgetResult | { status: "conflict"; indexRevision?: number }
  >;
  forget(scope: Scope, id: string, source: SourceRef): Promise<ForgetResult>;
  recall(scope: Scope, query: string, options: { limit: number; cursor: string | null; mode: "search" | "plugin" }): Promise<{ items: MemoryRow[]; nextCursor: string | null; scores?: number[] }>;
  /** A null query leaves the raw layer empty. */
  find(scope: Scope, query: null, options: FindOptions): Promise<Omit<FindResult, "raw"> & { raw: [] }>;
  find(scope: Scope, query: string | null, options: FindOptions): Promise<FindResult>;
  read(scope: Scope, ref: { type: "memory" | "card"; id: string }): Promise<
    { status: "found"; item: MemoryRow; receipts: Receipt[]; sourceDates: { firstMs: number | null; lastMs: number | null } | null } |
    { status: "not_found" }
  >;
  recent(scope: Scope, options: { limit: number; cursor: string | null }): Promise<{ items: MemoryRow[]; nextCursor: string | null }>;
  /** maxTokens ≤ 2000, maxChars ≤ 8000; projectId selects the engine project namespace. */
  sessionStart(scope: Scope, options: { maxTokens: number; maxChars: number; projectId?: string | null }): Promise<SessionContext>;
  captureStatus(scope: Scope, eventId: string, options?: { client?: string }): Promise<{ status: "pending" | "done" | "failed" | "unknown"; code?: string }>;
  pauseState(owner: OwnerId): Promise<{ paused: boolean; generation: number }>;
  setPause(owner: OwnerId, paused: boolean): Promise<{ paused: boolean; generation: number }>;
  /** Paged export of visible memories (download, migration). */
  exportMemories(scope: Scope, page: { cursor: string | null; limit: number }): Promise<{ items: MemoryRow[]; nextCursor: string | null }>;
  /** Paged export of visible raw messages (download, migration). */
  listRawMessages(scope: Scope, page: { cursor: string | null; limit: number }): Promise<{ items: RawSegment[]; nextCursor: string | null }>;
  /** Import goes through the FULL capture suppression policy and the pause check. */
  importMemories(scope: Scope, items: readonly ImportMemory[], source: SourceRef): Promise<ImportResult | ({ status: "paused" } & ImportResult)>;
  /** Raw import goes through the full capture suppression (session, window, lineage, text) and pause. */
  importRawMessages(scope: Scope, sessions: readonly ImportRawSession[]): Promise<ImportResult | { status: "paused" }>;
}

export interface StoreMigrator {
  /** Forward-only; refuses downgrades; SQLite backs up first. */
  upgrade(target: number): Promise<{ from: number; to: number }>;
  version(): Promise<number>;
}
