import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { DOCUMENT_CARD_CORRECTION_PRIVACY_CASE, runCase } from "@cairn-ink/conformance";

const privacy = DOCUMENT_CARD_CORRECTION_PRIVACY_CASE;
test(privacy.id + " " + privacy.title, async () => {
  const factory = {
    name: "memory document card correction privacy",
    async open({ capabilities }) {
      const adapter = createMemoryAdapter({ capabilities });
      assert.equal(adapter.capabilities.documentCardSearch, true);
      return { adapter, sessionRefs: "plain", harness: adapter.harness, embeddingDimensions: null, async close() {} };
    },
  };
  assert.equal(await runCase(factory, privacy), null);
});
