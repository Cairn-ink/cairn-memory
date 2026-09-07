import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { prepareRecallQuery } from "../lib/recall-query.mjs";

const hookPath = fileURLToPath(new URL("../scripts/hook.mjs", import.meta.url));

async function localRecallServer(t, reply = () => ({ memories: [] })) {
  const requests = [];
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => (body += chunk));
    request.on("end", async () => {
      requests.push({
        headers: request.headers,
        path: request.url,
        body: JSON.parse(body),
      });
      const result = await reply();
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(result));
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => server.close());
  const address = server.address();
  assert.equal(typeof address, "object");
  return { endpoint: `http://127.0.0.1:${address.port}`, requests };
}

async function runRecall({ endpoint, dataDir, prompt, action = "recall" }) {
  const child = spawn(process.execPath, [hookPath, action], {
    env: {
      ...process.env,
      CLAUDE_PLUGIN_OPTION_API_ENDPOINT: endpoint,
      CLAUDE_PLUGIN_OPTION_API_TOKEN: "test-token",
      CLAUDE_PLUGIN_OPTION_TELEMETRY: "false",
      CLAUDE_PLUGIN_DATA: dataDir,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  child.stdin.end(
    JSON.stringify({
      session_id: "session-recall",
      prompt,
      cwd: "/private/project",
      hook_event_name: "UserPromptSubmit",
    }),
  );
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  return { exitCode, stderr, stdout };
}

test("prepareRecallQuery skips empty and non-string prompts", () => {
  assert.equal(prepareRecallQuery(undefined), undefined);
  assert.equal(prepareRecallQuery(null), undefined);
  assert.equal(prepareRecallQuery(42), undefined);
  assert.equal(prepareRecallQuery(" \n\t"), undefined);
});

test("recall hook redacts supported credentials before sending the query", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "cairn-recall-test-"));
  const server = await localRecallServer(t);
  const result = await runRecall({
    endpoint: server.endpoint,
    dataDir: join(dir, "data"),
    prompt: "Please use api_token=topsecretvalue123 and remember concise replies",
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(server.requests.length, 1);
  assert.equal(
    server.requests[0].body.query,
    "Please use api_token=[REDACTED] and remember concise replies",
  );
  assert.equal(JSON.stringify(server.requests[0]).includes("topsecretvalue123"), false);
});

test("recall redacts before truncating Unicode at the 4,000-unit host boundary", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "cairn-recall-boundary-test-"));
  const server = await localRecallServer(t);
  const prompt = `${"🙂".repeat(1_990)}api_token=topsecretvalue123 trailing text`;
  const result = await runRecall({
    endpoint: server.endpoint,
    dataDir: join(dir, "data"),
    prompt,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(server.requests.length, 1);
  const query = server.requests[0].body.query;
  assert.ok(query.length <= 4_000);
  assert.ok(Array.from(query).length <= 4_000);
  assert.equal(query, `${"🙂".repeat(1_990)}api_token=[REDACTED]`);
  assert.equal(query.includes("topsecretvalue123"), false);
});

test("recall hook skips an empty query", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "cairn-recall-empty-test-"));
  const server = await localRecallServer(t);
  const result = await runRecall({
    endpoint: server.endpoint,
    dataDir: join(dir, "data"),
    prompt: "   \n\t",
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
  assert.equal(server.requests.length, 0);
});

test("a recall outage fails open with a successful, silent hook exit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cairn-recall-outage-test-"));
  const result = await runRecall({
    endpoint: "http://127.0.0.1:9",
    dataDir: join(dir, "data"),
    prompt: "What do I prefer?",
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

test("recall started before pause cannot inject after pause and resume", { timeout: 5_000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "cairn-recall-pause-test-"));
  let arrived;
  const received = new Promise(resolve => arrived = resolve);
  let release;
  const pending = new Promise(resolve => release = resolve);
  t.after(() => release({ memories: [] }));
  const server = await localRecallServer(t, () => {
    arrived();
    return pending;
  });
  const options = { endpoint: server.endpoint, dataDir: join(dir, "data") };
  const running = runRecall({ ...options, prompt: "What do I prefer?" });
  await received;
  const paused = await runRecall({ ...options, action: "pause" });
  assert.match(paused.stdout, /paused/);
  const resumed = await runRecall({ ...options, action: "resume" });
  assert.match(resumed.stdout, /active/);
  release({ memories: [{ id: "synthetic-memory", content: "stale recall context", origin: "explicit", scope: "personal", confidence: 1 }] });
  const result = await running;
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});
