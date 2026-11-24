import type { MemoryService, Scope } from "@cairn-ink/core/ports";

export async function readItemId(svc: MemoryService, scope: Scope, ref: { type: "memory" | "card"; id: string }) {
  const result = await svc.read(scope, ref);
  if (result.status === "found") return result.item.id;
  return null;
}

export async function findWithoutCards(svc: MemoryService, scope: Scope) {
  const c: [] = (await svc.find(scope, "q", { kinds: ["memory"] })).cards;
  return c;
}
