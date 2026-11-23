import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { allDigests, CoreError } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";
import { hostedScope as scope, memory, serviceFake } from "./helpers/service-fake.mjs";

const source = { kind: "import", client: "archive", sessionId: "session" };
const item = (text, kind = "fact") => ({ text, kind });
const numbered = count => Array.from({ length: count }, (_, i) => item("Archive entry " + i));
const counts = (imported = 0, duplicate = 0, suppressed = 0, invalid = 0) =>
  ({ imported, duplicate, suppressed, invalid });
const code = expected => error => error instanceof CoreError && error.code === expected && error.message === expected;
const sha = text => createHash("sha256").update(text).digest("hex");

function setup(options = {}) {
  const fake = serviceFake({ writes: true, forgetting: {}, ...options });
  return { ...fake, service: createMemoryService(fake.deps) };
}

test("counts invalid rows individually and enforces the hosted code-point limit", async () => {
  // Hosted src/memory/import.ts:16–30,38–47 and src/memory/time.ts:3–16.
  const { service, committed, calls } = setup();
  const max = "😀".repeat(4000);
  const valid = { ...item("  Keep\0  this note. ", "preference"), createdAtMs: 0 };
  const items = [null, 9, item(" \0 "), item(1), item("x", "other"), item("x", Symbol()),
    item("x", () => {}), { get text() { throw new Error("bad row"); } }, item(max + "x"),
    { ...item("bad time"), createdAtMs: "1970-01-01" }, { ...item("bad time"), createdAtMs: 0.5 },
    { ...item("bad time"), createdAtMs: Infinity }, { ...item("bad time"), createdAtMs: 253402300800000 },
    { ...item("bad time"), createdAtMs: -62135596800001 }, item(max), valid];
  items.length++;
  assert.deepEqual(await service.importMemories(scope, items, source), counts(2, 0, 0, 15));
  const rows = committed(scope.owner).rows;
  assert.deepEqual(rows.map(({ text, kind, origin, source }) => ({ text, kind, origin, source })), [
    { text: max, kind: "fact", origin: "explicit", source },
    { text: "Keep this note.", kind: "preference", origin: "explicit", source },
  ]);
  assert.equal(rows[0].createdAtMs, rows[0].updatedAtMs);
  assert.deepEqual(calls.filter(([name]) => name === "embed"), [["embed", [max, "keep this note."]]]);
  calls.length = 0;
  assert.deepEqual(await service.importMemories(scope, [null], source), counts(0, 0, 0, 1));
  assert.deepEqual(await service.importMemories(scope, [], source), counts());
  assert.deepEqual(calls, []);
});

test("rejects malformed call shapes before any port", async () => {
  const { service, calls } = setup();
  for (const args of [
    [scope, {}, source], [scope, null, source], [null, [item("valid")], source],
    [{ owner: " owner ", namespace: null }, [], source], [scope, [item("valid")], null],
    [scope, [], { ...source, kind: "unknown" }], [scope, [], { ...source, client: "" }],
    [scope, [], { ...source, sessionId() {} }],
  ]) await assert.rejects(() => service.importMemories(...args), code("invalid_input"));
  assert.deepEqual(calls, []);
});

test("takes one entry snapshot including the row in the second batch", async () => {
  const { service, hooks, committed } = setup();
  const reads = [];
  const input = {
    get owner() { reads.push("owner"); return scope.owner; }, namespace: null,
  };
  const inputSource = {
    ...source, get client() { reads.push("client"); return source.client; },
  };
  const last = {
    get text() { reads.push("text"); return "Original text"; },
    get kind() { reads.push("kind"); return "decision"; },
    get createdAtMs() { reads.push("time"); return 10; },
  };
  const items = [...Array(100).fill(null), last];
  hooks.beforeRun = () => {
    assert.deepEqual(reads, ["owner", "client", "text", "kind", "time"]);
    input.namespace = "different";
    inputSource.sessionId = "different";
    items[100] = item("Changed");
  };
  assert.deepEqual(await service.importMemories(input, items, inputSource), counts(1, 0, 0, 100));
  const [row] = committed(scope.owner).rows;
  assert.deepEqual([row.scope, row.source, row.text, row.kind], [scope, source, "Original text", "decision"]);
});

test("exact duplicates leave the stored row untouched, including repeats inside one batch", async () => {
  // Hosted src/memory/import.ts:66–81 counts exact hash conflicts without an update.
  const { service, committed, mutations } = setup();
  assert.deepEqual(await service.importMemories(scope, [item("Morning notes")], source), counts(1));
  const [first] = committed(scope.owner).rows;
  mutations.length = 0;
  const input = [item("  MORNING  notes ", "context"), item("Evening notes"), item("evening notes", "decision")];
  assert.deepEqual(await service.importMemories(scope, input, { ...source, client: "other" }), counts(1, 2));
  assert.deepEqual(committed(scope.owner).rows[0], first);
  assert.deepEqual(mutations.map(({ method }) => method), ["memories.insert"]);
});

test("a visible near neighbour is inserted with the caller's kind and source", async () => {
  // Hosted src/memory/import.ts:51–81 filters suppressions and then ignores exact conflicts only.
  const { service, hooks, committed, calls } = setup({ near: true });
  assert.deepEqual(await service.importMemories(scope, [item("Check the blue notebook")], source), counts(1));
  hooks.nearDistance = () => 0.02;
  calls.length = 0;
  const givenSource = { ...source, kind: "mcp" };
  assert.deepEqual(await service.importMemories(scope, [item("Check the green notebook", "instruction")], givenSource),
    counts(1));
  const [, row] = committed(scope.owner).rows;
  assert.deepEqual([row.kind, row.origin, row.source], ["instruction", "explicit", givenSource]);
  assert.equal(calls.find(([name]) => name === "memories.readWritePolicy")[4], "full");
});

test("a hidden exact match is suppressed even when another batch position only matches it near", async () => {
  const wording = "The lantern is stored in the cellar.";
  const hidden = { ...memory("hidden", { text: wording }), textHash: "sha256:" + sha(wording.toLowerCase()) };
  const { service, forget, hooks, committed } = setup({ rows: [hidden], near: true });
  forget(hidden);
  hooks.nearDistance = () => 0.02;
  assert.deepEqual(await service.importMemories(scope, [item("A different lantern"), item(wording)], source),
    counts(1, 0, 1));
  assert.deepEqual(committed(scope.owner).rows.map(({ text }) => text), [wording, "A different lantern"]);
});

test("the source and per-item times reach suppression, which takes precedence over visible duplicates", async () => {
  const { service, storage, calls } = setup();
  const duplicate = item("Existing note");
  await service.importMemories(scope, [duplicate], source);
  const readWritePolicy = storage.memories.readWritePolicy;
  storage.memories.readWritePolicy = async (...args) => ({
    ...await readWritePolicy(...args), blockedPositions: [1],
  });
  const snapshot = storage.suppressions.snapshot;
  storage.suppressions.snapshot = async (...args) => ({
    ...await snapshot(...args), blockedMessages: [0],
  });

  const items = [{ ...item("First"), createdAtMs: 10 }, duplicate, item("Third")];
  assert.deepEqual(await service.importMemories(scope, items, source), counts(1, 0, 2));
  const [, , candidates] = calls.findLast(([method]) => method === "suppressions.snapshot");
  assert.deepEqual(candidates, { client: source.client, sessionId: source.sessionId, occurredAtMs: [10, null, null] });
});

test("windows block clientless imports by time, failing closed inside a client-specific window", async () => {
  const { service, seedFact } = setup();
  seedFact({ ...scope, kind: "window", origin: "forget", actionId: "owner-window", client: null,
    window: { startMs: 10, endMs: 20 } });
  seedFact({ ...scope, kind: "window", origin: "forget", actionId: "client-window", client: source.client,
    window: { startMs: 20, endMs: 30 } });

  const withoutClient = { kind: "import", client: null, sessionId: null };
  const inside = { ...item("Inside window"), createdAtMs: 15 };
  assert.deepEqual(await service.importMemories(scope, [inside], withoutClient), counts(0, 0, 1));
  assert.deepEqual(await service.recent(scope, { limit: 10, cursor: null }), { items: [], nextCursor: null });
  assert.deepEqual(await service.importMemories(scope, [inside], source), counts(0, 0, 1));

  const end = { ...item("At end of owner window"), createdAtMs: 20 };
  assert.deepEqual(await service.importMemories(scope, [end], source), counts(0, 0, 1));
  // Ruling B, time-bounded: inside the client-specific window [20, 30) a clientless item cannot be ruled out.
  assert.deepEqual(await service.importMemories(scope, [end], withoutClient), counts(0, 0, 1));
  const after = { ...item("After every window"), createdAtMs: 30 };
  assert.deepEqual(await service.importMemories(scope, [after], withoutClient), counts(1));
  const { items } = await service.recent(scope, { limit: 10, cursor: null });
  assert.deepEqual(items.map(({ text, source }) => ({ text, source })), [{ text: after.text, source: withoutClient }]);
});

test("with only owner-wide windows, a clientless import outside them is imported", async () => {
  const { service, seedFact } = setup();
  seedFact({ ...scope, kind: "window", origin: "forget", actionId: "owner-window", client: null,
    window: { startMs: 10, endMs: 20 } });
  const withoutClient = { kind: "import", client: null, sessionId: null };
  const inside = { ...item("Inside the owner window"), createdAtMs: 19 };
  const end = { ...item("At the owner window end"), createdAtMs: 20 };
  assert.deepEqual(await service.importMemories(scope, [inside], withoutClient), counts(0, 0, 1));
  assert.deepEqual(await service.importMemories(scope, [end], withoutClient), counts(1));
  const { items } = await service.recent(scope, { limit: 10, cursor: null });
  assert.deepEqual(items.map(({ text, source }) => ({ text, source })), [{ text: end.text, source: withoutClient }]);
});

test("an identity forget on a hosted-v1 alias suppresses import just as it suppresses save", async () => {
  const wording = "Archive marker crn_pat_" + "z".repeat(32);
  const [canonical, legacy] = await allDigests(wording, null);
  assert.equal(legacy.pipeline, "hosted-v1");
  assert.notEqual(legacy.value, canonical.value);
  const row = { ...memory("legacy-alias", { text: wording }), textHash: "sha256:" + legacy.value };
  const { service, seedFact, committed } = setup({ rows: [row] });
  seedFact({ ...scope, kind: "identity", origin: "forget", actionId: "legacy-forget",
    memoryId: row.id, throughRevision: row.revision });

  assert.deepEqual(await service.save(scope, wording, source), { status: "suppressed" });
  assert.deepEqual(await service.importMemories(scope, [item(wording)], source), counts(0, 0, 1));
  assert.deepEqual(committed(scope.owner).rows, [row]);
});

test("forget suppresses exact wording and single-passage containment on import", async () => {
  // Hosted src/memory/import.ts:49–59 and src/memory/fingerprint.ts:91–109 apply full passage suppression.
  const wording = "The lantern is stored in the cellar.";
  const { service, committed } = setup();
  await service.importMemories(scope, [item(wording)], source);
  const [row] = committed(scope.owner).rows;
  assert.equal((await service.forget(scope, row.id, source)).status, "forgotten");
  const replay = [item(wording), item("Earlier note for reference: " + wording), item("Fresh weather report")];
  assert.deepEqual(await service.importMemories(scope, replay, source), counts(1, 0, 2));
  assert.deepEqual(committed(scope.owner).rows.map(({ text }) => text), ["Fresh weather report"]);
});

test("full import policy matches the hosted redaction spelling of a forgotten row", async () => {
  // Hosted src/memory/import.ts:49–59 and src/memory/fingerprint.ts:75–98 retain historical spellings.
  const long = "crn_pat_" + "a".repeat(33);
  const short = "crn_pat_" + "z".repeat(32);
  const hostedText = `![REDACTED]@ ${long} @[REDACTED])`;
  const replay = `!${short}@ ${long} @${short})`;
  const { service, seedFact, mutations } = setup();
  seedFact({
    ...scope, kind: "text", mode: "exact", origin: "forget", actionId: "hosted-fixture",
    text: { digests: [{
      alg: "sha256", value: sha(hostedText.toLowerCase()), pipeline: "hosted-v1", redactionVersion: 2, keyId: null,
    }] },
  });
  assert.deepEqual(await service.importMemories(scope, [item(replay)], source), counts(0, 0, 1));
  assert.deepEqual(mutations, []);
});

test("100/101 boundary uses original positions and commits a write UoW for each nonempty batch", async () => {
  // Hosted src/memory/import.ts:13,41–51 slices 100 input positions before filtering invalids.
  const { service, calls, mutations } = setup();
  const items = numbered(101);
  items[99] = null;
  assert.deepEqual(await service.importMemories(scope, items, source), counts(100, 0, 0, 1));
  assert.deepEqual(calls.filter(([name]) => name === "embed").map(([, texts]) => texts.length), [99, 1]);
  assert.deepEqual(mutations.map(({ run }) => run), [...Array(99).fill(2), 4]);
  assert.deepEqual(calls.filter(([name]) => name === "run"), Array(4).fill(["run", scope.owner, { pauseLock: true }]));
});

test("pause before the first batch sends nothing and writes nothing", async () => {
  const { service, calls, mutations } = setup();
  await service.setPause(scope.owner, true);
  calls.length = 0;
  const before = mutations.length;
  assert.deepEqual(await service.importMemories(scope, [item("First")], source), { status: "paused", ...counts() });
  assert.deepEqual(calls.map(([method]) => method), ["run", "lock", "lock", "pause.get"]);
  assert.equal(mutations.length, before);
});

test("pause between batches returns the counts from the committed first batch only", async () => {
  const { service, calls, hooks, committed } = setup();
  let runs = 0;
  hooks.beforeRun = async () => {
    if (++runs === 3) await service.setPause(scope.owner, true);
  };
  const items = numbered(102);
  items[1] = items[0];
  items[2] = null;
  items[100] = null;
  assert.deepEqual(await service.importMemories(scope, items, source), { status: "paused", ...counts(98, 1, 0, 1) });
  assert.equal(committed(scope.owner).rows.length, 98);
  assert.equal(calls.filter(([name]) => name === "embed").length, 1);
});

test("pause includes an already processed invalid-only batch and excludes invalids in the stopped batch", async () => {
  const { service } = setup();
  await service.setPause(scope.owner, true);
  const items = [...Array(101).fill(null), item("Still pending")];
  assert.deepEqual(await service.importMemories(scope, items, source), { status: "paused", ...counts(0, 0, 0, 100) });
});

test("a closed dispatch gate sends nothing and opens no write batch", async () => {
  const { service, calls, hooks, mutations } = setup();
  hooks.gate = phase => {
    assert.equal(phase, "dispatch");
    throw new CoreError("capture_paused");
  };
  assert.deepEqual(await service.importMemories(scope, [item("First")], source), { status: "paused", ...counts() });
  assert.deepEqual(calls.filter(([name]) => name === "gate" || name === "embed"), [["gate", scope.owner, "dispatch"]]);
  assert.equal(calls.filter(([name]) => name === "run").length, 1);
  assert.deepEqual(mutations, []);
});

test("pause and resume during the embed changes generation and discards the batch", async () => {
  const { service, hooks, committed, calls } = setup();
  hooks.embed = async () => {
    await service.setPause(scope.owner, true);
    await service.setPause(scope.owner, false);
  };
  assert.deepEqual(await service.importMemories(scope, [item("First")], source), { status: "paused", ...counts() });
  assert.deepEqual(await service.pauseState(scope.owner), { paused: false, generation: 1 });
  assert.deepEqual(committed(scope.owner).rows, []);
  assert.equal(calls.some(([method]) => method === "memories.readWritePolicy"), false);
});

test("import stores the supplied creation time and uses the write time for the update", async () => {
  const { service, deps } = setup();
  deps.clock.nowMs = () => 100;
  const items = [{ ...item("Historical note"), createdAtMs: -10 }, { ...item("Current note"), createdAtMs: 100 }];
  assert.deepEqual(await service.importMemories(scope, items, source), counts(2));
  const recent = await service.recent(scope, { limit: 10, cursor: null });
  assert.deepEqual(recent.items.map(({ text, createdAtMs, updatedAtMs }) => ({ text, createdAtMs, updatedAtMs })), [
    { text: "Current note", createdAtMs: 100, updatedAtMs: 100 },
    { text: "Historical note", createdAtMs: -10, updatedAtMs: 100 },
  ]);
});

test("import counts a future creation time as invalid without embedding that item", async () => {
  const { service, deps, calls, committed } = setup();
  deps.clock.nowMs = () => 100;
  const items = [{ ...item("Future note"), createdAtMs: 101 }, item("Valid note")];
  assert.deepEqual(await service.importMemories(scope, items, source), counts(1, 0, 0, 1));
  assert.deepEqual(calls.filter(([method]) => method === "embed"), [["embed", ["valid note"]]]);
  assert.deepEqual(committed(scope.owner).rows.map(({ text }) => text), ["Valid note"]);
});

test("import counts a creation time that becomes future before the write as invalid", async () => {
  const { service, deps, hooks, committed } = setup();
  let now = 100;
  deps.clock.nowMs = () => now;
  hooks.embed = () => { now = 90; };
  assert.deepEqual(await service.importMemories(scope, [{ ...item("Clock moved back"), createdAtMs: 95 }], source),
    counts(0, 0, 0, 1));
  assert.deepEqual(committed(scope.owner).rows, []);
});

test("a missing required embedding fails the whole batch before writes and retains the prior commit", async () => {
  const { service, hooks, calls, committed } = setup({ forgetting: { capabilities: { embeddingRequiredOnInsert: true } } });
  hooks.embedBatch = texts => texts.length === 100 ? texts.map(() => Float32Array.of(1)) : [Float32Array.of(1)];
  await assert.rejects(() => service.importMemories(scope, numbered(102), source), error =>
    code("embedding_failed")(error) && error.retryable);
  assert.equal(committed(scope.owner).rows.length, 100);
  assert.equal(calls.filter(([method]) => method === "memories.readWritePolicy").length, 1);
  assert.equal(calls.filter(([method]) => method === "run").length, 3);
});

test("an optional missing embedding is stored as null without shifting the remaining vectors", async () => {
  const { service, hooks, committed } = setup({ forgetting: { capabilities: { embeddingRequiredOnInsert: false } } });
  hooks.embedBatch = () => [, Float32Array.of(1)];
  assert.deepEqual(await service.importMemories(scope, [item("One"), item("Two"), item("Three")], source), counts(3));
  assert.deepEqual(committed(scope.owner).rows.map(({ embedding }) => embedding), [
    null, { model: "embedder", vector: Float32Array.of(1) }, null,
  ]);
});

test("an unrelated import supplies current-key digests to policy and storage after an HMAC-only forget", async () => {
  const legacy = "Ｘsk-0123456789abcdef";
  const { service, storage, insert, committed, calls } = setup();
  const key = await storage.keys.userKey(scope.owner);
  insert({ ...memory("legacy", { text: legacy }), digests: await allDigests(legacy, key) });
  assert.equal((await service.forget(scope, "legacy", source)).status, "forgotten");
  const [{ fact }] = committed(scope.owner).facts;
  assert.ok(fact.text.digests.length > 0 && fact.text.digests.every(({ alg }) => alg === "hmac"));
  const wording = "Buy more chalk.";
  assert.deepEqual(await service.importMemories(scope, [item(wording)], source), counts(1));
  const expected = await allDigests(wording, key);
  assert.deepEqual(calls.findLast(([method]) => method === "memories.readWritePolicy")[2].digests, expected);
  assert.deepEqual(committed(scope.owner).rows[0].digests, expected);
});

test("foreign port throws become CoreError and an insertion failure rolls back the batch", async () => {
  const { service, hooks, storage, committed } = setup();
  const foreign = Object.assign(new Error("foreign port details"), { code: "capture_paused" });
  hooks.gate = () => { throw foreign; };
  await assert.rejects(() => service.importMemories(scope, [item("First")], source), code("internal_error"));
  hooks.gate = undefined;
  hooks.embed = () => { throw foreign; };
  await assert.rejects(() => service.importMemories(scope, [item("First")], source), code("internal_error"));
  hooks.embed = undefined;
  const insert = storage.memories.insert;
  storage.memories.insert = async (...args) => {
    const row = await insert(...args);
    if (args[2].text === "Second") throw foreign;
    return row;
  };
  await assert.rejects(() => service.importMemories(scope, [item("First"), item("Second")], source), code("internal_error"));
  assert.deepEqual(committed(scope.owner).rows, []);
});

test("identical text from two owners is independent", async () => {
  const { service, committed } = setup();
  const other = { ...scope, owner: "other" };
  const items = [item("Check the lantern")];
  assert.deepEqual(await service.importMemories(scope, items, source), counts(1));
  assert.deepEqual(await service.importMemories(other, items, source), counts(1));
  assert.deepEqual(await service.importMemories(scope, items, source), counts(0, 1));
  const [a] = committed(scope.owner).rows;
  const [b] = committed(other.owner).rows;
  assert.equal(a.textHash, b.textHash);
  assert.notEqual(a.digests.find(({ alg }) => alg === "hmac").value, b.digests.find(({ alg }) => alg === "hmac").value);
});
