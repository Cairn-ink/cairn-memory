import type { ErrorCode } from "../errors.mjs";
import type { MemoryKind, MemoryRow, Namespace, OwnerId, Receipt, Revision, Scope, SourceRef } from "./common.d.ts";
import type { CaptureMessage } from "./capture.d.ts";
import type { RawSegment } from "./retrieval.d.ts";

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

/** The host supplies the source identity. Core uses the event or message ID as Receipt.messageId. */
type ExplicitWriteReceipt = Pick<Receipt, "client" | "sessionId" | "occurredAtMs" | "excerpt"> &
  { role: "user" } &
  ({ messageId: string; eventId?: never } | { eventId: string; messageId?: never });

interface SaveOptions {
  receipt?: ExplicitWriteReceipt;
  /** Pending a storage port decision. Offsets refer to the explicit receipt excerpt. */
  procedural?: { anchors: readonly { receiptIndex: 0; start: number; end: number }[] };
}

interface CorrectOptions {
  kind?: MemoryKind;
  receipt?: ExplicitWriteReceipt;
}

/** The facade every host (MCP, plugin, web, hosted service) talks to. Template: cloud port.ts. */
export interface MemoryService {
  enqueueCapture(scope: Scope, capture: { client: string; sessionId: string; eventId: string; messages: CaptureMessage[] }): Promise<{ status: "accepted" | "duplicate" | "paused" | "blocked" }>;
  /** Write revisions are read inside the run. Older implementations may omit indexRevision. */
  save(scope: Scope, text: string, source: SourceRef, kind?: MemoryKind, options?: SaveOptions): Promise<
    { status: "saved" | "duplicate"; item: MemoryRow; indexRevision?: number } |
    { status: "suppressed" | "paused" | "invalid" }
  >;
  correct(scope: Scope, id: string, expectedRevision: Revision, text: string, source: SourceRef, options?: CorrectOptions): Promise<
    { status: "saved" | "unchanged"; item: MemoryRow; indexRevision?: number } |
    { status: "suppressed" | "paused" | "not_found" | "conflict" }
  >;
  forget(scope: Scope, id: string, source: SourceRef, options?: { expectedRevision?: Revision }): Promise<
    { status: "forgotten"; removedSimilar: number; indexRevision?: number } |
    { status: "not_found"; indexRevision?: number } |
    { status: "conflict" }
  >;
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
