import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { CoreError } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";
import { hostedScope as scope, memory, serviceFake } from "./helpers/service-fake.mjs";

const source = { kind: "mcp", client: null, sessionId: null };
const editSource = { kind: "web", client: "editor", sessionId: null };
const oldText = "The lantern is stored in the cellar.";
const newText = "Use the blue notebook for inventory.";
const sha = value => createHash("sha256").update(value).digest("hex");
const isCode = code => error => error instanceof CoreError && error.code === code && error.message === code;

function seeded(id, text = oldText, options) {
  // Hosted src/memory/text.ts:96–106 hashes normalized text. Fixtures here are ASCII.
  return { ...memory(id, { text }), textHash: "sha256:" + sha(text.toLowerCase()), ...options };
}

function forgotten(text, scopeOfFact = scope) {
  return {
    ...scopeOfFact, actionId: "forget-fixture", kind: "text", mode: "exact", origin: "forget",
    text: { digests: [{
      alg: "sha256", value: sha(text.toLowerCase()), pipeline: "hosted-v1", redactionVersion: 1, keyId: null,
    }] },
  };
}

function setup(options) {
  const fake = serviceFake({ writes: true, ...options });
  return { ...fake, service: createMemoryService(fake.deps) };
}

function phases(calls) {
  return calls.filter(([method]) => method === "gate" || method === "embed").map(([method, , phase]) => phase ?? method);
}

test("save inserts prepared text, then reads and fences the returned row", async () => {
  const { service, calls, mutations } = setup();
  const result = await service.save(scope, "  Buy   more chalk.  ", source);
  // Hosted src/memory/index.ts:177–199 and storage.ts:258–266 use a fact by default and retain its source.
  assert.equal(result.status, "saved");
  assert.deepEqual(result.item, {
    id: "inserted-1", scope, text: "Buy more chalk.", textHash: "sha256:" + sha("buy more chalk."),
    kind: "fact", origin: "explicit", confidence: 1, source, embedding: { model: "embedder", vector: Float32Array.of(1) },
    revision: 1, createdAtMs: 101, updatedAtMs: 101, updatedAtUs: 101000n,
  });
  assert.deepEqual(mutations.map(({ method }) => method), ["memories.insert"]);
  assert.deepEqual(phases(calls), ["pre-send", "dispatch", "embed", "post-send"]);
  assert.deepEqual(calls.filter(([name]) => name === "run").map(([, , options]) => options),
    [{ pauseLock: true }, { pauseLock: true }, { readOnly: true }]);
  assert.deepEqual(calls.slice(-3).map(([name]) => name), ["run", "memories.get", "fence.assertVisible"]);
});

test("save touches an exact duplicate without changing kind, origin, source, or confidence", async () => {
  const original = seeded("existing", oldText, {
    kind: "decision", origin: "inferred", source: { kind: "plugin", client: "first", sessionId: "original" },
    confidence: 0.45, revision: 3,
  });
  const { service, mutations } = setup({ rows: [original] });
  const result = await service.save(scope, oldText, editSource, "preference");
  // Hosted src/memory/storage.ts:242–247 updates only updated_at on a duplicate.
  assert.equal(result.status, "duplicate");
  assert.deepEqual(result.item, { ...original, updatedAtMs: 101, updatedAtUs: 101000n });
  assert.deepEqual(mutations.map(({ method }) => method), ["memories.touchDuplicate"]);
});

test("save classifies near duplicates only with the capability and within the distance cutoff", async () => {
  for (const [near, distance, status] of [[true, 0.08, "duplicate"], [true, 0.08001, "saved"], [false, 0.03, "saved"]]) {
    const { service, hooks, mutations } = setup({ rows: [seeded("existing")], near });
    hooks.nearDistance = () => distance;
    // Hosted src/memory/index.ts:29–31 and storage.ts:143–154 use the inclusive cosine distance cutoff.
    const result = await service.save(scope, newText, source);
    assert.equal(result.status, status);
    assert.deepEqual(mutations.map(({ method }) => method),
      [status === "duplicate" ? "memories.touchDuplicate" : "memories.insert"]);
  }
});

test("forgotten wording suppresses save before dedupe or any mutation", async () => {
  const { service, seedFact, calls, mutations } = setup({ rows: [seeded("would-match")] });
  seedFact(forgotten(oldText));
  // Hosted src/memory/index.ts:193–198 and suppressions.ts:138–149 refuse exact passage matches.
  assert.deepEqual(await service.save(scope, oldText, source), { status: "suppressed" });
  assert.ok(calls.some(([method]) => method === "suppressions.snapshot"));
  assert.ok(!calls.some(([method]) => method === "memories.readWritePolicy"));
  assert.deepEqual(mutations, []);
});

test("save and correct honor suppression committed while embedding", async () => {
  const target = seeded("target");
  for (const method of ["save", "correct"]) {
    const { service, hooks, seedFact, mutations } = setup({ rows: [target] });
    hooks.embed = () => { seedFact(forgotten(newText)); };
    const result = method === "save"
      ? await service.save(scope, newText, source)
      : await service.correct(scope, target.id, 1, newText, editSource);
    assert.deepEqual(result, { status: "suppressed" });
    assert.deepEqual(mutations, []);
  }
});

test("a hidden exact match owns the hash even when a visible near match exists", async () => {
  const hidden = seeded("hidden");
  const { service, forget, hooks, mutations } = setup({ rows: [hidden, seeded("near", newText)], near: true });
  hooks.nearDistance = () => 0.02;
  forget(hidden);
  // Hosted src/memory/storage.ts:188–201 suppresses a hidden exact before choosing a visible near match.
  assert.deepEqual(await service.save(scope, oldText, source), { status: "suppressed" });
  assert.deepEqual(mutations, []);
});

test("a hidden id with omitted match detail fails closed", async () => {
  const { service, storage, mutations } = setup();
  storage.memories.readWritePolicy = async () => ({
    matches: [[]], hiddenIds: ["unclassified"], blockedPositions: [], blockedSession: false,
  });
  assert.deepEqual(await service.save(scope, oldText, source), { status: "suppressed" });
  assert.deepEqual(mutations, []);
});

test("a paused preflight sends nothing for save or correct", async () => {
  const { service, calls, mutations } = setup({ rows: [seeded("target")] });
  await service.setPause(scope.owner, true);
  assert.deepEqual(await service.save(scope, newText, source), { status: "paused" });
  assert.deepEqual(await service.correct(scope, "target", 1, newText, source), { status: "paused" });
  assert.deepEqual(phases(calls), []);
  assert.deepEqual(mutations, []);
});

test("pause and resume during embed discard both operations by generation", async () => {
  const { service, hooks, calls, mutations } = setup({ rows: [seeded("target")] });
  hooks.embed = async () => {
    await service.setPause(scope.owner, true);
    await service.setPause(scope.owner, false);
  };
  assert.deepEqual(await service.save(scope, newText, source), { status: "paused" });
  assert.deepEqual(await service.correct(scope, "target", 1, newText, source), { status: "paused" });
  assert.equal(calls.filter(([name]) => name === "embed").length, 2);
  assert.deepEqual(mutations, []);
});

test("dispatch denial sends nothing and leaves no writes", async () => {
  const { service, hooks, calls, mutations } = setup();
  hooks.gate = phase => {
    if (phase === "dispatch") throw new CoreError("model_unavailable");
  };
  await assert.rejects(service.save(scope, oldText, source), isCode("model_unavailable"));
  assert.deepEqual(phases(calls), ["pre-send", "dispatch"]);
  assert.deepEqual(mutations, []);
});

test("embedding starts in the dispatch continuation and only receives masked normalized text", async () => {
  const { service, calls } = setup();
  assert.equal((await service.save(scope, "label Ｂｅａｒｅｒ abcdefghijklmnopqrst", source)).status, "saved");
  assert.deepEqual(calls.find(([name]) => name === "embed"), ["embed", ["label [redacted]"]]);
});

test("post-send denial discards the embedding", async () => {
  const { service, hooks, calls, mutations } = setup();
  hooks.gate = phase => {
    if (phase === "post-send") throw new CoreError("model_unavailable");
  };
  await assert.rejects(service.save(scope, oldText, source), isCode("model_unavailable"));
  assert.deepEqual(phases(calls), ["pre-send", "dispatch", "embed", "post-send"]);
  assert.deepEqual(mutations, []);
});

test("save and correct require the suppression snapshot capability", async () => {
  for (const unavailable of ["throws", "absent"]) {
    const { service, storage, hooks, mutations } = setup({ rows: [seeded("target")] });
    if (unavailable === "throws") hooks.snapshot = () => { throw new CoreError("capability_unavailable"); };
    else delete storage.suppressions.snapshot;
    const invoke = [
      () => service.save(scope, newText, source),
      () => service.correct(scope, "target", 1, newText, editSource),
      () => service.correct(scope, "target", 1, oldText, editSource),
    ];
    for (const action of invoke) await assert.rejects(action, isCode("capability_unavailable"));
    assert.deepEqual(mutations, []);
  }
});

test("an unchanged correction returns the current row without bumping revision, writing a fact, or embedding", async () => {
  const target = seeded("target", oldText, { revision: 8 });
  const { service, calls, committed, mutations } = setup({ rows: [target] });
  // Core's edit rule supersedes the same-hash status in hosted src/memory/index.ts:220.
  assert.deepEqual(await service.correct(scope, target.id, target.revision, "  " + oldText.toUpperCase(), editSource),
    { status: "unchanged", item: target });
  assert.ok(!phases(calls).includes("embed"));
  assert.deepEqual(mutations, []);
  assert.deepEqual(committed(scope.owner), { rows: [target], facts: [] });
});

test("a changed correction writes an exact predecessor fact before the replacement in the same run", async () => {
  const target = seeded("target", oldText, { kind: "decision", source });
  const { service, mutations, calls, committed } = setup({ rows: [target] });
  const result = await service.correct(scope, target.id, target.revision, newText, editSource);
  assert.equal(result.status, "saved");
  assert.equal(result.item.text, newText);
  assert.equal(result.item.revision, 2);
  // Hosted src/memory/index.ts:225–232 and storage.ts:250–256 keep kind/source and write the fact before replacing.
  assert.equal(result.item.kind, target.kind);
  assert.deepEqual(result.item.source, target.source);
  assert.deepEqual(mutations.map(({ method }) => method), ["suppressions.writeFact", "memories.replaceContent"]);
  assert.equal(mutations[0].run, mutations[1].run);
  const [{ fact, incarnation }] = committed(scope.owner).facts;
  assert.equal(incarnation.length, 64);
  assert.deepEqual(fact.sourceMemory, { id: target.id, createdAtMs: target.createdAtMs });
  assert.equal(fact.origin, "edit");
  assert.equal(fact.mode, "exact");
  assert.ok(fact.text.digests.some(digest => digest.alg === "sha256" && digest.value === sha(oldText.toLowerCase())));
  assert.deepEqual(calls.find(([method]) => method === "memories.readWritePolicy").slice(3), [source, "full", target.id]);
  assert.deepEqual(await service.save(scope, oldText, source), { status: "suppressed" });
});

test("correct refuses stale revisions before the send and rechecks after embedding", async () => {
  const target = seeded("target");
  const { service, hooks, calls, mutations, storage } = setup({ rows: [target] });
  assert.deepEqual(await service.correct(scope, target.id, 2, newText, editSource), { status: "conflict" });
  assert.deepEqual(phases(calls), []);
  const get = storage.memories.get;
  hooks.embed = () => {
    storage.memories.get = async (...args) => ({ ...await get(...args), revision: 2 });
  };
  // Hosted src/memory/index.ts:205,215–219 rechecks the predecessor under the lock.
  assert.deepEqual(await service.correct(scope, target.id, 1, newText, editSource), { status: "conflict" });
  assert.deepEqual(mutations, []);
});

test("correct conflicts on another visible exact match, allows near, and refuses hidden exact", async () => {
  for (const [status, text, hidden] of [["conflict", newText, false], ["saved", "another wording", false], ["suppressed", newText, true]]) {
    const target = seeded("target");
    const neighbour = seeded("neighbour", text);
    const { service, hooks, forget, mutations, committed } = setup({ rows: [target, neighbour], near: true });
    hooks.nearDistance = () => 0.01;
    if (hidden) forget(neighbour);
    // Exact-only collision rule supersedes the duplicate touch in hosted src/memory/index.ts:225–231.
    const result = await service.correct(scope, target.id, 1, newText, editSource);
    assert.equal(result.status, status);
    assert.deepEqual(mutations.map(({ method }) => method),
      status === "saved" ? ["suppressions.writeFact", "memories.replaceContent"] : []);
    assert.deepEqual(committed(scope.owner).rows.find(({ id }) => id === neighbour.id), neighbour);
  }
});

test("correct refuses forgotten wording, a missing fingerprint key, and an absent row", async () => {
  const target = seeded("target");
  const forgottenFixture = setup({ rows: [target] });
  forgottenFixture.seedFact(forgotten(newText));
  assert.deepEqual(await forgottenFixture.service.correct(scope, target.id, 1, newText, editSource), { status: "suppressed" });
  const withoutKey = setup({ rows: [target], hasKey: false });
  // Hosted src/memory/index.ts:86–89,205–207 requires the key only after finding the row.
  await assert.rejects(withoutKey.service.correct(scope, target.id, 1, newText, editSource), isCode("fingerprint_unavailable"));
  assert.deepEqual(await withoutKey.service.correct(scope, "missing", 1, newText, editSource), { status: "not_found" });
  for (const fixture of [forgottenFixture, withoutKey]) assert.deepEqual(fixture.mutations, []);
});

test("a key change during embed refuses a correction before writing its predecessor fact", async () => {
  const { service, hooks, storage, mutations } = setup({ rows: [seeded("target")] });
  hooks.embed = () => { storage.keys.userKey = async () => null; };
  await assert.rejects(service.correct(scope, "target", 1, newText, editSource), isCode("fingerprint_key_mismatch"));
  assert.deepEqual(mutations, []);
});

test("editing legacy secret text writes no unkeyed digest and blocks re-saving that wording", async () => {
  const target = seeded("target", "label Bearer abcdefghijklmnopqrst");
  const { service, committed, calls } = setup({ rows: [target] });
  assert.equal((await service.correct(scope, target.id, 1, newText, editSource)).status, "saved");
  const [{ fact }] = committed(scope.owner).facts;
  assert.ok(fact.text.digests.length > 0 && fact.text.digests.every(digest => digest.alg === "hmac"));
  assert.deepEqual(await service.save(scope, target.text, source), { status: "suppressed" });
  assert.ok(calls.filter(([method]) => method === "embed").every(([, texts]) => !texts[0].includes("abcdefghijklmnopqrst")));
});

test("a replace failure after writing the predecessor rolls back both effects", async () => {
  const target = seeded("target");
  const { service, hooks, committed, mutations } = setup({ rows: [target] });
  hooks.replaceContent = () => { throw new Error("private store details"); };
  await assert.rejects(service.correct(scope, target.id, 1, newText, editSource), isCode("internal_error"));
  assert.deepEqual(mutations.map(({ method }) => method), ["suppressions.writeFact", "memories.replaceContent"]);
  assert.deepEqual(committed(scope.owner), { rows: [target], facts: [] });
});

test("the final fence drops newly hidden rows and a returned foreign row is never delivered or edited", async () => {
  const target = seeded("target");
  const fixture = setup({ rows: [target] });
  let runs = 0;
  fixture.hooks.beforeRun = () => { if (++runs === 3) fixture.forget(target); };
  assert.deepEqual(await fixture.service.save(scope, oldText, source), { status: "suppressed" });

  const foreign = { ...scope, owner: "another-owner" };
  const another = setup({ rows: [seeded("target", oldText, { scope: foreign })] });
  another.seedFact(forgotten(newText, foreign));
  const snapshot = another.storage.suppressions.snapshot;
  another.storage.suppressions.snapshot = async (...args) => {
    const result = await snapshot(...args);
    result.passages.push(...another.committed(foreign.owner).facts);
    return result;
  };
  assert.equal((await another.service.save(scope, newText, source)).status, "saved");
  another.hooks.get = () => seeded("target", oldText, { scope: foreign });
  assert.deepEqual(await another.service.correct(scope, "target", 1, newText, editSource), { status: "not_found" });
  assert.equal(another.mutations.length, 1);
});

test("validates detached write arguments without retaining caller-owned source or scope", async t => {
  const { service, hooks } = setup();
  const input = { ...scope };
  const inputSource = { ...source };
  const clone = t.mock.method(globalThis, "structuredClone", structuredClone);
  hooks.embed = () => {
    input.owner = "another-owner";
    inputSource.kind = "web";
  };
  const result = await service.save(input, oldText, inputSource);
  assert.deepEqual(result.item.scope, scope);
  assert.deepEqual(result.item.source, source);
  assert.equal(clone.mock.callCount(), 1);
  assert.deepEqual(await service.save(scope, "\0  ", source), { status: "invalid" });
  assert.deepEqual(await service.save(scope, oldText, { ...source, kind: "bad" }), { status: "invalid" });
  await assert.rejects(service.correct(scope, "target", -1, newText, source), isCode("invalid_input"));
});

test("foreign failures at write-port boundaries surface as content-free CoreErrors", async () => {
  for (const [port, method] of [
    ["uow", "run"], ["pause", "get"], ["gate", "assertOpen"], ["keys", "userKey"], ["embedder", "embed"],
    ["suppressions", "snapshot"], ["memories", "readWritePolicy"], ["clock", "nowMs"], ["memories", "insert"],
    ["memories", "get"], ["fence", "assertVisible"],
  ]) {
    const { service, storage, deps } = setup();
    (storage[port] ?? deps[port])[method] = () => { throw new Error("private port details"); };
    await assert.rejects(service.save(scope, oldText, source), isCode("internal_error"), port + "." + method);
  }
  for (const [port, method] of [["clock", "sha256Hex"], ["suppressions", "writeFact"], ["memories", "replaceContent"]]) {
    const { service, storage, deps } = setup({ rows: [seeded("target")] });
    (storage[port] ?? deps[port])[method] = () => { throw new Error("private port details"); };
    await assert.rejects(service.correct(scope, "target", 1, newText, editSource), isCode("internal_error"), port + "." + method);
  }
});
