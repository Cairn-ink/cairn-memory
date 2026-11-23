import { documentCardVisible } from "@cairn-ink/core/routing";
import type { DocumentCardMemoryStates } from "@cairn-ink/core/routing";
import type { DocumentCardRecord } from "@cairn-ink/core/ports";

declare const record: DocumentCardRecord;
declare const memoryStates: DocumentCardMemoryStates;
const snapshot = { requestedScope: record.scope, memoryStates };

await documentCardVisible({ ...snapshot, card: { ...record, sourceMessage: null } });

const sourced = { ...record, canonicalSessionKey: "key" };
await documentCardVisible({ ...snapshot, card: sourced, sourceWithheld: false });
// @ts-expect-error A message-backed card requires a Raw verdict.
await documentCardVisible({ ...snapshot, card: sourced });
