import type {
  ClockAndHash, DiagnosticEvent, EmbedderPort, EmbedQuery, FinishResult, MemoryService,
  ModelGate, ModelPort, ModelStage, Scope, StorageAdapter, StoredDocumentCardRecord, TokenCounter,
} from "../ports/index.d.ts";

export type { DiagnosticEvent } from "../ports/common.d.ts";

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
  readonly storage: StorageAdapter<StoredDocumentCardRecord>;
  readonly model: ModelPort;
  readonly embedder: EmbedderPort;
  readonly gate: ModelGate;
  readonly clock: ClockAndHash;
  readonly tokens: TokenCounter;
  readonly embedQuery?: EmbedQuery;
  readonly config: MemoryServiceConfig;
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

export function createMemoryService(deps: MemoryServiceDeps): MemoryService & CaptureRunner;
