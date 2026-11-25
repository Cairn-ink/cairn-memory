import type {
  ContextAssemblyItem, ContextAssemblyRawExcerpt, ContextAssemblySource, ContextAssemblyValue, ContextCompactRef,
  ContextLedgerDigest, MemoryService, ReadContextResult,
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

export function asAssemblyItem(item: LegacyItem): ContextAssemblyItem {
  return item;
}

export function oldAssembly(framing: string, items: readonly LegacyItem[]): ContextAssemblyValue {
  return { framing, items };
}

export function digestOf(result: ReadContextResult): ContextLedgerDigest | undefined {
  return result.assembly.ledgerDigest;
}

export function useAttribution(digest: ContextLedgerDigest): readonly ContextCompactRef[] {
  // @ts-expect-error A digest cannot be handled as an assembly item.
  handleExistingItem(digest);
  return digest.sources.map(source => source.memory);
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
