import assert from "node:assert/strict";
import { test } from "node:test";
import { CoreError } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";
import { hostedScope, serviceFake } from "./helpers/service-fake.mjs";

const { owner } = hostedScope;
const locked = [["run", owner, { pauseLock: true }], ["lock", "pause"], ["lock", "owner-write"]];

test("pause reads under the pause lock and writes take the pause lock first", async () => {
  const { deps, calls } = serviceFake();
  const service = createMemoryService(deps);
  // Hosted src/memory/pause.ts:7–10,19–32. Phase 0 also locks reads and omits enforced.
  assert.deepEqual(await service.pauseState(owner), { paused: false, generation: 0 });
  assert.deepEqual(calls.splice(0), [...locked, ["pause.get", owner]]);

  for (const [paused, generation] of [[false, 0], [true, 1], [true, 2], [false, 2], [true, 3]]) {
    assert.deepEqual(await service.setPause(owner, paused), { paused, generation });
    assert.deepEqual(calls.splice(0), [...locked, ["pause.get", owner], ["pause.set", owner, paused]]);
  }
});

test("a nonconforming repeated pause rolls back inside the same run", async () => {
  const { deps, hooks } = serviceFake();
  const service = createMemoryService(deps);
  await service.setPause(owner, true);
  hooks.keepRepeatedGeneration = true;
  await assert.rejects(() => service.setPause(owner, true),
    error => error instanceof CoreError && error.code === "internal_error");
  assert.deepEqual(await service.pauseState(owner), { paused: true, generation: 1 });
});
