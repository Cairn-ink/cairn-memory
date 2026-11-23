import type { Capability, ErrorCode, FingerprintLabels } from "@cairn-ink/core";
import type { StorageAdapter } from "@cairn-ink/core/ports";
import type { TestHarness } from "@cairn-ink/conformance/factory";

export type { CaptureClaim, CaptureFinish, CaptureKey, CaptureMessage, ClaimResult, FinishItem, FinishResult,
  SourceFilter } from "@cairn-ink/core/ports";

export interface MemoryAdapterOptions {
  capabilities?: Partial<Record<Capability, boolean>>;
  newId?: () => string;
  now?: () => number;
  sessionRefs?: "plain" | "hashed";
  fingerprint?: { secret: string; labels: FingerprintLabels } | null;
}

export type MemoryAdapter = Pick<StorageAdapter, "capabilities" | "uow" | "memories" | "capture" |
  "lexical" | "vector" | "fence" | "snapshot" | "hydrate" | "recent" | "suppressions" | "pause" | "keys"> & {
  name: "memory";
  nativeErrorMap: Readonly<Record<string, ErrorCode>>;
  harness: TestHarness & Required<Pick<TestHarness, "setFingerprintSecret" | "advanceClock">>;
};

/** Public fixtures for the reference adapter's tests. Unsuitable for production. */
export declare const TEST_FINGERPRINT_SECRET: string;
export declare const TEST_FINGERPRINT_LABELS: FingerprintLabels;

export declare function createMemoryAdapter(options?: MemoryAdapterOptions): MemoryAdapter;
