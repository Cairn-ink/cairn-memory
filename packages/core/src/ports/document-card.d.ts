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

export interface DocumentCardAmendment {
  amendmentId: string;
  /** Capture session date in YYYY-MM-DD format. */
  date: string;
  sentence: string;
  sourceMessage: DocumentCardSourceMessage;
  quote: string;
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
  /** Provenance recorded on insert and preserved on replacement. Omitted on legacy records. */
  readonly origin?: "router" | "import" | "manual";
  title: string;
  body: string;
  contentHash: string;
  /** Source message time in milliseconds since the epoch, or null when unknown. */
  date: number | null;
  sourceMessage: DocumentCardSourceMessage;
  sourceMemories: ReadonlyArray<{ id: string; revision: Revision }>;
  sentences: readonly DocumentCardSentence[];
  stale: readonly DocumentCardStaleEntry[];
  /** Visible amendments in ascending date order, then insertion order for equal dates. */
  amendments: readonly DocumentCardAmendment[];
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
 * Each card insert or replacement, each hide call affecting at least one card or amendment,
 * and each markStale call advances the owner index revision once.
 */
export interface DocumentCardStore {
  /**
   * Runs inside the capture finish transaction. Idempotent on (id, contentHash).
   * Preserve the stored origin on replacement.
   * A hidden or tombstoned id returns "tombstoned" without writing anything.
   * Vectors supplied with a write are keyed by model. Amendment history is managed
   * through the amendment operations.
   */
  put(tx: Tx, scope: Scope, card: Omit<DocumentCardRecord, "amendments">, embedding?: DocumentCardEmbedding): Promise<{
    status: "inserted" | "unchanged" | "replaced" | "tombstoned";
  }>;
  /**
   * Insert in a short transaction after rechecking card and source visibility and pause generation.
   * An amendment id already recorded (including a hidden one) is unchanged. A hidden or
   * tombstoned card returns "hidden_card". Only insertion advances the owner index revision.
   */
  amend(tx: Tx, scope: Scope, cardId: string, amendment: DocumentCardAmendment): Promise<{
    status: "inserted" | "unchanged" | "hidden_card";
  }>;
  hideAmendment(tx: Tx, scope: Scope, cardId: string, amendmentId: string, reason: string): Promise<void>;
  /** Hiding a card also hides all of its amendments. */
  hide(tx: Tx, scope: Scope, cardId: string, reason: string): Promise<void>;
  /**
   * A sourceMessage or session selector also hides amendments with a matching source.
   * `hidden` counts newly hidden cards plus newly hidden amendments. The owner index
   * revision advances once if the call hides at least one card or amendment.
   */
  hideWhere(tx: Tx, scope: Scope, selector: DocumentCardHideSelector, reason: string): Promise<{ hidden: number }>;
  /** Stores the ids of the changed memory and its replacement. */
  markStale(tx: Tx, scope: Scope, cardId: string, entry: DocumentCardStaleEntry): Promise<void>;
  /**
   * Same read snapshot as the final visibility check. Returns visible cards and amendments only,
   * with amendments in ascending date order and insertion order for equal dates.
   */
  get(tx: Tx, scope: Scope, cardId: string): Promise<DocumentCardRecord | null>;
  /** Same read snapshot, visibility, and amendment ordering as get. */
  list(tx: Tx, scope: Scope): Promise<DocumentCardRecord[]>;
}
