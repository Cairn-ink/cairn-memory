import type { Capability, ErrorCode, FactMatchPolicy, FingerprintLabels } from "@cairn-ink/core";
import type { StorageAdapter, StoredDocumentCardRecord } from "@cairn-ink/core/ports";
import type { TestHarness } from "@cairn-ink/conformance/factory";

export type { CaptureClaim, CaptureFinish, CaptureKey, CaptureMessage, ClaimResult, FinishItem, FinishResult,
  SourceFilter } from "@cairn-ink/core/ports";

export interface MemoryAdapterOptions {
  capabilities?: Partial<Record<Capability, boolean>>;
  receiptAttachAdvancesRevision?: boolean;
  proceduralTags?: boolean;
  hostWriteHooks?: boolean;
  /** Enable card candidates with the documentCards capability. Off by default. */
  documentCardSearch?: boolean;
  newId?: () => string;
  now?: () => number;
  topicRetryAfterMs?: number;
  topicMaxAttempts?: number;
  sessionRefs?: "plain" | "hashed";
  hashSessionKey?: FactMatchPolicy["hashSessionKey"];
  fingerprint?: { secret: string; labels: FingerprintLabels } | null;
}

type CapturePorts = StorageAdapter["capture"];

export type MemoryAdapter = Pick<StorageAdapter<StoredDocumentCardRecord>, "capabilities" | "uow" | "memories" |
  "lexical" | "vector" | "fence" | "snapshot" | "hydrate" | "recent" | "suppressions" | "pause" | "keys" | "placement" | "raw" |
  "supersession" | "conflicts" | "documentCards" | "documentCardCandidates" | "rationale" | "rationaleSourceText" | "inspect" |
  "proceduralTags" | "hostWriteHookPort"> & {
  readonly capture: CapturePorts & Required<Pick<CapturePorts, "admit" | "load" | "status">>;
  readonly contextRead?: import("@cairn-ink/core/ports").ContextReadStore;
  name: "memory";
  nativeErrorMap: Readonly<Record<string, ErrorCode>>;
  harness: TestHarness & Required<Pick<TestHarness, "setFingerprintSecret" | "rowsMissingKeyedDigest" | "advanceClock">> & {
    createHostHookTable?: () => MemoryHostHookTable;
    seedInspectEvidence?: ReturnType<typeof import("./inspect.mjs").createInspectStore>["seedInspectEvidence"];
  };
};

/** Public fixtures for the reference adapter's tests. Unsuitable for production. */
export declare const TEST_FINGERPRINT_SECRET: string;
export declare const TEST_FINGERPRINT_LABELS: FingerprintLabels;

export declare function createMemoryAdapter(options?: MemoryAdapterOptions & {
  capabilities?: { documentCards?: false };
}): Omit<MemoryAdapter, "documentCards"> & { documentCards?: undefined };
export declare function createMemoryAdapter(options?: MemoryAdapterOptions): MemoryAdapter;

/** Synthetic host state backed by the reference adapter's transaction snapshot. */
export interface MemoryHostHookTable {
  get(tx: import("@cairn-ink/core/ports").Tx, scope: import("@cairn-ink/core/ports").Scope, key: string): Promise<unknown>;
  put(tx: import("@cairn-ink/core/ports").Tx, scope: import("@cairn-ink/core/ports").Scope,
    key: string, value: unknown, indexed?: boolean): Promise<void>;
  stageSave(tx: import("@cairn-ink/core/ports").Tx, scope: import("@cairn-ink/core/ports").Scope,
    key: string, value: unknown): Promise<void>;
  inspect(scope: import("@cairn-ink/core/ports").Scope, key: string): Promise<unknown>;
}
