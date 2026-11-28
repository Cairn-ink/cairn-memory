import type { Capabilities, ErrorCode, FactMatchPolicy, SuppressionFact } from "@cairn-ink/core";
import type { CaptureMessage, InspectItemEvidence, Receipt, Scope, StorageAdapter, StoredDocumentCardRecord } from "@cairn-ink/core/ports";

export type AdapterFactory = {
  name: string;
  /** Returning fewer capabilities than requested causes dependent cases to skip. */
  open(options: { capabilities: Partial<Capabilities> }): Promise<OpenedAdapter>;
};

export type OpenedAdapter = {
  adapter: Pick<StorageAdapter<StoredDocumentCardRecord>, "capabilities" | "uow" | "memories" | "capture" |
    "lexical" | "vector" | "fence" | "snapshot" | "hydrate" | "recent" | "supersession" | "conflicts" |
    "suppressions" | "pause" | "keys" | "placement" | "raw" | "sessionLineage" | "spanLineage" | "documentCards" | "rationale" |
    "rationaleSourceText" | "inspect">;
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

export type RationaleFixtureChange = "revision" | "content" | "currentness" | "receipt-remove" | "namespace";

export type RetainedDigestFixture = { keyId: string; label: string; secret: string };

export type TestHarness = {
  /** Use the core instance that supplies the adapter's CoreError when it differs from the kit's. */
  placePendingBatch?: typeof import("@cairn-ink/core").placePendingBatch;
  placePendingCardsBatch?: typeof import("@cairn-ink/core").placePendingCardsBatch;
  /** Seed inspect data on adapters without a public metadata mutation route. */
  markInspectHistorical?(scope: Scope, id: string): Promise<void>;
  seedInspectEvidence?(scope: Scope, id: string, evidence: Pick<InspectItemEvidence, "procedural" | "qualification">): Promise<void>;
  /** Synthetic raw text for a receipt. Null retires the source. */
  seedRationaleMessage?(scope: Scope, receipt: Receipt, text: string | null): Promise<void>;
  /** Exercise invalidating writes an adapter does not expose on its ordinary ports. */
  changeRationaleMemory?(scope: Scope, id: string, change: RationaleFixtureChange): Promise<void>;
  /** A JSON-safe snapshot. Numbers must be finite. */
  dump(): Promise<JsonValue>;
  seedFact(owner: string, fact: SuppressionFact): Promise<void>;
  setWriteTime(scope: Scope, id: string, updatedAtUs: bigint): Promise<void>;
  setFingerprintSecret?(secret: string): Promise<void>;
  /** Configures a synthetic raw HMAC-SHA256 signer for one owner. Null removes it. */
  setRetainedDigestFixture?(owner: string, fixture: RetainedDigestFixture | null): Promise<void>;
  /** Counts missing (row, live signing domain) pairs, including the enabled current domain. */
  rowsMissingKeyedDigest?(owner: string): Promise<number>;
  advanceClock?(ms: number): Promise<void>;
  /** Supply deterministic memory/topic IDs during a hosted projection fixture write. */
  withHostedTopicIds?<T>(ids: string[], work: () => Promise<T>): Promise<T>;
  /** The adapter rejects namespaced topic reads even with the default projection. */
  personalTopicsOnly?: boolean;
  /** The adapter rejects namespaced document-card operations. */
  personalDocumentCardsOnly?: boolean;
  /** Required for privacy matching cases under the hashed session profile. */
  hashSessionKey?: FactMatchPolicy["hashSessionKey"];
  /** Seeds a legacy raw message whose client provenance is missing. */
  seedClientlessRaw?(scope: Scope, sessionId: string, message: CaptureMessage): Promise<void>;
  counters(): Promise<Readonly<Record<string, number>>>;
  // TODO: Named-step fault injection.
  // TODO: Coverage control.
  // TODO: Log sink.
};
