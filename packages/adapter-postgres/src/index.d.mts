import type { Tx, UnitOfWork } from "../../core/src/index.mjs";
import type { InsertRow } from "../../core/src/ports/memory-store.d.ts";
import type { ConnectionSource, QueryResult } from "./driver.mjs";

export type { Connection, ConnectionSource, QueryResult } from "./driver.mjs";

export function createPostgresUnitOfWork(source: ConnectionSource): UnitOfWork;
export function query(tx: Tx, text: string, values?: unknown[]): Promise<QueryResult>;
export function requireEmbedding(row: InsertRow): NonNullable<InsertRow["embedding"]>;

export interface Migration {
  id: string;
  sql: string;
  concurrent: boolean;
}

export function applyMigrations(source: ConnectionSource, migrations: readonly Migration[]): Promise<void>;
