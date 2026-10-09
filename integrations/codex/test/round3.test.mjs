import test from "node:test";
import assert from "node:assert/strict";
import { appendFile, readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fixture, header, item, session } from "./helpers.mjs";
import { workerFromHandoff } from "../hook.mjs";
import { clientProjectId } from "../../client/pairing.mjs";
import { runWorker, resetCapture, establishPauseBoundary } from "../worker.mjs";
import { createRuntimeGuard } from "../../client/runtime-usage.mjs";
import { HistoryOracle } from "./history-oracle.mjs";
import { virtualHook } from "./lock-contention.mjs";

test("review sequence: delayed A hook worker preserves B's first and second turns", async (t) => {
  const f = await fixture(t, { text: header() + item("Sent under A") });
  const clientOptions = { client: "codex", home: f.home, root: f.root, usesClaude: false, env: {} };
  const handoffs = [];
  const options = {
    clientOptions,
    targetId: f.binding.targetId,
    launch: (raw) => {
      handoffs.push(JSON.parse(raw));
    },
  };
  const event = (hook_event_name, cwd) => ({
    hook_event_name,
    cwd,
    session_id: session,
    transcript_path: f.path,
  });
  const worker = (handoff) =>
    workerFromHandoff(handoff, { ...options, guard: f.guard, transport: f.transport });
  const hook = (input) => virtualHook(t, input, options);
  assert.equal((await hook(event("Stop", "/synthetic/A"))).status, "launched");
  await worker(handoffs.shift());
  await appendFile(f.path, item("Old pending A", 1));
  await hook(event("Stop", "/synthetic/A"));
  const old = handoffs.shift();
  assert.equal(
    (await hook(event("SessionStart", "/synthetic/B"))).status,
    "binding_changed",
  );
  await appendFile(f.path, item("B first", 2));
  const before = await f.stateBytes();
  assert.equal((await worker(old)).status, "superseded");
  assert.equal(await f.stateBytes(), before);
  await hook(event("Stop", "/synthetic/B"));
  await worker(handoffs.shift());
  await appendFile(f.path, item("B second", 3));
  await hook(event("Stop", "/synthetic/B"));
  await worker(handoffs.shift());
  const a = await clientProjectId(clientOptions, "/synthetic/A");
  const b = await clientProjectId(clientOptions, "/synthetic/B");
  assert.deepEqual(
    [...f.receiver.values()].flatMap((body) =>
      body.messages.map((m) => ({ text: m.content, project: body.project_id })),
    ),
    [
      { text: "Sent under A", project: a },
      { text: "B first", project: b },
      { text: "B second", project: b },
    ],
  );
});

test(
  "invalid reply survives Stop and SessionStart under " + "another project until reset",
  async (t) => {
    const f = await fixture(t, { text: header() + item("Bad receiver") });
    const run = () => runWorker(f.binding, { guard: f.guard, transport: f.transport });
    f.fail("bad");
    await run();
    const before = await f.stateBytes();
    f.binding.projectId = "c".repeat(64);
    f.clear();
    assert.equal((await run()).status, "invalid_reply");
    assert.equal((await establishPauseBoundary(f.binding)).status, "invalid_reply");
    assert.equal(await f.stateBytes(), before);
    assert.equal(f.calls.length, 1);
    await resetCapture(f.binding, { hostsStopped: true, confirm: true });
    await appendFile(f.path, item("After explicit repair", 1));
    await run();
    assert.equal(f.receiver.size, 1);
  },
);

for (const corrupt of ["", "not-a-key", "x".repeat(65537)]) {
  test(`stopped reset recreates corrupt digest key (${corrupt.length} bytes) at EOF`, async (t) => {
    const f = await fixture(t, { text: header() + item("Old text") });
    const run = () => runWorker(f.binding, { guard: f.guard, transport: f.transport });
    await run();
    const old = await f.cursor();
    await appendFile(f.path, item("Skipped during reset", 1));
    const path = join(f.root, "codex-digest-key");
    await writeFile(path, corrupt);
    const result = await resetCapture(f.binding, { hostsStopped: true, confirm: true });
    assert.equal(result.status, "digest_key_reset");
    assert.equal(result.state.epoch, old.epoch + 1);
    assert.equal(result.state.skipped.digest_key_reset, Buffer.byteLength(await readFile(f.path)));
    assert.match(await readFile(path, "utf8"), /^[a-f0-9]{64}$/);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    const before = await f.stateBytes();
    assert.equal(
      (await resetCapture(f.binding, { hostsStopped: true, confirm: true })).status,
      "digest_key_reset",
    );
    assert.equal(await f.stateBytes(), before);
    await appendFile(f.path, item("Only new text", 2));
    await run();
    assert.equal(f.receiver.size, 2);
    assert.deepEqual(
      [...f.receiver.values()].flatMap((body) => body.messages.map((m) => m.content)),
      ["Old text", "Only new text"],
    );
  });
}

test("an unconfigured refusal guard never completes the durable quota latch", async (t) => {
  const f = await fixture(t, { text: header() + item("Refused text") });
  const removed = createRuntimeGuard({
    root: f.root,
    targetId: f.binding.targetId,
    mode: "api-key",
    dailyCap: undefined,
  });
  f.guard.refuse = removed.refuse;
  f.fail("refusal");
  const run = () => runWorker(f.binding, { guard: f.guard, transport: f.transport });
  assert.equal((await run()).status, "quota_reached");
  assert.equal((await f.cursor()).quotaRefusal.latched, false);
  f.clear();
  await run();
  assert.equal(f.calls.length, 1);
});

test("independent history oracle rejects correct text attributed to the wrong project", () => {
  const oracle = new HistoryOracle("", "a".repeat(64));
  oracle.apply("append", { bytes: 1, text: "Synthetic preference" });
  oracle.hook();
  const bodies = [{ project_id: "b".repeat(64), messages: [{ content: "Synthetic preference" }] }];
  assert.throws(() => oracle.assert(assert, null, bodies));
  bodies[0].project_id = "a".repeat(64);
  oracle.assert(assert, null, bodies);
});
