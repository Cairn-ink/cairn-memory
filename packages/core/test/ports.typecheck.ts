// Compile-only: proves the port types compose. Run with `npm run typecheck`.
import type { StorageAdapter, Tx, UnitOfWork, MemoryService, SuppressionFact } from "../src/index.mjs";

declare const adapter: StorageAdapter;
declare const service: MemoryService;

export async function forgetShape(id: string): Promise<number> {
  const uow: UnitOfWork = adapter.uow;
  return uow.run("u1", { pauseLock: true }, async (tx: Tx) => {
    const fact: SuppressionFact = { owner: "u1", actionId: id, origin: "forget", kind: "identity", memoryId: id };
    const { epoch } = await adapter.suppressions.writeFact(tx, fact, "incarnation-digest");
    const removed = await adapter.memories.erase(tx, { owner: "u1", namespace: null }, id);
    if (adapter.raw && adapter.sessionLineage) {
      const closure = await adapter.sessionLineage.provenClosure(tx, { owner: "u1", namespace: null }, [{ client: "c", sessionId: "s" }]);
      await adapter.raw.eraseSessions(tx, { owner: "u1", namespace: null }, closure);
    }
    return Number(epoch) + (removed ? 1 : 0);
  });
}

export async function recallShape() {
  const page = await service.recall({ owner: "u1", namespace: null }, "q", { limit: 10, cursor: null, mode: "plugin" });
  return page.items.map((m) => m.revision);
}

export async function exportShape() {
  const page = await service.exportMemories({ owner: "u1", namespace: null }, { cursor: null, limit: 100 });
  const ctx = await service.sessionStart({ owner: "u1", namespace: null }, { maxTokens: 2000, maxChars: 8000 });
  return page.items.length + ctx.groups.background.returned;
}

// @ts-expect-error eraseSessions accepts only a ProvenClosure, never a plain list.
export const plainListRejected = (tx: Tx) => adapter.raw!.eraseSessions(tx, { owner: "u1", namespace: null }, [{ client: "c", sessionId: "s" }]);
