import type {
  ContextAssemblyItem, ContextAssemblyRawExcerpt, ContextAssemblySource, ContextCompactRef,
  ContextLedgerDigestItem, MemoryService, ReadContextResult,
} from "@cairn-ink/core/ports";
import { createMemoryService, type KeylessMemoryServiceDeps } from "@cairn-ink/core/service";

type LegacyItem = (ContextAssemblyRawExcerpt & { layer: "Raw"; body: string }) | {
  ref: ContextCompactRef;
  rank: number;
  body: string;
  sources: readonly ContextAssemblySource[];
};

export function legacyItems(result: ReadContextResult): readonly LegacyItem[] {
  return result.assembly.items;
}

export function asAssemblyItem(item: LegacyItem | ContextLedgerDigestItem): ContextAssemblyItem {
  return item;
}

export function handleExistingItem({ ref }: ContextAssemblyItem): string {
  switch (ref.type) {
    case "memory": return ref.id;
    case "card": return ref.id + ":" + ref.bodyRev;
    case "raw": return ref.messageId;
    default: {
      const unreachable: never = ref;
      return unreachable;
    }
  }
}

type LegacyDeps = Omit<KeylessMemoryServiceDeps, "storage"> & {
  storage: Pick<KeylessMemoryServiceDeps["storage"], "capabilities" | "uow" | "fence" | "contextRead" | "inspect">;
};

export function existingRegistration(deps: LegacyDeps): NonNullable<MemoryService["readContext"]> {
  return createMemoryService(deps).readContext;
}
