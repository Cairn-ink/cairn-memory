import type { Capabilities, ErrorCode, SuppressionFact } from "@cairn-ink/core";
import type { Scope, StorageAdapter } from "@cairn-ink/core/ports";

export type AdapterFactory = {
  name: string;
  /** Returning fewer capabilities than requested causes dependent cases to skip. */
  open(options: { capabilities: Partial<Capabilities> }): Promise<OpenedAdapter>;
};

export type OpenedAdapter = {
  adapter: Pick<StorageAdapter, "capabilities" | "uow" | "memories" |
    "lexical" | "vector" | "fence" | "snapshot" | "hydrate" | "recent" | "supersession" |
    "suppressions" | "pause" | "keys" | "placement">;
  sessionRefs: "plain" | "hashed";
  harness: TestHarness;
  nativeErrorMap: Readonly<Record<string, ErrorCode>>;
  busyNativeCodes: readonly string[];
  embeddingDimensions: number | null;
  /** Time in milliseconds for a started run to reach its lock waits (default 100). Raise it for stores with slow transaction start. */
  settleMs?: number;
  /** Bound in milliseconds for one concurrency phase, excluding settle waits (default 5000). Raise it for slow stores. */
  timeoutMs?: number;
  close(): Promise<void>;
};

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export type TestHarness = {
  /** A JSON-safe snapshot. Numbers must be finite. */
  dump(): Promise<JsonValue>;
  seedFact(owner: string, fact: SuppressionFact): Promise<void>;
  setWriteTime(scope: Scope, id: string, updatedAtUs: bigint): Promise<void>;
  setFingerprintSecret?(secret: string): Promise<void>;
  counters(): Promise<Readonly<Record<string, number>>>;
  // TODO: Named-step fault injection.
  // TODO: Coverage control.
  // TODO: Log sink.
};
