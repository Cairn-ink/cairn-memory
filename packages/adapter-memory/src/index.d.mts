import type { Capability, ErrorCode, FactMatchPolicy, FingerprintLabels } from "@cairn-ink/core";
import type { StorageAdapter } from "@cairn-ink/core/ports";
import type { TestHarness } from "@cairn-ink/conformance/factory";

export interface MemoryAdapterOptions {
  capabilities?: Partial<Record<Capability, boolean>>;
  newId?: () => string;
  now?: () => number;
  sessionRefs?: "plain" | "hashed";
  hashSessionKey?: FactMatchPolicy["hashSessionKey"];
  fingerprint?: { secret: string; labels: FingerprintLabels } | null;
}

export type MemoryAdapter = Pick<StorageAdapter, "capabilities" | "uow" | "memories" |
  "lexical" | "vector" | "fence" | "snapshot" | "hydrate" | "recent" | "suppressions" | "pause" | "keys"> & {
  name: "memory";
  nativeErrorMap: Readonly<Record<string, ErrorCode>>;
  harness: TestHarness & Required<Pick<TestHarness, "setFingerprintSecret">>;
};

/** Public fixtures for the reference adapter's tests. Unsuitable for production. */
export declare const TEST_FINGERPRINT_SECRET: string;
export declare const TEST_FINGERPRINT_LABELS: FingerprintLabels;

export declare function createMemoryAdapter(options?: MemoryAdapterOptions): MemoryAdapter;
