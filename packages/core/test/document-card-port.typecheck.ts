import { capabilities, OPTIONAL_PORTS } from "@cairn-ink/core";
import type { DocumentCardHideSelector, DocumentCardRecord, DocumentCardStore, Scope, StorageAdapter, Tx } from "@cairn-ink/core/ports";
import { documentCardStaleness, documentCardVisible, resolveStaleReplacement } from "@cairn-ink/core/routing";
import type { DocumentCardMemoryStates } from "@cairn-ink/core/routing";

declare const adapter: StorageAdapter;
declare const tx: Tx;
declare const scope: Scope;
declare const record: DocumentCardRecord;
declare const memoryStates: DocumentCardMemoryStates;

const store: DocumentCardStore | undefined = adapter.documentCards;
const flag: "documentCards" = OPTIONAL_PORTS.documentCards;
const enabled: boolean = capabilities({ [flag]: true }).documentCards;

if (enabled && store) {
  const { status } = await store.put(tx, scope, record, { model: "model", vector: new Float32Array([1]) });
  const outcome: "inserted" | "unchanged" | "replaced" | "tombstoned" = status;
  if (outcome === "tombstoned") await store.hide(tx, scope, record.id, "forget");
  await store.put(tx, scope, record);
  for (const selector of [
    { sourceMemoryId: "memory" },
    { sourceMessage: record.sourceMessage },
    { session: { client: "client", sessionId: "session" } },
  ] satisfies DocumentCardHideSelector[]) {
    await store.hideWhere(tx, scope, selector, "forget");
  }
  // @ts-expect-error a selector cannot combine source kinds
  await store.hideWhere(tx, scope, { sourceMemoryId: "memory", sourceMessage: record.sourceMessage }, "forget");
  // @ts-expect-error the port uses plain session IDs
  await store.hideWhere(tx, scope, { session: { client: "client", sessionKeyHash: "hash" } }, "forget");
  // @ts-expect-error stale entries store IDs only
  await store.markStale(tx, scope, record.id, { memoryId: "memory", replacementMemoryId: "next", content: "old text" });
  await store.markStale(tx, scope, record.id, { memoryId: "memory", replacementMemoryId: "next" });
  const cards: DocumentCardRecord[] = await store.list(tx, scope);
  const card = await store.get(tx, scope, cards[0]?.id ?? record.id);
  if (card) {
    const verdict = await documentCardVisible({
      card: { ...card, canonicalSessionKey: "canonical" }, requestedScope: scope, memoryStates, sourceWithheld: false,
    });
    if (verdict.visible && documentCardStaleness({ card, memoryStates })) {
      resolveStaleReplacement({ replacementMemoryId: card.stale[0]?.replacementMemoryId ?? null, memoryStates, successorOf: new Map() });
    }
  }
}
