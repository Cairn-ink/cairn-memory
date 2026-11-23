import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { runCase } from "@cairn-ink/conformance";

test("the harness hook table names the admission, import, and fork consumers", () => {
  const readme = readFileSync(new URL("../../conformance/README.md", import.meta.url), "utf8");
  const row = (hook) => readme.split("\n").find((line) => line.startsWith("| `" + hook + "("));
  const dump = row("dump");
  for (const consumer of ["K-ADM-7", "IMPORT_ARCHIVE_CASES", "PROVEN_FORK_CASES"]) {
    assert.ok(dump?.includes(consumer), `dump must document ${consumer}`);
  }
  assert.match(row("setWriteTime"), /K-IMP-T3/);
  assert.match(row("seedFact"), /IMPORT_ARCHIVE_CASES.*PROVEN_FORK_CASES/);
  const hash = row("hashSessionKey");
  assert.match(hash, /IMPORT_ARCHIVE_CASES.*PROVEN_FORK_CASES/);
  assert.match(hash, /raw.archive span fixtures.*both profiles/i);
  assert.match(hash, /K-FACT-3r.*supplies its own hash/);
});

test("rounds each fractional factory delay before cases combine their timing budgets", async () => {
  const adapter = createMemoryAdapter();
  const factory = {
    async open() {
      return { adapter, timeoutMs: 0.2, settleMs: 1.2, async close() {} };
    },
  };
  const testCase = {
    id: "timing",
    needs: [],
    async run({ timeoutMs, settleMs }) {
      assert.deepEqual({ timeoutMs, settleMs, phaseMs: timeoutMs + settleMs },
        { timeoutMs: 1, settleMs: 2, phaseMs: 3 });
    },
  };
  assert.equal(await runCase(factory, testCase), null);
});
