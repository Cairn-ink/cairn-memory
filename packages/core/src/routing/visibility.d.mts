import type { ItemRef, Revision, Scope } from "../ports/common.d.ts";
import type { DocumentCardRecord } from "../ports/document-card.d.ts";
import type { FactMatchPolicy, FactMatchRow } from "../privacy/fact-match.mjs";
import type { FingerprintKey, FingerprintLabels } from "../privacy/fingerprint.mjs";
import type { StoredFact, TextFact } from "../suppression-fact.mjs";

export type DocumentCardMemoryState =
  | { status: "visible"; revision: Revision; content?: string; date?: number | null }
  | { status: "historical"; revision: Revision }
  | { status: "forgotten" | "suppressed" | "unknown" };

/** Current states for one scope, from the card's read snapshot. Absent means missing. */
export type DocumentCardMemoryStates = ReadonlyMap<string, DocumentCardMemoryState>;

export interface DocumentCardVisibilityInput {
  card: Pick<DocumentCardRecord, "id" | "scope" | "origin" | "sourceMemories"> & {
    /** The stored source. Import and manual cards require an explicit null. */
    sourceMessage?: DocumentCardRecord["sourceMessage"] | null;
    /** Resolved by the host from the plain source, with the same resolver used at capture. */
    canonicalSessionKey?: string | null;
    /** Stored text for import and manual cards. Use null for a stored card without a title. */
    title?: DocumentCardRecord["title"] | null;
    body?: DocumentCardRecord["body"];
  };
  requestedScope: Scope;
  memoryStates: DocumentCardMemoryStates;
  /** The runtime check requires a definite false for message-backed cards. */
  sourceWithheld?: boolean | null;
  /** Complete applicable text facts from the same scope and read snapshot for import and manual cards. */
  textFacts?: readonly TextFact[] | null;
  /** The scope owner's memory fingerprint key, derived with Core labels. Null or omission means the key is unavailable. */
  fingerprintKey?: FingerprintKey | null;
  /**
   * Evidence for legacy MAC aliases on import and manual cards. Derive the owner's key with these adapter labels.
   * Pass both fingerprintKey and legacyFingerprint when the host holds both kinds of facts.
   * Omitting either leaves facts that require that key fail-closed.
   */
  legacyFingerprint?: { key: FingerprintKey; labels: FingerprintLabels };
  /** Legacy full-fact shingle containment cutoff in (0, 1]. Defaults to 0.6. */
  containmentThreshold?: number;
}

export type DocumentCardHiddenReason =
  | "scope_mismatch" | "id_mismatch" | "source_withheld" | "text_withheld" | "source_memory_missing"
  | "source_memory_forgotten" | "source_memory_not_visible" | "uncertain";

export type DocumentCardVisibility =
  | { visible: true; reason: null }
  | { visible: false; reason: DocumentCardHiddenReason };

/** Message-backed cards can remain visible with historical links. Import and manual cards require exact visible revisions. */
export declare function documentCardVisible(input: DocumentCardVisibilityInput): Promise<DocumentCardVisibility>;

export type DocumentCardRowDropReason = DocumentCardHiddenReason | "invalid_ref" | "load_failed" | "missing_input";

/** Resolve the card's visibility input in the candidate read snapshot, or return null if it is unavailable. */
export type LoadDocumentCardVisibility = (ref: ItemRef) =>
  DocumentCardVisibilityInput | null | Promise<DocumentCardVisibilityInput | null>;

/** Keeps only visible card rows in input order and counts drops by reason without including content. */
export declare function visibleDocumentCardRows<T extends { ref: ItemRef }>(
  rows: readonly T[],
  loadInput: LoadDocumentCardVisibility,
): Promise<{ rows: T[]; drops: Partial<Record<DocumentCardRowDropReason, number>> }>;

export interface DocumentCardStalenessInput {
  card: Pick<DocumentCardRecord, "sourceMemories" | "stale">;
  memoryStates: DocumentCardMemoryStates;
}

/** True for stale entries, changed revisions, or any source state other than current and visible. */
export declare function documentCardStaleness(input: DocumentCardStalenessInput): boolean;

export interface StaleReplacementInput {
  replacementMemoryId: string | null;
  memoryStates: DocumentCardMemoryStates;
  /** Current supersession edges from the same scope and snapshot. */
  successorOf: ReadonlyMap<string, string>;
}

export interface StaleReplacement {
  memoryId: string;
  revision: Revision;
  content: string;
  date: number | null;
}

/** Follows known historical states to the current visible revision. */
export declare function resolveStaleReplacement(input: StaleReplacementInput): StaleReplacement | null;

export interface DocumentCardSourceWithheldInput {
  /** Full source message length in Raw's UTF-16 coordinates before any span is removed. */
  sourceLengthUtf16: number;
  /** Raw projections for one source in span order, with no gaps or overlaps. */
  rawRows: readonly Extract<FactMatchRow, { type: "raw" }>[] | null;
  /** Complete applicable fact set from the same snapshot, or null if unknown. */
  facts: readonly StoredFact[] | null;
  /** Raw lineage or other host-resolved exclusions, including identity-derived spans. */
  sourceExcluded: boolean | null;
  /** Use the same policy as Raw. */
  policy?: FactMatchPolicy;
}

export declare function documentCardSourceWithheld(input: DocumentCardSourceWithheldInput): boolean;
