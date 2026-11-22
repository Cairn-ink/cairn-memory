import type { MemoryRow } from "../ports/common.d.ts";
import type { SessionContext } from "../ports/host.d.ts";

export function packSessionStart(
  recentItems: readonly MemoryRow[],
  opts: { maxTokens: number; maxChars: number; projectId?: string | null },
  countTokens: (serialized: string) => number,
): SessionContext;
