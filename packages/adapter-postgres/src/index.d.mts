import type { Tx, UnitOfWork } from "../../core/src/index.mjs";
import type { SourceRef } from "../../core/src/ports/common.d.ts";
import type { InsertRow } from "../../core/src/ports/memory-store.d.ts";
import type { SuppressionFact, TextDigest } from "../../core/src/suppression-fact.mjs";
import type { ConnectionSource, QueryResult } from "./driver.mjs";

export type { Connection, ConnectionSource, QueryResult } from "./driver.mjs";

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
/** Compute the slot of a fact already checked by core's validator. */
export function factSlot(fact: SuppressionFact): string;
