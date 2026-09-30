import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRuntimeGuard } from "../runtime-usage.mjs";
import { fixture } from "../../codex/test/helpers.mjs";
import { assertEveryMutation, closedValues } from "../../codex/test/table-contract.mjs";

const plan = await readFile(
  new URL("../../../docs/plans/codex-client.md", import.meta.url),
  "utf8",
);
const section = plan
  .split("<!-- codex-usage-policy-table:start -->")[1]
  .split("<!-- codex-usage-policy-table:end -->")[0];
const vocabulary = {
  same: ["preserved", "latched"],
  next: ["applied", "drain", "automatic", "latched"],
  refusal: ["none", "concurrency_limited", "quota_reached"],
};
function facts(value) {
  for (const [name, choice] of Object.entries(value)) {
    const alternatives = {
      change: ["cap", "mode", "concurrency"],
      active: [2],
      event: ["daily-rollover", "quota-rollover"],
    }[name];
    assert.ok(alternatives?.includes(choice), `invalid policy fact ${name}`);
  }
  return value;
}
const rows = section
  .split("\n")
  .filter((line) => /^\| P\d+ /.test(line))
  .map((line) => {
    const [id, raw, same, next, refusal] = line
      .split("|")
      .slice(1, -1)
      .map((x) => x.trim());
    return {
      id,
      facts: facts(JSON.parse(raw.slice(1, -1))),
      expected: closedValues({ same, next, refusal }, vocabulary),
    };
  });
test("usage policy table has six closed rows", () => {
  assert.equal(rows.length, 6);
  assert.equal(new Set(rows.map((x) => x.id)).size, 6);
  assert.throws(() => facts({ chagne: "cap" }));
  assert.throws(() => facts({ change: "capp" }));
});
for (const row of rows)
  test(`${row.id} usage window ${JSON.stringify(row.facts)}`, async (t) => {
    const f = await fixture(t);
    let clock = Date.parse("2026-09-30T12:00:00Z");
    const config = {
      root: f.root,
      targetId: f.binding.targetId,
      mode: "api-key",
      dailyCap: row.facts.event ? 1 : 4,
      now: () => clock,
    };
    const original = createRuntimeGuard(config);
    const observed = {};
    if (row.facts.event) {
      const first = await original.reserve();
      await original.release(first.id, { terminated: true });
      if (row.facts.event === "quota-rollover") await original.refuse();
      const denied = await original.reserve();
      assert.equal(
        denied.code,
        row.facts.event === "daily-rollover" ? "daily_cap_reached" : "quota_reached",
      );
      observed.same = "latched";
      clock += 86400000;
      const retry = await original.reserve();
      observed.next = retry.ok ? "automatic" : "latched";
      observed.refusal = retry.ok ? "none" : retry.code;
    } else {
      const permits = [await original.reserve(), await original.reserve()];
      for (const permit of permits) await original.dispatch(permit.id, () => ({}));
      if (!row.facts.active) {
        for (const permit of permits) await original.release(permit.id, { terminated: true });
      }
      const patch = {
        cap: { dailyCap: 1 },
        mode: { mode: "plan" },
        concurrency: { concurrency: 1 },
      }[row.facts.change];
      const changed = createRuntimeGuard({ ...config, ...patch });
      const before = (await changed.status()).state;
      assert.equal(before.used, 2);
      assert.equal(before.cap, 4);
      assert.equal(before.mode, "api-key");
      assert.equal(before.concurrency, 2);
      assert.ok(before.pendingPolicy);
      observed.same = "preserved";
      clock += 86400000;
      const next = await changed.reserve();
      if (row.facts.active) {
        assert.equal(next.ok, false);
        assert.equal((await changed.status()).state.reservations.length, 2);
        assert.ok((await changed.status()).state.pendingPolicy);
        observed.next = "drain";
        observed.refusal = next.code;
        for (const permit of permits) await changed.release(permit.id, { terminated: true });
        assert.equal((await changed.reserve()).ok, true);
      } else {
        assert.equal(next.ok, true);
        observed.next = "applied";
        observed.refusal = "none";
      }
      const final = (await changed.status()).state;
      assert.equal(final.pendingPolicy, null);
      assert.equal(final.used, 1);
      assert.equal(final.cap, patch.dailyCap ?? 4);
      assert.equal(final.mode, patch.mode ?? "api-key");
      assert.equal(final.concurrency, patch.concurrency ?? 2);
    }
    assertEveryMutation(row.expected, observed, vocabulary);
  });
