import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createTestWorkspace } from "../../../tools/testing/workspace.mjs";
import { captureCursorPath, readCaptureCursor, writeCaptureCursor } from "../lib/capture-cursor.mjs";
import { captureEventId, legacyTranscriptMessages, transcriptMessages } from "../lib/transcript.mjs";

const HOOK = fileURLToPath(new URL("../scripts/hook.mjs", import.meta.url));
const FIXTURES = ["claude-2.1.283-print.jsonl", "claude-2.1.283-interactive.jsonl"];

/** A receiver with capture idempotency by event id; `fail` can refuse an attempt. */
async function receiver(t, { fail = () => false } = {}) {
  const requests = [];
  const stored = new Map();
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const parsed = JSON.parse(body);
      requests.push(parsed);
      response.writeHead(fail(parsed, requests.length) ? 503 : 200, { "content-type": "application/json" });
      if (response.statusCode === 503) return response.end("{}");
      const duplicate = stored.has(parsed.event_id);
      if (!duplicate) stored.set(parsed.event_id, parsed.messages);
      response.end(JSON.stringify({ duplicate, memoryCount: duplicate ? 0 : 1 }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  return { port: server.address().port, requests, stored };
}

async function capture({ port, dataDir, transcript, sessionId }) {
  const child = spawn(process.execPath, [HOOK, "capture"], {
    env: {
      PATH: process.env.PATH,
      CLAUDE_PLUGIN_OPTION_API_ENDPOINT: `http://127.0.0.1:${port}`,
      CLAUDE_PLUGIN_OPTION_API_TOKEN: "test-token",
      CLAUDE_PLUGIN_OPTION_TELEMETRY: "false",
      CLAUDE_PLUGIN_DATA: dataDir,
    },
    stdio: ["pipe", "ignore", "ignore"],
  });
  child.stdin.end(JSON.stringify({ session_id: sessionId, transcript_path: transcript, cwd: "/synthetic/project",
    hook_event_name: "Stop" }));
  assert.equal(await new Promise((resolve) => child.on("exit", resolve)), 0);
}

const canaries = (text, kind) => [...new Set(text.match(new RegExp(`FX${kind}[A-Z0-9]+`, "g")) ?? [])];
const storedIds = (stored) => [...stored.values()].flat().map((message) => message.id);

test("fixture replay: machine-generated canaries never reach the body; every typed prompt does", async (t) => {
  const workspace = createTestWorkspace(t, { prefix: "cairn-capture-filter-" });
  for (const fixture of FIXTURES) {
    const text = await readFile(new URL(`./fixtures/${fixture}`, import.meta.url), "utf8");
    const typed = canaries(text, "TYPED");
    const machine = canaries(text, "MACHINE");
    assert.ok(typed.length >= 2 && machine.length >= 7, fixture);
    const transcript = join(workspace.path, fixture);
    await writeFile(transcript, text);
    const server = await receiver(t);
    await capture({ port: server.port, dataDir: join(workspace.path, `${fixture}-data`), transcript,
      sessionId: `session-${fixture}` });
    const bodies = JSON.stringify(server.requests);
    assert.equal(server.requests.length, 1, fixture);
    for (const canary of typed) assert.ok(bodies.includes(canary), `${fixture}: typed ${canary} missing`);
    for (const canary of machine) assert.equal(bodies.includes(canary), false, `${fixture}: machine ${canary} sent`);
    // The fixtures do exercise the leak 0.1.0 had.
    const legacy = JSON.stringify(legacyTranscriptMessages(text, "session"));
    assert.ok(machine.filter((canary) => legacy.includes(canary)).length >= 5, fixture);
  }
});

function upgradeTranscript({ machineFirst = 0 } = {}) {
  const lines = [];
  for (let index = 0; index < machineFirst; index += 1) {
    lines.push({ type: "user", uuid: `machine-lead-${index}`,
      message: { content: `<local-command-stdout>FXMACHINELEAD${index}</local-command-stdout>` } });
  }
  for (let index = 0; index < 32; index += 1) {
    if (index % 4 === 1) {
      lines.push({ type: "user", uuid: `machine-${index}`,
        message: { content: `<local-command-stdout>PRIVATE FXMACHINE${index}</local-command-stdout>` } });
    } else if (index % 2 === 0) {
      lines.push({ type: "user", uuid: `typed-${index}`, promptSource: "typed", message: { content: `Typed prompt FXTYPED${index}` } });
    } else {
      lines.push({ type: "assistant", uuid: `reply-${index}`, message: { content: [{ type: "text", text: `Reply ${index}` }] } });
    }
  }
  return `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
}

/** 0.1.0's batches for a window, each with its event id and the subset 0.1.1 sends. */
function legacyPlan(text, sessionId) {
  const legacy = legacyTranscriptMessages(text, sessionId);
  const kept = new Set(transcriptMessages(text, sessionId).map((message) => message.id));
  const batches = [];
  for (let index = 0; index < legacy.length; index += 24) {
    const batch = legacy.slice(index, index + 24);
    batches.push({ eventId: captureEventId(sessionId, batch), batch,
      sent: batch.filter((message) => kept.has(message.id)).map((message) => message.id) });
  }
  return batches;
}

/** The on-disk state after a window was frozen and its owner crashed before posting. */
async function frozenWindow(workspace, sessionId, text) {
  const dataDir = join(workspace.path, "data");
  const transcript = join(workspace.path, "transcript.jsonl");
  await writeFile(transcript, text);
  const cursorPath = captureCursorPath(dataDir, sessionId);
  await mkdir(join(dataDir, "sessions"), { recursive: true });
  await writeCaptureCursor(cursorPath, { offset: 0, generation: "initial", discardUntilNewline: false,
    pendingEnd: Buffer.byteLength(text) });
  return { dataDir, transcript, cursorPath };
}

const machineCount = (requests) => (JSON.stringify(requests).match(/FXMACHINE|PRIVATE/g) ?? []).length;

test("upgrade: a frozen window never sends machine text, across three failures and the success", async (t) => {
  // The reviewer's repro: 0.1.0 froze a window with <local-command-stdout> and crashed
  // before posting; 0.1.1 then fails three times and succeeds.
  const workspace = createTestWorkspace(t, { prefix: "cairn-capture-upgrade-" });
  const sessionId = "session-upgrade";
  const text = upgradeTranscript();
  const { dataDir, transcript, cursorPath } = await frozenWindow(workspace, sessionId, text);
  const plan = legacyPlan(text, sessionId);
  assert.equal(plan.length, 2);
  const server = await receiver(t, { fail: (_body, attempt) => attempt <= 3 });
  for (let attempt = 0; attempt < 4; attempt += 1) await capture({ port: server.port, dataDir, transcript, sessionId });
  assert.equal(machineCount(server.requests), 0, "machine text sent");
  // Every attempt used 0.1.0's event ids and sent only the kept subset.
  assert.deepEqual(server.requests.map((request) => request.event_id),
    [plan[0].eventId, plan[0].eventId, plan[0].eventId, plan[0].eventId, plan[1].eventId]);
  for (const request of server.requests) {
    const expected = plan.find((entry) => entry.eventId === request.event_id).sent;
    assert.deepEqual(request.messages.map((message) => message.id), expected);
  }
  assert.deepEqual((await readCaptureCursor(cursorPath)).pendingEnd, undefined);
});

test("a crash after the window is frozen and before any post changes nothing: same ids, no machine text", async (t) => {
  // There is no marker: a window frozen by 0.1.0 and one frozen by 0.1.1 look the same on disk.
  const workspace = createTestWorkspace(t, { prefix: "cairn-capture-crash-" });
  const sessionId = "session-crash";
  const text = upgradeTranscript();
  const { dataDir, transcript } = await frozenWindow(workspace, sessionId, text);
  const server = await receiver(t);
  await capture({ port: server.port, dataDir, transcript, sessionId });
  assert.deepEqual(server.requests.map((request) => request.event_id), legacyPlan(text, sessionId).map((entry) => entry.eventId));
  assert.equal(machineCount(server.requests), 0);
  const ids = storedIds(server.stored);
  assert.deepEqual([...ids].sort(), transcriptMessages(text, sessionId).map((message) => message.id).sort());
});

test("a 0.1.0 batch of machine records only is completed without sending", async (t) => {
  const workspace = createTestWorkspace(t, { prefix: "cairn-capture-machine-batch-" });
  const sessionId = "session-machine-batch";
  const text = upgradeTranscript({ machineFirst: 24 });
  const { dataDir, transcript, cursorPath } = await frozenWindow(workspace, sessionId, text);
  const plan = legacyPlan(text, sessionId);
  assert.deepEqual(plan[0].sent, []);
  const server = await receiver(t);
  await capture({ port: server.port, dataDir, transcript, sessionId });
  assert.deepEqual(server.requests.map((request) => request.event_id), plan.slice(1).map((entry) => entry.eventId));
  assert.equal(machineCount(server.requests), 0);
  assert.deepEqual((await readCaptureCursor(cursorPath)).offset, Buffer.byteLength(text));
});

test("dedup: a batch 0.1.0 already stored is acknowledged as a duplicate; no typed text is stored twice or lost", async (t) => {
  const workspace = createTestWorkspace(t, { prefix: "cairn-capture-dedup-" });
  const sessionId = "session-dedup";
  const text = upgradeTranscript();
  const { dataDir, transcript } = await frozenWindow(workspace, sessionId, text);
  const plan = legacyPlan(text, sessionId);
  // 0.1.0 stored batch 1 in full (machine text included) before batch 2 failed.
  const server = await receiver(t);
  server.stored.set(plan[0].eventId, plan[0].batch);
  await capture({ port: server.port, dataDir, transcript, sessionId });
  assert.equal(machineCount(server.requests), 0, "0.1.1 sent machine text");
  assert.deepEqual(server.requests.map((request) => request.event_id), plan.map((entry) => entry.eventId));
  const ids = storedIds(server.stored);
  assert.equal(new Set(ids).size, ids.length, "a message was stored twice");
  for (const message of transcriptMessages(text, sessionId)) assert.ok(ids.includes(message.id), `${message.id} lost`);
});

test("a retry keeps 0.1.0's boundaries and event ids and still sends only kept messages", async (t) => {
  const workspace = createTestWorkspace(t, { prefix: "cairn-capture-retry-" });
  const dataDir = join(workspace.path, "data");
  const transcript = join(workspace.path, "transcript.jsonl");
  const sessionId = "session-retry";
  const text = upgradeTranscript();
  await writeFile(transcript, text);
  const server = await receiver(t, { fail: (_body, attempt) => attempt === 1 });
  await capture({ port: server.port, dataDir, transcript, sessionId });
  await capture({ port: server.port, dataDir, transcript, sessionId });
  const plan = legacyPlan(text, sessionId);
  assert.deepEqual(server.requests.map((request) => request.event_id), [plan[0].eventId, ...plan.map((entry) => entry.eventId)]);
  assert.equal(machineCount(server.requests), 0);
  const ids = storedIds(server.stored);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual([...ids].sort(), transcriptMessages(text, sessionId).map((message) => message.id).sort());
});

test("a window of machine records only advances without sending anything", async (t) => {
  const workspace = createTestWorkspace(t, { prefix: "cairn-capture-machine-only-" });
  const dataDir = join(workspace.path, "data");
  const transcript = join(workspace.path, "transcript.jsonl");
  const text = [
    JSON.stringify({ type: "user", uuid: "m1", isMeta: true, message: { content: "<local-command-caveat>FXMACHINE1</local-command-caveat>" } }),
    JSON.stringify({ type: "user", uuid: "m2", message: { content: "<command-name>/clear</command-name>" } }),
    "",
  ].join("\n");
  await writeFile(transcript, text);
  const server = await receiver(t);
  await capture({ port: server.port, dataDir, transcript, sessionId: "session-machine-only" });
  assert.equal(server.requests.length, 0);
  assert.equal((await readCaptureCursor(captureCursorPath(dataDir, "session-machine-only"))).offset, Buffer.byteLength(text));
});
