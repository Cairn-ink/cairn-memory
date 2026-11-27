import { randomBytes, randomUUID } from "node:crypto";
import { capabilities } from "../../core/src/index.mjs";
import { createMemoryService } from "../../core/src/service/index.mjs";
import { testAdapterFindPaging } from "../../core/test/helpers/adapter-find-layer-cursors.mjs";
import {
  createPostgresCapturePorts, createPostgresMemoryCandidates, createPostgresMemoryReads, createPostgresMemoryStore,
  createPostgresPauseStore, createPostgresRawPorts, createPostgresRawReads, createPostgresSuppressionStore, createPostgresUnitOfWork,
} from "../src/index.mjs";
import { migrationDatabase, migrationDbTest } from "./migration-database.mjs";

testAdapterFindPaging(async t => {
  const { source, pool } = await migrationDatabase(t);
  const owners = [randomUUID(), randomUUID()];
  await pool.query("INSERT INTO users (id) VALUES ($1), ($2)", owners);
  await pool.query("INSERT INTO core_owner_state (user_id, legacy_facts_ready) VALUES ($1, true), ($2, true)", owners);
  const rawOptions = { lineageSecret: randomUUID() };
  const options = { ...rawOptions, allowNonNullNamespace: true };
  const { raw } = createPostgresRawPorts(rawOptions);
  const { lexical } = createPostgresMemoryCandidates(options);
  const identity = { storeId: randomUUID(), cursorKey: randomBytes(32) };
  return {
    storage: {
      name: "postgres",
      capabilities: { ...capabilities({ rawArchive: true, rawWindowHide: true, embeddingRequiredOnInsert: true }), inspect: true },
      inspect: {
        async identity() { return identity; },
        async list() { throw new Error("unexpected inspect list"); },
        async item() { throw new Error("unexpected inspect item"); },
      },
      uow: createPostgresUnitOfWork(source),
      capture: createPostgresCapturePorts(rawOptions),
      memories: createPostgresMemoryStore(options),
      suppressions: createPostgresSuppressionStore(),
      pause: createPostgresPauseStore(),
      keys: { async userKey() { return null; } },
      lexical,
      raw: { ...raw, ...createPostgresRawReads(rawOptions) },
      ...createPostgresMemoryReads(options),
    },
    scope: { owner: owners[0], namespace: null },
    otherOwner: { owner: owners[1], namespace: null },
    rawNamespaces: false,
    embedding: { model: "fixture-model", vector: [1, ...Array(1535).fill(0)] },
  };
}, createMemoryService, migrationDbTest);
