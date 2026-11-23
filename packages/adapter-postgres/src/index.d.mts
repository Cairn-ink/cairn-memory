import type { Tx, UnitOfWork } from "../../core/src/index.mjs";
import type { SourceRef } from "../../core/src/ports/common.d.ts";
import type {
  HydrateItems, InsertRow, ListRecent, MemoryStore, PauseStore, ReadSnapshot,
  SupersessionStore, SuppressionStore, VisibilityFence,
} from "../../core/src/ports/index.d.ts";
import type { SuppressionFact, TextDigest } from "../../core/src/suppression-fact.mjs";
import type { ConnectionSource, QueryResult } from "./driver.mjs";

export type { Connection, ConnectionSource, QueryResult } from "./driver.mjs";
export { HOSTED_FINGERPRINT_LABELS } from "./fingerprint-labels.mjs";

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

export type Migration = MigrationBase & (
  | { concurrent: false }
  | { concurrent: true; index: { name: string; table: string; definition: string } }
);

export function applyMigrations(source: ConnectionSource, migrations: readonly Migration[]): Promise<void>;
export function canonicalDigests(digests: readonly TextDigest[]): TextDigest[];
/** Snapshot and validate a suppression fact before computing its storage slot. */
export function factSlot(fact: SuppressionFact): string;
export function createPostgresSuppressionStore(): Pick<SuppressionStore, "writeFact" | "epoch">;

export function createPostgresMemoryStore(options?: { nearDuplicate?: boolean; allowNonNullNamespace?: boolean }): MemoryStore;
export function createPostgresDigestGate(uow: UnitOfWork,
  keyIdsForOwner: (owner: string) => readonly string[] | Promise<readonly string[]>): (owner: string) => Promise<number>;
/** Append missing hosted-v1 MACs for one owner's existing rows. Returns the number updated. */
export function backfillPostgresHostedDigests(uow: UnitOfWork, owner: string, options: {
  keyId: string;
  redactionVersion: number;
  macForText: (text: string) => string | Promise<string>;
}): Promise<number>;
export function createPostgresMemoryReads(): {
  recent: ListRecent;
  snapshot: ReadSnapshot;
  hydrate: HydrateItems;
  fence: VisibilityFence;
};
export function createPostgresPauseStore(): PauseStore;
export function createPostgresSupersessionStore(options?: { allowNonNullNamespace?: boolean }): SupersessionStore;
