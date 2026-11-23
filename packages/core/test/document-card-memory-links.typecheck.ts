import { documentCardMemoryLinks } from "@cairn-ink/core/routing";
import type { DocumentCardRecord, DocumentCardStore, Receipt, Revision, Scope, Tx } from "@cairn-ink/core/ports";

declare const store: DocumentCardStore;
declare const tx: Tx;
declare const scope: Scope;
declare const card: DocumentCardRecord;
declare const memories: ReadonlyArray<{ id: string; revision: Revision; receipts: readonly Receipt[] }>;

const links: { id: string; revision: Revision }[] = documentCardMemoryLinks(card.sourceMessage, memories);
const outcome: Promise<{ status: "linked" | "unchanged" | "tombstoned" | "not_found" }> =
  store.linkMemories(tx, scope, card.id, links);
await outcome;
await store.linkMemories(tx, scope, card.id, card.sourceMemories);

// @ts-expect-error a link requires an integer revision token
await store.linkMemories(tx, scope, card.id, [{ id: "memory", revision: "1" }]);
// @ts-expect-error link matching requires the plain session id
documentCardMemoryLinks({ client: "client", canonicalSessionKey: "key", messageId: "message" }, memories);
