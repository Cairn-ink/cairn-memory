import type { Tx, UnitOfWork } from "../../core/src/index.mjs";
import type { ConnectionSource, QueryResult } from "./driver.mjs";

export type { Connection, ConnectionSource, QueryResult } from "./driver.mjs";
export { HOSTED_FINGERPRINT_LABELS } from "./fingerprint-labels.mjs";

export function createPostgresUnitOfWork(source: ConnectionSource): UnitOfWork;
export function query(tx: Tx, text: string, values?: unknown[]): Promise<QueryResult>;
