import type { Role, Scope } from '../ports/common.d.ts';
import type { Quantity, QuantityLedgerDropSelector, QuantityLedgerRange, QuantityLedgerRow, QuantityLedgerStore, QuantityPeriod } from '../ports/quantity-ledger.d.ts';
import type { Tx } from '../ports/unit-of-work.d.ts';

export type * from '../ports/quantity-ledger.d.ts';

export type ExtractedQuantity = Quantity & { item: number };
/** A record awaiting the capture occasion check. Ledger helpers accept dated records with period `none`. */
export type PeriodTaggedRecord = Omit<Extract<ExtractedQuantity, { kind: 'record' }>, 'period'> & { period: QuantityPeriod };
export interface QuantityValidationOptions {
  /** Capture-only opt-in. Retains record period tags for the occasion check. Default validation drops these records. */
  datedRecords?: boolean;
}
export interface QuantityValidation<Q = ExtractedQuantity> {
  quantities: Q[];
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
  /** Current core text hashes from the same scoped snapshot. */
  memoryTextHashes: ReadonlyMap<string, string> | null;
}

export type LedgerRowAttribution = Quantity & Pick<QuantityLedgerRow, 'memoryId' | 'receiptId' | 'date' | 'ordinal'>;

export interface LedgerCapture {
  memoryId: string;
  textHash: string;
  captureTimeMs: number;
  quantities: readonly ExtractedQuantity[];
  citedReceipts: readonly LedgerReceipt[];
}

export interface LedgerReconciliation extends LedgerCapture {
  existingRows: readonly QuantityLedgerRow[];
}

export interface LedgerWindow extends QuantityLedgerRange {
  label: string;
}

export interface ParsedLedgerWindow extends LedgerWindow {
  /** The optional calendar reading shares the rolling window's exclusive end. */
  readonly calendar?: LedgerWindow;
}

export interface LedgerDigest {
  body: string;
  sources: string[];
}

export function validateQuantities(value: unknown, itemCount: number, options?: { datedRecords?: false }): QuantityValidation;
export function validateQuantities(value: unknown, itemCount: number, options: QuantityValidationOptions):
  QuantityValidation<ExtractedQuantity | PeriodTaggedRecord>;
/** Attribute a batch without a store snapshot. Use reconciliation for capture writes. */
export function attributeLedgerQuantities(memoryId: string, quantities: readonly ExtractedQuantity[],
  receipts: readonly LedgerReceipt[], captureTimeMs: number): LedgerRowAttribution[];
/** Return only additional rows. Capture supplies normalized record values keyed by cited message ID. */
export function reconcileLedgerQuantities(capture: LedgerReconciliation,
  recordValues?: ReadonlyMap<string, ReadonlySet<number>>): QuantityLedgerRow[];
/** Run inside the same live unit of work as the memory and receipt writes. */
export function writeLedgerQuantities(tx: Tx, scope: Scope, store: QuantityLedgerStore, capture: LedgerCapture):
  Promise<{ inserted: number }>;
/** Return the sole validated lookup key, or throw invalid_input. Adapters must use this for dropWhere. */
export function ledgerDropSelector(selector: unknown): QuantityLedgerDropSelector['by'];
/** Key within one scope. Preserve the first row for a replay. */
export function ledgerRowKey(row: LedgerRowAttribution): string;
export function ledgerRowDeliverable(row: QuantityLedgerRow, state: LedgerReadState): boolean;
export function ledgerRowInRange(row: Pick<QuantityLedgerRow, 'date'>, range: QuantityLedgerRange): boolean;
export function readIntent(query: string, terms: readonly string[]): boolean;
export function parseWindow(query: string, asOfMs: number): ParsedLedgerWindow;
/** Pass only rows that have passed the delivery check. */
export function digest(rows: readonly QuantityLedgerRow[], goals: readonly QuantityLedgerRow[], window: ParsedLedgerWindow, calendarReading?: boolean): LedgerDigest | null;
