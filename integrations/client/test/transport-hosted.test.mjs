import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, writeFile, symlink, chmod } from "node:fs/promises";
import { join } from "node:path";
import { createTestWorkspace } from "../../../tools/testing/workspace.mjs";
import { readControlState, setPaused, startIfActive } from "../control-state.mjs";
import { withWriteObserver } from "../private-state.mjs";
import { createJsonPoster, createHostedTransport, hostedQuotaStatus, hostedTargetId,
  resumeHostedQuota, classifyHostedReply } from "../transport-hosted.mjs";
import { sessionContext } from "../../../plugins/cairn-memory/test/hosted-fixtures.mjs";

const capture = "/api/memory/capture";
const recall = "/api/memory/recall";
const resetAt = "2026-10-02T00:00:00Z";
const ack = { duplicate: false, memoryCount: 1 };
const refusal = { error: "quota_reached", resetAt };
const binding = { sessionId: "synthetic-session", projectId: "p".repeat(64) };
const batch = [{ id: "message", role: "user", content: "Synthetic conversation" }];

async function fixture(t) {
  const workspace = createTestWorkspace(t, { prefix: "hosted-transport-" });
  const home = join(workspace.path, "home");
  const root = join(home, "root");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const options = { home, root, endpoint: "https://synthetic.invalid", token: "synthetic-token" };
  const target = { root, targetId: hostedTargetId(options) };
  const requests = [];
  let response = { status: 200, body: ack };
  const original = globalThis.fetch;
  globalThis.fetch = async (url, wire) => {
    requests.push({ url, ...wire, body: JSON.parse(wire.body) });
    if (response.throw) throw new Error("synthetic network failure");
    return Response.json(response.body, { status: response.status, headers: response.headers });
  };
  workspace.defer(() => { globalThis.fetch = original; });
  return { options, target, requests, respond: (status, body, headers) => { response = { status, body, headers }; },
    fail: () => { response = { throw: true }; },
    claude: createHostedTransport({ ...options, client: "claude" }),
    codex: createHostedTransport(options) };
}

const classification = [
  [capture, 200, ack, "complete"],
  [capture, 200, { duplicate: true, memoryCount: 0 }, "duplicate"],
  [capture, 200, { duplicate: false, memoryCount: 0 }, "empty"],
  [capture, 200, { ...ack, processing: true }, "processing"],
  [capture, 200, { ...ack, extra: true }, "error"],
  [capture, 202, { ...ack, processing: true }, "processing"],
  [capture, 202, ack, "error"],
  [capture, 204, null, "error"],
  [capture, 200, refusal, "error"],
  [capture, 429, refusal, "quota_reached"],
  [recall, 429, { error: "quota_reached" }, "quota_reached"],
  [recall, 200, { memories: [] }, "complete"],
  [recall, 200, { memories: [], extra: true }, "error"],
  [recall, 429, { error: "legacy", code: "daily_quota_memory_recall" }, "unavailable"],
  [capture, 429, ack, "unavailable"],
  [recall, 429, { error: "quota_reached", resetAt: "2026-02-30T00:00:00Z" }, "unavailable"],
  [recall, 503, { error: "synthetic" }, "unavailable"],
  [capture, 404, null, "unavailable"],
  [capture, 401, null, "error"],
];
for (const [path, status, body, expected] of classification) {
  test(`classification ${path} ${status} ${JSON.stringify(body)}`, () => {
    assert.equal(classifyHostedReply(path, status, body).status, expected);
  });
}

// R01–R16 are published before these state transitions.
const op = async (f, operation = "capture") => (await hostedQuotaStatus(f.target)).operations[operation];
const captureBatch = (port) => port.capture(batch, binding, "synthetic-event");
const statePath = (f) => join(f.target.root, "hosted-quota", `${f.target.targetId}.json`);
async function refuse(f, operation = "capture", value = { error: "quota_reached" }) {
  f.respond(429, value);
  await (operation === "capture" ? captureBatch(f.claude) : f.claude.recall("synthetic"));
}

test("R01 normal unavailable request never leaves a permanent gate", async (t) => {
  const f = await fixture(t); f.fail();
  assert.equal((await captureBatch(f.codex)).status, "unavailable");
  assert.equal((await op(f)).mode, "open");
  f.respond(200, ack);
  assert.equal((await captureBatch(createHostedTransport(f.options))).status, "complete");
  assert.equal(f.requests.length, 2);
});
for (const operation of ["capture", "recall"]) {
  test(`R02/R03 ${operation} refusal spans clients and restart, leaves other bucket open`, async (t) => {
    const f = await fixture(t); await refuse(f, operation);
    const restarted = createHostedTransport({ ...f.options, token: "rotated-synthetic-token" });
    assert.equal((await (operation === "capture" ? captureBatch(restarted) :
      restarted.recall("synthetic"))).status, "quota_reached");
    f.respond(200, operation === "capture" ? { memories: [] } : ack);
    assert.equal((await (operation === "capture" ? restarted.recall("synthetic") :
      captureBatch(restarted))).status, "complete");
    assert.equal(f.requests.length, 2);
    assert.equal((await op(f, operation)).reset, "reset unknown");
  });
}
test("R04/R05 resume checks each validated reset and grants one permit to every eligible bucket", async (t) => {
  const f = await fixture(t);
  await refuse(f, "capture", refusal); await refuse(f, "recall", { error: "quota_reached" });
  const early = await resumeHostedQuota(f.target, { now: Date.parse(resetAt) - 1 });
  assert.equal(early.operations.capture.status, "quota_reached");
  assert.equal(early.operations.recall.status, "ready");
  const eligible = await resumeHostedQuota(f.target, { now: Date.parse(resetAt) });
  assert.equal(eligible.operations.capture.status, "ready");
  assert.equal(eligible.operations.recall.status, "ready");
  await resumeHostedQuota(f.target, { now: Date.parse(resetAt) });
  f.respond(429, { error: "quota_reached" });
  await captureBatch(f.codex); await f.claude.recall("synthetic");
  await captureBatch(f.claude); await createHostedTransport(f.options).recall("synthetic");
  assert.equal(f.requests.length, 4);
});
test("R06 only one client consumes a resumed operation; lock is free during its network wait", async (t) => {
  const f = await fixture(t); await refuse(f); await resumeHostedQuota(f.target);
  let release; let entered;
  const begun = new Promise((resolve) => { entered = resolve; });
  const pending = new Promise((resolve) => { release = resolve; });
  globalThis.fetch = async (url) => {
    f.requests.push({ url });
    if (url.endsWith("recall")) return Response.json({ memories: [] });
    entered(); await pending; return Response.json({ error: "quota_reached" }, { status: 429 });
  };
  const first = captureBatch(f.codex); await begun;
  try {
    assert.equal((await op(f)).mode, "in_flight");
    assert.equal((await captureBatch(f.claude)).status, "quota_reached");
    assert.equal((await f.claude.recall("synthetic")).status, "complete");
    assert.equal(f.requests.length, 3);
  } finally { release(); await first; }
  assert.equal((await op(f)).mode, "quota_reached");
});
test("R07 expired live-owner probe restores refusal and fences its late acknowledgement", async (t) => {
  const f = await fixture(t); await refuse(f); await resumeHostedQuota(f.target);
  let release; let entered;
  const begun = new Promise((resolve) => { entered = resolve; });
  const pending = new Promise((resolve) => { release = resolve; });
  globalThis.fetch = async () => { entered(); await pending; return Response.json(ack); };
  const first = captureBatch(f.codex); await begun;
  const state = JSON.parse(await readFile(statePath(f), "utf8"));
  state.operations.capture.attempt.deadline = 0;
  await writeFile(statePath(f), JSON.stringify(state), { mode: 0o600 });
  try {
    assert.equal((await op(f)).mode, "quota_reached");
    await resumeHostedQuota(f.target);
    assert.equal((await op(f)).mode, "ready");
  } finally { release(); await first; }
  assert.equal((await op(f)).mode, "ready");
});
for (const [status, body, expected] of [[200, { ...ack, processing: true }, "processing"],
  [202, { ...ack, processing: true }, "processing"], [503, {}, "unavailable"],
  [200, { extra: true }, "error"], [429, { error: "quota_reached" }, "quota_reached"]]) {
  test(`R08 resume result ${status}/${expected} leaves refusal and preserves pending`, async (t) => {
    const f = await fixture(t); await refuse(f); await resumeHostedQuota(f.target);
    f.respond(status, body);
    assert.equal((await captureBatch(f.codex)).status, expected);
    assert.equal((await op(f)).mode, "quota_reached");
    await captureBatch(f.claude); assert.equal(f.requests.length, 2);
  });
}
test("R09 verified acknowledgement reopens only its probe operation", async (t) => {
  const f = await fixture(t); await refuse(f); await refuse(f, "recall");
  await resumeHostedQuota(f.target); f.respond(200, ack);
  assert.equal((await captureBatch(f.codex)).status, "complete");
  assert.equal((await op(f)).mode, "open");
  assert.equal((await op(f, "recall")).mode, "ready");
});

import { retryAfterDelay } from "../hosted-contract.mjs";
const clock = Date.parse("2026-10-01T00:00:00Z");
for (const [header, delay] of [[undefined, 300000], ["invalid", 300000], ["-2", 300000],
  ["1.5", 300000], ["60", 60000], ["0", 1000], ["999999", 86400000],
  [new Date(clock + 90000).toUTCString(), 90000],
  [new Date(clock + 172800000).toUTCString(), 86400000],
  [new Date(clock - 1000).toUTCString(), 1000], ["2026-10-02T00:00:00Z", 300000],
  ["Wed, 30 Feb 2026 00:00:00 GMT", 300000]]) {
  test(`R10 Retry-After ${header ?? "absent"} -> ${delay}ms`, () => {
    assert.equal(retryAfterDelay(header, clock), delay);
  });
}
for (const header of [undefined, "invalid", "60", "999999"]) {
  test(`R10/R11 cooldown persists per operation across clients/restart (${header})`, async (t) => {
    const f = await fixture(t);
    const before = Date.now();
    f.respond(429, { error: "legacy", code: "daily_quota_memory_recall" },
      header === undefined ? {} : { "retry-after": header });
    assert.equal((await f.codex.recall("synthetic")).status, "unavailable");
    const gate = await op(f, "recall");
    assert.equal(gate.mode, "cooldown"); assert.equal(gate.resetAt, null);
    const expected = retryAfterDelay(header);
    assert.ok(gate.until >= before + expected && gate.until <= Date.now() + expected);
    await createHostedTransport(f.options).recall("synthetic");
    await f.claude.recall("synthetic"); assert.equal(f.requests.length, 1);
    f.respond(200, ack); assert.equal((await captureBatch(f.claude)).status, "complete");
    assert.equal(f.requests.length, 2);
  });
}
test("R12 cooldown auto-expires and resume also clears it", async (t) => {
  const f = await fixture(t); f.respond(429, { error: "legacy" }, { "retry-after": "1" });
  await captureBatch(f.codex);
  const realNow = Date.now; const until = (await op(f)).until;
  try {
    Date.now = () => until - 1;
    await captureBatch(f.claude); assert.equal(f.requests.length, 1);
    Date.now = () => until;
    f.respond(200, ack); assert.equal((await captureBatch(f.claude)).status, "complete");
  } finally { Date.now = realNow; }
  f.respond(429, { error: "legacy" }); await f.claude.recall("synthetic");
  assert.equal((await resumeHostedQuota(f.target)).status, "active");
  f.respond(200, { memories: [] });
  assert.equal((await f.codex.recall("synthetic")).status, "complete");
  assert.equal(f.requests.length, 4);
});
for (const bytes of ["{", JSON.stringify({ version: 999 }),
  JSON.stringify({ version: 2, operations: { capture: {} } })]) {
  test(`R13 corrupt state fails closed, resume repairs regular owned file (${bytes})`, async (t) => {
    const f = await fixture(t); await captureBatch(f.codex);
    await writeFile(statePath(f), bytes, { mode: 0o600 });
    assert.equal((await captureBatch(f.claude)).status, "unavailable");
    assert.equal((await hostedQuotaStatus(f.target)).repairHint, "run resume");
    assert.equal((await resumeHostedQuota(f.target)).status, "repaired");
    assert.equal((await captureBatch(f.claude)).status, "complete");
    assert.equal(f.requests.length, 2);
  });
}
test("R14 recall sends while a normal capture is in flight", async (t) => {
  const f = await fixture(t); let release; let entered;
  const begun = new Promise((resolve) => { entered = resolve; });
  const pending = new Promise((resolve) => { release = resolve; });
  globalThis.fetch = async (url) => {
    f.requests.push({ url });
    if (url.endsWith("recall")) return Response.json({ memories: [] });
    entered(); await pending; return Response.json(ack);
  };
  const capture = captureBatch(f.codex); await begun;
  try {
    assert.equal((await f.claude.recall("synthetic")).status, "complete");
    assert.equal(f.requests.length, 2);
  } finally { release(); await capture; }
});
test("R15 late normal success cannot clear another request's verified refusal", async (t) => {
  const f = await fixture(t); let release; let entered; let calls = 0;
  const begun = new Promise((resolve) => { entered = resolve; });
  const pending = new Promise((resolve) => { release = resolve; });
  globalThis.fetch = async () => {
    if (++calls === 1) { entered(); await pending; return Response.json(ack); }
    return Response.json({ error: "quota_reached" }, { status: 429 });
  };
  const first = captureBatch(f.codex); await begun;
  try { await captureBatch(f.claude); }
  finally { release(); await first; }
  assert.equal((await op(f)).mode, "quota_reached");
});
test("R16 local pause during probe publication prevents dispatch and preserves permit", async (t) => {
  const f = await fixture(t); await refuse(f); await resumeHostedQuota(f.target);
  const control = await readControlState(f.options.root); let paused = false;
  const post = createJsonPoster(f.options);
  const dispatch = async (start) => {
    const attempt = await startIfActive(f.options.root, control.generation, start);
    if (!attempt.started) throw new Error("dispatch_not_started");
    return attempt.operation;
  };
  await withWriteObserver(async ({ path }) => {
    if (!paused && path === statePath(f)) { paused = true; await setPaused(f.options.root, true); }
  }, () => assert.rejects(post(capture, {}, 1000, true, dispatch), /capture_unavailable/));
  assert.equal(f.requests.length, 1);
  assert.equal((await op(f)).mode, "ready");
});
test("sub-millisecond reset fractions cannot permit early resume", async (t) => {
  const f = await fixture(t); const reset = "2026-10-02T00:00:00.0001Z";
  await refuse(f, "capture", { error: "quota_reached", resetAt: reset });
  assert.equal((await resumeHostedQuota(f.target, { now: Date.parse(reset) })).operations.capture.status,
    "quota_reached");
  assert.equal((await resumeHostedQuota(f.target, { now: Date.parse(reset) + 1 })).status, "ready");
});
test("Codex rejects redirects and Claude preserves its options/discriminator", async (t) => {
  const f = await fixture(t); await captureBatch(f.codex); await captureBatch(f.claude);
  assert.equal(f.requests[0].redirect, "error"); assert.equal(f.requests[1].redirect, undefined);
  assert.equal(f.requests[1].body.client, "claude-code");
});
test("session-start remains quota-free without enabling lifecycle hooks", async (t) => {
  const f = await fixture(t); await refuse(f); f.respond(200, sessionContext());
  assert.equal((await f.codex.sessionStart({ version: 1 }, { countTokens: () => 100 })).status, "complete");
  assert.equal((await op(f)).mode, "quota_reached");
});
test("released root aliases, fresh resume and aborted requests retain compatibility", async (t) => {
  const f = await fixture(t); const alias = join(f.options.home, "alias");
  await symlink(f.options.root, alias);
  assert.equal((await captureBatch(createHostedTransport({ ...f.options, root: alias }))).status, "complete");
  assert.equal((await resumeHostedQuota({ ...f.target, root: join(f.options.home, "fresh") })).status, "active");
  await refuse(f); await resumeHostedQuota(f.target);
  const abort = new AbortController(); abort.abort();
  assert.equal((await f.codex.capture(batch, binding, "synthetic-event", abort.signal)).status, "unavailable");
  assert.equal((await op(f)).mode, "ready");
  assert.equal((await f.codex.recall("")).status, "error");
});
