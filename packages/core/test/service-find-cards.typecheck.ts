import { createMemoryService, type MemoryServiceDeps } from "@cairn-ink/core/service";
import type { ItemRef, Scope, StorageAdapter, Tx } from "@cairn-ink/core/ports";
import type { DocumentCardFindItem, DocumentCardVisibilityInput } from "@cairn-ink/core/routing";

declare const deps: MemoryServiceDeps;
declare const scope: Scope;
declare const storage: StorageAdapter;
declare const tx: Tx;
declare const refs: readonly ItemRef[];
const service = createMemoryService(deps);

export async function findCards(): Promise<DocumentCardFindItem[]> {
  return (await service.find(scope, "query", { kinds: ["card"] })).cards;
}

export async function readCard(): Promise<[string, string | null, string[]] | null> {
  const result = await service.readCard(scope, "id");
  if (result.status === "not_found") return null;
  // @ts-expect-error The card read does not expose session IDs.
  result.card.sessionId;
  return [result.card.body, result.card.sourceClient, result.card.sourceMemoryIds];
}

export async function visibilityInputs(): Promise<Array<DocumentCardVisibilityInput | null> | undefined> {
  return storage.documentCards?.visibilityInputs?.(tx, scope, refs);
}
