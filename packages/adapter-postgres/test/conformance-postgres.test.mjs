import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { Socket } from "node:net";
import test from "node:test";
import { Pool } from "pg";
import * as kit from "@cairn-ink/conformance";
import { capabilities, coreDigest, factIncarnationBody, userFingerprintKey } from "@cairn-ink/core";
import { publishFingerprintKey, readFingerprintKeyId } from "../src/digest-gate.mjs";
import { toPostgresError } from "../src/errors.mjs";
import {
  applyMigrations, createPostgresCapturePorts, createPostgresConflictEdgeStore, createPostgresDigestGate,
  createPostgresFingerprintKeyProvider, createPostgresMemoryCandidates, createPostgresMemoryReads, createPostgresMemoryStore,
  createPostgresPauseStore, createPostgresRawPorts, createPostgresRawReads, createPostgresSupersessionStore, createPostgresSuppressionStore,
  createPostgresTopicStore, createPostgresUnitOfWork, HOSTED_FINGERPRINT_LABELS, query,
} from "../src/index.mjs";
import { advanceIndex, timestampUs } from "../src/memory-rows.mjs";
import { requireLiveRun } from "../src/uow.mjs";
import { withDistinctNamespaceText, withRelationCaptureFinish } from "./relation-fixtures.mjs";

/** @import { AdapterFactory, ConformanceCase, TestHarness } from "@cairn-ink/conformance" */
/** @import { RetainedDigestFixture } from "@cairn-ink/conformance/factory" */

const databaseUrl = process.env.CORE_PG_TEST_URL;
const options = { timeout: 120_000, skip: databaseUrl ? false : "CORE_PG_TEST_URL is not set" };
const busyNativeCodes = ["55P03", "40001", "40P01"];
const nativeCodes = [...busyNativeCodes, "57014", "08000", "57P01", "57P02", "57P03"];
const nativeErrorMap = Object.fromEntries(nativeCodes.map((code) => [code, toPostgresError({ code }).code]));

// Cast bigint counters and the vector projection to text before JSON decoding.
// One statement reads the tables from the same committed snapshot.
const dumpSql = `SELECT jsonb_build_object(
  'facts', ARRAY(
    SELECT to_jsonb(f) || jsonb_build_object('epoch', f.epoch::text, 'embedding', f.embedding::text)
    FROM core_suppression_facts f ORDER BY f.user_id, f.epoch
  ),
  'factDigests', ARRAY(
    SELECT to_jsonb(d) FROM core_fact_digests d ORDER BY d.user_id, d.fact_id, d.alg, d.value
  ),
  'memories', ARRAY(
    SELECT to_jsonb(m) || jsonb_build_object('embedding', m.embedding::text) FROM memories m ORDER BY m.user_id, m.id
  ),
  'receipts', ARRAY(
    SELECT to_jsonb(r) FROM core_memory_receipts r ORDER BY r.user_id, r.memory_id, r.client, r.session_id, r.message_id
  ),
  'pause', ARRAY(SELECT to_jsonb(p) FROM memory_pause p ORDER BY p.user_id),
  'supersessions', ARRAY(SELECT to_jsonb(s) FROM memory_supersessions s ORDER BY s.user_id, s.previous_memory_id),
  'ownerState', ARRAY(
    SELECT to_jsonb(s) || jsonb_build_object('fact_epoch', s.fact_epoch::text, 'index_revision', s.index_revision::text)
    FROM core_owner_state s ORDER BY s.user_id
  ),
  'rawLineage', ARRAY(SELECT to_jsonb(l) FROM capture_raw_lineage l
    ORDER BY l.user_id, l.client, l.session_id, l.message_mac, l.content_mac),
  'rawFences', ARRAY(SELECT to_jsonb(f) FROM capture_raw_fences f ORDER BY f.user_id, f.client, f.session_id),
  'rawMessages', ARRAY(SELECT to_jsonb(r) FROM raw_messages r ORDER BY r.user_id, r.id),
  'captureEvents', ARRAY(
    SELECT to_jsonb(e) FROM capture_events e ORDER BY e.user_id, e.client, e.event_id
  )
) AS snapshot`;

async function beforeDeadline(label, ms, work) {
  let timer;
  try {
    return await Promise.race([work(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms} ms`)), ms);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

function trackedPool(connectionString, timeouts) {
  const sockets = new Map();
  let closing = false;
  let connectionError;
  const recordError = (error) => {
    if (!closing) connectionError ??= error;
  };
  const pool = new Pool({
    connectionString,
    ...timeouts,
    stream() {
      const socket = new Socket();
      sockets.set(socket, new Promise((resolve) => {
        socket.once("close", () => {
          sockets.delete(socket);
          resolve();
        });
      }));
      return socket;
    },
  });
  pool.on("error", recordError);
  pool.on("connect", (client) => client.on("error", recordError));

  return {
    pool,
    async close(label) {
      closing = true;
      try {
        await beforeDeadline(label, 750, async () => {
          await pool.end();
          await Promise.all(sockets.values());
        });
      } finally {
        // A checked-out client can keep pool.end() pending even after its socket is destroyed.
        // Closing the socket itself prevents a stalled client from keeping the process alive.
        for (const socket of sockets.keys()) socket.destroy();
      }
      if (connectionError) throw connectionError;
    },
  };
}

const concurrentIndexes = {
  "0022_core_raw_purge_idx.concurrent.sql": {
    name: "raw_messages_core_purge_idx",
    table: "raw_messages",
    definition: "CREATE INDEX raw_messages_core_purge_idx ON public.raw_messages USING btree (user_id, id)",
  },
  "0023_core_raw_ledger_idx.concurrent.sql": {
    name: "capture_events_core_raw_ledger_idx",
    table: "capture_events",
    definition: "CREATE INDEX capture_events_core_raw_ledger_idx ON public.capture_events USING btree (user_id, client, event_id) WHERE (core_namespace IS NULL)",
  },
  "0004_core_recent_index.concurrent.sql": {
    name: "memories_user_recent_c",
    table: "memories",
    definition: 'CREATE INDEX memories_user_recent_c ON public.memories USING btree (user_id, updated_at DESC, id COLLATE "C" DESC)',
  },
  "0008_core_memories_oldest_idx.concurrent.sql": {
    name: "memories_user_oldest_idx",
    table: "memories",
    definition: "CREATE INDEX memories_user_oldest_idx ON public.memories USING btree (user_id, created_at, id)",
  },
  "0018_core_capture_lease_idx.concurrent.sql": {
    name: "capture_events_core_lease_idx",
    table: "capture_events",
    definition: "CREATE UNIQUE INDEX capture_events_core_lease_idx ON public.capture_events USING btree (user_id, core_lease_token) WHERE (core_lease_token IS NOT NULL)",
  },
  "0019_core_capture_status_idx.concurrent.sql": {
    name: "capture_events_core_status_idx",
    table: "capture_events",
    definition: "CREATE INDEX capture_events_core_status_idx ON public.capture_events USING btree (user_id, event_id, core_namespace, client) WHERE (core_admitted OR (core_payload_digest IS NULL))",
  },
  "0020_core_capture_abandoned_idx.concurrent.sql": {
    name: "capture_events_core_abandoned_idx",
    table: "capture_events",
    definition: "CREATE INDEX capture_events_core_abandoned_idx ON public.capture_events USING gin (core_abandoned_tokens) WHERE (core_abandoned_tokens IS NOT NULL)",
  },
  "0021_core_raw_owner_time_idx.concurrent.sql": {
    name: "raw_messages_user_time_id_idx",
    table: "raw_messages",
    definition: 'CREATE INDEX raw_messages_user_time_id_idx ON public.raw_messages USING btree (user_id, occurred_at, id COLLATE "C")',
  },
};

async function readMigrations() {
  const directory = new URL("../migrations/", import.meta.url);
  const names = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  return Promise.all(names.map(async (id) => {
    const sql = await readFile(new URL(id, directory), "utf8");
    if (!id.endsWith(".concurrent.sql")) return { id, sql, concurrent: false };
    const index = concurrentIndexes[id];
    assert.ok(index, `Missing index definition for ${id}`);
    return { id, sql, concurrent: true, index };
  }));
}

function adminQuery(admin, label, sql, params) {
  return beforeDeadline(label, 18_000, () => admin.pool.query(sql, params));
}

async function closeDatabase(database, admin, name) {
  const cleanupSteps = [
    () => database.close("Case pool close"),
    () => adminQuery(admin, "Terminate case backends",
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1", [name]),
    () => adminQuery(admin, "Drop case database", `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`),
    () => admin.close("Admin pool close"),
  ];
  const errors = [];
  for (const step of cleanupSteps) {
    try {
      await step();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Database teardown failed");
}

async function openDatabase() {
  const name = `core_conformance_test_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(databaseUrl);
  url.pathname = `/${name}`;
  const admin = trackedPool(databaseUrl, {
    connectionTimeoutMillis: 1_000,
    // DROP DATABASE can wait for a checkpoint after marking the database invalid.
    statement_timeout: 15_000,
    query_timeout: 16_000,
  });
  const database = trackedPool(url.href, {
    connectionTimeoutMillis: 3_000,
    statement_timeout: 35_000,
    idle_in_transaction_session_timeout: 15_000,
    query_timeout: 38_000,
  });
  const { pool } = database;
  const source = {
    async connect() {
      const client = await pool.connect();
      return {
        query: (sql, values) => client.query(sql, values),
        release: (destroy) => client.release(destroy),
      };
    },
  };
  const close = () => closeDatabase(database, admin, name);

  try {
    await beforeDeadline("Database setup", 45_000, async () => {
      const [baseline, migrations] = await Promise.all([
        readFile(new URL("../schema/baseline.sql", import.meta.url), "utf8"),
        readMigrations(),
      ]);
      await adminQuery(admin, "Create case database", `CREATE DATABASE ${name} TEMPLATE template0`);
      await pool.query(baseline);
      await applyMigrations(source, migrations);
    });
    return { pool, source, close };
  } catch (error) {
    try {
      await close();
    } catch (closeError) {
      throw new AggregateError([error, closeError], "Database setup and teardown both failed");
    }
    throw error;
  }
}

function postgresFactory(wrapSuppressions = (store) => store, { seedRetainedState = false } = {}) {
  return {
    name: "Postgres",
    async open({ capabilities: requested }) {
      const sessionKey = randomBytes(32);
      const hashSessionKey = (client, sessionId) =>
        createHmac("sha256", sessionKey).update(JSON.stringify([client, sessionId])).digest("hex");
      const suppressions = wrapSuppressions(createPostgresSuppressionStore({
        sessionRefs: "hashed", hashSessionKey, vectorSuppression: true, allowNonNullNamespace: true,
      }));
      const { pool, source, close } = await openDatabase();
      const uow = createPostgresUnitOfWork(source);
      const lineageSecret = randomUUID();
      const nearDuplicate = requested.nearDuplicate !== false;
      let elapsed = 0;
      const capture = createPostgresCapturePorts({ lineageSecret, hashSessionKey, nearDuplicate,
        allowNonNullNamespace: true, now: () => Date.now() + elapsed });
      const semanticRetrieval = requested.semanticRetrieval !== false;
      const rawArchive = requested.rawArchive === true;
      const fingerprintKey = requested.fingerprintKey === true;
      const flags = capabilities({
        embeddingRequiredOnInsert: true, nearDuplicate, vectorSuppression: true, supersession: true,
        conflictEdges: true, semanticRetrieval, rawArchive, rawWindowHide: rawArchive || requested.rawWindowHide === true,
        sessionLineage: rawArchive, rawSpans: true, fingerprintKey, shingleSuppression: rawArchive && fingerprintKey,
        placement: true,
      });
      const fixtureSecrets = new Map(["test-secret-a", "test-secret-rotation", "test-secret-later"]
        .map(secret => [secret, randomUUID()]));
      const stagedSecrets = fingerprintKey ? [...fixtureSecrets.values()] : [];
      const provider = createPostgresFingerprintKeyProvider(null, { uow, stagedSecrets });
      /** @type {Map<string, RetainedDigestFixture>} */
      const retainedFixtures = new Map();
      const keys = {
        ...provider,
        async retainedDigesters(owner) {
          const fixture = retainedFixtures.get(owner);
          if (!fixture) return [];
          const scope = { owner, namespace: null };
          const { passages } = await uow.run(owner, { readOnly: true }, tx => suppressions.snapshot(tx, scope, {}));
          const live = passages.some(({ fact }) => fact.text.digests.every(({ alg }) => alg === "hmac") &&
            fact.text.digests.some(({ keyId, label, pipeline }) => keyId === fixture.keyId && (label ?? pipeline) === fixture.label));
          if (!live) return [];
          return [{ alg: "hmac", keyId: fixture.keyId, label: fixture.label,
            mac: (text) => createHmac("sha256", fixture.secret).update(text).digest("hex") }];
        },
      };
      const rawOptions = {
        lineageSecret, hashSessionKey,
        fingerprintKeys: async (owner) => {
          const key = await keys.userKey(owner);
          return key ? [key] : [];
        },
      };
      const rawPorts = rawArchive ? createPostgresRawPorts({ ...rawOptions,
        fingerprintKeys: async (owner) => (await rawOptions.fingerprintKeys(owner)).map((key) => ({ key, pipeline: "core" })),
      }) : null;
      const readOptions = { hashSessionKey, allowNonNullNamespace: true };
      const memoryReads = createPostgresMemoryReads(rawArchive ? { ...readOptions, ...rawOptions } : readOptions);
      const { lexical, vector } = createPostgresMemoryCandidates(readOptions);
      const memories = createPostgresMemoryStore({ ...readOptions, nearDuplicate });
      /** @type {string[]} */
      const harnessOwners = [];
      /** @type {Omit<TestHarness, "counters"> & {seedOwners(owner: string, otherOwner: string): Promise<void>}} */
      const harness = {
        hashSessionKey,
        async advanceClock(ms) { elapsed += ms; },
        async rowsMissingKeyedDigest(owner) {
          return (await digestCoverage(owner)).missingPairs;
        },
        async setRetainedDigestFixture(owner, fixture) {
          if (fixture === null) retainedFixtures.delete(owner);
          else retainedFixtures.set(owner, fixture);
        },
        async setFingerprintSecret(secret) {
          const fixtureSecret = fixtureSecrets.get(secret);
          assert.ok(fingerprintKey && fixtureSecret);
          for (const owner of harnessOwners) {
            const key = await userFingerprintKey(fixtureSecret, owner, HOSTED_FINGERPRINT_LABELS);
            assert.ok(key);
            if (seedRetainedState && secret === "test-secret-rotation") {
              // This case starts from a retained fact and a newer active key.
              await uow.run(owner, {}, (tx) => query(tx,
                "UPDATE core_owner_state SET fingerprint_key_id = $2 WHERE user_id = $1", [owner, key.id]));
              continue;
            }
            // The host stages the new MACs before publication. Keep test staging and
            // publication atomic so a refused rotation leaves the fixture untouched.
            await uow.run(owner, {}, async (tx) => {
              const runQuery = (sql, values) => query(tx, sql, values);
              if (await readFingerprintKeyId(runQuery, owner) === key.id) return;
              const { rows } = await runQuery("SELECT id, text FROM memories WHERE user_id = $1", [owner]);
              for (const { id, text } of rows) {
                const digest = await coreDigest(text, key);
                await runQuery(`UPDATE memories SET core_digests = COALESCE(core_digests, '[]'::jsonb) || $3::jsonb
                    WHERE user_id = $1 AND id = $2`, [owner, id, JSON.stringify([digest])]);
              }
              if (rows.length) await advanceIndex(runQuery, owner, requireLiveRun(tx, true));
              await publishFingerprintKey(tx, key.id);
            });
          }
        },
        async seedClientlessRaw(scope, sessionId, { id, occurredAtMs, role, content }) {
          assert.equal(scope.namespace, null);
          await pool.query(`INSERT INTO raw_messages (id, user_id, client, session_id, message_id, role, content, occurred_at)
            VALUES ($1, $2, '', $3, $4, $5, $6, ${timestampUs("$7")})`,
          [randomUUID(), scope.owner, sessionId, id, role, content,
            occurredAtMs === null ? null : (BigInt(occurredAtMs) * 1000n).toString()]);
        },
        async seedOwners(owner, otherOwner) {
          await beforeDeadline("Owner fixture setup", 4_000,
            () => pool.query("INSERT INTO users (id) VALUES ($1), ($2)", [owner, otherOwner]));
          harnessOwners.push(owner, otherOwner);
          if (fingerprintKey) await harness.setFingerprintSecret("test-secret-a");
        },
        async dump() {
          const { rows } = await pool.query(dumpSql);
          return rows[0].snapshot;
        },
        async setWriteTime({ owner, namespace }, id, updatedAtUs) {
          await uow.run(owner, {}, async (tx) => {
            const result = await query(tx, `UPDATE memories SET updated_at = ${timestampUs("$4")}
              WHERE user_id = $1 AND core_namespace IS NOT DISTINCT FROM $2 AND id = $3`,
            [owner, namespace === null ? null : JSON.stringify(namespace), id, updatedAtUs.toString()]);
            assert.equal(result.rowCount, 1);
            await advanceIndex((sql, values) => query(tx, sql, values), owner, requireLiveRun(tx, true));
          });
        },
        async seedFact(owner, fact) {
          const incarnation = createHash("sha256").update(factIncarnationBody(fact)).digest("hex");
          await uow.run(owner, {}, (tx) => suppressions.writeFact(tx, fact, incarnation));
        },
      };
      const digestCoverage = createPostgresDigestGate(uow, async (owner) => {
        const key = await keys.userKey(owner);
        return key ? [key.id] : [];
      });
      return {
        adapter: {
          capabilities: flags, uow, suppressions, keys, lexical, ...memoryReads,
          placement: createPostgresTopicStore({ hashSessionKey }),
          ...(semanticRetrieval && { vector }),
          ...(rawPorts && { raw: { ...rawPorts.raw, ...createPostgresRawReads(rawOptions) }, sessionLineage: rawPorts.sessionLineage }),
          capture: requested.supersession ? withRelationCaptureFinish(capture, memories) : capture,
          memories: requested.supersession && requested.conflictEdges ? withDistinctNamespaceText(memories) : memories,
          pause: createPostgresPauseStore(),
          supersession: createPostgresSupersessionStore(readOptions),
          conflicts: createPostgresConflictEdgeStore(readOptions),
        },
        sessionRefs: /** @type {const} */ ("hashed"),
        harness,
        nativeErrorMap,
        busyNativeCodes,
        embeddingDimensions: 1536,
        timeoutMs: 22_000,
        settleMs: 100,
        close,
      };
    },
  };
}

// Read each case body, its helpers and any follow-up against the implemented
// ports, hooks and profile. Check needs and needsOff as requirements and
// requests as preferences. K-CAP-2 exercises the semantic-retrieval-off profile.
const selected = new Set([
  "K-UOW-3", "K-UOW-3r", "K-ERR-1", "K-CAP-0", "K-CAP-2",
  "K-FACT-1", "K-FACT-2", "K-UOW-8a", "K-FACT-3",
  "K-FACT-5", "K-FACT-6", "K-FACT-7", "K-SESS-1",
  "K-ADM-1", "K-ADM-3", "K-ADM-4", "K-ADM-5", "K-ADM-9", "K-ADM-12", "K-ADM-13",
  "K-SRC-1", "K-SRC-2", "K-SRC-3", "K-SRC-4", "K-SRC-5",
  "K-RAW-LATE-1", "K-RAW-LATE-2",
  "K-UOW-1", "K-UOW-2", "K-UOW-4", "K-UOW-7", "K-UOW-8b",
  "K-MEM-1", "K-MEM-3", "K-CAP-1", "K-MEM-4", "K-MEM-4r", "K-MEM-5",
  "K-MEM-11", "K-MEM-12", "K-MEM-13",
  "K-HIDE-1", "K-HIDE-2", "K-HIDE-3", "K-HIDE-4", "K-WRITE-1", "K-WRITE-2",
  "K-FORK-1", "K-FORK-2", "K-FORK-3", "K-FORK-4", "K-FORK-5",
  "K-FORK-6", "K-FORK-7", "K-FORK-10",
  "K-RET-1", "K-RET-2", "K-RET-3", "K-FEN-1", "K-FEN-I1", "K-FEN-I2", "K-FEN-I3",
  "K-RET-W1", "K-RET-W2", "K-SNAP-W1", "K-RAW-W1", "K-RAW-3", "K-RAW-3w", "K-RAW-3c", "K-RAW-3s",
  "K-RAW-LEDGER-1", "K-RAW-LEDGER-2",
  "K-RET-9", "K-SNAP-1", "K-HYD-1", "K-HYD-2", "K-PAUSE-1", "K-IMP-T1", "K-IMP-T2", "K-IMP-T3",
  "K-SNAP-F1", "K-SNAP-F3", "K-SNAP-F4", "K-SNAP-F5", "K-SNAP-F5u", "K-SNAP-F6", "K-SNAP-F7",
  "K-SNAP-C1", "K-SNAP-C3", "K-SNAP-C4",
  "K-FACTSFOR-1", "K-KEY-1", "K-FACT-3r",
  "K-KD-1", "K-KD-2", "K-KD-3", "K-KD-4", "K-KD-5", "K-KD-6",
  "K-KD-7", "K-KD-7v", "K-KD-8", "K-HASH-1",
  "K-CLM-1", "K-CLM-2", "K-CLM-3", "K-CLM-4", "K-CLM-5", "K-CLM-6",
  "K-ADM-2", "K-ADM-6", "K-ADM-7", "K-ADM-8", "K-ADM-10", "K-ADM-11", "K-ADM-14",
  "K-IMP-RAW-1", "K-IMP-RAW-2", "K-IMP-RAW-3", "K-IMP-RAW-3s", "K-IMP-RAW-4k", "K-IMP-RAW-5",
  "K-IMP-RAW-6", "K-IMP-RAW-7", "K-IMP-RAW-8", "K-IMP-RAW-9", "K-IMP-RAW-10",
  "K-RAW-1", "K-RAW-2", "K-RAW-2s", "K-RAW-8w",
  "K-REL-1", "K-REL-2", "K-REL-3", "K-REL-4", "K-REL-5", "K-REL-6",
  "K-REL-7", "K-REL-8", "K-REL-9", "K-REL-10", "K-REL-11", "K-REL-12",
  "T-TFM-1", "T-TFM-2", "T-TFM-3", "T-TFM-4", "T-TFM-5", "T-TFM-6", "T-TFM-7", "T-TFM-8",
  "T-TOP-1", "T-TOP-2", "T-TOP-5", "T-TOP-6", "T-TOP-7", "T-TOP-8",
  "T-TOP-9", "T-TOP-10", "T-TOP-11", "T-TOP-12", "T-TOP-13", "T-TOP-15",
]);

// Each entry names a missing port, method, capability, or profile behavior.
const notApplicable = {
  "K-FACT-4 expects changed pipeline, key ID, and redaction version to share an algorithm/value slot. Postgres slots include the full digest domain": ["K-FACT-4"],
  "K-KD-9 expects two missing domains. Its direct insert supplies no current digest, so Postgres counts three": ["K-KD-9"],
  "snapshot retains ineligible full facts in the no-key profile": ["K-SNAP-C2"],
  "hosted profile requires an embedding": ["K-MEM-10"],
  "pending historical edit case has no assertions": ["K-MEM-5h"],
  "hosted raw is personal-only (namespace guard)": ["K-RAW-4", "K-RAW-5", "K-RAW-6", "K-RAW-8", "K-IMP-RAW-4", "K-IMP-RAW-4e"],
  "raw conflict counters": ["K-RAW-7"],
  "raw span purge": ["K-RAW-8s"],
  "raw.recordLineage": ["K-FORK-8", "K-FORK-9"],
  "spanLineage.resolveSpans": ["K-SPAN-1", "K-SPAN-2"],
  documentCards: ["T-CARD-AMEND-1", "T-CARD-AMEND-2", "T-CARD-AMEND-3", "T-CARD-AMEND-4", "T-CARD-AMEND-5", "T-CARD-AMEND-6",
    "T-CARD-LINK-1", "T-CARD-LINK-2", "T-CARD-LINK-3", "T-CARD-LINK-4", "T-CARD-LINK-5", "T-CARD-LINK-6", "T-CARD-LINK-7",
    "T-DVIS-text", "T-DVIS-identity", "T-DVIS-session", "T-DVIS-linked-session", "CAPTURE-CARD-1", "CAPTURE-AMEND-1",
    "CAPTURE-AMEND-2", "CAPTURE-FORGET-1", "CAPTURE-FORGET-2", "T-CARD-PURGE-1", "T-CARD-PURGE-2"],
  quantityLedger: ["CAPTURE-LEDGER-1", "CAPTURE-LEDGER-2", "CAPTURE-FORGET-3"],
  "topics.cards": ["T-TCARD-1", "T-TCARD-2", "T-TCARD-3", "T-TCARD-4", "T-TCARD-5", "T-TCARD-6", "T-TCARD-7", "T-TCARD-8", "T-TCARD-9", "T-TCARD-10"],
  "topics.forCards": ["T-FOR-CARDS-1", "T-FOR-CARDS-2", "T-FOR-CARDS-3", "T-FOR-CARDS-4", "T-FOR-CARDS-5", "T-FOR-CARDS-6", "T-FOR-CARDS-7", "T-FOR-CARDS-8", "T-FOR-CARDS-9"],
  rationaleEdges: ["T-RAT-content", "T-RAT-correct", "T-RAT-currentness", "T-RAT-degree", "T-RAT-duplicate", "T-RAT-forget",
    "T-RAT-hidden", "T-RAT-index", "T-RAT-insert", "T-RAT-namespace", "T-RAT-raw-deleted", "T-RAT-receipt-add",
    "T-RAT-receipt-private", "T-RAT-receipt-remove", "T-RAT-receipt-update", "T-RAT-revision", "T-RAT-scope", "T-RAT-stale"],
  "topics.forMemories requires personal scope": ["T-TFM-4-namespace"],
  "placement requires personal scope": ["T-TOP-3", "T-TOP-4", "T-TOP-14"],
  "suppressions.receiptWithheld not implemented yet": ["K-RCPT-W1"],
  "durable conversation deletion not implemented yet": ["K-RAW-DEL-1"],
};

const { PRIVACY_CASES, runCase } = kit;

/** @param {unknown} entry @returns {entry is ConformanceCase} */
function isCase(entry) {
  const candidate = /** @type {Partial<ConformanceCase> | null | undefined} */ (entry);
  return typeof candidate?.id === "string" && typeof candidate?.run === "function";
}

/** @param {Readonly<Record<string, unknown>>} exports @returns {ConformanceCase[]} */
function discoverCases(exports) {
  const cases = [];
  for (const [name, value] of Object.entries(exports)) {
    if (!name.endsWith("CASES") && !(Array.isArray(value) && value.some(isCase))) continue;
    assert.ok(Array.isArray(value), `${name} must export an array of conformance cases`);
    for (let index = 0; index < value.length; index++) {
      const entry = value[index];
      assert.ok(isCase(entry), `${name}[${index}] must have a string id and a run function`);
      cases.push(entry);
    }
  }
  return cases;
}

const allCases = discoverCases(kit);
assert.deepEqual(
  [...selected, ...Object.values(notApplicable).flat()].sort(),
  allCases.map(({ id }) => id).sort(),
  "Every conformance case must be selected or have a reason it is not applicable",
);

test("conformance inventory rejects malformed case exports offline", () => {
  const valid = { id: "case", async run() {} };
  assert.throws(() => discoverCases({ FUTURE_CASES: [valid, undefined] }), /FUTURE_CASES\[1\]/);
  assert.throws(() => discoverCases({ future: [valid, undefined] }), /future\[1\]/);
  assert.throws(() => discoverCases({ FUTURE_CASES: [undefined] }), /FUTURE_CASES\[0\]/);
});

/** @param {ConformanceCase} testCase */
async function runPreparedCase(factory, testCase, t, execute = runCase) {
  const prepare = (run) => async (ctx) => {
    // runCase generates these IDs after open(), so seed both together at the case entry point.
    await ctx.harness.seedOwners(ctx.owner, ctx.otherOwner);
    // Equal lexical text in two namespaces needs distinct fixture hashes on hosted.
    if (testCase.id === "K-RET-1") {
      let fixture = 0;
      const hash = ctx.hash;
      ctx = { ...ctx, hash: (text) => hash(JSON.stringify([text, fixture++])) };
    }
    return beforeDeadline("Conformance case", 40_000, () => run(ctx));
  };
  const prepared = { ...testCase, run: prepare(testCase.run) };
  if (testCase.followUp) prepared.followUp = { ...testCase.followUp, run: prepare(testCase.followUp.run) };
  // The factory type describes the full kit. The selected cases define this driver's subset.
  const reason = await execute(/** @type {AdapterFactory} */ (/** @type {unknown} */ (factory)), prepared);
  if (reason !== null) t.skip(reason);
  return reason;
}

const factory = postgresFactory();
const retainedStateFactory = postgresFactory(undefined, { seedRetainedState: true });
for (const testCase of allCases.filter(({ id }) => selected.has(id))) {
  const name = `${factory.name} conformance ${testCase.id} ${testCase.title}`;
  // K-HYD-2 contains assertions even though the kit marks the supersession suite pending.
  const prepared = testCase.id === "K-HYD-2" ? { ...testCase, pending: undefined } : testCase;
  // The primary cases cover the memory ports. Their semantic follow-ups belong to the vector lane.
  const memoryOnly = ["K-HIDE-2", "K-HIDE-3", "K-WRITE-1"].includes(testCase.id);
  test(name, options, (t) => runPreparedCase(testCase.id === "K-KD-5" ? retainedStateFactory : factory,
    memoryOnly ? { ...prepared, followUp: undefined } : prepared, t));
}

test("Postgres conformance K-FACT-6 detects a bypassed foreign-owner guard", options, async (t) => {
  const testCase = PRIVACY_CASES.find(({ id }) => id === "K-FACT-6");
  assert.ok(testCase);
  let wroteFact = false;
  const mutant = postgresFactory((store) => ({
    ...store,
    async writeFact(tx, fact, incarnation) {
      if (tx.owner === fact.owner) return store.writeFact(tx, fact, incarnation);
      const result = await store.writeFact(tx, { ...fact, owner: tx.owner }, incarnation);
      wroteFact = result.created;
      return result;
    },
  }));
  await assert.rejects(runPreparedCase(mutant, testCase, t), { message: "Expected operation to reject" });
  assert.equal(wroteFact, true);
});

test("Postgres conformance tears down the database after a stalled pool drain", { timeout: 5_000 }, async (t) => {
  const database = trackedPool(undefined, {});
  const socket = database.pool.options.stream();
  t.mock.method(database.pool, "end", () => new Promise(() => {}));
  const calls = [];
  const admin = {
    pool: {
      async query(sql) {
        assert.equal(socket.destroyed, true);
        calls.push(sql);
      },
    },
    async close() {
      calls.push("admin closed");
    },
  };
  await assert.rejects(closeDatabase(database, admin, "case_database"), { message: "Case pool close exceeded 750 ms" });
  assert.deepEqual(calls, [
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1",
    "DROP DATABASE IF EXISTS case_database WITH (FORCE)",
    "admin closed",
  ]);
});
