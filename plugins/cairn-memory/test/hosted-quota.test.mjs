import assert from "node:assert/strict";
import test from "node:test";
import { watch, openSync, closeSync, writeFileSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile, appendFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestWorkspace } from "../../../tools/testing/workspace.mjs";
import { createHostedTransport, hostedTargetId, hostedQuotaStatus } from "../lib/http.mjs";
import { captureCursorPath } from "../lib/capture-cursor.mjs";

const hook = fileURLToPath(new URL("../scripts/hook.mjs", import.meta.url));
async function fixture(t) {
  const workspace = createTestWorkspace(t, { prefix: "plugin-quota-" });
  const home = join(workspace.path, "home"); const root = join(home, "data");
  await mkdir(root, { recursive: true, mode: 0o700 });
  await writeFile(join(root, "project-key"), "12345678-1234-4234-8234-123456789abc\n",
    { mode: 0o600 });
  const transcript = join(home, "synthetic.jsonl");
  await writeFile(transcript, JSON.stringify({ type: "user", uuid: "synthetic-message",
    message: { content: "Synthetic first message" } }) + "\n");
  const requests = []; let status = 429; let body = { error: "quota_reached" };
  let held = false; const releases = []; const observers = [];
  const endpoint = "https://synthetic.invalid";
  const token = "synthetic-token";
  const input = { session_id: "synthetic-session", transcript_path: transcript,
    cwd: "/synthetic/project", prompt: "Synthetic question" };
  const cursor = captureCursorPath(root, input.session_id);
  function serve(url, bytes, reply) {
    const path = new URL(url).pathname;
    requests.push({ path, body: JSON.parse(bytes) });
    for (const observe of observers) observe();
    const send = () => reply({ status, body: typeof body === "function" ? body(path) : body });
    if (held && path.endsWith("capture")) releases.push(send); else send();
  }
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (url, options) => new Promise((resolve) => serve(url, options.body,
    (reply) => resolve(Response.json(reply.body, { status: reply.status }))));
  workspace.defer(() => { globalThis.fetch = originalFetch; });
  const peer = join(home, "peer"); await mkdir(peer, { mode: 0o700 });
  const seenFiles = new Set();
  const watcher = watch(peer, async (_, name) => {
    if (!/^request-.*\.json$/.test(name ?? "") || seenFiles.has(name)) return;
    seenFiles.add(name);
    const request = JSON.parse(await readFile(join(peer, name), "utf8"));
    serve(request.url, request.body, async (reply) => {
      const path = join(peer, `reply-${request.id}.json`);
      await writeFile(path + ".tmp", JSON.stringify(reply), { mode: 0o600 });
      await rename(path + ".tmp", path);
    });
  });
  workspace.defer(() => watcher.close());
  let sequence = 0;
  function start(action) {
    const stem = join(home, `hook-${++sequence}`);
    writeFileSync(stem + ".in", JSON.stringify(input), { mode: 0o600 });
    const descriptors = [openSync(stem + ".in", "r"), openSync(stem + ".out", "wx", 0o600),
      openSync(stem + ".err", "wx", 0o600)];
    const child = spawn(process.execPath, ["--import", fileURLToPath(new URL("./fixtures/hosted-fetch-preload.mjs", import.meta.url)), hook, action], {
      env: { PATH: process.env.PATH, HOME: home, CAIRN_TEST_REAL_HOME: process.env.CAIRN_TEST_REAL_HOME,
        CAIRN_TEST_HOSTED_PEER: peer, CLAUDE_PLUGIN_DATA: root, CLAUDE_PLUGIN_OPTION_API_ENDPOINT: endpoint,
        CLAUDE_PLUGIN_OPTION_API_TOKEN: token, CLAUDE_PLUGIN_OPTION_TELEMETRY: "false" },
      stdio: descriptors,
    });
    for (const fd of descriptors) closeSync(fd);
    const done = new Promise((resolve, reject) => {
      child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal }));
    });
    workspace.defer(async () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await done; });
    return { child, done, output: () => ({ stdout: readFileSync(stem + ".out", "utf8"),
      stderr: readFileSync(stem + ".err", "utf8") }) };
  }
  async function run(action) {
    const pending = start(action); const { code } = await pending.done;
    assert.equal(code, 0, pending.output().stderr); return pending.output().stdout;
  }
  const options = { home, root, endpoint, token };
  return { run, start, cursor, transcript, requests, options,
    hold: () => { held = true; }, release: () => { held = false; for (const release of releases.splice(0)) release(); },
    seen: (count) => new Promise((resolve) => { const observe = () => { if (requests.length >= count) resolve(); }; observers.push(observe); observe(); }),
    target: { root, targetId: hostedTargetId(options) },
    respond: (nextStatus, nextBody) => { status = nextStatus; body = nextBody; } };
}

test("Capture refusal retains frozen cursor/event through Codex, restarts and single resume", async (t) => {
  const f = await fixture(t);
  await f.run("capture");
  const frozen = await readFile(f.cursor, "utf8"); const initial = JSON.parse(frozen);
  assert.equal(initial.offset, 0); assert.ok(initial.pendingEnd > 0);
  await appendFile(f.transcript, JSON.stringify({ type: "assistant", uuid: "later-message",
    message: { content: "Synthetic later message" } }) + "\n");
  const codex = createHostedTransport(f.options);
  assert.equal((await codex.capture([{ id: "synthetic", role: "user", content: "Synthetic" }],
    { sessionId: "codex-session" }, "synthetic-event")).status, "quota_reached");
  await f.run("capture");
  assert.equal(f.requests.length, 1);
  assert.equal(await readFile(f.cursor, "utf8"), frozen);
  assert.match(await f.run("status"), /quota_reached; reset unknown/);
  assert.match(await f.run("resume"), /one eligible attempt/);
  await f.run("capture"); await f.run("capture");
  assert.equal(f.requests.length, 2);
  assert.deepEqual(f.requests[1].body, f.requests[0].body);
  assert.equal(await readFile(f.cursor, "utf8"), frozen);
  await f.run("resume");
  f.respond(200, { duplicate: false, memoryCount: 1 });
  await f.run("capture");
  assert.deepEqual(f.requests[2].body, f.requests[0].body);
  assert.equal(JSON.parse(await readFile(f.cursor, "utf8")).offset, initial.pendingEnd);
  await f.run("capture");
  assert.deepEqual(f.requests[3].body.messages.map((m) => m.content), ["Synthetic later message"]);
});
test("Codex capture refusal suppresses upgraded Claude capture after restart", async (t) => {
  const f = await fixture(t);
  const codex = createHostedTransport(f.options);
  const reply = await codex.capture([{ id: "message", role: "user", content: "Synthetic" }],
    { sessionId: "codex-session" }, "synthetic-event");
  assert.equal(reply.status, "quota_reached");
  await f.run("capture"); await f.run("capture");
  assert.equal(f.requests.length, 1);
  assert.equal(JSON.parse(await readFile(f.cursor, "utf8")).offset, 0);
  assert.match(await f.run("status"), /reset unknown/);
});
test("validated reset is shown; early resume cannot dispatch or discard pending text", async (t) => {
  const f = await fixture(t); const resetAt = "2099-01-01T00:00:00Z";
  f.respond(429, { error: "quota_reached", resetAt }); await f.run("capture");
  const frozen = await readFile(f.cursor, "utf8");
  assert.match(await f.run("status"), /2099-01-01T00:00:00Z/);
  assert.match(await f.run("resume"), /quota_reached/);
  await f.run("capture"); assert.equal(f.requests.length, 1);
  assert.equal(await readFile(f.cursor, "utf8"), frozen);
});
test("unrecognized 429 is no acknowledgement and stops hook retries", async (t) => {
  const f = await fixture(t);
  f.respond(429, { error: "Synthetic legacy refusal", code: "daily_quota_memory_capture" });
  await f.run("capture"); const frozen = await readFile(f.cursor, "utf8");
  await f.run("capture");
  assert.equal(f.requests.length, 1);
  assert.equal((await hostedQuotaStatus(f.target)).operations.capture.mode, "cooldown");
  assert.equal(JSON.parse(frozen).offset, 0);
  assert.equal(await readFile(f.cursor, "utf8"), frozen);
});
test("one resume resumes pause and grants every eligible operation a permit", async (t) => {
  const f = await fixture(t); await f.run("capture"); await f.run("pause");
  const before = JSON.parse(await readFile(join(f.options.root, "control.json"), "utf8"));
  assert.match(await f.run("resume"), /capture: one eligible attempt/);
  const after = JSON.parse(await readFile(join(f.options.root, "control.json"), "utf8"));
  assert.equal(after.paused, false); assert.equal(after.generation, before.generation);
  assert.equal((await hostedQuotaStatus(f.target)).operations.capture.mode, "ready");
});
test("malformed success and processing both leave the capture cursor pending", async (t) => {
  const f = await fixture(t); f.respond(200, { accepted: true });
  await f.run("capture"); const frozen = await readFile(f.cursor, "utf8");
  assert.equal(JSON.parse(frozen).offset, 0);
  f.respond(200, { duplicate: false, memoryCount: 0, processing: true });
  await f.run("capture"); assert.equal(await readFile(f.cursor, "utf8"), frozen);
  f.respond(200, { duplicate: true, memoryCount: 0 }); await f.run("capture");
  assert.ok(JSON.parse(await readFile(f.cursor, "utf8")).offset > 0);
});

for (const signal of ["SIGTERM", "SIGKILL"]) {
  test(`R01 real ${signal} mid-request leaves frozen batch retryable by the next hook`, { timeout: 15000 }, async (t) => {
    const f = await fixture(t); f.respond(200, { duplicate: false, memoryCount: 1 }); f.hold();
    const pending = f.start("capture"); await f.seen(1);
    const frozen = await readFile(f.cursor, "utf8");
    pending.child.kill(signal); assert.equal((await pending.done).signal, signal); f.release();
    assert.equal((await hostedQuotaStatus(f.target)).operations.capture.mode, "open");
    await f.run("capture"); assert.equal(f.requests.length, 2);
    assert.deepEqual(f.requests[1].body, f.requests[0].body);
    assert.equal(JSON.parse(frozen).offset, 0);
    assert.equal(JSON.parse(await readFile(f.cursor, "utf8")).offset, JSON.parse(frozen).pendingEnd);
  });
}
test("R07 SIGKILL of resumed hook restores refusal; next resume grants a fresh attempt", { timeout: 15000 }, async (t) => {
  const f = await fixture(t); await f.run("capture"); await f.run("resume"); f.hold();
  const pending = f.start("capture"); await f.seen(2);
  assert.match(await f.run("resume"), /capture: busy/);
  pending.child.kill("SIGKILL"); await pending.done; f.release();
  assert.equal((await hostedQuotaStatus(f.target)).operations.capture.mode, "quota_reached");
  await f.run("capture"); assert.equal(f.requests.length, 2);
  await f.run("resume"); f.respond(200, { duplicate: false, memoryCount: 1 });
  await f.run("capture"); assert.equal(f.requests.length, 3);
  assert.deepEqual(f.requests[2].body, f.requests[0].body);
});
test("R14 a real recall hook sends during an in-flight capture hook", { timeout: 15000 }, async (t) => {
  const f = await fixture(t);
  f.respond(200, (path) => path.endsWith("recall") ? { memories: [] } : { duplicate: false, memoryCount: 1 });
  f.hold(); const pending = f.start("capture"); await f.seen(1);
  try {
    await f.run("recall"); assert.equal(f.requests.length, 2);
    assert.equal(f.requests[1].path, "/api/memory/recall");
  } finally { f.release(); await pending.done; }
});
test("R13 plugin status provides repair hint and resume repairs corrupt state with exit zero", async (t) => {
  const f = await fixture(t); await f.run("capture");
  const path = join(f.target.root, "hosted-quota", `${f.target.targetId}.json`);
  await writeFile(path, "{", { mode: 0o600 });
  assert.match(await f.run("status"), /quota_state_invalid; run resume/);
  await f.run("capture"); assert.equal(f.requests.length, 1);
  assert.match(await f.run("resume"), /quota state repaired to open/);
  f.respond(200, { duplicate: false, memoryCount: 1 }); await f.run("capture");
  assert.equal(f.requests.length, 2); assert.deepEqual(f.requests[1].body, f.requests[0].body);
});
test("R12 plugin resume clears an unknown-429 cooldown and retains the frozen batch", async (t) => {
  const f = await fixture(t); f.respond(429, { error: "legacy rate limit" }); await f.run("capture");
  const frozen = await readFile(f.cursor, "utf8");
  assert.match(await f.run("status"), /capture: cooldown; retry after/);
  await f.run("capture"); assert.equal(f.requests.length, 1);
  await f.run("resume"); f.respond(200, { duplicate: false, memoryCount: 1 }); await f.run("capture");
  assert.equal(f.requests.length, 2); assert.deepEqual(f.requests[1].body, f.requests[0].body);
  assert.equal(JSON.parse(await readFile(f.cursor, "utf8")).offset, JSON.parse(frozen).pendingEnd);
});
