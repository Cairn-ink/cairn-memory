import assert from "node:assert/strict";
import { test } from "node:test";
import { routeDocumentMessages } from "../src/routing/index.mjs";

test("an assistant message made long by a secret does not take a document slot", () => {
  const secret = `Guide\r\n-----BEGIN PRIVATE  KEY-----\r\n${"q".repeat(800)}\r\n-----END PRIVATE  KEY-----`;
  const contents = [secret, ...Array.from({ length: 4 }, (_, index) => `Guide ${index} `.padEnd(799, "w") + " ")];
  const messages = contents.map((content, index) => ({ id: String(index), role: "assistant", content }));
  assert.deepEqual(routeDocumentMessages(messages), {
    chosen: [1, 2, 3, 4].map(position => ({ position, reason: "long_assistant" })),
    drops: { extract_only: 1, capture_limit: 0 },
  });
});
