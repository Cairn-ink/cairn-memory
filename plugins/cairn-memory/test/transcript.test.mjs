import assert from "node:assert/strict";
import { access, mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createTestWorkspace } from "../../../tools/testing/workspace.mjs";
import { installId, opaqueProjectId } from "../lib/identity.mjs";
import { redactSecrets } from "../lib/redact.mjs";
import {
  captureEventId,
  legacyTranscriptMessages,
  MACHINE_TEXT_PREFIXES,
  machineUserRecord,
  transcriptMessages,
  TYPED_PROMPT_SOURCES,
} from "../lib/transcript.mjs";

test("transcript parser allowlists only user and assistant text", () => {
  const jsonl = [
    JSON.stringify({
      type: "user",
      uuid: "user-1",
      message: { content: [{ type: "text", text: "I prefer concise answers." }] },
    }),
    JSON.stringify({
      type: "user",
      uuid: "tool-with-text",
      message: {
        content: [
          { type: "text", text: "FILE SECRET" },
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
  const projectId = await opaqueProjectId(dir, cwd, { home: dir });
  const guessUsingTransmittedId = createHmac("sha256", telemetryId)
    .update(cwd)
    .digest("hex");
  assert.notEqual(projectId, guessUsingTransmittedId);
  assert.equal(await opaqueProjectId(dir, cwd, { home: dir }), projectId);
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
          content: [{ type: "text", text: "api_token=topsecretvalue123 remember concise replies" }],
        },
      }),
      JSON.stringify({
        type: "user",
        uuid: "u-http-tool",
        toolUseResult: {},
        message: { content: [{ type: "tool_result", content: "DO NOT SEND TOOL OUTPUT" }] },
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
    [fileURLToPath(new URL("../scripts/hook.mjs", import.meta.url)), "capture"],
    {
      env: {
        ...process.env,
        CLAUDE_PLUGIN_OPTION_API_ENDPOINT: `http://127.0.0.1:${address.port}`,
        CLAUDE_PLUGIN_OPTION_API_TOKEN: "test-token",
        CLAUDE_PLUGIN_OPTION_TELEMETRY: "false",
        CLAUDE_PLUGIN_DATA: join(dir, "data"),
        HOME: join(dir, "home"),
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

test("detached capture survives after its short-lived launcher exits", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "cairn-detached-test-"));
  const transcript = join(dir, "transcript.jsonl");
  await writeFile(
    transcript,
    `${JSON.stringify({
      type: "user",
      uuid: "u-detached",
      message: { content: "Remember detached capture." },
    })}\n`,
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

  const launcher = spawn(
    process.execPath,
    [fileURLToPath(new URL("../scripts/launch-capture.mjs", import.meta.url))],
    {
      env: {
        ...process.env,
        CLAUDE_PLUGIN_OPTION_API_ENDPOINT: `http://127.0.0.1:${address.port}`,
        CLAUDE_PLUGIN_OPTION_API_TOKEN: "test-token",
        CLAUDE_PLUGIN_OPTION_TELEMETRY: "false",
        CLAUDE_PLUGIN_DATA: join(dir, "data"),
        HOME: join(dir, "home"),
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  launcher.stdin.end(
    JSON.stringify({
      session_id: "session-detached",
      transcript_path: transcript,
      cwd: `/${"a".repeat(8_191)}`,
      hook_event_name: "Stop",
      last_assistant_message: "THIS RAW HOOK FIELD MUST BE DISCARDED",
    }),
  );
  const exitCode = await new Promise((resolve) => launcher.on("exit", resolve));
  assert.equal(exitCode, 0);

  for (let attempt = 0; attempt < 50 && !received; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(received.messages[0].content, "Remember detached capture.");
  assert.equal(JSON.stringify(received).includes("RAW HOOK FIELD"), false);
  assert.match(received.project_id, /^[a-f0-9]{64}$/);
  await assert.rejects(access(join(dir, "data", "queue")));
});

test("a recall outage fails open with a successful, silent hook exit", async (t) => {
  const workspace = createTestWorkspace(t, { prefix: "cairn-outage-home-" });
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("../scripts/hook.mjs", import.meta.url)), "recall"],
    {
      env: {
        ...process.env,
        HOME: workspace.path,
        CLAUDE_PLUGIN_DATA: undefined,
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

const userRecord = (index, fields) =>
  JSON.stringify({ type: "user", uuid: `record-${index}`, ...fields });

test("0.1.1 drops every machine-generated user record kind", () => {
  const cases = [
    ["meta", { isMeta: true, message: { content: "<local-command-caveat>Caveat: MACHINE-1</local-command-caveat>" } }],
    ["meta", { isMeta: true, message: { content: "[Image: source: /synthetic/MACHINE-2.png]" } }],
    ["compact-summary", {
      isCompactSummary: true,
      isVisibleInTranscriptOnly: true,
      message: { content: "This session is being continued from a previous conversation. MACHINE-3" },
    }],
    ["tool-result", { toolUseResult: {}, message: { content: [{ type: "tool_result", content: "MACHINE-4" }] } }],
    ["tool-result", { message: { content: [{ type: "text", text: "MACHINE-5" }, { type: "tool_result", content: "x" }] } }],
    ...MACHINE_TEXT_PREFIXES.map((prefix, index) => [
      "machine-wrapper",
      { message: { content: `${prefix}MACHINE-prefix-${index}` } },
    ]),
    ["machine-wrapper", { message: { content: "  \n<command-name>/model</command-name> MACHINE-6" } }],
    ["machine-wrapper", { message: { content: [{ type: "text", text: "<local-command-stdout>MACHINE-7</local-command-stdout>" }] } }],
    // An unknown promptSource value does not mark a typed prompt.
    ["machine-wrapper", { promptSource: "replay", message: { content: "<bash-input>MACHINE-8</bash-input>" } }],
    // Structural flags win even when promptSource claims a typed prompt.
    ["meta", { isMeta: true, promptSource: "typed", message: { content: "MACHINE-9" } }],
    ["tool-result", { promptSource: "sdk", toolUseResult: {}, message: { content: [{ type: "text", text: "MACHINE-10" }] } }],
  ];
  for (const [index, [reason, fields]] of cases.entries()) {
    const line = userRecord(index, fields);
    assert.equal(machineUserRecord(JSON.parse(line)), reason, line);
    assert.deepEqual(transcriptMessages(line, "session"), [], line);
  }
  const all = cases.map(([, fields], index) => userRecord(index, fields)).join("\n");
  assert.equal(JSON.stringify(transcriptMessages(all, "session")).includes("MACHINE-"), false);
  // 0.1.0 sent the text of these records; the difference is the D1 exception.
  assert.ok(legacyTranscriptMessages(all, "session").length > 15);
});

test("typed prompts are kept exactly as 0.1.0 parsed them, with or without promptSource", () => {
  const typed = [
    { message: { content: "Plain typed prompt without promptSource." } },
    { promptSource: "sdk", turnOrigin: "sdk", message: { content: "Print-mode typed prompt." } },
    { promptSource: "typed", turnOrigin: "human", message: { content: "Interactive typed prompt." } },
    { promptSource: "typed", message: { content: "<command-name> typed literally by the person" } },
    { promptSource: "sdk", message: { content: "<local-command-stdout> pasted on purpose" } },
    { message: { content: "<note> starts with a bracket that is not a wrapper" } },
    { message: { content: "請用繁體中文回答，並保持簡潔。" } },
    { message: { content: "Please explain what command-name means in a Claude transcript." } },
    { promptSource: "typed", message: { content: [{ type: "text", text: "Array-form typed prompt." }] } },
  ];
  const jsonl = typed.map((fields, index) => userRecord(index, fields)).join("\n");
  for (const fields of typed) assert.equal(machineUserRecord({ type: "user", ...fields }), null);
  const kept = transcriptMessages(jsonl, "session");
  assert.equal(kept.length, typed.length);
  assert.deepEqual(kept, legacyTranscriptMessages(jsonl, "session"));
  assert.deepEqual(TYPED_PROMPT_SOURCES, ["sdk", "typed"]);
});

test("kept records keep 0.1.0 redaction, the 20,000-character cap and id derivation", () => {
  const jsonl = [
    JSON.stringify({ type: "user", message: { content: `api_token=topsecretvalue123 ${"x".repeat(25_000)}` } }),
    JSON.stringify({ type: "user", isMeta: true, message: { content: "MACHINE caveat between typed records" } }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Reply." }, { type: "thinking", thinking: "hidden" }] } }),
  ].join("\n");
  const kept = transcriptMessages(jsonl, "session-cap");
  const legacy = legacyTranscriptMessages(jsonl, "session-cap");
  assert.deepEqual(kept, [legacy[0], legacy[2]]);
  assert.equal(kept[0].content.length, 20_000);
  assert.ok(kept[0].content.startsWith("api_token=[REDACTED] "));
  assert.match(kept[0].id, /^[a-f0-9]{64}$/);
  assert.equal(captureEventId("session-cap", kept), captureEventId("session-cap", [legacy[0], legacy[2]]));
});
