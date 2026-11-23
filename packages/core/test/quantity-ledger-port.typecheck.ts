import { capabilities, FORGET_STEP_CAPABILITIES, OPTIONAL_PORTS } from "@cairn-ink/core";
import type { QuantityLedgerRow, QuantityLedgerStore, Scope, StorageAdapter, Tx } from "@cairn-ink/core/ports";
import { digest, ledgerDropSelector, ledgerRowDeliverable, parseWindow, readIntent, reconcileLedgerQuantities, validateQuantities } from "@cairn-ink/core/ledger";
import type { LedgerReadState, QuantityLedgerDropSelector, QuantityLedgerRow as LedgerRow } from "@cairn-ink/core/ledger";

declare const adapter: StorageAdapter;
declare const scope: Scope;
declare const tx: Tx;
declare const state: LedgerReadState;
declare const data: unknown;

const store: QuantityLedgerStore | undefined = adapter.quantityLedger;
const flag: "quantityLedger" = OPTIONAL_PORTS.quantityLedger;
const gate: typeof flag = FORGET_STEP_CAPABILITIES["dependents.invalidate"][5];

if (capabilities({ [gate]: true }).quantityLedger && store) {
  const { quantities } = validateQuantities(data, 1);
  const existingRows = await store.listForMemory(tx, scope, "memory");
  const rows: LedgerRow[] = reconcileLedgerQuantities({
    memoryId: "memory", textHash: "hash", captureTimeMs: 0, quantities, existingRows,
    citedReceipts: [{ role: "user", content: "Tea cost 6 USD.", messageId: "message", receiptId: "receipt", occurredAtMs: 0 }],
  });
  const row: QuantityLedgerRow = rows[0];
  const { inserted }: { inserted: number } = await store.put(tx, scope, [row]);
  const window = parseWindow("How much for tea?", 0);
  const terms: string[] = await store.terms(tx, scope);
  if (inserted && readIntent("How much for tea?", terms)) {
    const visible = (await store.list(tx, scope, window)).filter(candidate => ledgerRowDeliverable(candidate, state));
    digest(visible, [], window);
  }

  for (const selector of [
    { by: "memoryId", id: row.memoryId }, { by: "receiptId", id: row.receiptId },
  ] satisfies QuantityLedgerDropSelector[]) {
    const by: "memoryId" | "receiptId" = ledgerDropSelector(selector);
    void by;
    const { dropped }: { dropped: number } = await store.dropWhere(tx, scope, selector);
    if (dropped) break;
  }
  // @ts-expect-error the selectors are exclusive
  await store.dropWhere(tx, scope, { memoryId: row.memoryId, receiptId: row.receiptId });
  // @ts-expect-error an undefined memoryId still cannot accompany a receiptId
  await store.dropWhere(tx, scope, { memoryId: undefined, receiptId: row.receiptId });
  // @ts-expect-error the list range uses integer milliseconds
  await store.list(tx, scope, { fromMs: "2026-01-01", toMs: 0 });
  // @ts-expect-error rows carry no memory revision
  await store.put(tx, scope, [{ ...row, revision: 1 }]);
}
