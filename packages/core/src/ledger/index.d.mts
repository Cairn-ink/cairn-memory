import type { Role } from '../ports/common.d.ts';
import type { Quantity, QuantityLedgerRange, QuantityLedgerRow } from '../ports/quantity-ledger.d.ts';

export type * from '../ports/quantity-ledger.d.ts';

export type ExtractedQuantity = Quantity & { item: number };
export interface QuantityValidation {
  quantities: ExtractedQuantity[];
  dropped: { invalid_extraction_quantity: number };
}

export interface LedgerReceipt {
  receiptId: string;
  messageId: string;
  role: Role;
  content: string;
  occurredAtMs: number | null;
}

export type LedgerMemoryState = 'current_visible' | 'hidden' | 'forgotten' | 'superseded' | 'unknown';
export interface LedgerReadState {
  /** A positive current-and-visible result from the final visibility check. */
  memoryStates: ReadonlyMap<string, LedgerMemoryState> | null;
  /** Retained canonical receipt IDs per memory from the same scoped snapshot. */
  retainedReceipts: ReadonlyMap<string, ReadonlySet<string>> | null;
}

export interface LedgerWindow extends QuantityLedgerRange {
  label: string;
}

export interface LedgerDigest {
  body: string;
  sources: string[];
}

export function validateQuantities(value: unknown, itemCount: number): QuantityValidation;
/** Attribute the quantities of one admitted item using its cited canonical receipts. */
export function attributeLedgerQuantities(memoryId: string, quantities: readonly ExtractedQuantity[],
  receipts: readonly LedgerReceipt[], captureTimeMs: number): QuantityLedgerRow[];
/** Key within one scope. Preserve the first row for a replay. */
export function ledgerRowKey(row: QuantityLedgerRow): string;
export function ledgerRowDeliverable(row: QuantityLedgerRow, state: LedgerReadState): boolean;
export function ledgerRowInRange(row: Pick<QuantityLedgerRow, 'date'>, range: QuantityLedgerRange): boolean;
export function readIntent(query: string, terms: readonly string[]): boolean;
export function parseWindow(query: string, asOfMs: number): LedgerWindow;
/** Pass only rows that have passed the delivery check. */
export function digest(rows: readonly QuantityLedgerRow[], goals: readonly QuantityLedgerRow[], window: LedgerWindow): LedgerDigest | null;
