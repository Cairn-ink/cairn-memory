import type { Receipt, Revision, Role, Scope } from "../ports/common.d.ts";
import type { DocumentCardSourceMessage } from "../ports/document-card.d.ts";

export interface DocumentMessage {
  id: string;
  role: Role;
  /** Incoming content before capture collapses whitespace. */
  content: string;
  occurredAtMs?: number | null;
}

export type DocumentCardReason =
  | "long_assistant" | "long_any" | "explicit"
  | "structured:list" | "structured:table" | "structured:code"
  | "structured:list+table" | "structured:list+code" | "structured:table+code"
  | "structured:list+table+code";

export interface DocumentRouteChoice {
  position: number;
  reason: DocumentCardReason;
}

export interface DocumentRoutingDecision {
  /** In admission priority order; positions index the original messages. */
  chosen: DocumentRouteChoice[];
  drops: {
    extract_only: number;
    capture_limit: number;
    /** Included in extract_only and reported when positive. */
    ill_formed_text?: number;
    /** Included in extract_only and reported when positive. */
    marker_only?: number;
  };
}

/** Determines eligible cards. All messages remain eligible for the existing extraction flow. */
export declare function routeDocumentMessages(messages: readonly DocumentMessage[]): DocumentRoutingDecision;

export interface DocumentSession {
  scope: Scope;
  client: string;
  /** The resolved raw lineage session key shared by both capture paths. */
  canonicalSessionKey: string;
}

export interface DocumentMessageRef extends DocumentSession {
  messageId: string;
}

export interface DocumentSentence {
  /** Inclusive UTF-16 offset in the card body. */
  start: number;
  /** Exclusive UTF-16 offset in the card body. */
  end: number;
  source: DocumentMessageRef;
}

export interface DocumentCard {
  id: string;
  revision: 1;
  title: string;
  date: number | null;
  body: string;
  source: DocumentMessageRef;
  sentences: DocumentSentence[];
}

export type DocumentCardDropReason =
  | "oversize" | "unmappable_redaction" | "empty_body" | "missing_session_key" | "ill_formed_text" | "marker_only";
export type DocumentCardBuild =
  | { card: DocumentCard; drops: Readonly<Record<string, never>> }
  | { card: null; drops: Partial<Record<DocumentCardDropReason, 1>> };

export declare function buildDocumentCard(message: DocumentMessage, session: DocumentSession): Promise<DocumentCardBuild>;

/** Bump when the search text changes to invalidate indexes and embeddings. */
export declare const DOCUMENT_CARD_SEARCH_TEXT_VERSION: 1;

/** Exact text for indexing and embedding. The stored title and body are already redacted. */
export declare function documentCardSearchText(card: { title: string | null; body: string }): string;

export interface DocumentCardFindItem {
  type: "card";
  id: string;
  title: string | null;
  date: number | null;
  excerpt: string;
  /** True when the selected line was clipped. */
  truncated: boolean;
}

/** Selects a matching line and clips it to maxChars Unicode code points (positive integer, default 240). */
export declare function documentCardFindItem(
  card: Pick<DocumentCardFindItem, "id" | "title" | "date"> & { body: string },
  query: string,
  options?: { maxChars?: number },
): DocumentCardFindItem;

export interface DocumentPieceOptions {
  maxTokens: number;
  countTokens: (text: string) => number;
}

export interface DocumentPiece {
  body: string;
  kind: "whole" | "truncated" | "excerpt";
}

/**
 * Uses complete lines for a truncated head when possible, with a code-point prefix
 * for an oversized first line. An oversized matching line is excerpted around the
 * match, with a preceding heading when the combined excerpt fits. Excerpts made
 * from complete lines may add the heading and ellipsis outside the window limit.
 */
export declare function selectDocumentPiece(
  card: Pick<DocumentCard, "body">,
  query: string,
  options: DocumentPieceOptions,
): DocumentPiece;

export type DocumentVector = readonly number[] | Float32Array | Float64Array;

export interface DocumentRankingOptions {
  queryVector?: DocumentVector;
  /** Card ids mapped to vectors computed over the first 2,000 characters of each body. */
  cardVectors?: ReadonlyMap<string, DocumentVector>;
}

export interface DocumentCardMatch {
  card: DocumentCard;
  score: number;
  method: "vector" | "lexical";
}

/**
 * Returns one card with cosine at least 0.35 when both vector inputs are supplied.
 * Otherwise requires coverage of at least half of the query's distinct term tokens
 * in the card's title and body. Ties follow input order.
 */
export declare function rankDocumentCards(
  query: string,
  cards: readonly DocumentCard[],
  options?: DocumentRankingOptions,
): DocumentCardMatch | null;

export * from "./visibility.mjs";
export * from "./amendments.mjs";

/**
 * Optional fallback for hosts with receipts and no capture-time set of touched
 * memories. Keep capture-time binding when available. Matches client, plain
 * sessionId and messageId, ignores role for matching, keeps the highest matching
 * revision per id and sorts by UTF-8 id order. Malformed input throws invalid_input.
 */
export declare function documentCardMemoryLinks(
  sourceMessage: DocumentCardSourceMessage,
  memories: ReadonlyArray<{ id: string; revision: Revision; receipts: readonly Receipt[] }>,
): { id: string; revision: Revision }[];
