import type {
  ClockAndHash, ContextReadBlockFormatter, ContextReadStore, ContextReadTokenCounter, DiagnosticEvent,
  CallOptions, ContextReadSet, DocumentCardSession, EmbedderPort, EmbedQuery, FindCandidatesInput, FinishResult, InspectStore,
  LexicalFindCandidatesResult, MemoryService, ModelGate, ModelPort,
  ModelStage, ReadContractStorage, Scope, StoredDocumentCardRecord, TokenCounter,
} from "../ports/index.d.ts";

export type { DiagnosticEvent } from "../ports/common.d.ts";
export type {
  ContextAssemblyDiagnostics, ContextAssemblyItem, ContextAssemblyPolicy, ContextAssemblyRepresentation,
  ContextAssemblyValue, ContextCandidateDiagnostics, ContextCardEvidence, ContextLedgerDiagnostics, ContextLedgerDigest,
  ContextLedgerErrorStage, ContextMemoryEvidence,
  ContextReadBlockFormatter, ContextReadError, ContextReadErrorCode, ContextReadRef, ContextReadSet, ContextReadTokenCounter,
  FetchEvidenceInput, FetchEvidenceResult, FindCandidatesInput, FindCandidatesResult, LexicalFindCandidatesResult,
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
  /** Opt in to capture-time cards and, separately, post-commit amendments. Requires documentCards storage. */
  readonly documentCards?: { readonly enabled: boolean; readonly amendments?: boolean };
  /** Opt in to quantity extraction and persistence. Requires quantityLedger storage and a model. */
  readonly quantityLedger?: {
    readonly enabled: boolean;
    /** Include calendar comparisons for “this week” and “this month” when the ledger is enabled. */
    readonly calendarReading?: boolean;
  };
  /**
   * Addendum 26. Opt in to provider-free capture that stores admitted conversation text in Raw only:
   * no provider call, no extraction, no memories. Valid only without a model; registration with a
   * model throws invalid_input. Capture still requires rawArchive storage and capture.admit.
   * With documentCards enabled, the existing keyless card path runs instead.
   *
   * Addendum 27. `onModelFailure: true` is valid only with a model (without one, registration throws
   * invalid_input). When model-backed capture fails with a model-stage code, the event finishes on the
   * Addendum 26 Raw-only path instead of being abandoned: no memories, admitted text archived, result
   * `done` carrying the failure code. Unset or false keeps model-backed capture byte-identical.
   */
  readonly rawCapture?: { readonly enabled?: boolean; readonly onModelFailure?: boolean };
  /** Addendum 28. Opt in to suppression windows when forgetting or correcting a session-less explicit memory. */
  readonly explicitWindowFence?: { readonly enabled: boolean };
}

export interface MemoryServiceDeps {
  readonly storage: ReadContractStorage<StoredDocumentCardRecord>;
  readonly model: ModelPort | null;
  readonly embedder: EmbedderPort | null;
  readonly gate: ModelGate;
  readonly clock: ClockAndHash;
  readonly tokens: TokenCounter;
  readonly embedQuery?: EmbedQuery;
  readonly config: MemoryServiceConfig;
  /** Resolve the card ID's session component when storage uses a non-plain canonical session key. */
  readonly documentCardSessionKey?: (session: DocumentCardSession) => string | null;
  readonly contextReadCounter?: ContextReadTokenCounter;
  readonly contextReadFormat?: ContextReadBlockFormatter;
  /** Capture emits extract/core_finish/candidate_withheld once per core-filtered candidate after commit.
   * It emits extract/core_validation/ungrounded_extraction_quantity once per ungrounded ledger record. */
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

type LexicalFindCandidates = (set: ContextReadSet, input: FindCandidatesInput, options?: CallOptions) => Promise<LexicalFindCandidatesResult>;

/** The Addendum 17 read entries for the explicit keyless-local composition. */
export type ContextReadMemoryService = Required<Pick<MemoryService, "fetchEvidence" | "readContext" | "inspect">> & {
  findCandidates: LexicalFindCandidates;
};

export interface KeylessMemoryServiceDeps extends Pick<MemoryServiceDeps,
  "clock" | "diagnostics" | "contextReadCounter" | "contextReadFormat"> {
  readonly profile: "keyless-local";
  readonly storage: Pick<ReadContractStorage, "capabilities" | "uow" | "fence" | "contextRead" | "inspect"> & {
    readonly capabilities: { readonly contextRead: true; readonly inspect: true };
    readonly contextRead: ContextReadStore;
    readonly inspect: InspectStore;
  };
  readonly config?: MemoryServiceConfig;
}

export interface KeylessInspectServiceDeps extends Pick<MemoryServiceDeps, "clock"> {
  readonly profile: "keyless-local";
  readonly storage: Pick<MemoryServiceDeps["storage"], "capabilities" | "uow" | "inspect">;
}

export type InspectMemoryService = Required<Pick<MemoryService, "inspect">>;
export type MemoryServiceRegistrationDeps = Omit<MemoryServiceDeps, "model" | "embedder">
  & Partial<Pick<MemoryServiceDeps, "embedder">> & {
    /**
     * Registration requires a model when storage.capabilities.fingerprintKey is true.
     * Model-backed capture requires a model. Opted-in keyless document cards can finish without extraction.
     * Opted-in Raw-only capture (config.rawCapture, Addendum 26) archives Raw without extraction.
     */
    readonly model?: MemoryServiceDeps["model"] | undefined;
  };

export function createMemoryService(deps: KeylessMemoryServiceDeps): ContextReadMemoryService;
export function createMemoryService(deps: KeylessInspectServiceDeps): InspectMemoryService;
export function createMemoryService(deps: MemoryServiceRegistrationDeps & { readonly embedQuery?: undefined }):
  Omit<MemoryService, "findCandidates"> & CaptureRunner & InspectMemoryService & { findCandidates?: LexicalFindCandidates };
export function createMemoryService(deps: MemoryServiceRegistrationDeps): MemoryService & CaptureRunner & InspectMemoryService;
