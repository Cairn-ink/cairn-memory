import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDocumentCard, routeDocumentMessages } from "@cairn-ink/core/routing";

const session = { scope: { owner: "owner", namespace: null }, client: "client", canonicalSessionKey: "key" };
const message = (content, id = "message") => ({ id, role: "assistant", content });
const splitPair = "\uD83D \uDE00a";
const dropped = { card: null, drops: { ill_formed_text: 1 } };

for (const [label, suffix] of [
  ["lone high surrogate", "\uD83D"],
  ["lone low surrogate", "\uDE00"],
  ["split surrogate pair", splitPair],
  ["NUL", "\0"],
]) {
  const invalid = message("x".repeat(800) + suffix);

  test(`${label} drops the card`, async () => {
    assert.deepEqual(await buildDocumentCard(invalid, session), dropped);
  });

  test(`${label} leaves all routing slots available`, () => {
    const valid = Array.from({ length: 4 }, (_, index) => message("y".repeat(800), String(index)));
    assert.deepEqual(routeDocumentMessages([invalid, ...valid]), {
      chosen: [1, 2, 3, 4].map(position => ({ position, reason: "long_assistant" })),
      drops: { extract_only: 1, capture_limit: 0, ill_formed_text: 1 },
    });
  });
}

test("a valid emoji is routed and preserved in the document body", async () => {
  const input = message("x".repeat(798) + "😀");
  assert.deepEqual(routeDocumentMessages([input]).chosen, [{ position: 0, reason: "long_assistant" }]);
  const { card, drops } = await buildDocumentCard(input, session);
  assert.equal(card?.body, input.content);
  assert.deepEqual(drops, {});
});

test("the split-pair excerpt probe body yields no card", async () => {
  const input = message("z".repeat(360) + splitPair);
  assert.deepEqual(await buildDocumentCard(input, session), dropped);
});
