import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { createTestWorkspace } from "../../../tools/testing/workspace.mjs";
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
    return Response.json(response.body, { status: response.status });
  };
  workspace.defer(() => { globalThis.fetch = original; });
  return { options, target, requests, respond: (status, body) => { response = { status, body }; },
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
  [capture, 204, null, "error"],
  [capture, 200, refusal, "error"],
  [capture, 429, refusal, "quota_reached"],
  [recall, 429, { error: "quota_reached" }, "quota_reached"],
  [recall, 200, { memories: [] }, "complete"],
  [recall, 200, { memories: [], extra: true }, "error"],
  [recall, 429, { error: "legacy", code: "daily_quota_memory_recall" }, "error"],
  [capture, 429, ack, "error"],
  [recall, 429, { error: "quota_reached", resetAt: "2026-02-30T00:00:00Z" }, "error"],
  [recall, 503, { error: "synthetic" }, "unavailable"],
  [capture, 404, null, "unavailable"],
  [capture, 401, null, "error"],
];
for (const [path, status, body, expected] of classification) {
  test(`classification ${path} ${status} ${JSON.stringify(body)}`, () => {
    assert.equal(classifyHostedReply(path, status, body).status, expected);
  });
}

// Closed decision table, published in docs/protocol.md before implementation.
// Each row independently asserts network calls, durable gate and result.
const rows = [
  { id: "Q01", event: "refuse", expected: [1, "quota_reached", "quota_reached"] },
  { id: "Q02", event: "restart", expected: [0, "quota_reached", "quota_reached"] },
  { id: "Q03", event: "early-resume", expected: [0, "quota_reached", "quota_reached"] },
  { id: "Q04", event: "resume", expected: [0, "ready", "ready"] },
  { id: "Q05", event: "repeat-refusal", expected: [1, "quota_reached", "quota_reached"] },
  { id: "Q06", event: "processing", expected: [1, "consumed", "processing"] },
  { id: "Q07", event: "unavailable", expected: [1, "consumed", "unavailable"] },
  { id: "Q08", event: "error", expected: [1, "consumed", "error"] },
  { id: "Q09", event: "ack", expected: [1, "open", "complete"] },
  { id: "Q10", event: "unknown-429", expected: [1, "invalid_reply", "error"] },
  { id: "Q11", event: "unknown-restart", expected: [0, "invalid_reply", "error"] },
  { id: "Q12", event: "unknown-resume", expected: [0, "ready", "ready"] },
];
for (const row of rows) {
  test(`${row.id}: ${row.event}`, async (t) => {
    const f = await fixture(t);
    let result;
    if (["unknown-429", "unknown-restart", "unknown-resume"].includes(row.event)) {
      f.respond(429, { error: "legacy", code: "daily_quota_memory_capture" });
      if (row.event !== "unknown-429") await f.claude.capture(batch, binding, "synthetic-event");
    } else if (row.event !== "refuse") {
      f.respond(429, refusal);
      await f.codex.capture(batch, binding, "synthetic-event");
    } else f.respond(429, refusal);
    const baseline = f.requests.length;
    if (row.event === "early-resume" || row.event === "resume") {
      result = await resumeHostedQuota(f.target, {
        now: Date.parse(row.event === "early-resume" ? "2026-10-01T00:00:00Z" : resetAt),
      });
    } else if (row.event === "unknown-resume") {
      result = await resumeHostedQuota(f.target);
    } else {
      if (["repeat-refusal", "processing", "unavailable", "error", "ack"].includes(row.event)) {
        await resumeHostedQuota(f.target, { now: Date.parse(resetAt) });
        if (row.event === "processing") f.respond(200, { ...ack, processing: true });
        if (row.event === "unavailable") f.fail();
        if (row.event === "error") f.respond(200, { extra: true });
        if (row.event === "ack") f.respond(200, ack);
      }
      const client = row.event.includes("restart") ? createHostedTransport(f.options) : f.claude;
      result = await client.capture(batch, binding, "synthetic-event");
    }
    assert.deepEqual([f.requests.length - baseline, (await hostedQuotaStatus(f.target)).mode,
      result.status], row.expected);
  });
}

test("refusal spans both endpoints/clients and restart; resume permits one attempt", async (t) => {
  const f = await fixture(t); f.respond(429, { error: "quota_reached" });
  f.codex = createHostedTransport({ ...f.options, token: "other-synthetic-token" });
  assert.equal((await f.claude.recall("synthetic", binding)).status, "quota_reached");
  assert.equal((await f.codex.capture(batch, binding, "synthetic-event")).status, "quota_reached");
  assert.equal((await createHostedTransport(f.options).recall("synthetic")).status, "quota_reached");
  assert.equal(f.requests.length, 1);
  assert.equal((await hostedQuotaStatus(f.target)).reset, "reset unknown");
  await resumeHostedQuota(f.target); await resumeHostedQuota(f.target);
  f.respond(429, refusal);
  await f.codex.capture(batch, binding, "synthetic-event");
  await f.claude.recall("synthetic", binding);
  assert.equal(f.requests.length, 2);
  assert.deepEqual(f.requests[1].body, { client: "codex", event_id: "synthetic-event",
    session_id: binding.sessionId, project_id: binding.projectId, messages: batch });
  const state = await readFile(join(f.target.root, "hosted-quota", `${f.target.targetId}.json`), "utf8");
  assert.equal(state, JSON.stringify({ version: 1, mode: "quota_reached", resetAt }));
});
test("only one client can consume a resumed attempt while the other contends", async (t) => {
  const f = await fixture(t); f.respond(429, refusal);
  await f.claude.capture(batch, binding, "synthetic-event");
  await resumeHostedQuota(f.target, { now: Date.parse(resetAt) });
  let release; let entered;
  const begun = new Promise((resolve) => { entered = resolve; });
  const pending = new Promise((resolve) => { release = resolve; });
  globalThis.fetch = async () => { f.requests.push({}); entered(); await pending;
    return Response.json(refusal, { status: 429 }); };
  const first = f.codex.capture(batch, binding, "synthetic-event");
  await begun;
  assert.equal((await hostedQuotaStatus(f.target)).mode, "consumed");
  assert.equal((await f.claude.recall("synthetic")).status, "unavailable");
  release(); await first;
  assert.equal((await f.claude.recall("synthetic")).status, "quota_reached");
  assert.equal(f.requests.length, 2);
});
test("interruption and failed refusal publication leave a durable closed gate", async (t) => {
  const f = await fixture(t); f.respond(429, refusal);
  await withWriteObserver(({ path, kind }) => {
    if (kind === "write" && path.endsWith(".json")) throw new Error("synthetic interruption");
  }, () =>
    f.codex.capture(batch, binding, "synthetic-event"));
  assert.equal(f.requests.length, 0);
  assert.equal((await hostedQuotaStatus(f.target)).mode, "unconfirmed");
  await resumeHostedQuota(f.target);
  let writes = 0;
  await withWriteObserver(() => { if (++writes === 2) throw new Error("synthetic interruption"); },
    () => f.claude.capture(batch, binding, "synthetic-event"));
  assert.equal((await createHostedTransport(f.options).recall("synthetic")).status, "quota_reached");
  assert.equal(f.requests.length, 1);
});
test("a consumed attempt remains closed after restart and requires explicit resume", async (t) => {
  const f = await fixture(t); f.respond(429, { error: "quota_reached" });
  await f.codex.capture(batch, binding, "synthetic-event");
  await resumeHostedQuota(f.target); f.fail();
  await f.claude.capture(batch, binding, "synthetic-event");
  await createHostedTransport(f.options).recall("synthetic");
  assert.equal(f.requests.length, 2);
  await resumeHostedQuota(f.target); f.respond(200, ack);
  assert.equal((await f.codex.capture(batch, binding, "synthetic-event")).status, "complete");
  assert.equal((await hostedQuotaStatus(f.target)).mode, "open");
});
test("corrupt private gate suppresses dispatch and cannot be cleared by a hook", async (t) => {
  const f = await fixture(t);
  const dir = join(f.options.root, "hosted-quota"); await mkdir(dir, { mode: 0o700 });
  await writeFile(join(dir, `${f.target.targetId}.json`), "{", { mode: 0o600 });
  assert.equal((await f.codex.capture(batch, binding, "synthetic-event")).status, "unavailable");
  assert.equal(f.requests.length, 0);
});
test("target identity survives credential rotation and isolates configured endpoints", () => {
  const options = { endpoint: "https://synthetic.invalid/", token: "synthetic-token" };
  assert.equal(hostedTargetId(options), hostedTargetId({ ...options, endpoint: "https://synthetic.invalid" }));
  assert.equal(hostedTargetId(options), hostedTargetId({ ...options, token: "other-synthetic" }));
  assert.notEqual(hostedTargetId(options), hostedTargetId({ endpoint: "https://other.invalid" }));
});
test("Codex rejects redirects and Claude preserves its request options and discriminator", async (t) => {
  const f = await fixture(t);
  await f.codex.capture(batch, binding, "synthetic-event");
  await f.claude.capture(batch, binding, "synthetic-event");
  assert.equal(f.requests[0].redirect, "error");
  assert.equal(f.requests[1].redirect, undefined);
  assert.equal(f.requests[1].body.client, "claude-code");
});
test("JSON poster does not acknowledge malformed success or unrecognized 429", async (t) => {
  const f = await fixture(t);
  const post = createJsonPoster(f.options);
  f.respond(200, { accepted: true });
  await assert.rejects(post(capture, {}, 1000), /invalid_reply/);
  f.respond(429, { error: "legacy" });
  await assert.rejects(post(capture, {}, 1000), /invalid_reply/);
  const count = f.requests.length;
  await assert.rejects(post(recall, {}, 1000), /invalid_reply/);
  assert.equal(f.requests.length, count);
});
test("session-start parser is available without enabling lifecycle hooks or spending quota", async (t) => {
  const f = await fixture(t); f.respond(429, refusal);
  await f.codex.capture(batch, binding, "synthetic-event");
  f.respond(200, sessionContext());
  const result = await f.codex.sessionStart({ version: 1 }, { countTokens: () => 100 });
  assert.equal(result.status, "complete");
  assert.equal((await hostedQuotaStatus(f.target)).mode, "quota_reached");
});


test("released standalone root aliases and fresh resume retain compatibility", async (t) => {
  const f = await fixture(t);
  const alias = join(f.options.home, "alias"); await symlink(f.options.root, alias);
  const port = createHostedTransport({ ...f.options, root: alias });
  assert.equal((await port.capture(batch, binding, "synthetic-event")).status, "complete");
  const fresh = { root: join(f.options.home, "new-root"), targetId: f.target.targetId };
  assert.equal((await resumeHostedQuota(fresh)).status, "active");
});


test("invalid shared requests and already aborted work do not consume resume", async (t) => {
  const f = await fixture(t); f.respond(429, { error: "quota_reached" });
  await f.codex.capture(batch, binding, "synthetic-event"); await resumeHostedQuota(f.target);
  assert.equal((await f.codex.recall("", binding)).status, "error");
  assert.equal((await f.codex.capture([], binding, "synthetic-event")).status, "error");
  const abort = new AbortController(); abort.abort();
  assert.equal((await f.codex.capture(batch, binding, "synthetic-event", abort.signal)).status,
    "unavailable");
  assert.equal((await hostedQuotaStatus(f.target)).mode, "ready");
  assert.equal(f.requests.length, 1);
});
