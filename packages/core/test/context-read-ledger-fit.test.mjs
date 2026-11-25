import assert from "node:assert/strict";
import { test } from "node:test";
import { fitLedgerDigest, meter } from "../src/service/context-read-pack.mjs";

const notice = "More ledger rows not shown.";
const line = (key, kind, tokens, answering = false, total) =>
  ({ key, kind, tokens, answering, total });

function fit(lines, maxTokens = 100, accept = value => value) {
  const diagnostics = {};
  const metering = meter({
    budget: { maxTokens, maxItems: 2 }, now: () => 0, deadline: 1, fitsBytes: () => true,
    format: JSON.stringify,
    count(text) {
      const { ledgerDigest } = JSON.parse(text);
      return ledgerDigest ? ledgerDigest.body.length + 4 * ledgerDigest.sources.length : 0;
    },
  });
  const reading = {
    lines,
    project(selected, trimmed) {
      const body = selected.map(item => item.key.padEnd(item.tokens - 4)).join("") + (trimmed ? notice : "");
      const sources = selected.map(({ key }, index) => ({ index, role: "user", memory: { id: key } }));
      return { value: { body, sources }, witness: () => "witness" };
    },
  };
  const result = fitLedgerDigest(reading, maxTokens, metering, () => {}, diagnostics, accept);
  return { result, diagnostics };
}

for (const tokens of [29, 30, 31]) {
  test(`the 30% share is inclusive at ${tokens} tokens including citations`, () => {
    const { result, diagnostics } = fit([line("answer", "measure", 10, true), line("group", "group", tokens - 10)]);
    if (tokens <= 30) {
      assert.deepEqual(result.selection.keys, ["answer", "group"]);
      assert.equal(result.packed.sources.length, 2);
      assert.deepEqual(diagnostics, {});
    } else {
      assert.deepEqual(result.selection.keys, ["answer"]);
      assert.equal(result.packed.sources.length, 1);
      assert.ok(result.packed.body.endsWith(notice));
      assert.deepEqual(diagnostics, { ledger_digest_trimmed: 1 });
    }
  });
}

for (const tokens of [59, 60, 61]) {
  test(`the 60% answer ceiling is inclusive at ${tokens} tokens including citations`, () => {
    const { result, diagnostics } = fit([line("answer", "measure", tokens, true)]);
    if (tokens <= 60) {
      assert.deepEqual(result.selection.keys, ["answer"]);
      assert.deepEqual(result.packed.sources.map(({ memory }) => memory.id), ["answer"]);
      assert.deepEqual(diagnostics, {});
    } else {
      assert.equal(result, undefined);
      assert.deepEqual(diagnostics, { digest_line_too_large: 1, ledger_digest_trimmed: 1, ledger_digest_omitted: 1 });
    }
  });
}

test("trim order removes subtotals, then the smallest category, then larger categories before groups", () => {
  const lines = [line("answer", "measure", 10, true), line("group", "group", 150), line("large", "category", 100, false, 20),
    line("small", "category", 60, false, 5), line("week", "subtotal", 80)];
  const { result, diagnostics } = fit(lines, 1000);
  assert.deepEqual(result.selection.keys, ["answer", "group", "large"]);
  assert.deepEqual(result.packed.sources.map(({ memory }) => memory.id), result.selection.keys);
  assert.deepEqual(diagnostics, { ledger_digest_trimmed: 2 });
  assert.deepEqual(fit(lines, 600).result.selection.keys, ["answer"]);
});

test("an oversized line leaves its complete citation set behind while another answer can fit", () => {
  const { result, diagnostics } = fit([line("month", "measure", 61, true), line("week", "measure", 35, true)]);
  assert.deepEqual(result.selection.keys, ["week"]);
  assert.deepEqual(result.packed.sources.map(({ memory }) => memory.id), ["week"]);
  assert.ok(result.packed.body.endsWith(notice));
  assert.deepEqual(diagnostics, { digest_line_too_large: 1, ledger_digest_trimmed: 1 });
});

test("a ranked-item constraint removes optional lines before falling back to the ordinary pack", () => {
  const lines = [line("answer", "measure", 10, true), line("other", "group", 10)];
  const { result, diagnostics } = fit(lines, 1000, value => value.sources.length === 1 ? value : undefined);
  assert.deepEqual(result.selection.keys, ["answer"]);
  assert.deepEqual(diagnostics, { ledger_digest_trimmed: 1 });
  const empty = fit(lines, 1000, () => undefined);
  assert.equal(empty.result, undefined);
  assert.deepEqual(empty.diagnostics, { ledger_digest_trimmed: 2, ledger_digest_omitted: 1 });
});
