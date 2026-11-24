import assert from "node:assert/strict";
import test from "node:test";
import { CoreError } from "../../core/src/index.mjs";
import { applyMigrations, readSourceKind, requireEmbedding, storedSourceKind } from "../src/index.mjs";

const first = { id: "first", sql: "CREATE TABLE first (id int)", concurrent: false };
const recent = {
  id: "recent",
  sql: "CREATE INDEX CONCURRENTLY IF NOT EXISTS recent_idx ON public.first (id)",
  concurrent: true,
  index: {
    name: "recent_idx",
    table: "public.first",
    definition: "CREATE INDEX recent_idx ON public.first USING btree (id)",
  },
};
const last = { id: "last", sql: "CREATE TABLE last (id int)", concurrent: false };
const setup = [
  "SET lock_timeout = '5s'",
  "SET statement_timeout = '30s'",
  "SET search_path = public, pg_catalog",
  "SET quote_all_identifiers = off",
  "try migration lock",
  "create ledger",
  "read ledger",
];

function stub({
  applied = [],
  locked = true,
  fail,
  index = { valid: true, schema: "public", name: recent.index.name, definition: recent.index.definition, builtin_collations: true },
} = {}) {
  const statements = [];
  const source = {
    async connect() {
      return {
        async query(sql, values) {
          let rows = [];
          let label = sql;
          if (sql.startsWith("SELECT pg_try_advisory_lock")) {
            label = "try migration lock";
            rows = [{ locked }];
          } else if (sql.startsWith("SELECT pg_advisory_unlock")) {
            label = "unlock migration lock";
            rows = [{ unlocked: true }];
          } else if (sql.startsWith("CREATE TABLE IF NOT EXISTS core_schema_migrations")) {
            label = "create ledger";
          } else if (sql === "SELECT id FROM core_schema_migrations") {
            label = "read ledger";
            rows = applied.map((id) => ({ id }));
          } else if (sql.startsWith("SELECT i.indisvalid")) {
            label = "inspect index";
            if (index) rows = [index];
          } else if (sql.startsWith("INSERT INTO core_schema_migrations")) {
            label = "record migration";
          }
          statements.push(values ? [label, values] : label);
          if (sql === fail) throw Object.assign(new Error("native details"), { code: "55P03" });
          return { command: sql, rows };
        },
        release(destroy) {
          statements.push(["release", destroy]);
        },
      };
    },
  };
  return { source, statements };
}

function isCode(code) {
  return (error) => error instanceof CoreError && error.code === code
    && error.message === code && error.cause === undefined;
}

test("runner applies the manifest in order with a standalone concurrent statement", async () => {
  const { source, statements } = stub();
  await applyMigrations(source, [first, recent, last]);
  assert.deepEqual(statements, [
    ...setup,
    "BEGIN", first.sql, ["record migration", ["first"]], "COMMIT",
    recent.sql, ["inspect index", ["recent_idx", "public.first"]], ["record migration", ["recent"]],
    "BEGIN", last.sql, ["record migration", ["last"]], "COMMIT",
    "unlock migration lock", ["release", true],
  ]);
});

test("runner skips applied migrations and applies only the new suffix", async () => {
  const { source, statements } = stub({ applied: ["first"] });
  await applyMigrations(source, [first, last]);
  assert.deepEqual(statements, [
    ...setup, "BEGIN", last.sql, ["record migration", ["last"]], "COMMIT", "unlock migration lock", ["release", true],
  ]);

  const replay = stub({ applied: ["last", "first"] });
  await applyMigrations(replay.source, [first, last]);
  assert.deepEqual(replay.statements, [...setup, "unlock migration lock", ["release", true]]);
});

test("runner refuses downgrade, unknown applied IDs, and a gap in the applied prefix", async () => {
  for (const [applied, migrations] of [
    [["first", "last"], [first]],
    [["unknown"], [first, last]],
    [["last"], [first, last]],
  ]) {
    const { source, statements } = stub({ applied });
    await assert.rejects(applyMigrations(source, migrations), isCode("invalid_input"));
    assert.deepEqual(statements, [...setup, ["release", true]]);
  }
});

test("runner rejects duplicate IDs or invalid concurrent entries before connecting", async () => {
  const source = { connect: () => assert.fail("connected with an invalid manifest") };
  await assert.rejects(applyMigrations(source, [first, first]), isCode("invalid_input"));
  await assert.rejects(applyMigrations(source, [{ ...first, concurrent: true }]), isCode("invalid_input"));
  await assert.rejects(applyMigrations(source, [{ ...recent, index: undefined }]), isCode("invalid_input"));
  await assert.rejects(
    applyMigrations(source, [{ ...recent, index: { ...recent.index, table: "other.first" } }]),
    isCode("invalid_input"),
  );
});

test("runner refuses a second migrator while the session lock is held", async () => {
  const { source, statements } = stub({ locked: false });
  await assert.rejects(applyMigrations(source, [first]), isCode("storage_busy"));
  assert.deepEqual(statements, [...setup.slice(0, 5), ["release", true]]);
});

test("runner rolls back a failed transactional migration and maps the native code", async () => {
  const { source, statements } = stub({ fail: first.sql });
  await assert.rejects(applyMigrations(source, [first, last]), isCode("lock_timeout"));
  assert.deepEqual(statements, [...setup, "BEGIN", first.sql, "ROLLBACK", ["release", true]]);
});

test("runner preserves a native error when a concurrent build leaves no index", async () => {
  const { source, statements } = stub({ fail: recent.sql, index: null });
  await assert.rejects(applyMigrations(source, [recent]), isCode("lock_timeout"));
  assert.deepEqual(statements, [
    ...setup, recent.sql, ["inspect index", ["recent_idx", "public.first"]], ["release", true],
  ]);
});

test("runner reports an uncertain commit and stops before starting the next migration", async () => {
  const { source, statements } = stub({ fail: "COMMIT" });
  await assert.rejects(applyMigrations(source, [first, last]), isCode("commit_outcome_unknown"));
  assert.deepEqual(statements, [
    ...setup, "BEGIN", first.sql, ["record migration", ["first"]], "COMMIT", ["release", true],
  ]);
});

test("insert and replacement embedding guard rejects null and returns a supplied embedding", () => {
  const row = {
    kind: "fact",
    origin: "explicit",
    text: "example",
    textHash: "sha256:example",
    confidence: 1,
    source: { kind: "web", client: null, sessionId: null },
    embedding: null,
  };
  assert.throws(() => requireEmbedding(row), isCode("invalid_input"));
  const embedding = { model: "test", vector: new Float32Array([1]) };
  assert.equal(requireEmbedding({ ...row, embedding }), embedding);
});

test("capture uses the hosted plugin source kind and stored kinds retain their read labels", () => {
  assert.equal(storedSourceKind("capture"), "plugin");
  for (const kind of ["plugin", "mcp", "web", "import"]) {
    assert.equal(storedSourceKind(kind), kind);
    assert.equal(readSourceKind(kind), kind);
  }
  assert.equal(readSourceKind(storedSourceKind("capture")), "plugin");
});
