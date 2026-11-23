import type { Revision, Scope } from "../ports/common.d.ts";
import type { DocumentCardRecord } from "../ports/document-card.d.ts";
import type { FactMatchPolicy, FactMatchRow } from "../privacy/fact-match.mjs";
import type { StoredFact } from "../suppression-fact.mjs";

export type DocumentCardMemoryState =
  | { status: "visible"; revision: Revision; content?: string; date?: number | null }
  | { status: "historical"; revision: Revision }
  | { status: "forgotten" | "suppressed" | "unknown" };

/** Current states for one scope, from the card's read snapshot. Absent means missing. */
export type DocumentCardMemoryStates = ReadonlyMap<string, DocumentCardMemoryState>;

export interface DocumentCardVisibilityInput {
  card: Pick<DocumentCardRecord, "id" | "scope" | "sourceMessage" | "sourceMemories"> & {
    /** Resolved by the host from the plain source, with the same resolver used at capture. */
    canonicalSessionKey: string | null;
  };
  requestedScope: Scope;
  memoryStates: DocumentCardMemoryStates;
  /** A definite false is required to deliver the card. */
  sourceWithheld: boolean | null;
}

export type DocumentCardHiddenReason =
  | "scope_mismatch" | "id_mismatch" | "source_withheld" | "source_memory_missing"
  | "source_memory_forgotten" | "source_memory_not_visible" | "uncertain";

export type DocumentCardVisibility =
  | { visible: true; reason: null }
  | { visible: false; reason: DocumentCardHiddenReason };

export declare function documentCardVisible(input: DocumentCardVisibilityInput): Promise<DocumentCardVisibility>;

export interface DocumentCardStalenessInput {
  card: Pick<DocumentCardRecord, "sourceMemories" | "stale">;
  memoryStates: DocumentCardMemoryStates;
}

/** True also on uncertain revision evidence. Check visibility independently. */
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
  /** Raw match projections covering the whole source message, before any span is removed. */
  rawRows: readonly Extract<FactMatchRow, { type: "raw" }>[] | null;
  /** Complete applicable fact set from the same snapshot, or null if unknown. */
  facts: readonly StoredFact[] | null;
  /** Raw lineage or other host-resolved exclusions, including identity-derived spans. */
  sourceExcluded: boolean | null;
  /** Use the same policy as Raw. */
  policy?: FactMatchPolicy;
}

export declare function documentCardSourceWithheld(input: DocumentCardSourceWithheldInput): boolean;
