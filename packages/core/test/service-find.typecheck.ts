import { createMemoryService, type MemoryServiceDeps } from "@cairn-ink/core/service";
import type { Layer, MemoryRow, Receipt, RetrievalScope, Scope } from "@cairn-ink/core/ports";

declare const deps: MemoryServiceDeps;
declare const scope: Scope;
const service = createMemoryService(deps);
export const readSet: RetrievalScope = { owner: scope.owner, namespaces: [scope.namespace], window: { untilMs: 20 } };

export async function findShape(): Promise<[MemoryRow[], [], [], Layer, Layer, Layer]> {
  const { memories, cards, raw, layers } = await service.find(scope, null, {
    limit: 8, kinds: ["memory", "card", "raw"], clients: ["client"], sinceMs: 10, untilMs: 20,
  });
  return [memories, cards, raw, layers.memory, layers.card, layers.raw];
}

export async function readShape(): Promise<[MemoryRow, Receipt[], number | null] | null> {
  const result = await service.read(scope, { type: "memory", id: "id" });
  if (result.status === "not_found") return null;
  return [result.item, result.receipts, result.sourceDates?.firstMs ?? null];
}

// @ts-expect-error find has no cursor option.
export const cursorRejected = () => service.find(scope, "query", { cursor: null });
// @ts-expect-error read has no raw ref.
export const rawRefRejected = () => service.read(scope, { type: "raw", id: "id" });
