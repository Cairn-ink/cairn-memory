import type { CoreError, FactMatchPolicy, FingerprintKeyProvider, Tx, UnitOfWork } from "../../core/src/index.mjs";
import type { SourceRef } from "../../core/src/ports/common.d.ts";
import type {
  ConflictEdgeStore, HydrateItems, InsertRow, LexicalCandidates, ListRawMessages, ListRecent, MemoryStore,
  PauseStore, RawCandidates, ReadSnapshot, SupersessionStore, SuppressionStore, VectorCandidates, VisibilityFence,
} from "../../core/src/ports/index.d.ts";
import type { SuppressionFact, TextDigest } from "../../core/src/suppression-fact.mjs";
import type { ConnectionSource, QueryResult } from "./driver.mjs";

export type { Connection, ConnectionSource, QueryResult } from "./driver.mjs";
export { HOSTED_FINGERPRINT_LABELS } from "./fingerprint-labels.mjs";
export function createPostgresFingerprintKeyProvider(secret?: string | null, options?: {
  uow?: UnitOfWork;
  stagedSecrets?: readonly string[];
}): Required<FingerprintKeyProvider> & { publish(owner: string, keyId: string): Promise<void> };

export function createPostgresUnitOfWork(source: ConnectionSource): UnitOfWork;
export function query(tx: Tx, text: string, values?: unknown[]): Promise<QueryResult>;
export function requireEmbedding(row: InsertRow): NonNullable<InsertRow["embedding"]>;
type StoredSourceKind = Exclude<SourceRef["kind"], "capture">;
export function storedSourceKind(kind: SourceRef["kind"]): StoredSourceKind;
export function readSourceKind(kind: StoredSourceKind): SourceRef["kind"];

interface MigrationBase {
  id: string;
  sql: string;
}

/** Runs one read-only SELECT or WITH statement on the migration connection and returns its rows. */
export type MigrationQuery = (text: string, params?: unknown[]) => Promise<QueryResult["rows"]>;

export type Migration = MigrationBase & (
  | { concurrent: false; adopt?: (query: MigrationQuery) => Promise<boolean> }
  | { concurrent: true; index: { name: string; table: string; definition: string } }
);

export interface ApplyMigrationsOptions {
  /** Timeout in milliseconds for a concurrent index build and its inspection. Defaults to 30000. */
  concurrentStatementTimeoutMs?: number;
}

export type MigrationError = CoreError & { readonly migrationId: string };

/** Rejects with a MigrationError when an individual migration fails. */
export function applyMigrations(
  source: ConnectionSource,
  migrations: readonly Migration[],
  options?: ApplyMigrationsOptions,
): Promise<void>;
export function canonicalDigests(digests: readonly TextDigest[]): TextDigest[];
/** Snapshot and validate a suppression fact before computing its storage slot. */
export function factSlot(fact: SuppressionFact): string;
export type LegacySuppressionRow = {
  origin: "forget" | "correct" | "backfill" | "edit" | null;
  created_at_us: string;
} & (
  | { kind: "text"; text_hash: string; text_hmac: string | null; key_id: string | null;
      redaction_version: number; embedding: string; shingles: string[] | null }
  | { kind: "session"; client: string; session_id: string }
  | { kind: "window"; client: string | null; start_ms: number | string; end_ms: number | string }
);
/** Convert a legacy suppression projection into the same fact used by the live read union. */
export function legacySuppressionToFact(row: LegacySuppressionRow, owner: string): SuppressionFact;
/** Merge identical evidence at the latest cutoff and return the legacy row IDs for conflicting slots. */
export function legacySuppressionsToFacts(
  rows: readonly (LegacySuppressionRow & { id: string })[], owner: string,
): { facts: SuppressionFact[]; uncopyable: string[] };
type SessionHashOptions = Pick<FactMatchPolicy, "hashSessionKey">;
export function createPostgresSuppressionStore(
  options?: SessionHashOptions & Pick<FactMatchPolicy, "vectorSuppression"> & {
    sessionRefs?: "plain" | "hashed";
    allowNonNullNamespace?: boolean;
    lineageSecret?: string;
  },
): SuppressionStore;
export { createPostgresCapturePorts, type CaptureOptions } from "./capture.mjs";
export { createPostgresRawPorts } from "./raw.mjs";
export type { RawOptions } from "./raw-options.mjs";

export function createPostgresMemoryStore(
  options?: SessionHashOptions & { nearDuplicate?: boolean; allowNonNullNamespace?: boolean },
): MemoryStore;
export function createPostgresDigestGate(uow: UnitOfWork,
  keyIdsForOwner: (owner: string) => readonly string[] | Promise<readonly string[]>,
): (owner: string) => Promise<{ incompleteRows: number; missingPairs: number }>;
/** Append missing hosted-v1 MACs for one owner's existing rows. Returns the number updated. */
export function backfillPostgresHostedDigests(uow: UnitOfWork, owner: string, options: {
  keyId: string;
  redactionVersion: number;
  macForText: (text: string) => string | Promise<string>;
}): Promise<number>;
export type { RawReadOptions } from "./raw-visibility.mjs";
type MemoryReadOptions = SessionHashOptions & { allowNonNullNamespace?: boolean };
export function createPostgresMemoryCandidates(options?: MemoryReadOptions): { lexical: LexicalCandidates; vector: VectorCandidates };
export function createPostgresRawReads(options: import("./raw-visibility.mjs").RawReadOptions): RawCandidates & ListRawMessages;
export function createPostgresMemoryReads(options?: MemoryReadOptions | (MemoryReadOptions & import("./raw-visibility.mjs").RawReadOptions)): {
  recent: ListRecent;
  snapshot: ReadSnapshot;
  hydrate: HydrateItems;
  fence: VisibilityFence;
};
export function createPostgresPauseStore(): PauseStore;
export function createPostgresSupersessionStore(options?: SessionHashOptions & { allowNonNullNamespace?: boolean }): SupersessionStore;
export function createPostgresConflictEdgeStore(options?: SessionHashOptions & { allowNonNullNamespace?: boolean }): ConflictEdgeStore;
export { createPostgresQuantityLedgerStore } from "./quantity-ledger.mjs";
export { createPostgresTopicStore } from "./topics.mjs";
export { createPostgresHostWriteHookPort } from "./host-write-hooks.mjs";
export type { PostgresHostOperation } from "./host-write-hooks.mjs";
export { createPostgresDocumentCardStore } from "./document-cards.mjs";
export { createPostgresDocumentCardCandidates } from "./document-card-candidates.mjs";
export type { DocumentCardOptions } from "./document-card-visibility.mjs";
