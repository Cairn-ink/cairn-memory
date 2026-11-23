import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  CAPTURE_CASES, CASES, KEYED_DIGEST_CASES, PRIVACY_CASES, PRIVACY_MATCH_CASES,
  RAW_CASES, SOURCE_FILTER_CASES, TOPIC_CASES, runCase,
} from "@cairn-ink/conformance";
import { capabilities, factIncarnationBody } from "@cairn-ink/core";
import { toPostgresError } from "../src/errors.mjs";
import { createPostgresSuppressionStore, createPostgresUnitOfWork, query } from "../src/index.mjs";
import { migrationDatabase, migrationDbTest } from "./migration-database.mjs";

/** @import { AdapterFactory, TestHarness } from "@cairn-ink/conformance" */
/** @import { UnitOfWork } from "../../core/src/index.mjs" */

const busyNativeCodes = ["55P03", "40001", "40P01"];
const nativeCodes = [...busyNativeCodes, "57014", "08000", "57P01", "57P02", "57P03"];
const nativeErrorMap = Object.fromEntries(nativeCodes.map((code) => [code, toPostgresError({ code }).code]));

// Cast bigint counters and the vector projection to text before JSON decoding.
// One statement reads the three tables from the same committed snapshot.
const dumpSql = `SELECT jsonb_build_object(
  'facts', ARRAY(
    SELECT to_jsonb(f) || jsonb_build_object('epoch', f.epoch::text, 'embedding', f.embedding::text)
    FROM core_suppression_facts f ORDER BY f.user_id, f.epoch
  ),
  'factDigests', ARRAY(
    SELECT to_jsonb(d) FROM core_fact_digests d ORDER BY d.user_id, d.fact_id, d.alg, d.value
  ),
  'ownerState', ARRAY(
    SELECT to_jsonb(s) || jsonb_build_object('fact_epoch', s.fact_epoch::text, 'index_revision', s.index_revision::text)
    FROM core_owner_state s ORDER BY s.user_id
  )
) AS snapshot`;

const factory = {
  name: "Postgres",
  async open() {
    /** @type {() => Promise<void>} */
    let close = async () => {};
    try {
      // Reuse the helper's teardown as the factory's close hook for every open.
      const { pool, source } = await migrationDatabase({ after(hook) { close = hook; } });
      const postgres = createPostgresUnitOfWork(source);
      const suppressions = createPostgresSuppressionStore();
      /** @type {UnitOfWork} */
      const uow = {
        run(owner, options, fn) {
          return postgres.run(owner, options, async (tx) => {
            // The kit creates the owner IDs after open. Supply the foreign-key row on writes.
            if (!options.readOnly) await query(tx, "INSERT INTO users (id) VALUES ($1) ON CONFLICT DO NOTHING", [owner]);
            return fn(tx);
          });
        },
      };
      /** @type {Pick<TestHarness, "dump" | "seedFact">} */
      const harness = {
        async dump() {
          const { rows } = await pool.query(dumpSql);
          return rows[0].snapshot;
        },
        async seedFact(owner, fact) {
          const incarnation = createHash("sha256").update(factIncarnationBody(fact)).digest("hex");
          await uow.run(owner, {}, (tx) => suppressions.writeFact(tx, fact, incarnation));
        },
      };
      return {
        adapter: { capabilities: capabilities({ embeddingRequiredOnInsert: true }), uow, suppressions },
        sessionRefs: /** @type {const} */ ("plain"),
        harness,
        nativeErrorMap,
        busyNativeCodes,
        embeddingDimensions: 1536,
        timeoutMs: 10_000,
        close,
      };
    } catch (error) {
      await close();
      throw error;
    }
  },
};

// The kit exports capability gates, but no per-case port metadata. These are
// the UoW cases without memory calls and the privacy cases limited to fact
// writes and epoch reads.
const selected = new Set([
  "K-UOW-3", "K-ERR-1", "K-CAP-0",
  "K-FACT-1", "K-FACT-2", "K-UOW-8a", "K-FACT-3", "K-FACT-4",
  "K-FACT-5", "K-FACT-6", "K-FACT-7", "K-SESS-1",
]);

// Each entry names a missing port, method, or capability.
const notApplicable = {
  memories: [
    "K-UOW-1", "K-UOW-2", "K-UOW-4", "K-UOW-7", "K-UOW-8b",
    "K-MEM-1", "K-MEM-3", "K-CAP-1", "K-MEM-4", "K-MEM-4r", "K-MEM-5",
    "K-MEM-10", "K-MEM-11", "K-MEM-12", "K-MEM-13",
    "K-HIDE-1", "K-HIDE-2", "K-HIDE-3", "K-HIDE-4", "K-WRITE-1", "K-WRITE-2", "K-HASH-1",
  ],
  lexical: ["K-RET-1", "K-RET-2"],
  vector: ["K-RET-3", "K-CAP-2"],
  recent: ["K-RET-9"],
  snapshot: ["K-SNAP-1"],
  hydrate: ["K-HYD-1"],
  supersession: ["K-MEM-5h", "K-HYD-2"],
  fence: ["K-FEN-1"],
  pause: ["K-PAUSE-1"],
  keys: ["K-KEY-1", "K-KD-1", "K-KD-2", "K-KD-3", "K-KD-4", "K-KD-5", "K-KD-6"],
  "suppressions.snapshot": ["K-SNAP-F1"],
  "suppressions.factsFor": ["K-FACTSFOR-1"],
  capture: ["K-CLM-1", "K-CLM-2", "K-CLM-3", "K-CLM-4", "K-CLM-5",
    "K-SRC-1", "K-SRC-2", "K-SRC-3", "K-SRC-4", "K-SRC-5"],
  raw: ["K-RAW-1", "K-RAW-2", "K-RAW-2s", "K-RAW-3", "K-RAW-3w", "K-RAW-3c", "K-RAW-3s",
    "K-RAW-4", "K-RAW-5", "K-RAW-6", "K-RAW-7", "K-RAW-8", "K-RAW-8w", "K-RAW-8s"],
  "rawSpans not declared": ["K-FACT-3r"],
  placement: ["T-TOP-1", "T-TOP-2", "T-TOP-3", "T-TOP-4", "T-TOP-5", "T-TOP-6", "T-TOP-7", "T-TOP-8",
    "T-TOP-9", "T-TOP-10", "T-TOP-11", "T-TOP-12", "T-TOP-13", "T-TOP-14", "T-TOP-15"],
};

const allCases = [
  ...CASES, ...PRIVACY_CASES, ...PRIVACY_MATCH_CASES, ...CAPTURE_CASES, ...SOURCE_FILTER_CASES,
  ...KEYED_DIGEST_CASES, ...RAW_CASES, ...TOPIC_CASES,
];
assert.deepEqual(
  [...selected, ...Object.values(notApplicable).flat()].sort(),
  allCases.map(({ id }) => id).sort(),
  "Every conformance case must be selected or have a reason it is not applicable",
);

const options = { ...migrationDbTest, skip: migrationDbTest.skip ? "CORE_PG_TEST_URL is not set" : false };
for (const testCase of allCases.filter(({ id }) => selected.has(id))) {
  const name = `${factory.name} conformance ${testCase.id} ${testCase.title}`;
  const todo = testCase.id === "K-UOW-3"
    ? "pending ruling: read-only pauseLock run holding the pause lock (store/contract mismatch)"
    : false;
  /** @param {import("node:test").TestContext} t */
  const run = async (t) => {
    // The factory type describes the full kit. The selected cases define this driver's subset.
    const reason = await runCase(/** @type {AdapterFactory} */ (/** @type {unknown} */ (factory)), testCase);
    if (reason !== null) t.skip(reason);
  };
  if (todo) {
    test(name, { timeout: options.timeout, todo }, migrationDbTest.skip ? undefined : run);
  } else {
    test(name, options, run);
  }
}
