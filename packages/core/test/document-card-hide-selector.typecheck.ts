import type { DocumentCardHideSelector } from "@cairn-ink/core/ports";

export function describeSelector(selector: DocumentCardHideSelector): string {
  if (selector.sourceMemoryId !== undefined) return selector.sourceMemoryId;
  if (selector.sourceMessage !== undefined) return selector.sourceMessage.messageId;
  if (selector.session !== undefined) return selector.session.sessionId;
  const exhaustive: never = selector;
  return exhaustive;
}
