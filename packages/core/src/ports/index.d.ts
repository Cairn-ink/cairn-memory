export type * from "./common.d.ts";
export type * from "./unit-of-work.d.ts";
export type * from "./model.d.ts";
export type * from "./capture.d.ts";
export type * from "./document-card.d.ts";
export type * from "./memory-store.d.ts";
export type * from "./retrieval.d.ts";
export type * from "./privacy.d.ts";
export type * from "./host.d.ts";

import type { Capabilities } from "../capabilities.mjs";
import type { CaptureClaim, CaptureFinish, CausalStream, PlacementJournal, RawCapture, SourceFilter, StagedEvidence } from "./capture.d.ts";
import type { DocumentCardStore } from "./document-card.d.ts";
import type { ConflictEdgeStore, MemoryStore, SupersessionStore } from "./memory-store.d.ts";
import type { HydrateItems, LexicalCandidates, ListRawMessages, ListRecent, RawCandidates, ReadSnapshot, RelationSource, VectorCandidates, VisibilityFence } from "./retrieval.d.ts";
import type { FingerprintKeyProvider, ForgetLog, PauseStore, RawStore, SessionLineageStore, SpanLineageStore, SuppressionStore } from "./privacy.d.ts";
import type { UnitOfWork } from "./unit-of-work.d.ts";
import type { QuantityLedgerStore } from "./quantity-ledger.d.ts";

export type * from "./quantity-ledger.d.ts";

/**
 * Everything a storage adapter provides. Optional members must be present exactly when
 * the matching capability flag is true (the conformance kit checks this).
 */
export interface StorageAdapter {
  readonly name: string;
  readonly capabilities: Capabilities;
  readonly uow: UnitOfWork;
  readonly capture: CaptureClaim & CaptureFinish & SourceFilter;
  readonly memories: MemoryStore;
  readonly suppressions: SuppressionStore;
  readonly pause: PauseStore;
  readonly keys: FingerprintKeyProvider;
  readonly lexical: LexicalCandidates;
  readonly fence: VisibilityFence;
  readonly snapshot: ReadSnapshot;
  readonly hydrate: HydrateItems;
  readonly recent: ListRecent;
  readonly vector?: VectorCandidates; // semanticRetrieval
  readonly raw?: RawCapture & RawCandidates & RawStore & ListRawMessages; // rawArchive
  readonly sessionLineage?: SessionLineageStore; // sessionLineage
  readonly spanLineage?: SpanLineageStore; // spanLineage
  readonly staged?: StagedEvidence; // stagedEvidence
  readonly placement?: PlacementJournal; // placement
  readonly relations?: RelationSource; // relations
  readonly causal?: CausalStream; // orderedCapture
  readonly supersession?: SupersessionStore; // supersession
  readonly conflicts?: ConflictEdgeStore; // conflictEdges
  readonly forgetLog?: ForgetLog; // forgetLog
  readonly documentCards?: DocumentCardStore; // documentCards
  readonly quantityLedger?: QuantityLedgerStore; // quantityLedger
}
