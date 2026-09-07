import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { openMemoryStore } from "../index.mjs";

const moduleUrl = new URL("../index.mjs", import.meta.url).href;
const source = (excerpt, eventId = "event-a") => ({
  client: "test", sessionId: "session-a", eventId, role: "user", excerpt,
});
const input = (content = "I prefer green tea", event = "event-a") => ({
  content, kind: "preference", receipt: source(content, event),
});
const error = (code) => (value) => value.code === code;

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "cairn-store-test-"));
  const path = join(dir, "memory.sqlite");
  const store = openMemoryStore({ path });
  t.after(() => store.close());
  return { path, store, memory: store.scope({ ownerId: "alice" }) };
}

function child(code, args = []) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ["--input-type=module", "-e", code, ...args], {
      // No maintainer environment or credentials are needed by a local store.
      env: {}, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => { stdout += chunk; });
    proc.stderr.on("data", (chunk) => { stderr += chunk; });
    proc.on("error", reject);
    proc.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr)));
  });
}

test("real-file memory and receipts survive a separate-process restart", async (t) => {
  const { path, store, memory } = fixture(t);
  const first = memory.remember(input());
  assert.equal(first.revision, 1);
  assert.equal(first.receipts[0].excerpt, "I prefer green tea");
  assert.equal(first.origin, "explicit");
  assert.equal(first.confidence, 1);
  store.close();
  const result = await child(`
    import { openMemoryStore } from ${JSON.stringify(moduleUrl)};
    const store = openMemoryStore({path: process.argv[1]});
    console.log(JSON.stringify(store.scope({ownerId: 'alice'}).get(process.argv[2])));
    store.close();
  `, [path, first.id]);
  assert.deepEqual(JSON.parse(result), first);
  if (process.platform !== "win32") assert.equal(statSync(path).mode & 0o777, 0o600);
});

test("guessed IDs and identical text stay isolated by owner and exact project", (t) => {
  const { store, memory } = fixture(t);
  const first = memory.remember(input());
  const others = [
    store.scope({ ownerId: "bob" }),
    store.scope({ ownerId: "alice", projectId: "project-a" }),
    store.scope({ ownerId: "alice", projectId: "project-b" }),
  ];
  for (const other of others) {
    assert.equal(other.get(first.id), null);
    assert.deepEqual(other.search("tea"), []);
    assert.equal(other.forget(first.id, 1), false);
    assert.throws(() => other.correct(first.id, input("coffee"), 1), error("memory_not_found"));
    assert.notEqual(other.remember(input()).id, first.id);
  }
  assert.equal(memory.list().length, 1);
  assert.equal(memory.get(first.id).content, first.content);
});

test("namespace validation rejects omitted, ambiguous, and unknown boundaries", (t) => {
  const { store } = fixture(t);
  for (const ns of [{}, { ownerId: "" }, { ownerId: " alice " },
    { ownerId: "alice", projectId: null }, { ownerId: "alice", projectId: "" },
    { ownerId: "alice", teamId: "team" }, { ownerId: "alice\0bob" }]) {
    assert.throws(() => store.scope(ns));
  }
});

test("normalized duplicate content merges receipts without downgrading explicit truth", (t) => {
  const { memory } = fixture(t);
  const first = memory.remember(input());
  assert.deepEqual(memory.remember(input()), first);
  const duplicate = memory.remember({ ...input("  I PREFER  GREEN TEA  ", "event-b"),
    origin: "agent-inferred", confidence: 0.2, kind: "context" });
  assert.equal(duplicate.id, first.id);
  assert.equal(duplicate.content, first.content);
  assert.equal(duplicate.origin, "explicit");
  assert.equal(duplicate.confidence, 1);
  assert.equal(duplicate.kind, "preference");
  assert.equal(duplicate.receipts.length, 2);
  assert.equal(duplicate.revision, 2);
  assert.equal(memory.list().length, 1);
});

test("explicit confirmation upgrades inferred memory", (t) => {
  const { memory } = fixture(t);
  const inferred = memory.remember({ ...input(), origin: "agent-inferred", confidence: 0.4 });
  const confirmed = memory.remember(input());
  assert.equal(confirmed.id, inferred.id);
  assert.equal(confirmed.origin, "explicit");
  assert.equal(confirmed.confidence, 1);
  assert.equal(confirmed.revision, 2);
});

test("correction suppresses superseded content and replaces active receipts", async (t) => {
  const { path, store, memory } = fixture(t);
  const old = memory.remember(input());
  const corrected = memory.correct(old.id, input("I prefer coffee", "correction"), old.revision);
  assert.equal(corrected.id, old.id);
  assert.equal(corrected.revision, 2);
  assert.deepEqual(memory.search("tea"), []);
  assert.equal(memory.search("coffee")[0].id, old.id);
  assert.deepEqual(corrected.receipts.map((r) => r.excerpt), ["I prefer coffee"]);
  assert.throws(() => memory.remember(input()), error("memory_suppressed"));
  assert.throws(() => memory.correct(old.id, input("water"), 1), error("revision_conflict"));
  assert.throws(() => memory.forget(old.id, 1), error("revision_conflict"));
  store.close();
  const result = await child(`
    import { openMemoryStore } from ${JSON.stringify(moduleUrl)};
    const store = openMemoryStore({path: process.argv[1]});
    const scope = store.scope({ownerId: 'alice'});
    try { scope.remember(${JSON.stringify(input())}); }
    catch (error) { console.log(error.code); }
    console.log(scope.search('coffee').length);
    store.close();
  `, [path]);
  assert.equal(result, "memory_suppressed\n1\n");
});

test("forget clears active content and receipts and cannot be replayed after restart", (t) => {
  const { path, store, memory } = fixture(t);
  const first = memory.remember(input());
  assert.equal(memory.forget(first.id, 1), true);
  assert.equal(memory.forget(first.id, 1), false);
  assert.equal(memory.get(first.id), null);
  assert.deepEqual(memory.list(), []);
  assert.deepEqual(memory.search("tea"), []);
  store.close();
  const reopened = openMemoryStore({ path });
  t.after(() => reopened.close());
  assert.throws(() => reopened.scope({ ownerId: "alice" }).remember(input()), error("memory_suppressed"));
  // A tombstone must not suppress another namespace.
  assert.ok(reopened.scope({ ownerId: "bob" }).remember(input()));
  const db = new DatabaseSync(path);
  t.after(() => db.close());
  assert.equal(db.prepare("SELECT content FROM memories WHERE id = ?").get(first.id).content, null);
  assert.equal(db.prepare("SELECT count(*) AS n FROM receipts WHERE memory_id = ?").get(first.id).n, 0);
});

test("correction conflicts roll back and do not suppress the existing memory", (t) => {
  const { memory } = fixture(t);
  const tea = memory.remember(input());
  memory.remember(input("coffee"));
  assert.throws(() => memory.correct(tea.id, input("coffee"), 1), error("memory_conflict"));
  assert.deepEqual(memory.get(tea.id), tea);
  assert.equal(memory.remember(input()).id, tea.id);
});

test("receipt write failure rolls back insertion and correction including suppression", (t) => {
  const { path, memory } = fixture(t);
  const tea = memory.remember(input());
  const db = new DatabaseSync(path);
  t.after(() => db.close());
  db.exec(`CREATE TRIGGER fail_receipt BEFORE INSERT ON receipts
    BEGIN SELECT RAISE(ABORT, 'synthetic_receipt_failure'); END;`);
  assert.throws(() => memory.remember(input("coffee")), /synthetic_receipt_failure/);
  assert.throws(() => memory.correct(tea.id, input("water"), 1), /synthetic_receipt_failure/);
  assert.deepEqual(memory.list(), [tea]);
  assert.equal(db.prepare("SELECT count(*) AS n FROM suppressed").get().n, 0);
  db.exec("DROP TRIGGER fail_receipt");
  assert.equal(memory.remember(input()).id, tea.id);
});

test("redacts before persistence and bounds receipt Unicode without partial code points", (t) => {
  const { path, memory } = fixture(t);
  const secret = "sk-" + "a".repeat(24);
  const value = memory.remember({ ...input(`Token is ${secret}`), receipt:
    source("😀".repeat(390) + ` api_token=${secret}`) });
  assert.equal(value.content, "Token is [REDACTED]");
  assert.ok(value.receipts[0].excerpt.length <= 800);
  assert.equal(value.receipts[0].excerpt.includes(secret), false);
  assert.equal(value.receipts[0].excerpt.isWellFormed(), true);
  const db = new DatabaseSync(path);
  t.after(() => db.close());
  const rows = JSON.stringify(db.prepare("SELECT * FROM memories").all()) +
    JSON.stringify(db.prepare("SELECT * FROM receipts").all());
  assert.equal(rows.includes(secret), false);
});

test("invalid inputs leave no memory or receipt behind", (t) => {
  const { memory } = fixture(t);
  for (const value of [null, {}, { ...input(), content: "" },
    { ...input(), content: "x".repeat(4_001) }, { ...input(), content: "\0" },
    { ...input(), content: "sk-" + "x".repeat(24) },
    { ...input(), origin: "unknown" }, { ...input(), kind: "unknown" },
    { ...input(), confidence: NaN }, { ...input(), confidence: 0.5 },
    { ...input(), origin: "agent-inferred", confidence: -1 },
    { ...input(), receipt: undefined }, { ...input(), receipt: { ...source("x"), role: "tool" } },
    { ...input(), receipt: { ...source("x"), path: "/secret" } },
    { ...input(), unexpected: true }]) {
    assert.throws(() => memory.remember(value));
    assert.deepEqual(memory.list(), []);
  }
});

test("lexical search rejects unrelated, empty, and SQL-like input without namespace leakage", (t) => {
  const { memory, store } = fixture(t);
  memory.remember(input());
  memory.remember(input("Use SQLite for storage"));
  store.scope({ ownerId: "bob" }).remember(input("unrelated secret"));
  assert.equal(memory.search("GREEN")[0].content, "I prefer green tea");
  for (const query of ["", "   ", "%%%", "unrelated"]) {
    assert.deepEqual(memory.search(query), []);
  }
  // "or" matches the literal substring in "storage", but does not execute SQL
  // or bypass the owner predicate to retrieve everything.
  assert.deepEqual(memory.search("' OR 1=1 --").map((m) => m.content), ["Use SQLite for storage"]);
  assert.equal(memory.list({ limit: 1 }).length, 1);
  assert.throws(() => memory.search("tea", { limit: 0 }), error("invalid_limit"));
  assert.throws(() => memory.search("x".repeat(4_001)), error("invalid_query"));
});

test("normalization cannot turn unredacted compatibility characters into a stored credential", (t) => {
  const { memory } = fixture(t);
  const ascii = "sk-" + "a".repeat(24);
  const fullwidth = [...ascii].map((c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0)).join("");
  const stored = memory.remember(input(`Token is ${fullwidth}`));
  assert.equal(stored.content, "Token is [REDACTED]");
  assert.equal(stored.receipts[0].excerpt, "Token is [REDACTED]");
});

test("two processes correcting one revision cannot silently overwrite each other", async (t) => {
  const { path, memory } = fixture(t);
  const first = memory.remember(input());
  const results = await Promise.all(["coffee", "water"].map((content) => child(`
    import { openMemoryStore } from ${JSON.stringify(moduleUrl)};
    const store = openMemoryStore({path: process.argv[1]});
    try {
      store.scope({ownerId: 'alice'}).correct(process.argv[2], ${JSON.stringify(input(content))}, 1);
      console.log('corrected');
    } catch (error) { console.log(error.code); }
    store.close();
  `, [path, first.id])));
  assert.deepEqual(results.sort(), ["corrected\n", "revision_conflict\n"]);
  assert.equal(memory.get(first.id).revision, 2);
});

test("concurrent processes initialize once and deduplicate while merging every source", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "cairn-concurrent-store-")), "memory.sqlite");
  const results = await Promise.all(Array.from({ length: 8 }, (_, index) => child(`
    import { openMemoryStore } from ${JSON.stringify(moduleUrl)};
    const store = openMemoryStore({path: process.argv[1]});
    console.log(store.scope({ownerId: 'alice'}).remember(${JSON.stringify(input("tea", `event-${index}`))}).id);
    store.close();
  `, [path])));
  assert.equal(new Set(results).size, 1);
  const store = openMemoryStore({ path });
  try {
    const rows = store.scope({ ownerId: "alice" }).list();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].receipts.length, 8);
  } finally { store.close(); }
});

test("refuses foreign databases and future schemas without overwriting them", () => {
  const dir = mkdtempSync(join(tmpdir(), "cairn-schema-test-"));
  const foreign = join(dir, "foreign.sqlite");
  const db = new DatabaseSync(foreign);
  db.exec("CREATE TABLE precious (value TEXT); INSERT INTO precious VALUES ('keep');");
  chmodSync(foreign, 0o600);
  assert.throws(() => openMemoryStore({ path: foreign }), error("unsupported_database"));
  assert.equal(db.prepare("SELECT value FROM precious").get().value, "keep");
  db.close();
  const path = join(dir, "future.sqlite");
  openMemoryStore({ path }).close();
  const future = new DatabaseSync(path);
  future.exec("PRAGMA user_version = 99");
  assert.throws(() => openMemoryStore({ path }), error("unsupported_database"));
  assert.equal(future.prepare("PRAGMA user_version").get().user_version, 99);
  future.close();
});

test("requires explicit storage, rejects unsafe files, and closes idempotently", (t) => {
  assert.throws(() => openMemoryStore({}), error("invalid_path"));
  const { path, store, memory } = fixture(t);
  store.close();
  store.close();
  assert.throws(() => memory.list(), error("store_closed"));
  assert.throws(() => store.scope({ ownerId: "alice" }), error("store_closed"));
  if (process.platform !== "win32") {
    chmodSync(path, 0o644);
    assert.throws(() => openMemoryStore({ path }), error("unsafe_database_file"));
  }
  const bad = join(mkdtempSync(join(tmpdir(), "cairn-invalid-db-")), "invalid.sqlite");
  writeFileSync(bad, "not a database", { mode: 0o600 });
  assert.throws(() => openMemoryStore({ path: bad }));
});
