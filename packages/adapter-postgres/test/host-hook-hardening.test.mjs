import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { test } from "node:test";
import { clock } from "@cairn-ink/conformance/host-forget-raw";
import { syntheticHooks } from "@cairn-ink/conformance/host-write-hooks";
import { capabilities } from "../../core/src/index.mjs";
import { createMemoryService } from "../../core/src/service/index.mjs";
import { createPostgresHostWriteHookPort } from "../src/host-write-hooks.mjs";
import {
  createPostgresMemoryCandidates, createPostgresMemoryReads, createPostgresMemoryStore,
  createPostgresPauseStore, createPostgresSuppressionStore, createPostgresUnitOfWork,
} from "../src/index.mjs";
import { migrationDatabase, migrationDbTest } from "./migration-database.mjs";

test("the Postgres port exposes a guarded context", () => {
  const delegate = new AsyncLocalStorage();
  const { context } = createPostgresHostWriteHookPort({ context: delegate });
  assert.notEqual(context, delegate);
  assert.ok(Object.isFrozen(context));
  assert.equal(createPostgresHostWriteHookPort({ context: delegate }).context, context);
  const record = {};
  delegate.run(record, () => {
    assert.equal(context.getStore(), record);
    assert.throws(() => context.run(undefined, () => assert.fail("The callback ran")),
      { code: "host_write_hook_failed" });
  });
});

test("the Postgres port accepts exactly one authority reader", () => {
  const context = new AsyncLocalStorage();
  const port = createPostgresHostWriteHookPort({ context });
  const reader = () => undefined;
  port.bindHookAuthority(reader);
  assert.throws(() => port.bindHookAuthority(reader), { code: "invalid_input" });
  assert.throws(() => port.bindHookAuthority(() => undefined), { code: "invalid_input" });
  createPostgresHostWriteHookPort({ context }).bindHookAuthority(reader);
});

test("escaping the Postgres hook context rolls back the forget and its host write", migrationDbTest, async t => {
  const { pool, source: connection } = await migrationDatabase(t);
  const scope = { owner: "hook-owner", namespace: null };
  const source = { kind: "mcp", client: null, sessionId: null };
  await pool.query("INSERT INTO users (id) VALUES ($1)", [scope.owner]);
  await pool.query("CREATE TABLE test_hook_effects (owner text, namespace text, effect text)");
  const port = createPostgresHostWriteHookPort({ context: new AsyncLocalStorage(), operations: {
    put: { mode: "write", sql: "INSERT INTO test_hook_effects (owner, namespace, effect) VALUES ($1, $2, $3)" },
  } });
  const options = { nearDuplicate: false };
  let calls = 0;
  let escaped = false;
  const service = createMemoryService({
    storage: {
      name: "postgres", hostWriteHookPort: port,
      capabilities: capabilities({ hostWriteHooks: true, embeddingRequiredOnInsert: true }),
      uow: createPostgresUnitOfWork(connection),
      memories: createPostgresMemoryStore(options),
      pause: createPostgresPauseStore(), suppressions: createPostgresSuppressionStore(options),
      ...createPostgresMemoryReads(options), ...createPostgresMemoryCandidates(options),
    },
    config: {}, clock, gate: { assertOpen() {} }, tokens: { countTokens: () => 1 },
    embedder: { model: "fixture", dimensions: 1536, async embed(texts) {
      return texts.map(() => Float32Array.of(1, ...Array(1535).fill(0)));
    } },
    hostWriteHooks: syntheticHooks({ async onForget(tx, ctx) {
      calls++;
      await port.execute(tx, ctx.scope, "put", ["before escape"]);
      await port.context.run(undefined, () => {
        escaped = true;
        return port.execute(tx, ctx.scope, "put", ["inside escape"]);
      });
    } }),
  });
  const saved = await service.save(scope, "The trail ends at a stone bench.", source);
  assert.equal(saved.status, "saved");
  const snapshot = async () => (await pool.query(`SELECT
    (SELECT to_jsonb(m) FROM memories m WHERE user_id = $1 AND id = $2) AS memory,
    (SELECT to_jsonb(s) FROM core_owner_state s WHERE user_id = $1) AS state,
    (SELECT count(*)::int FROM core_suppression_facts WHERE user_id = $1) AS facts,
    (SELECT count(*)::int FROM test_hook_effects WHERE owner = $1) AS effects`, [scope.owner, saved.item.id])).rows[0];
  const before = await snapshot();
  await assert.rejects(service.forget(scope, saved.item.id, source), { code: "host_write_hook_failed" });
  assert.equal(calls, 1);
  assert.equal(escaped, false);
  assert.deepEqual(await snapshot(), before);
});
