import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { runCase } from "@cairn-ink/conformance";
import { HOSTED_TOPIC_CASES } from "@cairn-ink/conformance/topics-hosted";
import { withHostedTopicIds } from "../../conformance/test/hosted-topic-fixture.mjs";

const factory = {
  name: "memory hosted topics",
  async open({ capabilities }) {
    const adapter = createMemoryAdapter({ capabilities, now: () => 1 });
    return {
      adapter, sessionRefs: "plain", harness: { ...adapter.harness, withHostedTopicIds },
      nativeErrorMap: adapter.nativeErrorMap, busyNativeCodes: [], embeddingDimensions: null,
      async close() {},
    };
  },
};

for (const testCase of HOSTED_TOPIC_CASES) {
  test(`${testCase.id} ${testCase.title}`, async () => {
    assert.equal(await runCase(factory, testCase), null);
  });
}
