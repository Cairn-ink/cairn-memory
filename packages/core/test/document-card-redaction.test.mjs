import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDocumentCard } from "../src/routing/index.mjs";
import { coreRedactionMasks, redactCore } from "../src/privacy/redact.mjs";

const session = { scope: { owner: "owner", namespace: null }, client: "client", canonicalSessionKey: "key" };
const build = content => buildDocumentCard({ id: "message", role: "assistant", content }, session);
const flatten = text => text.replace(/\s+/gu, " ").trim();
const capture = text => redactCore(flatten(redactCore(text)));

async function safeBody(content) {
  const { card, drops } = await build(content);
  assert.ok(card);
  assert.deepEqual(drops, {});
  assert.equal(redactCore(card.body), card.body);
  assert.equal(redactCore(flatten(card.body)), flatten(card.body));
  return card.body;
}

test("line-kept masks preserve the outer PEM pair that capture sees after flattening", async () => {
  const content = [
    "Guide",
    "-----BEGIN PRIVATE  KEY-----",
    "-----BEGIN PRIVATE KEY-----",
    "-----END PRIVATE  KEY-----",
    "-----END PRIVATE KEY-----",
    "synthetic outer payload",
    "-----END PRIVATE  KEY-----",
    "  Keep this line.",
  ].join("\n");
  assert.equal(capture(content), "Guide [REDACTED] Keep this line.");
  assert.equal(await safeBody(content), "Guide\n[REDACTED]\n  Keep this line.");
});

test("card redaction covers payload exposed only on a repeat core pass", async () => {
  const payload = "toy-quoted-payload";
  const content = [
    "a".repeat(800),
    "-----BEGIN PRIVATE  KEY-----",
    '"refresh_token":"sample -----END PRIVATE  KEY----- -----BEGIN PRIVATE KEY-----',
    '"',
    `-----END PRIVATE KEY----- ${payload}"`,
  ].join("\n");
  const { card, drops } = await build(content);
  assert.deepEqual({
    firstPassLeavesPayload: coreRedactionMasks(content).every(([, end]) => end <= content.indexOf(payload)),
    coreLeavesPayload: redactCore(content).includes(payload),
    cardLeavesPayload: card?.body.includes(payload) ?? false,
  }, { firstPassLeavesPayload: true, coreLeavesPayload: false, cardLeavesPayload: false });
  assert.ok(card);
  assert.deepEqual(drops, {});
  assert.equal(redactCore(card.body), card.body);
  assert.equal(redactCore(flatten(card.body)), flatten(card.body));
});

test("each core credential pattern is masked in line-kept text", async () => {
  const patterns = [
    ["-----BEGIN TEST PRIVATE KEY-----\nsynthetic\n-----END TEST PRIVATE KEY-----", "[REDACTED]"],
    [`pk-${"q".repeat(16)}`, "[REDACTED]"],
    [`crn_pat_${"ac".repeat(17)}`, "[REDACTED]"],
    [`crn_pat_${"TOYVALUE".repeat(4)}`, "[REDACTED]"],
    [`crn_pat_${"bc".repeat(32)}`, "[REDACTED]"],
    [`ghp_${"q".repeat(20)}`, "[REDACTED]"],
    [`AKIA${"Z".repeat(16)}`, "[REDACTED]"],
    [`eyJ${"q".repeat(10)}.${"r".repeat(10)}.${"s".repeat(10)}`, "[REDACTED]"],
    ["Bearer\n\tToyValue1234", "[REDACTED]"],
    ['client_secret = "synthetic-value"', "client_secret = [REDACTED]"],
    ['"refresh_token":\n\t"synthetic value"', '"refresh_token":\n\t"[REDACTED]"'],
  ];
  for (const [input, masked] of patterns) {
    assert.equal(await safeBody(`Guide\n  ${input}   \n  Keep this line.`),
      `Guide\n  ${masked}\n  Keep this line.`);
  }
});

test("generated PEM interleavings mask every delimiter and payload line that capture masks", async () => {
  for (let order = 0; order < 64; order++) {
    const kinds = Array.from({ length: 6 }, (_, index) => order & (1 << index) ? "BEGIN" : "END");
    if (kinds.filter(kind => kind === "BEGIN").length !== 3) continue;
    for (let widths = 0; widths < 64; widths++) {
      const lines = kinds.flatMap((kind, index) => [
        `-----${kind} ${String.fromCharCode(65 + index)} PRIVATE${widths & (1 << index) ? "  " : " "}KEY-----`,
        `payload-slot-${index}`,
      ]);
      const content = ["Guide", ...lines, "  Keep this line."].join("\n");
      const captured = capture(content);
      // The PEM rule consumes whole lines in these inputs. Each delimiter and
      // payload line is unique, so capture's output identifies its retained spans.
      const expected = ["Guide"];
      let masked = false;
      for (const line of lines) {
        const removed = !captured.includes(flatten(line));
        if (!removed) expected.push(line);
        else if (!masked) expected.push("[REDACTED]");
        masked = removed;
      }
      expected.push("  Keep this line.");
      assert.equal(await safeBody(content), expected.join("\n"), JSON.stringify(lines));
    }
  }
});

test("normalization cannot hide positions masked in the original message", async () => {
  const content = [
    "Guide",
    "-----BEGIN PRIVATE KEY-----",
    "－－－－－ＥＮＤ ＰＲＩＶＡＴＥ ＫＥＹ－－－－－",
    "synthetic original payload",
    "-----END PRIVATE KEY-----",
  ].join("\n");
  assert.equal(capture(content), "Guide [REDACTED]");
  assert.equal(await safeBody(content), "Guide\n[REDACTED]");
});

test("a mask crossing a Unicode composition boundary counts a card drop", async () => {
  const content = `Guide\nsk-${"a".repeat(16)}\u0301`;
  assert.ok(capture(content).includes("[REDACTED]"));
  assert.deepEqual(await build(content), { card: null, drops: { unmappable_redaction: 1 } });
});
