import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { DELIVERY_VISIBILITY_CASES, runCase } from "@cairn-ink/conformance";
import { deliveryFactory, ENDPOINT_ASSERTION, rationaleFixture } from "./fixtures/delivery-visibility.mjs";

const ignoresCardSources = deliveryFactory((options) => {
  const adapter = createMemoryAdapter(options);
  const { assertVisible } = adapter.fence;
  return {
    ...adapter,
    fence: {
      async assertVisible(tx, selection, refs) {
        const visible = await assertVisible(tx, selection, refs);
        const admitted = [];
        for (const ref of refs) {
          if (visible.some(({ type, id, namespace }) => type === ref.type && id === ref.id && namespace === ref.namespace)) {
            admitted.push(ref);
          } else if (ref.type === "card" && selection.namespaces.includes(ref.namespace) &&
              await adapter.documentCards.get(tx, { owner: selection.owner, namespace: ref.namespace }, ref.id)) {
            admitted.push(ref);
          }
        }
        return admitted;
      },
    },
  };
});

for (const id of ["T-DVIS-text", "T-DVIS-identity"]) {
  test(`${id} rejects a fence that ignores card source visibility`, async () => {
    const testCase = DELIVERY_VISIBILITY_CASES.find((entry) => entry.id === id);
    assert.ok(testCase);
    await assert.rejects(runCase(ignoresCardSources, testCase), { message: "Card fence visibility after exclusion" });
  });
}

test("the rationale delivery pin rejects skipped endpoint fencing", async () => {
  const fixture = await rationaleFixture("non-root", true);
  await assert.rejects(fixture.assertDelivery, {
    code: "ERR_ASSERTION", message: ENDPOINT_ASSERTION, actual: fixture.baseline,
  });
});
