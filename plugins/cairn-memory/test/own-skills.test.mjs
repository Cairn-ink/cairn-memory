import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdir, open, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createTestWorkspace } from "../../../tools/testing/workspace.mjs";
import { captureEventId, transcriptMessages, transcriptWindow } from "../lib/transcript.mjs";
import { redactSecrets } from "../lib/redact.mjs";
import { captureCursorPath, writeCaptureCursor } from "../lib/capture-cursor.mjs";

const hook = fileURLToPath(new URL("../scripts/hook.mjs", import.meta.url));
const preload = fileURLToPath(new URL("./fixtures/status-fetch-preload.mjs", import.meta.url));
const fixture = await readFile(new URL("./fixtures/claude-plugin-status.jsonl", import.meta.url), "utf8");
const jsonl = (records) => records.map((record) => JSON.stringify(record)).join("\n") + "\n";
const user = (text, extra = {}) => ({ type: "user", message: { content: text }, ...extra });
const assistant = (text) => ({ type: "assistant", message: { content: [{ type: "text", text }] } });
const command = (name) => user(`<command-name>/${name}</command-name>\n<command-message>${name}</command-message>\n<command-args></command-args>`);
const skillTool = (name) => ({ type: "assistant", message: { content: [
  { type: "tool_use", id: "synthetic-skill", name: "Skill", input: { skill: name } },
] } });

// Frozen pre-change parser identity rules from 14c6ffe. Independent of the new
// window parser so deleting a record/reindexing fallback IDs fails this test.
function beforeMessages(text, sessionId) {
  return text.split("\n").flatMap((line, lineIndex) => {
    let record;
    try { record = JSON.parse(line); } catch { return []; }
    if (!["user", "assistant"].includes(record?.type)) return [];
    const raw = record.message?.content;
    const blocks = typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw
      .filter((block) => block?.type === "text" && typeof block.text === "string")
      .map((block) => block.text) : [];
    const content = blocks.map(redactSecrets).join("\n").trim().slice(0, 20_000);
    if (!content) return [];
    const id = typeof record.uuid === "string" && record.uuid ? record.uuid : createHash("sha256")
      .update(`${sessionId}\0${lineIndex}\0${record.type}\0${content}`).digest("hex");
    return [{ id, role: record.type, content }];
  });
}
function beforePlan(text, sessionId) {
  const messages = beforeMessages(text, sessionId);
  const plan = [];
  for (let index = 0; index < messages.length; index += 24) {
    const batch = messages.slice(index, index + 24);
    const eventId = createHash("sha256").update(`${sessionId}\0${batch.map((m) => m.id).join("\0")}`).digest("hex");
    plan.push({ batch, eventId });
  }
  return plan;
}

async function processResult(workspace, action, env, input = {}) {
  const paths = ["stdin", "stdout", "stderr"].map((name) => join(workspace.path, `process-${name}`));
  await writeFile(paths[0], JSON.stringify(input));
  const handles = [];
  try {
    for (let index = 0; index < paths.length; index++) handles.push(await open(paths[index], index ? "w" : "r"));
    const child = spawn(process.execPath, ["--import", preload, hook, action], {
      env, stdio: handles.map((handle) => handle.fd),
    });
    const exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    const stdout = await readFile(paths[1], "utf8");
    const stderr = await readFile(paths[2], "utf8");
    assert.equal(exitCode, 0, stderr);
    assert.equal(stderr, "");
    return stdout;
  } finally { for (const handle of handles) await handle.close(); }
}
async function captureFixture(t, sessionId = "own-skills-session") {
  const workspace = createTestWorkspace(t, { prefix: "cairn-own-skills-" });
  const home = join(workspace.path, "home");
  await mkdir(home);
  const data = join(workspace.path, "data");
  const transcript = join(workspace.path, "transcript.jsonl");
  const requests = join(workspace.path, "requests.jsonl");
  await writeFile(requests, "");
  const env = { PATH: process.env.PATH, HOME: home, TMPDIR: process.env.TMPDIR,
    NODE_DISABLE_COMPILE_CACHE: "1", CLAUDE_PLUGIN_DATA: data,
    CLAUDE_PLUGIN_OPTION_API_ENDPOINT: "https://own-skills.synthetic.invalid",
    CLAUDE_PLUGIN_OPTION_API_TOKEN: "pat_" + "own-skills-" + "synthetic-only",
    CLAUDE_PLUGIN_OPTION_TELEMETRY: "false", CAIRN_STATUS_FIXTURE_REQUESTS: requests,
    CAIRN_STATUS_FIXTURE_REPLY: JSON.stringify({ status: 200, body: { duplicate: false, memoryCount: 1 } }),
  };
  return { workspace, data, transcript, env, sessionId,
    cursor: async () => JSON.parse(await readFile(captureCursorPath(data, sessionId), "utf8")),
    calls: async () => (await readFile(requests, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse),
    run: () => processResult(workspace, "capture", env, {
      session_id: sessionId, transcript_path: transcript, cwd: "/synthetic/project", hook_event_name: "Stop",
    }),
  };
}

test("own skill fixture withholds invocation and every answer through the next typed prompt", () => {
  const window = transcriptWindow(fixture, "fixture-session");
  assert.deepEqual(window.map((m) => m.withheld), [true, true, true, true, true, true, false, false, false, false]);
  const kept = transcriptMessages(fixture, "fixture-session");
  assert.equal(kept.length, 4);
  assert.ok(kept[0].content.includes("cairn memory status"));
  assert.ok(kept.every((m) => m.content.includes("FXNORMAL")));
  assert.deepEqual(window.map(({ id, role, content }) => ({ id, role, content })), beforeMessages(fixture, "fixture-session"));
});

test("every installed skill and future cairn-memory skills withhold the whole turn", async () => {
  const entries = await readdir(new URL("../skills/", import.meta.url), { withFileTypes: true });
  const names = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  assert.ok(names.includes("status") && names.includes("pause") && names.includes("resume"));
  for (const name of [...names, "synthetic-future-skill"]) {
    const text = jsonl([command(`cairn-memory:${name}`), assistant("First answer"),
      user("Hook context", { isMeta: true }), assistant("Second answer"),
      user("Typed followup", { promptSource: "typed" }), assistant("Normal answer")]);
    assert.deepEqual(transcriptMessages(text, name).map((m) => m.content), ["Typed followup", "Normal answer"]);
  }
});

test("Skill tool-only records and the exact installed plugin skill directory start withholding", () => {
  const ownedRoot = fileURLToPath(new URL("../", import.meta.url));
  for (const root of [ownedRoot, "/synthetic/.claude/plugins/cache/cairn-memory/cairn-memory/0.3.0",
    "C:\\synthetic\\.claude\\plugins\\cache\\cairn-memory\\cairn-memory\\0.3.0"]) {
    for (const marker of [skillTool("cairn-memory:status"),
      user(`Base directory for this skill: ${root.replace(/[\\/]+$/, "")}/skills/status\nInstructions`, { isMeta: true })]) {
      const state = {};
      assert.ok(transcriptWindow(jsonl([marker, assistant("Command explanation")]), "markers", {
        turnState: state, pluginRoot: root,
      }).every((m) => m.withheld));
      assert.equal(state.ownSkillTurn, true);
    }
  }
});

test("project skills and other marketplace/plugin identities do not withhold their answers", () => {
  const pluginRoot = "/synthetic/.claude/plugins/cache/cairn-memory/cairn-memory/0.3.0";
  for (const directory of ["/synthetic/code/cairn-memory/.claude/skills/deploy",
    "/synthetic/.claude/plugins/cache/cairn-memory/other-plugin/0.3.0/skills/status",
    "/synthetic/.claude/plugins/cache/other-marketplace/cairn-memory/0.3.0/skills/status",
    pluginRoot + "/other/skills/status", pluginRoot + "/skills/../status"]) {
    const record = user(`Base directory for this skill: ${directory}\nInstructions`, { isMeta: true });
    const kept = transcriptMessages(jsonl([record, assistant("Ordinary answer")]), "other", { pluginRoot });
    assert.deepEqual(kept.map((m) => m.content), ["Ordinary answer"]);
  }
});

test("ordinary mentions, other skills and pasted typed markers stay ordinary conversation", () => {
  const cases = [user("Please explain cairn memory status"),
    user("/cairn-memory:status is a command I am asking about", { promptSource: "typed" }),
    user("<command-name>/cairn-memory:status</command-name>", { promptSource: "typed" }),
    user("Base directory for this skill: /synthetic/cairn-memory/skills/status", { promptSource: "typed" }),
    skillTool("other-plugin:status"), command("other-plugin:status"),
    user("Base directory for this skill: /synthetic/other-plugin/skills/status", { isMeta: true }),
  ];
  for (const record of cases) {
    const kept = transcriptMessages(jsonl([record, assistant("Ordinary answer")]), "ordinary");
    assert.equal(kept.at(-1).content, "Ordinary answer");
    if (record.type === "user" && !record.isMeta && !record.message.content.includes("other-plugin")) assert.equal(kept.length, 2);
  }
  // Hosts without promptSource still end the withheld turn on a plain user record.
  assert.deepEqual(transcriptMessages(jsonl([command("cairn-memory:status"), assistant("Command answer"),
    user("Older-host normal prompt"), assistant("Normal answer")]), "old").map((m) => m.content),
  ["Older-host normal prompt", "Normal answer"]);
});

test("whole plugin control outputs are withheld without markers; longer explanations are kept", async (t) => {
  const f = await captureFixture(t);
  for (const action of ["status", "pause", "resume"]) {
    const output = (await processResult(f.workspace, action, f.env)).trim();
    assert.ok(output.startsWith("Cairn automatic memory"));
    assert.equal(transcriptMessages(jsonl([assistant(output)]), "output").length, 0);
    assert.equal(transcriptMessages(jsonl([user(output, { promptSource: "typed" })]), "output").length, 1);
    for (const explanation of [`The plugin printed: ${output}`, `${output}\nHere is what this means.`, `${output} Also, your flight is at 9am.`]) {
      assert.equal(transcriptMessages(jsonl([assistant(explanation)]), "output").length, 1);
    }
    if (action === "status") {
      const explanation = output.replace("; telemetry:", "; your flight is at 9am; telemetry:");
      assert.equal(transcriptMessages(jsonl([assistant(explanation)]), "output").length, 1);
    }
  }
  for (const output of ["Cairn automatic memory is active. capture: quota_reached; reset unknown",
    "Cairn automatic memory is active. recall: quota_reached; 2026-10-06T10:00:00.123456Z",
    "Cairn automatic memory: active; capture: ready; reset unknown; telemetry: on; endpoint: https://cairn.ink; credential: configured.",
    "Cairn automatic memory: paused; recall: cooldown; retry after 2026-10-06T10:00:00.123Z; telemetry: off; endpoint: https://cairn.ink; credential: missing.",
    "Cairn quota state repaired to open; automatic memory is active.",
    "Cairn automatic memory: pairing_needed; coordination unreadable."]) {
    assert.equal(transcriptMessages(jsonl([assistant(output)]), "output").length, 0);
    assert.equal(transcriptMessages(jsonl([assistant(output + " Also, your flight is at 9am.")]), "output").length, 1);
  }
});

test("capture sends only normal turns and preserves pre-change 24-message event identities", async (t) => {
  const f = await captureFixture(t);
  const extra = Array.from({ length: 32 }, (_, index) => index % 2 ? assistant(`Normal answer ${index}`) :
    user(`Normal prompt ${index}`, { promptSource: "typed" }));
  const text = fixture + jsonl(extra);
  await writeFile(f.transcript, text);
  await f.run();
  const calls = await f.calls();
  const plan = beforePlan(text, f.sessionId);
  assert.equal(plan.length, 2);
  assert.deepEqual(calls.map((call) => call.body.event_id), plan.map((entry) => entry.eventId));
  const kept = transcriptMessages(text, f.sessionId);
  const keptIds = new Set(kept.map((m) => m.id));
  for (let index = 0; index < plan.length; index++) {
    assert.deepEqual(calls[index].body.messages, plan[index].batch.filter((m) => keptIds.has(m.id)));
    assert.equal(captureEventId(f.sessionId, plan[index].batch), plan[index].eventId);
  }
  assert.deepEqual(calls.flatMap((call) => call.body.messages), kept);
  assert.equal(JSON.stringify(calls).includes("FXPLUGIN"), false);
  assert.ok(JSON.stringify(calls).includes("cairn memory status"));
});

test("incremental capture retains only a boolean through command-only windows and process restarts", async (t) => {
  const f = await captureFixture(t);
  const first = jsonl([skillTool("cairn-memory:status")]);
  await writeFile(f.transcript, first);
  await f.run();
  assert.equal((await f.calls()).length, 0);
  assert.equal((await f.cursor()).ownSkillTurn, true);
  await appendFile(f.transcript, jsonl([assistant("First command explanation"), user("Meta context", { isMeta: true })]));
  await f.run();
  assert.equal((await f.calls()).length, 0);
  assert.equal((await f.cursor()).ownSkillTurn, true);
  const last = jsonl([assistant("Second command explanation"), user("Normal prompt", { promptSource: "typed" }), assistant("Normal reply")]);
  await appendFile(f.transcript, last);
  await f.run();
  const calls = await f.calls();
  assert.deepEqual(calls[0].body.messages.map((m) => m.content), ["Normal prompt", "Normal reply"]);
  assert.equal(calls[0].body.event_id, beforePlan(last, f.sessionId)[0].eventId);
  assert.equal((await f.cursor()).ownSkillTurn, undefined);
  const state = JSON.parse(await readFile(captureCursorPath(f.data, f.sessionId), "utf8"));
  assert.deepEqual(Object.keys(state).sort(), ["discardUntilNewline", "generation", "offset"]);
});

test("failed frozen windows retry from their original skill-turn state and event ids", async (t) => {
  const f = await captureFixture(t);
  const first = jsonl([command("cairn-memory:status"), assistant("Command preface")]);
  await writeFile(f.transcript, first);
  await f.run();
  const text = jsonl([assistant("Private command explanation"), user("Normal followup", { promptSource: "typed" }), assistant("Normal answer")]);
  await appendFile(f.transcript, text);
  f.env.CAIRN_STATUS_FIXTURE_REPLY = JSON.stringify({ status: 503, body: {} });
  await f.run();
  assert.equal((await f.cursor()).ownSkillTurn, true);
  assert.equal((await f.cursor()).pendingEnd, Buffer.byteLength(first + text));
  await appendFile(f.transcript, jsonl([user("Later prompt", { promptSource: "typed" }), assistant("Later answer")]));
  f.env.CAIRN_STATUS_FIXTURE_REPLY = JSON.stringify({ status: 200, body: { duplicate: false, memoryCount: 1 } });
  await f.run();
  const calls = await f.calls();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].body, calls[1].body);
  assert.deepEqual(calls[1].body.messages.map((m) => m.content), ["Normal followup", "Normal answer"]);
  assert.equal(calls[1].body.event_id, beforePlan(text, f.sessionId)[0].eventId);
  await f.run();
  assert.deepEqual((await f.calls()).at(-1).body.messages.map((m) => m.content), ["Later prompt", "Later answer"]);
});

test("a pre-change frozen window filters command answers without changing its event id", async (t) => {
  const f = await captureFixture(t);
  await writeFile(f.transcript, fixture);
  await writeCaptureCursor(captureCursorPath(f.data, f.sessionId), { offset: 0, generation: "initial",
    discardUntilNewline: false, pendingEnd: Buffer.byteLength(fixture) });
  await f.run();
  const calls = await f.calls();
  assert.equal(calls[0].body.event_id, beforePlan(fixture, f.sessionId)[0].eventId);
  assert.deepEqual(calls[0].body.messages, transcriptMessages(fixture, f.sessionId));
});

test("a whole withheld batch completes without shifting the following normal batch", async (t) => {
  const f = await captureFixture(t);
  const text = jsonl([command("cairn-memory:status"),
    ...Array.from({ length: 25 }, (_, index) => assistant(`Command answer ${index}`)),
    user("Normal prompt", { promptSource: "typed" }), assistant("Normal answer")]);
  await writeFile(f.transcript, text);
  await f.run();
  const calls = await f.calls();
  const plan = beforePlan(text, f.sessionId);
  assert.equal(plan.length, 2);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.event_id, plan[1].eventId);
  assert.deepEqual(calls[0].body.messages.map((m) => m.content), ["Normal prompt", "Normal answer"]);
  assert.equal((await f.cursor()).offset, Buffer.byteLength(text));
});

test("a retry ending in a skill turn does not suppress an earlier normal assistant answer", async (t) => {
  const f = await captureFixture(t);
  const start = jsonl([user("Normal prompt", { promptSource: "typed" })]);
  await writeFile(f.transcript, start);
  await f.run();
  const text = jsonl([assistant("Normal answer"), command("cairn-memory:status"), assistant("Command answer")]);
  await appendFile(f.transcript, text);
  f.env.CAIRN_STATUS_FIXTURE_REPLY = JSON.stringify({ status: 503, body: {} });
  await f.run();
  assert.equal((await f.cursor()).ownSkillTurn, undefined);
  f.env.CAIRN_STATUS_FIXTURE_REPLY = JSON.stringify({ status: 200, body: { duplicate: false, memoryCount: 1 } });
  await f.run();
  const calls = await f.calls();
  assert.deepEqual(calls[1].body, calls[2].body);
  assert.deepEqual(calls[2].body.messages.map((m) => m.content), ["Normal answer"]);
  assert.equal(calls[2].body.event_id, beforePlan(text, f.sessionId)[0].eventId);
  assert.equal((await f.cursor()).ownSkillTurn, true);
});
