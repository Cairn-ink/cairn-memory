import { withLockClock } from "../../client/testing/lock-contention.mjs";
import { stateLock } from "../../client/state-lock.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { appendFile, writeFile, readFile, stat } from "node:fs/promises";
import { fixture, header, item, session } from "./helpers.mjs";
import { clientProjectId } from "../../client/pairing.mjs";
import { handleHook } from "../hook.mjs";
import { cursorPath } from "../cursor.mjs";
import { setPaused } from "../../client/control-state.mjs";
import { join } from "node:path";
import { runWorker, resetCapture, prepareCapture, establishPauseBoundary } from "../worker.mjs";
for (const operation of ["hook", "worker", "reset"]) {
  test(`review repro: cwd change recovers through ${operation}`, async (t) => {
    const f = await fixture(t, { text: header() + item("Old project preference") });
    const clientOptions = {
      client: "codex",
      home: f.home,
      root: f.root,
      usesClaude: false,
      env: {},
    };
    f.binding.projectId = await clientProjectId(clientOptions, "/synthetic/A");
    await runWorker(f.binding, { guard: f.guard, transport: f.transport });
    await appendFile(f.path, item("Between cwd changes", 1));
    f.binding.projectId = await clientProjectId(clientOptions, "/synthetic/B");
    let result;
    if (operation === "hook") {
      result = await handleHook(
        {
          hook_event_name: "Stop",
          session_id: session,
          cwd: "/synthetic/B",
          transcript_path: f.path,
        },
        { clientOptions, targetId: f.binding.targetId, launch: () => assert.fail("no launch") },
      );
    } else if (operation === "reset") {
      result = await resetCapture(f.binding, { hostsStopped: true, confirm: true });
    } else {
      result = await runWorker(f.binding, { guard: f.guard, transport: f.transport });
    }
    assert.equal(result.status, operation === "reset" ? "state_reset" : "binding_changed");
    assert.equal((await f.cursor()).epoch, 1);
    assert.equal(f.receiver.size, 1);
  });
}

test("binding EOF permits only new text under the resumed project", async (t) => {
  const f = await fixture(t, { text: header() + item("Old text") });
  await runWorker(f.binding, { guard: f.guard, transport: f.transport });
  const old = structuredClone(f.binding);
  await appendFile(f.path, item("Pending before rebind", 1));
  await prepareCapture(f.binding);
  f.binding.projectId = "c".repeat(64);
  const boundary = await establishPauseBoundary(f.binding);
  assert.equal(boundary.status, "binding_changed");
  assert.equal(boundary.state.epoch, 1);
  assert.equal(boundary.state.skipped.binding_changed, boundary.state.offset);
  await appendFile(f.path, item("Fresh text", 2));
  await runWorker(f.binding, { guard: f.guard, transport: f.transport });
  assert.deepEqual(
    [...f.receiver.values()].map((b) => [b.project_id, b.messages[0].content]),
    [
      [old.projectId, "Old text"],
      [f.binding.projectId, "Fresh text"],
    ],
  );
});

test("stopped reset recovers corrupt, unsupported, paused and rebound cursors", async (t) => {
  const f = await fixture(t);
  await runWorker(f.binding, { guard: f.guard, transport: f.transport });
  const path = cursorPath(f.root, f.binding.targetId, session);
  await writeFile(path, "{broken");
  await resetCapture(f.binding, { hostsStopped: true, confirm: true });
  await writeFile(f.path, header({ cli_version: "unsupported" }));
  await runWorker(f.binding, { guard: f.guard, transport: f.transport });
  f.binding.projectId = "c".repeat(64);
  await setPaused(f.root, true);
  assert.equal(
    (await resetCapture(f.binding, { hostsStopped: true, confirm: true })).status,
    "state_reset",
  );
  await writeFile(f.path, header() + item("While paused"));
  await setPaused(f.root, false);
  assert.ok(
    ["pause_boundary", "source_changed"].includes(
      (await runWorker(f.binding, { guard: f.guard, transport: f.transport })).status,
    ),
  );
  assert.equal(f.receiver.size, 0);
});

test("late frozen byteEnd is superseded without mutation", async (t) => {
  const f = await fixture(t, { text: header() + item("Current text") });
  await runWorker(f.binding, { guard: f.guard, transport: f.transport });
  const before = await f.stateBytes();
  const result = await runWorker(f.binding, { guard: f.guard, transport: f.transport, byteEnd: 1 });
  assert.equal(result.status, "superseded");
  assert.equal(await f.stateBytes(), before);
  assert.equal(f.receiver.size, 1);
});

test("v1 cursor starts a keyed EOF epoch without replay", async (t) => {
  const f = await fixture(t, { text: header() + item("Legacy text") });
  await runWorker(f.binding, { guard: f.guard, transport: f.transport });
  const value = await f.cursor();
  const legacy = { ...value, version: 1 };
  delete legacy.quotaRefusal;
  delete legacy.skipped.binding_changed;
  delete legacy.skipped.digest_migrated;
  delete legacy.skipped.digest_key_reset;
  legacy.anchor.digest = "0".repeat(64);
  await writeFile(cursorPath(f.root, f.binding.targetId, session), JSON.stringify(legacy));
  await appendFile(f.path, item("Before migration", 1));
  const result = await runWorker(f.binding, { guard: f.guard, transport: f.transport });
  assert.equal(result.status, "digest_migrated");
  assert.equal(result.state.version, 2);
  assert.equal(result.state.epoch, 1);
  assert.equal(result.state.skipped.digest_migrated, result.state.offset);
  assert.equal(f.receiver.size, 1);
});

test("owner-private transcript digests resist guessing across roots", async (t) => {
  const a = await fixture(t, { text: header() + item("Guessable text") });
  const b = await fixture(t, { text: header() + item("Guessable text") });
  await prepareCapture(a.binding);
  await prepareCapture(b.binding);
  assert.notEqual((await a.cursor()).pending.digest, (await b.cursor()).pending.digest);
  const keyPath = join(a.root, "codex-digest-key");
  assert.equal((await stat(keyPath)).mode & 0o777, 0o600);
  assert.ok(!(await a.stateBytes()).includes(await readFile(keyPath, "utf8")));
});

test("failed shared refusal latch retains reset and retries before dispatch", async (t) => {
  const f = await fixture(t, { text: header() + item("Refused text") });
  const resetAt = Date.now() + 60000;
  const original = f.guard.refuse;
  f.guard.refuse = async () => {
    throw new Error("state_busy");
  };
  let calls = 0;
  const transport = {
    terminated: () => true,
    capture: async () => {
      calls++;
      return { status: "refused", code: "quota_reached", resetAt };
    },
  };
  const run = () => runWorker(f.binding, { guard: f.guard, transport });
  assert.equal((await run()).status, "quota_reached");
  const state = await f.cursor();
  assert.equal(state.quotaRefusal.resetAt, resetAt);
  assert.equal(state.quotaRefusal.latched, false);
  await run();
  assert.equal(calls, 1);
  f.guard.refuse = original;
  await run();
  assert.equal(calls, 1);
  assert.equal((await f.guard.status()).state.resetAt, resetAt);
  assert.equal((await f.cursor()).offset, state.offset);
});

test("review repro: a held usage lock cannot turn quota into timeout", async (t) => {
  const f = await fixture(t, { text: header() + item("Refused while locked") });
  const resetAt = Date.now() + 60000;
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const dispatchFinished = Promise.withResolvers();
  const guard = { ...f.guard, dispatch: async (...args) => {
    const result = await f.guard.dispatch(...args);
    dispatchFinished.resolve();
    return result;
  } };
  let holding, calls = 0;
  const transport = {
    terminated: () => true,
    capture: async () => {
      calls++;
      // A reply arrives after dispatch publication/cleanup. Join that exact
      // boundary instead of hoping setImmediate runs after filesystem awaits.
      await dispatchFinished.promise;
      holding = stateLock(f.guard.path.replace(/\.json$/, ".lock"), async () => {
        entered.resolve();
        await release.promise;
      });
      await entered.promise;
      return { status: "refused", code: "quota_reached", resetAt };
    },
  };
  try {
    await withLockClock(t, async (clock) => {
      const result = await runWorker(f.binding, { guard, transport });
      assert.equal(clock.elapsed(), 500, "both refuse and release exhaust 250 ms while holder stays live");
      assert.equal(result.status, "quota_reached");
      assert.equal(result.state.quotaRefusal.resetAt, resetAt);
      assert.equal(result.state.quotaRefusal.latched, false);
      assert.equal(result.state.accepted, 0);
    });
  } finally {
    release.resolve();
    await holding;
  }
  await runWorker(f.binding, { guard: f.guard, transport });
  assert.equal(calls, 1);
  assert.equal((await f.guard.status()).state.resetAt, resetAt);
});

test("quota intent survives every EOF boundary before a failed latch is retried", async (t) => {
  for (const boundary of ["binding", "source", "pause", "session-start", "reset"]) {
    const f = await fixture(t, { text: header() + item("Refused old source") });
    const refuse = f.guard.refuse;
    f.guard.refuse = async () => {
      throw new Error("state_busy");
    };
    f.fail("refusal");
    const run = () => runWorker(f.binding, { guard: f.guard, transport: f.transport });
    assert.equal((await run()).status, "quota_reached");
    const intent = (await f.cursor()).quotaRefusal;
    f.clear();
    if (["binding", "session-start"].includes(boundary)) f.binding.projectId = "c".repeat(64);
    if (boundary === "source") await writeFile(f.path, header());
    if (boundary === "pause") {
      await setPaused(f.root, true);
      await setPaused(f.root, false);
    }
    if (boundary === "reset") await resetCapture(f.binding, { hostsStopped: true, confirm: true });
    else if (boundary === "session-start") await establishPauseBoundary(f.binding);
    else await run();
    assert.deepEqual((await f.cursor()).quotaRefusal, intent, boundary);
    await appendFile(f.path, item("New source after refusal", 10));
    assert.equal((await run()).status, "quota_reached", boundary);
    assert.equal(f.calls.length, 1, boundary);
    f.guard.refuse = refuse;
    assert.equal((await run()).status, "quota_reached");
    await f.guard.resume();
    await run();
    assert.equal(f.receiver.size, 1);
  }
});
