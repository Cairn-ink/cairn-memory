import assert from "node:assert/strict";
import { test } from "node:test";
import { routeDocumentMessages } from "@cairn-ink/core/routing";

const message = (content, role = "user") => ({ id: "message", role, content, occurredAtMs: null });
const padded = (prefix, size) => prefix.padEnd(size + (prefix.match(/\r\n/g)?.length ?? 0), "x");
const reason = (content, role) => routeDocumentMessages([message(content, role)]).chosen[0]?.reason;

test("assistant and general length thresholds count UTF-16 before trimming", () => {
  assert.equal(reason("a".repeat(799), "assistant"), undefined);
  assert.equal(reason("a".repeat(799) + " ", "assistant"), "long_assistant");
  assert.equal(reason("a".repeat(799) + "\r\n", "assistant"), "long_assistant");
  assert.equal(reason("a".repeat(798) + "\r\n", "assistant"), undefined);
  assert.equal(reason("a".repeat(1_600), "assistant"), "long_assistant");
  assert.equal(reason("a".repeat(1_599)), undefined);
  assert.equal(reason("a".repeat(1_600)), "long_any");
  assert.equal(reason("😀".repeat(800)), "long_any");
});

test("weighted units count the specified CJK ranges after normalization", () => {
  assert.equal(reason("木".repeat(266) + "a", "assistant"), undefined);
  assert.equal(reason("木".repeat(266) + "aa", "assistant"), "long_assistant");
  assert.equal(reason("文".repeat(533)), undefined);
  assert.equal(reason("文".repeat(533) + "a"), "long_any");
  assert.equal(reason("ａ".repeat(267), "assistant"), undefined);
  assert.equal(reason("あ".repeat(267), "assistant"), "long_assistant");
  assert.equal(reason("𠀀".repeat(399), "assistant"), undefined);
});

for (const [kind, marker, insufficient] of [
  ["list", "- cedar\n* maple\n", "- cedar\n"],
  ["list", "Ｓｔｅｐ １: gather\r\n第２步 mix\r\n", "Step 1: gather\n"],
  ["list", "٢. gather\n٣. mix\n", "٢. gather\n"],
  ["table", "| cedar | tall |\n| maple | short |\n", "| cedar | tall |\n"],
  ["code", "```\nsample\n", "``\nsample\n"],
  ["code", "const cedar\nlet maple\nreturn ash\n", "const cedar\nreturn ash\n"],
  ["code", "  cedar();\n  maple();\n  ash();\n", "  cedar();\n  ash();\n"],
]) {
  test(`structure thresholds for ${JSON.stringify(marker)}`, () => {
    assert.equal(reason(padded(marker, 199)), undefined);
    assert.equal(reason(padded(marker, 200)), `structured:${kind}`);
    assert.equal(reason(padded(insufficient, 200)), undefined);
  });
}

test("combined structure reports markers in rule order before remember", () => {
  const list = "- cedar\n- maple\n";
  const table = "| cedar | tall |\n| maple | short |\n";
  const code = "```\n";
  assert.equal(reason(padded(list + table, 200)), "structured:list+table");
  assert.equal(reason(padded(list + code, 200)), "structured:list+code");
  assert.equal(reason(padded(table + code, 200)), "structured:table+code");
  assert.equal(reason(padded(list + table + code + "Remember this ", 200)), "structured:list+table+code");
});

test("remember requests require 200 unweighted units from a user", () => {
  assert.equal(reason(padded("Ｒｅｍｅｍｂｅｒ this ", 199)), undefined);
  assert.equal(reason(padded("Ｒｅｍｅｍｂｅｒ this ", 200)), "explicit");
  assert.equal(reason(padded("save THAT ", 200)), "explicit");
  assert.equal(reason(padded("keep this ", 200)), "explicit");
  assert.equal(reason(padded("幫我記 ", 200)), "explicit");
  assert.equal(reason(padded("remember this ", 200), "assistant"), undefined);
  assert.equal(reason(padded("remember  this ", 200)), undefined);
  assert.equal(reason(padded("remember that ", 1_600)), "long_any");
});

test("the capture cap prioritizes explicit and assistant choices with source-order ties", () => {
  const list = padded("- cedar\n- maple\n", 200);
  const result = routeDocumentMessages([
    message(list),
    message("a".repeat(800), "assistant"),
    message(padded("remember this ", 200)),
    message(list, "assistant"),
    message("short"),
    message(padded(list + "save that ", 200)),
    message("a".repeat(1_600)),
    message("a".repeat(800), "assistant"),
    message("small"),
  ]);
  assert.deepEqual(result, {
    chosen: [
      { position: 2, reason: "explicit" },
      { position: 5, reason: "structured:list" },
      { position: 1, reason: "long_assistant" },
      { position: 3, reason: "structured:list" },
    ],
    drops: { extract_only: 2, capture_limit: 3 },
  });
  assert.deepEqual(routeDocumentMessages([message(list), message("a".repeat(1_600))]).chosen, [
    { position: 0, reason: "structured:list" }, { position: 1, reason: "long_any" },
  ]);
});
