import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import test from "node:test";
import { installId, opaqueProjectId } from "../lib/identity.mjs";
import { redactSecrets } from "../lib/redact.mjs";
import { captureEventId, transcriptMessages } from "../lib/transcript.mjs";

test("transcript parser allowlists only user and assistant text", () => {
  const jsonl = [
    JSON.stringify({
      type: "user",
      uuid: "user-1",
      message: {
        content: [
          { type: "text", text: "I prefer concise answers." },
          { type: "tool_result", content: "FILE SECRET" },
        ],
      },
    }),
    JSON.stringify({
      type: "assistant",
      uuid: "assistant-1",
      message: {
        content: [
          { type: "text", text: "Understood." },
          { type: "tool_use", name: "Read", input: { file_path: "/secret" } },
        ],
      },
    }),
    JSON.stringify({ type: "progress", data: "TOOL OUTPUT" }),
    JSON.stringify({
      type: "user",
      uuid: "tool-only",
      message: { content: [{ type: "tool_result", content: "MORE SECRET" }] },
    }),
  ].join("\n");
  const messages = transcriptMessages(jsonl, "session-1");
  assert.deepEqual(messages, [
    { id: "user-1", role: "user", content: "I prefer concise answers." },
    { id: "assistant-1", role: "assistant", content: "Understood." },
  ]);
  assert.equal(JSON.stringify(messages).includes("SECRET"), false);
  assert.equal(JSON.stringify(messages).includes("/secret"), false);
});

test("local redaction runs before messages leave the parser", () => {
  const jsonl = JSON.stringify({
    type: "user",
    uuid: "user-2",
    message: { content: "api_token=topsecretvalue123" },
  });
  const [message] = transcriptMessages(jsonl, "session-1");
  assert.equal(message.content, "api_token=[REDACTED]");
  assert.equal(redactSecrets("Bearer abcdefghijklmnop"), "[REDACTED]");
});

test("capture event ids are stable for retries and change with the batch", () => {
  const first = [{ id: "one" }, { id: "two" }];
  assert.equal(captureEventId("session", first), captureEventId("session", first));
  assert.notEqual(captureEventId("session", first), captureEventId("session", [{ id: "one" }]));
});

test("project identity uses a never-transmitted key separate from telemetry", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cairn-identity-test-"));
  const cwd = "/Users/private/common-project-name";
  const telemetryId = await installId(dir);
  const projectId = await opaqueProjectId(dir, cwd);
  const guessUsingTransmittedId = createHmac("sha256", telemetryId)
    .update(cwd)
    .digest("hex");
  assert.notEqual(projectId, guessUsingTransmittedId);
  assert.equal(await opaqueProjectId(dir, cwd), projectId);
});

test("capture hook redacts locally before constructing the HTTP body", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "cairn-plugin-test-"));
  const transcript = join(dir, "transcript.jsonl");
  await writeFile(
    transcript,
    [
      JSON.stringify({
        type: "user",
        uuid: "u-http",
        message: {
          content: [
            { type: "text", text: "api_token=topsecretvalue123 remember concise replies" },
            { type: "tool_result", content: "DO NOT SEND TOOL OUTPUT" },
          ],
        },
      }),
      JSON.stringify({
        type: "assistant",
        uuid: "a-http",
        message: { content: [{ type: "text", text: "I will keep replies concise." }] },
      }),
      "",
    ].join("\n"),
  );

  let received;
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      received = JSON.parse(body);
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"duplicate":false,"memoryCount":1}');
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.equal(typeof address, "object");

  const child = spawn(
    process.execPath,
    [new URL("../scripts/hook.mjs", import.meta.url).pathname, "capture"],
    {
      env: {
        ...process.env,
        CLAUDE_PLUGIN_OPTION_API_ENDPOINT: `http://127.0.0.1:${address.port}`,
        CLAUDE_PLUGIN_OPTION_API_TOKEN: "test-token",
        CLAUDE_PLUGIN_OPTION_TELEMETRY: "false",
        CLAUDE_PLUGIN_DATA: join(dir, "data"),
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  child.stdin.end(
    JSON.stringify({
      session_id: "session-http",
      transcript_path: transcript,
      cwd: "/Users/private/secret-repository-name",
      hook_event_name: "Stop",
    }),
  );
  const exitCode = await new Promise((resolve) => child.on("exit", resolve));
  assert.equal(exitCode, 0);
  assert.equal(received.messages[0].content, "api_token=[REDACTED] remember concise replies");
  assert.equal(JSON.stringify(received).includes("topsecretvalue123"), false);
  assert.equal(JSON.stringify(received).includes("TOOL OUTPUT"), false);
  assert.equal(JSON.stringify(received).includes("secret-repository-name"), false);
  assert.match(received.project_id, /^[a-f0-9]{64}$/);
});

test("a recall outage fails open with a successful, silent hook exit", async () => {
  const child = spawn(
    process.execPath,
    [new URL("../scripts/hook.mjs", import.meta.url).pathname, "recall"],
    {
      env: {
        ...process.env,
        CLAUDE_PLUGIN_OPTION_API_ENDPOINT: "http://127.0.0.1:9",
        CLAUDE_PLUGIN_OPTION_API_TOKEN: "test-token",
        CLAUDE_PLUGIN_OPTION_TELEMETRY: "false",
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  child.stdin.end(
    JSON.stringify({
      session_id: "session-outage",
      prompt: "What do I prefer?",
      cwd: "/private/project",
      hook_event_name: "UserPromptSubmit",
    }),
  );
  const exitCode = await new Promise((resolve) => child.on("exit", resolve));
  assert.equal(exitCode, 0);
  assert.equal(stdout, "");
  assert.equal(stderr, "");
});
