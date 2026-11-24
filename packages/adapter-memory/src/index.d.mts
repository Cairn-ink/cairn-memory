import type { Capability, ErrorCode, FactMatchPolicy, FingerprintLabels } from "@cairn-ink/core";
import type { StorageAdapter, StoredDocumentCardRecord } from "@cairn-ink/core/ports";
import type { TestHarness } from "@cairn-ink/conformance/factory";

export type { CaptureClaim, CaptureFinish, CaptureKey, CaptureMessage, ClaimResult, FinishItem, FinishResult,
  SourceFilter } from "@cairn-ink/core/ports";

export interface MemoryAdapterOptions {
  capabilities?: Partial<Record<Capability, boolean>>;
  receiptAttachAdvancesRevision?: boolean;
  proceduralTags?: boolean;
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
  "supersession" | "conflicts" | "documentCards" | "rationale" | "rationaleSourceText" | "inspect" |
  "proceduralTags"> & {
  readonly capture: CapturePorts & Required<Pick<CapturePorts, "admit" | "load" | "status">>;
  readonly contextRead?: import("@cairn-ink/core/ports").ContextReadStore;
  name: "memory";
  nativeErrorMap: Readonly<Record<string, ErrorCode>>;
  harness: TestHarness & Required<Pick<TestHarness, "setFingerprintSecret" | "rowsMissingKeyedDigest" | "advanceClock">> & {
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
