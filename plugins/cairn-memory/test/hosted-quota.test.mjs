import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, writeFile, readFile, appendFile } from "node:fs/promises";
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
  const server = createServer(async (request, response) => {
    let bytes = ""; for await (const chunk of request) bytes += chunk;
    requests.push({ path: request.url, body: JSON.parse(bytes) });
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  workspace.defer(() => new Promise((resolve) => server.close(resolve)));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const token = "synthetic-token";
  const input = { session_id: "synthetic-session", transcript_path: transcript,
    cwd: "/synthetic/project", prompt: "Synthetic question" };
  const cursor = captureCursorPath(root, input.session_id);
  async function run(action) {
    const child = spawn(process.execPath, [hook, action], {
      env: { PATH: process.env.PATH, HOME: home, CAIRN_TEST_REAL_HOME: process.env.CAIRN_TEST_REAL_HOME,
        CLAUDE_PLUGIN_DATA: root, CLAUDE_PLUGIN_OPTION_API_ENDPOINT: endpoint,
        CLAUDE_PLUGIN_OPTION_API_TOKEN: token, CLAUDE_PLUGIN_OPTION_TELEMETRY: "false" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (bytes) => { stdout += bytes; });
    child.stderr.on("data", (bytes) => { stderr += bytes; });
    child.stdin.end(JSON.stringify(input));
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject); child.once("close", resolve);
    });
    assert.equal(code, 0, stderr); return stdout;
  }
  const options = { home, root, endpoint, token };
  return { run, cursor, transcript, requests, options,
    target: { root, targetId: hostedTargetId(options) },
    respond: (nextStatus, nextBody) => { status = nextStatus; body = nextBody; } };
}

test("Claude refusal retains frozen cursor/event through Codex, restarts and single resume", async (t) => {
  const f = await fixture(t);
  await f.run("capture");
  const frozen = await readFile(f.cursor, "utf8"); const initial = JSON.parse(frozen);
  assert.equal(initial.offset, 0); assert.ok(initial.pendingEnd > 0);
  await appendFile(f.transcript, JSON.stringify({ type: "assistant", uuid: "later-message",
    message: { content: "Synthetic later message" } }) + "\n");
  const codex = createHostedTransport(f.options);
  assert.equal((await codex.recall("Synthetic")).status, "quota_reached");
  await f.run("capture"); await f.run("recall");
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
test("Codex refusal suppresses upgraded Claude capture/recall after restart", async (t) => {
  const f = await fixture(t);
  const codex = createHostedTransport(f.options);
  const reply = await codex.capture([{ id: "message", role: "user", content: "Synthetic" }],
    { sessionId: "codex-session" }, "synthetic-event");
  assert.equal(reply.status, "quota_reached");
  await f.run("capture"); await f.run("recall"); await f.run("capture");
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
  await f.run("capture"); await f.run("recall");
  assert.equal(f.requests.length, 1);
  assert.equal((await hostedQuotaStatus(f.target)).mode, "invalid_reply");
  assert.equal(JSON.parse(frozen).offset, 0);
  assert.equal(await readFile(f.cursor, "utf8"), frozen);
});
test("Q13 open gate: quota-only resume preserves pause and sends nothing", async (t) => {
  const f = await fixture(t); await f.run("pause");
  const openControl = await readFile(join(f.options.root, "control.json"), "utf8");
  assert.match(await f.run("resume-quota"), /pause is unchanged/);
  assert.equal(await readFile(join(f.options.root, "control.json"), "utf8"), openControl);
  await f.run("capture"); assert.equal(f.requests.length, 0);
  assert.match(await f.run("status"), /paused/);
});
test("quota resume preserves an independent global pause", async (t) => {
  const f = await fixture(t); await f.run("capture"); await f.run("pause");
  const control = await readFile(join(f.options.root, "control.json"), "utf8");
  await f.run("resume-quota");
  assert.equal(await readFile(join(f.options.root, "control.json"), "utf8"), control);
  await f.run("capture"); assert.equal(f.requests.length, 1);
  assert.match(await f.run("status"), /paused/);
  await f.run("resume");
  assert.equal(JSON.parse(await readFile(join(f.options.root, "control.json"), "utf8")).paused,
    false);
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
