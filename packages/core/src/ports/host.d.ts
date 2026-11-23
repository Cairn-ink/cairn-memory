import type { MemoryKind, MemoryRow, Namespace, OwnerId, Revision, Scope, SourceRef } from "./common.d.ts";
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

/** The facade every host (MCP, plugin, web, hosted service) talks to. Template: cloud port.ts. */
export interface MemoryService {
  enqueueCapture(scope: Scope, capture: { client: string; sessionId: string; eventId: string; messages: CaptureMessage[] }): Promise<{ status: "accepted" | "duplicate" | "paused" | "blocked" }>;
  save(scope: Scope, text: string, source: SourceRef, kind?: MemoryKind): Promise<
    { status: "saved" | "duplicate"; item: MemoryRow } | { status: "suppressed" | "paused" | "invalid" }
  >;
  correct(scope: Scope, id: string, expectedRevision: Revision, text: string, source: SourceRef): Promise<
    { status: "saved" | "unchanged"; item: MemoryRow } | { status: "suppressed" | "paused" | "not_found" | "conflict" }
  >;
  forget(scope: Scope, id: string, source: SourceRef): Promise<{ status: "forgotten"; removedSimilar: number } | { status: "not_found" }>;
  recall(scope: Scope, query: string, options: { limit: number; cursor: string | null; mode: "search" | "plugin" }): Promise<{ items: MemoryRow[]; nextCursor: string | null; scores?: number[] }>;
  recent(scope: Scope, options: { limit: number; cursor: string | null }): Promise<{ items: MemoryRow[]; nextCursor: string | null }>;
  /** maxTokens ≤ 2000, maxChars ≤ 8000; projectId selects the engine project namespace. */
  sessionStart(scope: Scope, options: { maxTokens: number; maxChars: number; projectId?: string | null }): Promise<SessionContext>;
  captureStatus(scope: Scope, eventId: string): Promise<{ status: "pending" | "done" | "failed" | "unknown"; code?: string }>;
  pauseState(owner: OwnerId): Promise<{ paused: boolean; generation: number }>;
  setPause(owner: OwnerId, paused: boolean): Promise<{ paused: boolean; generation: number }>;
  /** Paged export of visible memories (download, migration). */
  exportMemories(scope: Scope, page: { cursor: string | null; limit: number }): Promise<{ items: MemoryRow[]; nextCursor: string | null }>;
  /** Paged export of visible raw messages (download, migration). */
  listRawMessages(scope: Scope, page: { cursor: string | null; limit: number }): Promise<{ items: RawSegment[]; nextCursor: string | null }>;
  /** Import goes through the FULL capture suppression policy and the pause check. */
  importMemories(scope: Scope, items: readonly ImportMemory[], source: SourceRef): Promise<ImportResult | { status: "paused" }>;
  /** Raw import goes through the full capture suppression (session, window, lineage, text) and pause. */
  importRawMessages(scope: Scope, sessions: readonly ImportRawSession[]): Promise<ImportResult | { status: "paused" }>;
}

export interface StoreMigrator {
  /** Forward-only; refuses downgrades; SQLite backs up first. */
  upgrade(target: number): Promise<{ from: number; to: number }>;
  version(): Promise<number>;
}
