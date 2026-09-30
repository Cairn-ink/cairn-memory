import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRuntimeGuard } from "../runtime-usage.mjs";
import { usageFixture } from "./runtime-helpers.mjs";
import { assertEveryMutation, closedValues } from "./table-contract.mjs";

const plan = await readFile(
  new URL("../../../docs/plans/codex-client.md", import.meta.url),
  "utf8",
);
const section = plan
  .split("<!-- codex-usage-policy-table:start -->")[1]
  .split("<!-- codex-usage-policy-table:end -->")[0];
const vocabulary = {
  same: ["preserved", "latched", "conflict"],
  next: ["applied", "drain", "automatic", "latched", "preserved", "conflict"],
  refusal: [
    "none",
    "concurrency_limited",
    "quota_reached",
    "daily_cap_reached",
    "plan_threshold",
    "policy_conflict",
  ],
};
function facts(value) {
  for (const [name, choice] of Object.entries(value)) {
    const alternatives = {
      change: ["cap", "mode", "concurrency"],
      active: [2],
      event: ["daily-rollover", "quota-rollover", "revert", "policy-conflict"],
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
test("usage policy table has ten closed rows", () => {
  assert.equal(rows.length, 10);
  assert.equal(new Set(rows.map((x) => x.id)).size, 10);
  assert.throws(() => facts({ chagne: "cap" }));
  assert.throws(() => facts({ change: "capp" }));
});
for (const row of rows)
  test(`${row.id} usage window ${JSON.stringify(row.facts)}`, async (t) => {
    const f = await usageFixture(t);
    let clock = Date.parse("2026-09-30T12:00:00Z");
    const config = {
      root: f.root,
      targetId: f.config.targetId,
      mode: "api-key",
      dailyCap: row.facts.event ? 1 : 4,
      now: () => clock,
    };
    const original = createRuntimeGuard(config);
    const observed = {};
    if (row.facts.event === "revert") {
      const active = {
        ...config,
        dailyCap: row.facts.change === "cap" ? 3 : 100,
        concurrency: 1,
        mode: row.facts.change === "mode" ? "plan" : "api-key",
      };
      const guard = createRuntimeGuard(active);
      await guard.status();
      const patch = {
        cap: { dailyCap: 50 },
        concurrency: { concurrency: 8 },
        mode: { mode: "api-key" },
      }[row.facts.change];
      await createRuntimeGuard({ ...active, ...patch }).status();
      assert.ok((await guard.status()).state.pendingPolicy === null);
      observed.same = "preserved";
      clock += 86400000;
      if (row.facts.change === "mode") {
        await guard.observe({
          windows: [{ name: "five_hour", utilization: 0.99, resetAt: clock + 18000000 }],
          observedAt: clock,
        });
        observed.refusal = (await guard.reserve()).code;
      } else {
        let granted = 0,
          next;
        for (let i = 0; i < 51; i++) {
          next = await guard.reserve();
          if (!next.ok) break;
          granted++;
          if (row.facts.change === "cap") await guard.release(next.id, { terminated: true });
        }
        assert.equal(granted, row.facts.change === "cap" ? 3 : 1);
        observed.refusal = next.code;
      }
      const after = (await guard.status()).state;
      assert.equal(after.cap, active.dailyCap);
      assert.equal(after.concurrency, 1);
      assert.equal(after.mode, active.mode);
      assert.equal(after.pendingPolicy, null);
      observed.next = "preserved";
    } else if (row.facts.event === "policy-conflict") {
      const claude = createRuntimeGuard({ ...config, dailyCap: 3, client: "claude" });
      const codex = createRuntimeGuard({ ...config, dailyCap: 50, client: "codex" });
      const permit = await claude.reserve();
      assert.equal((await codex.reserve()).code, "policy_conflict");
      assert.equal((await claude.reserve()).code, "policy_conflict");
      assert.equal((await claude.status()).state.used, 1);
      assert.equal(
        (await claude.dispatch(permit.id, () => assert.fail("conflicting dispatch"))).code,
        "policy_conflict",
      );
      await claude.release(permit.id, { terminated: true });
      observed.same = "conflict";
      for (let day = 0; day < 3; day++) {
        clock += 86400000;
        assert.equal((await codex.reserve()).code, "policy_conflict");
        assert.equal((await claude.reserve()).code, "policy_conflict");
        const state = (await claude.status()).state;
        assert.equal(state.cap, 3);
        assert.equal(state.pendingPolicy, null);
        assert.equal(state.used, 0);
      }
      observed.next = "conflict";
      observed.refusal = "policy_conflict";
      await claude.refuse();
      assert.equal((await claude.resume()).code, "policy_conflict");
      const aligned = createRuntimeGuard({ ...config, dailyCap: 3, client: "codex" });
      assert.equal((await aligned.status()).state.refusal, "quota_reached");
      await aligned.resume();
      assert.equal((await claude.reserve()).ok, true);
    } else if (row.facts.event) {
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
