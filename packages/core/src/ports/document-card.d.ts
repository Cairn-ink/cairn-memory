import type { DocumentCardVisibilityInput, DocumentSentence, DocumentVector } from "../routing/index.mjs";
import type { Revision, Scope } from "./common.d.ts";
import type { LexicalCandidates, VectorCandidates } from "./retrieval.d.ts";
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

/** Authored cards can be written without a source message. Amendment history is managed by the store. */
export interface SourceLessDocumentCardRecord extends Omit<DocumentCardRecord, "origin" | "sourceMessage" | "amendments"> {
  readonly origin: "import" | "manual";
  sourceMessage: null;
}

/** The record set for stores that support both message-backed and source-less cards. */
export type StoredDocumentCardRecord = DocumentCardRecord |
  (SourceLessDocumentCardRecord & Pick<DocumentCardRecord, "amendments">);

type DocumentCardWrite<Card> = Card extends StoredDocumentCardRecord ? Omit<Card, "amendments"> : never;

/** Select exactly one card ID or kind of source, confined to the call's scope. */
export type DocumentCardHideSelector =
  | { cardId: string; sourceMemoryId?: never; sourceMessage?: never; session?: never }
  | { sourceMemoryId: string; cardId?: never; sourceMessage?: never; session?: never }
  | { sourceMessage: DocumentCardSourceMessage; cardId?: never; sourceMemoryId?: never; session?: never }
  | { session: DocumentCardSession; cardId?: never; sourceMemoryId?: never; sourceMessage?: never };

export interface DocumentCardHideOptions {
  /** Clear stored text and retain the ID and reason permanently. */
  purge?: boolean;
  /** Hide during forget while retaining the payload for a later definite purge. */
  retainText?: boolean;
}

export interface DocumentCardEmbedding {
  model: string;
  vector: DocumentVector;
}

/**
 * Optional (capability documentCards). All calls use the live Tx from UnitOfWork.
 * Each card insert or replacement, each hide call affecting at least one card or amendment,
 * and each markStale call advances the owner index revision once.
 * With placement enabled, the host drops topic memberships in the same transaction
 * as every hide or tombstone.
 */
export interface DocumentCardStore<Card extends StoredDocumentCardRecord = DocumentCardRecord> {
  /**
   * Runs inside the capture finish transaction. Idempotent on (id, contentHash).
   * Bind sourceMemories for a router card to the memories that capture wrote or
   * touched for its source message, or use documentCardMemoryLinks with receipts.
   * On recapture, union these bindings by id, keeping the highest revision.
   * Use linkMemories to add bindings for the same content, or implement it within put.
   * Preserve the stored origin on replacement.
   * A hidden or tombstoned id returns "tombstoned" without writing anything.
   * Vectors supplied with a write are keyed by model. Amendment history is managed
   * through the amendment operations.
   */
  put(tx: Tx, scope: Scope, card: DocumentCardWrite<Card>, embedding?: DocumentCardEmbedding): Promise<{
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
  /** A purged amendment retains its ID and reason, with its sentence and quote erased. */
  hideAmendment(tx: Tx, scope: Scope, cardId: string, amendmentId: string, reason: string, options?: { purge?: boolean }): Promise<void>;
  /**
   * Uses the live Tx to union links into sourceMemories by id, keeping the highest revision.
   * A change returns "linked" and advances the owner index revision once. A union
   * with no change returns "unchanged". A hidden or tombstoned card returns
   * "tombstoned" without writing. An unknown id returns "not_found".
   * Allows a later capture to add links for receipts citing the same message
   * while put stays idempotent on (id, contentHash). A host may implement this in put.
   */
  linkMemories(tx: Tx, scope: Scope, cardId: string, links: DocumentCardRecord["sourceMemories"]): Promise<{
    status: "linked" | "unchanged" | "tombstoned" | "not_found";
  }>;
  /** Hiding a card also hides all of its amendments. */
  hide(tx: Tx, scope: Scope, cardId: string, reason: string): Promise<void>;
  /**
   * A sourceMessage or session selector also hides amendments with a matching source.
   * Purge uses stored bindings, including entries excluded by the reader and prior hides
   * that retained text. Physically erase the card title, body, sentences, and amendment
   * payloads. Reads exclude the tombstone and put of the same ID returns "tombstoned".
   * With neither option set, use the adapter's ordinary hide behaviour. Purge takes
   * precedence over retainText.
   * `hidden` counts newly hidden cards plus newly hidden amendments. The owner index
   * revision advances once if the call hides at least one card or amendment.
   */
  hideWhere(tx: Tx, scope: Scope, selector: DocumentCardHideSelector, reason: string, options?: DocumentCardHideOptions): Promise<{ hidden: number }>;
  /**
   * Erasure assessment for purge-aware hosts. Load live read inputs inside the forget
   * transaction, including entries hidden with retainText. Omit selectors to scan the scope.
   * Report sourceWithheld as null when source proof is missing. A suppressed memory
   * state and an amendment's sourceWithheld:true each require a definite block.
   */
  listForPurge?(tx: Tx, scope: Scope, selectors?: readonly DocumentCardHideSelector[]): Promise<Array<{
    cardId: string;
    /** Null when a selector matched only an amendment. */
    input: DocumentCardVisibilityInput | null;
    amendments: readonly (Pick<DocumentCardAmendment, "amendmentId" | "sourceMessage"> & { sourceWithheld: boolean })[];
  }>>;
  /** Stores the ids of the changed memory and its replacement. */
  markStale(tx: Tx, scope: Scope, cardId: string, entry: DocumentCardStaleEntry): Promise<void>;
  /**
   * Same read snapshot as the final visibility check. Returns visible cards and amendments only,
   * with amendments in ascending date order and insertion order for equal dates.
   */
  get(tx: Tx, scope: Scope, cardId: string): Promise<Card | null>;
  /** Same read snapshot, visibility, and amendment ordering as get. */
  list(tx: Tx, scope: Scope): Promise<Card[]>;
}

/**
 * Optional (capability documentCardSearch). Both methods return only visible cards
 * within the RetrievalScope in the same read snapshot. Exclude hidden and tombstoned
 * cards. Each row has ref.type "card" and the card's namespace in ref.namespace.
 * Order vector rows by distance ascending, then updatedAtUs descending, then id
 * descending by UTF-8 bytes. Core uses the vector channel only when coverage.complete is true.
 */
export interface DocumentCardCandidates extends LexicalCandidates, VectorCandidates {}
