import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { DELIVERY_VISIBILITY_CASES, runCase } from "@cairn-ink/conformance";
import { assertPlacementDelivery, deliveryFactory, ENDPOINT_ASSERTION, rationaleFixture } from "./fixtures/delivery-visibility.mjs";

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

async function linkedSessionMutant() {
  const entry = new URL("../src/index.mjs?ignore-linked-session-facts", import.meta.url);
  const retrieval = new URL("./retrieval.mjs?ignore-linked-session-facts", entry);
  const source = readFileSync(retrieval, "utf8");
  const match = 'else if (policy.hides(entry)) memoryStates.set(id, { status: "suppressed" });';
  assert.equal(source.split(match).length, 2, "Expected one linked memory visibility predicate");
  // Leave the ordinary memory fence and the card's own Raw source policy intact.
  const withoutSessions = 'matchFacts(new Map([...state.facts].filter(([, { fact }]) => fact.kind !== "session")), scope)';
  const mutated = source.replace(match, match.replace("policy", withoutSessions));
  const hooks = registerHooks({
    resolve(request, context, nextResolve) {
      return nextResolve(context.parentURL === entry.href && request === "./retrieval.mjs" ? retrieval.href : request, context);
    },
    load(url, context, nextLoad) {
      return url === retrieval.href ? { format: "module", source: mutated, shortCircuit: true } : nextLoad(url, context);
    },
  });
  try {
    const { createMemoryAdapter: createMutant } = await import(entry.href);
    return createMutant;
  } finally {
    hooks.deregister();
  }
}

test("both linked-session pins reject ignoring session facts for linked memories", async () => {
  const createMutant = await linkedSessionMutant();
  const testCase = DELIVERY_VISIBILITY_CASES.find(({ id }) => id === "T-DVIS-linked-session");
  assert.ok(testCase);
  await assert.rejects(runCase(deliveryFactory(createMutant), testCase), { message: "Card fence visibility after exclusion" });
  await assert.rejects(assertPlacementDelivery("linked-session", createMutant), {
    code: "ERR_ASSERTION", message: /^Only the visible card must reach the classifier/u,
  });
});
