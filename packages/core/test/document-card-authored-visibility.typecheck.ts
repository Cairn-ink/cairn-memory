import { documentCardVisible } from "../src/routing/index.mjs";
import type { DocumentCardMemoryStates, DocumentCardVisibilityInput } from "../src/routing/index.mjs";
import type { DocumentCardRecord } from "../src/ports/index.d.ts";

interface HostVisibilityInput extends DocumentCardVisibilityInput {
  snapshotId: string;
}

declare const record: DocumentCardRecord;
declare const memoryStates: DocumentCardMemoryStates;
const snapshot = { requestedScope: record.scope, memoryStates };

const authored: HostVisibilityInput = {
  ...snapshot, snapshotId: "read", card: { ...record, origin: "manual", sourceMessage: null },
};
await documentCardVisible(authored);

const sourced = { ...record, canonicalSessionKey: "key" };
await documentCardVisible({ ...snapshot, card: sourced, sourceWithheld: false });
await documentCardVisible({ ...snapshot, card: sourced });

// @ts-expect-error Stored origin is immutable.
record.origin = "import";
