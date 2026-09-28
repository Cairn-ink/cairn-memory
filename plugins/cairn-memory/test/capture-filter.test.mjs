import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
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

function upgradeTranscript() {
  const lines = [];
  for (let index = 0; index < 32; index += 1) {
    if (index % 4 === 1) {
      lines.push({ type: "user", uuid: `machine-${index}`, message: { content: `<command-name>/cost</command-name> FXMACHINE${index}` } });
    } else if (index % 2 === 0) {
      lines.push({ type: "user", uuid: `typed-${index}`, promptSource: "typed", message: { content: `Typed prompt FXTYPED${index}` } });
    } else {
      lines.push({ type: "assistant", uuid: `reply-${index}`, message: { content: [{ type: "text", text: `Reply ${index}` }] } });
    }
  }
  return `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
}

test("upgrade: a window 0.1.0 froze retries with its original batches, so nothing is stored twice or lost", async (t) => {
  const workspace = createTestWorkspace(t, { prefix: "cairn-capture-upgrade-" });
  const dataDir = join(workspace.path, "data");
  const transcript = join(workspace.path, "transcript.jsonl");
  const sessionId = "session-upgrade";
  const text = upgradeTranscript();
  await writeFile(transcript, text);
  const legacy = legacyTranscriptMessages(text, sessionId);
  const legacyBatches = [legacy.slice(0, 24), legacy.slice(24)];
  const filtered = transcriptMessages(text, sessionId);
  assert.equal(legacyBatches.length, 2);
  // Without the handling, re-slicing the filtered list would give batch 1 a new event id.
  assert.notEqual(captureEventId(sessionId, filtered.slice(0, 24)), captureEventId(sessionId, legacyBatches[0]));

  // State 0.1.0 leaves behind: batch 1 stored, batch 2 failed, window frozen, no filter marker.
  const server = await receiver(t);
  server.stored.set(captureEventId(sessionId, legacyBatches[0]), legacyBatches[0]);
  const cursorPath = captureCursorPath(dataDir, sessionId);
  await mkdir(join(dataDir, "sessions"), { recursive: true });
  await writeCaptureCursor(cursorPath, { offset: 0, generation: "initial", discardUntilNewline: false,
    pendingEnd: Buffer.byteLength(text) });

  await capture({ port: server.port, dataDir, transcript, sessionId });
  assert.deepEqual(server.requests.map((request) => request.event_id),
    legacyBatches.map((batch) => captureEventId(sessionId, batch)));
  const ids = storedIds(server.stored);
  assert.equal(new Set(ids).size, ids.length, "no message stored twice");
  for (const message of filtered) assert.ok(ids.includes(message.id), `typed/assistant ${message.id} lost`);
  assert.deepEqual(await readCaptureCursor(cursorPath),
    { offset: Buffer.byteLength(text), generation: "initial", discardUntilNewline: false, pendingEnd: undefined });

  // The next window is frozen by 0.1.1: filtered, and marked.
  await appendFile(transcript, [
    JSON.stringify({ type: "user", uuid: "typed-after", promptSource: "typed", message: { content: "Typed after upgrade FXTYPEDAFTER" } }),
    JSON.stringify({ type: "user", uuid: "machine-after", message: { content: "<local-command-stdout>FXMACHINEAFTER</local-command-stdout>" } }),
    "",
  ].join("\n"));
  await capture({ port: server.port, dataDir, transcript, sessionId });
  const last = JSON.stringify(server.requests.at(-1));
  assert.ok(last.includes("FXTYPEDAFTER"));
  assert.equal(last.includes("FXMACHINEAFTER"), false);
  await access(`${cursorPath}.filtered`);
});

test("a window 0.1.1 froze keeps its filtered batches and event id on retry", async (t) => {
  const workspace = createTestWorkspace(t, { prefix: "cairn-capture-retry-" });
  const dataDir = join(workspace.path, "data");
  const transcript = join(workspace.path, "transcript.jsonl");
  const sessionId = "session-retry";
  const text = upgradeTranscript();
  await writeFile(transcript, text);
  const server = await receiver(t, { fail: (_body, attempt) => attempt === 1 });
  await capture({ port: server.port, dataDir, transcript, sessionId });
  await access(`${captureCursorPath(dataDir, sessionId)}.filtered`);
  await capture({ port: server.port, dataDir, transcript, sessionId });
  const filtered = transcriptMessages(text, sessionId);
  const expected = [filtered.slice(0, 24), filtered.slice(24)].filter((batch) => batch.length)
    .map((batch) => captureEventId(sessionId, batch));
  assert.deepEqual(server.requests.map((request) => request.event_id), [expected[0], ...expected]);
  assert.equal(JSON.stringify(server.requests).includes("FXMACHINE"), false);
  const ids = storedIds(server.stored);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids.sort(), filtered.map((message) => message.id).sort());
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
