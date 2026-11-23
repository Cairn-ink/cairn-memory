import type { ErrorCode } from "../errors.mjs";
import type { CallOptions, ClockAndHash, ModelGate, ModelPort, RationaleEdgeStore, RationaleGuard,
  RationaleRelation, RationaleSource, Scope, StorageAdapter, UnitOfWork } from "../ports/index.d.ts";

export interface RationaleProposal {
  from: number;
  to: number;
  relation: RationaleRelation;
  fromReceipt: number;
  toReceipt: number;
}

export interface RationaleModelOptions extends Pick<CallOptions, "signal" | "onDiagnostic"> {
  model?: ModelPort | null;
  gate: ModelGate;
  deadline?: { check(): void; expired(): boolean; remainingMs(): number };
}

export interface RelateOptions extends RationaleModelOptions {
  sources: readonly RationaleSource[];
  owner: string;
  validateFresh(): Promise<void>;
}

export interface RationaleReadOptions {
  uow: UnitOfWork;
  scope: Scope;
  store?: RationaleEdgeStore;
  retrieval: Pick<StorageAdapter, "memories" | "fence">;
  clock?: Pick<ClockAndHash, "sha256Hex">;
}

export interface RelatePlacedOptions extends RationaleModelOptions, Omit<RationaleReadOptions, "retrieval"> {
  retrieval: Pick<StorageAdapter, "memories" | "lexical" | "snapshot" | "rationaleSourceText">;
  refs: readonly RationaleGuard[];
}

export interface RationaleDiscovery {
  candidateCount: number;
  scanExhausted: boolean;
  candidatesTruncated: boolean;
  queryTruncated: boolean;
  semanticCoverage: "unassessed";
}

export type RelatePlacedReport =
  | { status: "reviewed"; proposed: number; inserted: number; discovery: RationaleDiscovery }
  | { status: "failed"; error: { code: ErrorCode; retryable: boolean }; proposed: number; inserted: 0; discovery?: RationaleDiscovery }
  | { status: "skipped"; reason: "empty" | "disabled"; proposed: 0; inserted: 0 };

export interface DecisionContextOptions extends RationaleReadOptions {
  memoryId: string;
  revision?: number;
}

export interface DecisionContext {
  status: "unassessed" | "reconfirmation-suggested";
  refs: Array<{ id: string; revision: number; relation: RationaleRelation; direction: "incoming" | "outgoing" }>;
}
