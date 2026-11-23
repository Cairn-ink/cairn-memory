import type { DocumentSentence, DocumentVector } from "../routing/index.mjs";
import type { Revision, Scope } from "./common.d.ts";
import type { Tx } from "./unit-of-work.d.ts";

export interface DocumentCardSession {
  client: string;
  /** Plain session id. Stores resolve hashed session keys internally. */
  sessionId: string;
}

export interface DocumentCardSourceMessage extends DocumentCardSession {
  messageId: string;
}

export interface DocumentCardSentence extends Pick<DocumentSentence, "start" | "end"> {
  source: DocumentCardSourceMessage;
}

export interface DocumentCardStaleEntry {
  memoryId: string;
  replacementMemoryId: string;
}

export interface DocumentCardRecord {
  id: string;
  scope: Scope;
  title: string;
  body: string;
  contentHash: string;
  /** Source message time in milliseconds since the epoch, or null when unknown. */
  date: number | null;
  sourceMessage: DocumentCardSourceMessage;
  sourceMemories: ReadonlyArray<{ id: string; revision: Revision }>;
  sentences: readonly DocumentCardSentence[];
  stale: readonly DocumentCardStaleEntry[];
}

/** Select exactly one kind of source. All selectors are confined to the call's scope. */
export type DocumentCardHideSelector =
  | { sourceMemoryId: string; sourceMessage?: never; session?: never }
  | { sourceMessage: DocumentCardSourceMessage; sourceMemoryId?: never; session?: never }
  | { session: DocumentCardSession; sourceMemoryId?: never; sourceMessage?: never };

export interface DocumentCardEmbedding {
  model: string;
  vector: DocumentVector;
}

/**
 * Optional (capability documentCards). All calls use the live Tx from UnitOfWork.
 * Each insert or replacement, each hide call affecting at least one card, and each
 * markStale call advances the owner index revision once.
 */
export interface DocumentCardStore {
  /**
   * Runs inside the capture finish transaction. Idempotent on (id, contentHash).
   * A hidden or tombstoned id returns "tombstoned" without writing anything.
   * Vectors supplied with a write are keyed by model.
   */
  put(tx: Tx, scope: Scope, card: DocumentCardRecord, embedding?: DocumentCardEmbedding): Promise<{
    status: "inserted" | "unchanged" | "replaced" | "tombstoned";
  }>;
  hide(tx: Tx, scope: Scope, cardId: string, reason: string): Promise<void>;
  hideWhere(tx: Tx, scope: Scope, selector: DocumentCardHideSelector, reason: string): Promise<{ hidden: number }>;
  /** Stores the ids of the changed memory and its replacement. */
  markStale(tx: Tx, scope: Scope, cardId: string, entry: DocumentCardStaleEntry): Promise<void>;
  /** Same read snapshot as the final visibility check. Hidden and tombstoned cards are excluded. */
  get(tx: Tx, scope: Scope, cardId: string): Promise<DocumentCardRecord | null>;
  /** Same read snapshot as get. */
  list(tx: Tx, scope: Scope): Promise<DocumentCardRecord[]>;
}
