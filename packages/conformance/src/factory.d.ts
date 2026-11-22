import type { Capabilities, ErrorCode, SuppressionFact } from "@cairn-ink/core";
import type { MemoryStore, Scope, UnitOfWork } from "@cairn-ink/core/ports";

export type AdapterFactory = {
  name: string;
  /** Returning fewer capabilities than requested causes dependent cases to skip. */
  open(options: { capabilities: Partial<Capabilities> }): Promise<OpenedAdapter>;
};

export type OpenedAdapter = {
  adapter: { capabilities: Capabilities; uow: UnitOfWork; memories: MemoryStore };
  harness: TestHarness;
  nativeErrorMap: Readonly<Record<string, ErrorCode>>;
  busyNativeCodes: readonly string[];
  embeddingDimensions: number | null;
  close(): Promise<void>;
};

export type TestHarness = {
  dump(): Promise<unknown>;
  seedFact(owner: string, fact: SuppressionFact): Promise<void>;
  setWriteTime(scope: Scope, id: string, updatedAtUs: bigint): Promise<void>;
  counters(): Promise<Readonly<Record<string, number>>>;
  // TODO: Named-step fault injection.
  // TODO: Coverage control.
  // TODO: Log sink.
};
