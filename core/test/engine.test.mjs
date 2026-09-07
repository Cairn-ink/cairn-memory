import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { openMemoryStore } from "../index.mjs";
import { createMemoryEngine } from "../engine.mjs";
import { createMockModel } from "../testing/mock-model.mjs";

const captured = (text = "I prefer concise explanations.", eventId = "event-a") => ({
  client: "test", eventId, sessionId: "session-a",
  messages: [{ id: "message-a", role: "user", content: text }],
});
const candidate = (content = "The user prefers concise explanations.") => ({ content,
  kind: "preference", confidence: 0.9, evidence_indices: [0] });
const extracted = (...memories) => ({ memories: memories.length ? memories : [candidate()] });
const explicit = (content) => ({ content, kind: "preference", receipt: {
  client: "test", eventId: "explicit", sessionId: "explicit", role: "user", excerpt: content } });
function fixture(t, steps, options = {}) {
  const path = join(mkdtempSync(join(tmpdir(), "cairn-engine-test-")), "memory.sqlite");
  const store = openMemoryStore({ path });
  const model = createMockModel(steps);
  const ns = { ownerId: "alice", projectId: "project-a" };
  const engine = createMemoryEngine({ store, ...ns, model, ...options });
  t.after(() => store.close());
  return { path, store, model, engine, memory: store.scope(ns), ns };
}

test("capture redacts before model, constructs receipts from input, and persists replay ledger", async (t) => {
  const { store, model, engine, memory, path, ns } = fixture(t, [extracted()]);
  const request = captured("api_token=secretvalue123 I prefer concise explanations.");
  assert.deepEqual(await engine.capture(request), { duplicate: false, memoryCount: 1, suppressedCount: 0 });
  assert.equal(model.calls.length, 1);
  assert.equal(model.calls[0].prompt.includes("secretvalue123"), false);
  assert.equal(model.calls[0].prompt.includes("alice"), false);
  const saved = memory.list()[0];
  assert.equal(saved.origin, "agent-inferred");
  assert.equal(saved.receipts[0].excerpt, "api_token=[REDACTED] I prefer concise explanations.");
  store.close();
  const reopened = openMemoryStore({ path });
  t.after(() => reopened.close());
  const replay = createMemoryEngine({ store: reopened, ...ns, model: createMockModel([]) });
  assert.equal((await replay.capture(request)).duplicate, true);
  const db = new DatabaseSync(path);
  t.after(() => db.close());
  const ledger = JSON.stringify(db.prepare("SELECT * FROM capture_events").all());
  assert.equal(ledger.includes("concise"), false);
  assert.equal(ledger.includes("secretvalue123"), false);
});

test("concurrent capture reports processing and calls the model only once", async (t) => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const { store, model, engine, ns } = fixture(t, [() => pending]);
  const first = engine.capture(captured());
  await Promise.resolve();
  const second = createMemoryEngine({ store, ...ns, model });
  assert.deepEqual(await second.capture(captured()), { processing: true });
  release(extracted());
  assert.equal((await first).memoryCount, 1);
  assert.equal(model.calls.length, 1);
  assert.equal((await second.capture(captured())).duplicate, true);
});

test("model failure retries same event but changed payload is rejected even after failure", async (t) => {
  const { engine, model, memory } = fixture(t, [new Error("synthetic_failure"), extracted()]);
  await assert.rejects(engine.capture(captured()), /synthetic_failure/);
  assert.deepEqual(memory.list(), []);
  await assert.rejects(engine.capture(captured("different text")), /event_payload_conflict/);
  assert.equal((await engine.capture(captured())).memoryCount, 1);
  assert.equal(model.calls.length, 2);
});

test("invalid model source references, shapes and content cause no writes", async (t) => {
  const invalid = [null, { memories: "bad" }, { memories: [], ownerId: "bob" },
    extracted({ ...candidate(), evidence_indices: [1] }),
    extracted({ ...candidate(), evidence_indices: [-1] }),
    extracted({ ...candidate(), evidence_indices: [0.5] }),
    extracted({ ...candidate(), evidence_indices: [] }),
    extracted({ ...candidate(), excerpt: "invented" }),
    extracted({ ...candidate(), confidence: NaN }),
    extracted(candidate("secret sk-" + "x".repeat(24))),
    extracted(candidate(), { ...candidate("second"), evidence_indices: [99] })];
  const { engine, memory } = fixture(t, invalid);
  for (let i = 0; i < invalid.length; i++) {
    await assert.rejects(engine.capture(captured("I prefer concise explanations.", `event-${i}`)));
    assert.deepEqual(memory.list(), []);
  }
});

test("input rejects unknown/tool fields and duplicate message ids before a model call", async (t) => {
  const { engine, model } = fixture(t, []);
  for (const value of [{ ...captured(), ownerId: "bob" },
    { ...captured(), messages: [{ id: "a", role: "tool", content: "secret" }] },
    { ...captured(), messages: [...captured().messages, ...captured().messages] },
    captured("x".repeat(20_001))]) await assert.rejects(engine.capture(value));
  assert.equal(model.calls.length, 0);
});

test("all inferred memories and receipts roll back on a later receipt failure", async (t) => {
  const { path, engine, memory } = fixture(t, [extracted(candidate("first preference"), candidate("second preference"))]);
  const db = new DatabaseSync(path);
  t.after(() => db.close());
  db.exec(`CREATE TRIGGER fail_second BEFORE INSERT ON receipts
    WHEN (SELECT count(*) FROM receipts) >= 1
    BEGIN SELECT RAISE(ABORT, 'synthetic_failure'); END;`);
  await assert.rejects(engine.capture(captured()), /synthetic_failure/);
  assert.deepEqual(memory.list(), []);
  assert.equal(db.prepare("SELECT completed FROM capture_events").get().completed, 0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM receipts").get().n, 0);
});

test("expired lease is reclaimed and stale completion/abandon cannot affect its successor", (t) => {
  const { path, memory } = fixture(t, []);
  const key = { client: "test", eventId: "event", digest: "a".repeat(64) };
  const first = memory.claimCapture({ ...key, leaseMs: 1000 });
  const db = new DatabaseSync(path);
  t.after(() => db.close());
  db.exec("UPDATE capture_events SET expires_at = 0");
  const second = memory.claimCapture({ ...key, leaseMs: 1000 });
  assert.notEqual(first.token, second.token);
  assert.throws(() => memory.finishCapture({ ...key, token: first.token }, []), /stale_capture/);
  assert.equal(memory.abandonCapture({ ...key, token: first.token }), false);
  assert.deepEqual(memory.finishCapture({ ...key, token: second.token }, []),
    { duplicate: false, memoryCount: 0, suppressedCount: 0 });
});

test("forgotten memory is neither recreated by replay nor by a new extraction event", async (t) => {
  const { engine, memory } = fixture(t, [extracted(), extracted()]);
  await engine.capture(captured());
  const saved = memory.list()[0];
  engine.forget(saved.id, saved.revision);
  assert.equal((await engine.capture(captured())).duplicate, true);
  assert.deepEqual(await engine.capture(captured("I prefer concise explanations.", "event-b")),
    { duplicate: false, memoryCount: 0, suppressedCount: 1 });
  assert.deepEqual(memory.list(), []);
});

test("recall supplies only eligible personal/project content and validates exact result IDs", async (t) => {
  const { store, engine, model } = fixture(t, [({ prompt }) => {
    const data = JSON.parse(prompt);
    assert.deepEqual(data.candidates.map((m) => m.content).sort(), ["personal preference", "project preference"]);
    assert.equal(prompt.includes("secretvalue123"), false);
    return { ids: data.candidates.map((m) => m.id) };
  }, { ids: ["made-up-id"] }]);
  store.scope({ ownerId: "alice" }).remember(explicit("personal preference"));
  engine.remember(explicit("project preference"));
  store.scope({ ownerId: "bob", projectId: "project-a" }).remember(explicit("other owner"));
  store.scope({ ownerId: "alice", projectId: "project-b" }).remember(explicit("other project"));
  assert.equal((await engine.recall("api_token=secretvalue123 preference")).length, 2);
  await assert.rejects(engine.recall("preference"), /invalid_model_output/);
  assert.equal(model.calls.length, 2);
});

test("recall drops a snapshot corrected or forgotten while the model was working", async (t) => {
  let release;
  const { engine, memory } = fixture(t, [({ prompt }) => new Promise((resolve) => {
    const ids = JSON.parse(prompt).candidates.map((m) => m.id);
    release = () => resolve({ ids });
  })]);
  const first = engine.remember(explicit("first"));
  const second = engine.remember(explicit("second"));
  const recall = engine.recall("preference");
  await Promise.resolve();
  memory.correct(first.id, explicit("corrected"), first.revision);
  memory.forget(second.id, second.revision);
  release();
  assert.deepEqual(await recall, []);
});

test("empty/unrelated queries return nothing and timeouts/cancellation release capture work", async (t) => {
  const { engine, model, memory } = fixture(t, [() => new Promise(() => {}), extracted(),
    { ids: [] }, () => new Promise(() => {})], { timeoutMs: 25 });
  assert.deepEqual(await engine.recall("   "), []);
  await assert.rejects(engine.capture(captured()), /model_timeout/);
  assert.equal(model.calls[0].signal.aborted, true);
  assert.equal((await engine.capture(captured())).memoryCount, 1);
  assert.deepEqual(await engine.recall("unrelated"), []);
  const controller = new AbortController();
  const running = engine.capture(captured("another preference", "event-b"), { signal: controller.signal });
  await Promise.resolve();
  controller.abort();
  await assert.rejects(running, /model_cancelled/);
  assert.equal(memory.list().length, 1);
});

test("v1 database migration preserves memory, receipts and suppression", (t) => {
  const { path, store, engine, ns } = fixture(t, []);
  const saved = engine.remember(explicit("active"));
  const removed = engine.remember(explicit("deleted"));
  engine.forget(removed.id, removed.revision);
  store.close();
  const db = new DatabaseSync(path);
  db.exec("DROP TABLE capture_events; PRAGMA user_version = 1;");
  db.close();
  const reopened = openMemoryStore({ path });
  t.after(() => reopened.close());
  assert.deepEqual(reopened.scope(ns).get(saved.id), saved);
  assert.throws(() => reopened.scope(ns).remember(explicit("deleted")), /memory_suppressed/);
});
