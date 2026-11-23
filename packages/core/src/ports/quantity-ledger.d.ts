import type { Scope } from "./common.d.ts";
import type { Tx } from "./unit-of-work.d.ts";

export type QuantityGroup =
  | "food" | "transport" | "housing" | "shopping" | "bills" | "health"
  | "fitness" | "entertainment" | "work" | "other";
export type QuantityPeriod = "day" | "week" | "month" | "year";
export type QuantityComparator = "at_most" | "at_least";

export type Quantity = {
  measure: string;
  value: number;
  unit: string;
  group: QuantityGroup;
  category: string;
} & (
  | { kind: "record"; period: "none"; comparator: "none" }
  | { kind: "goal"; period: QuantityPeriod; comparator: QuantityComparator }
);

export type QuantityLedgerRow = Quantity & {
  memoryId: string;
  /** The memory's core text hash at the time this row was written. */
  textHash: string;
  /** Canonical retained receipt for this memory. */
  receiptId: string;
  /** Event time in integer milliseconds since the epoch. */
  date: number;
  ordinal: number;
};

export interface QuantityLedgerRange {
  fromMs: number;
  toMs: number;
}

export type QuantityLedgerDropSelector =
  | { by: "memoryId"; id: string }
  | { by: "receiptId"; id: string };

/**
 * Optional (capability quantityLedger). Every call uses the live Tx from UnitOfWork.
 * Each put or dropWhere that changes at least one row advances the owner index revision once.
 */
export interface QuantityLedgerStore {
  /**
   * Runs in the capture finish transaction. Within a scoped memory, rows are idempotent
   * on (receiptId, measure, category, value, unit, period, comparator, ordinal).
   * A replay leaves the original row intact. Rows have no revision binding.
   */
  put(tx: Tx, scope: Scope, rows: readonly QuantityLedgerRow[]): Promise<{ inserted: number }>;
  /** Adapters must validate the selector with ledgerDropSelector from @cairn-ink/core/ledger. */
  dropWhere(tx: Tx, scope: Scope, selector: QuantityLedgerDropSelector): Promise<{ dropped: number }>;
  /** Read existing rows in the capture finish transaction without advancing the index revision. */
  listForMemory(tx: Tx, scope: Scope, memoryId: string): Promise<QuantityLedgerRow[]>;
  /** Read snapshot, integer-ms half-open [fromMs, toMs) over the row's date. */
  list(tx: Tx, scope: Scope, range: QuantityLedgerRange): Promise<QuantityLedgerRow[]>;
  /** Distinct measure, category and group terms from rows whose memory is current in the read snapshot. */
  terms(tx: Tx, scope: Scope): Promise<string[]>;
}
