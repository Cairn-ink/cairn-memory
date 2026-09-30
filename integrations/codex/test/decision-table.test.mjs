import test from "node:test";
import assert from "node:assert/strict";
import { readFile, appendFile, writeFile, rename, unlink } from "node:fs/promises";
import { fixture, header, item } from "./helpers.mjs";
import { runWorker, prepareCapture, resetCapture, establishPauseBoundary } from "../worker.mjs";
import { setPaused } from "../../client/control-state.mjs";
import { cursorPath } from "../cursor.mjs";
import { assertEveryMutation, closedValues } from "./table-contract.mjs";
import { withWriteObserver } from "../../client/private-state.mjs";

const factValues = {
  state: ["fresh", "ready", "pending", "discard", "stale"],
  event: [
    "append",
    "timeout",
    "processing",
    "lost",
    "bad-reply",
    "refusal",
    "pause",
    "resume",
    "replace",
    "truncate",
    "mutate",
    "partial",
    "malformed",
    "oversized",
    "missing",
    "unsupported",
    "crash",
    "finish",
    "last-hook",
    "new-session",
    "binding-change",
    "reset-binding",
    "late-worker",
    "start-binding",
    "digest-migration",
    "latch-failure",
  ],
  batch: ["first", "middle", "last"],
  mode: ["hosted-stub", "local-stub"],
};
export function facts(overrides) {
  for (const [k, v] of Object.entries(overrides))
    assert.ok(factValues[k]?.includes(v), `invalid table fact ${k}`);
  return { state: "ready", event: "append", batch: "first", mode: "hosted-stub", ...overrides };
}
const results = {
  cursor: ["end", "eof", "retry-end", "unchanged", "batch-start", "batch-end", "old-unchanged"],
  sent: [0, 1, 2, 3],
  worker: ["idle", "pending", "disabled"],
  refusal: [
    "none",
    "timeout",
    "processing",
    "invalid_reply",
    "quota_reached",
    "paused",
    "pause_boundary",
    "source_changed",
    "partial_tail",
    "excluded",
    "source_unavailable",
    "unsupported_format",
    "batch_limit",
    "binding_changed",
    "state_reset",
    "superseded",
    "digest_migrated",
  ],
};
const plan = await readFile(
  new URL("../../../docs/plans/codex-client.md", import.meta.url),
  "utf8",
);
const section = plan
  .split("<!-- codex-worker-table:start -->")[1]
  .split("<!-- codex-worker-table:end -->")[0];
const rows = section
  .split("\n")
  .filter((x) => /^\| W\d+ /.test(x))
  .map((line) => {
    const [id, raw, cursor, sent, worker, refusal] = line
      .split("|")
      .slice(1, -1)
      .map((x) => x.trim());
    assert.match(sent, /^[0-3]$/);
    closedValues({ cursor, sent: Number(sent), worker, refusal }, results);
    return {
      id,
      f: facts(JSON.parse(raw.slice(1, -1))),
      cursor,
      sent: Number(sent),
      worker,
      refusal,
    };
  });
test("table is closed and every row generates a test", () => {
  assert.equal(rows.length, 32);
  assert.equal(new Set(rows.map((x) => x.id)).size, 32);
  assert.throws(() => facts({ batc: "first" }));
  assert.throws(() => facts({ batch: "frist" }));
});

for (const row of rows)
  test(`${row.id} ${JSON.stringify(row.f)}`, async (t) => {
    const f = await fixture(t);
    const run = (options = {}) =>
      runWorker(f.binding, {
        guard: f.guard,
        transport: f.transport,
        mode: row.f.mode,
        ...options,
      });
    if (row.f.state !== "fresh") await run(); // known excluded header, with byte coverage
    const initial = await f.cursor();
    let addition = item("Prefer concise notes.");
    if (
      ["timeout", "refusal"].includes(row.f.event) ||
      ["finish", "last-hook", "new-session"].includes(row.f.event)
    )
      addition = Array.from({ length: 50 }, (_, i) => item(`Preference ${i}`, i)).join("");
    if (row.f.event === "partial") addition = item("Partial text").slice(0, -10);
    if (row.f.event === "malformed") addition = "{broken json}\n";
    if (row.f.event === "oversized" || row.f.state === "discard") addition = "x".repeat(300000);
    await appendFile(f.path, addition);
    if (row.f.state === "discard") {
      await run();
      await appendFile(f.path, "remaining\n");
    }
    if (row.f.state === "pending" || ["pause", "truncate"].includes(row.f.event))
      await prepareCapture(f.binding);
    if (["timeout", "processing", "lost", "bad-reply", "refusal"].includes(row.f.event))
      f.fail(
        row.f.event === "bad-reply" ? "bad" : row.f.event,
        row.f.batch === "first" ? 1 : row.f.batch === "middle" ? 2 : 3,
      );
    if (row.f.event === "pause") await setPaused(f.root, true);
    if (row.f.event === "resume") {
      await setPaused(f.root, true);
      await setPaused(f.root, false);
    }
    if (row.f.event === "replace") {
      const replacement = f.path + ".new";
      await writeFile(replacement, header() + item("Replacement summary"));
      await rename(replacement, f.path);
    }
    if (row.f.event === "truncate") await writeFile(f.path, header());
    if (row.f.event === "mutate") await writeFile(f.path, header() + item("Prefer verbose notes."));
    if (row.f.event === "unsupported")
      await writeFile(f.path, header({ cli_version: "0.999.0" }) + addition);
    if (row.f.event === "missing") await unlink(f.path);
    if (["binding-change", "reset-binding", "start-binding"].includes(row.f.event))
      f.binding.projectId = "c".repeat(64);
    if (row.f.event === "digest-migration") {
      const legacy = await f.cursor();
      legacy.version = 1;
      delete legacy.quotaRefusal;
      delete legacy.skipped.binding_changed;
      delete legacy.skipped.digest_migrated;
      await writeFile(
        cursorPath(f.root, f.binding.targetId, f.binding.sessionId),
        JSON.stringify(legacy),
      );
    }
    if (row.f.event === "latch-failure") {
      f.fail("refusal");
      f.guard.refuse = async () => {
        throw new Error("state_busy");
      };
    }
    let result;
    if (row.f.event === "crash") {
      let hit = false;
      await assert.rejects(
        withWriteObserver(
          ({ path }) => {
            if (path.endsWith(".json") && path.includes("codex-cursors") && !hit) {
              hit = true;
              throw new Error("crash");
            }
          },
          () => run(),
        ),
      );
      result = await run();
    } else if (row.f.event === "reset-binding")
      result = await resetCapture(f.binding, { hostsStopped: true, confirm: true });
    else if (row.f.event === "start-binding") result = await establishPauseBoundary(f.binding);
    else if (row.f.event === "late-worker") result = await run({ byteEnd: 0 });
    else result = await run();
    const s = result.state;
    const observed = {
      sent: f.receiver.size,
      refusal: result.status === "idle" ? "none" : result.status,
    };
    if (
      [
        "binding-change",
        "reset-binding",
        "start-binding",
        "digest-migration",
        "replace",
        "truncate",
        "mutate",
        "resume",
      ].includes(row.f.event)
    ) {
      assert.equal(s.offset, Buffer.byteLength(await readFile(f.path)));
      assert.equal(s.pending, null);
      const reason = {
        "binding-change": "binding_changed",
        "reset-binding": "state_reset",
        "start-binding": "binding_changed",
        "digest-migration": "digest_migrated",
        replace: "source_changed",
        truncate: "source_changed",
        mutate: "source_changed",
      }[row.f.event];
      if (reason) {
        assert.equal(s.epoch, initial.epoch + 1);
        assert.equal(s.status, reason);
        assert.equal(s.skipped[reason], s.offset);
        assert.equal(s.accepted, 0);
      } else assert.equal(s.epoch, initial.epoch);
      observed.cursor = "eof";
    } else if (
      ["timeout", "processing", "lost", "bad-reply", "refusal", "latch-failure"].includes(
        row.f.event,
      )
    ) {
      assert.ok(s.pending);
      observed.cursor = "batch-start";
    } else if (
      ["partial", "missing", "pause", "unsupported", "late-worker"].includes(row.f.event)
    ) {
      assert.equal(s.offset, initial.offset);
      observed.cursor = "unchanged";
    } else if (["finish", "last-hook", "new-session"].includes(row.f.event)) {
      assert.equal(
        s.offset,
        Buffer.byteLength(
          header() + Array.from({ length: 24 }, (_, i) => item(`Preference ${i}`, i)).join(""),
        ),
      );
      observed.cursor = row.f.event === "new-session" ? "old-unchanged" : "batch-end";
    } else {
      assert.equal(s.offset, Buffer.byteLength(await readFile(f.path)));
      observed.cursor = row.f.event === "crash" ? "retry-end" : "end";
    }
    if (result.status === "unsupported_format") {
      assert.equal(s.status, "unsupported_format");
      const calls = f.calls.length;
      await run();
      assert.equal(f.calls.length, calls);
      observed.worker = "disabled";
    } else if (s.pending || s.observedEnd > s.offset || s.status === "source_unavailable") {
      if (s.status === "source_unavailable") assert.equal(s.unconfirmedTail, true);
      observed.worker = "pending";
    } else {
      assert.equal(s.pending, null);
      assert.equal(s.observedEnd, s.offset);
      observed.worker = "idle";
    }
    assertEveryMutation(
      { cursor: row.cursor, sent: row.sent, worker: row.worker, refusal: row.refusal },
      observed,
      results,
    );
    if (row.cursor === "batch-start") {
      const acknowledged = row.f.batch === "first" ? 0 : row.f.batch === "middle" ? 24 : 48;
      const end = Buffer.byteLength(
        header() +
          Array.from({ length: acknowledged }, (_, i) => item(`Preference ${i}`, i)).join(""),
      );
      assert.equal(s.offset, end);
      const ids = f.calls.map((x) => x.event_id);
      f.clear();
      if (row.f.event === "refusal") await f.guard.resume();
      // explicit repair/reset required, no automatic retry
      if (["bad-reply", "latch-failure"].includes(row.f.event)) return;
      await run();
      const replay = f.calls[ids.length];
      assert.equal(replay.event_id, ids.at(-1));
    }
    if (["last-hook", "new-session"].includes(row.f.event)) {
      const frozen = await f.stateBytes();
      if (row.f.event === "new-session") {
        const newSession = "22222222-2222-4222-8222-222222222222";
        const path = f.path + ".next";
        await writeFile(
          path,
          (header() + item("New conversation")).replaceAll(f.binding.sessionId, newSession),
        );
        await runWorker(
          { ...f.binding, path, sessionId: newSession },
          { guard: f.guard, transport: f.transport, mode: "local-stub" },
        );
      }
      assert.equal(await f.stateBytes(), frozen);
      assert.ok(s.pending);
      assert.equal(s.unconfirmedTail, true);
    }
  });
