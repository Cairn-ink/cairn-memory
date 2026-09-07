import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const hook = fileURLToPath(new URL("../scripts/hook.mjs", import.meta.url));

function record(id, content) {
  return `${JSON.stringify({
    type: "user",
    uuid: id,
    message: { content },
  })}\n`;
}

function startHook(action, input, env) {
  const child = spawn(process.execPath, [hook, action], {
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  child.stdin.end(input === undefined ? "" : JSON.stringify(input));
  return {
    child,
    completed: new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => {
        try {
          assert.equal(code, 0, stderr);
          resolve(stdout);
        } catch (error) {
          reject(error);
        }
      });
    }),
  };
}

async function runHook(action, input, env) {
  return startHook(action, input, env).completed;
}

test("paused transcript text is never backfilled after resume", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "cairn-pause-boundary-test-"));
  const dataDir = join(dir, "data");
  const transcript = join(dir, "transcript.jsonl");
  await writeFile(transcript, record("before", "captured before pause"));

  const requests = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      if (request.url === "/api/memory/capture") requests.push(JSON.parse(body));
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"duplicate":false,"memoryCount":1}');
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.equal(typeof address, "object");
  const env = {
    CLAUDE_PLUGIN_OPTION_API_ENDPOINT: `http://127.0.0.1:${address.port}`,
    CLAUDE_PLUGIN_OPTION_API_TOKEN: "test-token",
    CLAUDE_PLUGIN_OPTION_TELEMETRY: "false",
    CLAUDE_PLUGIN_DATA: dataDir,
  };
  const event = {
    session_id: "pause-session",
    transcript_path: transcript,
    cwd: "/private/project",
  };

  await runHook("capture", event, env);
  await runHook("pause", undefined, env);
  await appendFile(transcript, record("paused", "must never leave the machine"));
  await runHook("capture", event, env);
  await runHook("resume", undefined, env);
  await appendFile(transcript, record("early-resumed", "conservatively skipped at boundary"));
  await runHook("capture", event, env);

  assert.equal(requests.length, 1);
  assert.equal(requests[0].messages[0].id, "before");

  await appendFile(transcript, record("after", "captured after boundary"));
  await runHook("capture", event, env);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].messages.map((message) => message.id), ["after"]);

  const sessionFiles = (await readdir(join(dataDir, "sessions"))).filter((name) =>
    name.endsWith(".json"),
  );
  assert.equal(sessionFiles.length, 1);
  const persisted = [
    await readFile(join(dataDir, "control.json"), "utf8"),
    await readFile(join(dataDir, "sessions", sessionFiles[0]), "utf8"),
  ].join("\n");
  assert.equal(persisted.includes("must never leave"), false);
  assert.equal(persisted.includes(transcript), false);
  assert.equal(persisted.includes("pause-session"), false);
});

test("a line spanning the pause boundary is discarded through its newline", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "cairn-pause-partial-test-"));
  const transcript = join(dir, "transcript.jsonl");
  await writeFile(transcript, "");
  const requests = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      if (request.url === "/api/memory/capture") requests.push(JSON.parse(body));
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"duplicate":false,"memoryCount":1}');
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address();
  const env = {
    CLAUDE_PLUGIN_OPTION_API_ENDPOINT: `http://127.0.0.1:${port}`,
    CLAUDE_PLUGIN_OPTION_API_TOKEN: "test-token",
    CLAUDE_PLUGIN_OPTION_TELEMETRY: "false",
    CLAUDE_PLUGIN_DATA: join(dir, "data"),
  };
  const event = {
    session_id: "partial-session",
    transcript_path: transcript,
    cwd: "/private/project",
  };
  const pausedRecord = record("partial-paused", "paused partial secret");
  const split = Math.floor(pausedRecord.length / 2);

  await runHook("pause", undefined, env);
  await appendFile(transcript, pausedRecord.slice(0, split));
  await runHook("resume", undefined, env);
  await runHook("capture", event, env);
  await appendFile(
    transcript,
    pausedRecord.slice(split) + record("after-partial", "safe later message"),
  );
  await runHook("capture", event, env);

  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].messages.map((message) => message.id), ["after-partial"]);
  assert.equal(JSON.stringify(requests).includes("paused partial secret"), false);
});

test("a delayed pre-pause worker is rejected after resume", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "cairn-delayed-worker-test-"));
  const transcript = join(dir, "transcript.jsonl");
  await writeFile(transcript, record("delayed", "queued before pause"));
  let captureCount = 0;
  const server = createServer((request, response) => {
    if (request.url === "/api/memory/capture") captureCount += 1;
    request.resume();
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"duplicate":false,"memoryCount":1}');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address();
  const env = {
    CLAUDE_PLUGIN_OPTION_API_ENDPOINT: `http://127.0.0.1:${port}`,
    CLAUDE_PLUGIN_OPTION_API_TOKEN: "test-token",
    CLAUDE_PLUGIN_OPTION_TELEMETRY: "false",
    CLAUDE_PLUGIN_DATA: join(dir, "data"),
  };
  await runHook("pause", undefined, env);
  await runHook("resume", undefined, env);
  await runHook(
    "capture-detached",
    {
      session_id: "delayed-session",
      transcript_path: transcript,
      cwd: "/private/project",
      capture_generation: "initial",
    },
    env,
  );
  assert.equal(captureCount, 0);

  const event = {
    session_id: "delayed-session",
    transcript_path: transcript,
    cwd: "/private/project",
  };
  await runHook("capture", event, env); // Establish the post-resume boundary.
  await appendFile(transcript, record("later", "must require a worker generation"));
  for (const capture_generation of [undefined, null, 42, {}, ""]) {
    await runHook("capture-detached", { ...event, capture_generation }, env);
  }
  assert.equal(captureCount, 0, "malformed worker handoffs cannot adopt the current generation");
  await runHook("capture", event, env);
  assert.equal(captureCount, 1, "direct capture still handles current-generation input");
});

test("pause returns while an initiated request is in flight and stops later batches", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "cairn-pause-inflight-test-"));
  const transcript = join(dir, "transcript.jsonl");
  await writeFile(
    transcript,
    Array.from({ length: 25 }, (_, index) => record(`slow-${index}`, `message ${index}`)).join(""),
  );
  const requests = [];
  let releaseFirst;
  let sawFirst;
  const firstRequest = new Promise((resolve) => (sawFirst = resolve));
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      if (request.url !== "/api/memory/capture") return;
      requests.push(JSON.parse(body));
      if (requests.length === 1) {
        releaseFirst = () => {
          response.writeHead(200, { "content-type": "application/json" });
          response.end('{"duplicate":false,"memoryCount":1}');
        };
        sawFirst();
      } else {
        response.writeHead(200, { "content-type": "application/json" });
        response.end('{"duplicate":false,"memoryCount":1}');
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address();
  const env = {
    CLAUDE_PLUGIN_OPTION_API_ENDPOINT: `http://127.0.0.1:${port}`,
    CLAUDE_PLUGIN_OPTION_API_TOKEN: "test-token",
    CLAUDE_PLUGIN_OPTION_TELEMETRY: "false",
    CLAUDE_PLUGIN_DATA: join(dir, "data"),
  };
  const event = {
    session_id: "inflight-session",
    transcript_path: transcript,
    cwd: "/private/project",
  };
  const capture = startHook("capture", event, env);
  await firstRequest;
  const startedAt = Date.now();
  await runHook("pause", undefined, env);
  assert.ok(Date.now() - startedAt < 1_000);
  releaseFirst();
  await capture.completed;
  assert.equal(requests.length, 1);
  assert.equal(requests[0].messages.length, 24);

  await runHook("resume", undefined, env);
  await runHook("capture", event, env);
  assert.equal(requests.length, 1);
});

test("a failed partial batch retries an immutable window before newer text", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "cairn-partial-retry-test-"));
  const transcript = join(dir, "transcript.jsonl");
  await writeFile(
    transcript,
    Array.from({ length: 25 }, (_, index) => record(`retry-${index}`, `message ${index}`)).join(""),
  );
  const requests = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      if (request.url !== "/api/memory/capture") return;
      requests.push(JSON.parse(body));
      if (requests.length === 2) {
        response.writeHead(500);
        response.end("retry");
      } else {
        response.writeHead(200, { "content-type": "application/json" });
        response.end('{"duplicate":false,"memoryCount":1}');
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address();
  const env = {
    CLAUDE_PLUGIN_OPTION_API_ENDPOINT: `http://127.0.0.1:${port}`,
    CLAUDE_PLUGIN_OPTION_API_TOKEN: "test-token",
    CLAUDE_PLUGIN_OPTION_TELEMETRY: "false",
    CLAUDE_PLUGIN_DATA: join(dir, "data"),
  };
  const event = {
    session_id: "retry-session",
    transcript_path: transcript,
    cwd: "/private/project",
  };

  await runHook("capture", event, env);
  await appendFile(transcript, record("retry-new", "new after failure"));
  await runHook("capture", event, env);
  await runHook("capture", event, env);

  assert.deepEqual(requests.map((request) => request.messages.length), [24, 1, 24, 1, 1]);
  assert.equal(requests[0].event_id, requests[2].event_id);
  assert.equal(requests[1].event_id, requests[3].event_id);
  assert.deepEqual(requests[3].messages.map((message) => message.id), ["retry-24"]);
  assert.deepEqual(requests[4].messages.map((message) => message.id), ["retry-new"]);
});

test("concurrent workers serialize one session and advance its cursor once", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "cairn-concurrent-capture-test-"));
  const transcript = join(dir, "transcript.jsonl");
  await writeFile(transcript, record("concurrent", "capture exactly once"));
  let captureCount = 0;
  const server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      if (request.url !== "/api/memory/capture") return;
      captureCount += 1;
      setTimeout(() => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end('{"duplicate":false,"memoryCount":1}');
      }, 80);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address();
  const env = {
    CLAUDE_PLUGIN_OPTION_API_ENDPOINT: `http://127.0.0.1:${port}`,
    CLAUDE_PLUGIN_OPTION_API_TOKEN: "test-token",
    CLAUDE_PLUGIN_OPTION_TELEMETRY: "false",
    CLAUDE_PLUGIN_DATA: join(dir, "data"),
  };
  const event = {
    session_id: "concurrent-session",
    transcript_path: transcript,
    cwd: "/private/project",
  };

  const first = startHook("capture", event, env);
  const second = startHook("capture", event, env);
  await Promise.all([first.completed, second.completed]);
  assert.equal(captureCount, 1);
});
