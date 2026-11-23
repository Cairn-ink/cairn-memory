import type { Capability, ErrorCode } from "@cairn-ink/core";
import type { StorageAdapter } from "@cairn-ink/core/ports";
import type { TestHarness } from "@cairn-ink/conformance/factory";

export interface MemoryAdapterOptions {
  capabilities?: Partial<Record<Capability, boolean>>;
  newId?: () => string;
}

export type MemoryAdapter = Pick<StorageAdapter, "capabilities" | "uow" | "memories"> & {
  name: "memory";
  nativeErrorMap: Readonly<Record<string, ErrorCode>>;
  harness: TestHarness;
};

export declare function createMemoryAdapter(options?: MemoryAdapterOptions): MemoryAdapter;
