import type {
  ClockAndHash, ContextAssemblyValue, ContextReadStore, ContextReadTokenCounter, DiagnosticEvent,
  EmbedderPort, EmbedQuery, FinishResult, InspectStore, MemoryService, ModelGate, ModelPort,
  ModelStage, ReadContractStorage, Scope, StorageAdapter, StoredDocumentCardRecord, TokenCounter,
} from "../ports/index.d.ts";

export type { DiagnosticEvent } from "../ports/common.d.ts";
export type {
  ContextAssemblyDiagnostics, ContextAssemblyItem, ContextAssemblyPolicy, ContextAssemblyRepresentation,
  ContextAssemblyValue, ContextCandidateDiagnostics, ContextCardEvidence, ContextMemoryEvidence,
  ContextReadError, ContextReadErrorCode, ContextReadRef, ContextReadSet, ContextReadTokenCounter,
  FetchEvidenceInput, FetchEvidenceResult, FindCandidatesInput, FindCandidatesResult,
  InspectItemInput, InspectItemResult, InspectListInput, InspectListResult, InspectMemoryMetadata,
  InspectReceipt, InspectState, ReadContextInput, ReadContextResult,
} from "../ports/host.d.ts";

export interface MemoryServiceConfig {
  readonly nearDuplicateDistance?: number;
  readonly lexicalWeight?: number;
  readonly vectorWeight?: number;
  readonly leaseMs?: number;
  /** Relative stage deadlines in milliseconds. */
  readonly deadlines?: Readonly<Partial<Record<ModelStage, number>>>;
  readonly rowShingles?: boolean;
}

export interface MemoryServiceDeps {
  readonly storage: ReadContractStorage<StoredDocumentCardRecord>;
  readonly model: ModelPort;
  readonly embedder: EmbedderPort;
  readonly gate: ModelGate;
  readonly clock: ClockAndHash;
  readonly tokens: TokenCounter;
  readonly embedQuery?: EmbedQuery;
  readonly config: MemoryServiceConfig;
  /** Capture emits extract/core_finish/candidate_withheld once per core-filtered candidate after commit. */
  readonly diagnostics?: (e: DiagnosticEvent) => void;
}

export interface CaptureRunner {
  /** Idempotent per eventId. */
  runCapture(
    scope: Scope,
    capture: { client: string; sessionId: string; eventId: string },
    options?: { signal?: AbortSignal },
  ): Promise<{ status: "done" | "duplicate" | "processing" | "paused" | "failed"; code?: string; result?: FinishResult }>;
}

/** The Addendum 17 entries are required for the explicit keyless-local composition. */
export type ContextReadMemoryService = MemoryService &
  Required<Pick<MemoryService, "findCandidates" | "fetchEvidence" | "readContext" | "inspect">>;

/** Declaration for the keyless-local composition once the runtime implements Addendum 17. */
export interface KeylessMemoryServiceDeps extends Pick<MemoryServiceDeps, "clock" | "config" | "diagnostics"> {
  readonly profile: "keyless-local";
  readonly storage: ReadContractStorage & {
    readonly capabilities: { readonly contextRead: true; readonly inspect: true };
    readonly contextRead: ContextReadStore;
    readonly inspect: InspectStore;
  };
  readonly contextReadCounter: ContextReadTokenCounter;
  /** Pure deterministic formatter. The host sends the same bytes core counts. */
  readonly contextReadFormat: (value: ContextAssemblyValue) => string;
}

export function createMemoryService(deps: KeylessMemoryServiceDeps): ContextReadMemoryService & CaptureRunner;
export function createMemoryService(deps: MemoryServiceDeps): MemoryService & CaptureRunner;
