import type { HostWriteHookPort, Scope, Tx } from "../../core/src/ports/index.d.ts";
import type { QueryResult } from "./driver.mjs";
import type { RawReadOptions } from "./raw-visibility.mjs";

export type PostgresHostOperation = Readonly<{
  /** Static, trusted SQL for a scoped host operation. $1 is owner and $2 is the adapter's namespace key. */
  sql: string;
  mode: "read" | "write" | "indexed" | "finalizeSave";
}>;

export function createPostgresHostWriteHookPort(options: {
  /** Host-supplied async context with continuation semantics, such as AsyncLocalStorage. */
  context: HostWriteHookPort["context"];
  operations?: Readonly<Record<string, PostgresHostOperation>>;
  rawVisibility?: RawReadOptions;
}): HostWriteHookPort & Readonly<{
  execute(tx: Tx, scope: Scope, name: string, values?: readonly unknown[]): Promise<QueryResult>;
  /** Stage a bookkeeping operation for a keyed save. $3 is the committed index revision. */
  stageSave(tx: Tx, scope: Scope, name: string, values?: readonly unknown[]): Promise<void>;
  transactionIsolation(tx: Tx, scope: Scope): Promise<string>;
}>;

export function readHostReceipts(tx: Tx, scope: Scope, id: string): ReturnType<HostWriteHookPort["priorReceipts"]>;
