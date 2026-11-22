import type { MemoryRow } from "../ports/common.d.ts";
import type { SessionContext } from "../ports/host.d.ts";

type SessionStartProjection = {
  item(row: MemoryRow): unknown;
  /** Project the complete context, including its items and group flags. */
  context(context: SessionContext): unknown;
};

/**
 * Hosts serving the hosted wire must supply its projection for both budget checks.
 * Both callbacks return JSON-serializable wire values.
 * With no projection the budget uses the core shape, with bigint fields encoded as decimal strings.
 * Returns the packed core context.
 */
export function packSessionStart(
  recentItems: readonly MemoryRow[],
  opts: { maxTokens: number; maxChars: number; projectId?: string | null; project?: SessionStartProjection },
  countTokens: (serialized: string) => number,
): SessionContext;
