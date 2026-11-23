import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDocumentCard, routeDocumentMessages } from "@cairn-ink/core/routing";

const session = { scope: { owner: "owner", namespace: null }, client: "client", canonicalSessionKey: "key" };
const message = (content, id = "message") => ({ id, role: "assistant", content });
const keys = Array.from({ length: 20 }, (_, index) => `- sk-${"q".repeat(16)}${index}`).join("\n");

for (const [label, content] of [
  ["a list of synthetic keys", keys],
  ["a single PEM block", "-----BEGIN TEST PRIVATE KEY-----\nsynthetic\n-----END TEST PRIVATE KEY-----"],
  ["markers with bullets and punctuation", Array(20).fill("• ([REDACTED]); [REDACTED]!").join("\n")],
]) {
  test(`${label} is extract-only and takes no card slot`, async () => {
    const input = message(content);
    const eligible = Array.from({ length: 4 }, (_, index) => message("a".repeat(800), String(index)));
    assert.deepEqual(routeDocumentMessages([input, ...eligible]), {
      chosen: [1, 2, 3, 4].map(position => ({ position, reason: "long_assistant" })),
      drops: { extract_only: 1, capture_limit: 0, marker_only: 1 },
    });
    assert.deepEqual(await buildDocumentCard(input, session), { card: null, drops: { marker_only: 1 } });
  });
}

for (const content of ["園藝", "٢"]) {
  test(`the list still routes with ${content} outside the markers`, async () => {
    const input = message(`${content}\n${keys}`);
    assert.deepEqual(routeDocumentMessages([input]), {
      chosen: [{ position: 0, reason: "structured:list" }],
      drops: { extract_only: 0, capture_limit: 0 },
    });
    const { card, drops } = await buildDocumentCard(input, session);
    assert.equal(card?.body, `${content}\n${Array(20).fill("- [REDACTED]").join("\n")}`);
    assert.deepEqual(drops, {});
  });
}
