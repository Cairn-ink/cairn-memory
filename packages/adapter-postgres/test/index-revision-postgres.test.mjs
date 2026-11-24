import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { capabilities } from "../../core/src/index.mjs";
import { createMemoryService } from "../../core/src/service/index.mjs";
import {
  createPostgresMemoryReads, createPostgresMemoryStore, createPostgresPauseStore, createPostgresRawPorts,
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
  const insert = (tx, text, source = memorySource) => memories.insert(tx, scope, {
    text, textHash: "sha256:" + sha256Hex(text), kind: "fact", origin: "explicit", confidence: 1,
    source, embedding: { model: "fixture", vector: [1, ...Array(1535).fill(0)] },
  }, [], 1);
  return { pool, uow, memories, write, readRevision, insert };
}

test("the Postgres index revision is stable within a run and advances once on commit", migrationDbTest, async t => {
  const { memories, write, readRevision, insert } = await setup(t);
  const committed = await write(async tx => {
    const start = await memories.indexRevision(tx);
    assert.equal(start, 0);
    assert.equal(await memories.committedIndexRevision(tx), start);
    for (const text of ["A stored memory", "Another stored memory"]) {
      await insert(tx, text);
      assert.equal(await memories.indexRevision(tx), start);
    }
    return memories.committedIndexRevision(tx);
  });

  assert.equal(committed, await readRevision());
  assert.equal(committed, 1);
  assert.equal(await readRevision(), committed);
});

for (const rawArchive of [false, true]) {
  test(`forget reports the committed Postgres index revision (${rawArchive ? "Raw fence" : "plain"})`, migrationDbTest, async t => {
    const { pool, uow, memories, write, readRevision, insert } = await setup(t);
    const storage = {
      name: "postgres", uow, memories, ...createPostgresMemoryReads(),
      pause: createPostgresPauseStore(), suppressions: createPostgresSuppressionStore(),
      capabilities: capabilities({ embeddingRequiredOnInsert: true, rawArchive }),
      ...(rawArchive && { raw: createPostgresRawPorts({ lineageSecret: "fixture" }).raw }),
    };
    const unused = () => assert.fail("unexpected dependency call");
    const service = createMemoryService({
      storage, config: {},
      model: { model: "fixture", contextWindow: 2048, call: unused, countTokens: unused },
      embedder: { model: "fixture", dimensions: 1536, embed: unused },
      gate: { assertOpen: unused }, tokens: { countTokens: unused },
      clock: { nowMs: unused, monotonicMs: unused, sha256Hex, hmacHex: unused },
    });
    const source = rawArchive ? { ...memorySource, client: "fixture", sessionId: "session" } : memorySource;
    const { id, revision } = await write(tx => insert(tx, "A memory to forget", source));
    const start = await readRevision();

    const forgotten = await service.forget(scope, id, memorySource, { expectedRevision: revision });
    assert.deepEqual(forgotten, { status: "forgotten", removedSimilar: 0, indexRevision: await readRevision() });
    assert.equal(forgotten.indexRevision, start + 1);
    if (rawArchive) {
      const { rows } = await pool.query("SELECT client, session_id FROM capture_raw_fences WHERE user_id = $1",
        [scope.owner]);
      assert.deepEqual(rows, [{ client: source.client, session_id: source.sessionId }]);
    }

    const repeated = await service.forget(scope, id, memorySource, { expectedRevision: revision });
    assert.deepEqual(repeated, { status: "not_found", indexRevision: await readRevision() });
    assert.equal(repeated.indexRevision, forgotten.indexRevision);
  });
}
