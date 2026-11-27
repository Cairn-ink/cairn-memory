import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture, format, input, readSet, tokenCount } from "./helpers/context-read-compact.mjs";

test("compact explicitly accepts current memories alone with Raw off", async () => {
  const { read, lexicalDepths } = fixture([]);
  for (const policy of ["rank-first-whole-v1", "coverage-first-v1", "rank-first-first-source-v1"]) {
    const result = await read({ policy: { id: policy } });
    assert.equal(result.diagnostics.representation, input.representation);
    assert.deepEqual(result.diagnostics.budget, { maxItems: 64, maxTokens: 6000, used: tokenCount(format(result.assembly)) });
    assert.deepEqual(result.assembly.items, []);
  }
  const limited = await read({ budget: { maxItems: 1, maxTokens: 64 } });
  assert.equal(limited.diagnostics.budget.maxItems, 1);
  assert.equal(limited.diagnostics.budget.maxTokens, 64);
  assert.deepEqual(lexicalDepths, Array(4).fill(64));
});

test("compact refuses invalid types, Raw, sources, budgets and cursors before searching", async () => {
  const { read, service, lexicalDepths } = fixture([]);
  const { raw: _raw, ...omittedRaw } = input;
  await assert.rejects(service.readContext(readSet, omittedRaw), { code: "invalid_input" });
  const refused = [
    { intent: "history" }, { intent: undefined }, { intent: "unknown" },
    { raw: true }, { raw: null }, { raw: "false" },
    { types: ["card"] }, { types: ["memory", "card"] }, { types: ["memory", "memory"] },
    { types: "memory" }, { types: [] }, { types: [null] },
    { representation: null }, { representation: ["memory-compact-v1"] }, { representation: "unknown" },
    { sources: ["relations-one-hop-v1"] }, { sources: [] }, { sources: null },
    { budget: null }, { budget: { maxItems: 65 } }, { budget: { maxItems: 0 } },
    { budget: { maxItems: "64" } }, { budget: { maxItems: 2.5 } },
    { budget: { maxTokens: 6001 } }, { budget: { maxTokens: 63 } }, { budget: { maxTokens: "6000" } },
    { cursor: "" }, { cursor: "cursor" }, { cursor: 1 }, { cursor: undefined }, { semantic: "false" },
  ];
  for (const patch of refused) await assert.rejects(read(patch), { code: "invalid_input" }, JSON.stringify(patch));
  await assert.rejects(service.findCandidates(readSet, { query: input.query, types: input.types, intent: input.intent,
    representation: input.representation }), { code: "invalid_input" });
  await assert.rejects(service.findCandidates(readSet, { query: input.query, types: input.types, intent: input.intent,
    limit: 64 }), { code: "invalid_input" });
  assert.deepEqual(lexicalDepths, []);
});
