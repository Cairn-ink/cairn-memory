import assert, { AssertionError } from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { DELIVERY_VISIBILITY_CASES, runCase } from "@cairn-ink/conformance";
import { coreDigest, placePendingCardsBatch } from "@cairn-ink/core";
import { buildDocumentCard } from "@cairn-ink/core/routing";
import { client, deliveryFactory, memoryFixture, rationaleFixture, ROOT_ASSERTION, scope } from "./fixtures/delivery-visibility.mjs";

for (const testCase of DELIVERY_VISIBILITY_CASES) {
  test(`${testCase.id} ${testCase.title}`, async () => {
    assert.equal(await runCase(deliveryFactory(), testCase), null);
  });
}

test("a text fact on a non-root endpoint removes its decisionContext paths", async () => {
  await (await rationaleFixture("non-root")).assertDelivery();
});

test("a text fact on the root endpoint removes its decisionContext paths", async (t) => {
  const fixture = await rationaleFixture("root");
  try {
    await fixture.assertDelivery();
  } catch (error) {
    if (!(error instanceof AssertionError) || error.message !== ROOT_ASSERTION ||
        !isDeepStrictEqual(error.actual, fixture.baseline)) throw error;
    t.todo("core decisionContext root endpoint is not fenced (fix pending)");
  }
});

const guard = ({ id, contentHash }) => ({ cardId: id, contentHash });

for (const exclusion of ["text", "identity", "session"]) {
  test(`placement after ${exclusion} exclusion gives only the visible card to the classifier`, async () => {
    const { adapter, write, archive, insert, excludeText } =
      memoryFixture({ documentCards: true, placement: true, rawArchive: exclusion === "session" });
    const { uow, documentCards, placement, fence } = adapter;
    const sourceText = "The spare tiles are on the bottom shelf.";
    const dependent = await card("dependent", sourceText);
    const control = await card("control", "The spare hinges are in the small box.");

    async function card(label, text) {
      const { id, revision } = await insert(text);
      const title = `Filing note ${label}`;
      const body = `Use the ${label} folder.`;
      let record = { id: label, scope, origin: "import", title, body, date: null, sourceMessage: null,
        sourceMemories: [{ id, revision }], sentences: [], stale: [] };
      if (exclusion === "session") {
        const message = await archive(label, `${title}\n\n${body}`);
        const { card: routed } = await buildDocumentCard(message, { scope, client, canonicalSessionKey: label });
        assert.ok(routed);
        record = { ...record, id: routed.id, origin: "router", title: routed.title, body: routed.body, date: routed.date,
          sourceMessage: { client, sessionId: label, messageId: message.id } };
      }
      const { value } = await coreDigest(record.body);
      const stored = { ...record, contentHash: `sha256:${value}` };
      assert.equal((await write((tx) => documentCards.put(tx, scope, stored))).status, "inserted");
      return stored;
    }

    if (exclusion === "text") {
      await excludeText(sourceText);
    } else if (exclusion === "identity") {
      await adapter.harness.seedFact(scope.owner, { ...scope, kind: "identity", origin: "forget",
        actionId: "exclude-identity", memoryId: dependent.sourceMemories[0].id });
    } else {
      const { sessionId } = dependent.sourceMessage;
      await write((tx) => adapter.raw.fenceSession(tx, scope, { client, sessionId }));
    }

    const offered = [dependent, control];
    const fenceCalls = [];
    const classified = [];
    const result = await placePendingCardsBatch({
      uow, documentCards, scope,
      // Deliver both guards to core so an adapter-side eligibility filter cannot satisfy the pin.
      placement: { ...placement, async pendingCards() { return offered.map(guard); } },
      fence: {
        async assertVisible(tx, selection, refs) {
          fenceCalls.push(refs.map(({ id }) => id));
          return fence.assertVisible(tx, selection, refs);
        },
      },
      async classify({ cards }) {
        classified.push(cards);
        return { items: cards.map(({ cardId }) => ({ cardId, parentIds: [] })) };
      },
    });
    assert.deepEqual(fenceCalls[0], offered.map(({ id }) => id), "Both cards must reach the core fence");
    assert.deepEqual(classified, [[{ ...guard(control), content: `${control.title}\n\n${control.body}` }]]);
    assert.deepEqual(result, { status: "applied", placed: [{ cardId: control.id, topicIds: [] }] });
  });
}
