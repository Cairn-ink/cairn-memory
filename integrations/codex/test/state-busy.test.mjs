import test from "node:test";
import assert from "node:assert/strict";
import { appendFile } from "node:fs/promises";
import { fixture, header, item } from "./helpers.mjs";
import { runWorker } from "../worker.mjs";
import { handleHook, workerFromHandoff } from "../hook.mjs";
import { cursorPath } from "../cursor.mjs";
import { stateLock } from "../../client/state-lock.mjs";
import { clientProjectId } from "../../client/pairing.mjs";
import { HistoryOracle } from "./history-oracle.mjs";
import { withHeldDispatch } from "./lock-contention.mjs";

for (const stage of ["reserve", "dispatch"])
  test(`state_busy at worker ${stage} preserves pending text for exactly one later admission`, async (t) => {
    const f = await fixture(t);
    const run = (guard = f.guard) => runWorker(f.binding, { guard, transport: f.transport });
    const oracle = new HistoryOracle(header(), f.binding.projectId);
    await run();
    oracle.hook();
    const text = `Synthetic pending preference at ${stage}`, bytes = item(text);
    await appendFile(f.path, bytes);
    oracle.apply("append", { bytes: Buffer.byteLength(bytes), text });
    const before = await f.cursor();
    const holder = await f.guard.reserve();
    assert.equal(holder.ok, true);
    // For the dispatch case the worker already has its real, persisted grant
    // before the other caller holds the lock. It must still pass real dispatch.
    const permit = stage === "dispatch" ? await f.guard.reserve() : null;
    if (permit) assert.equal(permit.ok, true);
    const guard = permit ? { ...f.guard, reserve: async () => permit } : f.guard;
    await withHeldDispatch(t, (start) => f.guard.dispatch(holder.id, start), async () => {
      await assert.rejects(run(guard), { message: "state_busy" });
      oracle.hook("state_busy");
      const pending = await f.cursor();
      assert.equal(pending.offset, before.offset);
      assert.equal(pending.pending.end, oracle.bytes);
      assert.equal(pending.pending.next, 0);
      assert.equal(f.calls.length, 0);
      oracle.assert(assert, pending, [...f.receiver.values()]);
      // Prove the model would reject either an early cursor move or admission.
      assert.throws(() => oracle.assert(assert, { ...pending, offset: oracle.bytes }, []));
      assert.throws(() => oracle.assert(assert, pending, [{
        project_id: f.binding.projectId, messages: [{ content: text }],
      }]));
    });
    for (const grant of [holder, permit].filter(Boolean))
      await f.guard.release(grant.id, { terminated: true });
    const used = permit ? 2 : 1;
    assert.equal((await f.guard.status()).state.used, used, "busy dispatch never refunds grants");
    await run();
    oracle.hook();
    oracle.assert(assert, await f.cursor(), [...f.receiver.values()]);
    await run();
    oracle.assert(assert, await f.cursor(), [...f.receiver.values()]);
    assert.equal(f.calls.length, 1);
    assert.equal((await f.guard.status()).state.used, used + 1);
    assert.equal((await f.guard.status()).state.reservations.length, 0);
  });

test("state_busy at Stop preparation returns fail-open output without launching; later same-session hook delivers once", async (t) => {
  const f = await fixture(t);
  const cwd = "/synthetic/state-busy-project";
  const clientOptions = { home: f.home, root: f.root, usesClaude: false, env: {} };
  f.binding.projectId = await clientProjectId({ ...clientOptions, client: "codex" }, cwd);
  const oracle = new HistoryOracle(header(), f.binding.projectId);
  await runWorker(f.binding, { guard: f.guard, transport: f.transport });
  oracle.hook();
  const text = "Synthetic Stop pending preference", bytes = item(text);
  await appendFile(f.path, bytes);
  oracle.apply("append", { bytes: Buffer.byteLength(bytes), text });
  const before = await f.stateBytes();
  const handoffs = [];
  const input = { hook_event_name: "Stop", session_id: f.binding.sessionId,
    cwd, transcript_path: f.path };
  const config = { clientOptions, targetId: f.binding.targetId,
    launch: (raw) => handoffs.push(JSON.parse(raw)) };
  const lock = cursorPath(f.root, f.binding.targetId, f.binding.sessionId).replace(/\.json$/, ".lock");
  await withHeldDispatch(t, async (hold) => {
    await stateLock(lock, hold);
    return { ok: true };
  }, async () => {
    assert.deepEqual(await handleHook(input, config), { output: "{}", status: "capture_unavailable" });
    oracle.hook("state_busy");
    assert.equal(handoffs.length, 0);
    assert.equal(f.calls.length, 0);
    assert.equal(await f.stateBytes(), before);
    oracle.assert(assert, await f.cursor(), [...f.receiver.values()]);
  });
  assert.equal((await handleHook(input, config)).status, "launched");
  assert.equal(handoffs.length, 1);
  await workerFromHandoff(handoffs[0], { ...config, guard: f.guard, transport: f.transport });
  oracle.hook();
  oracle.assert(assert, await f.cursor(), [...f.receiver.values()]);
  await handleHook(input, config);
  assert.equal(handoffs.length, 1);
  assert.equal(f.calls.length, 1);
});
