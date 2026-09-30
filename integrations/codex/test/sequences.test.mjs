import test from "node:test";
import assert from "node:assert/strict";
import { appendFile, writeFile, rename } from "node:fs/promises";
import { fixture, header, item } from "./helpers.mjs";
import { runWorker, prepareCapture, establishPauseBoundary } from "../worker.mjs";
import { setPaused } from "../../client/control-state.mjs";
import { createRuntimeGuard } from "../../client/runtime-usage.mjs";
import { clientProjectId } from "../../client/pairing.mjs";
import { HistoryOracle, seeded } from "./history-oracle.mjs";

import { receiverServer, childAttempt } from "./process-harness.mjs";
import { withHeldDispatch } from "./lock-contention.mjs";

const seeds = [1, 7, 42, 91, 12345, 65537, 0xc0de, 0xcafebabe].map((x) => x >>> 0);
const ops = [
  "append",
  "replace",
  "truncate",
  "malformed",
  "pause",
  "resume",
  "crash",
  "lost",
  "concurrent",
  "resume-cwd",
  "late-handoff",
];
for (const seed of seeds)
  test(`seeded independent history oracle seed=${seed}, 64 operations`, async (t) => {
    const began = performance.now(),
      f = await fixture(t),
      random = seeded(seed),
      oracle = new HistoryOracle(header(), f.binding.projectId);
    const endpoint = await receiverServer(f);
    const claude = createRuntimeGuard({
      root: f.root,
      targetId: f.binding.targetId,
      mode: "api-key",
      dailyCap: 10000,
    });
    const codex = createRuntimeGuard({
      root: f.root,
      targetId: f.binding.targetId,
      mode: "api-key",
      dailyCap: 10000,
    });
    let usageCalls = 0;
    const originalCapture = f.transport.capture;
    f.transport.capture = async (body) => {
      usageCalls++;
      return originalCapture(body);
    };
    const run = () => runWorker(f.binding, { guard: f.guard, transport: f.transport });
    await run();
    oracle.hook();
    const visited = new Set();
    for (let step = 0; step < 64; step++) {
      const op = step < ops.length ? ops[step] : ops[random() % ops.length];
      visited.add(op);
      if (op === "pause") {
        oracle.apply(op);
        await setPaused(f.root, true);
      } else if (op === "resume") {
        oracle.apply(op);
        await setPaused(f.root, false);
      } else if (op === "resume-cwd") {
        f.binding.projectId = await clientProjectId(
          { client: "codex", home: f.home, root: f.root, usesClaude: false, env: {} },
          `/synthetic/cwd-${seed}-${step}`,
        );
        oracle.apply(op, { projectId: f.binding.projectId });
        const text = `Before resumed hook ${seed}-${step}`;
        const bytes = item(text, step);
        await appendFile(f.path, bytes);
        oracle.apply("append", { bytes: Buffer.byteLength(bytes), text });
      } else if (op === "late-handoff") {
        const old = { ...f.binding };
        const pending = item(`Pending old handoff ${seed}-${step}`, step);
        await appendFile(f.path, pending);
        oracle.apply("handoff-pending", { bytes: Buffer.byteLength(pending) });
        const byteEnd = oracle.bytes;
        await prepareCapture(old);
        f.binding.projectId = await clientProjectId(
          { client: "codex", home: f.home, root: f.root, usesClaude: false, env: {} },
          `/synthetic/late-${seed}-${step}`,
        );
        oracle.apply(op, { projectId: f.binding.projectId });
        await establishPauseBoundary(f.binding);
        oracle.hook();
        const text = `B first ${seed}-${step}`,
          bytes = item(text, step);
        await appendFile(f.path, bytes);
        oracle.apply("append", { bytes: Buffer.byteLength(bytes), text });
        const before = await f.stateBytes();
        const late = await runWorker(old, { guard: f.guard, transport: f.transport, byteEnd });
        assert.ok(["superseded", "paused"].includes(late.status));
        assert.equal(await f.stateBytes(), before);
      } else if (op === "replace") {
        const bytes = header() + item(`Generated replacement ${seed}-${step}`);
        await writeFile(f.path + ".new", bytes);
        await rename(f.path + ".new", f.path);
        oracle.apply(op, { size: Buffer.byteLength(bytes) });
      } else if (op === "truncate") {
        await writeFile(f.path, header());
        oracle.apply(op, { size: Buffer.byteLength(header()) });
      } else if (op === "concurrent") {
        // Independent usage model remembers grants/termination, never reads expected counters from
        // production.
        // The first concurrent step always exercises the CI failure, regardless
        // of runner speed. Other steps still exercise ordinary mixed contention.
        const forceBusy = step === 8;
        const attempts = forceBusy
          ? [
              { status: "fulfilled", value: await claude.reserve() },
              { status: "fulfilled", value: await codex.reserve() },
            ]
          : await Promise.allSettled([claude.reserve(), codex.reserve(), claude.reserve()]);
        for (const result of attempts.filter((x) => x.status === "rejected"))
          assert.equal(result.reason.message, "state_busy");
        const grants = attempts
          .filter((x) => x.status === "fulfilled" && x.value.ok)
          .map((x) => x.value);
        assert.ok(grants.length <= 2);
        if (forceBusy) assert.equal(grants.length, 2);
        usageCalls += grants.length;
        assert.equal((await f.guard.status()).state.used, usageCalls);
        let starts = 0;
        const start = () => {
          starts++;
          return { operation: Promise.resolve({ terminated: true }) };
        };
        const dispatches = forceBusy
          ? await withHeldDispatch(
              t,
              (hold) => claude.dispatch(grants[0].id, async () => { starts++; return hold(); }),
              () => Promise.allSettled([codex.dispatch(grants[1].id, start)]),
            )
          : await Promise.allSettled(
              grants.map((grant, i) => (i ? codex : claude).dispatch(grant.id, start)),
            );
        const busy = dispatches.filter((x) => x.status === "rejected");
        for (const result of busy) assert.equal(result.reason.message, "state_busy");
        const sent = dispatches.filter((x) => x.status === "fulfilled").map((x) => x.value);
        assert.ok(sent.every((x) => x.ok));
        assert.equal(starts, grants.length - busy.length);
        await Promise.all(sent.map((x) => x.dispatch.operation));
        if (forceBusy) assert.equal(busy.length, 1);
        for (const result of busy) oracle.hook(result.reason.message);
        // A busy dispatch consumed no call; grants still count and are released
        // only once their callers are known to have terminated. Never refund used.
        for (const grant of grants) await f.guard.release(grant.id, { terminated: true });
        oracle.apply(op);
      } else {
        const text = `Human preference ${seed}-${step}`;
        const bytes = op === "malformed" ? "{malformed}\n" : item(text, step);
        await appendFile(f.path, bytes);
        oracle.apply(op, {
          bytes: Buffer.byteLength(bytes),
          text: op === "malformed" ? null : text,
        });
        if (op === "crash" && !oracle.paused && !oracle.barrier) {
          const child = await childAttempt(f, { crashAt: 1 + (random() % 7), endpoint });
          if (child.writes.some((x) => x.category === "usage" && x.kind === "write")) usageCalls++;
        }
        if (op === "lost" && !oracle.paused && !oracle.barrier) {
          f.fail("lost");
          await run();
          f.clear();
        }
      }
      await run();
      oracle.hook();
      // Replacement while paused is observed only after resume. Model epoch tracks that
      // observation.
      const state = await f.cursor();
      oracle.assert(assert, state, [...f.receiver.values()]);
      const usage = (await f.guard.status()).state;
      assert.equal(
        usage.used,
        usageCalls,
        "billing oracle derives counts from dispatch/write operation history",
      );
      assert.ok(usage.used >= 0 && usage.used <= usage.cap);
      assert.ok(usage.reservations.length <= 2);
    }
    assert.equal(visited.size, ops.length);
    t.diagnostic(`seed=${seed} steps=64 runtime_ms=${Math.round(performance.now() - began)}`);
  });
