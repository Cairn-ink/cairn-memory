import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { capabilities } from "../../core/src/index.mjs";
import { createMemoryService } from "../../core/src/service/index.mjs";
import {
  createPostgresMemoryReads, createPostgresMemoryStore, createPostgresPauseStore,
  createPostgresSuppressionStore, createPostgresUnitOfWork,
} from "../src/index.mjs";
import { migrationDatabase, migrationDbTest } from "./migration-database.mjs";

const scope = { owner: "owner", namespace: null };
const memorySource = { kind: "mcp", client: null, sessionId: null };
const sha256Hex = value => createHash("sha256").update(value).digest("hex");

async function setup(t) {
  const { pool, source } = await migrationDatabase(t);
  await pool.query("INSERT INTO users (id) VALUES ($1)", [scope.owner]);
  const uow = createPostgresUnitOfWork(source);
  const memories = createPostgresMemoryStore();
  const write = body => uow.run(scope.owner, {}, body);
  const readRevision = () => uow.run(scope.owner, { readOnly: true }, tx => memories.indexRevision(tx));
  const insert = (tx, text) => memories.insert(tx, scope, {
    text, textHash: "sha256:" + sha256Hex(text), kind: "fact", origin: "explicit", confidence: 1,
    source: memorySource, embedding: { model: "fixture", vector: [1, ...Array(1535).fill(0)] },
  }, [], 1);
  return { uow, memories, write, readRevision, insert };
}

test("the Postgres index revision is stable within a run and advances once on commit", migrationDbTest, async t => {
  const { memories, write, readRevision, insert } = await setup(t);
  const start = await write(async tx => {
    const revision = await memories.indexRevision(tx);
    assert.equal(revision, 0);
    for (const text of ["A stored memory", "Another stored memory"]) {
      await insert(tx, text);
      assert.equal(await memories.indexRevision(tx), revision);
    }
    return revision;
  });

  assert.equal(await readRevision(), start + 1);
  assert.equal(await readRevision(), start + 1);
});

test("forget reports the committed Postgres index revision", migrationDbTest, async t => {
  const { uow, memories, write, readRevision, insert } = await setup(t);
  const storage = {
    name: "postgres", uow, memories, ...createPostgresMemoryReads(),
    pause: createPostgresPauseStore(), suppressions: createPostgresSuppressionStore(),
    capabilities: capabilities({ embeddingRequiredOnInsert: true }),
  };
  const unused = () => assert.fail("unexpected dependency call");
  const service = createMemoryService({
    storage, config: {},
    model: { model: "fixture", contextWindow: 2048, call: unused, countTokens: unused },
    embedder: { model: "fixture", dimensions: 1536, embed: unused },
    gate: { assertOpen: unused }, tokens: { countTokens: unused },
    clock: { nowMs: unused, monotonicMs: unused, sha256Hex, hmacHex: unused },
  });
  const { id, revision } = await write(tx => insert(tx, "A memory to forget"));
  const start = await readRevision();

  const forgotten = await service.forget(scope, id, memorySource, { expectedRevision: revision });
  assert.deepEqual(forgotten, { status: "forgotten", removedSimilar: 0, indexRevision: start + 1 });
  assert.equal(await readRevision(), forgotten.indexRevision);
});
