import type { Scope } from "../ports/common.d.ts";
import type { DocumentCardAmendment, DocumentCardRecord, DocumentCardSession, DocumentCardSourceMessage } from "../ports/document-card.d.ts";
import type { DetectChangesRequest, ModelPort, VerifyChangeRequest } from "../ports/model.d.ts";
import type { DocumentMessage } from "./index.mjs";
import type { DocumentCardSourceWithheldInput, DocumentCardVisibility } from "./visibility.mjs";

export declare const SYS_DETECT: string;
export declare const SYS_VERIFY: string;

type CountTokens = (text: string) => number;

export interface AmendmentConversation extends DocumentCardSession {
  scope: Scope;
  /** Session date in YYYY-MM-DD format. */
  date: string;
  /** Eligible messages in capture order. Core redacts their text and numbers missing turns from 1. */
  messages: readonly (Pick<DocumentMessage, "id" | "role" | "content"> & { turn?: number })[];
}

/** The host projects currently visible cards, using their source session dates. */
export type AmendmentDetectCard = Pick<DocumentCardRecord, "id" | "scope" | "body" | "sourceMessage"> & {
  /** YYYY-MM-DD, or null when the source session date is unknown. */
  date: string | null;
};

type AmendmentRequestCard = AmendmentDetectCard & { date: string };

export type AmendmentCounter =
  | "detect_card_list_truncated" | "detect_skipped_oversize"
  | "detect_skipped_no_user" | "detect_skipped_no_earlier_cards" | "detect_skipped_missing_model"
  | "detect_skipped_token_count_unavailable" | "verify_skipped_token_count_unavailable"
  | "verify_skipped_oversize" | "verify_skipped_quote_already_applied" | "verify_skipped_limit"
  | "detect_calls" | "verify_calls" | "verify_rejected"
  | `${"detect" | "verify"}_${"input_tokens" | "output_tokens" | "failed" | "malformed_output" | "timeout"}`;

export type AmendmentCounters = Partial<Record<AmendmentCounter | ChangeCandidateDropReason, number>>;

export declare function buildDetectRequest(input: {
  conversation: AmendmentConversation;
  cards: readonly AmendmentDetectCard[];
  countTokens: CountTokens;
  /** Serialized request token limit, capped at 6,000. */
  inputLimit?: number;
}): {
  request: DetectChangesRequest | null;
  listedCards: AmendmentRequestCard[];
  counters: AmendmentCounters;
};

export type ChangeCandidateDropReason =
  | "malformed" | "unknown_card" | "quote_not_verbatim" | "same_session" | "quote_from_assistant"
  | "redaction_unavailable" | "ill_formed_model_text";

export interface CheckedChange {
  card: AmendmentRequestCard;
  /** Matched redacted source substring for the verify request. */
  quote: string;
  /** Matched source substring after redaction, for storage. */
  verbatimQuote: string;
  /** Untrimmed, redacted new value for verification. */
  newValue: string;
  sourceMessage: DocumentCardSourceMessage;
}

/** Candidates come from parsed model JSON. Non-JSON adapter values are out of contract. */
export declare function checkChangeCandidates(input: {
  changes: readonly unknown[];
  listedCards: readonly AmendmentRequestCard[];
  captureMessages: AmendmentConversation["messages"];
  captureSession: DocumentCardSession;
}): {
  candidates: CheckedChange[];
  drops: Partial<Record<ChangeCandidateDropReason, number>>;
};

export declare function buildVerifyRequest(input: {
  card: Pick<AmendmentRequestCard, "date" | "body">;
  sessionDate: string;
  quote: string;
  newValue: string;
}): VerifyChangeRequest;

export declare function amendmentId(cardId: string, sourceMessage: DocumentCardSourceMessage, quote: string): Promise<string>;

export interface DetectedCardAmendment {
  cardId: string;
  amendment: DocumentCardAmendment;
}

/** Call after the capture commits, outside any unit of work. Recheck freshness before writing. */
export declare function detectCardAmendments(input: {
  model?: Pick<ModelPort, "countTokens" | "detectChanges" | "verifyChange"> | null;
  capture: AmendmentConversation;
  cards: readonly AmendmentDetectCard[];
  limits?: {
    /** Serialized request token limit, capped at 6,000. */
    inputLimit?: number;
    /** Per-call deadline in milliseconds. Defaults to 30 seconds. */
    timeoutMs?: number;
  };
}): Promise<{ amendments: DetectedCardAmendment[]; counters: AmendmentCounters }>;

/** Keeps the five newest amendments, oldest first. Equal dates preserve input order. */
export declare function selectAmendmentsForRead<T extends Pick<DocumentCardAmendment, "date">>(
  amendments: readonly T[],
): T[];

/** The host meters the complete item by including the piece and separator in countTokens. */
export declare function renderCardAmendments<T extends Pick<DocumentCardAmendment, "date" | "sentence">>(input: {
  amendments: readonly T[];
  countTokens: CountTokens;
  maxTokens: number;
}): { text: string; amendments: T[] };

export declare function documentCardAmendmentVisible(input: {
  cardVisibility: DocumentCardVisibility;
  scope: Scope;
  source: DocumentCardSourceWithheldInput;
  /** Raw keys resolved from the amendment's sourceMessage in the same snapshot. */
  sourceIdentity: { sessionKeyHash: string; messageKey: string } | null;
}): boolean;
